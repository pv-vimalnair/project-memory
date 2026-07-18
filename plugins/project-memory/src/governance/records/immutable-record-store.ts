import { lstat, readFile, readdir } from "node:fs/promises";

import {
  canonicalJson,
  canonicalMutationPlanHash,
  decodeStrictUtf8,
  failure,
  parseJsonDocument,
  resolveInside,
  success,
  validateWithSchema,
  type Clock,
  type RuntimeIssue,
  type RuntimeResult,
} from "../../index.js";

import {
  RECORD_TYPES,
  type ApprovalRecordPayload,
  type CanonicalRecord,
  type RecordMutationPlan,
} from "../contracts/index.js";
import {
  canonicalRecordPath,
  RECORD_DIRECTORIES,
  recordWrite,
  type CanonicalRecordType,
} from "./record-path.js";
import { buildSupersessionIndex } from "./supersession-index.js";

const RECORD_SCHEMA_ID = "project-memory/v1/canonical-record" as const;
const PLAN_TTL_MS = 5 * 60 * 1000;

export interface RecordPlanningContext {
  readonly target_ref: string;
  readonly expected_head: string;
  readonly profile_lock_hash: string;
  readonly created_by: string;
}

export interface RecordPlanningContextProvider {
  context(root: URL): Promise<RuntimeResult<RecordPlanningContext>>;
}

export interface RecordQuery {
  readonly root_id?: string;
  readonly types?: readonly CanonicalRecord["type"][];
  readonly statuses?: readonly CanonicalRecord["status"][];
  readonly component_ids?: readonly string[];
  readonly task_id?: string | null;
  readonly include_superseded?: boolean;
}

export interface CanonicalRecordStore {
  planCreate(
    root: URL,
    record: CanonicalRecord,
  ): Promise<RuntimeResult<RecordMutationPlan>>;
  planSupersede(
    root: URL,
    previousId: string,
    replacement: CanonicalRecord,
  ): Promise<RuntimeResult<RecordMutationPlan>>;
  get(root: URL, recordId: string): Promise<RuntimeResult<CanonicalRecord>>;
  list(
    root: URL,
    query: RecordQuery,
  ): Promise<RuntimeResult<readonly CanonicalRecord[]>>;
}

export interface CanonicalRecordStoreDependencies {
  readonly context: RecordPlanningContextProvider;
  readonly clock: Clock;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
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

function validateRecord(value: unknown, source: string): RuntimeResult<CanonicalRecord> {
  const result = validateWithSchema<CanonicalRecord>(RECORD_SCHEMA_ID, value);
  return result.ok
    ? result
    : translatedFailure(
        "record.schema_invalid",
        "canonical record does not satisfy its registered schema",
        source,
        result.issues,
      );
}

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

async function readCanonicalRecord(
  root: URL,
  relativePath: string,
): Promise<RuntimeResult<CanonicalRecord>> {
  const resolved = await resolveInside(root, relativePath);
  if (!resolved.ok) return resolved;
  let bytes: Uint8Array;
  try {
    const stat = await lstat(resolved.value);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure(
        "record.path_unsafe",
        "canonical records must be regular files",
        relativePath,
      );
    }
    bytes = new Uint8Array(await readFile(resolved.value));
  } catch (error: unknown) {
    return failure(
      "record.read_failed",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }

  const decoded = decodeStrictUtf8(bytes, relativePath);
  if (!decoded.ok) {
    return translatedFailure(
      "record.document_invalid",
      "canonical record must use strict UTF-8",
      relativePath,
      decoded.issues,
    );
  }
  const parsed = parseJsonDocument(decoded.value, relativePath);
  if (!parsed.ok) {
    return translatedFailure(
      "record.document_invalid",
      "canonical record must be strict JSON",
      relativePath,
      parsed.issues,
    );
  }
  const validated = validateRecord(parsed.value, relativePath);
  if (!validated.ok) return validated;
  if (canonicalRecordPath(validated.value) !== relativePath) {
    return failure(
      "record.path_mismatch",
      "record type and ID must match its canonical path",
      relativePath,
      [canonicalRecordPath(validated.value)],
    );
  }
  const canonicalBytes = new TextEncoder().encode(canonicalJson(validated.value));
  if (!byteEqual(bytes, canonicalBytes)) {
    return failure(
      "record.noncanonical",
      "record bytes must match deterministic canonical JSON",
      relativePath,
    );
  }
  return success(validated.value);
}

async function readRecordDirectory(
  root: URL,
  type: CanonicalRecordType,
): Promise<RuntimeResult<readonly CanonicalRecord[]>> {
  const relativeDirectory = `docs/project-memory/records/${RECORD_DIRECTORIES[type]}`;
  const resolved = await resolveInside(root, relativeDirectory);
  if (!resolved.ok) return resolved;

  let entries;
  try {
    const stat = await lstat(resolved.value);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return failure(
        "record.directory_unsafe",
        "canonical record directories must be real directories",
        relativeDirectory,
      );
    }
    entries = await readdir(resolved.value, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return success([]);
    return failure(
      "record.directory_read_failed",
      error instanceof Error ? error.message : String(error),
      relativeDirectory,
    );
  }

  const records: CanonicalRecord[] = [];
  for (const entry of entries.sort((left, right) => compareUtf8(left.name, right.name))) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.name === ".gitkeep" && entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
      return failure(
        "record.directory_entry_unsafe",
        "record directories may contain canonical JSON files only",
        relativePath,
      );
    }
    const record = await readCanonicalRecord(root, relativePath);
    if (!record.ok) return record;
    records.push(record.value);
  }
  return success(records);
}

