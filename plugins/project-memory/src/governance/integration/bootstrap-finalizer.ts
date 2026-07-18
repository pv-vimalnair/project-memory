import {
  canonicalJson,
  failure,
  sha256,
  success,
  validateWithSchema,
  type Clock,
  type RuntimeResult,
} from "../../index.js";
import {
  createProfileVerifier,
  type ProfileVerifier,
} from "../../profile/verify-profile.js";
import {
  BootstrapAuditManifestSchema,
  type BootstrapAuditManifest,
} from "../contracts/index.js";
import type { CanonicalMutationCoordinator } from "./canonical-mutation-finalizer.js";
import type { IntegrationGitClient } from "./integration-git-client.js";
import {
  bootstrapApprovalBinding,
  buildBootstrapMutationPlan,
  scanBootstrapWrites,
  validateBootstrapCompilationInput,
  type BootstrapFinalization,
  type BootstrapInput,
} from "./bootstrap-plan.js";
import {
  bootstrapAuditPath,
  bootstrapMetadata,
  validateAugmentedBootstrapPlan,
} from "./bootstrap-plan-validation.js";
import type {
  BootstrapAuditArtifact,
  BootstrapMutationHooks,
} from "./bootstrap-transaction.js";

export type {
  BootstrapApprovalBinding,
  BootstrapFinalization,
  BootstrapInput,
  BootstrapMutationMetadata,
} from "./bootstrap-plan.js";
export { bootstrapApprovalBinding };

export interface BootstrapGitClient extends IntegrationGitClient {
  readBlob(repo: URL, revision: string, relativePath: string): Promise<Uint8Array | null>;
}

export interface BootstrapFinalizer {
  bootstrap(input: BootstrapInput): Promise<RuntimeResult<BootstrapFinalization>>;
}

export interface BootstrapFinalizerDependencies {
  readonly clock: Clock;
  readonly git: BootstrapGitClient;
  readonly coordinator: CanonicalMutationCoordinator;
}

export interface BootstrapMutationHookDependencies {
  readonly git: BootstrapGitClient;
  readonly verifier?: ProfileVerifier;
}

const REVISION = /^[0-9a-f]{40}$/;

async function existingMemory(
  git: BootstrapGitClient,
  root: URL,
  revision: string,
): Promise<RuntimeResult<boolean>> {
  try {
    const [memory, context] = await Promise.all([
      git.listTree(root, revision, "docs/project-memory"),
      git.listTree(root, revision, "PROJECT_CONTEXT.md"),
    ]);
    return success(memory.length > 0 || context.includes("PROJECT_CONTEXT.md"));
  } catch (error: unknown) {
    return failure(
      "bootstrap.tree_read_failed",
      error instanceof Error ? error.message : String(error),
      revision,
    );
  }
}

async function preflightRepository(
  git: BootstrapGitClient,
  input: BootstrapInput,
): Promise<RuntimeResult<true>> {
  try {
    await git.commonGitDir(input.root);
  } catch (error: unknown) {
    return failure(
      "bootstrap.not_git_repository",
      error instanceof Error ? error.message : String(error),
      input.root.href,
    );
  }
  let resolved: string;
  try {
    resolved = await git.resolveRef(input.root, input.target_ref);
  } catch (error: unknown) {
    return failure(
      "bootstrap.target_ref_missing",
      error instanceof Error ? error.message : String(error),
      input.target_ref,
    );
  }
  const memory = await existingMemory(git, input.root, resolved);
  if (!memory.ok) return memory;
  if (memory.value) {
    return failure(
      "bootstrap.already_initialized",
      "repository already contains Project Memory bootstrap markers",
      input.target_ref,
    );
  }
  if (resolved !== input.expected_head) {
    return failure(
      "bootstrap.head_mismatch",
      "bootstrap target ref does not match the approved expected head",
      input.target_ref,
      [input.expected_head, resolved],
    );
  }
  try {
    const status = await git.statusPorcelain(input.root);
    if (status.length > 0) {
      return failure(
        "bootstrap.dirty_repository",
        "bootstrap requires a clean tracked and untracked repository state",
        input.root.href,
        status.flatMap((entry) =>
          entry.original_path === undefined
            ? [entry.path]
            : [entry.path, entry.original_path],
        ),
      );
    }
  } catch (error: unknown) {
    return failure(
      "bootstrap.status_failed",
      error instanceof Error ? error.message : String(error),
      input.root.href,
    );
  }
  return success(true);
}

