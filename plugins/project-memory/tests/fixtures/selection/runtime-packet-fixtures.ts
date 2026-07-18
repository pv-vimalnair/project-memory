import {
  validateWithSchema,
  type SchemaId,
} from "../../../src/index.js";
import type {
  CompletionPacket,
  TaskPacket,
} from "../../../src/planning/types.js";

function validatedFixture<T>(id: SchemaId, value: T): T {
  const result = validateWithSchema<T>(id, value);
  if (!result.ok) {
    throw new Error(
      result.issues.map((issue) => `${issue.code}:${issue.path}`).join(","),
    );
  }
  return structuredClone(result.value);
}

export function makeValidTaskPacket(): TaskPacket {
  const packet: TaskPacket = {
    schema_version: "1.0.0",
    packet_id: "PKT-01J00000000000000000000001",
    root: {
      id: "ROOT-01J00000000000000000000001",
      profile_lock_hash: "a".repeat(64),
      catalog_release: "1.0.0",
      catalog_hash: "b".repeat(64),
    },
    initiative_id: null,
    workstream_id: "WS-01J00000000000000000000001",
    task_id: "TASK-01J00000000000000000000001",
    assignment: {
      assignee_id: "agent.codex-worker-1",
      issued_by: "agent.integrator",
      issued_at: "2026-07-14T12:00:00.000Z",
    },
    patterns: {
      primary: { id: "engineering.feature.implement", version: "1.0.0" },
      companions: [
        { id: "qa.regression.validate", version: "1.0.0" },
      ],
    },
    selector: {
      score: 90,
      runner_up_score: 70,
      margin: 20,
      matched_signal_ids: ["mode-implement"],
      evidence_ids: ["EVD-01J00000000000000000000001"],
    },
    goal: "Implement the accepted referral flow",
    scope: {
      inclusions: ["lib/features/referral/**"],
      exclusions: ["firebase/**"],
    },
    resolved_inputs: {
      record_ids: ["DEC-01J00000000000000000000001"],
      artifact_refs: ["profile.lock.yaml"],
      original_base_revision: "0123456789abcdef0123456789abcdef01234567",
    },
    component_duties: [
      {
        component_id: "CMP-01J00000000000000000000001",
        duties: ["modify", "validate"],
        requirement: "required",
        reason: "Resolved engineering implementation impact",
        read_scope: ["lib/features/referral/**"],
        write_scope: ["lib/features/referral/**"],
        responsible_role: "worker",
        resolution: {
          source_impact_ids: ["engineering.feature.implement"],
          predicate_ids: ["mode-implement"],
          result: true,
          evidence_ids: ["EVD-01J00000000000000000000001"],
          evaluated_by: "validator.selection",
          evaluated_at: "2026-07-14T12:00:00.000Z",
        },
      },
    ],
    domain_duties: [],
    claim: {
      id: "CLAIM-01J00000000000000000000001",
      issuer: "agent.integrator",
      assignee_id: "agent.codex-worker-1",
      base_revision: "0123456789abcdef0123456789abcdef01234567",
      issued_at: "2026-07-14T12:00:00.000Z",
      expires_at: "2026-07-14T12:15:00.000Z",
      heartbeat_interval: "PT5M",
      last_heartbeat_at: "2026-07-14T12:00:00.000Z",
      renewal_policy: "claim.same-scope-only",
      status: "active",
      components: ["CMP-01J00000000000000000000001"],
      repositories: ["lifeof"],
      paths: ["lib/features/referral/**"],
      duties: ["modify", "validate"],
      required_evidence: ["exact-diff", "regression-result"],
      coordination_exception_approval_id: null,
    },
    decisions: {
      accepted_record_ids: ["DEC-01J00000000000000000000001"],
      proposed_record_ids: [],
    },
    authorization: {
      mutation: "task-scoped",
      task_result_submission: "worker",
      factual_integration: "integrator",
      workstream_activation: "automatic-by-rule",
      directional_acceptance: "Pitaji",
      external_action: {
        allowed: false,
        approval_ids: [],
        target: null,
        environment: null,
        scope: [],
        timing: null,
      },
    },
    approvals: [],
    required_outputs: ["implementation-change"],
    required_evidence: ["exact-diff", "regression-result"],
    gates: [
      {
        id: "gate.regression",
        definition_ref: "adapter.flutter.test@1.0.0",
        type: "test",
        command_or_check: "flutter test",
        required: true,
        conflict_sensitive: true,
        evidence_type: "test-result",
        execution: {
          kind: "command",
          executable: "flutter",
          args: ["test"],
          cwd: ".",
          timeout_ms: 600000,
          env_allowlist: {},
        },
      },
    ],
    memory_updates: {
      create_record_types: ["change", "evidence"],
      update_record_ids: [],
    },
    completion_conditions: [
      "Accepted referral behavior passes regression",
    ],
    fallback_and_escalation: {
      triggers: ["claim-expiry", "scope-drift"],
      owner: "integrator",
      allowed_fallbacks: ["submit-partial-completion"],
    },
  };
  return validatedFixture("project-memory/v1/task-packet", packet);
}

export function makeValidCompletionPacket(
  task: TaskPacket = makeValidTaskPacket(),
): CompletionPacket {
  const completion: CompletionPacket = {
    schema_version: "1.0.0",
    packet_id: task.packet_id,
    task_id: task.task_id,
    workstream_id: task.workstream_id,
    claim_id: task.claim.id,
    actor: task.assignment.assignee_id,
    submitted_at: "2026-07-14T12:05:00.000Z",
    original_base_revision: task.claim.base_revision,
    worker_head_revision: "f".repeat(40),
    scope_performed: ["lib/features/referral/referral_service.dart"],
    scope_not_completed: [],
    changes: [
      {
        change_id: "CHG-01J00000000000000000000001",
        authorization_refs: [],
        files: ["lib/features/referral/referral_service.dart"],
        commits: ["f".repeat(40)],
        artifacts: ["artifacts/test-results/referral.json"],
        rationale: "Implemented the assigned referral behavior",
      },
    ],
    proposed_decision_ids: [],
    checks: [
      {
        gate_id: "gate.regression",
        command_or_check: "flutter test",
        status: "passed",
        exact_result: "12 tests passed",
        evidence_id: "EVD-01J00000000000000000000001",
        not_run_reason: null,
      },
    ],
    records_created: [
      "CHG-01J00000000000000000000001",
      "EVD-01J00000000000000000000001",
    ],
    records_updated: [],
    outputs: ["implementation-change"],
    remaining_risk_ids: [],
    next_action: null,
    worker_attestation:
      "I submit factual results only and do not accept or approve product direction.",
  };
  return validatedFixture("project-memory/v1/completion-packet", completion);
}
