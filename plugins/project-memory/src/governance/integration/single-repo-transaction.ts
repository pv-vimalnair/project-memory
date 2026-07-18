import { lstat, mkdir, mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyFileTransaction,
  canonicalJson,
  failure,
  isSameOrChildPath,
  resolveInside,
  sha256,
  success,
  type PlannedWrite,
  type RuntimeIssue,
  type RuntimeResult,
} from "../../index.js";
import {
  GENERATED_VIEW_PATHS,
} from "../views/generate-views.js";
import {
  applyArchive,
  applyIntegrationSources,
  planCompletionArchive,
} from "./single-repo-records.js";
import { auditManifestPath } from "./audit-evidence.js";
import {
  hitSingleRepoFault,
  type IntegrationReceipt,
  type PendingIntegration,
  type SingleRepoFinalizerDependencies,
} from "./single-repo-contracts.js";
import type { ValidatedBindings } from "./single-repo-validation.js";
import { validateSingleRepoViewPlan } from "./single-repo-view-validation.js";

const REVISION = /^[0-9a-f]{40}$/;

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function hashes(writes: readonly PlannedWrite[]): Readonly<Record<string, string>> {
  return Object.fromEntries([...writes]
    .sort((left, right) => compareUtf8(left.relative_path, right.relative_path))
    .map((write) => [write.relative_path, sha256(write.bytes)]));
}

async function apply(
  root: URL,
  writes: readonly PlannedWrite[],
): Promise<RuntimeResult<true>> {
  const result = await applyFileTransaction(root, writes);
  return result.ok ? success(true, result.warnings) : result;
}

async function removeGeneratedViews(worktree: URL): Promise<RuntimeResult<true>> {
  for (const relativePath of GENERATED_VIEW_PATHS) {
    const target = await resolveInside(worktree, relativePath);
    if (!target.ok) return target;
    try {
      const info = await lstat(target.value);
      if (info.isSymbolicLink() || !info.isFile()) {
        return failure(
          "integration.generated_view_unsafe",
          "generated views must be regular files",
          relativePath,
        );
      }
      await unlink(target.value);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return failure(
          "integration.generated_view_remove_failed",
          error instanceof Error ? error.message : String(error),
          relativePath,
        );
      }
    }
  }
  return success(true);
}

async function verifyViewBytes(
  worktree: URL,
  writes: readonly PlannedWrite[],
): Promise<RuntimeResult<true>> {
  for (const write of writes) {
    const target = await resolveInside(worktree, write.relative_path);
    if (!target.ok) return target;
    try {
      const info = await lstat(target.value);
      const bytes = new Uint8Array(await readFile(target.value));
      if (
        info.isSymbolicLink() ||
        !info.isFile() ||
        !Buffer.from(bytes).equals(Buffer.from(write.bytes))
      ) {
        return failure(
          "integration.view_drift",
          "applied generated view bytes differ from their deterministic plan",
          write.relative_path,
        );
      }
    } catch (error: unknown) {
      return failure(
        "integration.view_drift",
        error instanceof Error ? error.message : String(error),
        write.relative_path,
      );
    }
  }
  return success(true);
}

function taskIntegrated(
  snapshot: Awaited<ReturnType<SingleRepoFinalizerDependencies["snapshots"]["build"]>>,
  taskId: string,
) {
  if (!snapshot.ok) return snapshot;
  const task = snapshot.value.tasks.find((candidate) =>
    candidate.envelope.id === taskId &&
    /^Status: integrated_verified$/mu.test(candidate.body)
  );
  return task === undefined
    ? failure(
        "integration.task_not_integrated",
        "pre-view canonical source does not mark the exact task integrated_verified",
        taskId,
      )
    : success(true);
}
function transactionAudit(
  pending: PendingIntegration,
  sourceTree: string,
  viewHashes: Readonly<Record<string, string>>,
  evidenceId: string,
  auditManifestHash: string,
  archiveManifestHash: string,
  integratedAt: string,
): { readonly write: PlannedWrite; readonly hash: string } {
  const relativePath =
    `docs/project-memory/governance/integration/mutations/${pending.token.validation_id}.json`;
  const bytes = new TextEncoder().encode(canonicalJson({
    schema_version: "1.0.0",
    evidence_type: "single-repository-integration",
    validation_id: pending.token.validation_id,
    task_id: pending.input.task_packet.task_id,
    packet_id: pending.input.task_packet.packet_id,
    claim_id: pending.input.task_packet.claim.id,
    target_ref: pending.input.target_ref,
    expected_head: pending.input.expected_head,
    reconciled_head_revision: pending.reconciliation.reconciled_head_revision,
    source_tree: sourceTree,
    generated_view_hashes: viewHashes,
    evidence_id: evidenceId,
    audit_manifest_hash: auditManifestHash,
    completion_archive_manifest_hash: archiveManifestHash,
    gate_evidence_hashes: pending.gate_evidence_hashes,
    integrated_at: integratedAt,
    integrated_by: pending.lease.holder_id,
  }));
  return {
    write: {
      relative_path: relativePath,
      bytes,
      expected_existing_sha256: null,
      mode: "create",
    },
    hash: sha256(bytes),
  };
}

