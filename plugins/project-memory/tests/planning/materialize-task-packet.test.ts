import { beforeEach, describe, expect, it } from "vitest";

import {
  FixedClock,
  PROJECT_SCHEMA_REGISTRARS,
  canonicalJson,
  registerProjectSchemas,
  type IdFactory,
  type InstancePrefix,
} from "../../src/index.js";
import { materializeTaskPacket } from "../../src/planning/materialize-task-packet.js";
import type { TaskPacketInput } from "../../src/planning/types.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const NOW = new Date("2026-07-14T12:00:00.000Z");
const PACKET_ID = "PKT-01J00000000000000000000001";
const CLAIM_ID = "CLAIM-01J00000000000000000000001";

class FixedIds implements IdFactory {
  next(prefix: InstancePrefix): string {
    if (prefix === "PKT") return PACKET_ID;
    if (prefix === "CLAIM") return CLAIM_ID;
    throw new Error(`unexpected prefix ${prefix}`);
  }
}

function validInput(): TaskPacketInput {
  return {
    packet: {
      schema_version: "1.0.0",
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
        issued_at: NOW.toISOString(),
      },
      patterns: {
        primary: {
          id: "engineering.feature.implement",
          version: "1.0.0",
        },
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
            evaluated_at: NOW.toISOString(),
          },
        },
      ],
      domain_duties: [],
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
    },
    claim: {
      issuer: "agent.integrator",
      assignee_id: "agent.codex-worker-1",
      base_revision: "0123456789abcdef0123456789abcdef01234567",
      heartbeat_interval: "PT5M",
      renewal_policy: "claim.same-scope-only",
      status: "active",
      components: ["CMP-01J00000000000000000000001"],
      repositories: ["lifeof"],
      paths: ["lib/features/referral/**"],
      duties: ["modify", "validate"],
      required_evidence: ["exact-diff", "regression-result"],
      coordination_exception_approval_id: null,
    },
    claim_ttl_ms: 900000,
  };
}

