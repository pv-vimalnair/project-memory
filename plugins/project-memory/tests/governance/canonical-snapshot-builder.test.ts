import { execFile as execFileCallback } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PROJECT_SCHEMA_REGISTRARS,
  NodeCommandRunner,
  canonicalJson,
  planGuidedLegacyImport,
  sha256,
  registerProjectSchemas,
  success,
  type IdFactory,
} from "../../src/index.js";
import type {
  CanonicalRecord,
  UnsignedGovernanceEvent,
} from "../../src/governance/contracts/index.js";
import { eventPath } from "../../src/governance/events/append-only-event-store.js";
import { signEvent } from "../../src/governance/events/event-chain-verifier.js";
import { canonicalRecordPath } from "../../src/governance/records/record-path.js";
import {
  buildCanonicalSnapshot,
  createCanonicalSnapshotBuilder,
} from "../../src/governance/snapshot/canonical-snapshot-builder.js";
import {
  createRevisionTreeReader,
  type RevisionBlob,
  type RevisionTreeReader,
} from "../../src/governance/snapshot/revision-tree-reader.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const execFile = promisify(execFileCallback);
const DECISION_ID = "DEC-01J00000000000000000000010";
const roots: string[] = [];

interface SnapshotFixtureConfig {
  readonly profile_golden_case: string;
  readonly root_id: string;
  readonly approval_id: string;
}

interface ExactGoldenPayload {
  readonly exact_bytes: readonly {
    readonly relative_path: string;
    readonly bytes_base64: string;
  }[];
}

let repositoryPath = "";
let repository: URL;
let revision = "";
let config: SnapshotFixtureConfig;
let baseDecision: CanonicalRecord;

async function git(args: readonly string[]): Promise<string> {
  const result = await execFile("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
  });
  return result.stdout.trim();
}