function cleanupIssue(code: string, error: unknown, target: string): RuntimeIssue {
  return {
    code,
    severity: "error",
    path: target,
    message: error instanceof Error ? error.message : String(error),
    references: [],
  };
}

function withCleanup<T>(
  result: RuntimeResult<T>,
  cleanup: readonly RuntimeIssue[],
): RuntimeResult<T> {
  if (cleanup.length === 0) return result;
  return result.ok
    ? { ok: false, issues: cleanup }
    : { ok: false, issues: [...result.issues, ...cleanup] };
}

async function executeInWorktree(
  dependencies: SingleRepoFinalizerDependencies,
  pending: PendingIntegration,
  bindings: ValidatedBindings,
  worktree: URL,
): Promise<RuntimeResult<IntegrationReceipt>> {
  await dependencies.git.stageAll(worktree);
  const reconciledTree = await dependencies.git.writeTree(worktree);
  if (reconciledTree !== pending.reconciliation.reconciled_tree) {
    return failure(
      "integration.reconciled_tree_drift",
      "reconciler commit does not reproduce its validated tree",
      pending.input.task_packet.task_id,
    );
  }
  const candidate = await dependencies.snapshots.build(worktree, {
    kind: "tree",
    object_id: reconciledTree,
  });
  if (!candidate.ok) return candidate;

  const archive = planCompletionArchive(dependencies, pending);
  if (!archive.ok) return archive;
  const archived = await applyArchive(worktree, archive.value);
  if (!archived.ok) return archived;
  await hitSingleRepoFault(dependencies.faults, "after_completion_archive");

  const sources = await applyIntegrationSources(
    dependencies,
    pending,
    bindings,
    candidate.value,
    archive.value,
    worktree,
  );
  if (!sources.ok) return sources;
  await hitSingleRepoFault(dependencies.faults, "after_record_plan");
  const viewsRemoved = await removeGeneratedViews(worktree);
  if (!viewsRemoved.ok) return viewsRemoved;

  await dependencies.git.stageAll(worktree);
  const sourceTree = await dependencies.git.writeTree(worktree);
  if (!REVISION.test(sourceTree)) {
    return failure(
      "integration.source_tree_invalid",
      "pre-view integration tree is not a full Git object ID",
    );
  }
  const snapshot = await dependencies.snapshots.build(worktree, {
    kind: "tree",
    object_id: sourceTree,
  });
  const integrated = taskIntegrated(snapshot, pending.input.task_packet.task_id);
  if (!integrated.ok) return integrated;
  const now = dependencies.clock.now();
  if (!Number.isFinite(now.getTime())) {
    return failure("integration.clock_invalid", "integration finalization clock is invalid");
  }
  if (!snapshot.ok) return snapshot;
  const viewPlan = dependencies.views.plan(snapshot.value);
  if (!viewPlan.ok) return viewPlan;
  const viewsValid = validateSingleRepoViewPlan(
    viewPlan.value,
    pending,
    snapshot.value,
    sourceTree,
    now,
  );
  if (!viewsValid.ok) return viewsValid;
  const viewsApplied = await apply(worktree, viewPlan.value.writes);
  if (!viewsApplied.ok) return viewsApplied;
  const viewsExact = await verifyViewBytes(worktree, viewPlan.value.writes);
  if (!viewsExact.ok) return viewsExact;
  const viewHashes = hashes(viewPlan.value.writes);

  const profile = await dependencies.verifier.verify(worktree);
  if (!profile.ok) return profile;
  if (
    !profile.value.valid ||
    profile.value.root_id !== pending.input.task_packet.root.id ||
    profile.value.profile_lock_hash !== pending.input.task_packet.root.profile_lock_hash
  ) {
    return failure(
      "integration.profile_verification_failed",
      "staged finalization no longer matches the task-bound profile",
    );
  }
  const archivedVerified = await dependencies.archives.verify(
    worktree,
    sources.value.archive.receipt.manifest_hash,
  );
  if (!archivedVerified.ok) return archivedVerified;

  const integratedAt = now.toISOString();
  const audit = transactionAudit(
    pending,
    sourceTree,
    viewHashes,
    sources.value.audit.record.id,
    sources.value.audit.manifest_hash,
    sources.value.archive.receipt.manifest_hash,
    integratedAt,
  );
  const auditApplied = await apply(worktree, [audit.write]);
  if (!auditApplied.ok) return auditApplied;
  await hitSingleRepoFault(dependencies.faults, "after_view_plan");

  await dependencies.git.stageAll(worktree);
  const finalTree = await dependencies.git.writeTree(worktree);
  if (!REVISION.test(finalTree)) {
    return failure("integration.final_tree_invalid", "final staged tree is invalid");
  }
  await hitSingleRepoFault(dependencies.faults, "after_tree_write");
  const renewed = await dependencies.leases.heartbeat(pending.lease);
  if (!renewed.ok) return renewed;
  const commit = await dependencies.git.commitTree(
    pending.input.root,
    finalTree,
    pending.input.expected_head,
    `project-memory(integrated_verified): ${pending.input.task_packet.task_id}`,
  );
  if (!REVISION.test(commit)) {
    return failure("integration.commit_invalid", "integration commit ID is invalid");
  }
  await hitSingleRepoFault(dependencies.faults, "before_ref_update");
  const updated = await dependencies.git.updateRef(
    pending.input.root,
    pending.input.target_ref,
    commit,
    pending.input.expected_head,
  );
  if (!updated) {
    return failure(
      "integration.cas_lost",
      "canonical ref changed before finalization compare-and-swap",
      pending.input.target_ref,
    );
  }
  return success({
    schema_version: "1.0.0",
    status: "integrated_verified",
    root_id: pending.input.task_packet.root.id,
    task_id: pending.input.task_packet.task_id,
    packet_id: pending.input.task_packet.packet_id,
    claim_id: pending.input.task_packet.claim.id,
    previous_revision: pending.input.expected_head,
    original_base_revision: pending.input.completion_packet.original_base_revision,
    integration_base_revision: pending.input.expected_head,
    worker_head_revision: pending.input.completion_packet.worker_head_revision,
    reconciled_head_revision: pending.reconciliation.reconciled_head_revision,
    commit_revision: commit,
    evidence_id: sources.value.audit.record.id,
    audit_manifest_path: auditManifestPath(pending.input.task_packet.packet_id),
    audit_manifest_hash: sources.value.audit.manifest_hash,
    completion_archive_manifest_hash: sources.value.archive.receipt.manifest_hash,
    archive_manifest_hashes: [sources.value.archive.receipt.manifest_hash],
    gate_evidence_hashes: pending.gate_evidence_hashes,
    generated_view_hashes: viewHashes,
    transaction_audit_path: audit.write.relative_path,
    transaction_audit_hash: audit.hash,
    integrated_at: integratedAt,
  });
}

