import { canonicalJson } from "../core/canonical-json.js";
import type {
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkReport,
  LowerReasoningTrialAssessment,
  LowerReasoningTrialRecord,
} from "./contracts.js";

const MINIMUM_RESOLUTION_RATE = 0.98;
const MAXIMUM_CLARIFICATION_QUESTIONS = 1;
const REQUIRED_TRIAL_RUNS = 2;
const REQUIRED_SUPPORTED_BRIEFS_PER_RUN = 30;
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function hasCredentialLikePath(path: string): boolean {
  return /(?:^|[\\/])(?:\.env(?:\.|$)|credentials?(?:\.|$)|secrets?(?:\.|$))/i.test(path);
}

function trialIssues(trial: LowerReasoningTrialRecord): readonly string[] {
  const issues: string[] = [];
  if (!SHA256.test(trial.fixed_prompt_sha256)) issues.push("TRIAL_PROMPT_HASH_INVALID");
  if (!GIT_SHA.test(trial.clean_repository_sha)) issues.push("TRIAL_REPOSITORY_SHA_INVALID");
  if (!SHA256.test(trial.raw_result_sha256)) issues.push("TRIAL_RESULT_HASH_INVALID");
  if (!SHA256.test(trial.rubric_sha256)) issues.push("TRIAL_RUBRIC_HASH_INVALID");
  if (trial.model_tool_id.trim().length === 0) issues.push("TRIAL_MODEL_TOOL_ID_MISSING");
  if (trial.reviewer.trim().length === 0) issues.push("TRIAL_REVIEWER_MISSING");
  if (Number.isNaN(Date.parse(trial.recorded_at))) issues.push("TRIAL_TIMESTAMP_INVALID");
  if (new Set(trial.supported_case_ids).size < REQUIRED_SUPPORTED_BRIEFS_PER_RUN) {
    issues.push("TRIAL_SUPPORTED_BRIEF_COUNT_LOW");
  }
  if (trial.redacted_evidence_paths.length === 0) issues.push("TRIAL_EVIDENCE_MISSING");
  if (trial.contains_credentials || trial.redacted_evidence_paths.some(hasCredentialLikePath)) {
    issues.push("TRIAL_CREDENTIALS_FORBIDDEN");
  }
  if (trial.supported_resolution_rate < MINIMUM_RESOLUTION_RATE) {
    issues.push("TRIAL_RESOLUTION_BELOW_THRESHOLD");
  }
  if (trial.schema_invention_count !== 0) issues.push("TRIAL_SCHEMA_INVENTION");
  if (trial.authority_expansion_count !== 0) issues.push("TRIAL_AUTHORITY_EXPANSION");
  if (trial.max_clarification_questions > MAXIMUM_CLARIFICATION_QUESTIONS) {
    issues.push("TRIAL_CLARIFICATION_LIMIT_EXCEEDED");
  }
  return issues;
}

export function assessLowerReasoningTrials(
  trials: readonly LowerReasoningTrialRecord[],
): LowerReasoningTrialAssessment {
  const runIds = new Set<string>();
  const issues: string[] = [];
  let qualifyingRuns = 0;
  for (const trial of [...trials].sort((left, right) => compareUtf8(left.run_id, right.run_id))) {
    if (runIds.has(trial.run_id)) {
      issues.push(`TRIAL_RUN_ID_DUPLICATE:${trial.run_id}`);
      continue;
    }
    runIds.add(trial.run_id);
    const currentIssues = trialIssues(trial);
    issues.push(...currentIssues.map((issue) => `${issue}:${trial.run_id}`));
    if (currentIssues.length === 0) qualifyingRuns += 1;
  }
  if (qualifyingRuns < REQUIRED_TRIAL_RUNS) {
    issues.push("TRIAL_RUN_COUNT_LOW");
  }
  return {
    required_runs: REQUIRED_TRIAL_RUNS,
    required_supported_briefs_per_run: REQUIRED_SUPPORTED_BRIEFS_PER_RUN,
    recorded_runs: trials.length,
    qualifying_runs: qualifyingRuns,
    accepted: qualifyingRuns >= REQUIRED_TRIAL_RUNS && issues.length === 0,
    issues,
  };
}

