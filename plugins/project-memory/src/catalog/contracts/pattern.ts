import { Type, type Static } from "@sinclair/typebox";

import {
  catalogSchema,
  CompatibilitySchema,
  ComponentImpactSchema,
  DomainImpactSchema,
  OverlayApplicabilitySchema,
  PatternIdSchema,
  SemVerSchema,
} from "./common.js";

export const PatternTaxonomyBindingSchema = catalogSchema("project-memory/v1/pattern-taxonomy", Type.Object(
  {
    pattern_id: PatternIdSchema,
    pattern_version: SemVerSchema,
    compatibility: CompatibilitySchema,
    overlay_applicability: OverlayApplicabilitySchema,
    component_impacts: Type.Array(ComponentImpactSchema),
    domain_impacts: Type.Array(DomainImpactSchema),
  },
  { additionalProperties: false },
));

export type PatternTaxonomyBinding = Static<
  typeof PatternTaxonomyBindingSchema
>;
