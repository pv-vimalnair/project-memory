import {
  canonicalJson,
  failure,
  success,
  validateWithSchema,
  type RuntimeIssue,
  type RuntimeResult,
} from "../index.js";
import type {
  CompletionPacket,
  CompletionValidationContext,
  TaskPacket,
  ValidatedCompletion,
} from "./types.js";

const MUTATION_DUTIES = new Set(["modify", "release", "notify"]);
const RECORD_PREFIXES: Readonly<Record<string, string>> = {
  approval: "APR-",
  change: "CHG-",
  decision: "DEC-",
  evidence: "EVD-",
  finding: "FIND-",
  idea: "IDEA-",
  lesson: "LESSON-",
  risk: "RISK-",
};

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareUtf8);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson(unique(left)) === canonicalJson(unique(right));
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

function hasAuthorityExpansion(completion: CompletionPacket): boolean {
  const keys = Object.keys(
    completion as unknown as Readonly<Record<string, unknown>>,
  );
  return keys.some(
    (key) =>
      key.startsWith("accepted_") ||
      key.startsWith("approved_") ||
      key.startsWith("authorized_") ||
      key === "directional_acceptance" ||
      key === "finalization",
  );
}

function pathCovers(scope: string, candidate: string): boolean {
  if (scope === "**" || scope === candidate) return true;
  if (!scope.endsWith("/**")) return false;
  const base = scope.slice(0, -3);
  return candidate === base || candidate.startsWith(`${base}/`);
}

function validExactPath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes("*") &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    !value.split("/").includes("..")
  );
}

function validateLinks(
  completion: CompletionPacket,
  task: TaskPacket,
  context: CompletionValidationContext,
): RuntimeResult<true> {
  if (
    completion.packet_id !== task.packet_id ||
    completion.task_id !== task.task_id ||
    completion.workstream_id !== task.workstream_id ||
    completion.claim_id !== task.claim.id ||
    completion.actor !== task.assignment.assignee_id
  ) {
    return failure(
      "completion.link_mismatch",
      "completion packet does not link exactly to task, workstream, claim, and assignee",
      completion.task_id,
    );
  }
  if (
    completion.original_base_revision !== task.claim.base_revision ||
    completion.original_base_revision !==
      task.resolved_inputs.original_base_revision ||
    completion.original_base_revision !== context.currentBaseRevision
  ) {
    return failure(
      "completion.base_drift",
      "completion original base is no longer current",
      completion.task_id,
    );
  }
  const submittedAt = Date.parse(completion.submitted_at);
  const claimIssuedAt = Date.parse(task.claim.issued_at);
  if (
    !Number.isFinite(submittedAt) ||
    !Number.isFinite(claimIssuedAt) ||
    submittedAt < claimIssuedAt
  ) {
    return failure(
      "completion.time_invalid",
      "completion submission must not predate the claim",
      completion.task_id,
    );
  }
  return success(true);
}

function taskMutates(task: TaskPacket): boolean {
  return [...task.component_duties, ...task.domain_duties].some((duty) =>
    duty.duties.some((entry) => MUTATION_DUTIES.has(entry)),
  );
}