async function readAllRecords(
  root: URL,
): Promise<RuntimeResult<readonly CanonicalRecord[]>> {
  const records: CanonicalRecord[] = [];
  for (const type of RECORD_TYPES) {
    const directory = await readRecordDirectory(root, type);
    if (!directory.ok) return directory;
    records.push(...directory.value);
  }
  records.sort((left, right) => compareUtf8(left.id, right.id));
  const index = buildSupersessionIndex(records);
  return index.ok ? success(records) : index;
}

function matchesQuery(record: CanonicalRecord, query: RecordQuery): boolean {
  if (query.root_id !== undefined && record.root_id !== query.root_id) return false;
  if (query.types !== undefined && !query.types.includes(record.type)) return false;
  if (query.statuses !== undefined && !query.statuses.includes(record.status)) {
    return false;
  }
  if (
    query.component_ids !== undefined &&
    !query.component_ids.some((id) => record.component_ids.includes(id))
  ) {
    return false;
  }
  if (Object.hasOwn(query, "task_id") && record.task_id !== query.task_id) {
    return false;
  }
  return true;
}

function directional(record: CanonicalRecord): boolean {
  if (record.status !== "accepted") return false;
  if (record.type === "decision" || record.type === "idea") return true;
  return (
    record.type === "approval" &&
    (record.payload as ApprovalRecordPayload).approval_kind === "directional"
  );
}

function validPitajiApproval(
  approval: CanonicalRecord,
  target: CanonicalRecord,
  now: Date,
): boolean {
  if (approval.type !== "approval" || approval.status !== "accepted") return false;
  if (approval.id === target.id || approval.authority_class !== "pitaji") return false;
  const payload = approval.payload as ApprovalRecordPayload;
  if (payload.approval_kind !== "directional") return false;
  if (payload.granted_by.trim().toLowerCase() !== "pitaji") return false;
  if (payload.target !== target.id) return false;
  const expiry = payload.expires_at;
  return expiry === null || new Date(expiry).getTime() > now.getTime();
}

function approvalCoverage(
  record: CanonicalRecord,
  existing: readonly CanonicalRecord[],
  now: Date,
): RuntimeResult<readonly string[]> {
  if (!directional(record)) return success([]);
  if (
    record.authority_class === "pitaji" &&
    record.actor_id.trim().toLowerCase() === "pitaji"
  ) {
    return success([]);
  }
  const approvals = existing
    .filter((candidate) => validPitajiApproval(candidate, record, now))
    .map((candidate) => candidate.id)
    .sort(compareUtf8);
  return approvals.length > 0
    ? success(approvals)
    : failure(
        "record.pitaji_approval_required",
        "accepted directional records require exact Pitaji approval coverage",
        record.id,
      );
}

function validContext(context: RecordPlanningContext): boolean {
  return (
    context.target_ref.trim().length > 0 &&
    /^[0-9a-f]{40}$/.test(context.expected_head) &&
    /^[0-9a-f]{64}$/.test(context.profile_lock_hash) &&
    context.created_by.trim().length > 0
  );
}

