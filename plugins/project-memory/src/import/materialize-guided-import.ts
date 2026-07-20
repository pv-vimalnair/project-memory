import path from "node:path";

import { canonicalMutationPlanHash } from "../contracts/canonical-mutation-plan.js";
import type { PlannedWrite } from "../contracts/planned-write.js";
import { failure, success, type RuntimeResult } from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import { decodeStrictUtf8 } from "../core/document-io.js";
import { sha256 } from "../core/hash.js";
import type { IdFactory } from "../core/id-factory.js";
import {
  CanonicalRecordSchema,
  type CanonicalRecord,
} from "../governance/contracts/canonical-record.js";
import { GENERATED_VIEW_PATHS } from "../governance/views/generate-views.js";
import { validateWithSchema } from "../schema/validate.js";
import { findSensitivity } from "./classifiers.js";
import type {
  GuidedLegacyImportInput,
  LegacyFactCategory,
  LegacyFactDraft,
  ReviewedImportMetadata,
  ReviewedImportPlan,
} from "./contracts.js";
import {
  renderGuidedImportReport,
  type GuidedImportReportCandidate,
  type GuidedImportReportFact,
} from "./render-import-report.js";

export interface GuidedLegacyImportDependencies {
  readonly ids: IdFactory;
  readonly read_source: (sourcePath: string) => Promise<RuntimeResult<Uint8Array>>;
}

const FACT_CATEGORIES = new Set<LegacyFactCategory>([
  "completed_work",
  "current_decision",
  "constraint",
  "next_action",
  "idea",
  "risk",
  "finding",
  "removed",
  "rejected",
  "superseded",
  "lesson",
]);
const DISPOSITIONS = new Set(["import", "archive", "reject", "unresolved"]);
const REVISION = /^[0-9a-f]{40}$/u;

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function safeSourcePath(value: string): boolean {
  return value.length > 0 &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !path.posix.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !/^[A-Za-z]:/u.test(value) &&
    value !== ".." &&
    !value.startsWith("../") &&
    path.posix.normalize(value) === value;
}

function recordDirectory(type: CanonicalRecord["type"]): string {
  switch (type) {
    case "decision": return "decisions";
    case "idea": return "ideas";
    case "change": return "changes";
    case "finding": return "findings";
    case "risk": return "risks";
    case "evidence": return "evidence";
    case "lesson": return "lessons";
    case "approval": return "approvals";
  }
  throw new RangeError(`Unknown canonical record type: ${type}`);
}

function recordWrite(record: CanonicalRecord): PlannedWrite {
  return {
    relative_path: `docs/project-memory/records/${recordDirectory(record.type)}/${record.id}.json`,
    bytes: new TextEncoder().encode(canonicalJson(record)),
    expected_existing_sha256: null,
    mode: "create",
  };
}

function factPrefix(category: LegacyFactCategory):
  "CHG" | "DEC" | "IDEA" | "RISK" | "FIND" | "LESSON" {
  if (category === "completed_work") return "CHG";
  if (category === "current_decision" || category === "constraint") return "DEC";
  if (category === "risk") return "RISK";
  if (category === "finding") return "FIND";
  if (category === "lesson") return "LESSON";
  return "IDEA";
}

function commonRecord(
  input: GuidedLegacyImportInput,
  id: string,
  title: string,
  status: CanonicalRecord["status"],
  relationships: CanonicalRecord["relationships"],
) {
  return {
    id,
    title,
    status,
    root_id: input.root_id,
    component_ids: [],
    initiative_id: null,
    workstream_id: null,
    task_id: null,
    actor_id: input.created_by,
    authority_class: "worker" as const,
    created_at: input.created_at,
    original_base_revision: input.expected_head,
    integration_base_revision: input.expected_head,
    catalog_versions: [input.catalog_version],
    relationships,
  };
}

