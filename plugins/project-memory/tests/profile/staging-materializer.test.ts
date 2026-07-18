import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { canonicalMutationPlanHash } from "../../src/contracts/canonical-mutation-plan.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../../src/contracts/runtime-result.js";
import { FixedClock } from "../../src/core/clock.js";
import {
  NodeTransactionFileSystem,
  type TransactionFileSystem,
} from "../../src/core/file-transaction.js";
import { sha256 } from "../../src/core/hash.js";
import {
  createProfileMaterializer,
  type StagingCapability,
  type StagingCapabilityVerifier,
  type StagingGitInspector,
  type StagingWorktreeDescriptor,
} from "../../src/profile/materialize-to-isolated-staging.js";
import type { ProfileCanonicalMutationPlan } from "../../src/profile/contracts/index.js";
import { createProfileVerifier } from "../../src/profile/verify-profile.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import { compileProductionProfilePlan } from "../helpers/production-profile-plan.js";

const NOW = new Date("2026-07-15T04:30:00.000Z");

class FakeGitInspector implements StagingGitInspector {
  readonly inspect_calls: URL[] = [];
  readonly commit_calls: string[] = [];
  readonly ref_update_calls: string[] = [];

  constructor(public descriptor: StagingWorktreeDescriptor) {}

  inspectWorktree(
    root: URL,
  ): Promise<RuntimeResult<StagingWorktreeDescriptor>> {
    this.inspect_calls.push(root);
    return Promise.resolve(success(this.descriptor));
  }
}

class FakeCapabilityVerifier implements StagingCapabilityVerifier {
  readonly calls: StagingCapability[] = [];

  constructor(private readonly accepted = true) {}

  verify(capability: StagingCapability): Promise<RuntimeResult<true>> {
    this.calls.push(capability);
    return Promise.resolve(
      this.accepted
        ? success(true)
        : failure(
            "PROFILE_STAGING_CAPABILITY_UNTRUSTED",
            "test capability is not authentic",
          ),
    );
  }
}

class FailSecondCommitFileSystem implements TransactionFileSystem {
  readonly delegate = new NodeTransactionFileSystem();
  #stagedRenames = 0;
  #failed = false;

  readFile(file: URL) {
    return this.delegate.readFile(file);
  }
  writeFile(file: URL, bytes: Uint8Array) {
    return this.delegate.writeFile(file, bytes);
  }
  mkdir(directory: URL) {
    return this.delegate.mkdir(directory);
  }
  async rename(from: URL, to: URL): Promise<void> {
    if (from.pathname.includes("/staged/") && !this.#failed) {
      this.#stagedRenames += 1;
      if (this.#stagedRenames === 2) {
        this.#failed = true;
        throw new Error("injected mid-transaction failure");
      }
    }
    await this.delegate.rename(from, to);
  }
  remove(target: URL) {
    return this.delegate.remove(target);
  }
  exists(target: URL) {
    return this.delegate.exists(target);
  }
  list(directory: URL) {
    return this.delegate.list(directory);
  }
  syncFile(file: URL) {
    return this.delegate.syncFile(file);
  }
}

let plan: ProfileCanonicalMutationPlan;
let root: URL;
let git: FakeGitInspector;
let capabilities: FakeCapabilityVerifier;
const roots: URL[] = [];

function registerSchemas(): void {
  resetSchemaRegistryForTests();
  const result = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
}

async function temporaryRoot(): Promise<URL> {
  const directory = await mkdtemp(path.join(tmpdir(), "project-memory-stage-"));
  const value = pathToFileURL(`${directory}${path.sep}`);
  roots.push(value);
  return value;
}

function descriptor(
  overrides: Partial<StagingWorktreeDescriptor> = {},
): StagingWorktreeDescriptor {
  return {
    root: root.href,
    head: plan.expected_head,
    linked_worktree: true,
    detached: true,
    coordinator_created: true,
    clean: true,
    dirty_paths: [],
    ...overrides,
  };
}

function capability(
  targetPlan = plan,
  overrides: Partial<StagingCapability> = {},
): StagingCapability {
  return {
    capability_id: "CAP-01J00000000000000000000000",
    authority: "integration-coordinator",
    plan_id: targetPlan.plan_id,
    plan_hash: targetPlan.plan_hash,
    staging_root: root.href,
    expires_at: "2026-07-15T05:00:00.000Z",
    proof: "test-authenticity-proof",
    ...overrides,
  };
}

