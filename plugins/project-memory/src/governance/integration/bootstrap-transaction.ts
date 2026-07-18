import { lstat, readFile } from "node:fs/promises";

import {
  applyFileTransaction,
  canonicalJson,
  failure,
  resolveInside,
  sha256,
  success,
  type CanonicalMutationPlan,
  type Clock,
  type PlannedWrite,
  type RuntimeResult,
} from "../../index.js";
import type { CanonicalSnapshotBuilder } from "../snapshot/snapshot-contracts.js";
import {
  GENERATED_VIEW_PATHS,
  type GeneratedViewPlan,
  type ViewGenerator,
} from "../views/generate-views.js";
import type {
  CanonicalMutationGitClient,
  CanonicalMutationRepositoryValidator,
  MutationReceipt,
} from "./canonical-mutation-finalizer.js";
import { validateCanonicalMutationPlan } from "./canonical-mutation-validation.js";
import type { IntegrationLeaseStore, LeaseToken } from "./integration-lease-store.js";

export const BOOTSTRAP_FAULT_POINTS = Object.freeze([
  "after_lease",
  "after_plan_validation",
  "after_compilation_writes",
  "after_profile_verification",
  "after_audit_writes",
  "after_view_generation",
  "after_repository_validation",
  "after_tree_write",
  "before_ref_update",
] as const);

export type BootstrapFaultPoint = (typeof BOOTSTRAP_FAULT_POINTS)[number];

export interface BootstrapFaultInjector {
  hit(point: BootstrapFaultPoint): void | Promise<void>;
}

export interface PreparedBootstrapMutation {
  readonly compilation_writes: readonly PlannedWrite[];
  readonly audit_writes: readonly PlannedWrite[];
  readonly evidence_id: string;
}

export interface BootstrapAuditArtifact {
  readonly evidence_id: string;
  readonly relative_path: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
}

export interface BootstrapMutationHooks {
  recheck(repo: URL, plan: CanonicalMutationPlan<unknown>): Promise<RuntimeResult<true>>;
  validate(plan: CanonicalMutationPlan<unknown>, now: Date): RuntimeResult<PreparedBootstrapMutation>;
  verifyProfile(worktree: URL, plan: CanonicalMutationPlan<unknown>): Promise<RuntimeResult<true>>;
  buildAudit(input: {
    readonly plan: CanonicalMutationPlan<unknown>;
    readonly source_tree: string;
    readonly generated_view_hashes: Readonly<Record<string, string>>;
    readonly created_at: string;
    readonly created_by: string;
  }): RuntimeResult<BootstrapAuditArtifact>;
}

export interface BootstrapTransactionDependencies {
  readonly repo: URL;
  readonly clock: Clock;
  readonly git: CanonicalMutationGitClient;
  readonly leases: IntegrationLeaseStore;
  readonly snapshots: CanonicalSnapshotBuilder;
  readonly views: Pick<ViewGenerator, "plan">;
  readonly repository: CanonicalMutationRepositoryValidator;
  readonly hooks: BootstrapMutationHooks;
  readonly faults?: BootstrapFaultInjector;
  readonly integrator_id: string;
}

export interface BootstrapTransactionInput {
  readonly worktree: URL;
  readonly plan: CanonicalMutationPlan<unknown>;
  readonly lease: LeaseToken;
  readonly prepared: PreparedBootstrapMutation;
}

const REVISION = /^[0-9a-f]{40}$/;

export async function hitBootstrapFault(
  faults: BootstrapFaultInjector | undefined,
  point: BootstrapFaultPoint,
): Promise<void> {
  await faults?.hit(point);
}

function hashes(
  writes: readonly { readonly relative_path: string; readonly bytes: Uint8Array }[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...writes]
      .sort((left, right) => Buffer.from(left.relative_path).compare(Buffer.from(right.relative_path)))
      .map((write) => [write.relative_path, sha256(write.bytes)]),
  );
}

async function apply(
  root: URL,
  writes: readonly PlannedWrite[],
): Promise<RuntimeResult<true>> {
  const applied = await applyFileTransaction(root, writes);
  return applied.ok ? success(true, applied.warnings) : applied;
}

async function heartbeat(
  dependencies: BootstrapTransactionDependencies,
  token: LeaseToken,
): Promise<RuntimeResult<true>> {
  const renewed = await dependencies.leases.heartbeat(token);
  return renewed.ok ? success(true, renewed.warnings) : renewed;
}

function validViewPlan(
  viewPlan: GeneratedViewPlan,
  plan: CanonicalMutationPlan<unknown>,
  sourceTree: string,
  now: Date,
): RuntimeResult<true> {
  const valid = validateCanonicalMutationPlan(viewPlan, now);
  if (!valid.ok) return valid;
  const actualPaths = viewPlan.writes.map((write) => write.relative_path).sort();
  const expectedPaths = [...GENERATED_VIEW_PATHS].sort();
  if (
    viewPlan.mutation_kind !== "view" ||
    viewPlan.root_id !== plan.root_id ||
    viewPlan.target_ref !== plan.target_ref ||
    viewPlan.expected_head !== sourceTree ||
    viewPlan.profile_lock_hash !== plan.profile_lock_hash ||
    canonicalJson(actualPaths) !== canonicalJson(expectedPaths)
  ) {
    return failure(
      "bootstrap.derived_view_invalid",
      "generated views do not bind the bootstrap source tree exactly",
      plan.plan_id,
    );
  }
  return success(true);
}

