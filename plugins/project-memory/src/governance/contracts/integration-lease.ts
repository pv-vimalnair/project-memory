import { Type, type Static } from "@sinclair/typebox";

import {
  RevisionSchema,
  TextSchema,
  TimestampSchema,
  governanceSchema,
  instanceId,
} from "./schema-primitives.js";

export const IntegrationLeaseSchema = governanceSchema(
  "project-memory/v1/integration-lease",
  Type.Object(
    {
      schema_version: Type.Literal("1.0.0"),
      holder_id: TextSchema,
      authority_class: Type.Union([
        Type.Literal("integrator"),
        Type.Literal("pitaji"),
      ]),
      base_revision: RevisionSchema,
      target_ref: Type.String({ pattern: "^refs/" }),
      acquired_at: TimestampSchema,
      last_heartbeat_at: TimestampSchema,
      expires_at: TimestampSchema,
      nonce: Type.String({ minLength: 32, pattern: "\\S" }),
      takeover_approval_id: Type.Union([instanceId("APR"), Type.Null()]),
    },
    { additionalProperties: false },
  ),
);

export type IntegrationLease = Static<typeof IntegrationLeaseSchema>;
