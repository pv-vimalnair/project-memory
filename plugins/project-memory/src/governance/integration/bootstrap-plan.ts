import {
  canonicalJson,
  canonicalMutationPlanHash,
  decodeStrictUtf8,
  failure,
  parseYamlDocument,
  sha256,
  success,
  validateWithSchema,
  type CanonicalMutationPlan,
  type PlannedWrite,
  type RuntimeResult,
} from "../../index.js";
import { renderAcceptedProfileSources } from "../../materialize/render-project-source.js";
import { PROJECT_SELECTION_PATH } from "../../profile/build-profile-lock.js";
import {
  AcceptedProfileSourceSetSchema,
  ProfileMutationMetadataSchema,
  ProjectSelectionSchema,
  type AcceptedProfileSourceSet,
  type ProfileMutationMetadata,
  type ProjectSelection,
} from "../../profile/contracts/index.js";
import { redactArchiveBytes } from "../archive/redactor.js";
import {
  CanonicalRecordSchema,
  type BootstrapAuditManifest,
  type CanonicalRecord,
  type ApprovalRecordPayload,
} from "../contracts/index.js";
import { eventPath } from "../events/append-only-event-store.js";
import { signEvent } from "../events/event-chain-verifier.js";
import { recordWrite } from "../records/record-path.js";
import { validateCanonicalMutationPlan } from "./canonical-mutation-validation.js";
export interface BootstrapInput {
  readonly root: URL;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly root_id: string;
  readonly accepted_sources: AcceptedProfileSourceSet;
  readonly compilation_plan: CanonicalMutationPlan<unknown>;
  readonly expected_plan_hash: string;
  readonly source_proposal_hash: string;
  readonly approval_record: CanonicalRecord;
}

export interface BootstrapFinalization {
  readonly schema_version: "1.0.0";
  readonly status: "initialized_verified";
  readonly root_id: string;
  readonly target_ref: string;
  readonly previous_revision: string;
  readonly commit_revision: string;
  readonly compilation_plan_hash: string;
  readonly source_proposal_hash: string;
  readonly profile_lock_hash: string;
  readonly approval_record_id: string;
  readonly audit_record_id: string;
  readonly audit_path: string;
  readonly audit_hash: string;
  readonly generated_view_hashes: Readonly<Record<string, string>>;
}

export interface BootstrapApprovalBinding {
  readonly target: string;
  readonly environment: string;
  readonly scope: readonly string[];
  readonly timing: string;
}

export interface BootstrapMutationMetadata extends ProfileMutationMetadata {
  readonly governance_kind: "bootstrap";
  readonly repository: string;
  readonly accepted_sources: AcceptedProfileSourceSet;
  readonly compilation_plan_hash: string;
  readonly source_proposal_hash: string;
  readonly catalog_lock_hash: string;
  readonly compiler_write_paths: readonly string[];
  readonly audit_write_paths: readonly string[];
  readonly planned_content_hashes: Readonly<Record<string, string>>;
  readonly bootstrap_content_hash: string;
  readonly approval_record_id: string;
  readonly approval_record_hash: string;
  readonly evidence_record_id: string;
  readonly evidence_record_hash: string;
  readonly bootstrap_event_path: string;
  readonly bootstrap_event_hash: string;
  readonly required_approval_ids: readonly string[];
  readonly required_evidence_ids: readonly string[];
  readonly checks: BootstrapAuditManifest["checks"];
  readonly remaining_risks: readonly string[];
}

type ApprovalRecord = CanonicalRecord & { readonly type: "approval"; readonly payload: ApprovalRecordPayload };
export interface ValidatedBootstrapCompilation {
  readonly profile_metadata: ProfileMutationMetadata;
  readonly approval_record: ApprovalRecord;
}
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function exactStrings(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson([...left]) === canonicalJson([...right]);
}

