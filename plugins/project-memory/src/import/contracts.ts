import type { CanonicalMutationPlan } from "../contracts/canonical-mutation-plan.js";
import type { RuntimeResult } from "../contracts/runtime-result.js";

export type LegacyDocumentRole =
  | "prd"
  | "requirements"
  | "handoff"
  | "changelog"
  | "decision-log"
  | "task-list"
  | "agent-instructions"
  | "readme"
  | "unknown";

export interface SensitivityFinding {
  readonly kind: "credential-pattern" | "private-key" | "personal-data";
  readonly line: number;
  readonly message: string;
}

export interface LegacySourceArtifact {
  readonly relative_path: string;
  readonly sha256: string;
  readonly byte_length: number;
  readonly git_revision: string | null;
  readonly detected_roles: readonly LegacyDocumentRole[];
  readonly sensitivity_findings: readonly SensitivityFinding[];
}

export interface LegacyScan {
  readonly schema_version: "1.0.0";
  readonly root: string;
  readonly artifacts: readonly LegacySourceArtifact[];
  readonly scan_hash: string;
}

export type LegacyClassification =
  | "observation"
  | "directional_candidate"
  | "historical_status"
  | "view_candidate"
  | "archive_only";

export type LegacyDestinationKind =
  | "canonical_document_patch"
  | "canonical_record"
  | "view_candidate"
  | "archive_only";

export interface LegacyImportMapping {
  readonly source_path: string;
  readonly source_sha256: string;
  readonly classification: LegacyClassification;
  readonly destination_kind: LegacyDestinationKind;
  readonly destination_path: string | null;
  readonly accepted: false;
  readonly rationale: string;
}

export interface LegacyImportReviewContext {
  readonly root_id: string;
  readonly governing_document: string;
}

export interface LegacyImportProposal {
  readonly schema_version: "1.0.0";
  readonly root_id: string;
  readonly status: "review_required";
  readonly scan_hash: string;
  readonly mappings: readonly LegacyImportMapping[];
  readonly proposal_hash: string;
}

export interface ReviewedLegacyDecision {
  readonly source_path: string;
  readonly source_bytes: Uint8Array;
  readonly source_sha256: string;
  readonly decision: "accept" | "archive" | "exclude";
  readonly classification: LegacyClassification;
  readonly destination_kind: LegacyDestinationKind;
  readonly destination_path: string | null;
}

export interface ReviewedLegacyImportInput {
  readonly root_id: string;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly profile_lock_hash: string;
  readonly proposal_hash: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly approval_ids: readonly string[];
  readonly decisions: readonly ReviewedLegacyDecision[];
}

export interface LegacyImportMetadata {
  readonly governance_kind: "import";
  readonly proposal_hash: string;
  readonly imported_source_hashes: readonly string[];
  readonly excluded_source_paths: readonly string[];
  readonly destination_paths: readonly string[];
}

export type LegacyImportPlan = CanonicalMutationPlan<LegacyImportMetadata>;

export interface SourceDocumentPatch {
  readonly expected_existing_sha256: string;
  readonly replacement_bytes: Uint8Array;
}

export type ImportedRecordStatus = "proposed" | "accepted" | "historical";

export type ReviewedImportDestination =
  | {
      readonly kind: "canonical_document_patch";
      readonly document_path: string;
      readonly patch: SourceDocumentPatch;
      readonly approval_id: string;
    }
  | {
      readonly kind: "canonical_record";
      readonly record_type: string;
      readonly record_id: string;
      readonly status: ImportedRecordStatus;
      readonly approval_id: string;
    }
  | { readonly kind: "archive_only" };

export interface ReviewedImportDecision {
  readonly candidate_id: string;
  readonly disposition: "import" | "reject";
  readonly destination: ReviewedImportDestination | null;
  readonly rationale: string;
}

export interface ReviewedImportCandidate {
  readonly candidate_id: string;
  readonly source_path: string;
  readonly source_bytes: Uint8Array;
  readonly expected_source_sha256: string;
  readonly sensitivity_findings: readonly SensitivityFinding[];
  readonly redacted_bytes: Uint8Array | null;
  readonly decision: ReviewedImportDecision;
}

export interface ReviewedImportPlanInput {
  readonly root_id: string;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly profile_lock_hash: string;
  readonly proposal_hash: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly approval_ids: readonly string[];
  readonly candidates: readonly ReviewedImportCandidate[];
}

export interface ReviewedImportMetadata {
  readonly governance_kind: "import";
  readonly proposal_hash: string;
  readonly imported_candidate_ids: readonly string[];
  readonly rejected_candidate_ids: readonly string[];
  readonly original_archive_paths: readonly string[];
  readonly redacted_archive_paths: readonly string[];
  readonly destination_paths: readonly string[];
  readonly import_report_path: string;
  readonly import_report_hash: string;
  readonly required_view_paths: readonly string[];
  readonly resolved_source_paths?: readonly string[];
  readonly unresolved_source_paths?: readonly string[];
  readonly imported_fact_record_ids?: readonly string[];
  readonly guided_input_hash?: string;
}

export type ReviewedImportPlan = CanonicalMutationPlan<ReviewedImportMetadata>;

export type LegacyFactCategory =
  | "completed_work"
  | "current_decision"
  | "constraint"
  | "next_action"
  | "idea"
  | "risk"
  | "finding"
  | "removed"
  | "rejected"
  | "superseded"
  | "lesson";

export interface LegacyFactDraft {
  readonly source_line_start: number;
  readonly source_line_end: number;
  readonly category: LegacyFactCategory;
  readonly title: string;
  readonly statement: string;
  readonly rationale: string;
  readonly confidence: "high" | "medium" | "low";
}

export interface LegacySourceReviewDraft {
  readonly source_path: string;
  readonly source_sha256: string;
  readonly source_git_revision?: string | null;
  readonly disposition: "import" | "archive" | "reject" | "unresolved";
  readonly rationale: string;
  readonly facts: readonly LegacyFactDraft[];
}

export interface GuidedLegacyImportInput {
  readonly root_id: string;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly profile_lock_hash: string;
  readonly catalog_version: string;
  readonly proposal_hash: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly sources: readonly LegacySourceReviewDraft[];
}

export interface LegacyScanOptions {
  readonly phase: "bootstrap" | "post_bootstrap";
}

export interface PendingLegacyReview {
  readonly root_id: string;
  readonly scan: LegacyScan;
  readonly proposal: LegacyImportProposal;
}

export interface LegacyScanner {
  scan(root: URL, options?: LegacyScanOptions): Promise<RuntimeResult<LegacyScan>>;
}

export interface LegacyImporter extends LegacyScanner {
  propose(
    scan: LegacyScan,
    context: LegacyImportReviewContext,
  ): RuntimeResult<LegacyImportProposal>;
  plan(input: ReviewedLegacyImportInput): RuntimeResult<LegacyImportPlan>;
  plan(input: ReviewedImportPlanInput): RuntimeResult<ReviewedImportPlan>;
}