function validateChanges(
  completion: CompletionPacket,
  task: TaskPacket,
): RuntimeResult<true> {
  if (taskMutates(task) && completion.changes.length === 0) {
    return failure(
      "completion.change_missing",
      "mutation task completion must report at least one change",
      completion.task_id,
    );
  }
  const approvalIds = new Set(task.approvals.map((approval) => approval.id));
  const changeIds = new Set<string>();
  const files = new Set<string>();
  const artifacts = new Set<string>();
  for (const change of completion.changes) {
    if (changeIds.has(change.change_id)) {
      return failure(
        "completion.change_duplicate",
        "completion change identifiers must be unique",
        change.change_id,
      );
    }
    changeIds.add(change.change_id);
    if (
      change.files.length === 0 ||
      change.commits.length === 0 ||
      change.artifacts.length === 0
    ) {
      return failure(
        "completion.change_incomplete",
        "each change requires exact files, commits, and artifacts",
        change.change_id,
      );
    }
    for (const reference of change.authorization_refs) {
      if (!approvalIds.has(reference)) {
        return failure(
          "completion.authorization_invalid",
          "change references an approval outside the task packet",
          change.change_id,
          [reference],
        );
      }
    }
    if (
      task.authorization.mutation === "approval-required" &&
      change.authorization_refs.length === 0
    ) {
      return failure(
        "completion.authorization_missing",
        "approval-required mutation must cite its approval",
        change.change_id,
      );
    }
    for (const file of change.files) {
      const allowed = task.scope.inclusions.some((scope) =>
        pathCovers(scope, file),
      );
      const excluded = task.scope.exclusions.some((scope) =>
        pathCovers(scope, file),
      );
      if (!validExactPath(file) || !allowed || excluded) {
        return failure(
          "completion.scope_exceeded",
          "reported file is not an exact path inside the assigned scope",
          change.change_id,
          [file],
        );
      }
      if (files.has(file)) {
        return failure(
          "completion.file_duplicate",
          "each changed file must be reported once",
          change.change_id,
          [file],
        );
      }
      files.add(file);
    }
    for (const artifact of change.artifacts) {
      if (artifacts.has(artifact)) {
        return failure(
          "completion.artifact_duplicate",
          "each change artifact must be reported once",
          change.change_id,
          [artifact],
        );
      }
      artifacts.add(artifact);
    }
  }
  if (!sameStrings([...files], completion.scope_performed)) {
    return failure(
      "completion.scope_mismatch",
      "scope_performed must equal the exact union of changed files",
      completion.task_id,
    );
  }
  if (completion.scope_not_completed.length > 0 && completion.next_action === null) {
    return failure(
      "completion.handoff_missing",
      "incomplete scope requires a concrete next action",
      completion.task_id,
    );
  }
  return success(true);
}

function applicableException(
  reason: string | null,
  exceptionIds: readonly string[],
): boolean {
  return (
    reason !== null &&
    exceptionIds.some((exceptionId) => reason.includes(exceptionId))
  );
}

function validateGates(
  completion: CompletionPacket,
  task: TaskPacket,
  context: CompletionValidationContext,
): RuntimeResult<{
  readonly checkedGateIds: readonly string[];
  readonly evidenceIds: readonly string[];
}> {
  const taskGates = new Map(task.gates.map((gate) => [gate.id, gate]));
  const completionChecks = new Map(
    completion.checks.map((check) => [check.gate_id, check]),
  );
  if (
    taskGates.size !== task.gates.length ||
    completionChecks.size !== completion.checks.length
  ) {
    return failure(
      "completion.gate_duplicate",
      "task gates and completion checks require unique identifiers",
      completion.task_id,
    );
  }
  const evidenceIds: string[] = [];
  for (const gate of task.gates) {
    const check = completionChecks.get(gate.id);
    if (check === undefined) {
      return failure(
        "completion.gate_missing",
        "completion must report every task gate",
        gate.id,
      );
    }
    if (check.command_or_check !== gate.command_or_check) {
      return failure(
        "completion.gate_drift",
        "completion check differs from the resolved task gate",
        gate.id,
      );
    }
    if (check.status === "failed") {
      return failure(
        "completion.gate_failed",
        "a reported gate failed",
        gate.id,
      );
    }
    if (check.status === "not_run") {
      if (check.evidence_id !== null || check.not_run_reason === null) {
        return failure(
          "completion.gate_result_invalid",
          "not-run gates require a reason and no evidence result",
          gate.id,
        );
      }
      if (
        gate.required &&
        !applicableException(
          check.not_run_reason,
          context.approvedExceptionIds,
        )
      ) {
        return failure(
          "completion.required_gate_not_run",
          "required gate was not run without an applicable approved exception",
          gate.id,
        );
      }
      continue;
    }
    if (check.evidence_id === null || check.not_run_reason !== null) {
      return failure(
        "completion.gate_result_invalid",
        "passed gates require evidence and no not-run reason",
        gate.id,
      );
    }
    if (!context.availableEvidenceIds.includes(check.evidence_id)) {
      return failure(
        "completion.evidence_missing",
        "passed gate evidence is not available to the validator",
        gate.id,
        [check.evidence_id],
      );
    }
    evidenceIds.push(check.evidence_id);
  }
  const unknown = completion.checks.find(
    (check) => !taskGates.has(check.gate_id),
  );
  if (unknown !== undefined) {
    return failure(
      "completion.gate_unknown",
      "completion reports a gate outside the task packet",
      unknown.gate_id,
    );
  }
  return success({
    checkedGateIds: unique(completion.checks.map((check) => check.gate_id)),
    evidenceIds: unique(evidenceIds),
  });
}

