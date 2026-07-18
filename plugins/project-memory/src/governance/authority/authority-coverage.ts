import {
  failure,
  success,
  type RuntimeResult,
} from "../../index.js";
import type {
  ApprovalRecordPayload,
  CanonicalRecord,
} from "../contracts/index.js";
import { validateClaimAndApprovals } from "../../planning/validate-claim-approval.js";
import { validateCompletionPacket } from "../../planning/validate-completion-packet.js";
import type {
  Approval,
  Claim,
  CompletionPacket,
  TaskPacket,
} from "../../planning/types.js";

export const AUTHORITY_RANK = {
  worker: 1,
  validator: 2,
  integrator: 3,
  pitaji: 4,
} as const;

export type AuthorityRole = keyof typeof AUTHORITY_RANK;
export type DirectionalCategory =
  | "directional"
  | "root_profile"
  | "security_privacy"
  | "pricing_business";

interface ApprovalEnvelope {
  readonly target: string;
  readonly environment: string;
  readonly scope: readonly string[];
  readonly timing: string;
}

export interface DirectionalAcceptance extends ApprovalEnvelope {
  readonly category: DirectionalCategory;
  readonly accepted_by: string;
  readonly accepted_by_authority: AuthorityRole;
}

export type ExternalActionExecution = ApprovalEnvelope;

export interface AuthorityCoverageInput {
  readonly task_packet: TaskPacket;
  readonly completion_packet: CompletionPacket;
  readonly evaluated_at: string;
  readonly expected_issuer: string;
  readonly current_base_revision: string;
  readonly conflicting_claims: readonly Claim[];
  readonly recorded_task_approvals: readonly Approval[];
  readonly available_evidence_ids: readonly string[];
  readonly approved_exception_ids: readonly string[];
  readonly actor_authority: AuthorityRole;
  readonly minimum_authority: AuthorityRole;
  readonly actual_changed_paths: readonly string[];
  readonly deleted_paths: readonly string[];
  readonly directional_acceptance: DirectionalAcceptance | null;
  readonly external_action: ExternalActionExecution | null;
  readonly canonical_approvals: readonly CanonicalRecord[];
}

export interface AuthorityCoverage {
  readonly claim_id: string;
  readonly covered_change_ids: readonly string[];
  readonly approval_ids: readonly string[];
  readonly effective_write_paths: readonly string[];
  readonly external_action_allowed: boolean;
  readonly directional_acceptance: "pitaji" | "not_applicable";
}

type ApprovalKind = ApprovalRecordPayload["approval_kind"];
type ApprovalRecord = CanonicalRecord & {
  readonly type: "approval";
  readonly payload: ApprovalRecordPayload;
};

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareUtf8);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(unique(left)) === JSON.stringify(unique(right));
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pathCovers(scope: string, candidate: string): boolean {
  if (scope === "**" || scope === candidate) return true;
  if (!scope.endsWith("/**")) return false;
  const base = scope.slice(0, -3);
  return candidate === base || candidate.startsWith(`${base}/`);
}

function approvalRecords(
  input: AuthorityCoverageInput,
): RuntimeResult<readonly ApprovalRecord[]> {
  const approvals = input.canonical_approvals.filter(
    (record): record is ApprovalRecord => record.type === "approval",
  );
  const ids = approvals.map((approval) => approval.id);
  if (new Set(ids).size !== ids.length) {
    return failure(
      "approval.duplicate",
      "canonical approval identifiers must be unique",
      input.task_packet.task_id,
    );
  }
  return success(approvals);
}

function currentApproval(
  record: ApprovalRecord,
  input: AuthorityCoverageInput,
  now: number,
): RuntimeResult<ApprovalRecord> {
  const created = timestamp(record.created_at);
  const expires =
    record.payload.expires_at === null
      ? null
      : timestamp(record.payload.expires_at);
  if (
    created === null ||
    created > now ||
    (record.payload.expires_at !== null && expires === null)
  ) {
    return failure(
      "approval.time_invalid",
      "canonical approval timestamps must be valid at evaluation time",
      record.id,
    );
  }
  if (expires !== null && expires <= now) {
    return failure("approval.expired", "canonical approval has expired", record.id);
  }
  if (
    record.root_id !== input.task_packet.root.id ||
    record.status !== "accepted" ||
    record.authority_class !== "pitaji" ||
    record.actor_id.trim().toLowerCase() !== "pitaji" ||
    record.payload.granted_by.trim().toLowerCase() !== "pitaji"
  ) {
    return failure(
      "approval.authority_invalid",
      "canonical approval must be accepted by Pitaji for the same root",
      record.id,
    );
  }
  return success(record);
}

