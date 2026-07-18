import {
  canonicalJson,
  canonicalMutationPlanHash,
  decodeStrictUtf8,
  failure,
  parseJsonDocument,
  sha256,
  success,
  validateWithSchema,
  type CanonicalMutationPlan,
  type PlannedWrite,
  type RuntimeResult,
} from "../../index.js";
import {
  AcceptedProfileSourceSetSchema,
  type AcceptedProfileSourceSet,
  type ProfileMutationMetadata,
} from "../../profile/contracts/index.js";
import {
  CanonicalRecordSchema,
  GovernanceEventSchema,
  type CanonicalRecord,
  type GovernanceEvent,
} from "../contracts/index.js";
import { eventPath } from "../events/append-only-event-store.js";
import { signEvent } from "../events/event-chain-verifier.js";
import type { PreparedBootstrapMutation } from "./bootstrap-transaction.js";
import {
  bootstrapCanonicalApproval,
  bootstrapExactAcceptedSources,
  bootstrapPlanHashes,
  bootstrapProfileMetadata,
  scanBootstrapWrites,
  validateBootstrapApproval,
  type BootstrapMutationMetadata,
} from "./bootstrap-plan.js";

const SHA256 = /^[0-9a-f]{64}$/;

function exactStrings(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson([...left]) === canonicalJson([...right]);
}

function metadataFrom(plan: CanonicalMutationPlan<unknown>): RuntimeResult<BootstrapMutationMetadata> {
  const raw = plan.metadata as Partial<BootstrapMutationMetadata>;
  const base = bootstrapProfileMetadata(plan);
  if (!base.ok) return base;
  const accepted = validateWithSchema<AcceptedProfileSourceSet>(
    AcceptedProfileSourceSetSchema.$id,
    raw.accepted_sources,
  );
  const stringArray = (value: unknown): value is readonly string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");
  const hashMap = (value: unknown): value is Readonly<Record<string, string>> =>
    typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string" && SHA256.test(item));
  if (
    !accepted.ok || raw.governance_kind !== "bootstrap" ||
    typeof raw.repository !== "string" || !SHA256.test(raw.compilation_plan_hash ?? "") ||
    !SHA256.test(raw.source_proposal_hash ?? "") || !SHA256.test(raw.catalog_lock_hash ?? "") ||
    !stringArray(raw.compiler_write_paths) || !stringArray(raw.audit_write_paths) ||
    !hashMap(raw.planned_content_hashes) || !SHA256.test(raw.bootstrap_content_hash ?? "") ||
    typeof raw.approval_record_id !== "string" || !SHA256.test(raw.approval_record_hash ?? "") ||
    typeof raw.evidence_record_id !== "string" || !SHA256.test(raw.evidence_record_hash ?? "") ||
    typeof raw.bootstrap_event_path !== "string" || !SHA256.test(raw.bootstrap_event_hash ?? "") ||
    !stringArray(raw.required_approval_ids) || !stringArray(raw.required_evidence_ids) ||
    !Array.isArray(raw.checks) || !stringArray(raw.remaining_risks)
  ) {
    return failure("bootstrap.metadata_invalid", "augmented bootstrap metadata is malformed");
  }
  return success({ ...raw, ...base.value, accepted_sources: accepted.value } as BootstrapMutationMetadata);
}

function documentAt<T>(
  writes: readonly PlannedWrite[],
  relativePath: string,
  schemaId: `project-memory/v1/${string}`,
): RuntimeResult<T> {
  const write = writes.find((candidate) => candidate.relative_path === relativePath);
  if (write === undefined || write.mode !== "create" || write.expected_existing_sha256 !== null) {
    return failure(
      "bootstrap.audit_write_invalid",
      "bootstrap audit write is missing or not create-only",
      relativePath,
    );
  }
  const decoded = decodeStrictUtf8(write.bytes, relativePath);
  if (!decoded.ok) return decoded;
  const parsed = parseJsonDocument(decoded.value, relativePath);
  if (!parsed.ok) return parsed;
  const validated = validateWithSchema<T>(schemaId, parsed.value);
  if (!validated.ok) return validated;
  return canonicalJson(validated.value) === decoded.value
    ? success(validated.value)
    : failure(
        "bootstrap.audit_write_noncanonical",
        "bootstrap audit JSON must be canonical",
        relativePath,
      );
}