export function bootstrapApprovalBinding(input: {
  readonly root: URL;
  readonly target_ref: string;
  readonly root_id: string;
  readonly profile_lock_hash: string;
  readonly source_proposal_hash: string;
  readonly compilation_plan_hash: string;
  readonly created_at: string;
  readonly expires_at: string;
}): BootstrapApprovalBinding {
  return {
    target: `repository:${input.root.href}`,
    environment: `git-ref:${input.target_ref}`,
    scope: [
      `compilation-plan:${input.compilation_plan_hash}`,
      `profile-lock:${input.profile_lock_hash}`,
      `repository:${input.root.href}`,
      `root:${input.root_id}`,
      `source-proposal:${input.source_proposal_hash}`,
      `target-ref:${input.target_ref}`,
    ].sort(compareUtf8),
    timing: `window:${input.created_at}/${input.expires_at}`,
  };
}

export function bootstrapProfileMetadata(plan: CanonicalMutationPlan<unknown>): RuntimeResult<ProfileMutationMetadata> {
  const raw = plan.metadata as Readonly<Record<string, unknown>>;
  return validateWithSchema<ProfileMutationMetadata>(ProfileMutationMetadataSchema.$id, {
    project_hash: raw.project_hash,
    profile: raw.profile,
    selected_catalog_lock: raw.selected_catalog_lock,
    profile_lock: raw.profile_lock,
  });
}

export function bootstrapCanonicalApproval(
  value: unknown,
): RuntimeResult<ApprovalRecord> {
  const record = validateWithSchema<CanonicalRecord>(CanonicalRecordSchema.$id, value);
  if (!record.ok) return record;
  return record.value.type === "approval"
    ? success(record.value as ApprovalRecord)
    : failure("bootstrap.approval_invalid", "bootstrap requires an approval record");
}

export function validateBootstrapApproval(
  record: ApprovalRecord,
  root: URL,
  plan: CanonicalMutationPlan<unknown>,
  sourceProposalHash: string,
  catalogRelease: string,
  now: Date,
): RuntimeResult<true> {
  const expected = bootstrapApprovalBinding({
    root,
    target_ref: plan.target_ref,
    root_id: plan.root_id,
    profile_lock_hash: plan.profile_lock_hash,
    source_proposal_hash: sourceProposalHash,
    compilation_plan_hash: plan.plan_hash,
    created_at: plan.created_at,
    expires_at: plan.expires_at,
  });
  const payload = record.payload;
  const created = Date.parse(record.created_at);
  const expires = Date.parse(payload.expires_at ?? "");
  if (
    record.status !== "accepted" ||
    record.root_id !== plan.root_id ||
    record.actor_id !== "Pitaji" ||
    record.authority_class !== "pitaji" ||
    record.original_base_revision !== plan.expected_head ||
    record.integration_base_revision !== plan.expected_head ||
    record.component_ids.length !== 0 ||
    record.initiative_id !== null ||
    record.workstream_id !== null ||
    record.task_id !== null ||
    record.relationships.length !== 0 ||
    !exactStrings(record.catalog_versions, [catalogRelease]) ||
    payload.approval_kind !== "directional" ||
    payload.granted_by !== "Pitaji" ||
    payload.target !== expected.target ||
    payload.environment !== expected.environment ||
    !exactStrings(payload.scope, expected.scope) ||
    payload.timing !== expected.timing ||
    payload.expires_at !== plan.expires_at ||
    !Number.isFinite(created) ||
    !Number.isFinite(expires) ||
    created > now.getTime() ||
    expires <= now.getTime()
  ) {
    return failure(
      "bootstrap.approval_invalid",
      "bootstrap approval must be current Pitaji authority with exact repository, ref, root, hash, and time bindings",
      record.id,
    );
  }
  return success(true);
}

function compilerOwnedPath(relativePath: string): boolean {
  if (relativePath.startsWith("docs/project-memory/views/")) return false;
  const dynamic = [
    "docs/project-memory/initiatives/",
    "docs/project-memory/workstreams/",
    "docs/project-memory/records/",
    "docs/project-memory/governance/",
    "docs/project-memory/archive/",
  ];
  return !dynamic.some((root) =>
    relativePath.startsWith(root) && !relativePath.endsWith("/.gitkeep"),
  );
}

