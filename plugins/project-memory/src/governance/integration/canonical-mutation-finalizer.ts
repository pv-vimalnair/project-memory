import { lstat, mkdtemp, mkdir, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyFileTransaction,
  canonicalJson,
  failure,
  resolveInside,
  sha256,
  success,
  type CanonicalMutationPlan,
  type Clock,
  type GitClient,
  type RuntimeIssue,
  type RuntimeResult,
} from "../../index.js";
import type { IntegrationLeaseStore, LeaseToken } from "./integration-lease-store.js";
import type { CanonicalSnapshotBuilder } from "../snapshot/snapshot-contracts.js";
import {
  GENERATED_VIEW_PATHS,
  type GeneratedViewPlan,
  type ViewGenerator,
} from "../views/generate-views.js";
import { validateCanonicalMutationPlan } from "./canonical-mutation-validation.js";
import {
  finalizeBootstrapTransaction,
  hitBootstrapFault,
  type BootstrapFaultInjector,
  type BootstrapMutationHooks,
  type PreparedBootstrapMutation,
} from "./bootstrap-transaction.js";

export const MUTATION_FAULT_POINTS = Object.freeze([
  "after_lease_acquisition",
  "after_worktree_creation",
  "after_write_application",
  "after_repository_validation",
  "after_tree_write",
  "before_ref_update",
] as const);

export type MutationFaultPoint = (typeof MUTATION_FAULT_POINTS)[number];

export interface MutationFaultInjector {
  hit(point: MutationFaultPoint): void | Promise<void>;
}

export interface CanonicalMutationGitClient extends GitClient {
  resolveRef(repo: URL, ref: string): Promise<string>;
  stageAll(worktree: URL): Promise<void>;
  writeTree(worktree: URL): Promise<string>;
  commitTree(repo: URL, tree: string, parent: string, message: string): Promise<string>;
  updateRef(repo: URL, ref: string, next: string, expected: string): Promise<boolean>;
}

export interface MutationBindingValidator {
  verify(repo: URL, plan: CanonicalMutationPlan<unknown>): Promise<RuntimeResult<true>>;
}

export interface PlanAuthorityValidator {
  verify(repo: URL, plan: CanonicalMutationPlan<unknown>): Promise<RuntimeResult<true>>;
}

export interface CanonicalMutationRepositoryValidator {
  validate(
    worktree: URL,
    plan: CanonicalMutationPlan<unknown>,
    sourceTree: string,
    derivedViewHashes: Readonly<Record<string, string>>,
    auditArtifactHashes: Readonly<Record<string, string>>,
  ): Promise<RuntimeResult<true>>;
}

export interface MutationReceipt {
  readonly status: "mutation_integrated";
  readonly plan_id: string;
  readonly plan_hash: string;
  readonly previous_revision: string;
  readonly commit_revision: string;
  readonly audit_evidence_id: string;
  readonly derived_view_hashes: Readonly<Record<string, string>>;
  readonly audit_artifact_hashes: Readonly<Record<string, string>>;
  readonly integrated_at: string;
}

export interface CanonicalMutationCoordinator {
  finalizeMutation(plan: CanonicalMutationPlan<unknown>): Promise<RuntimeResult<MutationReceipt>>;
}

export interface CanonicalMutationCoordinatorDependencies {
  readonly repo: URL;
  readonly temporary_root: URL;
  readonly clock: Clock;
  readonly git: CanonicalMutationGitClient;
  readonly leases: IntegrationLeaseStore;
  readonly snapshots: CanonicalSnapshotBuilder;
  readonly views: Pick<ViewGenerator, "plan">;
  readonly bindings: MutationBindingValidator;
  readonly authority: PlanAuthorityValidator;
  readonly repository: CanonicalMutationRepositoryValidator;
  readonly bootstrap?: BootstrapMutationHooks;
  readonly bootstrap_faults?: BootstrapFaultInjector;
  readonly faults?: MutationFaultInjector;
  readonly integrator_id?: string;
  readonly lease_ttl_ms?: number;
}

interface AuditArtifact {
  readonly evidence_id: string;
  readonly relative_path: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
}

interface FinalizationState {
  readonly worktree: URL;
  readonly plan: CanonicalMutationPlan<unknown>;
  readonly lease: LeaseToken;
}

const REVISION = /^[0-9a-f]{40}$/;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function issue(code: string, message: string, pathValue = ""): RuntimeIssue {
  return { code, severity: "error", path: pathValue, message, references: [] };
}