async function buildPlan(
  root: URL,
  record: CanonicalRecord,
  existing: readonly CanonicalRecord[],
  dependencies: CanonicalRecordStoreDependencies,
): Promise<RuntimeResult<RecordMutationPlan>> {
  if (existing.some((candidate) => candidate.id === record.id)) {
    return failure(
      "record.id_exists",
      "immutable canonical record IDs cannot be replaced or reused",
      record.id,
    );
  }
  const graph = buildSupersessionIndex([...existing, record]);
  if (!graph.ok) return graph;
  const now = dependencies.clock.now();
  const coverage = approvalCoverage(record, existing, now);
  if (!coverage.ok) return coverage;
  const write = recordWrite(record);
  const confined = await resolveInside(root, write.relative_path);
  if (!confined.ok) return confined;
  const context = await dependencies.context.context(root);
  if (!context.ok) return context;
  if (!validContext(context.value)) {
    return failure(
      "record.context_invalid",
      "record planning context must bind an exact ref, head, profile, and actor",
      record.id,
    );
  }

  const approvalIds = [
    ...coverage.value,
    ...(record.type === "approval" ? [record.id] : []),
  ].sort(compareUtf8);
  const createdAt = now.toISOString();
  const withoutHash: Omit<RecordMutationPlan, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: `record:${record.id}:${context.value.expected_head.slice(0, 12)}`,
    mutation_kind: "record",
    root_id: record.root_id,
    target_ref: context.value.target_ref,
    expected_head: context.value.expected_head,
    profile_lock_hash: context.value.profile_lock_hash,
    writes: [write],
    record_ids: [record.id],
    event_ids: [],
    approval_ids: [...new Set(approvalIds)],
    evidence_ids: record.type === "evidence" ? [record.id] : [],
    created_by: context.value.created_by,
    created_at: createdAt,
    expires_at: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
    metadata: { governance_kind: "record", record_type: record.type },
  };
  return success({
    ...withoutHash,
    plan_hash: canonicalMutationPlanHash(withoutHash),
  });
}

export function createCanonicalRecordStore(
  dependencies: CanonicalRecordStoreDependencies,
): CanonicalRecordStore {
  async function planCreate(
    root: URL,
    record: CanonicalRecord,
  ): Promise<RuntimeResult<RecordMutationPlan>> {
    const validated = validateRecord(record, record.id);
    if (!validated.ok) return validated;
    const existing = await readAllRecords(root);
    if (!existing.ok) return existing;
    return buildPlan(root, validated.value, existing.value, dependencies);
  }

  async function planSupersede(
    root: URL,
    previousId: string,
    replacement: CanonicalRecord,
  ): Promise<RuntimeResult<RecordMutationPlan>> {
    const existing = await readAllRecords(root);
    if (!existing.ok) return existing;
    const previous = existing.value.find((record) => record.id === previousId);
    if (previous === undefined) {
      return failure(
        "record.not_found",
        "the immutable record to supersede does not exist",
        previousId,
      );
    }
    const validated = validateRecord(replacement, replacement.id);
    if (!validated.ok) return validated;
    if (validated.value.id === previous.id) {
      return failure(
        "record.id_exists",
        "a superseding record must use a new immutable ID",
        replacement.id,
      );
    }
    if (validated.value.root_id !== previous.root_id) {
      return failure(
        "record.root_mismatch",
        "a superseding record must remain in the same product root",
        replacement.id,
      );
    }
    if (validated.value.type !== previous.type) {
      return failure(
        "record.fact_class_mismatch",
        "a superseding record must preserve the canonical fact class",
        replacement.id,
      );
    }
    const links = validated.value.relationships.filter(
      (relationship) => relationship.type === "supersedes",
    );
    if (links.length !== 1 || links[0]?.target_id !== previous.id) {
      return failure(
        "record.supersession_link_required",
        "a replacement must contain exactly one supersedes link to the previous record",
        replacement.id,
        [previous.id],
      );
    }
    return buildPlan(root, validated.value, existing.value, dependencies);
  }

  async function get(
    root: URL,
    recordId: string,
  ): Promise<RuntimeResult<CanonicalRecord>> {
    const records = await readAllRecords(root);
    if (!records.ok) return records;
    const record = records.value.find((candidate) => candidate.id === recordId);
    return record === undefined
      ? failure("record.not_found", "canonical record does not exist", recordId)
      : success(record);
  }

  async function list(
    root: URL,
    query: RecordQuery,
  ): Promise<RuntimeResult<readonly CanonicalRecord[]>> {
    const records = await readAllRecords(root);
    if (!records.ok) return records;
    let values = records.value.filter((record) => matchesQuery(record, query));
    if (query.include_superseded === false) {
      const index = buildSupersessionIndex(records.value);
      if (!index.ok) return index;
      values = values.filter((record) => !index.value.superseded_ids.has(record.id));
    }
    return success(values);
  }

  return { planCreate, planSupersede, get, list };
}