export function bootstrapExactAcceptedSources(
  writes: readonly PlannedWrite[],
  sources: AcceptedProfileSourceSet,
  metadata: ProfileMutationMetadata,
): RuntimeResult<true> {
  const sourceSet = validateWithSchema<AcceptedProfileSourceSet>(
    AcceptedProfileSourceSetSchema.$id,
    sources,
  );
  if (!sourceSet.ok) return sourceSet;
  const projectWrite = writes.find((write) => write.relative_path === PROJECT_SELECTION_PATH);
  if (projectWrite === undefined) {
    return failure("bootstrap.source_artifact_invalid", "compiler plan omits project.yaml");
  }
  const decoded = decodeStrictUtf8(projectWrite.bytes, PROJECT_SELECTION_PATH);
  if (!decoded.ok) return decoded;
  const parsed = parseYamlDocument(decoded.value, PROJECT_SELECTION_PATH);
  if (!parsed.ok) return parsed;
  const selection = validateWithSchema<ProjectSelection>(ProjectSelectionSchema.$id, parsed.value);
  if (!selection.ok) return selection;
  const rendered = renderAcceptedProfileSources(selection.value, sourceSet.value, metadata.profile);
  if (!rendered.ok) return rendered;
  const expectedPaths = rendered.value.map((write) => write.relative_path).sort(compareUtf8);
  const actualPaths = writes
    .filter((write) => (write.relative_path.startsWith("docs/project-memory/source/") && !write.relative_path.endsWith("/.gitkeep")) || /^docs\/project-memory\/components\/[^/]+\/COMPONENT[.]md$/u.test(write.relative_path) || /^docs\/project-memory\/domains\/[^/]+\/DOMAIN[.]md$/u.test(write.relative_path))
    .map((write) => write.relative_path)
    .sort(compareUtf8);
  if (!exactStrings(actualPaths, expectedPaths)) {
    return failure(
      "bootstrap.source_artifact_invalid",
      "compiler source paths do not exactly represent the accepted source set", "", [canonicalJson(expectedPaths), canonicalJson(actualPaths)],
    );
  }
  for (const expected of rendered.value) {
    const actual = writes.find((write) => write.relative_path === expected.relative_path);
    if (actual === undefined || !Buffer.from(actual.bytes).equals(Buffer.from(expected.bytes))) {
      return failure(
        "bootstrap.source_artifact_invalid",
        "compiler source bytes do not exactly represent the accepted source set",
        expected.relative_path,
      );
    }
  }
  return success(true);
}

export function scanBootstrapWrites(writes: readonly PlannedWrite[]): RuntimeResult<true> {
  for (const write of writes) {
    const scanned = redactArchiveBytes(write.bytes);
    if (!scanned.ok || scanned.value.report.redacted) {
      return failure(
        "bootstrap.secret_detected",
        "bootstrap candidate bytes contain or may contain credential material",
        write.relative_path,
        scanned.ok ? scanned.value.report.rule_ids : scanned.issues.map((issue) => issue.code),
      );
    }
  }
  return success(true);
}

