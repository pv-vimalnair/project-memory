import {
  NodeCommandRunner,
  failure,
  resolveInside,
  runCommand,
  sha256,
  success,
  type Clock,
  type CommandRunner,
  type CommandSpec,
  type RuntimeResult,
} from "../../index.js";
import type { ResolvedGateExecution } from "../../planning/types.js";
import type {
  GateEvidence,
  SubmittedCheckEvidence,
} from "../contracts/index.js";
import { redactArchiveBytes } from "../archive/redactor.js";

const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const EVIDENCE_ID = /^EVD-[0-9A-HJKMNP-TV-Z]{26}$/;
const APPROVAL_ID = /^APR-[0-9A-HJKMNP-TV-Z]{26}$/;
const GATE_TYPES = new Set([
  "test",
  "lint",
  "build",
  "review",
  "policy",
  "render",
  "external",
]);
const VERIFIER_ROLES = new Set(["worker", "integrator", "Pitaji", "external"]);

export interface ExternalCheckApprovalValidationInput {
  readonly root: URL;
  readonly gate: ResolvedGateExecution;
  readonly submitted_evidence: SubmittedCheckEvidence;
}

export interface ExternalCheckApprovalValidator {
  validate(
    input: ExternalCheckApprovalValidationInput,
  ): Promise<RuntimeResult<readonly string[]>>;
}

export interface GateRunner {
  run(
    root: URL,
    gate: ResolvedGateExecution,
    submittedCheck?: SubmittedCheckEvidence,
  ): Promise<RuntimeResult<GateEvidence>>;
}

export interface GateRunnerDependencies {
  readonly clock: Clock;
  readonly runner?: CommandRunner;
  readonly max_output_bytes?: number;
  readonly external_approval_validator?: ExternalCheckApprovalValidator;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(unique(left)) === JSON.stringify(unique(right));
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validEnvironment(value: unknown): value is Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, entry]) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) &&
    typeof entry === "string" &&
    !entry.includes("\0")
  );
}

function validateGate(gate: ResolvedGateExecution): RuntimeResult<true> {
  const candidate: unknown = gate;
  if (typeof candidate !== "object" || candidate === null) {
    return failure(
      "gate.packet_invalid",
      "resolved gate must retain its packet-owned identity, definition, type, evidence type, and execution",
      "gate",
    );
  }
  const record = candidate as Record<string, unknown>;
  const gatePath = typeof record.id === "string" ? record.id : "gate";
  const executionValue = record.execution;
  if (
    !nonBlank(record.id) ||
    !nonBlank(record.definition_ref) ||
    typeof record.type !== "string" ||
    !GATE_TYPES.has(record.type) ||
    !nonBlank(record.command_or_check) ||
    typeof record.required !== "boolean" ||
    typeof record.conflict_sensitive !== "boolean" ||
    !nonBlank(record.evidence_type) ||
    typeof executionValue !== "object" ||
    executionValue === null
  ) {
    return failure(
      "gate.packet_invalid",
      "resolved gate fields are incomplete",
      gatePath,
    );
  }

  const execution = executionValue as Record<string, unknown>;
  if (execution.kind === "command") {
    const args = execution.args;
    const timeout = execution.timeout_ms;
    if (
      !nonBlank(execution.executable) ||
      execution.executable.includes("\0") ||
      !Array.isArray(args) ||
      args.some((arg) => typeof arg !== "string" || arg.includes("\0")) ||
      !nonBlank(execution.cwd) ||
      typeof timeout !== "number" ||
      !Number.isInteger(timeout) ||
      timeout <= 0 ||
      !validEnvironment(execution.env_allowlist)
    ) {
      return failure(
        "gate.packet_invalid",
        "command execution must contain literal args, a safe cwd, timeout, and environment allowlist",
        gate.id,
      );
    }
    return success(true);
  }

  if (execution.kind === "check") {
    const approvalRefs = execution.approval_refs;
    if (
      !nonBlank(execution.instruction) ||
      typeof execution.verifier_role !== "string" ||
      !VERIFIER_ROLES.has(execution.verifier_role) ||
      !Array.isArray(approvalRefs) ||
      approvalRefs.some((id) =>
        typeof id !== "string" || !APPROVAL_ID.test(id)
      )
    ) {
      return failure(
        "gate.packet_invalid",
        "check execution must contain an instruction, verifier role, and canonical approval refs",
        gate.id,
      );
    }
    return success(true);
  }

  return failure(
    "gate.packet_invalid",
    "gate execution kind must be command or check",
    gate.id,
  );
}

function clockValue(clock: Clock): RuntimeResult<Date> {
  const value = clock.now();
  return Number.isFinite(value.getTime())
    ? success(value)
    : failure("gate.clock_invalid", "gate execution requires a valid clock");
}

function redactOutput(value: string, path: string): RuntimeResult<string> {
  const redacted = redactArchiveBytes(new TextEncoder().encode(value));
  if (!redacted.ok) {
    return failure(
      "gate.output_redaction_failed",
      "gate output could not be safely redacted for persistence",
      path,
      redacted.issues.map((issue) => issue.code),
    );
  }
  return success(new TextDecoder().decode(redacted.value.bytes));
}