function validateRecordsAndOutputs(
  completion: CompletionPacket,
  task: TaskPacket,
): RuntimeResult<true> {
  if (!sameStrings(completion.outputs, task.required_outputs)) {
    return failure(
      "completion.output_missing",
      "completion outputs must exactly satisfy task required outputs",
      completion.task_id,
    );
  }
  for (const type of task.memory_updates.create_record_types) {
    const prefix = RECORD_PREFIXES[type];
    if (
      prefix !== undefined &&
      !completion.records_created.some((recordId) => recordId.startsWith(prefix))
    ) {
      return failure(
        "completion.record_missing",
        "completion did not create a required record type",
        completion.task_id,
        [type],
      );
    }
  }
  const missingUpdate = task.memory_updates.update_record_ids.find(
    (recordId) => !completion.records_updated.includes(recordId),
  );
  if (missingUpdate !== undefined) {
    return failure(
      "completion.record_update_missing",
      "completion omitted a required canonical record update",
      completion.task_id,
      [missingUpdate],
    );
  }
  if (
    completion.remaining_risk_ids.length > 0 &&
    completion.next_action === null
  ) {
    return failure(
      "completion.risk_handoff_missing",
      "remaining risks require a concrete next action",
      completion.task_id,
    );
  }
  return success(true);
}

function validateAttestation(
  completion: CompletionPacket,
): RuntimeResult<true> {
  const statement = completion.worker_attestation.toLowerCase();
  const factual = statement.includes("factual");
  const deniesAcceptance = /\bdo(?:es)? not accept\b/.test(statement);
  const expandsAuthority =
    /\bi (?:accept|approve|authorize|finalize)\b/.test(statement) ||
    /\bdirection (?:is|was) accepted\b/.test(statement);
  return factual && deniesAcceptance && !expandsAuthority
    ? success(true)
    : failure(
        "completion.attestation_invalid",
        "worker attestation must submit facts without accepting direction",
        completion.task_id,
      );
}

export function validateCompletionPacket(
  completion: CompletionPacket,
  task: TaskPacket,
  context: CompletionValidationContext,
): RuntimeResult<ValidatedCompletion> {
  if (hasAuthorityExpansion(completion)) {
    return failure(
      "completion.authority_expansion",
      "worker completion packets may propose but never accept direction",
      task.task_id,
    );
  }
  const schema = validateWithSchema<CompletionPacket>(
    "project-memory/v1/completion-packet",
    completion,
  );
  if (!schema.ok) {
    return translatedFailure(
      "completion.packet_invalid",
      "completion packet failed registered schema validation",
      task.task_id,
      schema.issues,
    );
  }
  const links = validateLinks(completion, task, context);
  if (!links.ok) return links;
  const changes = validateChanges(completion, task);
  if (!changes.ok) return changes;
  const gates = validateGates(completion, task, context);
  if (!gates.ok) return gates;
  const records = validateRecordsAndOutputs(completion, task);
  if (!records.ok) return records;
  const attestation = validateAttestation(completion);
  if (!attestation.ok) return attestation;
  return success({
    completion,
    checkedGateIds: gates.value.checkedGateIds,
    evidenceIds: gates.value.evidenceIds,
  });
}
