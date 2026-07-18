import {
  Type,
  type Static,
  type TString,
  type TSchema,
} from "@sinclair/typebox";
import {
  registerSchema,
  type SchemaId,
} from "../schema/registry.js";
import {
  ControlledDutySchema,
  ownedSchema,
} from "../selection/contracts/core.js";
const TextSchema = Type.String({ minLength: 1 });
const TextListSchema = Type.Array(TextSchema, { uniqueItems: true });
const TimestampSchema = Type.String({ format: "utc-timestamp" });
const RevisionSchema = Type.String({ minLength: 1 });
const ActorSchema = Type.String({ minLength: 1 });
const SemVerSchema = Type.String({ format: "semantic-version" });
const HashSchema = Type.String({ format: "sha256" });
function instanceId(prefix: string): TString {
  return Type.String({
    pattern: "^" + prefix + "-[0-9A-HJKMNP-TV-Z]{26}$",
  });
}
function schemaReference<T extends TSchema & { readonly $id: string }>(
  schema: T,
) {
  const siblingId = schema.$id.slice(schema.$id.lastIndexOf("/") + 1);
  return Type.Unsafe<Static<T>>({ $ref: siblingId });
}
const PatternRefSchema = Type.Object(
  {
    id: Type.String({ format: "definition-id" }),
    version: SemVerSchema,
  },
  { additionalProperties: false },
);
export const ApprovalSchema = ownedSchema(
  "project-memory/v1/approval",
  Type.Object(
    {
      id: instanceId("APR"),
      kind: TextSchema,
      granted_by: ActorSchema,
      issued_at: TimestampSchema,
      expires_at: Type.Union([TimestampSchema, Type.Null()]),
      target: Type.Union([TextSchema, Type.Null()]),
      environment: Type.Union([TextSchema, Type.Null()]),
      scope: TextListSchema,
      timing: Type.Union([TextSchema, Type.Null()]),
      invalidation_conditions: TextListSchema,
    },
    { additionalProperties: false },
  ),
);
export const ClaimSchema = ownedSchema(
  "project-memory/v1/claim",
  Type.Object(
    {
      id: instanceId("CLAIM"),
      issuer: ActorSchema,
      assignee_id: ActorSchema,
      base_revision: RevisionSchema,
      issued_at: TimestampSchema,
      expires_at: TimestampSchema,
      heartbeat_interval: TextSchema,
      last_heartbeat_at: TimestampSchema,
      renewal_policy: TextSchema,
      status: Type.Literal("active"),
      components: Type.Array(instanceId("CMP"), { uniqueItems: true }),
      repositories: TextListSchema,
      paths: TextListSchema,
      duties: Type.Array(ControlledDutySchema, { uniqueItems: true }),
      required_evidence: TextListSchema,
      coordination_exception_approval_id: Type.Union([
        instanceId("APR"),
        Type.Null(),
      ]),
    },
    { additionalProperties: false },
  ),
);
const PatternRefWithProvenanceSchema = Type.Object(
  {
    ...PatternRefSchema.properties,
    provenance_rule_ids: Type.Array(
      Type.String({ format: "definition-id" }),
      { uniqueItems: true },
    ),
  },
  { additionalProperties: false },
);
export const WorkstreamPatternSetSchema = ownedSchema(
  "project-memory/v1/workstream-pattern-set",
  Type.Object(
    {
      outcome_primary: PatternRefWithProvenanceSchema,
      companions: Type.Array(PatternRefWithProvenanceSchema),
    },
    { additionalProperties: false },
  ),
);
export const TaskAssignmentSchema = ownedSchema(
  "project-memory/v1/task-assignment",
  Type.Object(
    {
      task_id: instanceId("TASK"),
      primary_pattern: PatternRefWithProvenanceSchema,
      covered_requirement_ids: TextListSchema,
      claimed_paths: TextListSchema,
      coordination_ids: TextListSchema,
    },
    { additionalProperties: false },
  ),
);
const GateTypeSchema = Type.Union([
  Type.Literal("test"),
  Type.Literal("lint"),
  Type.Literal("build"),
  Type.Literal("review"),
  Type.Literal("policy"),
  Type.Literal("render"),
  Type.Literal("external"),
]);
const CommandGateExecutionSchema = Type.Object(
  {
    kind: Type.Literal("command"),
    executable: TextSchema,
    args: Type.Array(Type.String()),
    cwd: TextSchema,
    timeout_ms: Type.Integer({ minimum: 1 }),
    env_allowlist: Type.Record(Type.String(), Type.String()),
  },
  { additionalProperties: false },
);
const CheckGateExecutionSchema = Type.Object(
  {
    kind: Type.Literal("check"),
    instruction: TextSchema,
    verifier_role: Type.Union([
      Type.Literal("worker"),
      Type.Literal("integrator"),
      Type.Literal("Pitaji"),
      Type.Literal("external"),
    ]),
    approval_refs: Type.Array(instanceId("APR"), { uniqueItems: true }),
  },
  { additionalProperties: false },
);
export const GateExecutionSchema = Type.Union([
  CommandGateExecutionSchema,
  CheckGateExecutionSchema,
]);
export const ResolvedGateExecutionSchema = Type.Object(
  {
    id: TextSchema,
    definition_ref: TextSchema,
    type: GateTypeSchema,
    command_or_check: TextSchema,
    required: Type.Boolean(),
    conflict_sensitive: Type.Boolean(),
    evidence_type: TextSchema,
    execution: GateExecutionSchema,
  },
  { additionalProperties: false },
);
const RootBindingSchema = Type.Object(
  {
    id: instanceId("ROOT"),
    profile_lock_hash: HashSchema,
    catalog_release: SemVerSchema,
    catalog_hash: HashSchema,
  },
  { additionalProperties: false },
);
const AssignmentBindingSchema = Type.Object(
  {
    assignee_id: ActorSchema,
    issued_by: ActorSchema,
    issued_at: TimestampSchema,
  },
  { additionalProperties: false },
);
const PatternBindingSchema = Type.Object(
  {
    primary: PatternRefSchema,
    companions: Type.Array(PatternRefSchema),
  },
  { additionalProperties: false },
);
const SelectorTraceSchema = Type.Object(
  {
    score: Type.Number({ minimum: 0, maximum: 100 }),
    runner_up_score: Type.Union([
      Type.Number({ minimum: 0, maximum: 100 }),
      Type.Null(),
    ]),
    margin: Type.Number({ minimum: 0, maximum: 100 }),
    matched_signal_ids: TextListSchema,
    evidence_ids: Type.Array(instanceId("EVD"), { uniqueItems: true }),
  },
  { additionalProperties: false },
);
const ScopeSchema = Type.Object(
  {
    inclusions: TextListSchema,
    exclusions: TextListSchema,
  },
  { additionalProperties: false },
);
const ResolvedInputsSchema = Type.Object(
  {
    record_ids: TextListSchema,
    artifact_refs: TextListSchema,
    original_base_revision: RevisionSchema,
  },
  { additionalProperties: false },
);
const DutyResolutionSchema = Type.Object(
  {
    source_impact_ids: TextListSchema,
    predicate_ids: TextListSchema,
    result: Type.Literal(true),
    evidence_ids: Type.Array(instanceId("EVD"), { uniqueItems: true }),
    evaluated_by: ActorSchema,
    evaluated_at: TimestampSchema,
  },
  { additionalProperties: false },
);
const ResponsibleRoleSchema = Type.Union([
  Type.Literal("worker"),
  Type.Literal("validator"),
  Type.Literal("integrator"),
  Type.Literal("Pitaji"),
]);
const ComponentDutySchema = Type.Object(
  {
    component_id: instanceId("CMP"),
    duties: Type.Array(ControlledDutySchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    requirement: Type.Literal("required"),
    reason: TextSchema,
    read_scope: TextListSchema,
    write_scope: TextListSchema,
    responsible_role: ResponsibleRoleSchema,
    resolution: DutyResolutionSchema,
  },
  { additionalProperties: false },
);
const DomainDutySchema = Type.Object(
  {
    domain_id: instanceId("DOM"),
    duties: Type.Array(ControlledDutySchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    requirement: Type.Literal("required"),
    reason: TextSchema,
    write_scope: TextListSchema,
    required_records: TextListSchema,
    responsible_role: ResponsibleRoleSchema,
    resolution: DutyResolutionSchema,
  },
  { additionalProperties: false },
);
const DecisionsSchema = Type.Object(
  {
    accepted_record_ids: TextListSchema,
    proposed_record_ids: TextListSchema,
  },
  { additionalProperties: false },
);
const ExternalAuthorizationSchema = Type.Object(
  {
    allowed: Type.Boolean(),
    approval_ids: Type.Array(instanceId("APR"), { uniqueItems: true }),
    target: Type.Union([TextSchema, Type.Null()]),
    environment: Type.Union([TextSchema, Type.Null()]),
    scope: TextListSchema,
    timing: Type.Union([TextSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
const TaskAuthorizationSchema = Type.Object(
  {
    mutation: Type.Union([
      Type.Literal("none"),
      Type.Literal("task-scoped"),
      Type.Literal("approval-required"),
    ]),
    task_result_submission: Type.Literal("worker"),
    factual_integration: Type.Literal("integrator"),
    workstream_activation: Type.Union([
      Type.Literal("automatic-by-rule"),
      Type.Literal("integrator"),
      Type.Literal("Pitaji"),
    ]),
    directional_acceptance: Type.Literal("Pitaji"),
    external_action: ExternalAuthorizationSchema,
  },
  { additionalProperties: false },
);
const MemoryUpdatesSchema = Type.Object(
  {
    create_record_types: TextListSchema,
    update_record_ids: TextListSchema,
  },
  { additionalProperties: false },
);
const FallbackSchema = Type.Object(
  {
    triggers: TextListSchema,
    owner: Type.Union([
      Type.Literal("integrator"),
      Type.Literal("Pitaji"),
    ]),
    allowed_fallbacks: TextListSchema,
  },
  { additionalProperties: false },
);
export const TaskPacketSchema = ownedSchema(
  "project-memory/v1/task-packet",
  Type.Object(
    {
      schema_version: SemVerSchema,
      packet_id: instanceId("PKT"),
      root: RootBindingSchema,
      initiative_id: Type.Union([instanceId("INIT"), Type.Null()]),
      workstream_id: instanceId("WS"),
      task_id: instanceId("TASK"),
      assignment: AssignmentBindingSchema,
      patterns: PatternBindingSchema,
      selector: SelectorTraceSchema,
      goal: TextSchema,
      scope: ScopeSchema,
      resolved_inputs: ResolvedInputsSchema,
      component_duties: Type.Array(ComponentDutySchema),
      domain_duties: Type.Array(DomainDutySchema),
      claim: schemaReference(ClaimSchema),
      decisions: DecisionsSchema,
      authorization: TaskAuthorizationSchema,
      approvals: Type.Array(schemaReference(ApprovalSchema)),
      required_outputs: TextListSchema,
      required_evidence: TextListSchema,
      gates: Type.Array(ResolvedGateExecutionSchema),
      memory_updates: MemoryUpdatesSchema,
      completion_conditions: TextListSchema,
      fallback_and_escalation: FallbackSchema,
    },
    { additionalProperties: false },
  ),
);
const CompletionChangeSchema = Type.Object(
  {
    change_id: instanceId("CHG"),
    authorization_refs: TextListSchema,
    files: TextListSchema,
    commits: TextListSchema,
    artifacts: TextListSchema,
    rationale: TextSchema,
  },
  { additionalProperties: false },
);
const CompletionCheckSchema = Type.Object(
  {
    gate_id: TextSchema,
    command_or_check: TextSchema,
    status: Type.Union([
      Type.Literal("passed"),
      Type.Literal("failed"),
      Type.Literal("not_run"),
    ]),
    exact_result: TextSchema,
    evidence_id: Type.Union([instanceId("EVD"), Type.Null()]),
    not_run_reason: Type.Union([TextSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export const CompletionPacketSchema = ownedSchema(
  "project-memory/v1/completion-packet",
  Type.Object(
    {
      schema_version: SemVerSchema,
      packet_id: instanceId("PKT"),
      task_id: instanceId("TASK"),
      workstream_id: instanceId("WS"),
      claim_id: instanceId("CLAIM"),
      actor: ActorSchema,
      submitted_at: TimestampSchema,
      original_base_revision: RevisionSchema,
      worker_head_revision: RevisionSchema,
      scope_performed: TextListSchema,
      scope_not_completed: TextListSchema,
      changes: Type.Array(CompletionChangeSchema),
      proposed_decision_ids: TextListSchema,
      checks: Type.Array(CompletionCheckSchema),
      records_created: TextListSchema,
      records_updated: TextListSchema,
      outputs: TextListSchema,
      remaining_risk_ids: TextListSchema,
      next_action: Type.Union([TextSchema, Type.Null()]),
      worker_attestation: TextSchema,
    },
    { additionalProperties: false },
  ),
);
const WorkstreamIntentSchema = Type.Object(
  {
    id: TextSchema,
    statement: TextSchema,
    primary_mode: Type.Union([
      Type.Literal("assess"),
      Type.Literal("plan"),
      Type.Literal("design"),
      Type.Literal("implement"),
      Type.Literal("change"),
      Type.Literal("validate"),
      Type.Literal("release"),
      Type.Literal("operate"),
      Type.Literal("retire"),
    ]),
    acceptance_criteria: TextListSchema,
    authority_class: Type.Union([
      Type.Literal("automatic-by-rule"),
      Type.Literal("integrator"),
      Type.Literal("Pitaji"),
    ]),
    release_fate: Type.Union([
      Type.Literal("none"),
      Type.Literal("planned"),
      Type.Literal("production"),
    ]),
    can_complete_independently: Type.Boolean(),
    depends_on_workstream_ids: TextListSchema,
  },
  { additionalProperties: false },
);
export const WorkstreamPlanSchema = ownedSchema(
  "project-memory/v1/workstream-plan",
  Type.Object(
    {
      schema_version: Type.Literal("1.0.0"),
      initiative_id: Type.Union([instanceId("INIT"), Type.Null()]),
      workstreams: Type.Array(WorkstreamIntentSchema, { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
);
export type Approval = Static<typeof ApprovalSchema>;
export type Claim = Static<typeof ClaimSchema>;
export type GateType = Static<typeof GateTypeSchema>;
export type GateExecution = Static<typeof GateExecutionSchema>;
export type ResolvedGateExecution = Static<
  typeof ResolvedGateExecutionSchema
>;
export type TaskPacket = Static<typeof TaskPacketSchema>;
export type CompletionPacket = Static<typeof CompletionPacketSchema>;
export type TaskAssignmentPayload = Static<typeof TaskAssignmentSchema>;
export type WorkstreamPatternSetPayload = Static<
  typeof WorkstreamPatternSetSchema
>;
export type WorkstreamPlan = Static<typeof WorkstreamPlanSchema>;
const PLANNING_SCHEMAS = Object.freeze([
  ApprovalSchema,
  ClaimSchema,
  CompletionPacketSchema,
  TaskAssignmentSchema,
  TaskPacketSchema,
  WorkstreamPatternSetSchema,
  WorkstreamPlanSchema,
] as const);
export const PLANNING_SCHEMA_IDS = Object.freeze([
  "project-memory/v1/approval",
  "project-memory/v1/claim",
  "project-memory/v1/completion-packet",
  "project-memory/v1/task-assignment",
  "project-memory/v1/task-packet",
  "project-memory/v1/workstream-pattern-set",
  "project-memory/v1/workstream-plan",
] as const satisfies readonly SchemaId[]);
export function registerPlanningSchemas(): readonly SchemaId[] {
  for (const schema of PLANNING_SCHEMAS) registerSchema(schema);
  return PLANNING_SCHEMA_IDS;
}
