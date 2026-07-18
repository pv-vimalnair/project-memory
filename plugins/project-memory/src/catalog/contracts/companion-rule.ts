import { Type, type Static } from "@sinclair/typebox";

import {
  catalogSchema,
  CompanionIdSchema,
  CompatibilitySchema,
  ComponentImpactSchema,
  DomainImpactSchema,
  OverlayApplicabilitySchema,
  SemVerSchema,
} from "./common.js";

export const CompanionTaxonomyBindingSchema = catalogSchema("project-memory/v1/companion-taxonomy", Type.Object(
  {
    rule_id: CompanionIdSchema,
    rule_version: SemVerSchema,
    compatibility: CompatibilitySchema,
    overlay_applicability: OverlayApplicabilitySchema,
    component_impacts: Type.Array(ComponentImpactSchema),
    domain_impacts: Type.Array(DomainImpactSchema),
  },
  { additionalProperties: false },
));

export type CompanionTaxonomyBinding = Static<
  typeof CompanionTaxonomyBindingSchema
>;
