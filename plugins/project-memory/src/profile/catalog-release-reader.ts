import { readFile } from "node:fs/promises";

import type { CatalogReleaseLock } from "../catalog/contracts/index.js";
import { verifyCatalogRelease } from "../catalog/manifest/verify-catalog-release.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import {
  decodeStrictUtf8,
  parseJsonDocument,
} from "../core/document-io.js";
import { sha256 } from "../core/hash.js";
import { resolveInside } from "../core/path-safety.js";
import { validateWithSchema } from "../schema/validate.js";

export interface VerifiedCatalogSourceFile {
  readonly relative_path: string;
  readonly definition_id: string | null;
  readonly version: string | null;
  readonly schema_id: string | null;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface VerifiedCatalogSchemaFile {
  readonly id: string;
  readonly relative_path: string;
  readonly source_relative_path: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface VerifiedCatalogRelease {
  readonly release: string;
  readonly release_hash: string;
  readonly release_root: URL;
  readonly package_root: URL;
  readonly source_root: URL;
  readonly schema_root: URL;
  readonly lock: CatalogReleaseLock;
  readonly source_files: readonly VerifiedCatalogSourceFile[];
  readonly schema_files: readonly VerifiedCatalogSchemaFile[];
  readonly checked_paths: readonly string[];
}

interface SchemaIndexEntry {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
}

interface SchemaIndex {
  readonly schema_version: "1.0.0";
  readonly schemas: readonly SchemaIndexEntry[];
}

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort(compareUtf8);
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort(compareUtf8)[index])
  );
}

function parseSchemaIndex(value: unknown): RuntimeResult<SchemaIndex> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schema_version", "schemas"]) ||
    value.schema_version !== "1.0.0" ||
    !Array.isArray(value.schemas)
  ) {
    return failure(
      "CATALOG_SCHEMA_INDEX_INVALID",
      "schema index must contain only schema_version 1.0.0 and schemas",
      "schema-index.json",
    );
  }

  const entries: SchemaIndexEntry[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const [index, candidate] of value.schemas.entries()) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ["id", "path", "sha256"]) ||
      typeof candidate.id !== "string" ||
      !/^project-memory\/v1\/[a-z][a-z0-9-]*$/.test(candidate.id) ||
      typeof candidate.path !== "string" ||
      candidate.path.length === 0 ||
      candidate.path.includes("\\") ||
      candidate.path.split("/").includes("..") ||
      typeof candidate.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(candidate.sha256)
    ) {
      return failure(
        "CATALOG_SCHEMA_INDEX_INVALID",
        "schema index entry is malformed",
        `schema-index.json/schemas/${String(index)}`,
      );
    }
    if (ids.has(candidate.id) || paths.has(candidate.path)) {
      return failure(
        "CATALOG_SCHEMA_INDEX_DUPLICATE",
        "schema index IDs and paths must be unique",
        `schema-index.json/schemas/${String(index)}`,
      );
    }
    ids.add(candidate.id);
    paths.add(candidate.path);
    entries.push({
      id: candidate.id,
      path: candidate.path,
      sha256: candidate.sha256,
    });
  }
  const sorted = [...entries].sort((left, right) => compareUtf8(left.id, right.id));
  if (entries.some((entry, index) => entry.id !== sorted[index]?.id)) {
    return failure(
      "CATALOG_SCHEMA_INDEX_ORDER_INVALID",
      "schema index entries must be sorted by schema ID",
      "schema-index.json",
    );
  }
  return success({ schema_version: "1.0.0", schemas: entries });
}

