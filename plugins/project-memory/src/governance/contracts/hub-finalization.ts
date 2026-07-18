import { Type, type Static } from "@sinclair/typebox";

import {
  HashMapSchema,
  RevisionSchema,
  Sha256Schema,
  TextSchema,
  TimestampSchema,
  governanceSchema,
  instanceId,
} from "./schema-primitives.js";

export const HubFinalizationReceiptSchema = governanceSchema(
  "project-memory/v1/hub-finalization",
  Type.Object(
    {
      schema_version: Type.Literal("1.0.0"),
      status: Type.Literal("hub_finalized"),
      hub_root_id: instanceId("ROOT"),
      packet_id: instanceId("PKT"),
      previous_revision: RevisionSchema,
      commit_revision: RevisionSchema,
      satellite_manifest_hashes: Type.Array(Sha256Schema, {
        minItems: 1,
        uniqueItems: true,
      }),
      satellite_commit_hashes: Type.Array(RevisionSchema, {
        minItems: 1,
        uniqueItems: true,
      }),
      audit_evidence_id: instanceId("EVD"),
      generated_view_hashes: HashMapSchema,
      finalized_at: TimestampSchema,
      finalized_by: TextSchema,
      receipt_hash: Sha256Schema,
    },
    { additionalProperties: false },
  ),
);

export type HubFinalizationReceipt = Static<
  typeof HubFinalizationReceiptSchema
>;
