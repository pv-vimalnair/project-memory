import { lstat, readFile } from "node:fs/promises";

import {
  canonicalJson,
  canonicalMutationPlanHash,
  decodeStrictUtf8,
  failure,
  parseJsonDocument,
  resolveInside,
  sha256,
  success,
  validateWithSchema,
  type CanonicalMutationPlan,
  type Clock,
  type PlannedWrite,
  type RuntimeIssue,
  type RuntimeResult,
} from "../../index.js";

import type { ArchiveManifest } from "../contracts/index.js";
import {
  redactArchiveBytes,
  type ArchiveRedactionReport,
} from "./redactor.js";

const ARCHIVE_MANIFEST_SCHEMA_ID = "project-memory/v1/archive-manifest" as const;
const SHA256 = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const PLAN_TTL_MS = 5 * 60 * 1000;

export interface ArchiveIngestInput {
  readonly root_id: string;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly profile_lock_hash: string;
  readonly actor_id: string;
  readonly object_kind: string;
  readonly media_type: string;
  readonly source_refs: readonly string[];
  readonly bytes: Uint8Array;
}

export interface ArchiveMutationMetadata {
  readonly governance_kind: "archive";
  readonly source_hash: string;
  readonly object_hash: string;
  readonly object_path: string;
  readonly manifest_hash: string;
  readonly manifest_path: string;
  readonly object_kind: string;
  readonly redaction_report: ArchiveRedactionReport;
}

export type ArchivePlan = CanonicalMutationPlan<ArchiveMutationMetadata>;

export interface ArchiveVerification {
  readonly manifest_hash: string;
  readonly object_hash: string;
  readonly manifest_path: string;
  readonly object_path: string;
  readonly manifest: ArchiveManifest;
}

export interface ArchiveStore {
  planIngest(input: ArchiveIngestInput): RuntimeResult<ArchivePlan>;
  verify(root: URL, manifestHash: string): Promise<RuntimeResult<ArchiveVerification>>;
}

export interface ArchiveStoreDependencies {
  readonly clock: Clock;
}

type ManifestBody = Omit<ArchiveManifest, "manifest_hash">;

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function requireHash(hash: string): void {
  if (!SHA256.test(hash)) throw new TypeError("archive hash must be lowercase SHA-256");
}

export function archiveObjectPath(hash: string): string {
  requireHash(hash);
  return `docs/project-memory/archive/objects/sha256/${hash.slice(0, 2)}/${hash}`;
}

export function archiveManifestPath(hash: string): string {
  requireHash(hash);
  return `docs/project-memory/archive/manifests/${hash}.json`;
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

function nonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function validateInput(input: ArchiveIngestInput): RuntimeResult<true> {
  const values = [
    input.root_id,
    input.target_ref,
    input.actor_id,
    input.object_kind,
    input.media_type,
    ...input.source_refs,
  ];
  if (
    values.some((value) => !nonBlank(value)) ||
    !REVISION.test(input.expected_head) ||
    !SHA256.test(input.profile_lock_hash) ||
    input.source_refs.length === 0
  ) {
    return failure(
      "archive.input_invalid",
      "archive input must bind a root, ref, revision, profile, actor, kind, media type, and source",
      input.root_id,
    );
  }
  return success(true);
}

function manifestHash(body: ManifestBody): string {
  return sha256(canonicalJson(body));
}

function validateManifest(
  value: unknown,
  source: string,
): RuntimeResult<ArchiveManifest> {
  const result = validateWithSchema<ArchiveManifest>(ARCHIVE_MANIFEST_SCHEMA_ID, value);
  return result.ok
    ? result
    : translatedFailure(
        "archive.manifest_invalid",
        "archive manifest does not satisfy its registered schema",
        source,
        result.issues,
      );
}

function createManifest(
  input: ArchiveIngestInput,
  sourceHash: string,
  objectHash: string,
  objectPath: string,
  report: ArchiveRedactionReport,
  createdAt: string,
): RuntimeResult<ArchiveManifest> {
  const body: ManifestBody = {
    schema_version: "1.0.0",
    source_hash: sourceHash,
    stored_hash: objectHash,
    object_kind: input.object_kind,
    object_path: objectPath,
    media_type: input.media_type,
    redaction_report: report,
    actor_id: input.actor_id,
    created_at: createdAt,
    source_refs: [...new Set(input.source_refs)].sort(compareUtf8),
  };
  return validateManifest(
    { ...body, manifest_hash: manifestHash(body) },
    "archive-manifest",
  );
}

function plannedWrite(relativePath: string, bytes: Uint8Array): PlannedWrite {
  return {
    relative_path: relativePath,
    bytes,
    expected_existing_sha256: null,
    mode: "create",
  };
}

function planArchive(
  input: ArchiveIngestInput,
  dependencies: ArchiveStoreDependencies,
): RuntimeResult<ArchivePlan> {
  const valid = validateInput(input);
  if (!valid.ok) return valid;
  const redacted = redactArchiveBytes(input.bytes);
  if (!redacted.ok) return redacted;
  const now = dependencies.clock.now();
  if (!Number.isFinite(now.getTime())) {
    return failure(
      "archive.clock_invalid",
      "archive planning requires a valid injected clock",
      input.root_id,
    );
  }
  const createdAt = now.toISOString();
  const sourceHash = sha256(input.bytes);
  const objectHash = sha256(redacted.value.bytes);
  const objectPath = archiveObjectPath(objectHash);
  const manifest = createManifest(
    input,
    sourceHash,
    objectHash,
    objectPath,
    redacted.value.report,
    createdAt,
  );
  if (!manifest.ok) return manifest;
  const manifestPath = archiveManifestPath(manifest.value.manifest_hash);
  const writes = [
    plannedWrite(objectPath, redacted.value.bytes),
    plannedWrite(
      manifestPath,
      new TextEncoder().encode(canonicalJson(manifest.value)),
    ),
  ].sort((left, right) => compareUtf8(left.relative_path, right.relative_path));
  const metadata: ArchiveMutationMetadata = {
    governance_kind: "archive",
    source_hash: sourceHash,
    object_hash: objectHash,
    object_path: objectPath,
    manifest_hash: manifest.value.manifest_hash,
    manifest_path: manifestPath,
    object_kind: input.object_kind,
    redaction_report: redacted.value.report,
  };
  const withoutHash: Omit<ArchivePlan, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: `archive:${manifest.value.manifest_hash.slice(0, 12)}:${input.expected_head.slice(0, 12)}`,
    mutation_kind: "archive",
    root_id: input.root_id,
    target_ref: input.target_ref,
    expected_head: input.expected_head,
    profile_lock_hash: input.profile_lock_hash,
    writes,
    record_ids: [],
    event_ids: [],
    approval_ids: [],
    evidence_ids: [],
    created_by: input.actor_id,
    created_at: createdAt,
    expires_at: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
    metadata,
  };
  return success({
    ...withoutHash,
    plan_hash: canonicalMutationPlanHash(withoutHash),
  });
}