function exactApproval(
  input: AuthorityCoverageInput,
  approvals: readonly ApprovalRecord[],
  kind: ApprovalKind,
  envelope: ApprovalEnvelope,
  missingCode: string,
): RuntimeResult<ApprovalRecord> {
  const candidates = approvals.filter(
    (record) => record.payload.approval_kind === kind,
  );
  if (candidates.length === 0) {
    return failure(missingCode, "required canonical Pitaji approval is missing", input.task_packet.task_id);
  }
  const target = candidates.filter((record) => record.payload.target === envelope.target);
  if (target.length === 0) {
    return failure("approval.target_drift", "approval target differs from the actual operation", candidates[0]?.id);
  }
  const environment = target.filter(
    (record) => record.payload.environment === envelope.environment,
  );
  if (environment.length === 0) {
    return failure("approval.environment_drift", "approval environment differs from the actual operation", target[0]?.id);
  }
  const scope = environment.filter((record) =>
    sameStrings(record.payload.scope, envelope.scope),
  );
  if (scope.length === 0) {
    return failure("approval.scope_drift", "approval scope differs from the actual operation", environment[0]?.id);
  }
  const timing = scope.filter((record) => record.payload.timing === envelope.timing);
  if (timing.length === 0) {
    return failure("approval.timing_drift", "approval timing differs from the actual operation", scope[0]?.id);
  }
  const now = timestamp(input.evaluated_at);
  if (now === null) {
    return failure("authority.now_invalid", "authority evaluation time is invalid");
  }
  for (const record of timing.sort((left, right) => compareUtf8(left.id, right.id))) {
    const valid = currentApproval(record, input, now);
    if (valid.ok) return valid;
    if (timing.length === 1) return valid;
  }
  return failure(missingCode, "no current canonical Pitaji approval covers the operation", input.task_packet.task_id);
}

function deletionApproval(
  input: AuthorityCoverageInput,
  approvals: readonly ApprovalRecord[],
): RuntimeResult<ApprovalRecord | null> {
  if (input.deleted_paths.length === 0) return success(null);
  const candidates = approvals.filter(
    (record) => record.payload.approval_kind === "destructive_deletion",
  );
  if (candidates.length === 0) {
    return failure(
      "authority.deletion_requires_pitaji",
      "destructive deletion requires a canonical Pitaji approval",
      input.task_packet.task_id,
      input.deleted_paths,
    );
  }
  const covering = candidates.filter((record) =>
    input.deleted_paths.every((path) =>
      record.payload.scope.some((scope) => pathCovers(scope, path)),
    ),
  );
  if (covering.length === 0) {
    return failure(
      "approval.scope_drift",
      "destructive deletion exceeds canonical approval scope",
      candidates[0]?.id,
      input.deleted_paths,
    );
  }
  const now = timestamp(input.evaluated_at);
  if (now === null) return failure("authority.now_invalid", "authority evaluation time is invalid");
  return currentApproval(covering.sort((left, right) => compareUtf8(left.id, right.id))[0] as ApprovalRecord, input, now);
}

function changedPaths(input: AuthorityCoverageInput): RuntimeResult<readonly string[]> {
  const reported = input.completion_packet.changes.flatMap((change) => change.files);
  if (
    new Set(input.actual_changed_paths).size !== input.actual_changed_paths.length ||
    !sameStrings(reported, input.actual_changed_paths)
  ) {
    return failure(
      "authority.changed_paths_drift",
      "actual changed paths must exactly equal the completion change inventory",
      input.task_packet.task_id,
      unique([...reported, ...input.actual_changed_paths]),
    );
  }
  if (
    new Set(input.deleted_paths).size !== input.deleted_paths.length ||
    input.deleted_paths.some((path) => !input.actual_changed_paths.includes(path))
  ) {
    return failure(
      "authority.deleted_paths_drift",
      "deleted paths must be a unique subset of actual changed paths",
      input.task_packet.task_id,
      input.deleted_paths,
    );
  }
  return success(unique(input.actual_changed_paths));
}

