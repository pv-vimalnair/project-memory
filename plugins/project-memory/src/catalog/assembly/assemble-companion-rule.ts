import {
  failure,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import { validateWithSchema } from "../../schema/validate.js";
import {
  CompanionRuleCoreSchema,
  type CompanionRuleCore,
} from "../../selection/contracts/core.js";
import type { ResolvedCompanionRule } from "../../selection/contracts/resolved.js";
import {
  CompanionTaxonomyBindingSchema,
  type CompanionTaxonomyBinding,
} from "../contracts/index.js";
import { guardHalfFields } from "./assembly-guards.js";

const CORE_FIELDS = new Set(Object.keys(CompanionRuleCoreSchema.properties));
const TAXONOMY_FIELDS = new Set(
  Object.keys(CompanionTaxonomyBindingSchema.properties),
);

export function assembleCompanionRule(
  core: CompanionRuleCore,
  taxonomy: CompanionTaxonomyBinding,
): RuntimeResult<ResolvedCompanionRule> {
  const guarded = guardHalfFields(
    core,
    taxonomy,
    CORE_FIELDS,
    TAXONOMY_FIELDS,
    core.id,
  );
  if (guarded !== undefined && !guarded.ok) return guarded;
  if (core.id !== taxonomy.rule_id) {
    return failure(
      "CATALOG_HALF_ID_MISMATCH",
      `companion core ${core.id} cannot pair with taxonomy ${taxonomy.rule_id}`,
      core.id,
      [taxonomy.rule_id],
    );
  }
  if (core.version !== taxonomy.rule_version) {
    return failure(
      "CATALOG_HALF_VERSION_MISMATCH",
      `companion ${core.id} has core ${core.version} and taxonomy ${taxonomy.rule_version}`,
      core.id,
      [core.version, taxonomy.rule_version],
    );
  }
  return validateWithSchema<ResolvedCompanionRule>(
    "project-memory/v1/resolved-companion-rule",
    {
      ...core,
      compatibility: taxonomy.compatibility,
      overlay_applicability: taxonomy.overlay_applicability,
      component_impacts: taxonomy.component_impacts,
      domain_impacts: taxonomy.domain_impacts,
    },
  );
}
