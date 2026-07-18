import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import { validateWithSchema } from "../schema/validate.js";
import type { ResolvedCatalogSelection } from "./catalog-selection-resolver.js";
import {
  SelectedCatalogLockSchema,
  type CatalogSourceKind,
  type SelectedCatalogLock,
  type SelectedCatalogLockEntry,
} from "./contracts/index.js";

export const SELECTED_CATALOG_LOCK_PATH = "docs/project-memory/catalog.lock.json";
export const SELECTED_CATALOG_SOURCE_ROOT =
  "docs/project-memory/catalog/selected/";
export const SELECTED_CATALOG_SCHEMA_ROOT = "schemas/project-memory/v1/";

export function compareSelectedCatalogPath(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

export function selectedCatalogLockHash(
  lock: Omit<SelectedCatalogLock, "lock_hash">,
): string {
  return sha256(canonicalJson(lock));
}

export function validateSelectedCatalogTarget(
  kind: CatalogSourceKind,
  targetPath: string,
): RuntimeResult<true> {
  const expectedRoot =
    kind === "generated-schema"
      ? SELECTED_CATALOG_SCHEMA_ROOT
      : SELECTED_CATALOG_SOURCE_ROOT;
  if (!targetPath.startsWith(expectedRoot) || targetPath === expectedRoot) {
    return failure(
      "SELECTED_CATALOG_TARGET_NAMESPACE_INVALID",
      `${kind} must target ${expectedRoot}`,
      targetPath,
    );
  }
  return success(true);
}

function normalizedPathKey(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function validateHalves(
  entries: readonly SelectedCatalogLockEntry[],
  coreKind: "pattern-core" | "companion-core",
  taxonomyKind: "pattern-taxonomy" | "companion-taxonomy",
): RuntimeResult<true> {
  const coreIds = new Set(
    entries
      .filter((entry) => entry.kind === coreKind)
      .flatMap((entry) => entry.definition_ids),
  );
  const taxonomyIds = new Set(
    entries
      .filter((entry) => entry.kind === taxonomyKind)
      .flatMap((entry) => entry.definition_ids),
  );
  const ids = [...new Set([...coreIds, ...taxonomyIds])].sort(
    compareSelectedCatalogPath,
  );
  for (const id of ids) {
    if (!coreIds.has(id) || !taxonomyIds.has(id)) {
      return failure(
        "SELECTED_CATALOG_HALF_MISSING",
        `${id} must have both ${coreKind} and ${taxonomyKind} target bytes`,
        id,
      );
    }
  }
  return success(true);
}

export function validateSelectedCatalogLockStructure(
  entries: readonly SelectedCatalogLockEntry[],
): RuntimeResult<true> {
  const patternHalves = validateHalves(entries, "pattern-core", "pattern-taxonomy");
  if (!patternHalves.ok) return patternHalves;
  const companionHalves = validateHalves(
    entries,
    "companion-core",
    "companion-taxonomy",
  );
  if (!companionHalves.ok) return companionHalves;
  const requiredKinds: readonly CatalogSourceKind[] = [
    "blueprint",
    "definition-source",
    "pattern-core",
    "pattern-taxonomy",
    "companion-core",
    "companion-taxonomy",
    "generated-schema",
  ];
  for (const kind of requiredKinds) {
    if (!entries.some((entry) => entry.kind === kind)) {
      return failure(
        "SELECTED_CATALOG_REQUIRED_KIND_MISSING",
        `selected catalog has no ${kind} source bytes`,
        kind,
      );
    }
  }
  return success(true);
}

export function validateSelectedCatalogLockOrder(
  lock: SelectedCatalogLock,
): RuntimeResult<true> {
  const sorted = [...lock.entries].sort((left, right) =>
    compareSelectedCatalogPath(left.target_path, right.target_path),
  );
  for (let index = 0; index < lock.entries.length; index += 1) {
    const entry = lock.entries[index];
    if (entry === undefined || entry.target_path !== sorted[index]?.target_path) {
      return failure(
        "SELECTED_CATALOG_LOCK_ORDER_INVALID",
        "selected catalog lock entries must be sorted by target path",
        SELECTED_CATALOG_LOCK_PATH,
      );
    }
    const sortedIds = [...entry.definition_ids].sort(compareSelectedCatalogPath);
    if (entry.definition_ids.some((id, idIndex) => id !== sortedIds[idIndex])) {
      return failure(
        "SELECTED_CATALOG_LOCK_ORDER_INVALID",
        "selected catalog definition IDs must be sorted",
        entry.target_path,
      );
    }
  }
  return success(true);
}

export function buildSelectedCatalogLock(
  selection: ResolvedCatalogSelection,
): RuntimeResult<SelectedCatalogLock> {
  if (selection.files.length === 0) {
    return failure(
      "SELECTED_CATALOG_EMPTY",
      "resolved catalog selection has no source bytes",
    );
  }
  const targetPaths = new Set<string>();
  const sourcePaths = new Set<string>();
  const entries: SelectedCatalogLockEntry[] = [];
  for (const file of selection.files) {
    const namespace = validateSelectedCatalogTarget(
      file.kind,
      file.target_relative_path,
    );
    if (!namespace.ok) return namespace;
    const targetKey = normalizedPathKey(file.target_relative_path);
    if (targetPaths.has(targetKey)) {
      return failure(
        "SELECTED_CATALOG_TARGET_DUPLICATE",
        "resolved catalog contains duplicate final target paths",
        file.target_relative_path,
      );
    }
    targetPaths.add(targetKey);
    const sourceKey = normalizedPathKey(file.source_relative_path);
    if (sourcePaths.has(sourceKey)) {
      return failure(
        "SELECTED_CATALOG_SOURCE_DUPLICATE",
        "resolved catalog contains duplicate source release paths",
        file.source_relative_path,
      );
    }
    sourcePaths.add(sourceKey);
    const bytesHash = sha256(file.bytes);
    if (bytesHash !== file.sha256) {
      return failure(
        "SELECTED_CATALOG_SOURCE_HASH_MISMATCH",
        "resolved source hash does not match its exact bytes",
        file.source_relative_path,
      );
    }
    const definitionIds = [...file.definition_ids].sort(compareSelectedCatalogPath);
    if (new Set(definitionIds).size !== definitionIds.length) {
      return failure(
        "SELECTED_CATALOG_DEFINITION_ID_DUPLICATE",
        "source definition IDs must be unique",
        file.source_relative_path,
      );
    }
    entries.push({
      kind: file.kind,
      definition_ids: definitionIds,
      source_release_path: file.source_relative_path,
      target_path: file.target_relative_path,
      sha256: bytesHash,
      byte_length: file.bytes.byteLength,
    });
  }
  entries.sort((left, right) =>
    compareSelectedCatalogPath(left.target_path, right.target_path),
  );
  const structure = validateSelectedCatalogLockStructure(entries);
  if (!structure.ok) return structure;

  const withoutHash: Omit<SelectedCatalogLock, "lock_hash"> = {
    schema_version: "1.0.0",
    catalog_release: selection.release,
    source_release_hash: selection.release_hash,
    entries,
  };
  const lock: SelectedCatalogLock = {
    ...withoutHash,
    lock_hash: selectedCatalogLockHash(withoutHash),
  };
  return validateWithSchema<SelectedCatalogLock>(
    SelectedCatalogLockSchema.$id,
    lock,
  );
}
