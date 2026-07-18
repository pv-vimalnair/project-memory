import {
  canonicalJson,
  decodeStrictUtf8,
  emitGeneratedYaml,
  failure,
  parseCanonicalMarkdown,
  parseJsonDocument,
  parseYamlDocument,
  sha256,
  success,
  validateWithSchema,
  type CanonicalMarkdownDocument,
  type ProfileLock,
  type ProjectSelection,
  type RuntimeIssue,
  type RuntimeResult,
  type SchemaId,
  type SelectedCatalogLock,
} from "../../index.js";

import type { CanonicalRecord, GovernanceEvent } from "../contracts/index.js";
import { eventPath } from "../events/append-only-event-store.js";
import { verifyEventChain } from "../events/event-chain-verifier.js";
import { canonicalRecordPath } from "../records/record-path.js";
import { buildSupersessionIndex } from "../records/supersession-index.js";
import type { RevisionBlob } from "./revision-tree-reader.js";
import type {
  SnapshotJsonDocument,
  SnapshotTextDocument,
} from "./snapshot-contracts.js";

const PROJECT_PATH = "docs/project-memory/project.yaml";
const PROFILE_PATH = "docs/project-memory/profile.lock.yaml";
const CATALOG_LOCK_PATH = "docs/project-memory/catalog.lock.json";

