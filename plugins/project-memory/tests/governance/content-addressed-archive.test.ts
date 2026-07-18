import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  FixedClock,
  PROJECT_SCHEMA_REGISTRARS,
  canonicalJson,
  canonicalMutationPlanHash,
  registerProjectSchemas,
  sha256,
} from "../../src/index.js";
import type { ArchiveManifest } from "../../src/governance/contracts/index.js";
import {
  archiveManifestPath,
  archiveObjectPath,
  createArchiveStore,
  type ArchiveIngestInput,
  type ArchivePlan,
} from "../../src/governance/archive/content-addressed-archive.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const NOW = new Date("2026-07-14T14:00:00.000Z");
const roots: string[] = [];

function input(
  bytes: Uint8Array,
  overrides: Partial<ArchiveIngestInput> = {},
): ArchiveIngestInput {
  return {
    root_id: "ROOT-01J00000000000000000000030",
    target_ref: "refs/heads/main",
    expected_head: "1".repeat(40),
    profile_lock_hash: "a".repeat(64),
    actor_id: "pitaji",
    object_kind: "session-completion",
    media_type: "application/json",
    source_refs: ["TASK-01J00000000000000000000030"],
    bytes,
    ...overrides,
  };
}

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(new URL(`../fixtures/governance/archive/${name}`, import.meta.url)),
  );
}

function store() {
  return createArchiveStore({ clock: new FixedClock(NOW) });
}

