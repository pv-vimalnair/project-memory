import { lstat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createNodeAgentStartDependencies, startAgentSession } from "../agent/index.js";
import { CONFIG_RELATIVE_PATH } from "./config.js";
import type { CanonicalMutationPlan } from "../contracts/canonical-mutation-plan.js";
import { failure, success, type RuntimeResult } from "../contracts/runtime-result.js";
import { deterministicInstanceId } from "./init/build-initial-source-proposal.js";
import { SystemClock, type Clock } from "../core/clock.js";
import type { CommandRunner } from "../contracts/command-runner.js";
import { NodeCommandRunner } from "../core/command-runner.js";
import { currentGitBranchRef } from "../core/git-cli-client.js";
import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import type { IdFactory } from "../core/id-factory.js";
import { resolveInside } from "../core/path-safety.js";
import {
  createLegacyImporter,
  planGuidedLegacyImport,
  type GuidedLegacyImportInput,
} from "../import/index.js";
import type { LegacyImportServiceDependencies } from "../host/legacy-import-service.js";
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
import { createViewGenerator, GENERATED_VIEW_PATHS } from "../governance/views/generate-views.js";
import { createWorkLifecycleService } from "../governance/work/work-lifecycle-service.js";
import { PROJECT_CONTEXT_PATH } from "../materialize/render-startup-context.js";
import { createMigrationService } from "../migrations/planner.js";
import { createProjectMemoryMigrationRegistry } from "../migrations/v1/project-memory-v1-1.js";
import {
  createNodeRepositoryUpgradePlanner,
  REPOSITORY_UPGRADE_RECORD_PATH,
  type RepositoryUpgradePlan,
} from "../upgrades/index.js";
import { applyInitPlan } from "./init/apply-init-plan.js";
import { buildInitPlan } from "./init/build-init-plan.js";
import { createDefaultCommandRegistry } from "./command-registry.js";
import type { CommandRegistry } from "./command-registry.js";
import type { AgentCommandDependencies } from "./commands/agent.js";
import type { InitCommandDependencies } from "./commands/init.js";

const INTEGRATOR_ID = "project-memory-integrator";

function sameRoot(left: URL, right: URL): boolean {
  return left.protocol === "file:" && left.href === right.href;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactStringArray(
  value: unknown,
  expected: readonly string[],
): boolean {
  return Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index]);
}

