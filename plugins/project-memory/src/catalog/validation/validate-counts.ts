import type { RuntimeIssue } from "../../contracts/runtime-result.js";
import type { CatalogSource } from "../load-catalog.js";
import { catalogIssue, compareUtf8 } from "../issues.js";

export const EXPECTED_CATALOG_COUNTS = Object.freeze({
  blueprint_groups: 11,
  blueprints: 62,
  pattern_families: 16,
  patterns: 257,
  companion_rules: 13,
});

function patternFamilyCount(source: CatalogSource): number {
  return new Set(
    [...source.pattern_cores.keys()]
      .map((id) => id.split(".")[0])
      .filter((family): family is string => family !== undefined),
  ).size;
}

export function validateCatalogCounts(
  source: CatalogSource,
): readonly RuntimeIssue[] {
  const actual = {
    blueprint_groups: source.blueprint_groups.size,
    blueprints: source.blueprints.size,
    pattern_families: patternFamilyCount(source),
    patterns: source.pattern_cores.size,
    companion_rules: source.companion_cores.size,
  };
  const issues: RuntimeIssue[] = [];
  for (const key of Object.keys(EXPECTED_CATALOG_COUNTS).sort(compareUtf8) as (
    keyof typeof EXPECTED_CATALOG_COUNTS
  )[]) {
    if (actual[key] !== EXPECTED_CATALOG_COUNTS[key]) {
      issues.push(
        catalogIssue(
          "CATALOG_COUNT_MISMATCH",
          `counts/${key}`,
          `expected ${String(EXPECTED_CATALOG_COUNTS[key])}, found ${String(actual[key])}`,
        ),
      );
    }
    const manifestCount = source.manifest?.expected_counts[key];
    if (
      manifestCount !== undefined &&
      manifestCount !== EXPECTED_CATALOG_COUNTS[key]
    ) {
      issues.push(
        catalogIssue(
          "CATALOG_MANIFEST_COUNT_LOCK_MISMATCH",
          `manifest/expected_counts/${key}`,
          `manifest count ${String(manifestCount)} violates the v1 lock`,
        ),
      );
    }
  }
  return issues;
}
