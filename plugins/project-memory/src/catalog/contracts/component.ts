import { Type, type Static } from "@sinclair/typebox";

import {
  catalogSchema,
  ComponentTypeSchema,
  DefinitionIdSchema,
  DefinitionStatusSchema,
  NonEmptyStringListSchema,
  NonEmptyStringSchema,
  SemVerSchema,
} from "./common.js";

export const ComponentDefinitionSchema = catalogSchema("project-memory/v1/component-definition", Type.Object(
  {
    id: Type.String({ pattern: "^component[.][a-z][a-z0-9-]*$" }),
    version: SemVerSchema,
    status: DefinitionStatusSchema,
    name: NonEmptyStringSchema,
    type: ComponentTypeSchema,
    purpose: NonEmptyStringSchema,
    inclusion_boundary: NonEmptyStringSchema,
    exclusion_boundary: NonEmptyStringSchema,
    required_documents: NonEmptyStringListSchema,
    default_domains: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    tags: NonEmptyStringListSchema,
    positive_examples: Type.Array(NonEmptyStringSchema, { minItems: 1 }),
    negative_examples: Type.Array(NonEmptyStringSchema, { minItems: 1 }),
    replacement_id: Type.Optional(DefinitionIdSchema),
    migration_notes: Type.Optional(NonEmptyStringSchema),
  },
  { additionalProperties: false },
));

export type ComponentDefinition = Static<typeof ComponentDefinitionSchema>;