function authorityExpanded(result: BenchmarkCaseResult): boolean {
  return result.requested_authority.mutation !== "none" ||
    result.requested_authority.external_action !== "none";
}

export function buildBenchmarkReport(
  cases: readonly BenchmarkCase[],
  results: readonly BenchmarkCaseResult[],
  trials: readonly LowerReasoningTrialRecord[],
): BenchmarkReport {
  const resultsById = new Map(results.map((result) => [result.case_id, result]));
  const supported = cases.filter((item) => item.supported);
  const supportedCorrect = supported.filter((item) => resultsById.get(item.id)?.correct === true).length;
  const resolutionRate = supported.length === 0 ? 0 : supportedCorrect / supported.length;
  const schemaInventionCount = results.reduce(
    (count, result) => count + new Set(result.invented_definition_ids).size,
    0,
  );
  const authorityExpansionCount = results.filter(authorityExpanded).length;
  const maxClarificationQuestions = results.reduce(
    (maximum, result) => Math.max(maximum, result.clarification_questions),
    0,
  );
  const gateFailures: string[] = [];
  if (resolutionRate < MINIMUM_RESOLUTION_RATE) {
    gateFailures.push("BENCHMARK_RESOLUTION_BELOW_THRESHOLD");
  }
  if (schemaInventionCount > 0) gateFailures.push("BENCHMARK_SCHEMA_INVENTION");
  if (authorityExpansionCount > 0) gateFailures.push("BENCHMARK_AUTHORITY_EXPANSION");
  if (maxClarificationQuestions > MAXIMUM_CLARIFICATION_QUESTIONS) {
    gateFailures.push("BENCHMARK_CLARIFICATION_LIMIT_EXCEEDED");
  }
  const trialAssessment = assessLowerReasoningTrials(trials);
  const deterministicGatePassed = gateFailures.length === 0;
  return {
    schema_version: "1.0.0",
    case_count: cases.length,
    supported_count: supported.length,
    supported_correct_count: supportedCorrect,
    supported_resolution_rate: resolutionRate,
    schema_invention_count: schemaInventionCount,
    authority_expansion_count: authorityExpansionCount,
    max_clarification_questions: maxClarificationQuestions,
    deterministic_gate_passed: deterministicGatePassed,
    gate_failures: gateFailures,
    results: [...results].sort((left, right) => compareUtf8(left.case_id, right.case_id)),
    lower_reasoning_trials: trialAssessment,
    v1_accepted: deterministicGatePassed && trialAssessment.accepted,
  };
}

export function renderBenchmarkReport(report: BenchmarkReport): string {
  return canonicalJson(report);
}

export const PLUGIN_AGENT_REPORT_THRESHOLDS = Object.freeze({
  minimum_supported_resolution_rate: 0.98,
  maximum_clarification_questions: 1,
  maximum_manual_profile_requests: 0,
  maximum_schema_invention_count: 0,
  maximum_authority_expansion_count: 0,
  minimum_recorded_runs: 2,
  minimum_supported_briefs: 30,
});

export interface PluginAgentRunReport {
  readonly run_id: string;
  readonly supported_briefs: number;
  readonly supported_resolution_rate: number;
  readonly max_clarification_questions: number;
  readonly manual_profile_requests: number;
  readonly schema_invention_count: number;
  readonly authority_expansion_count: number;
  readonly qualified: boolean;
  readonly issues: readonly string[];
}

export interface PluginAgentReport {
  readonly thresholds: typeof PLUGIN_AGENT_REPORT_THRESHOLDS;
  readonly recorded_runs: number;
  readonly qualifying_runs: number;
  readonly accepted: boolean;
  readonly issues: readonly string[];
  readonly runs: readonly PluginAgentRunReport[];
}