function rehash(
  original: ProfileCanonicalMutationPlan,
  writes: ProfileCanonicalMutationPlan["writes"],
): ProfileCanonicalMutationPlan {
  const { plan_hash: _oldHash, ...withoutHash } = { ...original, writes };
  void _oldHash;
  return {
    ...withoutHash,
    plan_hash: canonicalMutationPlanHash(withoutHash),
  };
}

function dependencies(
  overrides: Partial<Parameters<typeof createProfileMaterializer>[0]> = {},
) {
  return {
    git,
    capabilities,
    verifier: createProfileVerifier(),
    clock: new FixedClock(NOW),
    ...overrides,
  };
}

async function exists(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(fileURLToPath(root), ...relativePath.split("/")));
    return true;
  } catch {
    return false;
  }
}

async function assertNoPlannedFiles(targetPlan = plan): Promise<void> {
  const values = await Promise.all(
    targetPlan.writes.map((write) => exists(write.relative_path)),
  );
  expect(values.some(Boolean)).toBe(false);
}

beforeAll(async () => {
  registerSchemas();
  ({ plan } = await compileProductionProfilePlan());
});

beforeEach(async () => {
  registerSchemas();
  root = await temporaryRoot();
  git = new FakeGitInspector(descriptor());
  capabilities = new FakeCapabilityVerifier();
});

afterAll(async () => {
  resetSchemaRegistryForTests();
  await Promise.all(
    roots.map((entry) => rm(fileURLToPath(entry), { recursive: true, force: true })),
  );
});

