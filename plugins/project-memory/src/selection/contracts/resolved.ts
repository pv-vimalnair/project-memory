import { Type, type Static } from "@sinclair/typebox";

import {
  CompanionTaxonomyBindingSchema,
  PatternTaxonomyBindingSchema,
} from "../../catalog/contracts/index.js";
import {
  CompanionRuleCoreSchema,
  ownedSchema,
  PatternCoreDefinitionSchema,
} from "./core.js";

export const ResolvedPatternSchema = ownedSchema(
  "project-memory/v1/resolved-pattern",
  Type.Object(
    {
      ...PatternCoreDefinitionSchema.properties,
      compatibility:
        PatternTaxonomyBindingSchema.properties.compatibility,
      overlay_applicability:
        PatternTaxonomyBindingSchema.properties.overlay_applicability,
      component_impacts:
        PatternTaxonomyBindingSchema.properties.component_impacts,
      domain_impacts:
        PatternTaxonomyBindingSchema.properties.domain_impacts,
    },
    { additionalProperties: false },
  ),
);

export const ResolvedCompanionRuleSchema = ownedSchema(
  "project-memory/v1/resolved-companion-rule",
  Type.Object(
    {
      ...CompanionRuleCoreSchema.properties,
      compatibility:
        CompanionTaxonomyBindingSchema.properties.compatibility,
      overlay_applicability:
        CompanionTaxonomyBindingSchema.properties.overlay_applicability,
      component_impacts:
        CompanionTaxonomyBindingSchema.properties.component_impacts,
      domain_impacts:
        CompanionTaxonomyBindingSchema.properties.domain_impacts,
    },
    { additionalProperties: false },
  ),
);

export type ResolvedPattern = Static<typeof ResolvedPatternSchema>;
export type ResolvedCompanionRule = Static<
  typeof ResolvedCompanionRuleSchema
>;
