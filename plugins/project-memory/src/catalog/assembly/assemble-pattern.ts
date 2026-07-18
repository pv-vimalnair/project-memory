import {
  failure,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import { validateWithSchema } from "../../schema/validate.js";
import {
  PatternCoreDefinitionSchema,
  type PatternCoreDefinition,
} from "../../selection/contracts/core.js";
import type { ResolvedPattern } from "../../selection/contracts/resolved.js";
import {
  PatternTaxonomyBindingSchema,
  type PatternTaxonomyBinding,
} from "../contracts/index.js";
import { guardHalfFields } from "./assembly-guards.js";

const CORE_FIELDS = new Set(Object.keys(PatternCoreDefinitionSchema.properties));
const TAXONOMY_FIELDS = new Set(
  Object.keys(PatternTaxonomyBindingSchema.properties),
);

export function assemblePatternDefinition(
  core: PatternCoreDefinition,
  taxonomy: PatternTaxonomyBinding,
): RuntimeResult<ResolvedPattern> {
  const guarded = guardHalfFields(
    core,
    taxonomy,
    CORE_FIELDS,
    TAXONOMY_FIELDS,
    core.id,
  );
  if (guarded !== undefined && !guarded.ok) return guarded;
  if (core.id !== taxonomy.pattern_id) {
    return failure(
      "CATALOG_HALF_ID_MISMATCH",
      `pattern core ${core.id} cannot pair with taxonomy ${taxonomy.pattern_id}`,
      core.id,
      [taxonomy.pattern_id],
    );
  }
  if (core.version !== taxonomy.pattern_version) {
    return failure(
      "CATALOG_HALF_VERSION_MISMATCH",
      `pattern ${core.id} has core ${core.version} and taxonomy ${taxonomy.pattern_version}`,
      core.id,
      [core.version, taxonomy.pattern_version],
    );
  }
  return validateWithSchema<ResolvedPattern>(
    "project-memory/v1/resolved-pattern",
    {
      ...core,
      compatibility: taxonomy.compatibility,
      overlay_applicability: taxonomy.overlay_applicability,
      component_impacts: taxonomy.component_impacts,
      domain_impacts: taxonomy.domain_impacts,
    },
  );
}