export async function finalizeSingleRepoTransaction(
  dependencies: SingleRepoFinalizerDependencies,
  pending: PendingIntegration,
  bindings: ValidatedBindings,
): Promise<RuntimeResult<IntegrationReceipt>> {
  if (dependencies.temporary_root.protocol !== "file:") {
    return failure(
      "integration.temporary_root_invalid",
      "integration temporary root must be a file URL",
    );
  }
  const repoPath = fileURLToPath(pending.input.root);
  const temporaryPath = fileURLToPath(dependencies.temporary_root);
  if (isSameOrChildPath(repoPath, temporaryPath)) {
    return failure(
      "integration.temporary_root_invalid",
      "integration temporary root must remain outside the repository",
    );
  }
  let generatedRoot: URL | null = null;
  let worktree: URL | null = null;
  let worktreeCreated = false;
  let result: RuntimeResult<IntegrationReceipt>;
  const cleanup: RuntimeIssue[] = [];
  try {
    await mkdir(dependencies.temporary_root, { recursive: true });
    const generated = await mkdtemp(path.join(temporaryPath, "single-repo-"));
    generatedRoot = pathToFileURL(`${generated}${path.sep}`);
    worktree = new URL("worktree/", generatedRoot);
    await dependencies.git.createDetachedWorktree(
      pending.input.root,
      pending.reconciliation.reconciled_head_revision,
      worktree,
    );
    worktreeCreated = true;
    result = await executeInWorktree(dependencies, pending, bindings, worktree);
  } catch (error: unknown) {
    result = failure(
      "integration.finalization_failed",
      error instanceof Error ? error.message : String(error),
      pending.input.task_packet.task_id,
    );
  } finally {
    if (worktreeCreated && worktree !== null) {
      try {
        await dependencies.git.removeWorktree(pending.input.root, worktree);
      } catch (error: unknown) {
        cleanup.push(cleanupIssue("integration.worktree_cleanup_failed", error, worktree.href));
      }
    }
    if (generatedRoot !== null) {
      try {
        await rm(generatedRoot, { recursive: true, force: true });
      } catch (error: unknown) {
        cleanup.push(cleanupIssue("integration.temporary_cleanup_failed", error, generatedRoot.href));
      }
    }
  }
  return withCleanup(result, cleanup);
}
