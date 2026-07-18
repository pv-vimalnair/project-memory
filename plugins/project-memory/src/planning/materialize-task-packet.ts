import {
  failure,
  success,
  validateWithSchema,
  type Clock,
  type IdFactory,
  type RuntimeIssue,
  type RuntimeResult,
} from "../index.js";
import type {
  Approval,
  ResolvedGateExecution,
  TaskPacket,
  TaskPacketInput,
} from "./types.js";
import {
  matchesExternalApproval,
  validateTaskPacketPolicy,
} from "./task-packet-policy.js";

type ComponentDuty = TaskPacket["component_duties"][number];
type DomainDuty = TaskPacket["domain_duties"][number];
type Duty = ComponentDuty | DomainDuty;

const MUTATION_DUTIES = new Set(["modify", "release", "notify"]);
const SHELL_EXECUTABLES = new Set([
  "bash",
  "cmd",
  "cmd.exe",
  "fish",
  "powershell",
  "powershell.exe",
  "pwsh",
  "sh",
  "zsh",
]);
const DEFINITION_REF = /^[a-z][a-z0-9.-]*@[0-9]+\.[0-9]+\.[0-9]+$/;
const EXECUTABLE = /^[A-Za-z0-9][A-Za-z0-9._+/@:-]*$/;

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareUtf8);
}

function translatedFailure<T>(
  code: string,
  message: string,
  path: string,
  issues: readonly RuntimeIssue[],
): RuntimeResult<T> {
  return failure(
    code,
    message,
    path,
    issues.map((issue) => `${issue.code}:${issue.path}`),
  );
}

function runtimeRequirement(duty: Duty): unknown {
  return (duty as unknown as Readonly<Record<string, unknown>>).requirement;
}

function runtimeResolutionResult(duty: Duty): unknown {
  const runtimeDuty = duty as unknown as {
    readonly resolution?: Readonly<Record<string, unknown>>;
  };
  return runtimeDuty.resolution?.result;
}

function normalizeResolution<T extends Duty["resolution"]>(value: T): T {
  return {
    ...value,
    source_impact_ids: unique(value.source_impact_ids),
    predicate_ids: unique(value.predicate_ids),
    evidence_ids: unique(value.evidence_ids),
  };
}

function validateDuty(duty: Duty, path: string): RuntimeResult<true> {
  if (runtimeRequirement(duty) !== "required") {
    return failure(
      "task.unresolved_duty",
      "conditional and not-applicable duties must be resolved before packet emission",
      path,
    );
  }
  if (duty.duties.length === 0 || runtimeResolutionResult(duty) !== true) {
    return failure(
      "task.unresolved_duty",
      "emitted duties require a true evidence-backed resolution",
      path,
    );
  }
  if (
    duty.duties.some((entry) => MUTATION_DUTIES.has(entry)) &&
    duty.write_scope.length === 0
  ) {
    return failure(
      "task.empty_write_scope",
      "mutation duties require at least one exact write scope",
      path,
    );
  }
  return success(true);
}

function normalizeComponentDuty(duty: ComponentDuty): ComponentDuty {
  return {
    ...duty,
    duties: unique(duty.duties),
    read_scope: unique(duty.read_scope),
    write_scope: unique(duty.write_scope),
    resolution: normalizeResolution(duty.resolution),
  };
}

function normalizeDomainDuty(duty: DomainDuty): DomainDuty {
  return {
    ...duty,
    duties: unique(duty.duties),
    write_scope: unique(duty.write_scope),
    required_records: unique(duty.required_records),
    resolution: normalizeResolution(duty.resolution),
  };
}

function displayArgument(value: string): string {
  return /^[A-Za-z0-9._+/@:=,-]+$/.test(value) ? value : JSON.stringify(value);
}

function commandDisplay(executable: string, args: readonly string[]): string {
  return [executable, ...args.map(displayArgument)].join(" ");
}

function isShellExecutable(executable: string): boolean {
  const normalized = executable.replaceAll("\\", "/").toLowerCase();
  return SHELL_EXECUTABLES.has(normalized.split("/").at(-1) ?? normalized);
}

