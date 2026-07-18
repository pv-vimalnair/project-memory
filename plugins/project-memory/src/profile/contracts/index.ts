import { CanonicalMarkdownEnvelopeSchema } from "./canonical-markdown.js";
import type { SchemaId } from "../../schema/registry.js";
import { registerSchema } from "../../schema/registry.js";
import { ProfileLockSchema } from "./profile-lock.js";
import { ProfileMutationMetadataSchema } from "./profile-mutation-metadata.js";
import {
  ApprovalRecordReferenceSchema,
  ProjectSelectionSchema,
} from "./project-selection.js";
import { ResolvedProfileSchema } from "./resolved-profile.js";
import {
  PortfolioChildReferenceSchema,
  RootRelationshipSourceDataSchema,
  SharedPlatformConsumerReferenceSchema,
  SharedPlatformProviderReferenceSchema,
} from "./root-relationships.js";
import { SelectedCatalogLockSchema } from "./selected-catalog-lock.js";
import { AcceptedProfileSourceSetSchema } from "./source-documents.js";

export const PROFILE_SCHEMA_IDS = [
  "project-memory/v1/accepted-profile-source-set",
  "project-memory/v1/approval-record-reference",
  "project-memory/v1/canonical-markdown-envelope",
  "project-memory/v1/portfolio-child-reference",
  "project-memory/v1/profile-lock",
  "project-memory/v1/profile-mutation-metadata",
  "project-memory/v1/project-selection",
  "project-memory/v1/resolved-profile",
  "project-memory/v1/root-relationship-source-data",
  "project-memory/v1/selected-catalog-lock",
  "project-memory/v1/shared-platform-consumer-reference",
  "project-memory/v1/shared-platform-provider-reference",
] as const satisfies readonly SchemaId[];

export function registerProfileSchemas(): readonly SchemaId[] {
  registerSchema(ApprovalRecordReferenceSchema);
  registerSchema(CanonicalMarkdownEnvelopeSchema);
  registerSchema(ProjectSelectionSchema);
  registerSchema(PortfolioChildReferenceSchema);
  registerSchema(SharedPlatformProviderReferenceSchema);
  registerSchema(SharedPlatformConsumerReferenceSchema);
  registerSchema(RootRelationshipSourceDataSchema);
  registerSchema(AcceptedProfileSourceSetSchema);
  registerSchema(SelectedCatalogLockSchema);
  registerSchema(ResolvedProfileSchema);
  registerSchema(ProfileLockSchema);
  registerSchema(ProfileMutationMetadataSchema);
  return PROFILE_SCHEMA_IDS;
}

export * from "./canonical-markdown.js";
export * from "./project-selection.js";
export * from "./source-documents.js";
export * from "./root-relationships.js";
export * from "./selected-catalog-lock.js";
export * from "./profile-lock.js";
export * from "./resolved-profile.js";
export * from "./profile-mutation-metadata.js";