import { Type, type Static } from "@sinclair/typebox";

import { DefinitionIdSchema, SemVerSchema } from "../../catalog/contracts/common.js";
import {
  SafeRelativePathSchema,
  Sha256Schema,
  profileSchema,
} from "./project-selection.js";

export const CatalogSourceKindSchema = Type.Union([
  Type.Literal("pattern-core"),
  Type.Literal("pattern-taxonomy"),
  Type.Literal("companion-core"),
  Type.Literal("companion-taxonomy"),
  Type.Literal("blueprint"),
  Type.Literal("definition-source"),
  Type.Literal("generated-schema"),
]);

export const SelectedCatalogLockEntrySchema = Type.Object(
  {
    kind: CatalogSourceKindSchema,
    definition_ids: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    source_release_path: SafeRelativePathSchema,
    target_path: SafeRelativePathSchema,
    sha256: Sha256Schema,
    byte_length: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

function selectedCatalogLockValueSchema() {
  return Type.Object(
    {
      schema_version: Type.Literal("1.0.0"),
      catalog_release: SemVerSchema,
      source_release_hash: Sha256Schema,
      entries: Type.Array(SelectedCatalogLockEntrySchema, { uniqueItems: true }),
      lock_hash: Sha256Schema,
    },
    { additionalProperties: false },
  );
}

export const SelectedCatalogLockValueSchema = selectedCatalogLockValueSchema();
export const SelectedCatalogLockSchema = profileSchema(
  "project-memory/v1/selected-catalog-lock",
  selectedCatalogLockValueSchema(),
);

export type CatalogSourceKind = Static<typeof CatalogSourceKindSchema>;
export type SelectedCatalogLockEntry = Static<
  typeof SelectedCatalogLockEntrySchema
>;
export type SelectedCatalogLock = Static<typeof SelectedCatalogLockValueSchema>;

export interface SelectedCatalogVerificationReport {
  readonly valid: boolean;
  readonly lock_hash: string;
  readonly checked_paths: readonly string[];
  readonly external_reads: readonly [];
}