function mustPlan(result: ReturnType<ReturnType<typeof store>["planIngest"]>): ArchivePlan {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function plannedWrite(plan: ArchivePlan, relativePath: string) {
  const write = plan.writes.find((candidate) => candidate.relative_path === relativePath);
  if (write === undefined) throw new Error(`missing planned write: ${relativePath}`);
  return write;
}

function manifestFrom(plan: ArchivePlan): ArchiveManifest {
  const write = plannedWrite(plan, plan.metadata.manifest_path);
  return JSON.parse(new TextDecoder().decode(write.bytes)) as ArchiveManifest;
}

async function temporaryRoot(): Promise<URL> {
  const directory = await mkdtemp(path.join(tmpdir(), "project-memory-archive-"));
  roots.push(directory);
  return pathToFileURL(`${directory}${path.sep}`);
}

async function applyPlan(root: URL, plan: ArchivePlan): Promise<void> {
  for (const write of plan.writes) {
    expect(write.mode).toBe("create");
    const target = path.join(fileURLToPath(root), ...write.relative_path.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, write.bytes, { flag: "wx" });
  }
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

describe("redacted content-addressed archive planning", () => {
  it("deduplicates identical redacted bytes without mutating a repository", async () => {
    const bytes = await fixture("clean-session.json");
    const first = mustPlan(store().planIngest(input(bytes)));
    const second = mustPlan(store().planIngest(input(bytes)));

    expect(first.metadata.object_hash).toBe(second.metadata.object_hash);
    expect(first.metadata.object_path).toBe(second.metadata.object_path);
    expect(first.metadata.manifest_hash).toBe(second.metadata.manifest_hash);
    expect(first.writes).toEqual(second.writes);
    expect(first.metadata.object_hash).toBe(sha256(bytes));
    expect(first.metadata.object_path).toBe(
      `docs/project-memory/archive/objects/sha256/${sha256(bytes).slice(0, 2)}/${sha256(bytes)}`,
    );
  });

  it("redacts credentials, bearer tokens, URI credentials, and PEM keys", () => {
    const credential = "synthetic-test-credential-value";
    const bearerToken = "synthetic.bearer.token.value";
    const uriPassword = "synthetic-password";
    const privateKeyBody = "c3ludGhldGljLXRlc3Qta2V5";
    const privateKeyBegin = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
    const privateKeyEnd = ["-----END ", "PRIVATE KEY-----"].join("");
    const source = new TextEncoder().encode([
      "api_key=" + credential,
      "Authorization: Bearer " + bearerToken,
      "database_uri=postgres://alice:" + uriPassword + "@db.example.test/project",
      privateKeyBegin,
      privateKeyBody,
      privateKeyEnd,
    ].join("\n"));
    const plan = mustPlan(
      store().planIngest(input(source, { media_type: "text/plain" })),
    );
    const stored = new TextDecoder().decode(
      plannedWrite(plan, plan.metadata.object_path).bytes,
    );

    expect(stored).not.toContain(credential);
    expect(stored).not.toContain(bearerToken);
    expect(stored).not.toContain(uriPassword);
    expect(stored).not.toContain(privateKeyBody);
    expect(stored).toContain("[REDACTED:credential-value:");
    expect(stored).toContain("[REDACTED:bearer-token:");
    expect(stored).toContain("[REDACTED:uri-credential:");
    expect(stored).toContain("[REDACTED:pem-private-key:");
    expect(plan.metadata.redaction_report).toEqual({
      redacted: true,
      rule_ids: [
        "bearer-token",
        "credential-value",
        "pem-private-key",
        "uri-credential",
      ],
      replacement_count: 4,
      review_required: false,
    });
    expect(plan.metadata.source_hash).toBe(sha256(source));
    expect(plan.metadata.object_hash).toBe(
      sha256(plannedWrite(plan, plan.metadata.object_path).bytes),
    );
  });

  it("redacts quoted JSON credential assignments without corrupting JSON", () => {
    const source = new TextEncoder().encode(
      JSON.stringify({
        api_key: "a",
        token: "token-value",
        client_secret: "secret value with spaces",
        password: "p@ssw0rd",
        nested: { access_token: "nested-token" },
      }),
    );
    const plan = mustPlan(store().planIngest(input(source)));
    const stored = new TextDecoder().decode(
      plannedWrite(plan, plan.metadata.object_path).bytes,
    );
    const parsed = JSON.parse(stored) as Record<string, unknown>;

    expect(stored).not.toContain("token-value");
    expect(stored).not.toContain("secret value with spaces");
    expect(stored).not.toContain("p@ssw0rd");
    expect(Object.values(parsed).join(" ")).not.toContain('"a"');
    expect(plan.metadata.redaction_report).toMatchObject({
      rule_ids: ["credential-value"],
      replacement_count: 5,
    });
  });

  it("redacts encrypted PEM private-key blocks", () => {
    const source = new TextEncoder().encode(
      [
        ["-----BEGIN ", "ENCRYPTED PRIVATE KEY-----"].join(""),
        "c3ludGhldGljLWVuY3J5cHRlZC10ZXN0LWtleQ==",
        ["-----END ", "ENCRYPTED PRIVATE KEY-----"].join(""),
      ].join("\n"),
    );
    const plan = mustPlan(
      store().planIngest(input(source, { media_type: "text/plain" })),
    );
    const stored = new TextDecoder().decode(
      plannedWrite(plan, plan.metadata.object_path).bytes,
    );

    expect(stored).not.toContain("c3ludGhldGljLWVuY3J5cHRlZC10ZXN0LWtleQ==");
    expect(stored).toContain("[REDACTED:pem-private-key:");
  });
  it("creates append-only object and manifest writes with self-verifying hashes", async () => {
    const source = await fixture("clean-session.json");
    const plan = mustPlan(store().planIngest(input(source)));
    const objectWrite = plannedWrite(plan, plan.metadata.object_path);
    const manifestWrite = plannedWrite(plan, plan.metadata.manifest_path);
    const manifest = manifestFrom(plan);
    const { manifest_hash: ignored, ...manifestBody } = manifest;
    void ignored;

    expect(objectWrite).toMatchObject({
      relative_path: archiveObjectPath(plan.metadata.object_hash),
      expected_existing_sha256: null,
      mode: "create",
    });
    expect(manifestWrite).toMatchObject({
      relative_path: archiveManifestPath(plan.metadata.manifest_hash),
      expected_existing_sha256: null,
      mode: "create",
    });
    expect(manifest).toMatchObject({
      source_hash: sha256(source),
      stored_hash: sha256(objectWrite.bytes),
      object_path: objectWrite.relative_path,
      actor_id: "pitaji",
      created_at: NOW.toISOString(),
    });
    expect(manifest.manifest_hash).toBe(sha256(canonicalJson(manifestBody)));
    const { plan_hash: planHash, ...withoutHash } = plan;
    expect(planHash).toBe(canonicalMutationPlanHash(withoutHash));
  });

  it("deduplicates an object while preserving distinct append-only manifests", async () => {
    const source = await fixture("clean-session.json");
    const first = mustPlan(store().planIngest(input(source)));
    const second = mustPlan(
      store().planIngest(
        input(source, { source_refs: ["TASK-01J00000000000000000000031"] }),
      ),
    );

    expect(second.metadata.object_hash).toBe(first.metadata.object_hash);
    expect(second.metadata.object_path).toBe(first.metadata.object_path);
    expect(second.metadata.manifest_hash).not.toBe(first.metadata.manifest_hash);
    expect(second.metadata.manifest_path).not.toBe(first.metadata.manifest_path);
  });

  it("refuses incomplete secret material that cannot be safely bounded", () => {
    const source = new TextEncoder().encode(
      ["-----BEGIN ", "PRIVATE KEY-----\ntruncated-secret-material"].join(""),
    );
    expect(store().planIngest(input(source))).toMatchObject({
      ok: false,
      issues: [{ code: "archive.review_required" }],
    });
  });
});

describe("content-addressed archive verification", () => {
  it("verifies canonical manifest and stored-object bytes", async () => {
    const root = await temporaryRoot();
    const plan = mustPlan(store().planIngest(input(await fixture("clean-session.json"))));
    await applyPlan(root, plan);

    const result = await store().verify(root, plan.metadata.manifest_hash);
    expect(result).toMatchObject({
      ok: true,
      value: {
        object_hash: plan.metadata.object_hash,
        manifest_hash: plan.metadata.manifest_hash,
      },
    });
  });

  it("detects changed content-addressed object bytes", async () => {
    const root = await temporaryRoot();
    const plan = mustPlan(store().planIngest(input(await fixture("clean-session.json"))));
    await applyPlan(root, plan);
    await writeFile(new URL(plan.metadata.object_path, root), "tampered", "utf8");

    expect(await store().verify(root, plan.metadata.manifest_hash)).toMatchObject({
      ok: false,
      issues: [{ code: "archive.object_hash_mismatch" }],
    });
  });

  it("detects changed manifest bytes", async () => {
    const root = await temporaryRoot();
    const plan = mustPlan(store().planIngest(input(await fixture("clean-session.json"))));
    await applyPlan(root, plan);
    const manifest = manifestFrom(plan);
    await writeFile(
      new URL(plan.metadata.manifest_path, root),
      canonicalJson({ ...manifest, actor_id: "worker-a" }),
      "utf8",
    );

    expect(await store().verify(root, plan.metadata.manifest_hash)).toMatchObject({
      ok: false,
      issues: [{ code: "archive.manifest_hash_mismatch" }],
    });
  });

  it("rejects an unsafe manifest identifier before resolving a path", async () => {
    const root = await temporaryRoot();
    expect(await store().verify(root, "../../outside")).toMatchObject({
      ok: false,
      issues: [{ code: "archive.manifest_hash_invalid" }],
    });
    await expect(lstat(path.join(fileURLToPath(root), "outside"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