async function currentSnapshot(
  repo: URL,
  git: IntegrationGitCliClient,
  snapshots: CanonicalSnapshotBuilder,
  targetRef: string,
): Promise<Awaited<ReturnType<CanonicalSnapshotBuilder["build"]>>> {
  const head = await git.resolveRef(repo, targetRef);
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
  targetRef: string,
  runner: CommandRunner,
  git: IntegrationGitCliClient,
  profiles: ProfileVerifier,
  snapshots: CanonicalSnapshotBuilder,
  allowLegacyUpgrade = false,
): MutationBindingValidator {
  return {
    async verify(repo, plan) {
      if (!sameRoot(repo, fixedRepo) || plan.target_ref !== targetRef) {
        return failure(
          "runtime.binding_root_mismatch",
          "mutation root and target ref must match the local runtime",
          repo.href,
        );
      }
      const currentBranch = await currentGitBranchRef(repo, runner);
      if (!currentBranch.ok) return currentBranch;
      if (currentBranch.value !== targetRef) {
        return failure(
          "runtime.binding_branch_drift",
          "checked-out branch no longer matches the approved target ref",
          targetRef,
          [currentBranch.value],
        );
      }
      let head: string;
      try {
        head = await git.resolveRef(repo, targetRef);
      } catch (error: unknown) {
        return failure(
          "runtime.binding_head_failed",
          error instanceof Error ? error.message : String(error),
          targetRef,
        );
      }
      if (head !== plan.expected_head) {
        return failure("runtime.binding_head_drift", "mutation base no longer matches HEAD", targetRef);
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
      if (!profile.ok) {
        const legacyConfigOnly = allowLegacyUpgrade &&
          profile.issues.length > 0 &&
          profile.issues.every((issue) =>
            issue.code === "PROFILE_ADAPTER_ARTIFACT_MISMATCH" &&
            issue.path === CONFIG_RELATIVE_PATH
          );
        if (!legacyConfigOnly) return profile;
        const snapshot = await snapshots.build(repo, {
          kind: "commit",
          object_id: head,
        });
        if (!snapshot.ok) return snapshot;
        return snapshot.value.root_id === plan.root_id &&
          snapshot.value.profile_lock_hash === plan.profile_lock_hash
          ? success(true)
          : failure(
              "runtime.binding_profile_mismatch",
              "legacy upgrade snapshot does not match the approved profile",
              plan.plan_id,
            );
      }
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

export function createRepositoryUpgradeAuthorityValidator(
  fixedRepo: URL,
): PlanAuthorityValidator {
  const changedPaths = [
    PROJECT_CONTEXT_PATH,
    REPOSITORY_UPGRADE_RECORD_PATH,
    CONFIG_RELATIVE_PATH,
  ].sort(compareUtf8);
  return {
    verify(repo, plan) {
      const metadata = plan.metadata;
      const writePaths = plan.writes
        .map((write) => write.relative_path)
        .sort(compareUtf8);
      const authorized = sameRoot(repo, fixedRepo) &&
        plan.mutation_kind === "migration" &&
        isRecord(metadata) &&
        metadata.governance_kind === "repository_upgrade" &&
        metadata.migration_id === "project-memory-v1-1" &&
        metadata.authority_impact === "none" &&
        metadata.from_version === "1.0.0" &&
        metadata.to_version === "1.1.0" &&
        metadata.migration_record_path === REPOSITORY_UPGRADE_RECORD_PATH &&
        exactStringArray(metadata.changed_paths, changedPaths) &&
        exactStringArray(metadata.derived_paths, GENERATED_VIEW_PATHS) &&
        exactStringArray(writePaths, changedPaths);
      return Promise.resolve(authorized
        ? success(true)
        : failure(
            "runtime.upgrade_authority_denied",
            "repository upgrade plan exceeds the exact local upgrade authority",
            plan.plan_id,
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
  targetRef: string,
  clock: Clock,
  runner: NodeCommandRunner,
  git: IntegrationGitCliClient,
  snapshots: CanonicalSnapshotBuilder,
  profiles: ProfileVerifier,
  authority: PlanAuthorityValidator = createAuthorityValidator(repo),
  allowLegacyUpgrade = false,
): IntegrationCoordinator {
  const temporaryRoot = pathToFileURL(
    `${path.join(tmpdir(), "project-memory-runtime")}${path.sep}`,
  );
  const views = createViewGenerator({
    clock,
    target_ref: targetRef,
    created_by: INTEGRATOR_ID,
    snapshots: {
      async current(root) {
        try {
          return await currentSnapshot(root, git, snapshots, targetRef);
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
    bindings: createBindingValidator(
      repo,
      targetRef,
      runner,
      git,
      profiles,
      snapshots,
      allowLegacyUpgrade,
    ),
    authority,
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

function createDynamicLocalCoordinator(
  repo: URL,
  clock: Clock,
  runner: NodeCommandRunner,
  git: IntegrationGitCliClient,
  snapshots: CanonicalSnapshotBuilder,
  profiles: ProfileVerifier,
): IntegrationCoordinator {
  const coordinatorFor = (targetRef: string) =>
    createLocalCoordinator(repo, targetRef, clock, runner, git, snapshots, profiles);
  const singleRepo = unavailableSingleRepo();
  return {
    bootstrap: (input) => coordinatorFor(input.target_ref).bootstrap(input),
    finalizeMutation: (plan) => coordinatorFor(plan.target_ref).finalizeMutation(plan),
    validate: (input) => singleRepo.validate(input),
    finalize: (token) => singleRepo.finalize(token),
  };
}

export interface NodeProjectMemoryServices {
  readonly registry: CommandRegistry;
  readonly start: AgentCommandDependencies["start"];
  readonly applyBootstrap: InitCommandDependencies["apply_plan"];
  readonly applyUpgrade: (
    root: URL,
    savedPlan: RepositoryUpgradePlan,
  ) => Promise<RuntimeResult<MutationReceipt>>;
  readonly legacyImport: LegacyImportServiceDependencies;
}

class DeterministicGuidedImportIds implements IdFactory {
  #counter = 0;
  readonly #seed: string;

  constructor(input: GuidedLegacyImportInput) {
    this.#seed = sha256(canonicalJson(input));
  }

  next(prefix: Parameters<IdFactory["next"]>[0]): string {
    this.#counter += 1;
    return deterministicInstanceId(
      prefix,
      `${this.#seed}\0${prefix}\0${String(this.#counter)}`,
    );
  }
}

async function readGuidedImportSource(
  root: URL,
  relativePath: string,
): Promise<RuntimeResult<Uint8Array>> {
  const resolved = await resolveInside(root, relativePath);
  if (!resolved.ok) return resolved;
  try {
    const stat = await lstat(resolved.value);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return failure(
        "GUIDED_IMPORT_SOURCE_UNSAFE",
        "guided import accepts regular source files only",
        relativePath,
      );
    }
    return success(new Uint8Array(await readFile(resolved.value)));
  } catch (error: unknown) {
    return failure(
      "GUIDED_IMPORT_SOURCE_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
}

export function createNodeProjectMemoryServices(repo: URL): NodeProjectMemoryServices {
  const clock = new SystemClock();
  const runner = new NodeCommandRunner();
  const git = new IntegrationGitCliClient(runner);
  const snapshots = createCanonicalSnapshotBuilder(createRevisionTreeReader(runner));
  const profiles = createProfileVerifier();
  const coordinator = createDynamicLocalCoordinator(repo, clock, runner, git, snapshots, profiles);
  const upgrades = createNodeRepositoryUpgradePlanner(() => clock.now());
  const migrationRegistry = createProjectMemoryMigrationRegistry();
  const legacyImport: LegacyImportServiceDependencies = {
    now: () => clock.now(),
    async context(root) {
      if (!sameRoot(root, repo)) {
        return failure(
          "runtime.root_mismatch",
          "guided import is bound to the configured local repository",
          root.href,
        );
      }
      const targetRef = await currentGitBranchRef(root, runner);
      if (!targetRef.ok) return targetRef;
      let head: string;
      try {
        head = await git.resolveRef(root, targetRef.value);
      } catch (error: unknown) {
        return failure(
          "runtime.binding_head_failed",
          error instanceof Error ? error.message : String(error),
          targetRef.value,
        );
      }
      const snapshot = await snapshots.build(root, { kind: "commit", object_id: head });
      if (!snapshot.ok) return snapshot;
      const catalogVersion = snapshot.value.catalog_versions[0];
      if (catalogVersion === undefined || snapshot.value.catalog_versions.length !== 1) {
        return failure(
          "runtime.catalog_binding_invalid",
          "guided import requires one verified catalog release",
          root.href,
        );
      }
      return success({
        root_id: snapshot.value.root_id,
        target_ref: targetRef.value,
        expected_head: head,
        profile_lock_hash: snapshot.value.profile_lock_hash,
        catalog_version: catalogVersion,
      });
    },
    plan(root, input) {
      if (!sameRoot(root, repo)) {
        return Promise.resolve(failure(
          "runtime.root_mismatch",
          "guided import planner is bound to the configured local repository",
          root.href,
        ));
      }
      return planGuidedLegacyImport(input, {
        ids: new DeterministicGuidedImportIds(input),
        read_source: (relativePath) => readGuidedImportSource(root, relativePath),
      });
    },
    finalize(root, plan, authority) {
      if (!sameRoot(root, repo)) {
        return Promise.resolve(failure(
          "runtime.root_mismatch",
          "guided import finalization is bound to the configured local repository",
          root.href,
        ));
      }
      return createLocalCoordinator(
        repo,
        plan.target_ref,
        clock,
        runner,
        git,
        snapshots,
        profiles,
        authority,
      ).finalizeMutation(plan);
    },
  };
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
  const applyUpgrade: NodeProjectMemoryServices["applyUpgrade"] = async (
    root,
    savedPlan,
  ) => {
    if (!sameRoot(root, repo)) {
      return failure(
        "runtime.root_mismatch",
        "repository upgrade is bound to the configured local repository",
        root.href,
      );
    }
    const replanned = await upgrades.plan(root, {
      created_at: savedPlan.created_at,
      expires_at: savedPlan.expires_at,
    });
    if (!replanned.ok) return replanned;
    if (replanned.value === null) {
      return failure(
        "UPGRADE_NO_LONGER_REQUIRED",
        "repository already uses the current contract",
        root.href,
      );
    }
    if (replanned.value.plan_hash !== savedPlan.plan_hash) {
      return failure(
        "UPGRADE_PLAN_CHANGED",
        "repository upgrade inputs changed; request a fresh proposal",
        savedPlan.plan_id,
        [savedPlan.plan_hash, replanned.value.plan_hash],
      );
    }
    return createLocalCoordinator(
      repo,
      replanned.value.target_ref,
      clock,
      runner,
      git,
      snapshots,
      profiles,
      createRepositoryUpgradeAuthorityValidator(repo),
      true,
    ).finalizeMutation(replanned.value);
  };
  const migration = migrationRegistry.ok
    ? { service: createMigrationService(migrationRegistry.value), coordinator }
    : undefined;
  const registry = createDefaultCommandRegistry({
    agent: { start },
    init,
    import: { planner: importer, coordinator },
    ...(migration === undefined ? {} : { migration }),
    work_lifecycle: { service: lifecycle, coordinator },
  });
  return { registry, start, applyBootstrap: init.apply_plan, applyUpgrade, legacyImport };
}

export function createNodeCommandRegistry(repo: URL): CommandRegistry {
  return createNodeProjectMemoryServices(repo).registry;
}