async function readRegularFile(
  root: URL,
  relativePath: string,
  kind: "manifest" | "object",
): Promise<RuntimeResult<Uint8Array>> {
  const resolved = await resolveInside(root, relativePath);
  if (!resolved.ok) return resolved;
  try {
    const stat = await lstat(resolved.value);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure(
        `archive.${kind}_path_unsafe`,
        `archive ${kind} must be a regular file`,
        relativePath,
      );
    }
    return success(new Uint8Array(await readFile(resolved.value)));
  } catch (error: unknown) {
    return failure(
      `archive.${kind}_read_failed`,
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
}

function parseManifest(
  bytes: Uint8Array,
  relativePath: string,
): RuntimeResult<ArchiveManifest> {
  const decoded = decodeStrictUtf8(bytes, relativePath);
  if (!decoded.ok) {
    return translatedFailure(
      "archive.manifest_invalid",
      "archive manifest must use strict UTF-8",
      relativePath,
      decoded.issues,
    );
  }
  const parsed = parseJsonDocument(decoded.value, relativePath);
  if (!parsed.ok) {
    return translatedFailure(
      "archive.manifest_invalid",
      "archive manifest must use strict JSON",
      relativePath,
      parsed.issues,
    );
  }
  const manifest = validateManifest(parsed.value, relativePath);
  if (!manifest.ok) return manifest;
  const canonicalBytes = new TextEncoder().encode(canonicalJson(manifest.value));
  if (!Buffer.from(bytes).equals(Buffer.from(canonicalBytes))) {
    return failure(
      "archive.manifest_noncanonical",
      "archive manifest bytes must be deterministic canonical JSON",
      relativePath,
    );
  }
  return manifest;
}

async function verifyArchive(
  root: URL,
  requestedHash: string,
): Promise<RuntimeResult<ArchiveVerification>> {
  if (!SHA256.test(requestedHash)) {
    return failure(
      "archive.manifest_hash_invalid",
      "archive manifest identifier must be lowercase SHA-256",
      requestedHash,
    );
  }
  const manifestPath = archiveManifestPath(requestedHash);
  const manifestBytes = await readRegularFile(root, manifestPath, "manifest");
  if (!manifestBytes.ok) return manifestBytes;
  const manifest = parseManifest(manifestBytes.value, manifestPath);
  if (!manifest.ok) return manifest;
  const { manifest_hash: ignored, ...body } = manifest.value;
  void ignored;
  if (
    manifest.value.manifest_hash !== requestedHash ||
    manifestHash(body) !== requestedHash
  ) {
    return failure(
      "archive.manifest_hash_mismatch",
      "archive manifest bytes do not match their content address",
      manifestPath,
      [requestedHash, manifest.value.manifest_hash],
    );
  }
  const expectedObjectPath = archiveObjectPath(manifest.value.stored_hash);
  if (manifest.value.object_path !== expectedObjectPath) {
    return failure(
      "archive.object_path_mismatch",
      "archive object path must be derived from its stored hash",
      manifest.value.object_path,
      [expectedObjectPath],
    );
  }
  const objectBytes = await readRegularFile(root, expectedObjectPath, "object");
  if (!objectBytes.ok) return objectBytes;
  if (sha256(objectBytes.value) !== manifest.value.stored_hash) {
    return failure(
      "archive.object_hash_mismatch",
      "archive object bytes do not match their content address",
      expectedObjectPath,
      [manifest.value.stored_hash],
    );
  }
  return success({
    manifest_hash: requestedHash,
    object_hash: manifest.value.stored_hash,
    manifest_path: manifestPath,
    object_path: expectedObjectPath,
    manifest: manifest.value,
  });
}

export function createArchiveStore(
  dependencies: ArchiveStoreDependencies,
): ArchiveStore {
  return {
    planIngest(input) {
      return planArchive(input, dependencies);
    },
    verify(root, manifestHashValue) {
      return verifyArchive(root, manifestHashValue);
    },
  };
}
