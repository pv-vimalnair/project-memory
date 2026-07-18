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
import { SignalSelectionSchema } from "./signals.js";

export const BlueprintGroupDefinitionSchema = catalogSchema("project-memory/v1/blueprint-group-definition", Type.Object(
  {
    id: Type.String({ pattern: "^blueprint-group[.][a-z][a-z0-9-]*$" }),
    version: SemVerSchema,
    status: DefinitionStatusSchema,
    name: NonEmptyStringSchema,
    purpose: NonEmptyStringSchema,
    primary_archetype: PrimaryArchetypeSchema,
    allowed_root_kinds: Type.Array(RootKindSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    blueprint_ids: Type.Array(DefinitionIdSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
));

const BlueprintOverlaysSchema = Type.Object(
  {
    baked: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    defaults: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    forbidden: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
  },
  { additionalProperties: false },
);

export const BlueprintDefinitionSchema = catalogSchema("project-memory/v1/blueprint-definition", Type.Object(
  {
    id: DefinitionIdSchema,
    version: SemVerSchema,
    status: DefinitionStatusSchema,
    group_id: Type.String({
      pattern: "^blueprint-group[.][a-z][a-z0-9-]*$",
    }),
    allowed_root_kinds: Type.Array(RootKindSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    primary_archetype: PrimaryArchetypeSchema,
    purpose: NonEmptyStringSchema,
    selection: SignalSelectionSchema,
    overlays: BlueprintOverlaysSchema,
    default_components: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    default_domains: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    adapter_slots: NonEmptyStringListSchema,
    required_documents: NonEmptyStringListSchema,
    validation_gates: NonEmptyStringListSchema,
    positive_examples: Type.Array(NonEmptyStringSchema, { minItems: 1 }),
    negative_examples: Type.Array(NonEmptyStringSchema, { minItems: 1 }),
    name: Type.Optional(NonEmptyStringSchema),
    inclusion_boundary: Type.Optional(NonEmptyStringSchema),
    exclusion_boundary: Type.Optional(NonEmptyStringSchema),
    replacement_id: Type.Optional(DefinitionIdSchema),
    migration_notes: Type.Optional(NonEmptyStringSchema),
  },
  { additionalProperties: false },
));

export type BlueprintGroupDefinition = Static<
  typeof BlueprintGroupDefinitionSchema
>;
export type BlueprintDefinition = Static<typeof BlueprintDefinitionSchema>;
