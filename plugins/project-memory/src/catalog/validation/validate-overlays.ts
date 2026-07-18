import type { RuntimeIssue } from "../../contracts/runtime-result.js";
import type {
  CompanionTaxonomyBinding,
  PatternTaxonomyBinding,
} from "../contracts/index.js";
import { catalogIssue, compareUtf8 } from "../issues.js";
import type { CatalogSource } from "../load-catalog.js";

function addIntersections(
  issues: RuntimeIssue[],
  path: string,
  left: readonly string[],
  right: readonly string[],
): void {
  const rightSet = new Set(right);
  const shared = [...new Set(left.filter((id) => rightSet.has(id)))].sort(
    compareUtf8,
  );
  for (const id of shared) {
    issues.push(
      catalogIssue(
        "CATALOG_OVERLAY_CONFLICT",
        path,
        `overlay ${id} is both required or active and forbidden`,
        [id],
      ),
    );
  }
}

function validateTaxonomyOverlays(
  issues: RuntimeIssue[],
  id: string,
  taxonomy: PatternTaxonomyBinding | CompanionTaxonomyBinding,
): void {
  addIntersections(
    issues,
    `taxonomy/${id}/compatibility`,
    taxonomy.compatibility.required_overlays,
    taxonomy.compatibility.forbidden_overlays,
  );
  addIntersections(
    issues,
    `taxonomy/${id}/overlay_applicability`,
    [
      ...taxonomy.overlay_applicability.baked,
      ...taxonomy.overlay_applicability.allowed,
    ],
    taxonomy.overlay_applicability.forbidden,
  );
}

export function validateCatalogOverlays(
  source: CatalogSource,
): readonly RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];
  for (const overlay of source.overlays.values()) {
    addIntersections(
      issues,
      `overlays/${overlay.id}`,
      overlay.requires_overlays,
      overlay.conflicts_with,
    );
  }
  for (const blueprint of source.blueprints.values()) {
    addIntersections(
      issues,
      `blueprints/${blueprint.id}/overlays`,
      [...blueprint.overlays.baked, ...blueprint.overlays.defaults],
      blueprint.overlays.forbidden,
    );
  }
  for (const [id, taxonomy] of source.pattern_taxonomy) {
    validateTaxonomyOverlays(issues, id, taxonomy);
  }
  for (const [id, taxonomy] of source.companion_taxonomy) {
    validateTaxonomyOverlays(issues, id, taxonomy);
  }
  return issues;
}
