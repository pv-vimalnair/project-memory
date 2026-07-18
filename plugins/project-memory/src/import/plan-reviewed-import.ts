import type { PlannedWrite } from "../contracts/planned-write.js";
import { canonicalMutationPlanHash } from "../contracts/canonical-mutation-plan.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import { decodeStrictUtf8 } from "../core/document-io.js";
import { sha256 } from "../core/hash.js";
import { GENERATED_VIEW_PATHS } from "../governance/views/generate-views.js";
import { findSensitivity } from "./classifiers.js";
import type {
  ReviewedImportCandidate,
  ReviewedImportMetadata,
  ReviewedImportPlan,
  ReviewedImportPlanInput,
} from "./contracts.js";
import { renderImportReport } from "./render-import-report.js";

export interface ReviewedImportPlanningDependencies {
  readonly plan_archive: (
    candidate: ReviewedImportCandidate,
  ) => RuntimeResult<readonly PlannedWrite[]>;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function defaultArchivePlan(
  candidate: ReviewedImportCandidate,
): RuntimeResult<readonly PlannedWrite[]> {
  const writes: PlannedWrite[] = [{
    relative_path: `docs/project-memory/archive/imports/original/${candidate.expected_source_sha256}.bin`,
    bytes: new Uint8Array(candidate.source_bytes),
    expected_existing_sha256: null,
    mode: "create",
  }];
  if (candidate.redacted_bytes !== null) {
    writes.push({
      relative_path: `docs/project-memory/archive/imports/redacted/${sha256(candidate.redacted_bytes)}.bin`,
      bytes: new Uint8Array(candidate.redacted_bytes),
      expected_existing_sha256: null,
      mode: "create",
    });
  }
  return success(writes);
}

function destinationPath(candidate: ReviewedImportCandidate): string | null {
  const destination = candidate.decision.destination;
  if (destination === null || destination.kind === "archive_only") return null;
  if (destination.kind === "canonical_document_patch") return destination.document_path;
  return `docs/project-memory/records/${destination.record_type}/${destination.record_id}.json`;
}

function destinationWrite(candidate: ReviewedImportCandidate): RuntimeResult<PlannedWrite | null> {
  const destination = candidate.decision.destination;
  if (destination === null || destination.kind === "archive_only") return success(null);
  if (destination.kind === "canonical_document_patch") {
    return success({
      relative_path: destination.document_path,
      bytes: new Uint8Array(destination.patch.replacement_bytes),
      expected_existing_sha256: destination.patch.expected_existing_sha256,
      mode: "replace",
    });
  }
  if (
    !/^[a-z][a-z0-9-]*$/.test(destination.record_type) ||
    !/^[A-Z]+-[0-9A-HJKMNP-TV-Z]{26}$/.test(destination.record_id)
  ) {
    return failure("IMPORT_RECORD_DESTINATION_INVALID", "canonical record destination is invalid", candidate.candidate_id);
  }
  return success({
    relative_path: `docs/project-memory/records/${destination.record_type}/${destination.record_id}.json`,
    bytes: new TextEncoder().encode(canonicalJson({
      schema_version: "1.0.0",
      id: destination.record_id,
      type: destination.record_type,
      status: destination.status,
      imported_source_sha256: candidate.expected_source_sha256,
      imported_source_path: candidate.source_path,
      approval_id: destination.approval_id,
    })),
    expected_existing_sha256: null,
    mode: "create",
  });
}

function validateRedaction(candidate: ReviewedImportCandidate): RuntimeResult<true> {
  if (candidate.sensitivity_findings.length === 0) return success(true);
  if (candidate.redacted_bytes === null) {
    return failure(
      "IMPORT_SECRET_REDACTION_REQUIRED",
      "sensitive imported source requires separately archived redacted bytes",
      candidate.source_path,
    );
  }
  const decoded = decodeStrictUtf8(candidate.redacted_bytes, candidate.source_path);
  if (!decoded.ok || findSensitivity(decoded.value).length > 0) {
    return failure(
      "IMPORT_REDACTION_INVALID",
      "redacted archive bytes still contain sensitive patterns or invalid text",
      candidate.source_path,
    );
  }
  return success(true);
}

export function planReviewedImport(
  input: ReviewedImportPlanInput,
  dependencies: ReviewedImportPlanningDependencies = { plan_archive: defaultArchivePlan },
): RuntimeResult<ReviewedImportPlan> {
  const candidateIds = new Set<string>();
  const sourcePaths = new Set<string>();
  const destinations = new Set<string>();
  const imported: ReviewedImportCandidate[] = [];
  const rejected: ReviewedImportCandidate[] = [];
  const writes: PlannedWrite[] = [];
  const recordIds: string[] = [];
  for (const candidate of input.candidates) {
    if (
      candidate.candidate_id !== candidate.decision.candidate_id ||
      candidate.candidate_id.trim().length === 0 ||
      candidateIds.has(candidate.candidate_id) ||
      sourcePaths.has(candidate.source_path)
    ) {
      return failure("IMPORT_CANDIDATE_DUPLICATE", "reviewed candidates must have unique bound identities", candidate.candidate_id);
    }
    candidateIds.add(candidate.candidate_id);
    sourcePaths.add(candidate.source_path);
    if (sha256(candidate.source_bytes) !== candidate.expected_source_sha256) {
      return failure("IMPORT_SOURCE_HASH_MISMATCH", "legacy source changed after review", candidate.source_path);
    }
    if (candidate.decision.rationale.trim().length === 0) {
      return failure("IMPORT_RATIONALE_REQUIRED", "every import decision requires rationale", candidate.candidate_id);
    }
    if (candidate.decision.disposition === "reject") {
      if (candidate.decision.destination !== null) {
        return failure(
          "IMPORT_REJECTED_DESTINATION_FORBIDDEN",
          "rejected candidates cannot have a destination",
          candidate.candidate_id,
        );
      }
      rejected.push(candidate);
      continue;
    }
    const destination = candidate.decision.destination;
    if (destination === null) {
      return failure("IMPORT_DESTINATION_REQUIRED", "imported candidate requires exactly one destination", candidate.candidate_id);
    }
    if (
      destination.kind !== "archive_only" &&
      !input.approval_ids.includes(destination.approval_id)
    ) {
      return failure("IMPORT_APPROVAL_REQUIRED", "directional import destination lacks exact approval", candidate.candidate_id);
    }
    const path = destinationPath(candidate);
    if (path !== null && destinations.has(path)) {
      return failure("IMPORT_DESTINATION_DUPLICATE", "reviewed imports repeat a destination", path);
    }
    if (path !== null) destinations.add(path);
    const redaction = validateRedaction(candidate);
    if (!redaction.ok) return redaction;
    const archive = dependencies.plan_archive(candidate);
    if (!archive.ok) return archive;
    for (const write of archive.value) {
      if (!write.relative_path.startsWith("docs/project-memory/archive/imports/") || write.mode !== "create") {
        return failure("IMPORT_ARCHIVE_PLAN_INVALID", "archive planner exceeded its path or mode authority", write.relative_path);
      }
      writes.push(write);
    }
    const destinationEffect = destinationWrite(candidate);
    if (!destinationEffect.ok) return destinationEffect;
    if (destinationEffect.value !== null) writes.push(destinationEffect.value);
    if (destination.kind === "canonical_record") recordIds.push(destination.record_id);
    imported.push(candidate);
  }
  const reportPath = `docs/project-memory/governance/imports/${input.proposal_hash}.json`;
  const originalPaths = writes
    .map((write) => write.relative_path)
    .filter((path) => path.includes("/archive/imports/original/"))
    .sort(compareUtf8);
  const redactedPaths = writes
    .map((write) => write.relative_path)
    .filter((path) => path.includes("/archive/imports/redacted/"))
    .sort(compareUtf8);
  const reportMetadata: Omit<ReviewedImportMetadata, "import_report_hash"> = {
    governance_kind: "import",
    proposal_hash: input.proposal_hash,
    imported_candidate_ids: imported.map((candidate) => candidate.candidate_id).sort(compareUtf8),
    rejected_candidate_ids: rejected.map((candidate) => candidate.candidate_id).sort(compareUtf8),
    original_archive_paths: originalPaths,
    redacted_archive_paths: redactedPaths,
    destination_paths: [...destinations].sort(compareUtf8),
    import_report_path: reportPath,
    required_view_paths: [...GENERATED_VIEW_PATHS],
  };
  const report = renderImportReport(input, reportMetadata);
  const metadata: ReviewedImportMetadata = {
    ...reportMetadata,
    import_report_hash: sha256(report),
  };
  writes.push({
    relative_path: reportPath,
    bytes: report,
    expected_existing_sha256: null,
    mode: "create",
  });
  const orderedWrites = [
    ...writes.filter((write) => write.relative_path.includes("/archive/imports/")).sort((left, right) => compareUtf8(left.relative_path, right.relative_path)),
    ...writes.filter((write) => !write.relative_path.includes("/archive/imports/") && write.relative_path !== reportPath).sort((left, right) => compareUtf8(left.relative_path, right.relative_path)),
    ...writes.filter((write) => write.relative_path === reportPath),
  ];
  const body: Omit<ReviewedImportPlan, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: `import:${input.proposal_hash.slice(0, 16)}`,
    mutation_kind: "import",
    root_id: input.root_id,
    target_ref: input.target_ref,
    expected_head: input.expected_head,
    profile_lock_hash: input.profile_lock_hash,
    writes: orderedWrites,
    record_ids: recordIds.sort(compareUtf8),
    event_ids: [],
    approval_ids: [...new Set(input.approval_ids)].sort(compareUtf8),
    evidence_ids: [metadata.import_report_hash],
    created_by: input.created_by,
    created_at: input.created_at,
    expires_at: input.expires_at,
    metadata,
  };
  return success({ ...body, plan_hash: canonicalMutationPlanHash(body) });
}