function commandSpec(
  gate: ResolvedGateExecution,
  cwd: URL,
  maximum: number,
): CommandSpec {
  if (gate.execution.kind !== "command") {
    throw new TypeError("command gate required");
  }
  return {
    executable: gate.execution.executable,
    args: [...gate.execution.args],
    cwd,
    timeout_ms: gate.execution.timeout_ms,
    env_allowlist: { ...gate.execution.env_allowlist },
    max_output_bytes: maximum,
  };
}

async function runCommandGate(
  root: URL,
  gate: ResolvedGateExecution,
  dependencies: GateRunnerDependencies,
): Promise<RuntimeResult<GateEvidence>> {
  if (gate.execution.kind !== "command") {
    return failure("gate.packet_invalid", "command gate execution is required", gate.id);
  }
  const cwd = await resolveInside(root, gate.execution.cwd);
  if (!cwd.ok) {
    return failure(
      "gate.cwd_invalid",
      "command cwd must resolve inside the repository root",
      gate.execution.cwd,
      cwd.issues.map((issue) => issue.code),
    );
  }
  const started = clockValue(dependencies.clock);
  if (!started.ok) return started;
  const maximum = dependencies.max_output_bytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isInteger(maximum) || maximum <= 0) {
    return failure(
      "gate.configuration_invalid",
      "maximum gate output must be a positive integer",
      gate.id,
    );
  }
  const executed = await runCommand(
    commandSpec(gate, cwd.value, maximum),
    dependencies.runner ?? new NodeCommandRunner(),
  );
  if (!executed.ok) {
    return failure(
      "gate.command_not_run",
      "the resolved command could not be started",
      gate.id,
      executed.issues.map((issue) => issue.code),
    );
  }
  const completed = clockValue(dependencies.clock);
  if (!completed.ok) return completed;
  const stdout = redactOutput(executed.value.stdout, `${gate.id}/stdout`);
  if (!stdout.ok) return stdout;
  const stderr = redactOutput(executed.value.stderr, `${gate.id}/stderr`);
  if (!stderr.ok) return stderr;
  const status =
    !executed.value.timed_out && executed.value.exit_code === 0
      ? "passed"
      : "failed";
  return success({
    schema_version: "1.0.0",
    gate_id: gate.id,
    definition_ref: gate.definition_ref,
    evidence_type: gate.evidence_type,
    execution_kind: "command",
    status,
    required: gate.required,
    conflict_sensitive: gate.conflict_sensitive,
    command: {
      executable: gate.execution.executable,
      args: [...gate.execution.args],
      cwd: gate.execution.cwd,
    },
    verifier_role: null,
    exit_code: executed.value.exit_code,
    stdout_redacted: stdout.value,
    stderr_redacted: stderr.value,
    stdout_sha256: sha256(executed.value.stdout),
    stderr_sha256: sha256(executed.value.stderr),
    evidence_ids: [],
    approval_refs: [],
    occurred_at: completed.value.toISOString(),
    duration_ms: Math.max(0, completed.value.getTime() - started.value.getTime()),
    not_run_reason: null,
  });
}

function validateSubmitted(
  gate: ResolvedGateExecution,
  submitted: SubmittedCheckEvidence,
): RuntimeResult<true> {
  if (
    !nonBlank(submitted.gate_id) ||
    !nonBlank(submitted.verifier_role) ||
    !nonBlank(submitted.evidence_type) ||
    !["passed", "failed", "not_run"].includes(submitted.status) ||
    typeof submitted.exact_result !== "string" ||
    !Array.isArray(submitted.evidence_ids) ||
    submitted.evidence_ids.some((id) => typeof id !== "string" || !EVIDENCE_ID.test(id)) ||
    !Array.isArray(submitted.approval_refs) ||
    submitted.approval_refs.some((id) => typeof id !== "string" || !APPROVAL_ID.test(id)) ||
    !canonicalTimestamp(submitted.occurred_at)
  ) {
    return failure(
      "gate.submitted_evidence_invalid",
      "submitted verifier evidence must be complete and canonical",
      gate.id,
    );
  }
  if (submitted.gate_id !== gate.id) {
    return failure("gate.gate_id_mismatch", "submitted evidence targets another gate", gate.id);
  }
  if (submitted.evidence_type !== gate.evidence_type) {
    return failure(
      "gate.evidence_type_mismatch",
      "submitted evidence type differs from the packet-owned evidence type",
      gate.id,
    );
  }
  return success(true);
}

