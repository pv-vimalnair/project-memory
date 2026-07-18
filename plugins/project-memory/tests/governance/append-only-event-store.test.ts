import { lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  PROJECT_SCHEMA_REGISTRARS,
  canonicalJson,
  registerProjectSchemas,
  sha256,
} from "../../src/index.js";
import type {
  GovernanceEvent,
  UnsignedGovernanceEvent,
} from "../../src/governance/contracts/index.js";
import {
  createAppendOnlyEventStore,
  eventPath,
} from "../../src/governance/events/append-only-event-store.js";
import {
  signEvent,
  verifyEventChain,
} from "../../src/governance/events/event-chain-verifier.js";
import {
  SUPPORTED_EVENT_TRANSITIONS,
  projectEffectiveState,
} from "../../src/governance/events/effective-state-projector.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

interface ClaimChainFixture {
  readonly issued: UnsignedGovernanceEvent;
  readonly heartbeat: UnsignedGovernanceEvent;
  readonly renewed: UnsignedGovernanceEvent;
  readonly expired: UnsignedGovernanceEvent;
  readonly unknown: UnsignedGovernanceEvent;
}

const roots: string[] = [];

async function fixture(): Promise<ClaimChainFixture> {
  return JSON.parse(
    await readFile(
      new URL("../fixtures/governance/events/claim-chain.json", import.meta.url),
      "utf8",
    ),
  ) as ClaimChainFixture;
}

async function temporaryRoot(): Promise<URL> {
  const directory = await mkdtemp(path.join(tmpdir(), "project-memory-events-"));
  roots.push(directory);
  return pathToFileURL(`${directory}${path.sep}`);
}

async function applyPlannedWrite(
  root: URL,
  write: {
    readonly relative_path: string;
    readonly bytes: Uint8Array;
    readonly mode: "create" | "replace" | "create_or_replace";
  },
): Promise<void> {
  expect(write.mode).toBe("create");
  const target = path.join(fileURLToPath(root), ...write.relative_path.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, write.bytes, { flag: "wx" });
}

async function appendAndApply(
  root: URL,
  event: UnsignedGovernanceEvent,
): Promise<GovernanceEvent> {
  const planned = await createAppendOnlyEventStore().planAppend(root, event);
  if (!planned.ok) throw new Error(JSON.stringify(planned.issues));
  await applyPlannedWrite(root, planned.value);
  return JSON.parse(new TextDecoder().decode(planned.value.bytes)) as GovernanceEvent;
}