async function refHead(
  dependencies: CanonicalMutationCoordinatorDependencies,
  plan: CanonicalMutationPlan<unknown>,
): Promise<RuntimeResult<string>> {
  try {
    const resolved = await dependencies.git.resolveRef(dependencies.repo, plan.target_ref);
    if (!REVISION.test(resolved)) {
      return failure("mutation.ref_invalid", "canonical target ref did not resolve to a full revision", plan.target_ref);
    }
    return resolved === plan.expected_head
      ? success(resolved)
      : failure("mutation.head_drift", "canonical target ref changed from the plan base", plan.target_ref, [plan.expected_head, resolved]);
  } catch (error: unknown) {
    return failure("mutation.ref_read_failed", error instanceof Error ? error.message : String(error), plan.target_ref);
  }
}

function evidenceId(planHash: string): string {
  let value = BigInt(`0x${planHash.slice(0, 32)}`);
  let encoded = "";
  for (let index = 0; index < 26; index += 1) {
    encoded = `${CROCKFORD[Number(value & 31n)] ?? "0"}${encoded}`;
    value >>= 5n;
  }
  return `EVD-${encoded}`;
}

function hashes(writes: readonly { readonly relative_path: string; readonly bytes: Uint8Array }[]): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...writes]
      .sort((left, right) => left.relative_path.localeCompare(right.relative_path))
      .map((write) => [write.relative_path, sha256(write.bytes)]),
  );
}

function validateViewPlan(
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
    return failure("mutation.derived_view_invalid", "generated views do not bind the staged source tree exactly", plan.plan_id);
  }
  return success(true);
}

function auditArtifact(
  plan: CanonicalMutationPlan<unknown>,
  sourceTree: string,
  viewHashes: Readonly<Record<string, string>>,
  integratedAt: string,
  integratorId: string,
): AuditArtifact {
  const id = evidenceId(plan.plan_hash);
  const relativePath = `docs/project-memory/governance/integration/mutations/${plan.plan_hash}.json`;
  const bytes = new TextEncoder().encode(canonicalJson({
    schema_version: "1.0.0",
    evidence_id: id,
    evidence_type: "canonical-mutation",
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    mutation_kind: plan.mutation_kind,
    root_id: plan.root_id,
    target_ref: plan.target_ref,
    expected_head: plan.expected_head,
    source_tree: sourceTree,
    derived_view_hashes: viewHashes,
    planned_by: plan.created_by,
    integrated_by: integratorId,
    integrated_at: integratedAt,
  }));
  return { evidence_id: id, relative_path: relativePath, bytes, hash: sha256(bytes) };
}

async function fault(
  dependencies: CanonicalMutationCoordinatorDependencies,
  point: MutationFaultPoint,
): Promise<void> {
  await dependencies.faults?.hit(point);
}

async function applyAndCheck(
  worktree: URL,
  writes: CanonicalMutationPlan["writes"],
): Promise<RuntimeResult<true>> {
  const applied = await applyFileTransaction(worktree, writes);
  return applied.ok ? success(true, applied.warnings) : applied;
}

async function removeGeneratedViews(worktree: URL): Promise<RuntimeResult<true>> {
  for (const relativePath of GENERATED_VIEW_PATHS) {
    const target = await resolveInside(worktree, relativePath);
    if (!target.ok) return target;
    try {
      const info = await lstat(target.value);
      if (info.isSymbolicLink() || !info.isFile()) {
        return failure("mutation.generated_view_unsafe", "generated views must be regular files", relativePath);
      }
      await unlink(target.value);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return failure("mutation.generated_view_remove_failed", error instanceof Error ? error.message : String(error), relativePath);
      }
    }
  }
  return success(true);
}

async function heartbeat(
  dependencies: CanonicalMutationCoordinatorDependencies,
  token: LeaseToken,
): Promise<RuntimeResult<true>> {
  const renewed = await dependencies.leases.heartbeat(token);
  return renewed.ok ? success(true, renewed.warnings) : renewed;
}

