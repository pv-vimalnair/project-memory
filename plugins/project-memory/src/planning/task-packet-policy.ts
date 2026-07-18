import {
  failure,
  success,
  type RuntimeResult,
} from "../index.js";
import type { Approval, TaskPacketInput } from "./types.js";

const MUTATION_DUTIES = new Set(["modify", "release", "notify"]);

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(unique(left)) === JSON.stringify(unique(right));
}

function isUnexpired(approval: Approval, now: Date): boolean {
  return (
    approval.expires_at === null ||
    new Date(approval.expires_at).getTime() > now.getTime()
  );
}

export function matchesExternalApproval(
  approval: Approval,
  packet: TaskPacketInput["packet"],
  now: Date,
): boolean {
  const external = packet.authorization.external_action;
  return (
    approval.kind === "external" &&
    approval.granted_by.trim().toLowerCase() === "pitaji" &&
    approval.target === external.target &&
    approval.environment === external.environment &&
    approval.timing === external.timing &&
    external.scope.every((scope) => approval.scope.includes(scope)) &&
    isUnexpired(approval, now)
  );
}

function validateClaim(input: TaskPacketInput, now: Date): RuntimeResult<true> {
  const packetDuties = [
    ...input.packet.component_duties.flatMap((duty) => duty.duties),
    ...input.packet.domain_duties.flatMap((duty) => duty.duties),
  ];
  const componentIds = input.packet.component_duties.map(
    (duty) => duty.component_id,
  );
  const approvalIds = new Set(
    input.packet.approvals.map((approval) => approval.id),
  );
  const expiresAt = new Date(now.getTime() + input.claim_ttl_ms);
  if (
    input.claim_ttl_ms <= 0 ||
    !Number.isInteger(input.claim_ttl_ms) ||
    !Number.isFinite(expiresAt.getTime()) ||
    input.claim.issuer !== input.packet.assignment.issued_by ||
    input.claim.assignee_id !== input.packet.assignment.assignee_id ||
    input.claim.base_revision !==
      input.packet.resolved_inputs.original_base_revision ||
    !sameStrings(input.claim.paths, input.packet.scope.inclusions) ||
    !sameStrings(input.claim.components, componentIds) ||
    !sameStrings(input.claim.duties, packetDuties) ||
    !sameStrings(
      input.claim.required_evidence,
      input.packet.required_evidence,
    ) ||
    input.claim.repositories.length === 0 ||
    (input.claim.coordination_exception_approval_id !== null &&
      !approvalIds.has(input.claim.coordination_exception_approval_id))
  ) {
    return failure(
      "task.claim_invalid",
      "task claim must exactly bind packet authority, scope, duties, and evidence",
      input.packet.task_id,
    );
  }
  return success(true);
}

function mutationPaths(packet: TaskPacketInput["packet"]): string[] {
  const duties = [...packet.component_duties, ...packet.domain_duties];
  return unique(
    duties
      .filter((duty) =>
        duty.duties.some((entry) => MUTATION_DUTIES.has(entry)),
      )
      .flatMap((duty) => duty.write_scope),
  );
}

function validMutationApproval(
  approval: Approval,
  paths: readonly string[],
  now: Date,
): boolean {
  return (
    approval.kind === "mutation" &&
    approval.granted_by.trim().toLowerCase() === "pitaji" &&
    paths.every((path) => approval.scope.includes(path)) &&
    isUnexpired(approval, now)
  );
}

function validateAuthorization(
  packet: TaskPacketInput["packet"],
  approvals: ReadonlyMap<string, Approval>,
  now: Date,
): RuntimeResult<true> {
  const paths = mutationPaths(packet);
  if (paths.length > 0 && packet.authorization.mutation === "none") {
    return failure(
      "task.mutation_authorization_missing",
      "mutation duties require task authorization",
      packet.task_id,
    );
  }
  if (
    paths.length > 0 &&
    packet.authorization.mutation === "approval-required" &&
    ![...approvals.values()].some((approval) =>
      validMutationApproval(approval, paths, now),
    )
  ) {
    return failure(
      "task.mutation_approval_required",
      "approval-required mutation has no matching recorded approval",
      packet.task_id,
    );
  }

  const external = packet.authorization.external_action;
  if (!external.allowed) {
    const neutral =
      external.approval_ids.length === 0 &&
      external.target === null &&
      external.environment === null &&
      external.scope.length === 0 &&
      external.timing === null;
    return neutral
      ? success(true)
      : failure(
          "task.external_authorization_invalid",
          "disabled external authorization must not retain implicit authority",
          packet.task_id,
        );
  }
  if (external.approval_ids.length === 0) {
    return failure(
      "task.external_approval_required",
      "enabled external authorization requires explicit approval IDs",
      packet.task_id,
    );
  }
  if (
    external.target === null ||
    external.environment === null ||
    external.scope.length === 0 ||
    external.timing === null
  ) {
    return failure(
      "task.external_authorization_invalid",
      "enabled external authorization requires target, environment, scope, and timing",
      packet.task_id,
    );
  }
  const invalid = external.approval_ids.find((id) => {
    const approval = approvals.get(id);
    return (
      approval === undefined ||
      !matchesExternalApproval(approval, packet, now)
    );
  });
  return invalid === undefined
    ? success(true)
    : failure(
        "task.external_approval_drift",
        "external authorization approval no longer matches",
        packet.task_id,
        [invalid],
      );
}

export function validateTaskPacketPolicy(
  input: TaskPacketInput,
  approvals: ReadonlyMap<string, Approval>,
  now: Date,
): RuntimeResult<true> {
  if (approvals.size !== input.packet.approvals.length) {
    return failure(
      "task.approval_duplicate",
      "approval identifiers must be unique",
      input.packet.task_id,
    );
  }
  const claim = validateClaim(input, now);
  return claim.ok
    ? validateAuthorization(input.packet, approvals, now)
    : claim;
}