export function validateBootstrapCompilationInput(
  input: BootstrapInput,
  now: Date,
): RuntimeResult<ValidatedBootstrapCompilation> {
  const plan = input.compilation_plan;
  const validPlan = validateCanonicalMutationPlan(plan, now);
  if (!validPlan.ok) return validPlan;
  if (
    input.root.protocol !== "file:" ||
    plan.mutation_kind !== "profile.bootstrap" ||
    plan.root_id !== input.root_id ||
    plan.target_ref !== input.target_ref ||
    plan.expected_head !== input.expected_head ||
    plan.plan_hash !== input.expected_plan_hash ||
    plan.record_ids.length !== 0 ||
    plan.event_ids.length !== 0 ||
    plan.evidence_ids.length !== 0 ||
    plan.writes.some((write) => !compilerOwnedPath(write.relative_path))
  ) {
    return failure(
      "bootstrap.plan_binding_invalid",
      "bootstrap compilation plan has invalid kind, root, ref, head, references, or compiler-owned paths",
      plan.plan_id,
    );
  }
  const metadata = bootstrapProfileMetadata(plan);
  if (!metadata.ok) return metadata;
  if (
    metadata.value.profile_lock.lock_hash !== plan.profile_lock_hash ||
    metadata.value.profile.root.id !== plan.root_id
  ) {
    return failure("bootstrap.profile_binding_invalid", "profile metadata does not bind the plan");
  }
  const expectedSourceHash = sha256(canonicalJson(input.accepted_sources));
  if (input.source_proposal_hash !== expectedSourceHash) {
    return failure(
      "bootstrap.source_proposal_hash_mismatch",
      "accepted profile sources do not match the approved source proposal hash",
    );
  }
  const approval = bootstrapCanonicalApproval(input.approval_record);
  if (!approval.ok) return approval;
  if (
    !exactStrings(plan.approval_ids, [approval.value.id])
  ) {
    return failure("bootstrap.approval_invalid", "compiler and profile approval IDs must be exact");
  }
  const validApproval = validateBootstrapApproval(
    approval.value,
    input.root,
    plan,
    input.source_proposal_hash,
    metadata.value.profile.catalog.release,
    now,
  );
  if (!validApproval.ok) return validApproval;
  const exactSources = bootstrapExactAcceptedSources(plan.writes, input.accepted_sources, metadata.value);
  if (!exactSources.ok) return exactSources;
  const secrets = scanBootstrapWrites(plan.writes);
  if (!secrets.ok) return secrets;
  return success({ profile_metadata: metadata.value, approval_record: approval.value });
}

export function bootstrapPlanHashes(writes: readonly PlannedWrite[]): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...writes]
      .sort((left, right) => compareUtf8(left.relative_path, right.relative_path))
      .map((write) => [write.relative_path, sha256(write.bytes)]),
  );
}

function deterministicId(prefix: "EVD", hash: string): string {
  let value = BigInt(`0x${hash.slice(0, 32)}`);
  let encoded = "";
  for (let index = 0; index < 26; index += 1) {
    encoded = `${CROCKFORD[Number(value & 31n)] ?? "0"}${encoded}`;
    value >>= 5n;
  }
  return `${prefix}-${encoded}`;
}

function jsonWrite(relativePath: string, value: unknown): PlannedWrite {
  return {
    relative_path: relativePath,
    bytes: new TextEncoder().encode(canonicalJson(value)),
    expected_existing_sha256: null,
    mode: "create",
  };
}

