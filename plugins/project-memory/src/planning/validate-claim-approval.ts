import {
  canonicalJson,
  failure,
  success,
  validateWithSchema,
  type RuntimeResult,
} from "../index.js";
import type {
  Approval,
  AuthorityValidation,
  AuthorityValidationContext,
  Claim,
  TaskPacket,
} from "./types.js";

const MUTATION_DUTIES = new Set(["modify", "release", "notify"]);

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareUtf8);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson(unique(left)) === canonicalJson(unique(right));
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function runtimeClaimStatus(claim: Claim): unknown {
  return (claim as unknown as Readonly<Record<string, unknown>>).status;
}

function heartbeatMilliseconds(value: string): number | null {
  const matched = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (matched === null) return null;
  const hours = Number(matched[1] ?? 0);
  const minutes = Number(matched[2] ?? 0);
  const seconds = Number(matched[3] ?? 0);
  const total = ((hours * 60 + minutes) * 60 + seconds) * 1000;
  return total > 0 && Number.isSafeInteger(total) ? total : null;
}

function pathCovers(scope: string, candidate: string): boolean {
  if (scope === "**" || scope === candidate) return true;
  if (!scope.endsWith("/**")) return false;
  const base = scope.slice(0, -3);
  return candidate === base || candidate.startsWith(`${base}/`);
}

function pathsOverlap(left: string, right: string): boolean {
  return pathCovers(left, right) || pathCovers(right, left);
}

function claimConflict(left: Claim, right: Claim, now: number): boolean {
  const expiresAt = timestamp(right.expires_at);
  if (
    left.id === right.id ||
    runtimeClaimStatus(right) !== "active" ||
    expiresAt === null ||
    expiresAt <= now
  ) {
    return false;
  }
  const sameRepository = left.repositories.some((repository) =>
    right.repositories.includes(repository),
  );
  const overlappingPath = left.paths.some((leftPath) =>
    right.paths.some((rightPath) => pathsOverlap(leftPath, rightPath)),
  );
  const leftMutates = left.duties.some((duty) => MUTATION_DUTIES.has(duty));
  const rightMutates = right.duties.some((duty) => MUTATION_DUTIES.has(duty));
  return sameRepository && overlappingPath && leftMutates && rightMutates;
}

function approvalMap(
  approvals: readonly Approval[],
): RuntimeResult<ReadonlyMap<string, Approval>> {
  const result = new Map<string, Approval>();
  for (const approval of approvals) {
    if (result.has(approval.id)) {
      return failure(
        "approval.duplicate",
        "approval identifiers must be unique",
        approval.id,
      );
    }
    result.set(approval.id, approval);
  }
  return success(result);
}

function matchingRecordedApproval(
  id: string,
  embedded: ReadonlyMap<string, Approval>,
  recorded: ReadonlyMap<string, Approval>,
  now: number,
): RuntimeResult<Approval> {
  const packetApproval = embedded.get(id);
  const recordedApproval = recorded.get(id);
  if (packetApproval === undefined || recordedApproval === undefined) {
    return failure(
      "approval.missing",
      "referenced approval must exist in both packet and canonical records",
      id,
    );
  }
  if (canonicalJson(packetApproval) !== canonicalJson(recordedApproval)) {
    return failure(
      "approval.drift",
      "recorded approval differs from the task-bound approval",
      id,
    );
  }
  const issuedAt = timestamp(recordedApproval.issued_at);
  const expiresAt =
    recordedApproval.expires_at === null
      ? null
      : timestamp(recordedApproval.expires_at);
  if (
    issuedAt === null ||
    issuedAt > now ||
    (recordedApproval.expires_at !== null && expiresAt === null)
  ) {
    return failure(
      "approval.time_invalid",
      "approval issue and expiry timestamps must be valid for this validation",
      id,
    );
  }
  if (expiresAt !== null && expiresAt <= now) {
    return failure("approval.expired", "approval has expired", id);
  }
  if (recordedApproval.granted_by.trim().toLowerCase() !== "pitaji") {
    return failure(
      "approval.granter_invalid",
      "directional approval must be granted by Pitaji",
      id,
    );
  }
  return success(recordedApproval);
}

function validateClaimBinding(
  task: TaskPacket,
  context: AuthorityValidationContext,
  now: number,
): RuntimeResult<true> {
  const claim = task.claim;
  const componentIds = task.component_duties.map((duty) => duty.component_id);
  const duties = [
    ...task.component_duties.flatMap((duty) => duty.duties),
    ...task.domain_duties.flatMap((duty) => duty.duties),
  ];
  if (claim.issuer !== context.expectedIssuer) {
    return failure("claim.issuer_mismatch", "claim issuer is not authoritative", claim.id);
  }
  if (claim.assignee_id !== task.assignment.assignee_id) {
    return failure("claim.assignee_mismatch", "claim assignee differs from task assignment", claim.id);
  }
  if (
    claim.base_revision !== task.resolved_inputs.original_base_revision ||
    claim.base_revision !== context.currentBaseRevision
  ) {
    return failure("claim.base_drift", "claim base is no longer current", claim.id);
  }
  if (runtimeClaimStatus(claim) !== "active") {
    return failure("claim.inactive", "claim is not active", claim.id);
  }
  if (
    claim.repositories.length === 0 ||
    !sameStrings(claim.paths, task.scope.inclusions) ||
    !sameStrings(claim.components, componentIds) ||
    !sameStrings(claim.duties, duties) ||
    !sameStrings(claim.required_evidence, task.required_evidence)
  ) {
    return failure(
      "claim.scope_drift",
      "claim repositories, paths, duties, components, or evidence drifted",
      claim.id,
    );
  }
  const issuedAt = timestamp(claim.issued_at);
  const expiresAt = timestamp(claim.expires_at);
  const heartbeatAt = timestamp(claim.last_heartbeat_at);
  const heartbeat = heartbeatMilliseconds(claim.heartbeat_interval);
  if (issuedAt === null || issuedAt > now || expiresAt === null || expiresAt <= issuedAt) {
    return failure("claim.time_invalid", "claim issue or expiry timestamp is invalid", claim.id);
  }
  if (expiresAt <= now) {
    return failure("claim.expired", "claim expired before validation", claim.id);
  }
  if (
    heartbeatAt === null ||
    heartbeat === null ||
    heartbeatAt < issuedAt ||
    heartbeatAt > now ||
    now - heartbeatAt > heartbeat
  ) {
    return failure("claim.stale_heartbeat", "claim heartbeat is stale or invalid", claim.id);
  }
  return success(true);
}

