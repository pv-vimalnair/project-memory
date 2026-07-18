import { Type, type Static } from "@sinclair/typebox";

import {
  DefinitionIdSchema,
  PrimaryArchetypeSchema,
  RootKindSchema,
  SemVerSchema,
} from "../../catalog/contracts/common.js";
import {
  InstanceIdSchema,
  LifecycleSchema,
  NonBlankStringListSchema,
  NonBlankStringSchema,
  RootNamespaceSchema,
  SafeRelativePathSchema,
  Sha256Schema,
  SlugSchema,
  profileSchema,
} from "./project-selection.js";
import { RootRelationshipValueSchema } from "./root-relationships.js";

const CatalogReferenceKindSchema = Type.Union([
  Type.Literal("blueprint"),
  Type.Literal("overlay"),
  Type.Literal("component"),
  Type.Literal("domain"),
  Type.Literal("adapter"),
  Type.Literal("pattern"),
  Type.Literal("companion"),
  Type.Literal("template"),
  Type.Literal("gate"),
  Type.Literal("policy"),
]);

export const LockedDefinitionSchema = Type.Object(
  {
    kind: CatalogReferenceKindSchema,
    id: DefinitionIdSchema,
    version: SemVerSchema,
    target_path: SafeRelativePathSchema,
    target_sha256: Sha256Schema,
  },
  { additionalProperties: false },
);

export const ResolvedRuleSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("pattern"), Type.Literal("companion")]),
    id: DefinitionIdSchema,
    version: SemVerSchema,
    target_path: SafeRelativePathSchema,
    target_sha256: Sha256Schema,
  },
  { additionalProperties: false },
);

export const ResolvedGateExecutionSchema = Type.Object(
  {
    id: NonBlankStringSchema,
    source_definition_ids: Type.Array(DefinitionIdSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    commands: NonBlankStringListSchema,
    required_evidence: NonBlankStringListSchema,
  },
  { additionalProperties: false },
);

export const ResolvedTemplateSchema = Type.Object(
  {
    id: DefinitionIdSchema,
    version: SemVerSchema,
    target_path: SafeRelativePathSchema,
    target_sha256: Sha256Schema,
  },
  { additionalProperties: false },
);

export const ResolvedComponentInstanceSchema = Type.Object(
  {
    instance_id: InstanceIdSchema("CMP"),
    definition_id: DefinitionIdSchema,
    definition_version: SemVerSchema,
    definition_target_path: SafeRelativePathSchema,
    definition_target_sha256: Sha256Schema,
    slug: SlugSchema,
    required_domains: Type.Array(InstanceIdSchema("DOM"), {
      uniqueItems: true,
    }),
    rules: Type.Array(ResolvedRuleSchema, { uniqueItems: true }),
    gates: Type.Array(ResolvedGateExecutionSchema, { uniqueItems: true }),
  },
  { additionalProperties: false },
);

export const ResolvedDomainInstanceSchema = Type.Object(
  {
    instance_id: InstanceIdSchema("DOM"),
    definition_id: DefinitionIdSchema,
    definition_version: SemVerSchema,
    definition_target_path: SafeRelativePathSchema,
    definition_target_sha256: Sha256Schema,
    slug: SlugSchema,
    required_components: Type.Array(InstanceIdSchema("CMP"), {
      uniqueItems: true,
    }),
    rules: Type.Array(ResolvedRuleSchema, { uniqueItems: true }),
    gates: Type.Array(ResolvedGateExecutionSchema, { uniqueItems: true }),
  },
  { additionalProperties: false },
);

export const ResolvedAdapterSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("agent"),
      Type.Literal("runtime"),
      Type.Literal("workflow"),
    ]),
    definition_id: DefinitionIdSchema,
    definition_version: SemVerSchema,
    definition_target_path: SafeRelativePathSchema,
    definition_target_sha256: Sha256Schema,
  },
  { additionalProperties: false },
);

function resolvedProfileValueSchema() {
  return Type.Object(
    {
      schema_version: Type.Literal("1.0.0"),
      root: Type.Object(
        {
          id: InstanceIdSchema("ROOT"),
          namespace: RootNamespaceSchema,
          kind: RootKindSchema,
          primary_archetype: PrimaryArchetypeSchema,
          lifecycle: LifecycleSchema,
        },
        { additionalProperties: false },
      ),
      blueprint: LockedDefinitionSchema,
      overlays: Type.Array(LockedDefinitionSchema, { uniqueItems: true }),
      components: Type.Array(ResolvedComponentInstanceSchema, {
        minItems: 1,
        uniqueItems: true,
      }),
      domains: Type.Array(ResolvedDomainInstanceSchema, {
        minItems: 1,
        uniqueItems: true,
      }),
      adapters: Type.Array(ResolvedAdapterSchema, { uniqueItems: true }),
      rules: Type.Array(ResolvedRuleSchema, { uniqueItems: true }),
      gates: Type.Array(ResolvedGateExecutionSchema, { uniqueItems: true }),
      templates: Type.Array(ResolvedTemplateSchema, { uniqueItems: true }),
      root_relationships: Type.Array(RootRelationshipValueSchema, {
        uniqueItems: true,
      }),
      catalog: Type.Object(
        {
          release: SemVerSchema,
          release_hash: Sha256Schema,
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  );
}

export const ResolvedProfileValueSchema = resolvedProfileValueSchema();
export const ResolvedProfileSchema = profileSchema(
  "project-memory/v1/resolved-profile",
  resolvedProfileValueSchema(),
);

export type LockedDefinition = Static<typeof LockedDefinitionSchema>;
export type ResolvedRule = Static<typeof ResolvedRuleSchema>;
export type ResolvedGateExecution = Static<
  typeof ResolvedGateExecutionSchema
>;
export type ResolvedTemplate = Static<typeof ResolvedTemplateSchema>;
export type ResolvedComponentInstance = Static<
  typeof ResolvedComponentInstanceSchema
>;
export type ResolvedDomainInstance = Static<
  typeof ResolvedDomainInstanceSchema
>;
export type ResolvedAdapter = Static<typeof ResolvedAdapterSchema>;
export type ResolvedProfile = Static<typeof ResolvedProfileValueSchema>;