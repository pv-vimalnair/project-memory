import { Type, type Static } from "@sinclair/typebox";

import {
  HashMapSchema,
  RevisionSchema,
  SafeRelativePathSchema,
  SemVerSchema,
  Sha256Schema,
  TextSchema,
  TimestampSchema,
  governanceSchema,
  instanceId,
} from "./schema-primitives.js";

export const PreparedSatelliteSchema = governanceSchema(
  "project-memory/v1/prepared-satellite",
  Type.Object(
    {
      schema_version: Type.Literal("1.0.0"),
      root_id: instanceId("ROOT"),
      repository_id: TextSchema,
      task_id: instanceId("TASK"),
      packet_id: instanceId("PKT"),
      state: Type.Literal("prepared"),
      original_base_revision: RevisionSchema,
      integration_base_revision: RevisionSchema,
      commit_hash: RevisionSchema,
      manifest_hash: Sha256Schema,
      manifest_ref: Type.String({ pattern: "^refs/project-memory/prepared/" }),
      task_packet_hash: Sha256Schema,
      completion_packet_hash: Sha256Schema,
      profile_version: SemVerSchema,
      profile_lock_hash: Sha256Schema,
      catalog_version: SemVerSchema,
      catalog_lock_hash: Sha256Schema,
      approval_ids: Type.Array(instanceId("APR"), { uniqueItems: true }),
      evidence_ids: Type.Array(instanceId("EVD"), { uniqueItems: true }),
      gate_evidence_hashes: Type.Array(Sha256Schema, { uniqueItems: true }),
      changed_paths: Type.Array(SafeRelativePathSchema, { uniqueItems: true }),
      artifact_hashes: HashMapSchema,
      generated_view_hashes: HashMapSchema,
      archive_manifest_hashes: Type.Array(Sha256Schema, { uniqueItems: true }),
      audit_evidence_id: instanceId("EVD"),
      prepared_at: TimestampSchema,
      prepared_by: TextSchema,
    },
    { additionalProperties: false },
  ),
);

export type PreparedSatellite = Static<typeof PreparedSatelliteSchema>;
