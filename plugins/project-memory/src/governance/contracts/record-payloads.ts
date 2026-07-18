import { Type, type Static } from "@sinclair/typebox";

import {
  HashMapSchema,
  TextListSchema,
  TextSchema,
  TimestampSchema,
  instanceId,
} from "./schema-primitives.js";

export const DecisionRecordPayloadSchema = Type.Object(
  {
    choice: TextSchema,
    rationale: TextSchema,
    alternatives: TextListSchema,
    consequences: TextListSchema,
  },
  { additionalProperties: false },
);

export const IdeaRecordPayloadSchema = Type.Object(
  {
    proposal: TextSchema,
    disposition_reason: TextSchema,
  },
  { additionalProperties: false },
);

export const ChangeRecordPayloadSchema = Type.Object(
  {
    summary: TextSchema,
    files: TextListSchema,
    commits: TextListSchema,
    artifacts: TextListSchema,
    authorization_refs: Type.Array(instanceId("APR"), { uniqueItems: true }),
  },
  { additionalProperties: false },
);

export const FindingRecordPayloadSchema = Type.Object(
  {
    severity: Type.Union([
      Type.Literal("critical"),
      Type.Literal("high"),
      Type.Literal("medium"),
      Type.Literal("low"),
      Type.Literal("info"),
    ]),
    description: TextSchema,
    evidence_ids: Type.Array(instanceId("EVD"), { uniqueItems: true }),
    remediation_proposal_ids: Type.Array(instanceId("IDEA", "CHG"), {
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

const RiskLevelSchema = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("critical"),
]);

export const RiskRecordPayloadSchema = Type.Object(
  {
    likelihood: RiskLevelSchema,
    impact: RiskLevelSchema,
    mitigation: TextSchema,
  },
  { additionalProperties: false },
);

export const EvidenceRecordPayloadSchema = Type.Object(
  {
    evidence_type: TextSchema,
    exact_result: Type.String(),
    source_refs: Type.Array(TextSchema, { minItems: 1, uniqueItems: true }),
    hashes: HashMapSchema,
    not_run_reason: Type.Union([TextSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const LessonRecordPayloadSchema = Type.Object(
  {
    observation: TextSchema,
    evidence_ids: Type.Array(instanceId("EVD"), { uniqueItems: true }),
    rule: TextSchema,
  },
  { additionalProperties: false },
);

export const ApprovalRecordPayloadSchema = Type.Object(
  {
    approval_kind: Type.Union([
      Type.Literal("directional"),
      Type.Literal("relationship"),
      Type.Literal("migration"),
      Type.Literal("security_privacy"),
      Type.Literal("pricing_business"),
      Type.Literal("destructive_deletion"),
      Type.Literal("external_action"),
      Type.Literal("lease_takeover"),
      Type.Literal("coordination_exception"),
    ]),
    granted_by: TextSchema,
    target: TextSchema,
    environment: TextSchema,
    scope: Type.Array(TextSchema, { minItems: 1, uniqueItems: true }),
    timing: TextSchema,
    expires_at: Type.Union([TimestampSchema, Type.Null()]),
    invalidation_conditions: TextListSchema,
  },
  { additionalProperties: false },
);

export type DecisionRecordPayload = Static<typeof DecisionRecordPayloadSchema>;
export type IdeaRecordPayload = Static<typeof IdeaRecordPayloadSchema>;
export type ChangeRecordPayload = Static<typeof ChangeRecordPayloadSchema>;
export type FindingRecordPayload = Static<typeof FindingRecordPayloadSchema>;
export type RiskRecordPayload = Static<typeof RiskRecordPayloadSchema>;
export type EvidenceRecordPayload = Static<typeof EvidenceRecordPayloadSchema>;
export type LessonRecordPayload = Static<typeof LessonRecordPayloadSchema>;
export type ApprovalRecordPayload = Static<typeof ApprovalRecordPayloadSchema>;
