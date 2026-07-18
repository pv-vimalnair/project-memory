import { gt, major, minor, patch, valid } from "semver";

import {
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import type { CatalogReleaseLock } from "../contracts/index.js";

export type CatalogReleaseChange = "patch" | "minor" | "major" | "invalid";

function declaredChange(
  previous: string,
  next: string,
): CatalogReleaseChange {
  if (valid(previous) === null || valid(next) === null || !gt(next, previous)) {
    return "invalid";
  }
  if (major(next) > major(previous)) return "major";
  if (minor(next) > minor(previous)) return "minor";
  if (patch(next) > patch(previous)) return "patch";
  return "invalid";
}

function entryMap(lock: CatalogReleaseLock) {
  return new Map(
    [...lock.source_entries, ...lock.generated_entries].map((entry) => [
      entry.relative_path,
      entry,
    ]),
  );
}

function requiredChange(
  previous: CatalogReleaseLock,
  next: CatalogReleaseLock,
): CatalogReleaseChange {
  const before = entryMap(previous);
  const after = entryMap(next);
  let additiveDefinition = false;
  let patchChange = false;
  for (const [relativePath, entry] of before) {
    const nextEntry = after.get(relativePath);
    if (nextEntry === undefined) return "major";
    if (entry.sha256 !== nextEntry.sha256) {
      if (
        entry.definition_id !== null ||
        entry.schema_id !== null ||
        relativePath.startsWith("patterns/") ||
        relativePath.startsWith("blueprints/") ||
        relativePath.startsWith("companion-rules/")
      ) {
        return "major";
      }
      patchChange = true;
    }
  }
  for (const [relativePath, entry] of after) {
    if (before.has(relativePath)) continue;
    if (entry.definition_id !== null || entry.schema_id !== null) {
      additiveDefinition = true;
    } else {
      patchChange = true;
    }
  }
  if (additiveDefinition) return "minor";
  return patchChange ? "patch" : "invalid";
}

export function compareCatalogReleases(
  previous: CatalogReleaseLock,
  next: CatalogReleaseLock,
): RuntimeResult<CatalogReleaseChange> {
  const required = requiredChange(previous, next);
  const declared = declaredChange(previous.release, next.release);
  return success(required === declared ? required : "invalid");
}