async function readBytes(
  root: URL,
  relativePath: string,
  code = "CATALOG_RELEASE_READ_FAILED",
): Promise<RuntimeResult<Uint8Array>> {
  const resolved = await resolveInside(root, relativePath);
  if (!resolved.ok) return resolved;
  try {
    return success(new Uint8Array(await readFile(resolved.value)));
  } catch (error: unknown) {
    return failure(
      code,
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
}

async function readLock(releaseRoot: URL): Promise<RuntimeResult<CatalogReleaseLock>> {
  const bytes = await readBytes(releaseRoot, "catalog.lock.json");
  if (!bytes.ok) return bytes;
  const decoded = decodeStrictUtf8(bytes.value, "catalog.lock.json");
  if (!decoded.ok) return decoded;
  const parsed = parseJsonDocument(decoded.value, "catalog.lock.json");
  if (!parsed.ok) return parsed;
  return validateWithSchema<CatalogReleaseLock>(
    "project-memory/v1/catalog-release-lock",
    parsed.value,
  );
}

async function readVerifiedSources(
  sourceRoot: URL,
  lock: CatalogReleaseLock,
): Promise<RuntimeResult<readonly VerifiedCatalogSourceFile[]>> {
  const files: VerifiedCatalogSourceFile[] = [];
  for (const entry of lock.source_entries) {
    const bytes = await readBytes(sourceRoot, entry.relative_path);
    if (!bytes.ok) return bytes;
    const actualHash = sha256(bytes.value);
    if (actualHash !== entry.sha256) {
      return failure(
        "CATALOG_RELEASE_SOURCE_HASH_MISMATCH",
        "catalog source hash does not match the release lock",
        entry.relative_path,
      );
    }
    files.push({ ...entry, bytes: bytes.value });
  }
  return success(
    files.sort((left, right) => compareUtf8(left.relative_path, right.relative_path)),
  );
}

async function readVerifiedSchemas(
  schemaRoot: URL,
): Promise<RuntimeResult<readonly VerifiedCatalogSchemaFile[]>> {
  const indexBytes = await readBytes(
    schemaRoot,
    "schema-index.json",
    "CATALOG_SCHEMA_INDEX_READ_FAILED",
  );
  if (!indexBytes.ok) return indexBytes;
  const decoded = decodeStrictUtf8(indexBytes.value, "schema-index.json");
  if (!decoded.ok) return decoded;
  const parsed = parseJsonDocument(decoded.value, "schema-index.json");
  if (!parsed.ok) return parsed;
  const index = parseSchemaIndex(parsed.value);
  if (!index.ok) return index;
  const canonicalBytes = new Uint8Array(Buffer.from(canonicalJson(index.value), "utf8"));
  if (!byteEqual(indexBytes.value, canonicalBytes)) {
    return failure(
      "CATALOG_SCHEMA_INDEX_NONCANONICAL",
      "schema index bytes must be canonical JSON",
      "schema-index.json",
    );
  }

  const files: VerifiedCatalogSchemaFile[] = [];
  for (const entry of index.value.schemas) {
    const bytes = await readBytes(
      schemaRoot,
      entry.path,
      "CATALOG_SCHEMA_READ_FAILED",
    );
    if (!bytes.ok) return bytes;
    if (sha256(bytes.value) !== entry.sha256) {
      return failure(
        "CATALOG_SCHEMA_HASH_MISMATCH",
        "emitted schema hash does not match the schema index",
        entry.path,
      );
    }
    files.push({
      id: entry.id,
      relative_path: entry.path,
      source_relative_path: `schemas/project-memory/v1/${entry.path}`,
      bytes: bytes.value,
      sha256: entry.sha256,
    });
  }
  return success(files);
}

export async function readVerifiedCatalogRelease(
  releaseRoot: URL,
  expectedRelease: string,
  expectedReleaseHash: string,
): Promise<RuntimeResult<VerifiedCatalogRelease>> {
  if (releaseRoot.protocol !== "file:") {
    return failure(
      "PATH_ROOT_INVALID",
      "catalog release root must be a file URL",
      "catalog_release_root",
    );
  }
  const normalizedReleaseRoot = new URL(
    releaseRoot.href.endsWith("/") ? releaseRoot.href : `${releaseRoot.href}/`,
  );
  const packageRoot = new URL("../../../../", normalizedReleaseRoot);
  const sourceRoot = new URL("catalog/project-memory/v1/", packageRoot);
  const schemaRoot = new URL("schemas/project-memory/v1/", packageRoot);

  const lock = await readLock(normalizedReleaseRoot);
  if (!lock.ok) return lock;
  const verified = await verifyCatalogRelease(
    normalizedReleaseRoot,
    lock.value,
    sourceRoot,
  );
  if (!verified.ok) return verified;
  if (lock.value.release !== expectedRelease) {
    return failure(
      "CATALOG_RELEASE_VERSION_MISMATCH",
      `selected release ${expectedRelease} does not match ${lock.value.release}`,
      "catalog.release",
    );
  }
  if (lock.value.release_hash !== expectedReleaseHash) {
    return failure(
      "CATALOG_RELEASE_SELECTION_HASH_MISMATCH",
      "selected catalog hash does not match the verified release",
      "catalog.catalog_hash",
    );
  }

  const sources = await readVerifiedSources(sourceRoot, lock.value);
  if (!sources.ok) return sources;
  const schemas = await readVerifiedSchemas(schemaRoot);
  if (!schemas.ok) return schemas;
  return success({
    release: lock.value.release,
    release_hash: lock.value.release_hash,
    release_root: normalizedReleaseRoot,
    package_root: packageRoot,
    source_root: sourceRoot,
    schema_root: schemaRoot,
    lock: lock.value,
    source_files: sources.value,
    schema_files: schemas.value,
    checked_paths: [
      ...verified.value.checked_paths,
      ...sources.value.map((file) => `source:${file.relative_path}`),
      "schema:schema-index.json",
      ...schemas.value.map((file) => `schema:${file.relative_path}`),
    ].sort(compareUtf8),
  });
}
