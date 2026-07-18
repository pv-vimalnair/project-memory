import { canonicalMutationPlanHash } from "../contracts/canonical-mutation-plan.js";
import type { PlannedWrite } from "../contracts/planned-write.js";
import { failure, success, type RuntimeResult } from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import type {
  LegacyImportMapping,
  LegacyImportPlan,
  LegacyImportProposal,
  LegacyImportReviewContext,
  LegacyScan,
  ReviewedLegacyImportInput,
} from "./contracts.js";

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function mapping(
  artifact: LegacyScan["artifacts"][number],
  context: LegacyImportReviewContext,
): LegacyImportMapping {
  const roles = artifact.detected_roles;
  if (roles.includes("prd") || roles.includes("requirements")) {
    return {
      source_path: artifact.relative_path,
      source_sha256: artifact.sha256,
      classification: "directional_candidate",
      destination_kind: "canonical_document_patch",
      destination_path: context.governing_document,
      accepted: false,
      rationale: "Requirements may only propose a reviewed patch to the governing source document.",
    };
  }
  if (roles.includes("handoff") || roles.includes("changelog")) {
    return {
      source_path: artifact.relative_path,
      source_sha256: artifact.sha256,
      classification: "historical_status",
      destination_kind: "view_candidate",
      destination_path: null,
      accepted: false,
      rationale: "Historical status may inform regenerated views but is not canonical truth.",
    };
  }
  if (roles.includes("decision-log")) {
    return {
      source_path: artifact.relative_path,
      source_sha256: artifact.sha256,
      classification: "directional_candidate",
      destination_kind: "archive_only",
      destination_path: null,
      accepted: false,
      rationale: "Legacy decisions require independent authority review before canonicalization.",
    };
  }
  return {
    source_path: artifact.relative_path,
    source_sha256: artifact.sha256,
    classification: roles.includes("readme") || roles.includes("agent-instructions")
      ? "observation"
      : "archive_only",
    destination_kind: "archive_only",
    destination_path: null,
    accepted: false,
    rationale: "Unaccepted legacy material remains archive-only evidence.",
  };
}

export function proposeLegacyImport(
  scan: LegacyScan,
  context: LegacyImportReviewContext,
): RuntimeResult<LegacyImportProposal> {
  const mappings = scan.artifacts
    .map((artifact) => mapping(artifact, context))
    .sort((left, right) => compareUtf8(left.source_path, right.source_path));
  const destinations = new Set<string>();
  for (const candidate of mappings) {
    if (candidate.destination_path === null) continue;
    if (destinations.has(candidate.destination_path)) {
      return failure(
        "LEGACY_DESTINATION_DUPLICATE",
        "two legacy sources propose the same canonical destination",
        candidate.destination_path,
      );
    }
    destinations.add(candidate.destination_path);
  }
  const body = {
    schema_version: "1.0.0" as const,
    root_id: context.root_id,
    status: "review_required" as const,
    scan_hash: scan.scan_hash,
    mappings,
  };
  return success({ ...body, proposal_hash: sha256(canonicalJson(body)) });
}

export function planLegacyImport(
  input: ReviewedLegacyImportInput,
): RuntimeResult<LegacyImportPlan> {
  if (input.approval_ids.length === 0) {
    return failure("LEGACY_APPROVAL_REQUIRED", "reviewed import requires exact Pitaji approval");
  }
  const sourcePaths = new Set<string>();
  const destinationPaths = new Set<string>();
  const writes: PlannedWrite[] = [];
  for (const decision of input.decisions) {
    if (sourcePaths.has(decision.source_path)) {
      return failure("LEGACY_SOURCE_DUPLICATE", "legacy source has more than one reviewed decision", decision.source_path);
    }
    sourcePaths.add(decision.source_path);
    if (sha256(decision.source_bytes) !== decision.source_sha256) {
      return failure("LEGACY_SOURCE_HASH_MISMATCH", "reviewed legacy bytes do not match their hash", decision.source_path);
    }
    if (decision.destination_kind === "canonical_record") {
      return failure("LEGACY_GENERIC_RECORD_FORBIDDEN", "legacy facts cannot map to generic canonical records", decision.source_path);
    }
    if (decision.destination_path !== null) {
      if (destinationPaths.has(decision.destination_path)) {
        return failure("LEGACY_DESTINATION_DUPLICATE", "reviewed decisions repeat a canonical destination", decision.destination_path);
      }
      destinationPaths.add(decision.destination_path);
    }
    if (decision.decision === "exclude") continue;
    writes.push({
      relative_path: `docs/project-memory/archive/imports/${decision.source_sha256}.bin`,
      bytes: new Uint8Array(decision.source_bytes),
      expected_existing_sha256: null,
      mode: "create",
    });
    if (decision.decision === "accept" && decision.destination_kind === "canonical_document_patch") {
      writes.push({
        relative_path: `docs/project-memory/import/proposals/${decision.source_sha256}.md`,
        bytes: new Uint8Array(decision.source_bytes),
        expected_existing_sha256: null,
        mode: "create",
      });
    }
  }
  writes.sort((left, right) => compareUtf8(left.relative_path, right.relative_path));
  const metadata = {
    governance_kind: "import" as const,
    proposal_hash: input.proposal_hash,
    imported_source_hashes: input.decisions
      .filter((decision) => decision.decision !== "exclude")
      .map((decision) => decision.source_sha256)
      .sort(compareUtf8),
    excluded_source_paths: input.decisions
      .filter((decision) => decision.decision === "exclude")
      .map((decision) => decision.source_path)
      .sort(compareUtf8),
    destination_paths: [...destinationPaths].sort(compareUtf8),
  };
  const body: Omit<LegacyImportPlan, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: `import:${input.proposal_hash.slice(0, 16)}`,
    mutation_kind: "import",
    root_id: input.root_id,
    target_ref: input.target_ref,
    expected_head: input.expected_head,
    profile_lock_hash: input.profile_lock_hash,
    writes,
    record_ids: [], event_ids: [],
    approval_ids: [...new Set(input.approval_ids)].sort(compareUtf8),
    evidence_ids: [],
    created_by: input.created_by,
    created_at: input.created_at,
    expires_at: input.expires_at,
    metadata,
  };
  return success({ ...body, plan_hash: canonicalMutationPlanHash(body) });
}