function expectedAuditDocuments(
  plan: CanonicalMutationPlan<unknown>,
  metadata: BootstrapMutationMetadata,
  compilationWrites: readonly PlannedWrite[],
): { readonly evidence: CanonicalRecord; readonly event: GovernanceEvent } {
  const compilerHashes = bootstrapPlanHashes(compilationWrites);
  const evidence: CanonicalRecord = {
    id: metadata.evidence_record_id,
    type: "evidence",
    title: "Project Memory bootstrap evidence",
    status: "accepted",
    root_id: plan.root_id,
    component_ids: [],
    initiative_id: null,
    workstream_id: null,
    task_id: null,
    actor_id: plan.created_by,
    authority_class: "integrator",
    created_at: plan.created_at,
    original_base_revision: plan.expected_head,
    integration_base_revision: plan.expected_head,
    catalog_versions: [metadata.profile.catalog.release],
    relationships: [{
      type: "evidences",
      target_id: metadata.approval_record_id,
      note: null,
    }],
    payload: {
      evidence_type: "bootstrap-preflight",
      exact_result: canonicalJson({
        parent_revision: plan.expected_head,
        target_ref: plan.target_ref,
        root_id: plan.root_id,
        compilation_plan_hash: plan.plan_hash,
        source_proposal_hash: metadata.source_proposal_hash,
        profile_lock_hash: plan.profile_lock_hash,
        catalog_lock_hash: metadata.catalog_lock_hash,
        planned_content_hashes: compilerHashes,
        approval_record_id: metadata.approval_record_id,
        checks: ["clean", "uninitialized", "bound", "approved", "secret-free"],
        remaining_risks: [],
      }),
      source_refs: [
        `git:${plan.expected_head}`,
        `ref:${plan.target_ref}`,
        `plan:${plan.plan_hash}`,
      ],
      hashes: {
        compilation_plan: plan.plan_hash,
        source_proposal: metadata.source_proposal_hash,
        profile_lock: plan.profile_lock_hash,
        catalog_lock: metadata.catalog_lock_hash,
        planned_content_set: sha256(canonicalJson(compilerHashes)),
      },
      not_run_reason: null,
    },
  };
  const event = signEvent({
    aggregate_id: plan.root_id,
    event_type: "bootstrap_initialized",
    occurred_at: plan.created_at,
    actor_id: plan.created_by,
    authority_class: "integrator",
    evidence_ids: [metadata.evidence_record_id],
    payload: {
      root_id: plan.root_id,
      target_ref: plan.target_ref,
      parent_revision: plan.expected_head,
      compilation_plan_hash: plan.plan_hash,
      source_proposal_hash: metadata.source_proposal_hash,
      profile_lock_hash: plan.profile_lock_hash,
      catalog_lock_hash: metadata.catalog_lock_hash,
      approval_record_id: metadata.approval_record_id,
    },
  }, null);
  return { evidence, event };
}