function approvalById(
  approvals: readonly Approval[],
): ReadonlyMap<string, Approval> {
  return new Map(approvals.map((approval) => [approval.id, approval]));
}

function normalizeGate(
  gate: ResolvedGateExecution,
  packet: TaskPacketInput["packet"],
  approvals: ReadonlyMap<string, Approval>,
  now: Date,
): RuntimeResult<ResolvedGateExecution> {
  if (!DEFINITION_REF.test(gate.definition_ref)) {
    return failure(
      "gate.definition_unresolved",
      "gate definition must be an exact definition@semantic-version reference",
      gate.id,
      [gate.definition_ref],
    );
  }
  if (gate.execution.kind === "command") {
    if (
      !EXECUTABLE.test(gate.execution.executable) ||
      isShellExecutable(gate.execution.executable) ||
      gate.execution.args.some((argument) => /[\0\r\n]/.test(argument))
    ) {
      return failure(
        "gate.shell_string_forbidden",
        "command gates require one literal executable and literal argument array",
        gate.id,
      );
    }
    if (gate.type === "external") {
      return failure(
        "gate.external_check_required",
        "external gates must use a concrete check and verifier role",
        gate.id,
      );
    }
    if (
      gate.command_or_check !==
      commandDisplay(gate.execution.executable, gate.execution.args)
    ) {
      return failure(
        "gate.command_display_mismatch",
        "command display must be derived from executable and literal arguments",
        gate.id,
      );
    }
    const envAllowlist = Object.fromEntries(
      Object.entries(gate.execution.env_allowlist).sort(([left], [right]) =>
        compareUtf8(left, right),
      ),
    );
    return success({
      ...gate,
      execution: {
        ...gate.execution,
        args: [...gate.execution.args],
        env_allowlist: envAllowlist,
      },
    });
  }

  if (gate.command_or_check !== gate.execution.instruction) {
    return failure(
      "gate.check_display_mismatch",
      "check gate display must equal its concrete instruction",
      gate.id,
    );
  }
  const approvalRefs = unique(gate.execution.approval_refs);
  if (
    (gate.type === "external" || gate.execution.verifier_role === "external") &&
    approvalRefs.length === 0
  ) {
    return failure(
      "gate.external_approval_required",
      "external checks require explicit recorded approval references",
      gate.id,
    );
  }
  if (gate.type === "external" || gate.execution.verifier_role === "external") {
    if (!packet.authorization.external_action.allowed) {
      return failure(
        "gate.external_authorization_missing",
        "task authorization does not permit this external check",
        gate.id,
      );
    }
    const invalid = approvalRefs.find((id) => {
      const approval = approvals.get(id);
      return (
        !packet.authorization.external_action.approval_ids.includes(id) ||
        approval === undefined ||
        !matchesExternalApproval(approval, packet, now)
      );
    });
    if (invalid !== undefined) {
      return failure(
        "gate.external_approval_drift",
        "external approval no longer matches target, environment, scope, timing, or expiry",
        gate.id,
        [invalid],
      );
    }
  }
  return success({
    ...gate,
    execution: { ...gate.execution, approval_refs: approvalRefs },
  });
}

function normalizeApprovals(approvals: readonly Approval[]): Approval[] {
  return [...approvals]
    .map((approval) => ({
      ...approval,
      scope: unique(approval.scope),
      invalidation_conditions: unique(approval.invalidation_conditions),
    }))
    .sort((left, right) => compareUtf8(left.id, right.id));
}

