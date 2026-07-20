import {
  failure,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type { DoctorReport } from "../cli/commands/doctor.js";
import type {
  AgentBootstrapProposal,
  AgentStartDependencies,
  AgentStartDirective,
  AgentStartInput,
} from "./contracts.js";

export const AGENT_READING_ORDER_PREFIX = Object.freeze([
  "PROJECT_CONTEXT.md",
  "docs/project-memory/PROTOCOL.md",
  "docs/project-memory/profile.lock.yaml",
  "docs/project-memory/views/NOW.md",
  "docs/project-memory/views/HANDOFF.md",
] as const);

const UNINITIALIZED_CODES = new Set(["CONFIG_MISSING", "CONFIG_NOT_FOUND"]);

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function stableIssues(issues: readonly RuntimeIssue[]): readonly RuntimeIssue[] {
  return [...issues].sort((left, right) =>
    compareUtf8(`${left.code}\u0000${left.path}`, `${right.code}\u0000${right.path}`),
  );
}

function agentIssue(
  code: string,
  message: string,
  path = "",
  references: readonly string[] = [],
): RuntimeIssue {
  return { code, severity: "error", path, message, references };
}

function blocked(issues: readonly RuntimeIssue[]): RuntimeResult<AgentStartDirective> {
  return success({ kind: "blocked", issues: stableIssues(issues) });
}

async function callDependency<T>(
  name: string,
  operation: () => Promise<RuntimeResult<T>>,
): Promise<RuntimeResult<T>> {
  try {
    return await operation();
  } catch {
    return failure(
      "AGENT_DEPENDENCY_REJECTED",
      `${name} dependency rejected`,
      name,
    );
  }
}

function failedDoctorIssues(report: DoctorReport): readonly RuntimeIssue[] {
  return report.checks.flatMap((check) =>
    check.status === "failed" && check.issue !== null ? [check.issue] : [],
  );
}

function isUninitialized(issues: readonly RuntimeIssue[]): boolean {
  return issues.length > 0 && issues.every((item) => UNINITIALIZED_CODES.has(item.code));
}

function safeRelativePath(value: string): boolean {
  if (
    value.length === 0 || value.includes("\\") || value.includes("\0") ||
    value.includes("\r") || value.includes("\n") || value.startsWith("/") ||
    /^[A-Za-z]:/.test(value)
  ) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function validateInput(input: AgentStartInput): RuntimeResult<true> {
  if (input.root.protocol !== "file:") {
    return failure("AGENT_ROOT_INVALID", "agent startup root must be a file URL", input.root.href);
  }
  if (!/^adapter[.][a-z][a-z0-9-]*$/.test(input.adapter_id)) {
    return failure("AGENT_ADAPTER_INVALID", "agent adapter ID is invalid", input.adapter_id);
  }
  if (input.brief_path !== null && !safeRelativePath(input.brief_path)) {
    return failure("AGENT_BRIEF_PATH_INVALID", "brief path must be repository-relative", input.brief_path);
  }
  return success(true);
}

async function bootstrapDirective(
  input: AgentStartInput,
  dependencies: AgentStartDependencies,
): Promise<RuntimeResult<AgentStartDirective>> {
  const planned = await callDependency("planInitialization", () =>
    dependencies.planInitialization({
      root: input.root,
      brief_path: input.brief_path,
      adapter_id: input.adapter_id,
    }),
  );
  if (!planned.ok) return blocked(planned.issues);
  const proposeLegacyImport = dependencies.proposeLegacyImport;
  const legacy = proposeLegacyImport === undefined
    ? success(null)
    : await callDependency("proposeLegacyImport", () =>
        proposeLegacyImport({
          root: input.root,
          root_id: planned.value.target_root_id,
        }));
  if (!legacy.ok) return blocked(legacy.issues);
  const proposal: AgentBootstrapProposal = {
    confirmation_required: true,
    plan: planned.value,
  };
  return success({
    kind: "bootstrap_review_required",
    proposal,
    clarification: proposal.plan.source_proposal.clarification,
    legacy_import_proposal: legacy.value,
    apply_command: [
      "init",
      "apply",
      "--plan",
      ".tmp/project-memory/init.plan.json",
      "--approval",
      ".tmp/project-memory/init.approval.json",
      "--expected-plan-hash",
      proposal.plan.plan_hash,
      "--expected-head",
      proposal.plan.expected_head,
      "--json",
    ],
  }, planned.warnings);
}

export async function startAgentSession(
  input: AgentStartInput,
  dependencies: AgentStartDependencies,
): Promise<RuntimeResult<AgentStartDirective>> {
  const validInput = validateInput(input);
  if (!validInput.ok) return validInput;

  const doctor = await callDependency("doctor", () => dependencies.doctor({ root: input.root }));
  const doctorIssues = doctor.ok ? failedDoctorIssues(doctor.value) : doctor.issues;
  const uninitialized = isUninitialized(doctorIssues);
  if (!doctor.ok || !doctor.value.valid) {
    if (!uninitialized) {
      return blocked(doctorIssues.length > 0
        ? doctorIssues
        : [agentIssue("AGENT_DOCTOR_INVALID", "repository diagnostics are not valid")]);
    }
    return bootstrapDirective(input, dependencies);
  }

  const profile = await callDependency("verifyProfile", () => dependencies.verifyProfile(input.root));
  if (!profile.ok) return blocked(profile.issues);
  if (!profile.value.valid) {
    return blocked([agentIssue("AGENT_PROFILE_STALE", "profile verification did not pass")]);
  }
  if (doctor.value.root_id !== null && doctor.value.root_id !== profile.value.root_id) {
    return blocked([agentIssue(
      "AGENT_ROOT_BINDING_MISMATCH",
      "doctor and profile verification returned different roots",
      "root_id",
      [doctor.value.root_id, profile.value.root_id],
    )]);
  }

  const views = await callDependency("verifyViews", () => dependencies.verifyViews(input.root));
  if (!views.ok) return blocked(views.issues);
  if (!views.value.valid) {
    return blocked([agentIssue(
      "AGENT_VIEWS_STALE",
      "generated project views are missing, invalid, or stale",
      "docs/project-memory/views",
      [...new Set([
        ...views.value.drifted_paths,
        ...views.value.missing_paths,
        ...views.value.metadata_invalid_paths,
      ])].sort(compareUtf8),
    )]);
  }

  const pending = await callDependency("findPendingLegacyReview", () =>
    dependencies.findPendingLegacyReview({
      root: input.root,
      root_id: profile.value.root_id,
    }),
  );
  if (!pending.ok) return blocked(pending.issues);
  if (pending.value !== null) {
    if (
      pending.value.root_id !== profile.value.root_id ||
      pending.value.proposal.root_id !== profile.value.root_id ||
      pending.value.proposal.scan_hash !== pending.value.scan.scan_hash
    ) {
      return blocked([agentIssue(
        "AGENT_LEGACY_BINDING_MISMATCH",
        "pending legacy review is not bound to the verified project root and scan",
        "root_id",
      )]);
    }
    const head = await callDependency("currentGitHead", () =>
      dependencies.currentGitHead(input.root),
    );
    if (!head.ok) return blocked(head.issues);
    if (!/^[0-9a-f]{40}$/u.test(head.value)) {
      return blocked([agentIssue(
        "AGENT_GIT_HEAD_INVALID",
        "current Git head must be an exact 40-character revision",
        "HEAD",
      )]);
    }
    const warnings = stableIssues([
      ...doctor.warnings,
      ...profile.warnings,
      ...views.warnings,
      ...pending.warnings,
      ...head.warnings,
    ]);
    return success({
      kind: "legacy_import_review_required",
      root_id: profile.value.root_id,
      profile_lock_hash: profile.value.profile_lock_hash,
      expected_head: head.value,
      proposal: pending.value.proposal,
      pending: pending.value,
      warnings,
    }, warnings);
  }

  const assigned = await callDependency("findAssignedTaskPackets", () =>
    dependencies.findAssignedTaskPackets(input.root),
  );
  if (!assigned.ok) return blocked(assigned.issues);

  const taskPackets = [...new Set(assigned.value)].sort(compareUtf8);
  const unsafePacket = taskPackets.find((value) => !safeRelativePath(value));
  if (unsafePacket !== undefined) {
    return blocked([agentIssue(
      "AGENT_TASK_PACKET_PATH_INVALID",
      "assigned task packet path must be repository-relative",
      unsafePacket,
    )]);
  }
  const warnings = stableIssues([
    ...doctor.warnings,
    ...profile.warnings,
    ...views.warnings,
    ...pending.warnings,
    ...assigned.warnings,
  ]);
  return success({
    kind: "resume",
    root_id: profile.value.root_id,
    profile_lock_hash: profile.value.profile_lock_hash,
    reading_order: [...AGENT_READING_ORDER_PREFIX, ...taskPackets],
    assigned_task_packets: taskPackets,
    warnings,
  }, warnings);
}
