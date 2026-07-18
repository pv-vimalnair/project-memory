import { lstat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createNodeAgentStartDependencies, startAgentSession } from "../../src/agent/index.js";
import type { CanonicalMutationPlan } from "../../src/contracts/canonical-mutation-plan.js";
import { failure, success, type RuntimeResult } from "../../src/contracts/runtime-result.js";
import { SystemClock, type Clock } from "../../src/core/clock.js";
import type { CommandRunner } from "../../src/contracts/command-runner.js";
import { NodeCommandRunner } from "../../src/core/command-runner.js";
import { sha256 } from "../../src/core/hash.js";
import { resolveInside } from "../../src/core/path-safety.js";
import { createLegacyImporter } from "../../src/import/index.js";
import { createProfileVerifier, type ProfileVerifier } from "../../src/profile/verify-profile.js";
import { createBootstrapFinalizer, createBootstrapMutationHooks } from "../../src/governance/integration/bootstrap-finalizer.js";
import {
  createCanonicalMutationCoordinator,
  type CanonicalMutationCoordinator,
  type CanonicalMutationRepositoryValidator,
  type MutationBindingValidator,
  type MutationReceipt,
  type PlanAuthorityValidator,
} from "../../src/governance/integration/canonical-mutation-finalizer.js";
import { createIntegrationCoordinator, type IntegrationCoordinator } from "../../src/governance/integration/integration-coordinator.js";
import { IntegrationGitCliClient } from "../../src/governance/integration/integration-git-client.js";
import { createIntegrationLeaseStore } from "../../src/governance/integration/integration-lease-store.js";
import type { SingleRepoFinalizer } from "../../src/governance/integration/single-repo-finalizer.js";
import { createCanonicalSnapshotBuilder } from "../../src/governance/snapshot/canonical-snapshot-builder.js";
import { createRevisionTreeReader } from "../../src/governance/snapshot/revision-tree-reader.js";
import type { CanonicalSnapshotBuilder } from "../../src/governance/snapshot/snapshot-contracts.js";
import { createViewGenerator } from "../../src/governance/views/generate-views.js";
import { createWorkLifecycleService } from "../../src/governance/work/work-lifecycle-service.js";
import { applyInitPlan } from "../../src/cli/init/apply-init-plan.js";
import { buildInitPlan } from "../../src/cli/init/build-init-plan.js";
import { createDefaultCommandRegistry } from "../../src/cli/command-registry.js";
import type { CommandRegistry } from "../../src/cli/command-registry.js";

export const TRUSTED_NODE_HOST_ADAPTER_MARKER = "test-owned-trusted-node-host-adapter-v1";

const TARGET_REF = "refs/heads/main";
const INTEGRATOR_ID = "project-memory-integrator";

function sameRoot(left: URL, right: URL): boolean {
  return left.protocol === "file:" && left.href === right.href;
}

async function currentSnapshot(
  repo: URL,
  git: IntegrationGitCliClient,
  snapshots: CanonicalSnapshotBuilder,
): Promise<Awaited<ReturnType<CanonicalSnapshotBuilder["build"]>>> {
  const head = await git.resolveRef(repo, TARGET_REF);
  return snapshots.build(repo, { kind: "commit", object_id: head });
}

async function verifyExactHashes(
  root: URL,
  expected: Readonly<Record<string, string>>,
): Promise<RuntimeResult<true>> {
  for (const [relativePath, digest] of Object.entries(expected)) {
    const target = await resolveInside(root, relativePath);
    if (!target.ok) return target;
    try {
      const stat = await lstat(target.value);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        return failure(
          "runtime.repository_artifact_unsafe",
          "coordinator artifacts must be regular files",
          relativePath,
        );
      }
      const actual = sha256(new Uint8Array(await readFile(target.value)));
      if (actual !== digest) {
        return failure(
          "runtime.repository_artifact_hash_mismatch",
          "coordinator artifact bytes do not match the recorded hash",
          relativePath,
          [digest, actual],
        );
      }
    } catch (error: unknown) {
      return failure(
        "runtime.repository_artifact_read_failed",
        error instanceof Error ? error.message : String(error),
        relativePath,
      );
    }
  }
  return success(true);
}