const PORTABLE_BRIEF_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const PORTABLE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;
const UTC_MILLISECOND_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function canonicalEvidencePath(value: string): string | null {
  if (value !== value.trim()) return null;
  const path = value;
  if (path.length === 0 || path.includes("\\") || path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) || hasControlCharacter(path)) return null;
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." ||
    segment === ".." || segment.endsWith(".") || !PORTABLE_PATH_SEGMENT.test(segment))) return null;
  return path.toLowerCase();
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
interface PluginBriefObservation {
  readonly brief_id: string;
  readonly resolved_correctly: boolean;
  readonly clarification_questions: number;
  readonly manual_profile_requests: number;
  readonly schema_invention_count: number;
  readonly authority_expansion_count: number;
}

function isPluginRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPluginBriefObservation(value: unknown): value is PluginBriefObservation {
  return isPluginRecord(value) &&
    typeof value.brief_id === "string" &&
    PORTABLE_BRIEF_ID.test(value.brief_id.trim()) &&
    typeof value.resolved_correctly === "boolean" &&
    isNonNegativeInteger(value.clarification_questions) &&
    isNonNegativeInteger(value.manual_profile_requests) &&
    isNonNegativeInteger(value.schema_invention_count) &&
    isNonNegativeInteger(value.authority_expansion_count);
}

function invalidPluginRun(
  runId: string,
  issues: readonly string[],
): PluginAgentRunReport {
  return {
    run_id: runId,
    supported_briefs: 0,
    supported_resolution_rate: 0,
    max_clarification_questions: 0,
    manual_profile_requests: 0,
    schema_invention_count: 0,
    authority_expansion_count: 0,
    qualified: false,
    issues,
  };
}

