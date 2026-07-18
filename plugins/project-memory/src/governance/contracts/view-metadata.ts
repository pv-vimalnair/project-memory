import { Type, type Static } from "@sinclair/typebox";

import {
  RevisionSchema,
  SafeRelativePathSchema,
  SemVerSchema,
  Sha256Schema,
  TimestampSchema,
  governanceSchema,
} from "./schema-primitives.js";

export const GeneratedViewMetadataSchema = governanceSchema(
  "project-memory/v1/view-metadata",
  Type.Object(
    {
      schema_version: Type.Literal("1.0.0"),
      view_id: Type.Union([
        Type.Literal("now"),
        Type.Literal("handoff"),
        Type.Literal("workstreams"),
        Type.Literal("changelog"),
        Type.Literal("history"),
        Type.Literal("index"),
      ]),
      relative_path: SafeRelativePathSchema,
      source_revision: RevisionSchema,
      profile_version: SemVerSchema,
      profile_lock_hash: Sha256Schema,
      catalog_version: SemVerSchema,
      catalog_lock_hash: Sha256Schema,
      source_set_hash: Sha256Schema,
      generated_at: TimestampSchema,
      content_hash: Sha256Schema,
    },
    { additionalProperties: false },
  ),
);

export type GeneratedViewMetadata = Static<
  typeof GeneratedViewMetadataSchema
>;