export function buildBootstrapMutationPlan(
  input: BootstrapInput,
  validated: ValidatedBootstrapCompilation,
): RuntimeResult<CanonicalMutationPlan<BootstrapMutationMetadata>> {
  const plan = input.compilation_plan;
  const compilerHashes = bootstrapPlanHashes(plan.writes);
  const evidenceId = deterministicId("EVD", sha256(canonicalJson({
    parent_revision: plan.expected_head,
    target_ref: plan.target_ref,
    compilation_plan_hash: plan.plan_hash,
    source_proposal_hash: input.source_proposal_hash,
    approval_record_id: validated.approval_record.id,
    compiler_content_hashes: compilerHashes,
  })));
  const catalogHash = validated.profile_metadata.selected_catalog_lock.lock_hash;
  const evidence: CanonicalRecord = {
    id: evidenceId,
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
    catalog_versions: [validated.profile_metadata.profile.catalog.release],
    relationships: [{ type: "evidences", target_id: validated.approval_record.id, note: null }],
    payload: {
      evidence_type: "bootstrap-preflight",
      exact_result: canonicalJson({
        parent_revision: plan.expected_head,
        target_ref: plan.target_ref,
        root_id: plan.root_id,
        compilation_plan_hash: plan.plan_hash,
        source_proposal_hash: input.source_proposal_hash,
        profile_lock_hash: plan.profile_lock_hash,
        catalog_lock_hash: catalogHash,
        planned_content_hashes: compilerHashes,
        approval_record_id: validated.approval_record.id,
        checks: ["clean", "uninitialized", "bound", "approved", "secret-free"],
        remaining_risks: [],
      }),
      source_refs: [`git:${plan.expected_head}`, `ref:${plan.target_ref}`, `plan:${plan.plan_hash}`],
      hashes: {
        compilation_plan: plan.plan_hash,
        source_proposal: input.source_proposal_hash,
        profile_lock: plan.profile_lock_hash,
        catalog_lock: catalogHash,
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
    evidence_ids: [evidenceId],
    payload: {
      root_id: plan.root_id,
      target_ref: plan.target_ref,
      parent_revision: plan.expected_head,
      compilation_plan_hash: plan.plan_hash,
      source_proposal_hash: input.source_proposal_hash,
      profile_lock_hash: plan.profile_lock_hash,
      catalog_lock_hash: catalogHash,
      approval_record_id: validated.approval_record.id,
    },
  }, null);
  const approvalWrite = recordWrite(validated.approval_record);
  const evidenceWrite = recordWrite(evidence);
  const eventWrite = jsonWrite(eventPath(event), event);
  const writes = [...plan.writes, approvalWrite, evidenceWrite, eventWrite]
    .sort((left, right) => compareUtf8(left.relative_path, right.relative_path));
  const plannedContentHashes = bootstrapPlanHashes(writes);
  const checks: BootstrapAuditManifest["checks"] = [
    "git_repository", "clean_repository", "target_ref", "uninitialized",
    "compilation_plan", "write_preconditions", "source_proposal", "approval", "secret_scan",
  ].map((id) => ({ id, status: "passed" as const, evidence_id: evidenceId }));
  const metadata: BootstrapMutationMetadata = {
    ...validated.profile_metadata,
    governance_kind: "bootstrap",
    repository: input.root.href,
    accepted_sources: input.accepted_sources,
    compilation_plan_hash: plan.plan_hash,
    source_proposal_hash: input.source_proposal_hash,
    catalog_lock_hash: catalogHash,
    compiler_write_paths: plan.writes.map((write) => write.relative_path).sort(compareUtf8),
    audit_write_paths: [approvalWrite, evidenceWrite, eventWrite]
      .map((write) => write.relative_path).sort(compareUtf8),
    planned_content_hashes: plannedContentHashes,
    bootstrap_content_hash: sha256(canonicalJson(plannedContentHashes)),
    approval_record_id: validated.approval_record.id,
    approval_record_hash: sha256(approvalWrite.bytes),
    evidence_record_id: evidenceId,
    evidence_record_hash: sha256(evidenceWrite.bytes),
    bootstrap_event_path: eventWrite.relative_path,
    bootstrap_event_hash: event.event_hash,
    required_approval_ids: [validated.approval_record.id],
    required_evidence_ids: [evidenceId],
    checks,
    remaining_risks: [],
  };
  const withoutHash: Omit<CanonicalMutationPlan<BootstrapMutationMetadata>, "plan_hash"> = {
    ...plan,
    writes,
    record_ids: [validated.approval_record.id, evidenceId].sort(compareUtf8),
    event_ids: [event.event_hash],
    approval_ids: [validated.approval_record.id],
    evidence_ids: [evidenceId],
    metadata,
  };
  const augmented = { ...withoutHash, plan_hash: canonicalMutationPlanHash(withoutHash) };
  const valid = validateCanonicalMutationPlan(augmented, new Date(plan.created_at));
  if (!valid.ok) return valid;
  const secrets = scanBootstrapWrites(writes);
  return secrets.ok ? success(augmented) : secrets;
}