async function finalizeUnderLease(
  dependencies: CanonicalMutationCoordinatorDependencies,
  state: FinalizationState,
): Promise<RuntimeResult<MutationReceipt>> {
  const { plan, worktree, lease } = state;
  const sourceApplied = await applyAndCheck(worktree, plan.writes);
  if (!sourceApplied.ok) return sourceApplied;
  await fault(dependencies, "after_write_application");
  const withoutViews = await removeGeneratedViews(worktree);
  if (!withoutViews.ok) return withoutViews;
  const sourceHeartbeat = await heartbeat(dependencies, lease);
  if (!sourceHeartbeat.ok) return sourceHeartbeat;

  await dependencies.git.stageAll(worktree);
  const sourceTree = await dependencies.git.writeTree(worktree);
  if (!REVISION.test(sourceTree)) {
    return failure("mutation.source_tree_invalid", "staged source tree is not a full Git object ID", plan.plan_id);
  }
  const snapshot = await dependencies.snapshots.build(worktree, { kind: "tree", object_id: sourceTree });
  if (!snapshot.ok) return snapshot;
  const now = dependencies.clock.now();
  if (!Number.isFinite(now.getTime())) return failure("mutation.clock_invalid", "canonical mutation clock must be valid");
  const viewPlan = dependencies.views.plan(snapshot.value);
  if (!viewPlan.ok) return viewPlan;
  const validViews = validateViewPlan(viewPlan.value, plan, sourceTree, now);
  if (!validViews.ok) return validViews;
  const viewsApplied = await applyAndCheck(worktree, viewPlan.value.writes);
  if (!viewsApplied.ok) return viewsApplied;
  const viewHashes = hashes(viewPlan.value.writes);

  const integratedAt = now.toISOString();
  const audit = auditArtifact(
    plan,
    sourceTree,
    viewHashes,
    integratedAt,
    dependencies.integrator_id ?? "project-memory-integrator",
  );
  const auditApplied = await applyAndCheck(worktree, [{
    relative_path: audit.relative_path,
    bytes: audit.bytes,
    expected_existing_sha256: null,
    mode: "create",
  }]);
  if (!auditApplied.ok) return auditApplied;
  const derivedHeartbeat = await heartbeat(dependencies, lease);
  if (!derivedHeartbeat.ok) return derivedHeartbeat;
  const auditHashes = { [audit.relative_path]: audit.hash };
  const repository = await dependencies.repository.validate(worktree, plan, sourceTree, viewHashes, auditHashes);
  if (!repository.ok) return repository;
  await fault(dependencies, "after_repository_validation");

  await dependencies.git.stageAll(worktree);
  const finalTree = await dependencies.git.writeTree(worktree);
  if (!REVISION.test(finalTree)) {
    return failure("mutation.final_tree_invalid", "final canonical tree is not a full Git object ID", plan.plan_id);
  }
  await fault(dependencies, "after_tree_write");
  const commitHeartbeat = await heartbeat(dependencies, lease);
  if (!commitHeartbeat.ok) return commitHeartbeat;
  const commit = await dependencies.git.commitTree(
    dependencies.repo,
    finalTree,
    plan.expected_head,
    `project-memory(${plan.mutation_kind}): ${plan.plan_id}`,
  );
  if (!REVISION.test(commit)) {
    return failure("mutation.commit_invalid", "canonical mutation commit is not a full Git object ID", plan.plan_id);
  }
  await fault(dependencies, "before_ref_update");
  const updated = await dependencies.git.updateRef(
    dependencies.repo,
    plan.target_ref,
    commit,
    plan.expected_head,
  );
  if (!updated) {
    return failure("mutation.cas_lost", "canonical target ref changed before compare-and-swap", plan.target_ref);
  }
  return success({
    status: "mutation_integrated",
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    previous_revision: plan.expected_head,
    commit_revision: commit,
    audit_evidence_id: audit.evidence_id,
    derived_view_hashes: viewHashes,
    audit_artifact_hashes: auditHashes,
    integrated_at: integratedAt,
  });
}

function appendCleanup<T>(result: RuntimeResult<T>, cleanup: readonly RuntimeIssue[]): RuntimeResult<T> {
  if (cleanup.length === 0) return result;
  return result.ok
    ? success(result.value, [...result.warnings, ...cleanup.map((entry) => ({ ...entry, severity: "warning" as const }))])
    : { ok: false, issues: [...result.issues, ...cleanup] };
}

type UnderLeasePreparation =
  | { readonly kind: "standard" }
  | { readonly kind: "bootstrap"; readonly hooks: BootstrapMutationHooks; readonly prepared: PreparedBootstrapMutation };

