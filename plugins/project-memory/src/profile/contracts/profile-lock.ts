import { Type, type Static } from "@sinclair/typebox";

import {
  InstanceIdSchema,
  NonBlankStringSchema,
  SafeRelativePathSchema,
  Sha256Schema,
  profileSchema,
} from "./project-selection.js";
import { ResolvedProfileValueSchema } from "./resolved-profile.js";

export const AcceptedSourceLockEntrySchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("project"),
      Type.Literal("constraint"),
      Type.Literal("policy"),
      Type.Literal("blueprint-document"),
      Type.Literal("component"),
      Type.Literal("domain"),
      Type.Literal("root-relationship"),
    ]),
    source_id: NonBlankStringSchema,
    revision: Type.Integer({ minimum: 1 }),
    target_path: SafeRelativePathSchema,
    sha256: Sha256Schema,
    approval_refs: Type.Array(InstanceIdSchema("APR"), {
      minItems: 1,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

function profileLockValueSchema() {
  return Type.Object(
    {
      schema_version: Type.Literal("1.0.0"),
      profile_revision: Type.Integer({ minimum: 1 }),
      root_id: InstanceIdSchema("ROOT"),
      project_hash: Sha256Schema,
      selected_catalog_lock_hash: Sha256Schema,
      accepted_source_entries: Type.Array(AcceptedSourceLockEntrySchema, {
        minItems: 1,
        uniqueItems: true,
      }),
      profile: ResolvedProfileValueSchema,
      lock_hash: Sha256Schema,
    },
    { additionalProperties: false },
  );
}

export const ProfileLockValueSchema = profileLockValueSchema();
export const ProfileLockSchema = profileSchema(
  "project-memory/v1/profile-lock",
  profileLockValueSchema(),
);

export type AcceptedSourceLockEntry = Static<
  typeof AcceptedSourceLockEntrySchema
>;
export type ProfileLock = Static<typeof ProfileLockValueSchema>;