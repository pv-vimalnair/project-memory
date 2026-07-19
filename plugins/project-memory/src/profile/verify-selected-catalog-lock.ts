import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { valid as validSemver } from "semver";

import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import {
  decodeStrictUtf8,
  normalizeGitTextBytes,
  parseJsonDocument,
} from "../core/document-io.js";
import { sha256 } from "../core/hash.js";
import { resolveInside } from "../core/path-safety.js";

import {
  compareSelectedCatalogPath,
  SELECTED_CATALOG_LOCK_PATH,
  SELECTED_CATALOG_SCHEMA_ROOT,
  SELECTED_CATALOG_SOURCE_ROOT,
  selectedCatalogLockHash,
  validateSelectedCatalogLockOrder,
  validateSelectedCatalogLockStructure,
  validateSelectedCatalogTarget,
} from "./build-selected-catalog-lock.js";
import {
  type CatalogSourceKind,
  type SelectedCatalogLock,
  type SelectedCatalogLockEntry,
  type SelectedCatalogVerificationReport,
} from "./contracts/index.js";

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

const SOURCE_KINDS = new Set<CatalogSourceKind>([
  "pattern-core",
  "pattern-taxonomy",
  "companion-core",
  "companion-taxonomy",
  "blueprint",
  "definition-source",
  "generated-schema",
]);
const DEFINITION_ID = /^[a-z][a-z0-9-]*(?:[.][a-z][a-z0-9-]*)+$/;
const SHA256 = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort(compareSelectedCatalogPath);
  const sortedExpected = [...expected].sort(compareSelectedCatalogPath);
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isSafeRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function lockInvalid(message: string, pathValue: string): RuntimeResult<never> {
  return failure("SELECTED_CATALOG_LOCK_INVALID", message, pathValue);
}

function parseLockContract(value: unknown): RuntimeResult<SelectedCatalogLock> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema_version",
      "catalog_release",
      "source_release_hash",
      "entries",
      "lock_hash",
    ]) ||
    value.schema_version !== "1.0.0" ||
    typeof value.catalog_release !== "string" ||
    validSemver(value.catalog_release) === null ||
    typeof value.source_release_hash !== "string" ||
    !SHA256.test(value.source_release_hash) ||
    typeof value.lock_hash !== "string" ||
    !SHA256.test(value.lock_hash) ||
    !Array.isArray(value.entries)
  ) {
    return lockInvalid(
      "selected catalog lock header is malformed or has unknown keys",
      SELECTED_CATALOG_LOCK_PATH,
    );
  }

  const entries: SelectedCatalogLockEntry[] = [];
  for (const [index, candidate] of value.entries.entries()) {
    const entryPath = `${SELECTED_CATALOG_LOCK_PATH}/entries/${String(index)}`;
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, [
        "kind",
        "definition_ids",
        "source_release_path",
        "target_path",
        "sha256",
        "byte_length",
      ]) ||
      typeof candidate.kind !== "string" ||
      !SOURCE_KINDS.has(candidate.kind as CatalogSourceKind) ||
      !Array.isArray(candidate.definition_ids) ||
      !candidate.definition_ids.every(
        (id) => typeof id === "string" && DEFINITION_ID.test(id),
      ) ||
      new Set(candidate.definition_ids).size !== candidate.definition_ids.length ||
      typeof candidate.source_release_path !== "string" ||
      !isSafeRelativePath(candidate.source_release_path) ||
      typeof candidate.target_path !== "string" ||
      !isSafeRelativePath(candidate.target_path) ||
      typeof candidate.sha256 !== "string" ||
      !SHA256.test(candidate.sha256) ||
      typeof candidate.byte_length !== "number" ||
      !Number.isInteger(candidate.byte_length) ||
      candidate.byte_length < 0
    ) {
      return lockInvalid(
        "selected catalog lock entry is malformed or has unknown keys",
        entryPath,
      );
    }
    entries.push({
      kind: candidate.kind as CatalogSourceKind,
      definition_ids: candidate.definition_ids as string[],
      source_release_path: candidate.source_release_path,
      target_path: candidate.target_path,
      sha256: candidate.sha256,
      byte_length: candidate.byte_length,
    });
  }
  return success({
    schema_version: "1.0.0",
    catalog_release: value.catalog_release,
    source_release_hash: value.source_release_hash,
    entries,
    lock_hash: value.lock_hash,
  });
}

