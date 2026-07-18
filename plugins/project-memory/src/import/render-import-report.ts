import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import type {
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
