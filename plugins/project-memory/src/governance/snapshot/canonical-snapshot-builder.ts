import {
  failure,
  resolveInside,
  sha256,
  success,
  type CanonicalMarkdownDocument,
  type RuntimeResult,
} from "../../index.js";

import type { CanonicalRecord } from "../contracts/index.js";
import { buildSupersessionIndex } from "../records/supersession-index.js";
import { parseSnapshot, type ParsedSnapshot } from "./snapshot-parsers.js";
import {
  isCanonicalSnapshotPath,
  isForbiddenTruthSource,
  type RevisionBlob,
  type RevisionSource,
  type RevisionTreeReader,
} from "./revision-tree-reader.js";
import type {
  CanonicalSnapshot,
  CanonicalSnapshotBuilder,
  SnapshotJsonDocument,
} from "./snapshot-contracts.js";
export type { CanonicalSnapshot, CanonicalSnapshotBuilder, SnapshotJsonDocument, SnapshotTextDocument } from "./snapshot-contracts.js";

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

async function indexBlobs(
  root: URL,
  blobs: readonly RevisionBlob[],
): Promise<RuntimeResult<ReadonlyMap<string, RevisionBlob>>> {
  const indexed = new Map<string, RevisionBlob>();
  for (const blob of blobs) {
    if (isForbiddenTruthSource(blob.relative_path)) {
      return failure(
        "snapshot.forbidden_truth_source",
        "generated views and archives cannot become current truth",
        blob.relative_path,
      );
    }
    if (!isCanonicalSnapshotPath(blob.relative_path)) {
      return failure(
        "snapshot.source_path_forbidden",
        "reader returned a path outside the canonical snapshot boundary",
        blob.relative_path,
      );
    }
    if (!/^[0-9a-f]{40}$/.test(blob.object_id)) {
      return failure("snapshot.blob_id_invalid", "blob object ID is malformed", blob.relative_path);
    }
    if (indexed.has(blob.relative_path)) {
      return failure(
        "snapshot.path_duplicate",
        "canonical snapshot path appears more than once",
        blob.relative_path,
      );
    }
    const confined = await resolveInside(root, blob.relative_path);
    if (!confined.ok) return confined;
    indexed.set(blob.relative_path, blob);
  }
  return success(
    new Map([...indexed.entries()].sort(([left], [right]) => compareUtf8(left, right))),
  );
}

function claimId(claim: SnapshotJsonDocument): string | null {
  const id = claim.value.id ?? claim.value.claim_id;
  return typeof id === "string" ? id : null;
}

function validateReferences(parsed: ParsedSnapshot): RuntimeResult<true> {
  const approvals = new Set(
    parsed.records.filter((record) => record.type === "approval").map((record) => record.id),
  );
  const approvalRefs = [
    parsed.project.acceptance.approval_id,
    ...parsed.profile.accepted_source_entries.flatMap((entry) => entry.approval_refs),
    ...parsed.markdown.flatMap((document) => document.envelope.approval_refs),
  ];
  const missingApproval = approvalRefs.find((id) => !approvals.has(id));
  if (missingApproval !== undefined) {
    return failure("snapshot.approval_missing", "accepted truth lacks canonical approval", missingApproval);
  }

  const known = new Set<string>([
    parsed.project.root.id,
    ...parsed.markdown.map((document) => document.envelope.id),
    ...parsed.records.map((record) => record.id),
    ...parsed.events.map((event) => event.aggregate_id),
    ...parsed.claims.flatMap((claim) => (claimId(claim) === null ? [] : [claimId(claim) as string])),
  ]);
  for (const record of parsed.records) {
    const structuralIds = [
      ...record.component_ids,
      record.initiative_id,
      record.workstream_id,
      record.task_id,
    ].filter((value): value is string => value !== null);
    const missingStructural = structuralIds.find((id) => !known.has(id));
    if (missingStructural !== undefined) {
      return failure("snapshot.relationship_missing", "record structural reference is missing", record.id, [missingStructural]);
    }
    const missingRelationship = record.relationships.find(
      (relationship) => !known.has(relationship.target_id),
    );
    if (missingRelationship !== undefined) {
      return failure(
        "snapshot.relationship_missing",
        "record relationship target is absent from current truth",
        record.id,
        [missingRelationship.target_id],
      );
    }
  }
  const evidenceIds = new Set(
    parsed.records.filter((record) => record.type === "evidence").map((record) => record.id),
  );
  for (const event of parsed.events) {
    const missingEvidence = event.evidence_ids.find((id) => !evidenceIds.has(id));
    if (missingEvidence !== undefined) {
      return failure("snapshot.evidence_missing", "event evidence is absent", event.event_hash, [missingEvidence]);
    }
  }
  return success(true);
}

export async function buildCanonicalSnapshot(
  root: URL,
  source: RevisionSource,
  reader: RevisionTreeReader,
): Promise<RuntimeResult<CanonicalSnapshot>> {
  const blobs = await reader.readCanonicalBlobs(root, source);
  if (!blobs.ok) return blobs;
  const indexed = await indexBlobs(root, blobs.value);
  if (!indexed.ok) return indexed;
  const parsed = parseSnapshot(indexed.value);
  if (!parsed.ok) return parsed;
  const references = validateReferences(parsed.value);
  if (!references.ok) return references;
  const supersession = buildSupersessionIndex(parsed.value.records);
  if (!supersession.ok) return supersession;
  const sourcePaths = [...indexed.value.keys()];
  const sourceHashes = Object.fromEntries(
    sourcePaths.map((relativePath) => [relativePath, sha256(indexed.value.get(relativePath)?.bytes ?? new Uint8Array())]),
  );
  const objectIds = Object.fromEntries(
    sourcePaths.map((relativePath) => [relativePath, indexed.value.get(relativePath)?.object_id ?? ""]),
  );
  const byType = (type: CanonicalRecord["type"]) =>
    parsed.value.records.filter((record) => record.type === type);
  const markdownByType = (type: CanonicalMarkdownDocument["envelope"]["type"]) =>
    parsed.value.markdown.filter((document) => document.envelope.type === type);
  return success({
    source_revision: source.object_id,
    source_kind: source.kind,
    root_id: parsed.value.project.root.id,
    profile_revision: parsed.value.profile.profile_revision,
    profile_lock_hash: parsed.value.profile.lock_hash,
    selected_catalog_lock_hash: parsed.value.catalog.lock_hash,
    catalog_versions: [parsed.value.profile.profile.catalog.release],
    source_paths: sourcePaths,
    source_hashes: sourceHashes,
    blob_object_ids: objectIds,
    project: parsed.value.project,
    profile_lock: parsed.value.profile,
    source_documents: parsed.value.source_documents,
    components: markdownByType("component"),
    domains: markdownByType("domain"),
    initiatives: markdownByType("initiative"),
    workstreams: markdownByType("workstream"),
    tasks: markdownByType("task"),
    records: parsed.value.records,
    effective_records: parsed.value.records.filter(
      (record) => !supersession.value.superseded_ids.has(record.id),
    ),
    evidence: byType("evidence"),
    risks: byType("risk"),
    approvals: byType("approval"),
    claims: parsed.value.claims,
    events: parsed.value.events,
  });
}

export function createCanonicalSnapshotBuilder(
  reader: RevisionTreeReader,
): CanonicalSnapshotBuilder {
  return { build: (root, source) => buildCanonicalSnapshot(root, source, reader) };
}