async function writeRelative(
  relativePath: string,
  bytes: Uint8Array | string,
): Promise<void> {
  const target = path.join(repositoryPath, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

function includedGoldenPath(relativePath: string): boolean {
  return (
    relativePath === "docs/project-memory/project.yaml" ||
    relativePath === "docs/project-memory/profile.lock.yaml" ||
    relativePath === "docs/project-memory/catalog.lock.json" ||
    relativePath.startsWith("docs/project-memory/source/") ||
    relativePath.startsWith("docs/project-memory/components/") ||
    relativePath.startsWith("docs/project-memory/domains/")
  );
}

async function materializeGoldenProfile(): Promise<void> {
  const compressed = await readFile(
    new URL(
      `../fixtures/profile-golden/${config.profile_golden_case}/plan.bytes.snapshot.json.gz`,
      import.meta.url,
    ),
  );
  const payload = JSON.parse(gunzipSync(compressed).toString("utf8")) as ExactGoldenPayload;
  for (const entry of payload.exact_bytes) {
    if (!includedGoldenPath(entry.relative_path)) continue;
    await writeRelative(entry.relative_path, Buffer.from(entry.bytes_base64, "base64"));
  }
}

function canonicalRecord(
  id: string,
  type: "decision" | "approval",
): CanonicalRecord {
  const common = {
    status: "accepted" as const,
    root_id: config.root_id,
    component_ids: [],
    initiative_id: null,
    workstream_id: null,
    task_id: null,
    actor_id: "pitaji",
    authority_class: "pitaji" as const,
    created_at: "2026-07-15T04:00:00.000Z",
    original_base_revision: "0".repeat(40),
    integration_base_revision: "0".repeat(40),
    catalog_versions: ["1.0.0"],
    relationships: [],
  };
  return type === "approval"
    ? {
        ...common,
        id,
        type: "approval",
        title: "Approve profile bootstrap",
        payload: {
          approval_kind: "directional",
          granted_by: "Pitaji",
          target: config.root_id,
          environment: "repository",
          scope: ["profile.bootstrap"],
          timing: "before bootstrap",
          expires_at: null,
          invalidation_conditions: ["target changes"],
        },
      }
    : {
        ...common,
        id,
        type: "decision",
        title: "Keep exact snapshots",
        payload: {
          choice: "Read canonical state from exact Git objects",
          rationale: "Working-tree drift cannot change a requested revision",
          alternatives: ["Read mutable files"],
          consequences: ["Every snapshot is reproducible"],
        },
      };
}

async function addBaseGovernance(): Promise<void> {
  const approval = canonicalRecord(config.approval_id, "approval");
  baseDecision = canonicalRecord(DECISION_ID, "decision");
  await writeRelative(canonicalRecordPath(approval), canonicalJson(approval));
  await writeRelative(canonicalRecordPath(baseDecision), canonicalJson(baseDecision));

  const eventFixture = JSON.parse(
    await readFile(
      new URL("../fixtures/governance/events/claim-chain.json", import.meta.url),
      "utf8",
    ),
  ) as { readonly issued: UnsignedGovernanceEvent; readonly heartbeat: UnsignedGovernanceEvent };
  const issued = signEvent(eventFixture.issued, null);
  const heartbeat = signEvent(eventFixture.heartbeat, issued);
  await writeRelative(eventPath(issued), canonicalJson(issued));
  await writeRelative(eventPath(heartbeat), canonicalJson(heartbeat));
  await writeRelative("docs/project-memory/views/NOW.md", "manual generated view\n");
  await writeRelative(
    "docs/project-memory/archive/objects/sha256/00/ignored",
    "archived bytes\n",
  );
}

beforeEach(async () => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
  config = JSON.parse(
    await readFile(
      new URL(
        "../fixtures/governance/repositories/snapshot-root/fixture.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as SnapshotFixtureConfig;
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "project-memory-snapshot-"));
  roots.push(temporaryRoot);
  repositoryPath = path.join(temporaryRoot, "repo");
  repository = pathToFileURL(`${repositoryPath}${path.sep}`);
  await execFile("git", ["init", "-b", "main", repositoryPath], {
    cwd: temporaryRoot,
    encoding: "utf8",
  });
  await git(["config", "user.name", "Project Memory Test"]);
  await git(["config", "user.email", "project-memory@example.invalid"]);
  await git(["config", "core.autocrlf", "false"]);
  await materializeGoldenProfile();
  await addBaseGovernance();
  await git(["add", "docs/project-memory"]);
  await git(["commit", "-m", "snapshot fixture"]);
  revision = await git(["rev-parse", "HEAD"]);
});

afterEach(async () => {
  resetSchemaRegistryForTests();
  const target = roots.pop();
  if (target !== undefined) await rm(target, { recursive: true, force: true });
});

function builder() {
  return createCanonicalSnapshotBuilder(
    createRevisionTreeReader(new NodeCommandRunner()),
  );
}

describe("revision-pinned canonical snapshot", () => {
  it("builds typed truth and excludes generated views and archives", async () => {
    const result = await builder().build(repository, {
      kind: "commit",
      object_id: revision,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value).toMatchObject({
      source_revision: revision,
      source_kind: "commit",
      root_id: config.root_id,
      catalog_versions: ["1.0.0"],
    });
    expect(result.value.components.length).toBeGreaterThan(0);
    expect(result.value.domains.length).toBeGreaterThan(0);
    expect(result.value.records.map((record) => record.id)).toContain(DECISION_ID);
    expect(result.value.events).toHaveLength(2);
    expect(result.value.source_paths).toEqual([...result.value.source_paths].sort());
    expect(result.value.source_paths.some((value) => value.includes("/views/"))).toBe(false);
    expect(result.value.source_paths.some((value) => value.includes("/archive/"))).toBe(false);
  });

  it("ignores dirty working-tree bytes for a requested commit", async () => {
    const first = await builder().build(repository, { kind: "commit", object_id: revision });
    if (!first.ok) throw new Error(JSON.stringify(first.issues));
    await writeRelative("docs/project-memory/source/PROJECT.md", "uncommitted edit\n");
    const repeated = await builder().build(repository, {
      kind: "commit",
      object_id: revision,
    });
    if (!repeated.ok) throw new Error(JSON.stringify(repeated.issues));
    expect(repeated.value.source_hashes).toEqual(first.value.source_hashes);
    expect(repeated.value.source_revision).toBe(revision);
  });

  it("reads an exact staged tree without changing the commit snapshot", async () => {
    const proposed = {
      ...baseDecision,
      id: "DEC-01J00000000000000000000011",
      title: "Proposed staged decision",
      status: "proposed",
      actor_id: "worker-a",
      authority_class: "worker",
    } as CanonicalRecord;
    await writeRelative(canonicalRecordPath(proposed), canonicalJson(proposed));
    await git(["add", canonicalRecordPath(proposed)]);
    const tree = await git(["write-tree"]);
    const staged = await builder().build(repository, { kind: "tree", object_id: tree });
    const committed = await builder().build(repository, {
      kind: "commit",
      object_id: revision,
    });
    if (!staged.ok || !committed.ok) throw new Error("snapshot build failed");
    expect(staged.value.records).toHaveLength(committed.value.records.length + 1);
    expect(committed.value.records.some((record) => record.id === proposed.id)).toBe(false);
  });

  it("rejects missing revisions and objects of the wrong kind", async () => {
    expect(
      await builder().build(repository, {
        kind: "commit",
        object_id: "f".repeat(40),
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "snapshot.revision_not_found" }],
    });
    const blob = await git([
      "rev-parse",
      "HEAD:docs/project-memory/source/PROJECT.md",
    ]);
    expect(
      await builder().build(repository, { kind: "commit", object_id: blob }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "snapshot.revision_type_mismatch" }],
    });
  });

  it("rejects committed accepted-source drift", async () => {
    await writeRelative("docs/project-memory/source/PROJECT.md", "committed drift\n");
    await git(["add", "docs/project-memory/source/PROJECT.md"]);
    await git(["commit", "-m", "stale source"]);
    const staleRevision = await git(["rev-parse", "HEAD"]);
    expect(
      await builder().build(repository, { kind: "commit", object_id: staleRevision }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "snapshot.profile_source_hash_mismatch" }],
    });
  });

  it("rejects a schema-invalid canonical record", async () => {
    const invalidPath =
      "docs/project-memory/records/decisions/DEC-01J00000000000000000000012.json";
    await writeRelative(invalidPath, canonicalJson({}));
    await git(["add", invalidPath]);
    await git(["commit", "-m", "invalid record"]);
    const invalidRevision = await git(["rev-parse", "HEAD"]);
    const invalid = await builder().build(repository, {
      kind: "commit",
      object_id: invalidRevision,
    });
    expect(invalid).toMatchObject({
      ok: false,
      issues: [{ code: "snapshot.record_schema_invalid" }],
    });
  });

  it("rejects an active relationship whose only target is archived", async () => {
    const dependent = {
      ...baseDecision,
      id: "DEC-01J00000000000000000000013",
      relationships: [
        {
          type: "evidences",
          target_id: "EVD-01J00000000000000000000013",
          note: "archive-only evidence is not current truth",
        },
      ],
    } as CanonicalRecord;
    await writeRelative(canonicalRecordPath(dependent), canonicalJson(dependent));
    await writeRelative(
      "docs/project-memory/archive/objects/sha256/00/archive-evidence",
      "EVD-01J00000000000000000000013\n",
    );
    await git(["add", "docs/project-memory"]);
    await git(["commit", "-m", "archive-only dependency"]);
    const head = await git(["rev-parse", "HEAD"]);
    expect(
      await builder().build(repository, { kind: "commit", object_id: head }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "snapshot.relationship_missing" }],
    });
  });

  it("rejects duplicate paths and manual view input from any reader", async () => {
    const view: RevisionBlob = {
      relative_path: "docs/project-memory/views/NOW.md",
      object_id: "1".repeat(40),
      bytes: new TextEncoder().encode("manual view\n"),
    };
    const viewReader: RevisionTreeReader = {
      readCanonicalBlobs: () => Promise.resolve(success([view])),
    };
    expect(
      await buildCanonicalSnapshot(
        repository,
        { kind: "commit", object_id: revision },
        viewReader,
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "snapshot.forbidden_truth_source" }],
    });

    const duplicateBlob: RevisionBlob = {
      ...view,
      relative_path: "docs/project-memory/project.yaml",
    };
    const duplicateReader: RevisionTreeReader = {
      readCanonicalBlobs: () =>
        Promise.resolve(success([duplicateBlob, duplicateBlob])),
    };
    const duplicate = await buildCanonicalSnapshot(
      repository,
      { kind: "commit", object_id: revision },
      duplicateReader,
    );
    expect(duplicate).toMatchObject({
      ok: false,
      issues: [{ code: "snapshot.path_duplicate" }],
    });
  });

  it("parses schema-valid records produced by guided history import", async () => {
    const legacyBytes = new TextEncoder().encode("A repository finding was recorded.\n");
    let counter = 20;
    const ids: IdFactory = {
      next(prefix) {
        counter += 1;
        return `${prefix}-${String(counter).padStart(26, "0")}`;
      },
    };
    const planned = await planGuidedLegacyImport({
      root_id: config.root_id,
      target_ref: "refs/heads/main",
      expected_head: revision,
      profile_lock_hash: "2".repeat(64),
      catalog_version: "1.0.0",
      proposal_hash: "3".repeat(64),
      created_by: "codex",
      created_at: "2026-07-20T04:00:00.000Z",
      expires_at: "2026-07-20T05:00:00.000Z",
      sources: [{
        source_path: "LEGACY.md",
        source_sha256: sha256(legacyBytes),
        source_git_revision: revision,
        disposition: "import",
        rationale: "Preserve the reviewed finding.",
        facts: [{
          source_line_start: 1,
          source_line_end: 1,
          category: "finding",
          title: "Imported repository finding",
          statement: "A repository finding was recorded.",
          rationale: "The legacy source records the finding.",
          confidence: "high",
        }],
      }],
    }, {
      ids,
      read_source: () => Promise.resolve(success(legacyBytes)),
    });
    if (!planned.ok) throw new Error(JSON.stringify(planned.issues));
    for (const write of planned.value.writes.filter((item) =>
      item.relative_path.includes("/records/")
    )) {
      await writeRelative(write.relative_path, write.bytes);
    }
    await git(["add", "docs/project-memory/records"]);
    await git(["commit", "-m", "guided history records"]);
    const importedRevision = await git(["rev-parse", "HEAD"]);
    const snapshot = await builder().build(repository, {
      kind: "commit",
      object_id: importedRevision,
    });
    if (!snapshot.ok) throw new Error(JSON.stringify(snapshot.issues));
    expect(snapshot.value.records.map((record) => record.type)).toEqual(
      expect.arrayContaining(["evidence", "finding"]),
    );
  });
});