export interface ParsedSnapshot {
  readonly project: ProjectSelection;
  readonly profile: ProfileLock;
  readonly catalog: SelectedCatalogLock;
  readonly source_documents: readonly SnapshotTextDocument[];
  readonly markdown: readonly CanonicalMarkdownDocument[];
  readonly records: readonly CanonicalRecord[];
  readonly claims: readonly SnapshotJsonDocument[];
  readonly events: readonly GovernanceEvent[];
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function translatedFailure<T>(
  code: string,
  message: string,
  path: string,
  issues: readonly RuntimeIssue[],
): RuntimeResult<T> {
  return failure(
    code,
    message,
    path,
    issues.map((issue) => `${issue.code}:${issue.path}`),
  );
}

function strictJson<T>(
  blob: RevisionBlob,
  schemaId: SchemaId,
  errorCode: string,
): RuntimeResult<T> {
  const decoded = decodeStrictUtf8(blob.bytes, blob.relative_path);
  if (!decoded.ok) {
    return translatedFailure(
      errorCode,
      "canonical JSON must use strict UTF-8",
      blob.relative_path,
      decoded.issues,
    );
  }
  const parsed = parseJsonDocument(decoded.value, blob.relative_path);
  if (!parsed.ok) {
    return translatedFailure(
      errorCode,
      "canonical JSON could not be parsed",
      blob.relative_path,
      parsed.issues,
    );
  }
  const validated = validateWithSchema<T>(schemaId, parsed.value);
  if (!validated.ok) {
    return translatedFailure(
      errorCode,
      "canonical JSON failed schema validation",
      blob.relative_path,
      validated.issues,
    );
  }
  if (!byteEqual(blob.bytes, new TextEncoder().encode(canonicalJson(validated.value)))) {
    return failure(errorCode, "canonical JSON bytes are not deterministic", blob.relative_path);
  }
  return validated;
}

function strictYaml<T>(
  blob: RevisionBlob,
  schemaId: SchemaId,
  errorCode: string,
): RuntimeResult<T> {
  const decoded = decodeStrictUtf8(blob.bytes, blob.relative_path);
  if (!decoded.ok) {
    return translatedFailure(
      errorCode,
      "canonical YAML must use strict UTF-8",
      blob.relative_path,
      decoded.issues,
    );
  }
  const parsed = parseYamlDocument(decoded.value, blob.relative_path);
  if (!parsed.ok) {
    return translatedFailure(
      errorCode,
      "canonical YAML could not be parsed",
      blob.relative_path,
      parsed.issues,
    );
  }
  const validated = validateWithSchema<T>(schemaId, parsed.value);
  if (!validated.ok) {
    return translatedFailure(
      errorCode,
      "canonical YAML failed schema validation",
      blob.relative_path,
      validated.issues,
    );
  }
  const emitted = emitGeneratedYaml(validated.value);
  if (!emitted.ok) {
    return translatedFailure(
      errorCode,
      "canonical YAML could not be emitted",
      blob.relative_path,
      emitted.issues,
    );
  }
  if (!byteEqual(blob.bytes, new TextEncoder().encode(emitted.value))) {
    return failure(errorCode, "canonical YAML bytes are not deterministic", blob.relative_path);
  }
  return validated;
}

function requiredBlob(
  indexed: ReadonlyMap<string, RevisionBlob>,
  relativePath: string,
): RuntimeResult<RevisionBlob> {
  const blob = indexed.get(relativePath);
  return blob === undefined
    ? failure(
        "snapshot.profile_missing",
        "required canonical profile source is missing",
        relativePath,
      )
    : success(blob);
}

function validateLocks(
  indexed: ReadonlyMap<string, RevisionBlob>,
): RuntimeResult<{
  readonly project: ProjectSelection;
  readonly profile: ProfileLock;
  readonly catalog: SelectedCatalogLock;
}> {
  const projectBlob = requiredBlob(indexed, PROJECT_PATH);
  if (!projectBlob.ok) return projectBlob;
  const profileBlob = requiredBlob(indexed, PROFILE_PATH);
  if (!profileBlob.ok) return profileBlob;
  const catalogBlob = requiredBlob(indexed, CATALOG_LOCK_PATH);
  if (!catalogBlob.ok) return catalogBlob;
  const project = strictYaml<ProjectSelection>(
    projectBlob.value,
    "project-memory/v1/project-selection",
    "snapshot.project_invalid",
  );
  if (!project.ok) return project;
  const profile = strictYaml<ProfileLock>(
    profileBlob.value,
    "project-memory/v1/profile-lock",
    "snapshot.profile_invalid",
  );
  if (!profile.ok) return profile;
  const catalog = strictJson<SelectedCatalogLock>(
    catalogBlob.value,
    "project-memory/v1/selected-catalog-lock",
    "snapshot.catalog_lock_invalid",
  );
  if (!catalog.ok) return catalog;

  const { lock_hash: profileHash, ...profileBody } = profile.value;
  const { lock_hash: catalogHash, ...catalogBody } = catalog.value;
  if (sha256(canonicalJson(profileBody)) !== profileHash) {
    return failure(
      "snapshot.profile_hash_mismatch",
      "profile lock self-hash is invalid",
      PROFILE_PATH,
    );
  }
  if (sha256(canonicalJson(catalogBody)) !== catalogHash) {
    return failure(
      "snapshot.catalog_hash_mismatch",
      "catalog lock self-hash is invalid",
      CATALOG_LOCK_PATH,
    );
  }
  if (
    profile.value.root_id !== project.value.root.id ||
    profile.value.profile.root.id !== project.value.root.id
  ) {
    return failure(
      "snapshot.root_mismatch",
      "project and profile roots do not match",
      PROFILE_PATH,
    );
  }
  if (profile.value.project_hash !== sha256(projectBlob.value.bytes)) {
    return failure(
      "snapshot.project_hash_mismatch",
      "profile lock does not bind project.yaml",
      PROJECT_PATH,
    );
  }
  if (profile.value.selected_catalog_lock_hash !== catalogHash) {
    return failure(
      "snapshot.catalog_reference_mismatch",
      "profile lock does not bind the selected catalog lock",
      CATALOG_LOCK_PATH,
    );
  }
  for (const entry of profile.value.accepted_source_entries) {
    const source = indexed.get(entry.target_path);
    if (source === undefined || sha256(source.bytes) !== entry.sha256) {
      return failure(
        "snapshot.profile_source_hash_mismatch",
        "profile lock accepted-source reference is missing or stale",
        entry.target_path,
        [entry.sha256],
      );
    }
  }
  return success({
    project: project.value,
    profile: profile.value,
    catalog: catalog.value,
  });
}

function parseSourceDocuments(
  indexed: ReadonlyMap<string, RevisionBlob>,
): RuntimeResult<readonly SnapshotTextDocument[]> {
  const documents: SnapshotTextDocument[] = [];
  for (const [relativePath, blob] of indexed) {
    if (!relativePath.startsWith("docs/project-memory/source/")) continue;
    const decoded = decodeStrictUtf8(blob.bytes, relativePath);
    if (!decoded.ok) {
      return translatedFailure(
        "snapshot.source_invalid",
        "source document is not UTF-8",
        relativePath,
        decoded.issues,
      );
    }
    documents.push({ relative_path: relativePath, text: decoded.value });
  }
  return success(documents);
}

function markdownCandidate(relativePath: string): boolean {
  return (
    relativePath === "docs/project-memory/source/PROJECT.md" ||
    relativePath.startsWith("docs/project-memory/components/") ||
    relativePath.startsWith("docs/project-memory/domains/") ||
    relativePath.startsWith("docs/project-memory/initiatives/") ||
    relativePath.startsWith("docs/project-memory/workstreams/")
  );
}

function parseMarkdown(
  indexed: ReadonlyMap<string, RevisionBlob>,
  rootId: string,
): RuntimeResult<readonly CanonicalMarkdownDocument[]> {
  const documents: CanonicalMarkdownDocument[] = [];
  const ids = new Set<string>();
  for (const [relativePath, blob] of indexed) {
    if (!markdownCandidate(relativePath) || !relativePath.endsWith(".md")) continue;
    const parsed = parseCanonicalMarkdown(blob.bytes);
    if (!parsed.ok) {
      return translatedFailure(
        "snapshot.markdown_invalid",
        "canonical Markdown is invalid",
        relativePath,
        parsed.issues,
      );
    }
    if (parsed.value.envelope.root_id !== rootId) {
      return failure(
        "snapshot.root_mismatch",
        "canonical Markdown belongs to another root",
        relativePath,
      );
    }
    if (ids.has(parsed.value.envelope.id)) {
      return failure(
        "snapshot.id_duplicate",
        "canonical artifact ID appears more than once",
        parsed.value.envelope.id,
      );
    }
    if (
      parsed.value.envelope.type !== "project" &&
      !relativePath.split("/").includes(parsed.value.envelope.id)
    ) {
      return failure(
        "snapshot.artifact_path_mismatch",
        "artifact ID does not match its path",
        relativePath,
      );
    }
    ids.add(parsed.value.envelope.id);
    documents.push(parsed.value);
  }
  return success(
    documents.sort((left, right) =>
      compareUtf8(left.envelope.id, right.envelope.id),
    ),
  );
}

function parseRecords(
  indexed: ReadonlyMap<string, RevisionBlob>,
  rootId: string,
): RuntimeResult<readonly CanonicalRecord[]> {
  const records: CanonicalRecord[] = [];
  for (const [relativePath, blob] of indexed) {
    if (
      !relativePath.startsWith("docs/project-memory/records/") ||
      !relativePath.endsWith(".json")
    ) {
      continue;
    }
    const parsed = strictJson<CanonicalRecord>(
      blob,
      "project-memory/v1/canonical-record",
      "snapshot.record_schema_invalid",
    );
    if (!parsed.ok) return parsed;
    if (canonicalRecordPath(parsed.value) !== relativePath) {
      return failure(
        "snapshot.record_path_mismatch",
        "record ID and type do not match its path",
        relativePath,
      );
    }
    if (parsed.value.root_id !== rootId) {
      return failure(
        "snapshot.root_mismatch",
        "canonical record belongs to another root",
        relativePath,
      );
    }
    records.push(parsed.value);
  }
  records.sort((left, right) => compareUtf8(left.id, right.id));
  const index = buildSupersessionIndex(records);
  return index.ok ? success(records) : index;
}

function parseClaims(
  indexed: ReadonlyMap<string, RevisionBlob>,
): RuntimeResult<readonly SnapshotJsonDocument[]> {
  const claims: SnapshotJsonDocument[] = [];
  for (const [relativePath, blob] of indexed) {
    if (
      !relativePath.startsWith("docs/project-memory/governance/claims/") ||
      !relativePath.endsWith(".json")
    ) {
      continue;
    }
    const parsed = strictJson<Readonly<Record<string, unknown>>>(
      blob,
      "project-memory/v1/claim",
      "snapshot.claim_invalid",
    );
    if (!parsed.ok) return parsed;
    claims.push({ relative_path: relativePath, value: parsed.value });
  }
  return success(claims);
}

function parseEvents(
  indexed: ReadonlyMap<string, RevisionBlob>,
): RuntimeResult<readonly GovernanceEvent[]> {
  const groups = new Map<string, GovernanceEvent[]>();
  for (const [relativePath, blob] of indexed) {
    if (
      !relativePath.startsWith("docs/project-memory/governance/events/") ||
      !relativePath.endsWith(".json")
    ) {
      continue;
    }
    const parsed = strictJson<GovernanceEvent>(
      blob,
      "project-memory/v1/governance-event",
      "snapshot.event_invalid",
    );
    if (!parsed.ok) return parsed;
    if (eventPath(parsed.value) !== relativePath) {
      return failure(
        "snapshot.event_path_mismatch",
        "event hash and timestamp do not match its path",
        relativePath,
      );
    }
    const values = groups.get(parsed.value.aggregate_id) ?? [];
    values.push(parsed.value);
    groups.set(parsed.value.aggregate_id, values);
  }
  const events: GovernanceEvent[] = [];
  for (const aggregateId of [...groups.keys()].sort(compareUtf8)) {
    const chain = groups.get(aggregateId) ?? [];
    chain.sort((left, right) => left.sequence - right.sequence);
    const verified = verifyEventChain(chain);
    if (!verified.ok) return verified;
    events.push(...chain);
  }
  return success(events);
}

export function parseSnapshot(
  indexed: ReadonlyMap<string, RevisionBlob>,
): RuntimeResult<ParsedSnapshot> {
  const locks = validateLocks(indexed);
  if (!locks.ok) return locks;
  const sourceDocuments = parseSourceDocuments(indexed);
  if (!sourceDocuments.ok) return sourceDocuments;
  const markdown = parseMarkdown(indexed, locks.value.project.root.id);
  if (!markdown.ok) return markdown;
  const records = parseRecords(indexed, locks.value.project.root.id);
  if (!records.ok) return records;
  const claims = parseClaims(indexed);
  if (!claims.ok) return claims;
  const events = parseEvents(indexed);
  if (!events.ok) return events;
  return success({
    project: locks.value.project,
    profile: locks.value.profile,
    catalog: locks.value.catalog,
    source_documents: sourceDocuments.value,
    markdown: markdown.value,
    records: records.value,
    claims: claims.value,
    events: events.value,
  });
}
