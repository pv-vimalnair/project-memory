import { readFile } from "node:fs/promises";

import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import { canonicalJson } from "../../core/canonical-json.js";
import { sha256 } from "../../core/hash.js";
import { resolveInside } from "../../core/path-safety.js";
import { validateWithSchema } from "../../schema/validate.js";
import type {
  CatalogReleaseLock,
  CatalogReleaseVerification,
} from "../contracts/index.js";
import { compareUtf8 } from "../issues.js";
import {
  catalogChecksums,
  catalogReleaseHash,
} from "./build-catalog-bundle.js";

async function readReleaseFile(
  root: URL,
  relativePath: string,
): Promise<RuntimeResult<Uint8Array>> {
  const resolved = await resolveInside(root, relativePath);
  if (!resolved.ok) return resolved;
  try {
    return success(new Uint8Array(await readFile(resolved.value)));
  } catch (error: unknown) {
    return failure(
      "CATALOG_RELEASE_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
}

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

export async function verifyCatalogRelease(
  releaseRoot: URL,
  suppliedLock: CatalogReleaseLock,
  sourceRoot?: URL,
): Promise<RuntimeResult<CatalogReleaseVerification>> {
  const validated = validateWithSchema<CatalogReleaseLock>(
    "project-memory/v1/catalog-release-lock",
    suppliedLock,
  );
  if (!validated.ok) return validated;
  const lock = validated.value;
  const expectedReleaseHash = catalogReleaseHash(lock);
  if (lock.release_hash !== expectedReleaseHash) {
    return failure(
      "CATALOG_RELEASE_HASH_MISMATCH",
      "catalog release hash does not match lock contents",
      "catalog.lock.json",
    );
  }

  const lockFile = await readReleaseFile(releaseRoot, "catalog.lock.json");
  if (!lockFile.ok) return lockFile;
  const expectedLockBytes = new Uint8Array(
    Buffer.from(canonicalJson(lock), "utf8"),
  );
  if (!byteEqual(lockFile.value, expectedLockBytes)) {
    return failure(
      "CATALOG_RELEASE_LOCK_MISMATCH",
      "catalog lock bytes are not canonical or do not match the supplied lock",
      "catalog.lock.json",
    );
  }

  const checkedPaths = new Set<string>(["catalog.lock.json"]);
  let bundleBytes: Uint8Array | null = null;
  for (const entry of lock.generated_entries) {
    const bytes = await readReleaseFile(releaseRoot, entry.relative_path);
    if (!bytes.ok) return bytes;
    if (sha256(bytes.value) !== entry.sha256) {
      return failure(
        "CATALOG_RELEASE_ARTIFACT_HASH_MISMATCH",
        "generated release artifact hash does not match the lock",
        entry.relative_path,
      );
    }
    if (entry.relative_path === "catalog.bundle.json") {
      bundleBytes = bytes.value;
    }
    checkedPaths.add(entry.relative_path);
  }
  if (bundleBytes === null) {
    return failure(
      "CATALOG_RELEASE_BUNDLE_MISSING",
      "catalog lock has no generated bundle entry",
      "catalog.lock.json",
    );
  }

  if (sourceRoot !== undefined) {
    for (const entry of lock.source_entries) {
      const bytes = await readReleaseFile(sourceRoot, entry.relative_path);
      if (!bytes.ok) return bytes;
      if (sha256(bytes.value) !== entry.sha256) {
        return failure(
          "CATALOG_RELEASE_SOURCE_HASH_MISMATCH",
          "catalog source hash does not match the release lock",
          entry.relative_path,
        );
      }
      checkedPaths.add(`source:${entry.relative_path}`);
    }
  }

  const checksums = await readReleaseFile(releaseRoot, "SHA256SUMS");
  if (!checksums.ok) return checksums;
  const expectedChecksums = catalogChecksums(bundleBytes, lockFile.value);
  if (!byteEqual(checksums.value, expectedChecksums)) {
    return failure(
      "CATALOG_RELEASE_CHECKSUMS_MISMATCH",
      "SHA256SUMS does not match the bundle and lock bytes",
      "SHA256SUMS",
    );
  }
  checkedPaths.add("SHA256SUMS");

  return success({
    valid: true,
    release: lock.release,
    release_hash: lock.release_hash,
    checked_paths: [...checkedPaths].sort(compareUtf8),
  });
}