function createBindingValidator(
  fixedRepo: URL,
  git: IntegrationGitCliClient,
  profiles: ProfileVerifier,
): MutationBindingValidator {
  return {
    async verify(repo, plan) {
      if (!sameRoot(repo, fixedRepo) || plan.target_ref !== TARGET_REF) {
        return failure(
          "runtime.binding_root_mismatch",
          "mutation root and target ref must match the local runtime",
          repo.href,
        );
      }
      let head: string;
      try {
        head = await git.resolveRef(repo, TARGET_REF);
      } catch (error: unknown) {
        return failure(
          "runtime.binding_head_failed",
          error instanceof Error ? error.message : String(error),
          TARGET_REF,
        );
      }
      if (head !== plan.expected_head) {
        return failure("runtime.binding_head_drift", "mutation base no longer matches HEAD", TARGET_REF);
      }
      let status;
      try {
        status = await git.statusPorcelain(repo);
      } catch (error: unknown) {
        return failure(
          "runtime.binding_status_failed",
          error instanceof Error ? error.message : String(error),
          repo.href,
        );
      }
      if (status.length > 0) {
        return failure(
          "GIT_DIRTY_ROOT",
          "canonical mutation finalization requires a clean local checkout",
          repo.href,
        );
      }
      const profile = await profiles.verify(repo);
      if (!profile.ok) return profile;
      return profile.value.valid &&
        profile.value.root_id === plan.root_id &&
        profile.value.profile_lock_hash === plan.profile_lock_hash
        ? success(true)
        : failure(
            "runtime.binding_profile_mismatch",
            "mutation root or profile does not match the verified local profile",
            plan.plan_id,
          );
    },
  };
}

function createAuthorityValidator(
  fixedRepo: URL,
  git: IntegrationGitCliClient,
  snapshots: CanonicalSnapshotBuilder,
): PlanAuthorityValidator {
  return {
    async verify(repo, plan) {
      if (!sameRoot(repo, fixedRepo) || plan.created_by !== INTEGRATOR_ID) {
        return failure(
          "runtime.authority_actor_denied",
          "local mutations require the fixed Project Memory integrator",
          plan.created_by,
        );
      }
      const metadata = typeof plan.metadata === "object" && plan.metadata !== null && !Array.isArray(plan.metadata)
        ? plan.metadata as Readonly<Record<string, unknown>>
        : null;
      const governanceKind = metadata?.governance_kind;
      const allowed = plan.mutation_kind === "work_lifecycle"
        ? governanceKind === "work_lifecycle" && metadata?.authority_class === "integrator"
        : plan.mutation_kind === "import" && governanceKind === "import";
      if (!allowed) {
        return failure(
          "runtime.authority_kind_denied",
          "local runtime authority is limited to governed work lifecycle and reviewed import plans",
          plan.mutation_kind,
        );
      }
      let snapshot;
      try {
        snapshot = await currentSnapshot(repo, git, snapshots);
      } catch (error: unknown) {
        return failure(
          "runtime.authority_snapshot_failed",
          error instanceof Error ? error.message : String(error),
          repo.href,
        );
      }
      if (!snapshot.ok) return snapshot;
      const accepted = new Map(
        snapshot.value.approvals
          .filter((record) => record.status === "accepted" && record.root_id === plan.root_id)
          .map((record) => [record.id, record]),
      );
      const missing = plan.approval_ids.filter((id) => !accepted.has(id));
      return plan.approval_ids.length > 0 && missing.length === 0
        ? success(true)
        : failure(
            "runtime.authority_approval_missing",
            "every mutation approval must already be an accepted canonical record",
            plan.plan_id,
            missing,
          );
    },
  };
}

