export type BenchmarkFeatureValue =
  | string
  | number
  | boolean
  | readonly string[];

export interface BenchmarkAuthority {
  readonly mutation: "none" | "task-scoped" | "approval-required";
  readonly external_action: "none" | "explicit-approval-required";
}

export interface ExpectedResolution {
  readonly decision: "selected" | "rejected" | "review_required";
  readonly root_boundary: {
    readonly kind: string;
    readonly primary_archetype: string;
  };
  readonly blueprint: string | null;
  readonly prohibited_blueprints: readonly string[];
  readonly reason_codes: readonly string[];
  readonly components: readonly string[];
  readonly domains: readonly string[];
  readonly overlays: readonly string[];
  readonly patterns: readonly string[];
  readonly authority: BenchmarkAuthority;
  readonly evidence: {
    readonly required: boolean;
    readonly source_fixture_id: string;
  };
  readonly gates: readonly string[];
}

export interface BenchmarkCase {
  readonly id: string;
  readonly supported: boolean;
  readonly brief: string;
  readonly normalized_features: Readonly<Record<string, BenchmarkFeatureValue>>;
  readonly expected: ExpectedResolution;
  readonly max_clarification_questions: 0 | 1;
}

export interface BenchmarkCaseResult {
  readonly case_id: string;
  readonly correct: boolean;
  readonly clarification_questions: number;
  readonly invented_definition_ids: readonly string[];
  readonly requested_authority: BenchmarkAuthority;
  readonly issue_codes: readonly string[];
}

export interface LowerReasoningTrialRecord {
  readonly run_id: string;
  readonly fixed_prompt_sha256: string;
  readonly clean_repository_sha: string;
  readonly model_tool_id: string;
  readonly raw_result_sha256: string;
  readonly rubric_sha256: string;
  readonly reviewer: string;
  readonly recorded_at: string;
  readonly supported_case_ids: readonly string[];
  readonly redacted_evidence_paths: readonly string[];
  readonly contains_credentials: boolean;
  readonly supported_resolution_rate: number;
  readonly schema_invention_count: number;
  readonly authority_expansion_count: number;
  readonly max_clarification_questions: number;
}

export interface LowerReasoningTrialAssessment {
  readonly required_runs: 2;
  readonly required_supported_briefs_per_run: 30;
  readonly recorded_runs: number;
  readonly qualifying_runs: number;
  readonly accepted: boolean;
  readonly issues: readonly string[];
}

export interface BenchmarkReport {
  readonly schema_version: "1.0.0";
  readonly case_count: number;
  readonly supported_count: number;
  readonly supported_correct_count: number;
  readonly supported_resolution_rate: number;
  readonly schema_invention_count: number;
  readonly authority_expansion_count: number;
  readonly max_clarification_questions: number;
  readonly deterministic_gate_passed: boolean;
  readonly gate_failures: readonly string[];
  readonly results: readonly BenchmarkCaseResult[];
  readonly lower_reasoning_trials: LowerReasoningTrialAssessment;
  readonly v1_accepted: boolean;
}