function normalizePacketSource(
  input: TaskPacketInput,
  gates: readonly ResolvedGateExecution[],
  approvals: readonly Approval[],
): TaskPacketInput["packet"] {
  return {
    ...input.packet,
    patterns: {
      ...input.packet.patterns,
      companions: [...input.packet.patterns.companions].sort((left, right) =>
        compareUtf8(left.id, right.id),
      ),
    },
    selector: {
      ...input.packet.selector,
      matched_signal_ids: unique(input.packet.selector.matched_signal_ids),
      evidence_ids: unique(input.packet.selector.evidence_ids),
    },
    scope: {
      inclusions: unique(input.packet.scope.inclusions),
      exclusions: unique(input.packet.scope.exclusions),
    },
    resolved_inputs: {
      ...input.packet.resolved_inputs,
      record_ids: unique(input.packet.resolved_inputs.record_ids),
      artifact_refs: unique(input.packet.resolved_inputs.artifact_refs),
    },
    component_duties: [...input.packet.component_duties]
      .map(normalizeComponentDuty)
      .sort((left, right) => compareUtf8(left.component_id, right.component_id)),
    domain_duties: [...input.packet.domain_duties]
      .map(normalizeDomainDuty)
      .sort((left, right) => compareUtf8(left.domain_id, right.domain_id)),
    decisions: {
      accepted_record_ids: unique(input.packet.decisions.accepted_record_ids),
      proposed_record_ids: unique(input.packet.decisions.proposed_record_ids),
    },
    authorization: {
      ...input.packet.authorization,
      external_action: {
        ...input.packet.authorization.external_action,
        approval_ids: unique(
          input.packet.authorization.external_action.approval_ids,
        ),
        scope: unique(input.packet.authorization.external_action.scope),
      },
    },
    approvals: [...approvals],
    required_outputs: unique(input.packet.required_outputs),
    required_evidence: unique(input.packet.required_evidence),
    gates: [...gates].sort((left, right) => compareUtf8(left.id, right.id)),
    memory_updates: {
      create_record_types: unique(
        input.packet.memory_updates.create_record_types,
      ),
      update_record_ids: unique(input.packet.memory_updates.update_record_ids),
    },
    completion_conditions: unique(input.packet.completion_conditions),
    fallback_and_escalation: {
      ...input.packet.fallback_and_escalation,
      triggers: unique(input.packet.fallback_and_escalation.triggers),
      allowed_fallbacks: unique(
        input.packet.fallback_and_escalation.allowed_fallbacks,
      ),
    },
  };
}

export function materializeTaskPacket(
  input: TaskPacketInput,
  clock: Clock,
  ids: IdFactory,
): RuntimeResult<TaskPacket> {
  const now = clock.now();
  if (!Number.isFinite(now.getTime())) {
    return failure("task.clock_invalid", "task packet clock must be valid");
  }
  for (const duty of input.packet.component_duties) {
    const valid = validateDuty(duty, duty.component_id);
    if (!valid.ok) return valid;
  }
  for (const duty of input.packet.domain_duties) {
    const valid = validateDuty(duty, duty.domain_id);
    if (!valid.ok) return valid;
  }
  const approvals = normalizeApprovals(input.packet.approvals);
  const approvalsById = approvalById(approvals);
  const policy = validateTaskPacketPolicy(input, approvalsById, now);
  if (!policy.ok) return policy;
  const gates: ResolvedGateExecution[] = [];
  for (const gate of input.packet.gates) {
    const normalized = normalizeGate(gate, input.packet, approvalsById, now);
    if (!normalized.ok) return normalized;
    gates.push(normalized.value);
  }

  let packetId: string;
  let claimId: string;
  try {
    packetId = ids.next("PKT");
    claimId = ids.next("CLAIM");
  } catch (error: unknown) {
    return failure(
      "task.id_generation_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  const timestamp = now.toISOString();
  const source = normalizePacketSource(input, gates, approvals);
  const packet: TaskPacket = {
    ...source,
    packet_id: packetId,
    claim: {
      ...input.claim,
      id: claimId,
      issued_at: timestamp,
      expires_at: new Date(now.getTime() + input.claim_ttl_ms).toISOString(),
      last_heartbeat_at: timestamp,
      components: unique(input.claim.components),
      repositories: unique(input.claim.repositories),
      paths: unique(input.claim.paths),
      duties: unique(input.claim.duties),
      required_evidence: unique(input.claim.required_evidence),
    },
  };
  const validated = validateWithSchema<TaskPacket>(
    "project-memory/v1/task-packet",
    packet,
  );
  return validated.ok
    ? success(validated.value)
    : translatedFailure(
        "task.packet_invalid",
        "materialized task packet does not satisfy its registered schema",
        input.packet.task_id,
        validated.issues,
      );
}
