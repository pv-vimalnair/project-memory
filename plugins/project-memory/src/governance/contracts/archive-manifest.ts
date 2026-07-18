import { Type, type Static } from "@sinclair/typebox";

import {
  SafeRelativePathSchema,
  Sha256Schema,
  TextListSchema,
  TextSchema,
  TimestampSchema,
  governanceSchema,
} from "./schema-primitives.js";

const RedactionReportSchema = Type.Object(
  {
    redacted: Type.Boolean(),
    rule_ids: TextListSchema,
    replacement_count: Type.Integer({ minimum: 0 }),
    review_required: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const ArchiveManifestSchema = governanceSchema(
  "project-memory/v1/archive-manifest",
  Type.Object(
    {
      schema_version: Type.Literal("1.0.0"),
      manifest_hash: Sha256Schema,
      source_hash: Sha256Schema,
      stored_hash: Sha256Schema,
      object_kind: TextSchema,
      object_path: SafeRelativePathSchema,
      media_type: TextSchema,
      redaction_report: RedactionReportSchema,
      actor_id: TextSchema,
      created_at: TimestampSchema,
      source_refs: Type.Array(TextSchema, { minItems: 1, uniqueItems: true }),
    },
    { additionalProperties: false },
  ),
);

export type ArchiveManifest = Static<typeof ArchiveManifestSchema>;