function materialize(input: TaskPacketInput = validInput()) {
  return materializeTaskPacket(input, new FixedClock(NOW), new FixedIds());
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

describe("flattened task packet materialization", () => {
  it("emits only resolved required duties and a complete claim", () => {
    const result = materialize();
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.packet_id).toBe(PACKET_ID);
    expect(result.value.claim).toMatchObject({
      id: CLAIM_ID,
      issued_at: NOW.toISOString(),
      last_heartbeat_at: NOW.toISOString(),
      expires_at: "2026-07-14T12:15:00.000Z",
    });
    expect(
      result.value.component_duties.map((duty) => duty.requirement),
    ).toEqual(["required"]);
    expect(result.value.gates[0]?.execution.kind).toBe("command");
  });

  it("rejects an unresolved conditional duty", () => {
    const value = validInput();
    const duty = value.packet.component_duties[0];
    if (duty === undefined) throw new Error("missing component duty");
    expect(
      materialize({
        ...value,
        packet: {
          ...value.packet,
          component_duties: [
            { ...duty, requirement: "conditional" as "required" },
          ],
        },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "task.unresolved_duty" }],
    });
  });

  it("rejects a mutation duty with an empty write scope", () => {
    const value = validInput();
    const duty = value.packet.component_duties[0];
    if (duty === undefined) throw new Error("missing component duty");
    expect(
      materialize({
        ...value,
        packet: {
          ...value.packet,
          component_duties: [{ ...duty, write_scope: [] }],
        },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "task.empty_write_scope" }],
    });
  });

  it("rejects a shell command string in the executable field", () => {
    const value = validInput();
    const gate = value.packet.gates[0];
    if (gate === undefined || gate.execution.kind !== "command") {
      throw new Error("missing command gate");
    }
    expect(
      materialize({
        ...value,
        packet: {
          ...value.packet,
          gates: [
            {
              ...gate,
              command_or_check: "flutter test && deploy",
              execution: { ...gate.execution, executable: "flutter test" },
            },
          ],
        },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "gate.shell_string_forbidden" }],
    });
  });

  it("rejects an unresolved gate definition reference", () => {
    const value = validInput();
    const gate = value.packet.gates[0];
    if (gate === undefined) throw new Error("missing gate");
    expect(
      materialize({
        ...value,
        packet: {
          ...value.packet,
          gates: [{ ...gate, definition_ref: "unresolved" }],
        },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "gate.definition_unresolved" }],
    });
  });

  it("rejects an external check without explicit approval", () => {
    const value = validInput();
    const gate = value.packet.gates[0];
    if (gate === undefined) throw new Error("missing gate");
    expect(
      materialize({
        ...value,
        packet: {
          ...value.packet,
          gates: [
            {
              ...gate,
              type: "external",
              command_or_check: "Verify production campaign launch",
              execution: {
                kind: "check",
                instruction: "Verify production campaign launch",
                verifier_role: "external",
                approval_refs: [],
              },
            },
          ],
        },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "gate.external_approval_required" }],
    });
  });

  it("rejects approval-required mutation without a recorded approval", () => {
    const value = validInput();
    expect(
      materialize({
        ...value,
        packet: {
          ...value.packet,
          authorization: {
            ...value.packet.authorization,
            mutation: "approval-required",
          },
        },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "task.mutation_approval_required" }],
    });
  });

  it("rejects enabled external authorization without bound approvals", () => {
    const value = validInput();
    expect(
      materialize({
        ...value,
        packet: {
          ...value.packet,
          authorization: {
            ...value.packet.authorization,
            external_action: {
              allowed: true,
              approval_ids: [],
              target: "production campaign",
              environment: "production",
              scope: ["campaign.launch"],
              timing: "once",
            },
          },
        },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "task.external_approval_required" }],
    });
  });

  it("rejects a claim whose duties drift from the emitted packet", () => {
    const value = validInput();
    expect(
      materialize({
        ...value,
        claim: { ...value.claim, duties: ["validate"] },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "task.claim_invalid" }],
    });
  });

  it("rejects known shell executables even when arguments are structured", () => {
    const value = validInput();
    const gate = value.packet.gates[0];
    if (gate === undefined || gate.execution.kind !== "command") {
      throw new Error("missing command gate");
    }
    expect(
      materialize({
        ...value,
        packet: {
          ...value.packet,
          gates: [
            {
              ...gate,
              command_or_check: 'powershell.exe -Command "flutter test"',
              execution: {
                ...gate.execution,
                executable: "powershell.exe",
                args: ["-Command", "flutter test"],
              },
            },
          ],
        },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "gate.shell_string_forbidden" }],
    });
  });
  it("requires external approval to match the full authorization envelope", () => {
    const value = validInput();
    const gate = value.packet.gates[0];
    if (gate === undefined) throw new Error("missing gate");
    const approvalId = "APR-01J00000000000000000000001";
    const approval: TaskPacketInput["packet"]["approvals"][number] = {
      id: approvalId,
      kind: "external",
      granted_by: "Pitaji",
      issued_at: NOW.toISOString(),
      expires_at: "2026-07-14T13:00:00.000Z",
      target: "production campaign",
      environment: "production",
      scope: ["campaign.launch"],
      timing: "once",
      invalidation_conditions: ["scope-change"],
    };
    const instruction = "Verify production campaign launch";
    const approved: TaskPacketInput = {
      ...value,
      packet: {
        ...value.packet,
        authorization: {
          ...value.packet.authorization,
          external_action: {
            allowed: true,
            approval_ids: [approvalId],
            target: approval.target,
            environment: approval.environment,
            scope: [...approval.scope],
            timing: approval.timing,
          },
        },
        approvals: [approval],
        gates: [
          {
            ...gate,
            type: "external",
            command_or_check: instruction,
            execution: {
              kind: "check",
              instruction,
              verifier_role: "external",
              approval_refs: [approvalId],
            },
          },
        ],
      },
    };
    expect(materialize(approved).ok).toBe(true);
    expect(
      materialize({
        ...approved,
        packet: {
          ...approved.packet,
          approvals: [{ ...approval, scope: [] }],
        },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "task.external_approval_drift" }],
    });
  });
  it("is byte-stable when unordered source lists are shuffled", () => {
    const value = validInput();
    const first = materialize(value);
    const second = materialize({
      ...value,
      packet: {
        ...value.packet,
        required_evidence: [...value.packet.required_evidence].reverse(),
        memory_updates: {
          ...value.packet.memory_updates,
          create_record_types: [
            ...value.packet.memory_updates.create_record_types,
          ].reverse(),
        },
      },
      claim: {
        ...value.claim,
        required_evidence: [...value.claim.required_evidence].reverse(),
        duties: [...value.claim.duties].reverse(),
      },
    });
    if (!first.ok || !second.ok) throw new Error("materialization failed");
    expect(canonicalJson(first.value)).toBe(canonicalJson(second.value));
  });
});