describe("capability-checked isolated staging", () => {
  it("rejects a canonical or ordinary working tree without touching bytes", async () => {
    git.descriptor = descriptor({ linked_worktree: false, detached: false });
    const result = await createProfileMaterializer(dependencies())
      .materializeToIsolatedStaging({
        staging_root: root,
        expected_staging_head: plan.expected_head,
        capability: capability(),
        plan,
      });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_STAGING_WORKTREE_REQUIRED" }],
    });
    await assertNoPlannedFiles();
  });

  it("rejects head drift and unrelated dirty state", async () => {
    git.descriptor = descriptor({ head: "2".repeat(40) });
    const materializer = createProfileMaterializer(dependencies());
    const drift = await materializer.materializeToIsolatedStaging({
      staging_root: root,
      expected_staging_head: plan.expected_head,
      capability: capability(),
      plan,
    });
    expect(drift).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_STAGING_HEAD_DRIFT" }],
    });

    await writeFile(path.join(fileURLToPath(root), "unrelated.txt"), "dirty\n");
    git.descriptor = descriptor({ clean: false, dirty_paths: ["unrelated.txt"] });
    const dirty = await materializer.materializeToIsolatedStaging({
      staging_root: root,
      expected_staging_head: plan.expected_head,
      capability: capability(),
      plan,
    });
    expect(dirty).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_STAGING_DIRTY" }],
    });
  });

  it("rejects expired, mismatched, or unauthenticated capabilities", async () => {
    const materializer = createProfileMaterializer(dependencies());
    const expired = await materializer.materializeToIsolatedStaging({
      staging_root: root,
      expected_staging_head: plan.expected_head,
      capability: capability(plan, { expires_at: "2026-07-15T04:00:00.000Z" }),
      plan,
    });
    expect(expired).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_STAGING_CAPABILITY_EXPIRED" }],
    });

    const mismatch = await materializer.materializeToIsolatedStaging({
      staging_root: root,
      expected_staging_head: plan.expected_head,
      capability: capability(plan, { plan_hash: "f".repeat(64) }),
      plan,
    });
    expect(mismatch).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_STAGING_CAPABILITY_MISMATCH" }],
    });

    capabilities = new FakeCapabilityVerifier(false);
    const untrusted = await createProfileMaterializer(dependencies())
      .materializeToIsolatedStaging({
        staging_root: root,
        expected_staging_head: plan.expected_head,
        capability: capability(),
        plan,
      });
    expect(untrusted).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_STAGING_CAPABILITY_UNTRUSTED" }],
    });
  });

  it("materializes and verifies without commit or ref-update capabilities", async () => {
    const materializer = createProfileMaterializer(dependencies());
    const result = await materializer.materializeToIsolatedStaging({
      staging_root: root,
      expected_staging_head: plan.expected_head,
      capability: capability(),
      plan,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value).toMatchObject({
      plan_id: plan.plan_id,
      plan_hash: plan.plan_hash,
      staging_head: plan.expected_head,
      verification: { valid: true, external_reads: [] },
    });
    for (const write of plan.writes) {
      const actual = new Uint8Array(
        await readFile(
          path.join(fileURLToPath(root), ...write.relative_path.split("/")),
        ),
      );
      expect(actual).toEqual(write.bytes);
    }
    expect(git.commit_calls).toEqual([]);
    expect(git.ref_update_calls).toEqual([]);
    expect(Object.keys(materializer)).toEqual(["materializeToIsolatedStaging"]);
  });

  it("rejects exact pre-image drift before changing any target", async () => {
    const config = plan.writes.find(
      (write) => write.relative_path === "tools/project-memory/config.json",
    );
    expect(config).toBeDefined();
    if (config === undefined) return;
    const actual = new TextEncoder().encode("actual preimage\n");

    const targetPath = path.join(
      fileURLToPath(root),
      ...config.relative_path.split("/"),
    );
    await mkdir(path.dirname(targetPath), { recursive: true });

    await writeFile(targetPath, actual);
    const changed = rehash(
      plan,
      plan.writes.map((write) =>
        write.relative_path === config.relative_path
          ? { ...write, expected_existing_sha256: sha256("expected preimage\n") }
          : write,
      ),
    );
    const result = await createProfileMaterializer(dependencies())
      .materializeToIsolatedStaging({
        staging_root: root,
        expected_staging_head: changed.expected_head,
        capability: capability(changed),
        plan: changed,
      });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "TRANSACTION_PRECONDITION_FAILED" }],
    });
    expect(new Uint8Array(await readFile(targetPath))).toEqual(actual);
  });

  it("rolls back a mid-transaction fault", async () => {
    const transactionClock = new FixedClock(NOW);
    const result = await createProfileMaterializer(
      dependencies({
        transaction: {
          fs: new FailSecondCommitFileSystem(),
          clock: transactionClock,
          ids: { next: () => "CHG-01J00000000000000000000000" },
        },
      }),
    ).materializeToIsolatedStaging({
      staging_root: root,
      expected_staging_head: plan.expected_head,
      capability: capability(),
      plan,
    });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "TRANSACTION_FAILED" }],
    });
    await assertNoPlannedFiles();
  });

  it("rolls back all bytes when post-write verification fails", async () => {
    const rejectingVerifier = {
      verify: () =>
        Promise.resolve(
          failure("TEST_PROFILE_INVALID", "injected verifier rejection"),
        ),
    };
    const result = await createProfileMaterializer(
      dependencies({ verifier: rejectingVerifier }),
    ).materializeToIsolatedStaging({
      staging_root: root,
      expected_staging_head: plan.expected_head,
      capability: capability(),
      plan,
    });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "TEST_PROFILE_INVALID" }],
    });
    await assertNoPlannedFiles();
  });

  it("is idempotent only for the exact already-staged plan", async () => {
    const materializer = createProfileMaterializer(dependencies());
    const input = {
      staging_root: root,
      expected_staging_head: plan.expected_head,
      capability: capability(),
      plan,
    };
    const first = await materializer.materializeToIsolatedStaging(input);
    if (!first.ok) throw new Error(JSON.stringify(first.issues));
    git.descriptor = descriptor({
      clean: false,
      dirty_paths: plan.writes.map((write) => write.relative_path),
    });
    const second = await materializer.materializeToIsolatedStaging(input);
    if (!second.ok) throw new Error(JSON.stringify(second.issues));
    expect(second.value.writes).toEqual(first.value.writes);
  });

  it("rejects any plan that targets the shared Git directory", async () => {
    const changed = rehash(plan, [
      ...plan.writes,
      {
        relative_path: ".git/config",
        bytes: new TextEncoder().encode("forbidden\n"),
        expected_existing_sha256: null,
        mode: "create" as const,
      },
    ]);
    const result = await createProfileMaterializer(dependencies())
      .materializeToIsolatedStaging({
        staging_root: root,
        expected_staging_head: changed.expected_head,
        capability: capability(changed),
        plan: changed,
      });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_STAGING_GIT_PATH_FORBIDDEN" }],
    });
    await assertNoPlannedFiles();
  });
});