function factRecord(
  input: GuidedLegacyImportInput,
  fact: LegacyFactDraft,
  sourcePath: string,
  sourceRevision: string | null,
  recordId: string,
  evidenceId: string,
): CanonicalRecord {
  const common = commonRecord(input, recordId, fact.title, (
    fact.category === "completed_work" ? "closed" :
    fact.category === "current_decision" || fact.category === "constraint" ||
      fact.category === "finding" || fact.category === "lesson" ? "accepted" :
    fact.category === "removed" ? "withdrawn" :
    fact.category === "rejected" ? "rejected" :
    fact.category === "superseded" ? "superseded" :
    "proposed"
  ), [{
    type: "evidences" as const,
    target_id: evidenceId,
    note: `Imported from ${sourcePath}.`,
  }]);

  if (fact.category === "completed_work") {
    return {
      ...common,
      type: "change",
      payload: {
        summary: fact.statement,
        files: [sourcePath],
        commits: sourceRevision === null ? [] : [sourceRevision],
        artifacts: [],
        authorization_refs: [],
      },
    };
  }
  if (fact.category === "current_decision" || fact.category === "constraint") {
    return {
      ...common,
      type: "decision",
      payload: {
        choice: fact.statement,
        rationale: fact.rationale,
        alternatives: [],
        consequences: [fact.rationale],
      },
    };
  }
  if (
    fact.category === "next_action" ||
    fact.category === "idea" ||
    fact.category === "removed" ||
    fact.category === "rejected" ||
    fact.category === "superseded"
  ) {
    return {
      ...common,
      type: "idea",
      payload: {
        proposal: fact.statement,
        disposition_reason: fact.rationale,
      },
    };
  }
  if (fact.category === "risk") {
    return {
      ...common,
      type: "risk",
      payload: {
        likelihood: "medium",
        impact: "medium",
        mitigation: `${fact.statement} Mitigation: ${fact.rationale}`,
      },
    };
  }
  if (fact.category === "finding") {
    return {
      ...common,
      type: "finding",
      payload: {
        severity: "info",
        description: fact.statement,
        evidence_ids: [evidenceId],
        remediation_proposal_ids: [],
      },
    };
  }
  return {
    ...common,
    type: "lesson",
    payload: {
      observation: fact.statement,
      evidence_ids: [evidenceId],
      rule: fact.rationale,
    },
  };
}

function evidenceRecord(
  input: GuidedLegacyImportInput,
  fact: LegacyFactDraft,
  sourcePath: string,
  sourceHash: string,
  sourceRevision: string | null,
  excerpt: string,
  evidenceId: string,
): CanonicalRecord {
  const sourceRefs = [
    `${sourcePath}#L${String(fact.source_line_start)}-L${String(fact.source_line_end)}`,
  ];
  if (sourceRevision !== null) sourceRefs.push(`git:${sourceRevision}`);
  return {
    ...commonRecord(input, evidenceId, `Source evidence for ${fact.title}`, "accepted", []),
    type: "evidence",
    payload: {
      evidence_type: "legacy_source_excerpt",
      exact_result: excerpt,
      source_refs: sourceRefs,
      hashes: { source_sha256: sourceHash },
      not_run_reason: null,
    },
  };
}

function validText(value: string): boolean {
  return value.trim().length > 0;
}

function validateFact(
  fact: LegacyFactDraft,
  lines: readonly string[],
  duplicateKeys: Set<string>,
  sourcePath: string,
  allowLowConfidence: boolean,
): RuntimeResult<string> {
  if (
    !FACT_CATEGORIES.has(fact.category) ||
    !validText(fact.title) ||
    !validText(fact.statement) ||
    !validText(fact.rationale) ||
    !new Set(["high", "medium", "low"]).has(fact.confidence)
  ) {
    return failure("GUIDED_IMPORT_FACT_INVALID", "legacy fact fields are invalid", sourcePath);
  }
  if (fact.confidence === "low" && !allowLowConfidence) {
    return failure(
      "GUIDED_IMPORT_LOW_CONFIDENCE",
      "low-confidence facts cannot become canonical records",
      sourcePath,
    );
  }
  if (
    !Number.isInteger(fact.source_line_start) ||
    !Number.isInteger(fact.source_line_end) ||
    fact.source_line_start < 1 ||
    fact.source_line_end < fact.source_line_start ||
    fact.source_line_end > lines.length
  ) {
    return failure(
      "GUIDED_IMPORT_ANCHOR_INVALID",
      "legacy fact line anchor is outside the reviewed source",
      sourcePath,
    );
  }
  const excerpt = lines.slice(
    fact.source_line_start - 1,
    fact.source_line_end,
  ).join("\n");
  if (!validText(excerpt)) {
    return failure(
      "GUIDED_IMPORT_ANCHOR_INVALID",
      "legacy fact line anchor must select non-empty source text",
      sourcePath,
    );
  }
  const duplicateKey = canonicalJson({
    source_line_start: fact.source_line_start,
    source_line_end: fact.source_line_end,
    category: fact.category,
    title: fact.title,
    statement: fact.statement,
  });
  if (duplicateKeys.has(duplicateKey)) {
    return failure(
      "GUIDED_IMPORT_FACT_DUPLICATE",
      "legacy source repeats the same fact draft",
      sourcePath,
    );
  }
  duplicateKeys.add(duplicateKey);
  return success(excerpt);
}

