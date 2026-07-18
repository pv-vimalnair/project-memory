import {
  failureFromIssues,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import { compareUtf8, sortCatalogIssues } from "../issues.js";
import type { CatalogSource } from "../load-catalog.js";
import { validateCatalogCompatibility } from "./validate-compatibility.js";
import { validateCatalogCounts } from "./validate-counts.js";
import { validateCatalogFixtures } from "./validate-fixtures.js";
import { validateCatalogIds } from "./validate-ids.js";
import { validateCatalogOverlays } from "./validate-overlays.js";
import { validatePatternBijection } from "./validate-pattern-bijection.js";
import { validateCatalogReferences } from "./validate-references.js";

export interface CatalogValidationOptions {
  readonly strict?: boolean;
}

export interface CatalogValidationReport {
  readonly valid: true;
  readonly strict: boolean;
  readonly checked_ids: readonly string[];
  readonly issues: readonly RuntimeIssue[];
}

function checkedIds(source: CatalogSource): readonly string[] {
  return [
    ...new Set([
      ...source.blueprint_groups.keys(),
      ...source.blueprints.keys(),
      ...source.components.keys(),
      ...source.domains.keys(),
      ...source.overlays.keys(),
      ...source.adapters.keys(),
      ...source.pattern_cores.keys(),
      ...source.pattern_taxonomy.keys(),
      ...source.companion_cores.keys(),
      ...source.companion_taxonomy.keys(),
      ...source.fixtures.keys(),
      ...source.inventories.keys(),
      ...(source.manifest === null ? [] : [source.manifest.id]),
    ]),
  ].sort(compareUtf8);
}

export function validateCatalog(
  source: CatalogSource,
  options: CatalogValidationOptions = {},
): RuntimeResult<CatalogValidationReport> {
  const strict = options.strict ?? true;
  const issues: RuntimeIssue[] = [
    ...validateCatalogIds(source),
    ...validateCatalogReferences(source),
    ...validateCatalogCompatibility(source),
    ...validatePatternBijection(source, { strict }),
    ...validateCatalogOverlays(source),
    ...validateCatalogFixtures(source),
    ...(strict ? validateCatalogCounts(source) : []),
  ];
  if (issues.length > 0) {
    return failureFromIssues(sortCatalogIssues(issues));
  }
  return success({
    valid: true,
    strict,
    checked_ids: checkedIds(source),
    issues: [],
  });
}