function directionKind(category: DirectionalCategory): ApprovalKind {
  if (category === "security_privacy") return "security_privacy";
  if (category === "pricing_business") return "pricing_business";
  return "directional";
}

function directionalApproval(
  input: AuthorityCoverageInput,
  approvals: readonly ApprovalRecord[],
): RuntimeResult<ApprovalRecord | null> {
  const acceptance = input.directional_acceptance;
  if (acceptance === null) return success(null);
  if (
    acceptance.accepted_by_authority !== "pitaji" ||
    acceptance.accepted_by.trim().toLowerCase() !== "pitaji"
  ) {
    return failure(
      "authority.direction_requires_pitaji",
      "workers and integrators may propose but never accept directional state",
      input.task_packet.task_id,
    );
  }
  return exactApproval(
    input,
    approvals,
    directionKind(acceptance.category),
    acceptance,
    "authority.direction_requires_pitaji",
  );
}

function externalApproval(
  input: AuthorityCoverageInput,
  approvals: readonly ApprovalRecord[],
): RuntimeResult<ApprovalRecord | null> {
  const actual = input.external_action;
  if (actual === null) return success(null);
  const authorized = input.task_packet.authorization.external_action;
  if (!authorized.allowed) {
    return failure(
      "authority.external_action_forbidden",
      "task authority does not permit an external action",
      input.task_packet.task_id,
    );
  }
  if (authorized.target !== actual.target) {
    return failure("approval.target_drift", "external target differs from task approval", input.task_packet.task_id);
  }
  if (authorized.environment !== actual.environment) {
    return failure("approval.environment_drift", "external environment differs from task approval", input.task_packet.task_id);
  }
  if (!sameStrings(authorized.scope, actual.scope)) {
    return failure("approval.scope_drift", "external scope differs from task approval", input.task_packet.task_id);
  }
  if (authorized.timing !== actual.timing) {
    return failure("approval.timing_drift", "external timing differs from task approval", input.task_packet.task_id);
  }
  return exactApproval(
    input,
    approvals,
    "external_action",
    actual,
    "authority.external_approval_required",
  );
}

export function evaluateAuthorityCoverage(
  input: AuthorityCoverageInput,
): RuntimeResult<AuthorityCoverage> {
  const actorRank = AUTHORITY_RANK[input.actor_authority];
  const minimumRank = AUTHORITY_RANK[input.minimum_authority];
  if (actorRank < minimumRank) {
    return failure(
      "authority.insufficient",
      "operation actor is below the immutable minimum authority",
      input.completion_packet.actor,
    );
  }
  const claim = validateClaimAndApprovals(input.task_packet, {
    now: input.evaluated_at,
    expectedIssuer: input.expected_issuer,
    currentBaseRevision: input.current_base_revision,
    conflictingClaims: input.conflicting_claims,
    recordedApprovals: input.recorded_task_approvals,
  });
  if (!claim.ok) return claim;
  const completion = validateCompletionPacket(
    input.completion_packet,
    input.task_packet,
    {
      currentBaseRevision: input.current_base_revision,
      availableEvidenceIds: input.available_evidence_ids,
      approvedExceptionIds: input.approved_exception_ids,
    },
  );
  if (!completion.ok) return completion;
  const paths = changedPaths(input);
  if (!paths.ok) return paths;
  const approvals = approvalRecords(input);
  if (!approvals.ok) return approvals;
  const direction = directionalApproval(input, approvals.value);
  if (!direction.ok) return direction;
  const deletion = deletionApproval(input, approvals.value);
  if (!deletion.ok) return deletion;
  const external = externalApproval(input, approvals.value);
  if (!external.ok) return external;
  const approvalIds = unique([
    ...claim.value.approvalIds,
    ...(direction.value === null ? [] : [direction.value.id]),
    ...(deletion.value === null ? [] : [deletion.value.id]),
    ...(external.value === null ? [] : [external.value.id]),
  ]);
  return success({
    claim_id: claim.value.claimId,
    covered_change_ids: unique(
      input.completion_packet.changes.map((change) => change.change_id),
    ),
    approval_ids: approvalIds,
    effective_write_paths: paths.value,
    external_action_allowed: external.value !== null,
    directional_acceptance: direction.value === null ? "not_applicable" : "pitaji",
  });
}