async function verifyAppliedViews(
  worktree: URL,
  writes: readonly PlannedWrite[],
): Promise<RuntimeResult<true>> {
  for (const write of writes) {
    const target = await resolveInside(worktree, write.relative_path);
    if (!target.ok) return target;
    try {
      const info = await lstat(target.value);
      if (info.isSymbolicLink() || !info.isFile()) {
        return failure(
          "bootstrap.view_drift",
          "generated bootstrap views must be regular files",
          write.relative_path,
        );
      }
      const actual = new Uint8Array(await readFile(target.value));
      if (!Buffer.from(actual).equals(Buffer.from(write.bytes))) {
        return failure(
          "bootstrap.view_drift",
          "generated bootstrap view bytes drifted after application",
          write.relative_path,
        );
      }
    } catch (error: unknown) {
      return failure(
        "bootstrap.view_drift",
        error instanceof Error ? error.message : String(error),
        write.relative_path,
      );
    }
  }
  return success(true);
}

export async function finalizeBootstrapTransaction(
  dependencies: BootstrapTransactionDependencies,
  input: BootstrapTransactionInput,
): Promise<RuntimeResult<MutationReceipt>> {
  const { plan, worktree, lease, prepared } = input;
  const compilation = await apply(worktree, prepared.compilation_writes);
  if (!compilation.ok) return compilation;
  await hitBootstrapFault(dependencies.faults, "after_compilation_writes");

  const profile = await dependencies.hooks.verifyProfile(worktree, plan);
  if (!profile.ok) return profile;
  await hitBootstrapFault(dependencies.faults, "after_profile_verification");

  const audits = await apply(worktree, prepared.audit_writes);
  if (!audits.ok) return audits;
  await hitBootstrapFault(dependencies.faults, "after_audit_writes");
  const sourceHeartbeat = await heartbeat(dependencies, lease);
  if (!sourceHeartbeat.ok) return sourceHeartbeat;

  await dependencies.git.stageAll(worktree);
  const sourceTree = await dependencies.git.writeTree(worktree);
  if (!REVISION.test(sourceTree)) {
    return failure(
      "bootstrap.source_tree_invalid",
      "bootstrap source tree is not a full Git object ID",
      plan.plan_id,
    );
  }
  const snapshot = await dependencies.snapshots.build(worktree, {
    kind: "tree",
    object_id: sourceTree,
  });
  if (!snapshot.ok) return snapshot;
  const now = dependencies.clock.now();
  if (!Number.isFinite(now.getTime())) {
    return failure("bootstrap.clock_invalid", "bootstrap clock must be valid", plan.plan_id);
  }
  const viewPlan = dependencies.views.plan(snapshot.value);
  if (!viewPlan.ok) return viewPlan;
  const viewsValid = validViewPlan(viewPlan.value, plan, sourceTree, now);
  if (!viewsValid.ok) return viewsValid;
  const viewsApplied = await apply(worktree, viewPlan.value.writes);
  if (!viewsApplied.ok) return viewsApplied;
  const viewsExact = await verifyAppliedViews(worktree, viewPlan.value.writes);
  if (!viewsExact.ok) return viewsExact;
  const viewHashes = hashes(viewPlan.value.writes);
  await hitBootstrapFault(dependencies.faults, "after_view_generation");

  const integratedAt = now.toISOString();
  const audit = dependencies.hooks.buildAudit({
    plan,
    source_tree: sourceTree,
    generated_view_hashes: viewHashes,
    created_at: integratedAt,
    created_by: dependencies.integrator_id,
  });
  if (!audit.ok) return audit;
  const manifestApplied = await apply(worktree, [
    {
      relative_path: audit.value.relative_path,
      bytes: audit.value.bytes,
      expected_existing_sha256: null,
      mode: "create",
    },
  ]);
  if (!manifestApplied.ok) return manifestApplied;
  const auditHashes = { [audit.value.relative_path]: audit.value.hash };
  const repository = await dependencies.repository.validate(
    worktree,
    plan,
    sourceTree,
    viewHashes,
    auditHashes,
  );
  if (!repository.ok) return repository;
  await hitBootstrapFault(dependencies.faults, "after_repository_validation");

  await dependencies.git.stageAll(worktree);
  const finalTree = await dependencies.git.writeTree(worktree);
  if (!REVISION.test(finalTree)) {
    return failure(
      "bootstrap.final_tree_invalid",
      "bootstrap final tree is not a full Git object ID",
      plan.plan_id,
    );
  }
  await hitBootstrapFault(dependencies.faults, "after_tree_write");
  const commitHeartbeat = await heartbeat(dependencies, lease);
  if (!commitHeartbeat.ok) return commitHeartbeat;
  const commit = await dependencies.git.commitTree(
    dependencies.repo,
    finalTree,
    plan.expected_head,
    `project-memory(profile.bootstrap): ${plan.plan_id}`,
  );
  if (!REVISION.test(commit)) {
    return failure(
      "bootstrap.commit_invalid",
      "bootstrap commit is not a full Git object ID",
      plan.plan_id,
    );
  }
  await hitBootstrapFault(dependencies.faults, "before_ref_update");
  const updated = await dependencies.git.updateRef(
    dependencies.repo,
    plan.target_ref,
    commit,
    plan.expected_head,
  );
  if (!updated) {
    return failure(
      "bootstrap.cas_lost",
      "bootstrap target ref changed before compare-and-swap",
      plan.target_ref,
    );
  }
  return success({
    status: "mutation_integrated",
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    previous_revision: plan.expected_head,
    commit_revision: commit,
    audit_evidence_id: audit.value.evidence_id,
    derived_view_hashes: viewHashes,
    audit_artifact_hashes: auditHashes,
    integrated_at: integratedAt,
  });
}