function createRepositoryValidator(
  snapshots: CanonicalSnapshotBuilder,
  profiles: ProfileVerifier,
): CanonicalMutationRepositoryValidator {
  return {
    async validate(worktree, plan, sourceTree, viewHashes, auditHashes) {
      const profile = await profiles.verify(worktree);
      if (!profile.ok) return profile;
      if (
        !profile.value.valid ||
        profile.value.root_id !== plan.root_id ||
        profile.value.profile_lock_hash !== plan.profile_lock_hash
      ) {
        return failure(
          "runtime.repository_profile_mismatch",
          "staged repository profile does not match the mutation plan",
          plan.plan_id,
        );
      }
      const snapshot = await snapshots.build(worktree, {
        kind: "tree",
        object_id: sourceTree,
      });
      if (!snapshot.ok) return snapshot;
      if (
        snapshot.value.root_id !== plan.root_id ||
        snapshot.value.profile_lock_hash !== plan.profile_lock_hash
      ) {
        return failure(
          "runtime.repository_snapshot_mismatch",
          "staged canonical snapshot does not match the mutation plan",
          plan.plan_id,
        );
      }
      const views = await verifyExactHashes(worktree, viewHashes);
      if (!views.ok) return views;
      return verifyExactHashes(worktree, auditHashes);
    },
  };
}