async function readTargetBytes(
  root: URL,
  relativePath: string,
  missingCode: string,
): Promise<RuntimeResult<Uint8Array>> {
  const resolved = await resolveInside(root, relativePath);
  if (!resolved.ok) return resolved;
  try {
    return success(normalizeGitTextBytes(
      new Uint8Array(await readFile(resolved.value)),
    ));
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    return failure(
      code === "ENOENT" ? missingCode : "SELECTED_CATALOG_TARGET_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
}

async function walkOwnedNamespace(
  root: URL,
  relativeDirectory: string,
): Promise<RuntimeResult<readonly string[]>> {
  const directory = await resolveInside(root, relativeDirectory);
  if (!directory.ok) return directory;
  let entries;
  try {
    entries = await readdir(directory.value, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return success([]);
    return failure(
      "SELECTED_CATALOG_NAMESPACE_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      relativeDirectory,
    );
  }

  const files: string[] = [];
  entries.sort((left, right) => compareSelectedCatalogPath(left.name, right.name));
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      return failure(
        "SELECTED_CATALOG_UNSAFE_TARGET",
        "symbolic links are forbidden in selected catalog namespaces",
        relativePath,
      );
    }
    if (entry.isDirectory()) {
      const nested = await walkOwnedNamespace(root, relativePath);
      if (!nested.ok) return nested;
      files.push(...nested.value);
      continue;
    }
    if (!entry.isFile()) {
      return failure(
        "SELECTED_CATALOG_UNSAFE_TARGET",
        "selected catalog namespaces may contain regular files only",
        relativePath,
      );
    }
    files.push(relativePath);
  }
  return success(files.sort(compareSelectedCatalogPath));
}

async function readLock(root: URL): Promise<RuntimeResult<{
  readonly lock: SelectedCatalogLock;
  readonly bytes: Uint8Array;
}>> {
  const bytes = await readTargetBytes(
    root,
    SELECTED_CATALOG_LOCK_PATH,
    "SELECTED_CATALOG_LOCK_MISSING",
  );
  if (!bytes.ok) return bytes;
  const decoded = decodeStrictUtf8(bytes.value, SELECTED_CATALOG_LOCK_PATH);
  if (!decoded.ok) return decoded;
  const parsed = parseJsonDocument(decoded.value, SELECTED_CATALOG_LOCK_PATH);
  if (!parsed.ok) return parsed;
  const validated = parseLockContract(parsed.value);
  if (!validated.ok) return validated;
  return success({ lock: validated.value, bytes: bytes.value });
}

function validateLockIntegrity(
  lock: SelectedCatalogLock,
  bytes: Uint8Array,
): RuntimeResult<true> {
  const canonicalBytes = new Uint8Array(Buffer.from(canonicalJson(lock), "utf8"));
  if (!byteEqual(bytes, canonicalBytes)) {
    return failure(
      "SELECTED_CATALOG_LOCK_NONCANONICAL",
      "selected catalog lock bytes must be canonical JSON",
      SELECTED_CATALOG_LOCK_PATH,
    );
  }
  const withoutHash: Omit<SelectedCatalogLock, "lock_hash"> = {
    schema_version: lock.schema_version,
    catalog_release: lock.catalog_release,
    source_release_hash: lock.source_release_hash,
    entries: lock.entries,
  };
  if (lock.lock_hash !== selectedCatalogLockHash(withoutHash)) {
    return failure(
      "SELECTED_CATALOG_LOCK_HASH_MISMATCH",
      "selected catalog lock hash does not match its entries",
      SELECTED_CATALOG_LOCK_PATH,
    );
  }
  const ordered = validateSelectedCatalogLockOrder(lock);
  return ordered.ok ? validateSelectedCatalogLockStructure(lock.entries) : ordered;
}

function validateEntrySet(lock: SelectedCatalogLock): RuntimeResult<Set<string>> {
  const expected = new Set<string>();
  const sources = new Set<string>();
  for (const entry of lock.entries) {
    const namespace = validateSelectedCatalogTarget(entry.kind, entry.target_path);
    if (!namespace.ok) return namespace;
    const normalized = entry.target_path.normalize("NFC").toLowerCase();
    if (expected.has(normalized)) {
      return failure(
        "SELECTED_CATALOG_TARGET_DUPLICATE",
        "selected catalog lock contains duplicate target paths",
        entry.target_path,
      );
    }
    expected.add(normalized);
    const source = entry.source_release_path.normalize("NFC").toLowerCase();
    if (sources.has(source)) {
      return failure(
        "SELECTED_CATALOG_SOURCE_DUPLICATE",
        "selected catalog lock contains duplicate source release paths",
        entry.source_release_path,
      );
    }
    sources.add(source);
  }
  return success(expected);
}

export async function verifySelectedCatalogLock(
  targetRoot: URL,
): Promise<RuntimeResult<SelectedCatalogVerificationReport>> {
  if (targetRoot.protocol !== "file:") {
    return failure(
      "PATH_ROOT_INVALID",
      "selected catalog target root must be a file URL",
    );
  }
  const loaded = await readLock(targetRoot);
  if (!loaded.ok) return loaded;
  const integrity = validateLockIntegrity(loaded.value.lock, loaded.value.bytes);
  if (!integrity.ok) return integrity;
  const expectedKeys = validateEntrySet(loaded.value.lock);
  if (!expectedKeys.ok) return expectedKeys;

  const sourceFiles = await walkOwnedNamespace(
    targetRoot,
    SELECTED_CATALOG_SOURCE_ROOT.slice(0, -1),
  );
  if (!sourceFiles.ok) return sourceFiles;
  const schemaFiles = await walkOwnedNamespace(
    targetRoot,
    SELECTED_CATALOG_SCHEMA_ROOT.slice(0, -1),
  );
  if (!schemaFiles.ok) return schemaFiles;
  const actualPaths = [...sourceFiles.value, ...schemaFiles.value].sort(
    compareSelectedCatalogPath,
  );
  const actualKeys = new Map<string, string>();
  for (const actualPath of actualPaths) {
    const key = actualPath.normalize("NFC").toLowerCase();
    if (actualKeys.has(key)) {
      return failure(
        "SELECTED_CATALOG_TARGET_DUPLICATE",
        "compiler-owned namespace contains case-equivalent target paths",
        actualPath,
      );
    }
    actualKeys.set(key, actualPath);
  }
  for (const [key, actualPath] of actualKeys) {
    if (!expectedKeys.value.has(key)) {
      return failure(
        "SELECTED_CATALOG_UNLISTED_TARGET",
        "compiler-owned selected catalog namespace contains an unlisted file",
        actualPath,
      );
    }
  }
  for (const entry of loaded.value.lock.entries) {
    const key = entry.target_path.normalize("NFC").toLowerCase();
    if (!actualKeys.has(key)) {
      return failure(
        "SELECTED_CATALOG_TARGET_MISSING",
        "selected catalog lock target is missing",
        entry.target_path,
      );
    }
  }

  for (const entry of loaded.value.lock.entries) {
    const bytes = await readTargetBytes(
      targetRoot,
      entry.target_path,
      "SELECTED_CATALOG_TARGET_MISSING",
    );
    if (!bytes.ok) return bytes;
    if (bytes.value.byteLength !== entry.byte_length) {
      return failure(
        "SELECTED_CATALOG_TARGET_LENGTH_MISMATCH",
        "selected catalog target length does not match the lock",
        entry.target_path,
      );
    }
    if (sha256(bytes.value) !== entry.sha256) {
      return failure(
        "SELECTED_CATALOG_TARGET_HASH_MISMATCH",
        "selected catalog target hash does not match the lock",
        entry.target_path,
      );
    }
  }
  return success({
    valid: true,
    lock_hash: loaded.value.lock.lock_hash,
    checked_paths: [
      SELECTED_CATALOG_LOCK_PATH,
      ...loaded.value.lock.entries.map((entry) => entry.target_path),
    ].sort(compareSelectedCatalogPath),
    external_reads: [],
  });
}