async function validateWritePreconditions(
  git: BootstrapGitClient,
  input: BootstrapInput,
): Promise<RuntimeResult<true>> {
  for (const write of input.compilation_plan.writes) {
    let current: Uint8Array | null;
    try {
      current = await git.readBlob(
        input.root,
        input.expected_head,
        write.relative_path,
      );
    } catch (error: unknown) {
      return failure(
        "bootstrap.preimage_read_failed",
        error instanceof Error ? error.message : String(error),
        write.relative_path,
      );
    }
    const currentHash = current === null ? null : sha256(current);
    const valid = current === null
      ? write.expected_existing_sha256 === null && write.mode !== "replace"
      : write.expected_existing_sha256 === currentHash && write.mode !== "create";
    if (!valid) {
      return failure(
        "bootstrap.write_precondition_mismatch",
        "bootstrap compiler write precondition does not match the target tree",
        write.relative_path,
        [write.expected_existing_sha256 ?? "absent", currentHash ?? "absent"],
      );
    }
  }
  return success(true);
}

export function createBootstrapFinalizer(
  dependencies: BootstrapFinalizerDependencies,
): BootstrapFinalizer {
  return {
    async bootstrap(input) {
      const now = dependencies.clock.now();
      if (!Number.isFinite(now.getTime())) {
        return failure("bootstrap.clock_invalid", "bootstrap clock must be valid");
      }
      const repository = await preflightRepository(dependencies.git, input);
      if (!repository.ok) return repository;
      const validated = validateBootstrapCompilationInput(input, now);
      if (!validated.ok) return validated;
      const preconditions = await validateWritePreconditions(dependencies.git, input);
      if (!preconditions.ok) return preconditions;
      const plan = buildBootstrapMutationPlan(input, validated.value);
      if (!plan.ok) return plan;
      const receipt = await dependencies.coordinator.finalizeMutation(plan.value);
      if (!receipt.ok) return receipt;
      const auditPath = bootstrapAuditPath(input.root_id);
      const auditHash = receipt.value.audit_artifact_hashes[auditPath];
      if (
        auditHash === undefined ||
        receipt.value.audit_evidence_id !== plan.value.metadata.evidence_record_id
      ) {
        return failure(
          "bootstrap.receipt_invalid",
          "canonical finalizer returned an invalid bootstrap receipt",
          auditPath,
        );
      }
      return success({
        schema_version: "1.0.0",
        status: "initialized_verified",
        root_id: input.root_id,
        target_ref: input.target_ref,
        previous_revision: receipt.value.previous_revision,
        commit_revision: receipt.value.commit_revision,
        compilation_plan_hash: input.expected_plan_hash,
        source_proposal_hash: input.source_proposal_hash,
        profile_lock_hash: input.compilation_plan.profile_lock_hash,
        approval_record_id: input.approval_record.id,
        audit_record_id: receipt.value.audit_evidence_id,
        audit_path: auditPath,
        audit_hash: auditHash,
        generated_view_hashes: receipt.value.derived_view_hashes,
      });
    },
  };
}

