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

export const AdapterDefinitionSchema = catalogSchema("project-memory/v1/adapter-definition", Type.Object(
  {
    id: Type.String({ pattern: "^adapter[.][a-z][a-z0-9-]*$" }),
    version: SemVerSchema,
    status: DefinitionStatusSchema,
    name: NonEmptyStringSchema,
    kind: Type.Union([
      Type.Literal("agent"),
      Type.Literal("runtime"),
      Type.Literal("workflow"),
    ]),
    purpose: NonEmptyStringSchema,
    inclusion_boundary: NonEmptyStringSchema,
    exclusion_boundary: NonEmptyStringSchema,
    compatible_root_kinds: Type.Array(RootKindSchema, { uniqueItems: true }),
    compatible_archetypes: Type.Array(PrimaryArchetypeSchema, {
      uniqueItems: true,
    }),
    detection_signals: NonEmptyStringListSchema,
    relevant_files: NonEmptyStringListSchema,
    repository_conventions: NonEmptyStringListSchema,
    supported_commands: NonEmptyStringListSchema,
    validation_gates: NonEmptyStringListSchema,
    default_components: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    default_domains: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    required_documents: NonEmptyStringListSchema,
    required_records: NonEmptyStringListSchema,
    risks: NonEmptyStringListSchema,
    handoff_fields: NonEmptyStringListSchema,
    tags: NonEmptyStringListSchema,
    positive_examples: Type.Array(NonEmptyStringSchema, { minItems: 1 }),
    negative_examples: Type.Array(NonEmptyStringSchema, { minItems: 1 }),
    replacement_id: Type.Optional(DefinitionIdSchema),
    migration_notes: Type.Optional(NonEmptyStringSchema),
  },
  { additionalProperties: false },
));

export type AdapterDefinition = Static<typeof AdapterDefinitionSchema>;
