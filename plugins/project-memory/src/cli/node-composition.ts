import { lstat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createNodeAgentStartDependencies, startAgentSession } from "../agent/index.js";
import type { CanonicalMutationPlan } from "../contracts/canonical-mutation-plan.js";
import { failure, success, type RuntimeResult } from "../contracts/runtime-result.js";
import { SystemClock, type Clock } from "../core/clock.js";
import type { CommandRunner } from "../contracts/command-runner.js";
import { NodeCommandRunner } from "../core/command-runner.js";
import { sha256 } from "../core/hash.js";
import { resolveInside } from "../core/path-safety.js";
import { createLegacyImporter } from "../import/index.js";
import { createProfileVerifier, type ProfileVerifier } from "../profile/verify-profile.js";
import { createBootstrapFinalizer, createBootstrapMutationHooks } from "../governance/integration/bootstrap-finalizer.js";
import {
  createCanonicalMutationCoordinator,
  type CanonicalMutationCoordinator,
  type CanonicalMutationRepositoryValidator,
  type MutationBindingValidator,
  type MutationReceipt,
  type PlanAuthorityValidator,
} from "../governance/integration/canonical-mutation-finalizer.js";
import { createIntegrationCoordinator, type IntegrationCoordinator } from "../governance/integration/integration-coordinator.js";
import { IntegrationGitCliClient } from "../governance/integration/integration-git-client.js";
import { createIntegrationLeaseStore } from "../governance/integration/integration-lease-store.js";
import type { SingleRepoFinalizer } from "../governance/integration/single-repo-finalizer.js";
import { createCanonicalSnapshotBuilder } from "../governance/snapshot/canonical-snapshot-builder.js";
import { createRevisionTreeReader } from "../governance/snapshot/revision-tree-reader.js";
import type { CanonicalSnapshotBuilder } from "../governance/snapshot/snapshot-contracts.js";
import { createViewGenerator } from "../governance/views/generate-views.js";
import { createWorkLifecycleService } from "../governance/work/work-lifecycle-service.js";
import { applyInitPlan } from "./init/apply-init-plan.js";
import { buildInitPlan } from "./init/build-init-plan.js";
import { createDefaultCommandRegistry } from "./command-registry.js";
import type { CommandRegistry } from "./command-registry.js";
import type { AgentCommandDependencies } from "./commands/agent.js";
import type { InitCommandDependencies } from "./commands/init.js";

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
): PlanAuthorityValidator {
  return {
    verify(repo, plan) {
      return Promise.resolve(!sameRoot(repo, fixedRepo)
        ? failure(
            "runtime.authority_actor_denied",
            "local mutations are bound to the configured repository",
            repo.href,
          )
        : failure(
            "runtime.trusted_integrator_required",
            "lifecycle and import mutation require a separate trusted host adapter",
            plan.mutation_kind,
          ));
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

export async function synchronizeCheckout(
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
    authority: createAuthorityValidator(repo),
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

export interface NodeProjectMemoryServices {
  readonly registry: CommandRegistry;
  readonly start: AgentCommandDependencies["start"];
  readonly applyBootstrap: InitCommandDependencies["apply_plan"];
}

export function createNodeProjectMemoryServices(repo: URL): NodeProjectMemoryServices {
  const clock = new SystemClock();
  const runner = new NodeCommandRunner();
  const git = new IntegrationGitCliClient(runner);
  const snapshots = createCanonicalSnapshotBuilder(createRevisionTreeReader(runner));
  const profiles = createProfileVerifier();
  const coordinator = createLocalCoordinator(repo, clock, runner, git, snapshots, profiles);
  const lifecycle = createWorkLifecycleService({
    clock,
    context: {
      context(root) {
        return Promise.resolve(!sameRoot(root, repo)
          ? failure(
              "runtime.root_mismatch",
              "work lifecycle commands are bound to the current local repository",
              root.href,
            )
          : failure(
              "runtime.trusted_integrator_required",
              "lifecycle mutation requires a separate trusted host adapter",
              root.href,
            ));
      },
    },
  });
  const agent = createNodeAgentStartDependencies();
  const importer = createLegacyImporter();
  const start: AgentCommandDependencies["start"] = (input) =>
    startAgentSession(input, agent);
  const init: InitCommandDependencies = {
    build_plan: (replay) => buildInitPlan(replay),
    apply_plan: (input) => applyInitPlan(input, {
      build_plan: (replay) => buildInitPlan(replay),
      git,
      coordinator,
      now: () => clock.now(),
    }),
    now: () => clock.now(),
  };
  const registry = createDefaultCommandRegistry({
    agent: { start },
    init,
    import: { planner: importer, coordinator },
    work_lifecycle: { service: lifecycle, coordinator },
  });
  return { registry, start, applyBootstrap: init.apply_plan };
}

export function createNodeCommandRegistry(repo: URL): CommandRegistry {
  return createNodeProjectMemoryServices(repo).registry;
}
