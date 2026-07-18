import { Type, type Static } from "@sinclair/typebox";

import {
  Sha256Schema,
  TextSchema,
  TimestampSchema,
  governanceSchema,
  instanceId,
} from "./schema-primitives.js";

const GateCommandSchema = Type.Object(
  {
    executable: TextSchema,
    args: Type.Array(Type.String()),
    cwd: TextSchema,
  },
  { additionalProperties: false },
);

export const GateEvidenceSchema = governanceSchema(
  "project-memory/v1/gate-evidence",
  Type.Object(
    {
      schema_version: Type.Literal("1.0.0"),
      gate_id: TextSchema,
      definition_ref: TextSchema,
      evidence_type: TextSchema,
      execution_kind: Type.Union([
        Type.Literal("command"),
        Type.Literal("check"),
      ]),
      status: Type.Union([
        Type.Literal("passed"),
        Type.Literal("failed"),
        Type.Literal("not_run"),
      ]),
      required: Type.Boolean(),
      conflict_sensitive: Type.Boolean(),
      command: Type.Union([GateCommandSchema, Type.Null()]),
      verifier_role: Type.Union([TextSchema, Type.Null()]),
      exit_code: Type.Union([Type.Integer(), Type.Null()]),
      stdout_redacted: Type.String(),
      stderr_redacted: Type.String(),
      stdout_sha256: Sha256Schema,
      stderr_sha256: Sha256Schema,
      evidence_ids: Type.Array(instanceId("EVD"), { uniqueItems: true }),
      approval_refs: Type.Array(instanceId("APR"), { uniqueItems: true }),
      occurred_at: TimestampSchema,
      duration_ms: Type.Integer({ minimum: 0 }),
      not_run_reason: Type.Union([TextSchema, Type.Null()]),
    },
    { additionalProperties: false },
  ),
);

export type GateEvidence = Static<typeof GateEvidenceSchema>;

export interface SubmittedCheckEvidence {
  readonly gate_id: string;
  readonly verifier_role: string;
  readonly evidence_type: string;
  readonly status: "passed" | "failed" | "not_run";
  readonly exact_result: string;
  readonly evidence_ids: readonly string[];
  readonly approval_refs: readonly string[];
  readonly occurred_at: string;
}