function validateExternalApprovals(
  task: TaskPacket,
  embedded: ReadonlyMap<string, Approval>,
  recorded: ReadonlyMap<string, Approval>,
  now: number,
): RuntimeResult<readonly string[]> {
  const external = task.authorization.external_action;
  if (!external.allowed) return success([]);
  const validated: string[] = [];
  for (const id of external.approval_ids) {
    const matched = matchingRecordedApproval(id, embedded, recorded, now);
    if (!matched.ok) return matched;
    const approval = matched.value;
    if (
      approval.kind !== "external" ||
      approval.target !== external.target ||
      approval.environment !== external.environment ||
      approval.timing !== external.timing ||
      !sameStrings(approval.scope, external.scope)
    ) {
      return failure(
        "approval.drift",
        "external approval target, environment, scope, or timing drifted",
        id,
      );
    }
    validated.push(id);
  }
  return success(unique(validated));
}

function mutationPaths(task: TaskPacket): string[] {
  return unique(
    [...task.component_duties, ...task.domain_duties]
      .filter((duty) =>
        duty.duties.some((entry) => MUTATION_DUTIES.has(entry)),
      )
      .flatMap((duty) => duty.write_scope),
  );
}

function validateMutationApproval(
  task: TaskPacket,
  embedded: ReadonlyMap<string, Approval>,
  recorded: ReadonlyMap<string, Approval>,
  now: number,
): RuntimeResult<readonly string[]> {
  if (task.authorization.mutation !== "approval-required") return success([]);
  const paths = mutationPaths(task);
  for (const approval of task.approvals) {
    if (
      approval.kind !== "mutation" ||
      !paths.every((path) => approval.scope.includes(path))
    ) {
      continue;
    }
    const matched = matchingRecordedApproval(
      approval.id,
      embedded,
      recorded,
      now,
    );
    if (!matched.ok) return matched;
    return success([approval.id]);
  }
  return failure(
    "approval.missing",
    "approval-required mutation has no matching recorded approval",
    task.task_id,
  );
}

function validateCoordination(
  task: TaskPacket,
  context: AuthorityValidationContext,
  embedded: ReadonlyMap<string, Approval>,
  recorded: ReadonlyMap<string, Approval>,
  now: number,
): RuntimeResult<readonly string[]> {
  const conflicts = context.conflictingClaims.filter((claim) =>
    claimConflict(task.claim, claim, now),
  );
  if (conflicts.length === 0) return success([]);
  const id = task.claim.coordination_exception_approval_id;
  if (id === null) {
    return failure(
      "claim.overlap_without_coordination",
      "overlapping active mutation claims require coordination approval",
      task.claim.id,
      conflicts.map((claim) => claim.id),
    );
  }
  const matched = matchingRecordedApproval(id, embedded, recorded, now);
  if (!matched.ok) return matched;
  if (
    matched.value.kind !== "coordination" ||
    !task.claim.paths.every((path) => matched.value.scope.includes(path))
  ) {
    return failure(
      "approval.drift",
      "coordination approval does not cover the overlapping claim",
      id,
    );
  }
  return success([id]);
}

export function validateClaimAndApprovals(
  task: TaskPacket,
  context: AuthorityValidationContext,
): RuntimeResult<AuthorityValidation> {
  const schema = validateWithSchema<TaskPacket>(
    "project-memory/v1/task-packet",
    task,
  );
  if (!schema.ok) {
    return failure(
      "claim.packet_invalid",
      "task packet failed registered schema validation",
      task.task_id,
      schema.issues.map((issue) => `${issue.code}:${issue.path}`),
    );
  }
  const now = timestamp(context.now);
  if (now === null) return failure("claim.now_invalid", "validation time is invalid");
  const claim = validateClaimBinding(task, context, now);
  if (!claim.ok) return claim;
  const embedded = approvalMap(task.approvals);
  if (!embedded.ok) return embedded;
  const recorded = approvalMap(context.recordedApprovals);
  if (!recorded.ok) return recorded;
  const external = validateExternalApprovals(task, embedded.value, recorded.value, now);
  if (!external.ok) return external;
  const mutation = validateMutationApproval(task, embedded.value, recorded.value, now);
  if (!mutation.ok) return mutation;
  const coordination = validateCoordination(
    task,
    context,
    embedded.value,
    recorded.value,
    now,
  );
  if (!coordination.ok) return coordination;
  return success({
    valid: true,
    claimId: task.claim.id,
    approvalIds: unique([
      ...external.value,
      ...mutation.value,
      ...coordination.value,
    ]),
  });
}
