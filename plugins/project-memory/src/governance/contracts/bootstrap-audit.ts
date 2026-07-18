import { Type, type Static } from "@sinclair/typebox";

import {
  HashMapSchema,
  RevisionSchema,
  Sha256Schema,
  TextListSchema,
  TextSchema,
  TimestampSchema,
  governanceSchema,
  instanceId,
} from "./schema-primitives.js";

const BootstrapCheckSchema = Type.Object(
  {
    id: TextSchema,
    status: Type.Union([
      Type.Literal("passed"),
      Type.Literal("failed"),
      Type.Literal("not_run"),
    ]),
    evidence_id: Type.Union([instanceId("EVD"), Type.Null()]),
  },
  { additionalProperties: false },
);

export const BootstrapAuditManifestSchema = governanceSchema(
  "project-memory/v1/bootstrap-audit",
  Type.Object(
    {
      schema_version: Type.Literal("1.0.0"),
      root_id: instanceId("ROOT"),
      target_ref: Type.String({ pattern: "^refs/" }),
      parent_revision: RevisionSchema,
      compilation_plan_hash: Sha256Schema,
      source_proposal_hash: Sha256Schema,
      profile_lock_hash: Sha256Schema,
      catalog_lock_hash: Sha256Schema,
      approval_record_id: instanceId("APR"),
      evidence_record_id: instanceId("EVD"),
      bootstrap_event_hash: Sha256Schema,
      planned_content_hashes: HashMapSchema,
      generated_view_hashes: HashMapSchema,
      bootstrap_content_hash: Sha256Schema,
      checks: Type.Array(BootstrapCheckSchema),
      remaining_risks: TextListSchema,
      created_at: TimestampSchema,
      created_by: TextSchema,
    },
    { additionalProperties: false },
  ),
);

export type BootstrapAuditManifest = Static<
  typeof BootstrapAuditManifestSchema
>;
