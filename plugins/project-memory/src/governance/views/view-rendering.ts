import {
  canonicalJson,
  sha256,
  type CanonicalMarkdownDocument,
} from "../../index.js";

import type { CanonicalRecord, GovernanceEvent } from "../contracts/index.js";
import type { CanonicalSnapshot } from "../snapshot/snapshot-contracts.js";

export interface ViewRenderMetadata {
  readonly source_revision: string;
  readonly profile_version: string;
  readonly profile_lock_hash: string;
  readonly catalog_version: string;
  readonly catalog_lock_hash: string;
  readonly source_set_hash: string;
  readonly generated_at: string;
}

export interface ViewRenderContext {
  readonly snapshot: CanonicalSnapshot;
  readonly metadata: ViewRenderMetadata;
}

type Payload = Readonly<Record<string, unknown>>;

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function sourceSetHash(snapshot: CanonicalSnapshot): string {
  const sources = [...snapshot.source_paths]
    .sort(compareUtf8)
    .map((relativePath) => ({
      relative_path: relativePath,
      sha256: snapshot.source_hashes[relativePath] ?? null,
      object_id: snapshot.blob_object_ids[relativePath] ?? null,
    }));
  return sha256(
    canonicalJson({ source_revision: snapshot.source_revision, sources }),
  );
}

export function markdownHeader(metadata: ViewRenderMetadata): string[] {
  return [
    "<!-- GENERATED: DO NOT EDIT -->",
    `<!-- source_revision: ${metadata.source_revision} -->`,
    `<!-- profile_version: ${metadata.profile_version} -->`,
    `<!-- profile_lock_hash: ${metadata.profile_lock_hash} -->`,
    `<!-- catalog_version: ${metadata.catalog_version} -->`,
    `<!-- catalog_lock_hash: ${metadata.catalog_lock_hash} -->`,
    `<!-- source_set_hash: ${metadata.source_set_hash} -->`,
    `<!-- generated_at: ${metadata.generated_at} -->`,
    "",
  ];
}

export function markdownView(
  metadata: ViewRenderMetadata,
  lines: readonly string[],
): string {
  let contentLength = lines.length;
  while (contentLength > 0 && lines[contentLength - 1] === "") {
    contentLength -= 1;
  }
  return `${[
    ...markdownHeader(metadata),
    ...lines.slice(0, contentLength),
  ].join("\n")}\n`;
}

export function recordPayload(record: CanonicalRecord): Payload {
  return record.payload as Payload;
}

export function payloadText(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function payloadStrings(payload: Payload, key: string): readonly string[] {
  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function sortedRecords(
  records: readonly CanonicalRecord[],
): CanonicalRecord[] {
  return [...records].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) || compareUtf8(left.id, right.id),
  );
}

export function sortedEvents(
  events: readonly GovernanceEvent[],
): GovernanceEvent[] {
  return [...events].sort(
    (left, right) =>
      left.occurred_at.localeCompare(right.occurred_at) ||
      compareUtf8(left.event_hash, right.event_hash),
  );
}

export function sortedDocuments(
  documents: readonly CanonicalMarkdownDocument[],
): CanonicalMarkdownDocument[] {
  return [...documents].sort((left, right) =>
    compareUtf8(left.envelope.id, right.envelope.id),
  );
}

export function documentTitle(document: CanonicalMarkdownDocument): string {
  const heading = /^#\s+(.+)$/m.exec(document.body)?.[1];
  return heading?.trim() || document.envelope.id;
}

export function documentStatus(document: CanonicalMarkdownDocument): string {
  const status = /^Status:\s*(.+)$/im.exec(document.body)?.[1];
  return status?.trim().toLowerCase() || "active";
}

export function documentLine(document: CanonicalMarkdownDocument): string {
  return `- \`${document.envelope.id}\` — ${documentTitle(document)} (${documentStatus(document)})`;
}

export function recordLine(record: CanonicalRecord): string {
  return `- \`${record.id}\` — ${record.title} (${record.status})`;
}

export function linesOrNone(lines: readonly string[]): string[] {
  return lines.length === 0 ? ["- _None._"] : [...lines];
}

export function activeWorkstreams(snapshot: CanonicalSnapshot) {
  const inactive = new Set(["completed", "closed", "cancelled", "superseded"]);
  return sortedDocuments(snapshot.workstreams).filter(
    (document) => !inactive.has(documentStatus(document)),
  );
}

export function blockerRecords(snapshot: CanonicalSnapshot): CanonicalRecord[] {
  return sortedRecords(snapshot.effective_records).filter((record) => {
    if (!new Set(["accepted", "proposed"]).has(record.status)) return false;
    const payload = recordPayload(record);
    if (record.type === "finding") {
      return new Set(["critical", "high"]).has(payloadText(payload, "severity") ?? "");
    }
    if (record.type === "risk") {
      return new Set(["critical", "high"]).has(payloadText(payload, "impact") ?? "");
    }
    return false;
  });
}

export function nextActionLines(snapshot: CanonicalSnapshot): string[] {
  const ideas = sortedRecords(snapshot.effective_records)
    .filter((record) => record.type === "idea" && record.status === "proposed")
    .map(recordLine);
  const tasks = sortedDocuments(snapshot.tasks)
    .filter((document) => documentStatus(document) === "active")
    .map(documentLine);
  return [...tasks, ...ideas];
}

export function validatedChanges(snapshot: CanonicalSnapshot): CanonicalRecord[] {
  const evidenceIds = new Set(snapshot.evidence.map((record) => record.id));
  return sortedRecords(snapshot.records).filter((record) => {
    if (record.type !== "change" || !new Set(["accepted", "closed"]).has(record.status)) {
      return false;
    }
    const commits = payloadStrings(recordPayload(record), "commits");
    const evidenced = record.relationships.some(
      (relationship) =>
        relationship.type === "evidences" && evidenceIds.has(relationship.target_id),
    );
    return commits.length > 0 && evidenced;
  });
}

export function historicalRecords(snapshot: CanonicalSnapshot): CanonicalRecord[] {
  const terminal = new Set([
    "closed",
    "superseded",
    "corrected",
    "rejected",
    "withdrawn",
  ]);
  return sortedRecords(snapshot.records).filter((record) => terminal.has(record.status));
}