async function prepareUnderLease(
  dependencies: CanonicalMutationCoordinatorDependencies,
  plan: CanonicalMutationPlan<unknown>,
): Promise<RuntimeResult<UnderLeasePreparation>> {
  const isBootstrap = plan.mutation_kind === "profile.bootstrap";
  if (isBootstrap) {
    await hitBootstrapFault(dependencies.bootstrap_faults, "after_lease");
  }
  const valid = validateCanonicalMutationPlan(plan, dependencies.clock.now());
  if (!valid.ok) return valid;
  const head = await refHead(dependencies, plan);
  if (!head.ok) return head;
  if (!isBootstrap) {
    const binding = await dependencies.bindings.verify(dependencies.repo, plan);
    if (!binding.ok) return binding;
    const authority = await dependencies.authority.verify(dependencies.repo, plan);
    return authority.ok ? success({ kind: "standard" }) : authority;
  }
  const hooks = dependencies.bootstrap;
  if (hooks === undefined) {
    return failure(
      "bootstrap.handler_missing",
      "profile bootstrap requires bootstrap transaction hooks",
      plan.plan_id,
    );
  }
  const rechecked = await hooks.recheck(dependencies.repo, plan);
  if (!rechecked.ok) return rechecked;
  const prepared = hooks.validate(plan, dependencies.clock.now());
  if (!prepared.ok) return prepared;
  await hitBootstrapFault(dependencies.bootstrap_faults, "after_plan_validation");
  return success({ kind: "bootstrap", hooks, prepared: prepared.value });
}

export function createCanonicalMutationCoordinator(
  dependencies: CanonicalMutationCoordinatorDependencies,
): CanonicalMutationCoordinator {
  async function finalizeMutation(plan: CanonicalMutationPlan<unknown>): Promise<RuntimeResult<MutationReceipt>> {
    const firstValidation = validateCanonicalMutationPlan(plan, dependencies.clock.now());
    if (!firstValidation.ok) return firstValidation;
    const initialHead = await refHead(dependencies, plan);
    if (!initialHead.ok) return initialHead;

    const lease = await dependencies.leases.acquire({
      repo: dependencies.repo,
      root_id: plan.root_id,
      holder_id: dependencies.integrator_id ?? "project-memory-integrator",
      authority_class: "integrator",
      base_revision: plan.expected_head,
      target_ref: plan.target_ref,
      ttl_ms: dependencies.lease_ttl_ms ?? 5 * 60_000,
    });
    if (!lease.ok) return lease;

    const token: LeaseToken = lease.value;
    let generatedRoot: URL | null = null;
    let worktree: URL | null = null;
    let worktreeCreated = false;
    let result: RuntimeResult<MutationReceipt>;
    const cleanupIssues: RuntimeIssue[] = [];
    try {
      await fault(dependencies, "after_lease_acquisition");
      const prepared = await prepareUnderLease(dependencies, plan);
      if (!prepared.ok) {
        result = prepared;
      } else {
        await mkdir(dependencies.temporary_root, { recursive: true });
        const generatedPath = await mkdtemp(
          path.join(fileURLToPath(dependencies.temporary_root), "mutation-"),
        );
        generatedRoot = pathToFileURL(`${generatedPath}${path.sep}`);
        worktree = new URL("worktree/", generatedRoot);
        await dependencies.git.createDetachedWorktree(
          dependencies.repo,
          plan.expected_head,
          worktree,
        );
        worktreeCreated = true;
        await fault(dependencies, "after_worktree_creation");
        if (prepared.value.kind === "standard") {
          result = await finalizeUnderLease(dependencies, {
            worktree,
            plan,
            lease: token,
          });
        } else {
          result = await finalizeBootstrapTransaction(
            {
              repo: dependencies.repo,
              clock: dependencies.clock,
              git: dependencies.git,
              leases: dependencies.leases,
              snapshots: dependencies.snapshots,
              views: dependencies.views,
              repository: dependencies.repository,
              hooks: prepared.value.hooks,
              integrator_id: dependencies.integrator_id ??
                "project-memory-integrator",
              ...(dependencies.bootstrap_faults === undefined
                ? {}
                : { faults: dependencies.bootstrap_faults }),
            },
            {
              worktree,
              plan,
              lease: token,
              prepared: prepared.value.prepared,
            },
          );
        }
      }
    } catch (error: unknown) {
      result = failure(
        "mutation.finalization_failed",
        error instanceof Error ? error.message : String(error),
        plan.plan_id,
      );
    } finally {
      if (worktreeCreated && worktree !== null) {
        try {
          await dependencies.git.removeWorktree(dependencies.repo, worktree);
        } catch (error: unknown) {
          cleanupIssues.push(issue("mutation.worktree_cleanup_failed", error instanceof Error ? error.message : String(error), worktree.href));
        }
      }
      if (generatedRoot !== null) {
        try {
          await rm(generatedRoot, { recursive: true, force: true });
        } catch (error: unknown) {
          cleanupIssues.push(issue("mutation.temporary_cleanup_failed", error instanceof Error ? error.message : String(error), generatedRoot.href));
        }
      }
      const released = await dependencies.leases.release(token);
      if (!released.ok) cleanupIssues.push(...released.issues);
    }
    return appendCleanup(result, cleanupIssues);
  }

  return { finalizeMutation };
}
