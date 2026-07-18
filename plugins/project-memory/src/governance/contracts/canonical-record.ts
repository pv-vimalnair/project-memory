import { Type, type Static, type TSchema } from "@sinclair/typebox";

import type { CanonicalMutationPlan } from "../../contracts/canonical-mutation-plan.js";
import {
  ApprovalRecordPayloadSchema,
  ChangeRecordPayloadSchema,
  DecisionRecordPayloadSchema,
  EvidenceRecordPayloadSchema,
  FindingRecordPayloadSchema,
  IdeaRecordPayloadSchema,
  LessonRecordPayloadSchema,
  RiskRecordPayloadSchema,
} from "./record-payloads.js";
import {
  AuthorityClassSchema,
  RevisionSchema,
  SemVerSchema,
  TextSchema,
  TimestampSchema,
  governanceSchema,
  instanceId,
} from "./schema-primitives.js";

export const RECORD_TYPES = [
  "decision",
  "idea",
  "change",
  "finding",
  "risk",
  "evidence",
  "lesson",
  "approval",
] as const;

export const RELATIONSHIP_TYPES = [
  "supersedes",
  "corrects",
  "implements",
  "evidences",
  "blocks",
  "depends_on",
  "approves",
  "rejects",
] as const;

const RecordStatusSchema = Type.Union([
  Type.Literal("proposed"),
  Type.Literal("accepted"),
  Type.Literal("rejected"),
  Type.Literal("superseded"),
  Type.Literal("corrected"),
  Type.Literal("closed"),
  Type.Literal("withdrawn"),
]);

const RecordRelationshipSchema = Type.Object(
  {
    type: Type.Union(RELATIONSHIP_TYPES.map((value) => Type.Literal(value))),
    target_id: instanceId(),
    note: Type.Union([TextSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

const COMMON_RECORD_PROPERTIES = {
  title: TextSchema,
  status: RecordStatusSchema,
  root_id: instanceId("ROOT"),
  component_ids: Type.Array(instanceId("CMP"), { uniqueItems: true }),
  initiative_id: Type.Union([instanceId("INIT"), Type.Null()]),
  workstream_id: Type.Union([instanceId("WS"), Type.Null()]),
  task_id: Type.Union([instanceId("TASK"), Type.Null()]),
  actor_id: TextSchema,
  authority_class: AuthorityClassSchema,
  created_at: TimestampSchema,
  original_base_revision: RevisionSchema,
  integration_base_revision: RevisionSchema,
  catalog_versions: Type.Array(SemVerSchema, {
    minItems: 1,
    uniqueItems: true,
  }),
  relationships: Type.Array(RecordRelationshipSchema, { uniqueItems: true }),
} as const;

function recordVariant(type: string, prefix: string, payload: TSchema) {
  return Type.Object(
    {
      id: instanceId(prefix),
      type: Type.Literal(type),
      ...COMMON_RECORD_PROPERTIES,
      payload,
    },
    { additionalProperties: false },
  );
}

export const CanonicalRecordSchema = governanceSchema(
  "project-memory/v1/canonical-record",
  Type.Union([
    recordVariant("decision", "DEC", DecisionRecordPayloadSchema),
    recordVariant("idea", "IDEA", IdeaRecordPayloadSchema),
    recordVariant("change", "CHG", ChangeRecordPayloadSchema),
    recordVariant("finding", "FIND", FindingRecordPayloadSchema),
    recordVariant("risk", "RISK", RiskRecordPayloadSchema),
    recordVariant("evidence", "EVD", EvidenceRecordPayloadSchema),
    recordVariant("lesson", "LESSON", LessonRecordPayloadSchema),
    recordVariant("approval", "APR", ApprovalRecordPayloadSchema),
  ]),
);

export type CanonicalRecord = Static<typeof CanonicalRecordSchema>;

export interface RecordMutationMetadata {
  readonly governance_kind: "record";
  readonly record_type: CanonicalRecord["type"];
}

export type RecordMutationPlan = CanonicalMutationPlan<RecordMutationMetadata>;
