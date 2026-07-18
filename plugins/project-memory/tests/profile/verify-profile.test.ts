import {
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

import { emitGeneratedYaml } from "../../src/core/document-io.js";
import { applyFileTransaction } from "../../src/core/file-transaction.js";
import { sha256 } from "../../src/core/hash.js";
import { renderAdapters } from "../../src/materialize/render-adapters.js";
import { profileLockHash } from "../../src/profile/build-profile-lock.js";
import type {
  ProfileCanonicalMutationPlan,
  ProfileLock,
} from "../../src/profile/contracts/index.js";
import { createProfileVerifier } from "../../src/profile/verify-profile.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import { compileProductionProfilePlan } from "../helpers/production-profile-plan.js";

const PROJECT_SOURCE_PATH = "docs/project-memory/source/PROJECT.md";
const PROFILE_LOCK_PATH = "docs/project-memory/profile.lock.yaml";
const CONFIG_PATH = "tools/project-memory/config.json";

let plan: ProfileCanonicalMutationPlan;
let root: URL;
const roots: URL[] = [];

function registerSchemas(): void {
  resetSchemaRegistryForTests();
  const result = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
}

async function temporaryRoot(): Promise<URL> {
  const directory = await mkdtemp(path.join(tmpdir(), "project-memory-verify-"));
  const value = pathToFileURL(`${directory}${path.sep}`);
  roots.push(value);
  return value;
}

function target(relativePath: string): string {
  return path.join(fileURLToPath(root), ...relativePath.split("/"));
}

async function overwrite(relativePath: string, bytes: Uint8Array | string) {
  const destination = target(relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}

async function bytes(relativePath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(target(relativePath)));
}

function withUpdatedSourceHash(
  original: ProfileLock,
  relativePath: string,
  nextHash: string,
): ProfileLock {
  const { lock_hash: _oldHash, ...originalWithoutHash } = original;
  void _oldHash;
  const withoutHash: Omit<ProfileLock, "lock_hash"> = {
    ...originalWithoutHash,
    accepted_source_entries: original.accepted_source_entries.map((entry) =>
      entry.target_path === relativePath ? { ...entry, sha256: nextHash } : entry,
    ),
  };
  return { ...withoutHash, lock_hash: profileLockHash(withoutHash) };
}

beforeAll(async () => {
  registerSchemas();
  ({ plan } = await compileProductionProfilePlan());
});

beforeEach(async () => {
  registerSchemas();
  root = await temporaryRoot();
  const staged = await applyFileTransaction(root, plan.writes);
  if (!staged.ok) throw new Error(JSON.stringify(staged.issues));
});

afterAll(async () => {
  resetSchemaRegistryForTests();
  await Promise.all(
    roots.map((entry) => rm(fileURLToPath(entry), { recursive: true, force: true })),
  );
});

describe("target-only profile verification", () => {
  it("verifies a staged profile without any catalog-release dependency", async () => {
    const verifier = createProfileVerifier();
    const result = await verifier.verify(root);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value).toMatchObject({
      valid: true,
      root_id: plan.root_id,
      profile_lock_hash: plan.profile_lock_hash,
      selected_catalog_lock_hash:
        plan.metadata.selected_catalog_lock.lock_hash,
      external_reads: [],
    });
    expect(result.value.checked_paths).toContain(PROJECT_SOURCE_PATH);
    expect(Object.keys(verifier)).toEqual(["verify"]);
  });

  it("rejects tampered vendored catalog bytes", async () => {
    const entry = plan.metadata.selected_catalog_lock.entries.find(
      (candidate) => candidate.kind !== "generated-schema",
    );
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    await overwrite(entry.target_path, "tampered catalog\n");
    const result = await createProfileVerifier().verify(root);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "SELECTED_CATALOG_TARGET_LENGTH_MISMATCH" }],
    });
  });

  it("rejects tampered vendored schema bytes", async () => {
    const entry = plan.metadata.selected_catalog_lock.entries.find(
      (candidate) => candidate.kind === "generated-schema",
    );
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    await overwrite(entry.target_path, "{}\n");
    const result = await createProfileVerifier().verify(root);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "SELECTED_CATALOG_TARGET_LENGTH_MISMATCH" }],
    });
  });

  it("rejects unlisted bytes in compiler-owned catalog namespaces", async () => {
    await overwrite(
      "docs/project-memory/catalog/selected/unlisted.yaml",
      "unlisted: true\n",
    );
    const result = await createProfileVerifier().verify(root);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "SELECTED_CATALOG_UNLISTED_TARGET" }],
    });
  });

  it("rejects noncanonical or self-inconsistent profile-lock bytes", async () => {
    const current = await bytes(PROFILE_LOCK_PATH);
    await overwrite(
      PROFILE_LOCK_PATH,
      new TextEncoder().encode(`${new TextDecoder().decode(current)}\n`),
    );
    const result = await createProfileVerifier().verify(root);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_LOCK_NONCANONICAL" }],
    });
  });

  it("rejects accepted source body tampering by its locked hash", async () => {
    const current = await bytes(PROJECT_SOURCE_PATH);
    await overwrite(
      PROJECT_SOURCE_PATH,
      new TextEncoder().encode(`${new TextDecoder().decode(current)}tampered\n`),
    );
    const result = await createProfileVerifier().verify(root);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_SOURCE_HASH_MISMATCH" }],
    });
  });

  it("reparses canonical envelopes even when their altered hash is relocked", async () => {
    const current = await bytes(PROJECT_SOURCE_PATH);
    const malformed = new TextEncoder().encode(
      new TextDecoder().decode(current).replace("type: project", "type: component"),
    );
    await overwrite(PROJECT_SOURCE_PATH, malformed);
    const nextLock = withUpdatedSourceHash(
      plan.metadata.profile_lock,
      PROJECT_SOURCE_PATH,
      sha256(malformed),
    );
    const emitted = emitGeneratedYaml(nextLock);
    if (!emitted.ok) throw new Error(JSON.stringify(emitted.issues));
    await overwrite(PROFILE_LOCK_PATH, emitted.value);

    const result = await createProfileVerifier().verify(root);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "CANONICAL_MARKDOWN_ID_PREFIX" }],
    });
  });


  it("accepts a preserved user instruction file only with its exact review proposal", async () => {
    const existing = new Uint8Array(
      await readFile(
        new URL("../fixtures/materialize/existing-agents.md", import.meta.url),
      ),
    );
    await overwrite("AGENTS.md", existing);
    const withoutProposal = await createProfileVerifier().verify(root);
    expect(withoutProposal.ok).toBe(false);
    const rendered = renderAdapters(plan.metadata.profile, {
      files: new Map([["AGENTS.md", existing]]),
    });
    if (!rendered.ok) throw new Error(JSON.stringify(rendered.issues));
    const proposal = rendered.value.find((write) =>
      write.relative_path.startsWith(
        "docs/project-memory/catalog/proposals/adapter-existing-file-agents-",
      ),
    );
    expect(proposal).toBeDefined();
    if (proposal === undefined) return;
    await overwrite(proposal.relative_path, proposal.bytes);

    const result = await createProfileVerifier().verify(root);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.checked_paths).toContain(proposal.relative_path);
    expect(result.value.external_reads).toEqual([]);
  });
  it("rejects tampered compiler-owned adapter configuration", async () => {
    await overwrite(CONFIG_PATH, "{}\n");
    const result = await createProfileVerifier().verify(root);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_ADAPTER_ARTIFACT_MISMATCH" }],
    });
  });
});