export function validateAugmentedBootstrapPlan(
  plan: CanonicalMutationPlan<unknown>,
  now: Date,
): RuntimeResult<PreparedBootstrapMutation> {
  const metadata = metadataFrom(plan);
  if (!metadata.ok) return metadata;
  let repository: URL;
  try {
    repository = new URL(metadata.value.repository);
  } catch {
    return failure("bootstrap.metadata_invalid", "bootstrap repository binding is not a URL");
  }
  const compilerWrites = metadata.value.compiler_write_paths.map((relativePath) =>
    plan.writes.find((write) => write.relative_path === relativePath),
  );
  const auditWrites = metadata.value.audit_write_paths.map((relativePath) =>
    plan.writes.find((write) => write.relative_path === relativePath),
  );
  if (
    compilerWrites.some((write) => write === undefined) ||
    auditWrites.some((write) => write === undefined) ||
    new Set([
      ...metadata.value.compiler_write_paths,
      ...metadata.value.audit_write_paths,
    ]).size !== plan.writes.length
  ) {
    return failure(
      "bootstrap.write_partition_invalid",
      "bootstrap writes are not exactly partitioned",
    );
  }
  const compilationWrites = compilerWrites as PlannedWrite[];
  const canonicalAuditWrites = auditWrites as PlannedWrite[];
  const originalMetadata: ProfileMutationMetadata = {
    project_hash: metadata.value.project_hash,
    profile: metadata.value.profile,
    selected_catalog_lock: metadata.value.selected_catalog_lock,
    profile_lock: metadata.value.profile_lock,
  };
  const originalBody: Omit<CanonicalMutationPlan<ProfileMutationMetadata>, "plan_hash"> = {
    ...plan,
    writes: compilationWrites,
    record_ids: [],
    event_ids: [],
    approval_ids: [metadata.value.approval_record_id],
    evidence_ids: [],
    metadata: originalMetadata,
  };
  if (
    plan.mutation_kind !== "profile.bootstrap" ||
    canonicalMutationPlanHash(originalBody) !== metadata.value.compilation_plan_hash ||
    sha256(canonicalJson(metadata.value.accepted_sources)) !== metadata.value.source_proposal_hash ||
    metadata.value.profile_lock.lock_hash !== plan.profile_lock_hash ||
    metadata.value.selected_catalog_lock.lock_hash !== metadata.value.catalog_lock_hash ||
    canonicalJson(bootstrapPlanHashes(plan.writes)) !==
      canonicalJson(metadata.value.planned_content_hashes) ||
    sha256(canonicalJson(metadata.value.planned_content_hashes)) !==
      metadata.value.bootstrap_content_hash ||
    !exactStrings(plan.approval_ids, [metadata.value.approval_record_id]) ||
    !exactStrings(plan.evidence_ids, [metadata.value.evidence_record_id])
  ) {
    return failure(
      "bootstrap.plan_binding_invalid",
      "augmented bootstrap plan bindings drifted",
    );
  }
  const approvalPath =
    `docs/project-memory/records/approvals/${metadata.value.approval_record_id}.json`;
  const evidencePath =
    `docs/project-memory/records/evidence/${metadata.value.evidence_record_id}.json`;
  const approval = documentAt<CanonicalRecord>(
    plan.writes,
    approvalPath,
    CanonicalRecordSchema.$id,
  );
  const evidence = documentAt<CanonicalRecord>(
    plan.writes,
    evidencePath,
    CanonicalRecordSchema.$id,
  );
  const event = documentAt<GovernanceEvent>(
    plan.writes,
    metadata.value.bootstrap_event_path,
    GovernanceEventSchema.$id,
  );
  if (!approval.ok) return approval;
  if (!evidence.ok) return evidence;
  if (!event.ok) return event;
  const exactApproval = bootstrapCanonicalApproval(approval.value);
  if (!exactApproval.ok) return exactApproval;
  const originalPlan = {
    ...originalBody,
    plan_hash: metadata.value.compilation_plan_hash,
  };
  const approvalValid = validateBootstrapApproval(
    exactApproval.value,
    repository,
    originalPlan,
    metadata.value.source_proposal_hash,
    metadata.value.profile.catalog.release,
    now,
  );
  if (!approvalValid.ok) return approvalValid;
  const expected = expectedAuditDocuments(originalPlan, metadata.value, compilationWrites);
  if (
    canonicalJson(evidence.value) !== canonicalJson(expected.evidence) ||
    canonicalJson(event.value) !== canonicalJson(expected.event) ||
    event.value.event_hash !== metadata.value.bootstrap_event_hash ||
    eventPath(event.value) !== metadata.value.bootstrap_event_path ||
    sha256(new TextEncoder().encode(canonicalJson(exactApproval.value))) !==
      metadata.value.approval_record_hash ||
    sha256(new TextEncoder().encode(canonicalJson(evidence.value))) !==
      metadata.value.evidence_record_hash ||
    !plan.record_ids.includes(exactApproval.value.id) ||
    !plan.record_ids.includes(evidence.value.id) ||
    !plan.event_ids.includes(event.value.event_hash)
  ) {
    return failure(
      "bootstrap.audit_binding_invalid",
      "bootstrap approval, evidence, or event binding drifted",
    );
  }
  const exactSources = bootstrapExactAcceptedSources(
    compilationWrites,
    metadata.value.accepted_sources,
    originalMetadata,
  );
  if (!exactSources.ok) return exactSources;
  const secrets = scanBootstrapWrites(plan.writes);
  return secrets.ok
    ? success({
        compilation_writes: compilationWrites,
        audit_writes: canonicalAuditWrites,
        evidence_id: metadata.value.evidence_record_id,
      })
    : secrets;
}

export function bootstrapMetadata(
  plan: CanonicalMutationPlan<unknown>,
): RuntimeResult<BootstrapMutationMetadata> {
  return metadataFrom(plan);
}

export function bootstrapAuditPath(rootId: string): string {
  return `docs/project-memory/governance/integration/bootstrap/${rootId}.json`;
}