async function recheckUnderLease(
  git: BootstrapGitClient,
  repo: URL,
  plan: Parameters<BootstrapMutationHooks["recheck"]>[1],
): Promise<RuntimeResult<true>> {
  const metadata = bootstrapMetadata(plan);
  if (!metadata.ok) return metadata;
  if (metadata.value.repository !== repo.href) {
    return failure(
      "bootstrap.repository_binding_mismatch",
      "bootstrap coordinator repository differs from the approved repository",
      repo.href,
    );
  }
  let current: string;
  try {
    current = await git.resolveRef(repo, plan.target_ref);
  } catch (error: unknown) {
    return failure(
      "bootstrap.target_ref_missing",
      error instanceof Error ? error.message : String(error),
      plan.target_ref,
    );
  }
  const memory = await existingMemory(git, repo, current);
  if (!memory.ok) return memory;
  if (memory.value) {
    return failure(
      "bootstrap.already_initialized",
      "repository acquired Project Memory before bootstrap finalization",
      plan.target_ref,
    );
  }
  return current === plan.expected_head
    ? success(true)
    : failure(
        "bootstrap.head_mismatch",
        "bootstrap target ref changed after approval",
        plan.target_ref,
      );
}

function auditArtifact(input: Parameters<BootstrapMutationHooks["buildAudit"]>[0]) {
  const metadata = bootstrapMetadata(input.plan);
  if (!metadata.ok) return metadata;
  if (!REVISION.test(input.source_tree)) {
    return failure(
      "bootstrap.source_tree_invalid",
      "bootstrap audit requires a full pre-view source tree object ID",
    );
  }
  const checks: BootstrapAuditManifest["checks"] = [
    ...metadata.value.checks,
    { id: "profile_verification", status: "passed", evidence_id: metadata.value.evidence_record_id },
    { id: "repository_validation", status: "passed", evidence_id: metadata.value.evidence_record_id },
  ];
  const manifest: BootstrapAuditManifest = {
    schema_version: "1.0.0",
    root_id: input.plan.root_id,
    target_ref: input.plan.target_ref,
    parent_revision: input.plan.expected_head,
    compilation_plan_hash: metadata.value.compilation_plan_hash,
    source_proposal_hash: metadata.value.source_proposal_hash,
    profile_lock_hash: input.plan.profile_lock_hash,
    catalog_lock_hash: metadata.value.catalog_lock_hash,
    approval_record_id: metadata.value.approval_record_id,
    evidence_record_id: metadata.value.evidence_record_id,
    bootstrap_event_hash: metadata.value.bootstrap_event_hash,
    planned_content_hashes: metadata.value.planned_content_hashes,
    generated_view_hashes: input.generated_view_hashes,
    bootstrap_content_hash: metadata.value.bootstrap_content_hash,
    checks,
    remaining_risks: [...metadata.value.remaining_risks],
    created_at: input.created_at,
    created_by: input.created_by,
  };
  const valid = validateWithSchema<BootstrapAuditManifest>(
    BootstrapAuditManifestSchema.$id,
    manifest,
  );
  if (!valid.ok) return valid;
  const relativePath = bootstrapAuditPath(input.plan.root_id);
  const bytes = new TextEncoder().encode(canonicalJson(valid.value));
  const secrets = scanBootstrapWrites([{
    relative_path: relativePath,
    bytes,
    expected_existing_sha256: null,
    mode: "create",
  }]);
  if (!secrets.ok) return secrets;
  return success<BootstrapAuditArtifact>({
    evidence_id: metadata.value.evidence_record_id,
    relative_path: relativePath,
    bytes,
    hash: sha256(bytes),
  });
}

export function createBootstrapMutationHooks(
  dependencies: BootstrapMutationHookDependencies,
): BootstrapMutationHooks {
  const verifier = dependencies.verifier ?? createProfileVerifier();
  return {
    recheck: (repo, plan) => recheckUnderLease(dependencies.git, repo, plan),
    validate: validateAugmentedBootstrapPlan,
    async verifyProfile(worktree, plan) {
      const metadata = bootstrapMetadata(plan);
      if (!metadata.ok) return metadata;
      const report = await verifier.verify(worktree);
      if (!report.ok) return report;
      return report.value.valid &&
        report.value.root_id === plan.root_id &&
        report.value.profile_lock_hash === plan.profile_lock_hash &&
        report.value.selected_catalog_lock_hash === metadata.value.catalog_lock_hash
        ? success(true)
        : failure(
            "bootstrap.profile_verification_failed",
            "verified profile report does not bind the bootstrap plan",
            plan.plan_id,
          );
    },
    buildAudit: auditArtifact,
  };
}
