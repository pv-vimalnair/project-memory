import { Type, type Static } from "@sinclair/typebox";

import {
  catalogSchema,
  DefinitionIdSchema,
  NonEmptyStringSchema,
  SemVerSchema,
} from "./common.js";

const BlueprintFixtureCountsSchema = Type.Object(
  {
    positive: Type.Integer({ minimum: 0 }),
    anti: Type.Integer({ minimum: 0 }),
    boundary: Type.Integer({ minimum: 0 }),
    total: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const CatalogExpectedCountsSchema = Type.Object(
  {
    blueprint_groups: Type.Integer({ minimum: 0 }),
    blueprints: Type.Integer({ minimum: 0 }),
    pattern_families: Type.Integer({ minimum: 0 }),
    patterns: Type.Integer({ minimum: 0 }),
    companion_rules: Type.Integer({ minimum: 0 }),
    blueprint_fixtures: BlueprintFixtureCountsSchema,
  },
  { additionalProperties: false },
);

const GeneratedPathsSchema = Type.Object(
  {
    schemas: Type.String({ format: "safe-relative-path" }),
    release: Type.String({ format: "safe-relative-path" }),
  },
  { additionalProperties: false },
);

export const CatalogManifestSchema = catalogSchema("project-memory/v1/catalog-manifest", Type.Object(
  {
    id: Type.Literal("project-memory"),
    release: SemVerSchema,
    schema_version: SemVerSchema,
    source_root: Type.String({ format: "safe-relative-path" }),
    expected_counts: CatalogExpectedCountsSchema,
    generated_paths: GeneratedPathsSchema,
  },
  { additionalProperties: false },
));

export const CatalogInventorySchema = catalogSchema("project-memory/v1/catalog-inventory", Type.Object(
  {
    id: DefinitionIdSchema,
    version: SemVerSchema,
    expected_count: Type.Integer({ minimum: 0 }),
    ids: Type.Array(
      Type.String({
        pattern: "^[a-z][a-z0-9-]*(?:[.][a-z][a-z0-9-]*)*$",
      }),
      { uniqueItems: true },
    ),
  },
  { additionalProperties: false },
));

const CatalogReleaseLockEntrySchema = Type.Object(
  {
    relative_path: Type.String({ format: "safe-relative-path" }),
    definition_id: Type.Union([DefinitionIdSchema, Type.Null()]),
    version: Type.Union([SemVerSchema, Type.Null()]),
    schema_id: Type.Union([
      Type.String({ pattern: "^project-memory/v1/[a-z][a-z0-9-]*$" }),
      Type.Null(),
    ]),
    sha256: Type.String({ format: "sha256" }),
  },
  { additionalProperties: false },
);

export const CatalogReleaseLockSchema = catalogSchema("project-memory/v1/catalog-release-lock", Type.Object(
  {
    schema_version: Type.Literal("1.0.0"),
    catalog_id: Type.Literal("project-memory"),
    release: SemVerSchema,
    source_entries: Type.Array(CatalogReleaseLockEntrySchema),
    generated_entries: Type.Array(CatalogReleaseLockEntrySchema),
    release_hash: Type.String({ format: "sha256" }),
  },
  { additionalProperties: false },
));

export type CatalogManifest = Static<typeof CatalogManifestSchema>;
export type CatalogInventory = Static<typeof CatalogInventorySchema>;
export type CatalogReleaseLock = Static<typeof CatalogReleaseLockSchema>;

export interface CatalogReleaseArtifacts {
  readonly root: URL;
  readonly lock: CatalogReleaseLock;
  readonly bundle_path: string;
  readonly lock_path: string;
  readonly checksums_path: string;
}

export interface CatalogReleaseVerification {
  readonly valid: boolean;
  readonly release: string;
  readonly release_hash: string;
  readonly checked_paths: readonly string[];
}

export const CatalogNameSchema = NonEmptyStringSchema;