function notRunCheckEvidence(
  gate: ResolvedGateExecution,
  submitted: SubmittedCheckEvidence | undefined,
  dependencies: GateRunnerDependencies,
): RuntimeResult<GateEvidence> {
  if (gate.execution.kind !== "check") {
    return failure("gate.packet_invalid", "check gate execution is required", gate.id);
  }
  const now = clockValue(dependencies.clock);
  if (!now.ok) return now;
  const exactResult = submitted?.exact_result ?? "";
  const redacted = submitted === undefined
    ? success("")
    : redactOutput(exactResult, gate.id + "/not-run");
  if (!redacted.ok) return redacted;
  return success({
    schema_version: "1.0.0",
    gate_id: gate.id,
    definition_ref: gate.definition_ref,
    evidence_type: gate.evidence_type,
    execution_kind: "check",
    status: "not_run",
    required: false,
    conflict_sensitive: gate.conflict_sensitive,
    command: null,
    verifier_role: gate.execution.verifier_role,
    exit_code: null,
    stdout_redacted: redacted.value,
    stderr_redacted: "",
    stdout_sha256: sha256(exactResult),
    stderr_sha256: sha256(""),
    evidence_ids: submitted === undefined ? [] : unique(submitted.evidence_ids),
    approval_refs: submitted === undefined
      ? unique(gate.execution.approval_refs)
      : unique(submitted.approval_refs),
    occurred_at: submitted?.occurred_at ?? now.value.toISOString(),
    duration_ms: 0,
    not_run_reason: submitted === undefined
      ? "submitted verifier evidence was not provided"
      : redacted.value,
  });
}

function requiredCheckNotRun(gate: ResolvedGateExecution): RuntimeResult<GateEvidence> {
  return failure(
    "gate.required_check_not_run",
    "required verifier evidence was not supplied as a completed check",
    gate.id,
  );
}

async function runCheckGate(
  root: URL,
  gate: ResolvedGateExecution,
  submitted: SubmittedCheckEvidence | undefined,
  dependencies: GateRunnerDependencies,
): Promise<RuntimeResult<GateEvidence>> {
  if (gate.execution.kind !== "check") {
    return failure("gate.packet_invalid", "check gate execution is required", gate.id);
  }
  if (submitted === undefined) {
    return gate.required
      ? requiredCheckNotRun(gate)
      : notRunCheckEvidence(gate, undefined, dependencies);
  }
  const valid = validateSubmitted(gate, submitted);
  if (!valid.ok) return valid;
  if (submitted.verifier_role !== gate.execution.verifier_role) {
    return failure(
      "gate.verifier_role_mismatch",
      "submitted verifier role differs from the packet-owned verifier role",
      gate.id,
    );
  }
  if (!sameStrings(submitted.approval_refs, gate.execution.approval_refs)) {
    return failure(
      "gate.approval_refs_mismatch",
      "submitted approval refs differ from the packet-owned approval refs",
      gate.id,
    );
  }
  if (submitted.status === "not_run") {
    return gate.required
      ? requiredCheckNotRun(gate)
      : notRunCheckEvidence(gate, submitted, dependencies);
  }
  if (gate.execution.verifier_role === "external") {
    if (
      gate.execution.approval_refs.length === 0 ||
      dependencies.external_approval_validator === undefined
    ) {
      return failure(
        "gate.approval_validation_unavailable",
        "external checks require canonical authority approval validation",
        gate.id,
      );
    }
    const approved = await dependencies.external_approval_validator.validate({
      root,
      gate,
      submitted_evidence: submitted,
    });
    if (!approved.ok) return approved;
    if (!sameStrings(approved.value, gate.execution.approval_refs)) {
      return failure(
        "gate.approval_validation_drift",
        "authority validation did not cover the exact packet approval refs",
        gate.id,
      );
    }
  }
  const redacted = redactOutput(submitted.exact_result, gate.id + "/result");
  if (!redacted.ok) return redacted;
  return success({
    schema_version: "1.0.0",
    gate_id: gate.id,
    definition_ref: gate.definition_ref,
    evidence_type: gate.evidence_type,
    execution_kind: "check",
    status: submitted.status,
    required: gate.required,
    conflict_sensitive: gate.conflict_sensitive,
    command: null,
    verifier_role: gate.execution.verifier_role,
    exit_code: null,
    stdout_redacted: redacted.value,
    stderr_redacted: "",
    stdout_sha256: sha256(submitted.exact_result),
    stderr_sha256: sha256(""),
    evidence_ids: unique(submitted.evidence_ids),
    approval_refs: unique(submitted.approval_refs),
    occurred_at: submitted.occurred_at,
    duration_ms: 0,
    not_run_reason: null,
  });
}
export function createGateRunner(
  dependencies: GateRunnerDependencies,
): GateRunner {
  return {
    async run(root, gate, submittedCheck) {
      const valid = validateGate(gate);
      if (!valid.ok) return valid;
      if (gate.execution.kind === "command") {
        if (submittedCheck !== undefined) {
          return failure(
            "gate.submitted_evidence_unexpected",
            "command gates execute their structured command and do not accept verifier submissions",
            gate.id,
          );
        }
        return runCommandGate(root, gate, dependencies);
      }
      return runCheckGate(root, gate, submittedCheck, dependencies);
    },
  };
}
