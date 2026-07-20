import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import type {
  GuidedLegacyImportInput,
  LegacyFactCategory,
  ReviewedImportDestination,
  ReviewedImportPlanInput,
  ReviewedImportMetadata,
} from "./contracts.js";

function reportDestination(
  destination: ReviewedImportDestination | null,
): Readonly<Record<string, string | null>> | null {
  if (destination === null) return null;
  if (destination.kind === "archive_only") return { kind: destination.kind };
  if (destination.kind === "canonical_document_patch") {
    return {
      kind: destination.kind,
      document_path: destination.document_path,
      expected_existing_sha256: destination.patch.expected_existing_sha256,
      replacement_sha256: sha256(destination.patch.replacement_bytes),
      approval_id: destination.approval_id,
    };
  }
  return {
    kind: destination.kind,
    record_type: destination.record_type,
    record_id: destination.record_id,
    status: destination.status,
    approval_id: destination.approval_id,
  };
}

export function renderImportReport(
  input: ReviewedImportPlanInput,
  metadata: Omit<ReviewedImportMetadata, "import_report_hash">,
): Uint8Array {
  return new TextEncoder().encode(canonicalJson({
    schema_version: "1.0.0",
    root_id: input.root_id,
    proposal_hash: input.proposal_hash,
    created_at: input.created_at,
    approvals: [...input.approval_ids].sort(),
    candidates: input.candidates.toSorted((left, right) =>
      left.candidate_id.localeCompare(right.candidate_id),
    ).map((candidate) => ({
      candidate_id: candidate.candidate_id,
      source_path: candidate.source_path,
      source_sha256: candidate.expected_source_sha256,
      disposition: candidate.decision.disposition,
      destination: reportDestination(candidate.decision.destination),
      rationale: candidate.decision.rationale,
      sensitivity_finding_count: candidate.sensitivity_findings.length,
      redacted_sha256: candidate.redacted_bytes === null
        ? null
        : sha256(candidate.redacted_bytes),
    })),
    effects: metadata,
  }));
}

export interface GuidedImportReportFact {
  readonly source_line_start: number;
  readonly source_line_end: number;
  readonly category: LegacyFactCategory;
  readonly title: string;
  readonly statement: string;
  readonly rationale: string;
  readonly confidence: "high" | "medium" | "low";
  readonly evidence_record_id: string | null;
  readonly imported_record_id: string | null;
}

export interface GuidedImportReportCandidate {
  readonly candidate_id: string;
  readonly source_path: string;
  readonly source_sha256: string;
  readonly source_git_revision: string | null;
  readonly disposition: "import" | "archive" | "reject" | "unresolved";
  readonly rationale: string;
  readonly sensitivity_finding_count: number;
  readonly archive_path: string | null;
  readonly unresolved_reason: string | null;
  readonly facts: readonly GuidedImportReportFact[];
}

export function renderGuidedImportReport(
  input: GuidedLegacyImportInput,
  candidates: readonly GuidedImportReportCandidate[],
  metadata: Omit<ReviewedImportMetadata, "import_report_hash">,
): Uint8Array {
  return new TextEncoder().encode(canonicalJson({
    schema_version: "1.0.0",
    root_id: input.root_id,
    proposal_hash: input.proposal_hash,
    created_at: input.created_at,
    approvals: [],
    approval_binding: {
      expected_head: input.expected_head,
      profile_lock_hash: input.profile_lock_hash,
      target_ref: input.target_ref,
    },
    candidates: candidates.toSorted((left, right) =>
      left.source_path.localeCompare(right.source_path),
    ),
    effects: metadata,
  }));
}
