import { Type, type Static } from "@sinclair/typebox";

import {
  catalogSchema,
  DefinitionIdSchema,
  DefinitionStatusSchema,
  NonEmptyStringListSchema,
  NonEmptyStringSchema,
  PrimaryArchetypeSchema,
  RootKindSchema,
  SemVerSchema,
} from "./common.js";

export const OverlayDefinitionSchema = catalogSchema("project-memory/v1/overlay-definition", Type.Object(
  {
    id: Type.String({
      pattern: "^overlay[.][a-z][a-z0-9-]*[.][a-z][a-z0-9-]*$",
    }),
    version: SemVerSchema,
    status: DefinitionStatusSchema,
    name: NonEmptyStringSchema,
    category: NonEmptyStringSchema,
    purpose: NonEmptyStringSchema,
    inclusion_boundary: NonEmptyStringSchema,
    exclusion_boundary: NonEmptyStringSchema,
    compatible_root_kinds: Type.Array(RootKindSchema, { uniqueItems: true }),
    compatible_archetypes: Type.Array(PrimaryArchetypeSchema, {
      uniqueItems: true,
    }),
    requires_overlays: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    conflicts_with: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    default_components: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    default_domains: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    required_documents: NonEmptyStringListSchema,
    required_records: NonEmptyStringListSchema,
    tags: NonEmptyStringListSchema,
    positive_examples: Type.Array(NonEmptyStringSchema, { minItems: 1 }),
    negative_examples: Type.Array(NonEmptyStringSchema, { minItems: 1 }),
    replacement_id: Type.Optional(DefinitionIdSchema),
    migration_notes: Type.Optional(NonEmptyStringSchema),
  },
  { additionalProperties: false },
));

export type OverlayDefinition = Static<typeof OverlayDefinitionSchema>;
