import { Type, type Static } from "@sinclair/typebox";

import {
  InstanceIdSchema,
  NonBlankStringListSchema,
  NonBlankStringSchema,
  RepositoryLocatorSchema,
  RootNamespaceSchema,
  SafeRelativePathSchema,
  Sha256Schema,
  profileSchema,
} from "./project-selection.js";

export const RootAddressSchema = Type.Object(
  {
    namespace: RootNamespaceSchema,
    root_id: InstanceIdSchema("ROOT"),
    canonical_repository: RepositoryLocatorSchema,
    profile_lock_hash: Sha256Schema,
  },
  { additionalProperties: false },
);

export const CanonicalArtifactReferenceSchema = Type.Object(
  {
    root: RootAddressSchema,
    relative_path: SafeRelativePathSchema,
    revision: Type.Integer({ minimum: 1 }),
    sha256: Sha256Schema,
  },
  { additionalProperties: false },
);

function portfolioChildValueSchema() {
  return Type.Object(
    {
      kind: Type.Literal("portfolio-child"),
      relationship_id: NonBlankStringSchema,
      revision: Type.Integer({ minimum: 1 }),
      portfolio: RootAddressSchema,
      child: RootAddressSchema,
      relationship_owner_root_id: InstanceIdSchema("ROOT"),
      child_truth_owner_root_id: InstanceIdSchema("ROOT"),
      relationship_status: Type.Union([
        Type.Literal("proposed"),
        Type.Literal("active"),
        Type.Literal("retired"),
      ]),
      dependency_kinds: NonBlankStringListSchema,
      approval_refs: Type.Array(InstanceIdSchema("APR"), {
        minItems: 1,
        uniqueItems: true,
      }),
    },
    { additionalProperties: false },
  );
}

function sharedPlatformProviderValueSchema() {
  return Type.Object(
    {
      kind: Type.Literal("shared-platform-provider"),
      relationship_id: NonBlankStringSchema,
      revision: Type.Integer({ minimum: 1 }),
      provider: RootAddressSchema,
      consumer: RootAddressSchema,
      owner_root_id: InstanceIdSchema("ROOT"),
      interface_refs: Type.Array(CanonicalArtifactReferenceSchema, {
        minItems: 1,
        uniqueItems: true,
      }),
      approval_refs: Type.Array(InstanceIdSchema("APR"), {
        minItems: 1,
        uniqueItems: true,
      }),
    },
    { additionalProperties: false },
  );
}

function sharedPlatformConsumerValueSchema() {
  return Type.Object(
    {
      kind: Type.Literal("shared-platform-consumer"),
      relationship_id: NonBlankStringSchema,
      revision: Type.Integer({ minimum: 1 }),
      consumer: RootAddressSchema,
      provider: RootAddressSchema,
      owner_root_id: InstanceIdSchema("ROOT"),
      provider_interface_refs: Type.Array(CanonicalArtifactReferenceSchema, {
        minItems: 1,
        uniqueItems: true,
      }),
      usage_component_ids: Type.Array(InstanceIdSchema("CMP"), {
        minItems: 1,
        uniqueItems: true,
      }),
      migration_state: Type.Union([
        Type.Literal("current"),
        Type.Literal("migration-required"),
        Type.Literal("retiring"),
      ]),
      approval_refs: Type.Array(InstanceIdSchema("APR"), {
        minItems: 1,
        uniqueItems: true,
      }),
    },
    { additionalProperties: false },
  );
}

function rootRelationshipValueSchema() {
  return Type.Union([
    portfolioChildValueSchema(),
    sharedPlatformProviderValueSchema(),
    sharedPlatformConsumerValueSchema(),
  ]);
}

export const PortfolioChildReferenceSchema = profileSchema(
  "project-memory/v1/portfolio-child-reference",
  portfolioChildValueSchema(),
);
export const SharedPlatformProviderReferenceSchema = profileSchema(
  "project-memory/v1/shared-platform-provider-reference",
  sharedPlatformProviderValueSchema(),
);
export const SharedPlatformConsumerReferenceSchema = profileSchema(
  "project-memory/v1/shared-platform-consumer-reference",
  sharedPlatformConsumerValueSchema(),
);
export const RootRelationshipValueSchema = rootRelationshipValueSchema();
export const RootRelationshipSourceDataSchema = profileSchema(
  "project-memory/v1/root-relationship-source-data",
  rootRelationshipValueSchema(),
);

export type RootAddress = Static<typeof RootAddressSchema>;
export type CanonicalArtifactReference = Static<
  typeof CanonicalArtifactReferenceSchema
>;
export type PortfolioChildReference = Static<
  typeof PortfolioChildReferenceSchema
>;
export type SharedPlatformProviderReference = Static<
  typeof SharedPlatformProviderReferenceSchema
>;
export type SharedPlatformConsumerReference = Static<
  typeof SharedPlatformConsumerReferenceSchema
>;
export type RootRelationshipSourceData = Static<
  typeof RootRelationshipValueSchema
>;