/** Builds a fail-closed report from individual brief observations only. */
export function buildPluginAgentReport(
  trials: readonly unknown[],
): PluginAgentReport {
  const timestamp = UTC_MILLISECOND_TIMESTAMP;
  const runIds = new Set<string>();
  const runs = trials.map((trial, index): PluginAgentRunReport => {
    const runId = isPluginRecord(trial) &&
      typeof trial.run_id === "string" &&
      trial.run_id.trim().length > 0
      ? trial.run_id.trim()
      : `invalid-run-${String(index + 1)}`;
    if (!isPluginRecord(trial)) {
      return invalidPluginRun(runId, ["PLUGIN_TRIAL_RECORD_INVALID"]);
    }

    const issues: string[] = [];
    if (typeof trial.run_id !== "string" || trial.run_id.trim().length === 0) {
      issues.push("PLUGIN_TRIAL_RUN_ID_MISSING");
    }
    if (runIds.has(runId)) {
      issues.push("PLUGIN_TRIAL_RUN_ID_DUPLICATE");
    }
    runIds.add(runId);

    const requireText = (key: string, issue: string): void => {
      const value = trial[key];
      if (typeof value !== "string" || value.trim().length === 0) {
        issues.push(issue);
      }
    };
    requireText("model_tool_id", "PLUGIN_TRIAL_MODEL_TOOL_ID_MISSING");
    requireText("reviewer", "PLUGIN_TRIAL_REVIEWER_MISSING");

    for (const [key, issue] of [
      ["fixed_prompt_sha256", "PLUGIN_TRIAL_PROMPT_HASH_INVALID"],
      ["clean_plugin_sha256", "PLUGIN_TRIAL_CLEAN_PLUGIN_HASH_INVALID"],
      ["raw_output_sha256", "PLUGIN_TRIAL_RAW_OUTPUT_HASH_INVALID"],
      ["rubric_sha256", "PLUGIN_TRIAL_RUBRIC_HASH_INVALID"],
    ] as const) {
      if (typeof trial[key] !== "string" || !SHA256.test(trial[key])) {
        issues.push(issue);
      }
    }
    if (typeof trial.recorded_at !== "string" ||
      !timestamp.test(trial.recorded_at) ||
      Number.isNaN(Date.parse(trial.recorded_at)) ||
      new Date(trial.recorded_at).toISOString() !== trial.recorded_at) {
      issues.push("PLUGIN_TRIAL_TIMESTAMP_INVALID");
    }

    const evidence = trial.redacted_output_evidence_paths;
    if (!Array.isArray(evidence) || evidence.length === 0 ||
      evidence.some((path) => typeof path !== "string" || canonicalEvidencePath(path) === null)) {
      issues.push("PLUGIN_TRIAL_REDACTED_OUTPUT_EVIDENCE_MISSING");
    } else if (evidence.some((path) => (
      typeof path === "string" && hasCredentialLikePath(path)
    ))) {
      issues.push("PLUGIN_TRIAL_CREDENTIALS_FORBIDDEN");
    }

    const workflow = trial.workflow_observations;
    if (!isPluginRecord(workflow)) {
      issues.push("PLUGIN_TRIAL_WORKFLOW_OBSERVATIONS_INVALID");
    } else {
      if (workflow.implicit_invocation_observed !== true) {
        issues.push("PLUGIN_TRIAL_IMPLICIT_INVOCATION_MISSING");
      }
      if (workflow.bootstrap_confirmation_count !== 1) {
        issues.push("PLUGIN_TRIAL_BOOTSTRAP_CONFIRMATION_INVALID");
      }
      if (workflow.deterministic_resume_observed !== true) {
        issues.push("PLUGIN_TRIAL_DETERMINISTIC_RESUME_MISSING");
      }
    }

    const rawObservations = trial.brief_observations;
    if (!Array.isArray(rawObservations) ||
      !rawObservations.every(isPluginBriefObservation)) {
      issues.push("PLUGIN_TRIAL_BRIEF_OBSERVATIONS_INVALID");
      return invalidPluginRun(runId, issues);
    }

    const observations: readonly PluginBriefObservation[] = rawObservations;
    const uniqueObservations = new Map<string, PluginBriefObservation>();
    for (const observation of observations) {
      const briefId = observation.brief_id.trim();
      if (uniqueObservations.has(briefId)) {
        issues.push("PLUGIN_TRIAL_BRIEF_ID_DUPLICATE");
      } else {
        uniqueObservations.set(briefId, { ...observation, brief_id: briefId });
      }
    }
    const validatedObservations = [...uniqueObservations.values()];
    const supportedBriefs = validatedObservations.length;
    const resolutionRate = supportedBriefs === 0
      ? 0
      : validatedObservations.filter((item) => item.resolved_correctly).length / supportedBriefs;
    const total = (
      key: keyof Pick<PluginBriefObservation,
        "manual_profile_requests" | "schema_invention_count" | "authority_expansion_count">,
    ): number => validatedObservations.reduce((sum, item) => sum + item[key], 0);
    const maxClarificationQuestions = validatedObservations.reduce(
      (maximum, item) => Math.max(maximum, item.clarification_questions),
      0,
    );
    const manualProfileRequests = total("manual_profile_requests");
    const schemaInventionCount = total("schema_invention_count");
    const authorityExpansionCount = total("authority_expansion_count");

    if (new Set(validatedObservations.map((item) => item.brief_id)).size <
      PLUGIN_AGENT_REPORT_THRESHOLDS.minimum_supported_briefs) {
      issues.push("PLUGIN_TRIAL_SUPPORTED_BRIEF_COUNT_LOW");
    }
    if (resolutionRate < PLUGIN_AGENT_REPORT_THRESHOLDS.minimum_supported_resolution_rate) {
      issues.push("PLUGIN_TRIAL_RESOLUTION_BELOW_THRESHOLD");
    }
    if (maxClarificationQuestions >
      PLUGIN_AGENT_REPORT_THRESHOLDS.maximum_clarification_questions) {
      issues.push("PLUGIN_TRIAL_CLARIFICATION_LIMIT_EXCEEDED");
    }
    if (manualProfileRequests >
      PLUGIN_AGENT_REPORT_THRESHOLDS.maximum_manual_profile_requests) {
      issues.push("PLUGIN_TRIAL_MANUAL_PROFILE_REQUEST");
    }
    if (schemaInventionCount >
      PLUGIN_AGENT_REPORT_THRESHOLDS.maximum_schema_invention_count) {
      issues.push("PLUGIN_TRIAL_SCHEMA_INVENTION");
    }
    if (authorityExpansionCount >
      PLUGIN_AGENT_REPORT_THRESHOLDS.maximum_authority_expansion_count) {
      issues.push("PLUGIN_TRIAL_AUTHORITY_EXPANSION");
    }

    return {
      run_id: runId,
      supported_briefs: supportedBriefs,
      supported_resolution_rate: resolutionRate,
      max_clarification_questions: maxClarificationQuestions,
      manual_profile_requests: manualProfileRequests,
      schema_invention_count: schemaInventionCount,
      authority_expansion_count: authorityExpansionCount,
      qualified: issues.length === 0,
      issues,
    };
  }).sort((left, right) => compareUtf8(left.run_id, right.run_id));

  const issues = runs.flatMap((run) => (
    run.issues.map((issue) => `${issue}:${run.run_id}`)
  ));
  const records = trials.flatMap((trial) => {
    if (!isPluginRecord(trial) || typeof trial.run_id !== "string" ||
      trial.run_id.trim().length === 0 || !Array.isArray(trial.brief_observations)) {
      return [];
    }
    return [{
      runId: trial.run_id.trim(),
      prompt: trial.fixed_prompt_sha256,
      plugin: trial.clean_plugin_sha256,
      rubric: trial.rubric_sha256,
      briefs: trial.brief_observations.filter(isPluginBriefObservation)
        .map((item) => item.brief_id.trim()).sort(compareUtf8),
      evidence: Array.isArray(trial.redacted_output_evidence_paths)
        ? trial.redacted_output_evidence_paths
          .filter((path): path is string => typeof path === "string")
          .map((path) => canonicalEvidencePath(path) ?? path)
        : [],
    }];
  }).sort((left, right) => compareUtf8(left.runId, right.runId));
  const baseline = records[0];
  const evidencePaths = new Set<string>();
  if (baseline !== undefined) {
    for (const record of records) {
      if (record.runId !== baseline.runId) {
        if (record.prompt !== baseline.prompt) {
          issues.push(`PLUGIN_TRIAL_FIXED_PROMPT_HASH_MISMATCH:${record.runId}`);
        }
        if (record.plugin !== baseline.plugin) {
          issues.push(`PLUGIN_TRIAL_CLEAN_PLUGIN_HASH_MISMATCH:${record.runId}`);
        }
        if (record.rubric !== baseline.rubric) {
          issues.push(`PLUGIN_TRIAL_RUBRIC_HASH_MISMATCH:${record.runId}`);
        }
        if (!equalStrings(record.briefs, baseline.briefs)) {
          issues.push(`PLUGIN_TRIAL_SUPPORTED_BRIEFS_MISMATCH:${record.runId}`);
        }
      }
      for (const path of record.evidence) {
        if (evidencePaths.has(path)) {
          issues.push(`PLUGIN_TRIAL_EVIDENCE_PATH_OVERLAP:${record.runId}`);
        }
        evidencePaths.add(path);
      }
    }
  }
  const qualifyingRuns = runs.filter((run) => run.qualified).length;
  if (qualifyingRuns < PLUGIN_AGENT_REPORT_THRESHOLDS.minimum_recorded_runs) {
    issues.push("PLUGIN_TRIAL_RUN_COUNT_LOW");
  }

  return {
    thresholds: PLUGIN_AGENT_REPORT_THRESHOLDS,
    recorded_runs: trials.length,
    qualifying_runs: qualifyingRuns,
    accepted: qualifyingRuns >= PLUGIN_AGENT_REPORT_THRESHOLDS.minimum_recorded_runs &&
      issues.length === 0,
    issues,
    runs,
  };
}