import { Type, type Static } from "@sinclair/typebox";

import {
  AuthorityClassSchema,
  Sha256Schema,
  TextSchema,
  TimestampSchema,
  governanceSchema,
  instanceId,
} from "./schema-primitives.js";

export const GovernanceEventSchema = governanceSchema(
  "project-memory/v1/governance-event",
  Type.Object(
    {
      aggregate_id: TextSchema,
      sequence: Type.Integer({ minimum: 1 }),
      event_type: TextSchema,
      occurred_at: TimestampSchema,
      actor_id: TextSchema,
      authority_class: AuthorityClassSchema,
      previous_event_hash: Type.Union([Sha256Schema, Type.Null()]),
      payload_hash: Sha256Schema,
      evidence_ids: Type.Array(instanceId("EVD"), { uniqueItems: true }),
      event_hash: Sha256Schema,
      payload: Type.Record(Type.String(), Type.Any()),
    },
    { additionalProperties: false },
  ),
);

export type GovernanceEvent = Static<typeof GovernanceEventSchema>;
export type UnsignedGovernanceEvent = Omit<
  GovernanceEvent,
  "sequence" | "previous_event_hash" | "payload_hash" | "event_hash"
>;