function signedChain(
  events: readonly UnsignedGovernanceEvent[],
): readonly GovernanceEvent[] {
  const result: GovernanceEvent[] = [];
  for (const event of events) {
    const signed = signEvent(event, result.at(-1) ?? null);
    result.push(signed);
  }
  return result;
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

afterAll(async () => {
  resetSchemaRegistryForTests();
  await Promise.all(roots.map((entry) => rm(entry, { recursive: true, force: true })));
});

describe("append-only governance event store", () => {
  it("plans a deterministic create-only first event without mutating the root", async () => {
    const root = await temporaryRoot();
    const events = await fixture();
    const store = createAppendOnlyEventStore();
    const first = await store.planAppend(root, events.issued);
    const repeated = await store.planAppend(root, events.issued);
    if (!first.ok || !repeated.ok) throw new Error("event planning failed");

    expect(first.value).toMatchObject({
      expected_existing_sha256: null,
      mode: "create",
    });
    expect(repeated.value.relative_path).toBe(first.value.relative_path);
    expect(repeated.value.bytes).toEqual(first.value.bytes);
    const signed = JSON.parse(new TextDecoder().decode(first.value.bytes)) as GovernanceEvent;
    expect(signed).toMatchObject({ sequence: 1, previous_event_hash: null });
    expect(signed.payload_hash).toBe(sha256(canonicalJson(events.issued.payload)));
    expect(first.value.relative_path).toBe(eventPath(signed));
    await expect(lstat(new URL(first.value.relative_path, root))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("links every event to the previous event hash", async () => {
    const root = await temporaryRoot();
    const events = await fixture();
    await appendAndApply(root, events.issued);
    await appendAndApply(root, events.heartbeat);
    const chain = await createAppendOnlyEventStore().readChain(
      root,
      events.issued.aggregate_id,
    );
    if (!chain.ok) throw new Error(JSON.stringify(chain.issues));
    expect(chain.value).toHaveLength(2);
    expect(chain.value[1]).toMatchObject({
      sequence: 2,
      previous_event_hash: chain.value[0]?.event_hash,
    });
  });

  it("returns the exact existing create plan for an identical appended event", async () => {
    const root = await temporaryRoot();
    const events = await fixture();
    const appended = await appendAndApply(root, events.issued);
    const repeated = await createAppendOnlyEventStore().planAppend(root, events.issued);
    if (!repeated.ok) throw new Error(JSON.stringify(repeated.issues));
    expect(repeated.value.relative_path).toBe(eventPath(appended));
    expect(repeated.warnings).toMatchObject([{ code: "event.already_appended" }]);
  });

  it("detects canonical payload mutation", async () => {
    const root = await temporaryRoot();
    const events = await fixture();
    const issued = await appendAndApply(root, events.issued);
    await appendAndApply(root, events.heartbeat);
    const target = new URL(eventPath(issued), root);
    const tampered = {
      ...issued,
      payload: { ...issued.payload, status: "tampered" },
    };
    await writeFile(target, canonicalJson(tampered), "utf8");
    const verification = await createAppendOnlyEventStore().verifyChain(
      root,
      issued.aggregate_id,
    );
    expect(verification).toMatchObject({
      ok: false,
      issues: [{ code: "event.hash_mismatch" }],
    });
  });

  it("detects deletion inside a sequence", async () => {
    const root = await temporaryRoot();
    const events = await fixture();
    await appendAndApply(root, events.issued);
    const heartbeat = await appendAndApply(root, events.heartbeat);
    await appendAndApply(root, events.renewed);
    await unlink(new URL(eventPath(heartbeat), root));
    const verification = await createAppendOnlyEventStore().verifyChain(
      root,
      events.issued.aggregate_id,
    );
    expect(verification).toMatchObject({
      ok: false,
      issues: [{ code: "event.sequence_gap" }],
    });
  });

  it("rejects an unsafe aggregate path before planning bytes", async () => {
    const root = await temporaryRoot();
    const events = await fixture();
    const unsafe = { ...events.issued, aggregate_id: "../../outside" };
    expect(await createAppendOnlyEventStore().planAppend(root, unsafe)).toMatchObject({
      ok: false,
      issues: [{ code: "event.aggregate_id_unsafe" }],
    });
  });
});

describe("event-chain verification and effective state", () => {
  it("detects a changed prior hash even when the event body hash is recomputed", async () => {
    const events = await fixture();
    const chain = signedChain([events.issued, events.heartbeat]);
    const second = chain[1];
    if (second === undefined) throw new Error("fixture chain missing second event");
    const { event_hash: ignored, ...body } = second;
    void ignored;
    const changedBody = { ...body, previous_event_hash: "f".repeat(64) };
    const changed = {
      ...changedBody,
      event_hash: sha256(canonicalJson(changedBody)),
    } as GovernanceEvent;
    expect(verifyEventChain([chain[0] as GovernanceEvent, changed])).toMatchObject({
      ok: false,
      issues: [{ code: "event.previous_hash_mismatch" }],
    });
  });

  it("projects supported claim transitions while retaining unknown history", async () => {
    const events = await fixture();
    const chain = signedChain([
      events.issued,
      events.heartbeat,
      events.renewed,
      events.unknown,
      events.expired,
    ]);
    const projected = projectEffectiveState(chain);
    if (!projected.ok) throw new Error(JSON.stringify(projected.issues));
    expect(projected.value.history).toHaveLength(5);
    expect(projected.value.applied_event_hashes).toHaveLength(4);
    expect(projected.value.unknown_event_hashes).toEqual([chain[3]?.event_hash]);
    expect(projected.value.state.claim).toMatchObject({
      status: "expired",
      expires_at: "2026-07-14T15:00:00.000Z",
      heartbeat_at: "2026-07-14T14:05:00.000Z",
      expired_at: "2026-07-14T15:00:00.000Z",
    });
  });

  it("rejects a known transition without its required predecessor", async () => {
    const events = await fixture();
    const projected = projectEffectiveState(signedChain([events.heartbeat]));
    expect(projected).toMatchObject({
      ok: false,
      issues: [{ code: "event.transition_invalid" }],
    });
  });

  it("pins the exact supported transition vocabulary", () => {
    expect(SUPPORTED_EVENT_TRANSITIONS).toEqual([
      "bootstrap_initialized",
      "record_created",
      "record_superseded",
      "status_changed",
      "claim_issued",
      "claim_heartbeat",
      "claim_renewed",
      "claim_expired",
      "integration_validated",
      "integrated_verified",
      "lease_taken_over",
      "satellite_prepared",
      "hub_finalized",
    ]);
  });
});
