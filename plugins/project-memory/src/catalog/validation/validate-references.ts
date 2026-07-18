import type { RuntimeIssue } from "../../contracts/runtime-result.js";
import type {
  CompanionTaxonomyBinding,
  PatternTaxonomyBinding,
} from "../contracts/index.js";
import { catalogIssue } from "../issues.js";
import type { CatalogSource } from "../load-catalog.js";

function requireKnown(
  issues: RuntimeIssue[],
  ownerPath: string,
  references: readonly string[],
  known: ReadonlyMap<string, unknown>,
): void {
  for (const reference of references) {
    if (!known.has(reference)) {
      issues.push(
        catalogIssue(
          "CATALOG_UNKNOWN_REFERENCE",
          ownerPath,
          `unknown reference ${reference}`,
          [reference],
        ),
      );
    }
  }
}

function validateTaxonomyReferences(
  issues: RuntimeIssue[],
  id: string,
  taxonomy: PatternTaxonomyBinding | CompanionTaxonomyBinding,
  source: CatalogSource,
): void {
  const prefix = `taxonomy/${id}`;
  requireKnown(
    issues,
    `${prefix}/compatibility/required_overlays`,
    taxonomy.compatibility.required_overlays,
    source.overlays,
  );
  requireKnown(
    issues,
    `${prefix}/compatibility/forbidden_overlays`,
    taxonomy.compatibility.forbidden_overlays,
    source.overlays,
  );
  requireKnown(
    issues,
    `${prefix}/overlay_applicability`,
    [
      ...taxonomy.overlay_applicability.baked,
      ...taxonomy.overlay_applicability.allowed,
      ...taxonomy.overlay_applicability.forbidden,
    ],
    source.overlays,
  );
  for (const impact of taxonomy.component_impacts) {
    if ("id" in impact.selector) {
      requireKnown(
        issues,
        `${prefix}/component_impacts`,
        [impact.selector.id],
        source.components,
      );
    }
  }
  for (const impact of taxonomy.domain_impacts) {
    if ("id" in impact.selector) {
      requireKnown(
        issues,
        `${prefix}/domain_impacts`,
        [impact.selector.id],
        source.domains,
      );
    }
  }
}

export function validateCatalogReferences(
  source: CatalogSource,
): readonly RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];
  for (const group of source.blueprint_groups.values()) {
    requireKnown(
      issues,
      `blueprint-groups/${group.id}/blueprint_ids`,
      group.blueprint_ids,
      source.blueprints,
    );
  }
  for (const blueprint of source.blueprints.values()) {
    requireKnown(
      issues,
      `blueprints/${blueprint.id}/group_id`,
      [blueprint.group_id],
      source.blueprint_groups,
    );
    requireKnown(
      issues,
      `blueprints/${blueprint.id}/default_components`,
      blueprint.default_components,
      source.components,
    );
    requireKnown(
      issues,
      `blueprints/${blueprint.id}/default_domains`,
      blueprint.default_domains,
      source.domains,
    );
    requireKnown(
      issues,
      `blueprints/${blueprint.id}/overlays`,
      [
        ...blueprint.overlays.baked,
        ...blueprint.overlays.defaults,
        ...blueprint.overlays.forbidden,
      ],
      source.overlays,
    );
  }
  for (const component of source.components.values()) {
    requireKnown(
      issues,
      `components/${component.id}/default_domains`,
      component.default_domains,
      source.domains,
    );
  }
  for (const domain of source.domains.values()) {
    requireKnown(
      issues,
      `domains/${domain.id}/default_components`,
      domain.default_components,
      source.components,
    );
  }
  for (const overlay of source.overlays.values()) {
    requireKnown(
      issues,
      `overlays/${overlay.id}/overlays`,
      [...overlay.requires_overlays, ...overlay.conflicts_with],
      source.overlays,
    );
    requireKnown(
      issues,
      `overlays/${overlay.id}/default_components`,
      overlay.default_components,
      source.components,
    );
    requireKnown(
      issues,
      `overlays/${overlay.id}/default_domains`,
      overlay.default_domains,
      source.domains,
    );
  }
  for (const adapter of source.adapters.values()) {
    requireKnown(
      issues,
      `adapters/${adapter.id}/default_components`,
      adapter.default_components,
      source.components,
    );
    requireKnown(
      issues,
      `adapters/${adapter.id}/default_domains`,
      adapter.default_domains,
      source.domains,
    );
  }
  for (const pattern of source.pattern_cores.values()) {
    requireKnown(
      issues,
      `pattern-cores/${pattern.id}/composition/patterns`,
      [
        ...pattern.composition.allowed_primary_pattern_ids,
        ...pattern.composition.incompatible_pattern_ids,
      ],
      source.pattern_cores,
    );
    requireKnown(
      issues,
      `pattern-cores/${pattern.id}/composition/companions`,
      pattern.composition.mandatory_companion_rule_ids,
      source.companion_cores,
    );
  }
  for (const companion of source.companion_cores.values()) {
    requireKnown(
      issues,
      `companion-cores/${companion.id}/require_patterns`,
      companion.require_patterns.map((required) => required.id),
      source.pattern_cores,
    );
  }
  for (const [id, taxonomy] of source.pattern_taxonomy) {
    validateTaxonomyReferences(issues, id, taxonomy, source);
  }
  for (const [id, taxonomy] of source.companion_taxonomy) {
    validateTaxonomyReferences(issues, id, taxonomy, source);
  }
  for (const fixture of source.fixtures.values()) {
    const expected = fixture.expected;
    requireKnown(
      issues,
      `fixtures/${fixture.id}/expected`,
      [
        ...(expected.blueprint_id === undefined ? [] : [expected.blueprint_id]),
        ...(expected.prohibited_blueprint_ids ?? []),
      ],
      source.blueprints,
    );
  }
  return issues;
}