function gitEnvironment(): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
  for (const name of ["PATH", "SystemRoot", "HOME", "USERPROFILE"]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

async function synchronizeCheckout(
  repo: URL,
  runner: CommandRunner,
  receipt: MutationReceipt,
): Promise<RuntimeResult<true>> {
  const run = (args: readonly string[]) => runner.run({
    executable: "git",
    args: ["-c", "core.longpaths=true", ...args],
    cwd: repo,
    timeout_ms: 120_000,
    env_allowlist: gitEnvironment(),
    max_output_bytes: 4_194_304,
  });
  try {
    const head = await run(["rev-parse", "--verify", "HEAD^{commit}"]);
    if (
      head.exit_code !== 0 ||
      head.timed_out ||
      head.output_truncated ||
      head.stdout.trim() !== receipt.commit_revision
    ) {
      return failure(
        "runtime.checkout_sync_head_drift",
        "checkout HEAD no longer names the canonical commit that just advanced",
        receipt.commit_revision,
      );
    }
    const synchronized = await run([
      "read-tree",
      "-m",
      "-u",
      receipt.previous_revision,
      receipt.commit_revision,
    ]);
    return synchronized.exit_code === 0 &&
      !synchronized.timed_out &&
      !synchronized.output_truncated
      ? success(true)
      : failure(
          "runtime.checkout_sync_diverged",
          synchronized.stderr.trim() ||
            "Git refused to synchronize because local checkout edits would be overwritten",
          receipt.commit_revision,
        );
  } catch (error: unknown) {
    return failure(
      "runtime.checkout_sync_failed",
      error instanceof Error ? error.message : String(error),
      receipt.commit_revision,
    );
  }
}
function synchronizedMutations(
  raw: CanonicalMutationCoordinator,
  repo: URL,
  runner: CommandRunner,
): CanonicalMutationCoordinator {
  return {
    async finalizeMutation(plan: CanonicalMutationPlan<unknown>) {
      const finalized = await raw.finalizeMutation(plan);
      if (!finalized.ok) return finalized;
      const synchronized = await synchronizeCheckout(repo, runner, finalized.value);
      return synchronized.ok ? finalized : synchronized;
    },
  };
}

function unavailableSingleRepo(): SingleRepoFinalizer {
  return {
    validate: () => Promise.resolve(failure(
      "runtime.single_repo_unavailable",
      "single-repository integration requires an explicitly configured evidence applicability policy",
    )),
    finalize: () => Promise.resolve(failure(
      "runtime.single_repo_unavailable",
      "single-repository integration requires an explicitly configured evidence applicability policy",
    )),
  };
}

function createLocalCoordinator(
  repo: URL,
  clock: Clock,
  runner: NodeCommandRunner,
  git: IntegrationGitCliClient,
  snapshots: CanonicalSnapshotBuilder,
  profiles: ProfileVerifier,
): IntegrationCoordinator {
  const temporaryRoot = pathToFileURL(
    `${path.join(tmpdir(), "project-memory-runtime")}${path.sep}`,
  );
  const views = createViewGenerator({
    clock,
    target_ref: TARGET_REF,
    created_by: INTEGRATOR_ID,
    snapshots: {
      async current(root) {
        try {
          return await currentSnapshot(root, git, snapshots);
        } catch (error: unknown) {
          return failure(
            "runtime.snapshot_failed",
            error instanceof Error ? error.message : String(error),
            root.href,
          );
        }
      },
    },
  });
  const raw = createCanonicalMutationCoordinator({
    repo,
    temporary_root: temporaryRoot,
    clock,
    git,
    leases: createIntegrationLeaseStore({ clock, git }),
    snapshots,
    views,
    bindings: createBindingValidator(repo, git, profiles),
    authority: createAuthorityValidator(repo, git, snapshots),
    repository: createRepositoryValidator(snapshots, profiles),
    bootstrap: createBootstrapMutationHooks({ git, verifier: profiles }),
    integrator_id: INTEGRATOR_ID,
  });
  const mutations = synchronizedMutations(raw, repo, runner);
  return createIntegrationCoordinator({
    bootstrap: createBootstrapFinalizer({ clock, git, coordinator: mutations }),
    mutations,
    single_repo: unavailableSingleRepo(),
  });
}

export function createTrustedNodeHostRegistry(repo: URL): CommandRegistry {
  const clock = new SystemClock();
  const runner = new NodeCommandRunner();
  const git = new IntegrationGitCliClient(runner);
  const snapshots = createCanonicalSnapshotBuilder(createRevisionTreeReader(runner));
  const profiles = createProfileVerifier();
  const coordinator = createLocalCoordinator(repo, clock, runner, git, snapshots, profiles);
  const lifecycle = createWorkLifecycleService({
    clock,
    context: {
      async context(root) {
        if (!sameRoot(root, repo)) {
          return failure(
            "runtime.root_mismatch",
            "work lifecycle commands are bound to the current local repository",
            root.href,
          );
        }
        let status;
        try {
          status = await git.statusPorcelain(repo);
        } catch (error: unknown) {
          return failure(
            "runtime.status_failed",
            error instanceof Error ? error.message : String(error),
            repo.href,
          );
        }
        if (status.length > 0) {
          return failure(
            "GIT_DIRTY_ROOT",
            "work lifecycle planning requires a clean canonical checkout",
            repo.href,
          );
        }
        let snapshot;
        try {
          snapshot = await currentSnapshot(repo, git, snapshots);
        } catch (error: unknown) {
          return failure(
            "runtime.snapshot_failed",
            error instanceof Error ? error.message : String(error),
            repo.href,
          );
        }
        if (!snapshot.ok) return snapshot;
        return success({
          root_id: snapshot.value.root_id,
          target_ref: TARGET_REF,
          expected_head: snapshot.value.source_revision,
          profile_lock_hash: snapshot.value.profile_lock_hash,
          actor_id: INTEGRATOR_ID,
          authority_class: "integrator" as const,
          approval_ids: [snapshot.value.project.acceptance.approval_id],
        });
      },
    },
  });
  const agent = createNodeAgentStartDependencies();
  const importer = createLegacyImporter();
  return createDefaultCommandRegistry({
    agent: { start: (input) => startAgentSession(input, agent) },
    init: {
      build_plan: (replay) => buildInitPlan(replay),
      apply_plan: (input) => applyInitPlan(input, {
        build_plan: (replay) => buildInitPlan(replay),
        git,
        coordinator,
        now: () => clock.now(),
      }),
      now: () => clock.now(),
    },
    import: { planner: importer, coordinator },
    work_lifecycle: { service: lifecycle, coordinator },
  });
}
