import { Type, type Static, type TSchema } from "@sinclair/typebox";

import {
  DefinitionIdSchema,
  PrimaryArchetypeSchema,
  RootKindSchema,
  SemVerSchema,
} from "../../catalog/contracts/common.js";

export function profileSchema<const TId extends string, T extends TSchema>(
  id: TId,
  schema: T,
): T & { readonly $id: TId } {
  return Object.assign(schema, { $id: id });
}

export function InstanceIdSchema(prefix: string) {
  return Type.String({
    pattern: `^${prefix}-[0-9A-HJKMNP-TV-Z]{26}$`,
  });
}

export const NonBlankStringSchema = Type.String({
  minLength: 1,
  pattern: "\\S",
});
export const RepositoryLocatorSchema = Type.String({
  minLength: 1,
  pattern: "^(?![A-Za-z]:[\\\\/])(?!/)(?!file:)(?=.*\\S).+$",
});
export const NonBlankStringListSchema = Type.Array(NonBlankStringSchema, {
  uniqueItems: true,
});
export const Sha256Schema = Type.String({ format: "sha256" });
export const UtcTimestampSchema = Type.String({ format: "utc-timestamp" });
export const SafeRelativePathSchema = Type.String({
  format: "safe-relative-path",
  minLength: 1,
});
export const RootNamespaceSchema = Type.String({
  pattern: "^[a-z0-9]+(?:[.-][a-z0-9]+)*$",
  minLength: 3,
  maxLength: 160,
});
export const SlugSchema = Type.String({
  pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  minLength: 1,
  maxLength: 120,
});

export const LifecycleSchema = Type.Union([
  Type.Literal("concept"),
  Type.Literal("prototype"),
  Type.Literal("active"),
  Type.Literal("production"),
  Type.Literal("maintenance"),
  Type.Literal("migration"),
  Type.Literal("legacy"),
  Type.Literal("retiring"),
  Type.Literal("retired"),
]);

export const DefinitionVersionReferenceSchema = Type.Object(
  {
    id: DefinitionIdSchema,
    version: SemVerSchema,
  },
  { additionalProperties: false },
);

export const ComponentInstanceBindingSchema = Type.Object(
  {
    instance_id: InstanceIdSchema("CMP"),
    definition: DefinitionVersionReferenceSchema,
    slug: SlugSchema,
    source_revision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const DomainInstanceBindingSchema = Type.Object(
  {
    instance_id: InstanceIdSchema("DOM"),
    definition: DefinitionVersionReferenceSchema,
    slug: SlugSchema,
    source_revision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const AdapterSelectionSchema = Type.Object(
  {
    agent: Type.Array(DefinitionVersionReferenceSchema, { uniqueItems: true }),
    runtime: Type.Array(DefinitionVersionReferenceSchema, { uniqueItems: true }),
    workflow: Type.Array(DefinitionVersionReferenceSchema, {
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export const ApprovalRecordReferenceSchema = profileSchema(
  "project-memory/v1/approval-record-reference",
  Type.Object(
    {
      id: InstanceIdSchema("APR"),
      root_id: InstanceIdSchema("ROOT"),
      revision: Type.Integer({ minimum: 1 }),
      decision: Type.Union([
        Type.Literal("approved"),
        Type.Literal("rejected"),
        Type.Literal("revoked"),
      ]),
      approved_by: Type.Literal("Pitaji"),
      approved_at: UtcTimestampSchema,
      scope: Type.Union([
        Type.Literal("profile.bootstrap"),
        Type.Literal("profile.evolution"),
        Type.Literal("profile.relationship"),
      ]),
      artifact_sha256: Sha256Schema,
    },
    { additionalProperties: false },
  ),
);

export const ProjectSelectionSchema = profileSchema(
  "project-memory/v1/project-selection",
  Type.Object(
    {
      schema_version: SemVerSchema,
      root: Type.Object(
        {
          id: InstanceIdSchema("ROOT"),
          namespace: RootNamespaceSchema,
          kind: RootKindSchema,
          primary_archetype: PrimaryArchetypeSchema,
          blueprint: DefinitionVersionReferenceSchema,
          lifecycle: LifecycleSchema,
        },
        { additionalProperties: false },
      ),
      overlays: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
      components: Type.Array(ComponentInstanceBindingSchema, {
        minItems: 1,
        uniqueItems: true,
      }),
      domains: Type.Array(DomainInstanceBindingSchema, {
        minItems: 1,
        uniqueItems: true,
      }),
      adapters: AdapterSelectionSchema,
      catalog: Type.Object(
        {
          release: SemVerSchema,
          catalog_hash: Sha256Schema,
        },
        { additionalProperties: false },
      ),
      acceptance: Type.Object(
        {
          approval_id: InstanceIdSchema("APR"),
          accepted_by: Type.Literal("Pitaji"),
          accepted_at: UtcTimestampSchema,
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
);

export type Lifecycle = Static<typeof LifecycleSchema>;
export type DefinitionVersionReference = Static<
  typeof DefinitionVersionReferenceSchema
>;
export type ComponentInstanceBinding = Static<
  typeof ComponentInstanceBindingSchema
>;
export type DomainInstanceBinding = Static<typeof DomainInstanceBindingSchema>;
export type AdapterSelection = Static<typeof AdapterSelectionSchema>;
export type ApprovalRecordReference = Static<
  typeof ApprovalRecordReferenceSchema
>;
export type ProjectSelection = Static<typeof ProjectSelectionSchema>;