import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  PROJECT_SCHEMA_REGISTRARS,
  FixedClock,
  canonicalJson,
  canonicalMutationPlanHash,
  registerProjectSchemas,
  success,
  type RuntimeResult,
} from "../../src/index.js";
import type { CanonicalRecord } from "../../src/governance/contracts/index.js";
import {
  createCanonicalRecordStore,
  type RecordPlanningContext,
  type RecordPlanningContextProvider,
} from "../../src/governance/records/immutable-record-store.js";
import { canonicalRecordPath } from "../../src/governance/records/record-path.js";
import {
  buildSupersessionIndex,
} from "../../src/governance/records/supersession-index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const ROOT_ID = "ROOT-01J00000000000000000000000";
const HEAD = "1".repeat(40);
const PROFILE_HASH = "a".repeat(64);
const roots: string[] = [];

class FixedContext implements RecordPlanningContextProvider {
  readonly calls: URL[] = [];

  context(root: URL): Promise<RuntimeResult<RecordPlanningContext>> {
    this.calls.push(root);
    return Promise.resolve(
      success({
        target_ref: "refs/heads/main",
        expected_head: HEAD,
        profile_lock_hash: PROFILE_HASH,
        created_by: "integrator-a",
      }),
    );
  }
}

async function fixture(name: string): Promise<CanonicalRecord> {
  return JSON.parse(
    await readFile(
      new URL(`../fixtures/governance/records/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as CanonicalRecord;
}

async function temporaryRoot(): Promise<URL> {
  const directory = await mkdtemp(path.join(tmpdir(), "project-memory-records-"));
  roots.push(directory);
  return pathToFileURL(`${directory}${path.sep}`);
}

async function persist(root: URL, record: CanonicalRecord): Promise<void> {
  const target = path.join(fileURLToPath(root), ...canonicalRecordPath(record).split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, canonicalJson(record), "utf8");
}

async function pathExists(root: URL, relativePath: string): Promise<boolean> {
  try {
    await access(path.join(fileURLToPath(root), ...relativePath.split("/")));
    return true;
  } catch {
    return false;
  }
}

let acceptedDecision: CanonicalRecord;
let supersedingDecision: CanonicalRecord;
let root: URL;
let context: FixedContext;

beforeAll(async () => {
  acceptedDecision = await fixture("accepted-decision");
  supersedingDecision = await fixture("superseding-decision");
});

beforeEach(async () => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
  root = await temporaryRoot();
  context = new FixedContext();
});

afterAll(async () => {
  resetSchemaRegistryForTests();
  await Promise.all(roots.map((entry) => rm(entry, { recursive: true, force: true })));
});

function store() {
  return createCanonicalRecordStore({
    context,
    clock: new FixedClock(new Date("2026-07-14T14:00:00.000Z")),
  });
}

describe("immutable canonical record store", () => {
  it("plans one create-only canonical record write", async () => {
    const result = await store().planCreate(root, acceptedDecision);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.writes).toHaveLength(1);
    expect(result.value.writes[0]).toMatchObject({
      relative_path:
        "docs/project-memory/records/decisions/DEC-01J00000000000000000000000.json",
      expected_existing_sha256: null,
      mode: "create",
    });
    expect(result.value.writes[0]?.bytes).toEqual(
      new TextEncoder().encode(canonicalJson(acceptedDecision)),
    );
    expect(result.value).toMatchObject({
      mutation_kind: "record",
      root_id: ROOT_ID,
      target_ref: "refs/heads/main",
      expected_head: HEAD,
      profile_lock_hash: PROFILE_HASH,
      record_ids: [acceptedDecision.id],
      metadata: { governance_kind: "record", record_type: "decision" },
    });
    const { plan_hash: planHash, ...withoutHash } = result.value;
    expect(planHash).toBe(canonicalMutationPlanHash(withoutHash));
    expect(await pathExists(root, canonicalRecordPath(acceptedDecision))).toBe(false);
  });

  it("rejects replacement of an existing record ID", async () => {
    await persist(root, acceptedDecision);
    const duplicate = await store().planCreate(root, acceptedDecision);
    expect(duplicate).toMatchObject({
      ok: false,
      issues: [{ code: "record.id_exists" }],
    });
  });

  it("loads and queries canonical records without changing bytes", async () => {
    await persist(root, acceptedDecision);
    const records = store();
    const loaded = await records.get(root, acceptedDecision.id);
    expect(loaded).toMatchObject({ ok: true, value: acceptedDecision });
    const listed = await records.list(root, {
      root_id: ROOT_ID,
      types: ["decision"],
      statuses: ["accepted"],
    });
    expect(listed).toMatchObject({ ok: true, value: [acceptedDecision] });
    expect(
      new TextDecoder().decode(
        await readFile(
          path.join(fileURLToPath(root), ...canonicalRecordPath(acceptedDecision).split("/")),
        ),
      ),
    ).toBe(canonicalJson(acceptedDecision));
  });

  it("plans supersession as a new record and preserves the previous bytes", async () => {
    await persist(root, acceptedDecision);
    const before = canonicalJson(acceptedDecision);
    const result = await store().planSupersede(
      root,
      acceptedDecision.id,
      supersedingDecision,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.record_ids).toEqual([supersedingDecision.id]);
    expect(result.value.writes).toHaveLength(1);
    expect(result.value.writes[0]).toMatchObject({ mode: "create" });
    expect(await pathExists(root, canonicalRecordPath(supersedingDecision))).toBe(false);
    const previous = await store().get(root, acceptedDecision.id);
    if (!previous.ok) throw new Error(JSON.stringify(previous.issues));
    expect(canonicalJson(previous.value)).toBe(before);
  });

  it("rejects missing targets, wrong fact classes, and missing Pitaji coverage", async () => {
    const missing = await store().planSupersede(
      root,
      acceptedDecision.id,
      supersedingDecision,
    );
    expect(missing).toMatchObject({
      ok: false,
      issues: [{ code: "record.not_found" }],
    });

    await persist(root, acceptedDecision);
    const wrongClass = {
      ...supersedingDecision,
      id: "IDEA-01J00000000000000000000002",
      type: "idea",
      payload: { proposal: "Replace a decision", disposition_reason: "invalid" },
    } as CanonicalRecord;
    expect(
      await store().planSupersede(root, acceptedDecision.id, wrongClass),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "record.fact_class_mismatch" }],
    });

    const workerAccepted = {
      ...supersedingDecision,
      actor_id: "worker-a",
      authority_class: "worker",
    } as CanonicalRecord;
    expect(
      await store().planSupersede(root, acceptedDecision.id, workerAccepted),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "record.pitaji_approval_required" }],
    });
  });

  it("rejects unsafe IDs before resolving a target path", async () => {
    const unsafe = {
      ...acceptedDecision,
      id: "DEC-../../outside",
    };
    expect(await store().planCreate(root, unsafe)).toMatchObject({
      ok: false,
      issues: [{ code: "record.schema_invalid" }],
    });
  });
});

describe("supersession index", () => {
  it("rejects a corrupted existing supersession cycle", () => {
    const first = {
      ...acceptedDecision,
      relationships: [
        {
          type: "supersedes",
          target_id: supersedingDecision.id,
          note: "corrupted reverse edge",
        },
      ],
    } as CanonicalRecord;
    const result = buildSupersessionIndex([first, supersedingDecision]);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "record.supersession_cycle" }],
    });
  });

  it("rejects a supersession edge to a missing immutable record", () => {
    expect(buildSupersessionIndex([supersedingDecision])).toMatchObject({
      ok: false,
      issues: [{ code: "record.supersession_target_missing" }],
    });
  });
});
