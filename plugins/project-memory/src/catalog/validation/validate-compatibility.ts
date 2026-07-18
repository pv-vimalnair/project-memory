import type { RuntimeIssue } from "../../contracts/runtime-result.js";
import type {
  ComponentImpact,
  DomainImpact,
} from "../contracts/index.js";
import { catalogIssue } from "../issues.js";
import type { CatalogSource } from "../load-catalog.js";

function validateImpactAuthority(
  impact: ComponentImpact | DomainImpact,
  path: string,
): readonly RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];
  if (impact.duties.includes("modify") && impact.write_scope.length === 0) {
    issues.push(
      catalogIssue(
        "CATALOG_IMPACT_WRITE_SCOPE_REQUIRED",
        path,
        "modify duty requires a non-empty write scope",
      ),
    );
  }
  if (
    impact.duties.includes("approve") &&
    impact.responsible_role !== "integrator" &&
    impact.responsible_role !== "Pitaji"
  ) {
    issues.push(
      catalogIssue(
        "CATALOG_IMPACT_APPROVAL_AUTHORITY_INVALID",
        path,
        "approve duty requires integrator or Pitaji responsibility",
      ),
    );
  }
  if (
    impact.duties.includes("no-touch") &&
    impact.duties.some((duty) =>
      duty === "modify" || duty === "release" || duty === "notify"
    )
  ) {
    issues.push(
      catalogIssue(
        "CATALOG_IMPACT_NO_TOUCH_CONFLICT",
        path,
        "no-touch cannot coexist with modify, release, or notify",
      ),
    );
  }
  return issues;
}

export function validateCatalogCompatibility(
  source: CatalogSource,
): readonly RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];
  for (const blueprint of source.blueprints.values()) {
    const group = source.blueprint_groups.get(blueprint.group_id);
    if (group === undefined) continue;
    if (group.primary_archetype !== blueprint.primary_archetype) {
      issues.push(
        catalogIssue(
          "CATALOG_COMPATIBILITY_MISMATCH",
          `blueprints/${blueprint.id}/primary_archetype`,
          "blueprint archetype does not match its group",
          [group.id],
        ),
      );
    }
    for (const rootKind of blueprint.allowed_root_kinds) {
      if (!group.allowed_root_kinds.includes(rootKind)) {
        issues.push(
          catalogIssue(
            "CATALOG_COMPATIBILITY_MISMATCH",
            `blueprints/${blueprint.id}/allowed_root_kinds`,
            `root kind ${rootKind} is not allowed by ${group.id}`,
            [group.id, rootKind],
          ),
        );
      }
    }
  }
  for (const [id, taxonomy] of source.pattern_taxonomy) {
    for (const [index, impact] of taxonomy.component_impacts.entries()) {
      issues.push(...validateImpactAuthority(impact, `pattern-taxonomy/${id}/component_impacts/${String(index)}`));
    }
    for (const [index, impact] of taxonomy.domain_impacts.entries()) {
      issues.push(...validateImpactAuthority(impact, `pattern-taxonomy/${id}/domain_impacts/${String(index)}`));
    }
  }
  for (const [id, taxonomy] of source.companion_taxonomy) {
    for (const [index, impact] of taxonomy.component_impacts.entries()) {
      issues.push(...validateImpactAuthority(impact, `companion-taxonomy/${id}/component_impacts/${String(index)}`));
    }
    for (const [index, impact] of taxonomy.domain_impacts.entries()) {
      issues.push(...validateImpactAuthority(impact, `companion-taxonomy/${id}/domain_impacts/${String(index)}`));
    }
  }
  return issues;
}