function validateRecord(record: CanonicalRecord): RuntimeResult<CanonicalRecord> {
  const validated = validateWithSchema<CanonicalRecord>(CanonicalRecordSchema.$id, record);
  return validated.ok
    ? validated
    : failure(
        "GUIDED_IMPORT_RECORD_INVALID",
        "guided import produced an invalid canonical record",
        record.id,
        validated.issues.map((issue) => `${issue.code}:${issue.path}`),
      );
}

function candidateId(sourcePath: string, sourceHash: string): string {
  return `candidate.${sha256(canonicalJson({
    source_path: sourcePath,
    source_sha256: sourceHash,
  })).slice(0, 24)}`;
}

export async function planGuidedLegacyImport(
  input: GuidedLegacyImportInput,
  dependencies: GuidedLegacyImportDependencies,
): Promise<RuntimeResult<ReviewedImportPlan>> {
  if (input.sources.length === 0) {
    return failure("GUIDED_IMPORT_SOURCE_REQUIRED", "guided import requires reviewed sources");
  }

  const seenSources = new Set<string>();
  const writes: PlannedWrite[] = [];
  const archivePaths = new Set<string>();
  const destinationPaths: string[] = [];
  const recordIds: string[] = [];
  const evidenceIds: string[] = [];
  const importedCandidateIds: string[] = [];
  const rejectedCandidateIds: string[] = [];
  const resolvedSourcePaths: string[] = [];
  const unresolvedSourcePaths: string[] = [];
  const reportCandidates: GuidedImportReportCandidate[] = [];

  for (const source of input.sources.toSorted((left, right) =>
    compareUtf8(left.source_path, right.source_path)
  )) {
    if (!safeSourcePath(source.source_path) || seenSources.has(source.source_path)) {
      return failure(
        "GUIDED_IMPORT_SOURCE_DUPLICATE",
        "every reviewed source path must be safe and appear exactly once",
        source.source_path,
      );
    }
    seenSources.add(source.source_path);
    if (
      !/^[0-9a-f]{64}$/u.test(source.source_sha256) ||
      !DISPOSITIONS.has(source.disposition)
    ) {
      return failure("GUIDED_IMPORT_SOURCE_INVALID", "reviewed source fields are invalid", source.source_path);
    }
    if (!validText(source.rationale)) {
      return failure(
        "GUIDED_IMPORT_RATIONALE_REQUIRED",
        "every source review requires a rationale",
        source.source_path,
      );
    }
    const sourceRevision = source.source_git_revision ?? null;
    if (sourceRevision !== null && !REVISION.test(sourceRevision)) {
      return failure(
        "GUIDED_IMPORT_SOURCE_REVISION_INVALID",
        "source Git revision must be a real 40-character revision or null",
        source.source_path,
      );
    }

    const read = await dependencies.read_source(source.source_path);
    if (!read.ok) return read;
    if (sha256(read.value) !== source.source_sha256) {
      return failure(
        "GUIDED_IMPORT_SOURCE_HASH_MISMATCH",
        "legacy source changed after review",
        source.source_path,
      );
    }
    const decoded = decodeStrictUtf8(read.value, source.source_path);
    if (!decoded.ok) {
      return failure(
        "GUIDED_IMPORT_SOURCE_ENCODING_INVALID",
        "reviewed legacy source must be strict UTF-8",
        source.source_path,
      );
    }
    const sensitivity = findSensitivity(decoded.value);
    if (
      sensitivity.length > 0 &&
      (source.disposition === "import" ||
        source.disposition === "archive" ||
        source.facts.length > 0)
    ) {
      return failure(
        "GUIDED_IMPORT_SENSITIVE_SOURCE_EXCLUSION_REQUIRED",
        "sensitive sources require rejection or unresolved exclusion without copied facts",
        source.source_path,
      );
    }
    if (source.disposition === "import" && source.facts.length === 0) {
      return failure(
        "GUIDED_IMPORT_FACT_REQUIRED",
        "an imported source requires at least one reviewed fact",
        source.source_path,
      );
    }

    const reportFacts: GuidedImportReportFact[] = [];
    const lines = decoded.value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
    const duplicateKeys = new Set<string>();
    for (const fact of source.facts) {
      const excerpt = validateFact(
        fact,
        lines,
        duplicateKeys,
        source.source_path,
        source.disposition !== "import",
      );
      if (!excerpt.ok) return excerpt;
      if (source.disposition !== "import") {
        reportFacts.push({
          source_line_start: fact.source_line_start,
          source_line_end: fact.source_line_end,
          category: fact.category,
          title: fact.title,
          statement: fact.statement,
          rationale: fact.rationale,
          confidence: fact.confidence,
          evidence_record_id: null,
          imported_record_id: null,
        });
        continue;
      }
      const evidenceId = dependencies.ids.next("EVD");
      const recordId = dependencies.ids.next(factPrefix(fact.category));
      const evidence = validateRecord(evidenceRecord(
        input,
        fact,
        source.source_path,
        source.source_sha256,
        sourceRevision,
        excerpt.value,
        evidenceId,
      ));
      if (!evidence.ok) return evidence;
      const record = validateRecord(factRecord(
        input,
        fact,
        source.source_path,
        sourceRevision,
        recordId,
        evidenceId,
      ));
      if (!record.ok) return record;
      const evidenceWrite = recordWrite(evidence.value);
      const factWrite = recordWrite(record.value);
      writes.push(evidenceWrite, factWrite);
      destinationPaths.push(evidenceWrite.relative_path, factWrite.relative_path);
      recordIds.push(evidenceId, recordId);
      evidenceIds.push(evidenceId);
      reportFacts.push({
        source_line_start: fact.source_line_start,
        source_line_end: fact.source_line_end,
        category: fact.category,
        title: fact.title,
        statement: fact.statement,
        rationale: fact.rationale,
        confidence: fact.confidence,
        evidence_record_id: evidenceId,
        imported_record_id: recordId,
      });
    }
    if (source.disposition === "import") {
      importedCandidateIds.push(candidateId(source.source_path, source.source_sha256));
    } else if (source.disposition === "reject") {
      rejectedCandidateIds.push(candidateId(source.source_path, source.source_sha256));
    }

    let archivePath: string | null = null;
    if (source.disposition === "import" || source.disposition === "archive") {
      archivePath =
        `docs/project-memory/archive/imports/original/${source.source_sha256}.bin`;
      if (!archivePaths.has(archivePath)) {
        archivePaths.add(archivePath);
        writes.push({
          relative_path: archivePath,
          bytes: new Uint8Array(read.value),
          expected_existing_sha256: null,
          mode: "create",
        });
      }
    }
    if (source.disposition === "unresolved") {
      unresolvedSourcePaths.push(source.source_path);
    } else {
      resolvedSourcePaths.push(source.source_path);
    }
    reportCandidates.push({
      candidate_id: candidateId(source.source_path, source.source_sha256),
      source_path: source.source_path,
      source_sha256: source.source_sha256,
      source_git_revision: sourceRevision,
      disposition: source.disposition,
      rationale: sensitivity.length > 0
        ? "Sensitive source excluded from import."
        : source.rationale,
      sensitivity_finding_count: sensitivity.length,
      archive_path: archivePath,
      unresolved_reason: source.disposition === "unresolved" ? source.rationale : null,
      facts: sensitivity.length > 0 ? [] : reportFacts,
    });
  }

  const reportPath =
    `docs/project-memory/governance/imports/${input.proposal_hash}.json`;
  const reportMetadata: Omit<ReviewedImportMetadata, "import_report_hash"> = {
    governance_kind: "import",
    proposal_hash: input.proposal_hash,
    imported_candidate_ids: importedCandidateIds.sort(compareUtf8),
    rejected_candidate_ids: rejectedCandidateIds.sort(compareUtf8),
    original_archive_paths: [...archivePaths].sort(compareUtf8),
    redacted_archive_paths: [],
    destination_paths: destinationPaths.sort(compareUtf8),
    import_report_path: reportPath,
    required_view_paths: [...GENERATED_VIEW_PATHS],
    resolved_source_paths: resolvedSourcePaths.sort(compareUtf8),
    unresolved_source_paths: unresolvedSourcePaths.sort(compareUtf8),
    imported_fact_record_ids: recordIds
      .filter((id) => !id.startsWith("EVD-"))
      .sort(compareUtf8),
    guided_input_hash: sha256(canonicalJson(input)),
  };
  const report = renderGuidedImportReport(input, reportCandidates, reportMetadata);
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

  const orderedWrites = writes.toSorted((left, right) => {
    const rank = (value: string) =>
      value.includes("/archive/imports/") ? 0 :
      value.includes("/records/") ? 1 :
      value === reportPath ? 2 : 1;
    return rank(left.relative_path) - rank(right.relative_path) ||
      compareUtf8(left.relative_path, right.relative_path);
  });
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
    approval_ids: [],
    evidence_ids: evidenceIds.sort(compareUtf8),
    created_by: input.created_by,
    created_at: input.created_at,
    expires_at: input.expires_at,
    metadata,
  };
  return success({ ...body, plan_hash: canonicalMutationPlanHash(body) });
}