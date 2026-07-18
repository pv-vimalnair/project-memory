import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it } from "vitest";

import {
  PROJECT_SCHEMA_REGISTRARS,
  registerProjectSchemas,
} from "../../src/index.js";
import type {
  ApprovalRecordPayload,
  CanonicalRecord,
} from "../../src/governance/contracts/index.js";
import {
  evaluateAuthorityCoverage,
  type AuthorityCoverageInput,
  type AuthorityRole,
  type DirectionalAcceptance,
  type ExternalActionExecution,
} from "../../src/governance/authority/authority-coverage.js";
import type { Approval, TaskPacket } from "../../src/planning/types.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import {
  makeValidCompletionPacket,
  makeValidTaskPacket,
} from "../fixtures/selection/runtime-fixtures.js";

const NOW = "2026-07-14T12:04:00.000Z";
const FIXTURE_ROOT = new URL("../fixtures/governance/authority/", import.meta.url);

interface AuthorityScenario {
  readonly actor_authority: AuthorityRole;
  readonly minimum_authority: AuthorityRole;
  readonly actual_changed_paths: readonly string[];
  readonly deleted_paths: readonly string[];
  readonly directional_acceptance: DirectionalAcceptance | null;
  readonly external_action: ExternalActionExecution | null;
}

async function scenario(name: string): Promise<AuthorityScenario> {
  return JSON.parse(await readFile(new URL(name, FIXTURE_ROOT), "utf8")) as AuthorityScenario;
}

function canonicalApproval(
  task: TaskPacket,
  id: string,
  kind: Extract<
    ApprovalRecordPayload["approval_kind"],
    "directional" | "destructive_deletion" | "external_action"
  >,
  envelope: {
    readonly target: string;
    readonly environment: string;
    readonly scope: readonly string[];
    readonly timing: string;
  },
  expiresAt: string | null = "2026-07-14T13:00:00.000Z",
): CanonicalRecord {
  return {
    id,
    type: "approval",
    title: `Pitaji ${kind} approval`,
    status: "accepted",
    root_id: task.root.id,
    component_ids: [...task.claim.components],
    initiative_id: task.initiative_id,
    workstream_id: task.workstream_id,
    task_id: task.task_id,
    actor_id: "Pitaji",
    authority_class: "pitaji",
    created_at: "2026-07-14T12:00:00.000Z",
    original_base_revision: task.claim.base_revision,
    integration_base_revision: task.claim.base_revision,
    catalog_versions: [task.root.catalog_release],
    relationships: [],
    payload: {
      approval_kind: kind,
      granted_by: "Pitaji",
      target: envelope.target,
      environment: envelope.environment,
      scope: [...envelope.scope],
      timing: envelope.timing,
      expires_at: expiresAt,
      invalidation_conditions: ["target-change", "scope-change"],
    },
  };
}

function input(
  fixture: AuthorityScenario,
  task: TaskPacket = makeValidTaskPacket(),
): AuthorityCoverageInput {
  return {
    task_packet: task,
    completion_packet: makeValidCompletionPacket(task),
    evaluated_at: NOW,
    expected_issuer: "agent.integrator",
    current_base_revision: task.claim.base_revision,
    conflicting_claims: [],
    recorded_task_approvals: task.approvals.map((approval) => structuredClone(approval)),
    available_evidence_ids: ["EVD-01J00000000000000000000001"],
    approved_exception_ids: [],
    actor_authority: fixture.actor_authority,
    minimum_authority: fixture.minimum_authority,
    actual_changed_paths: [...fixture.actual_changed_paths],
    deleted_paths: [...fixture.deleted_paths],
    directional_acceptance: fixture.directional_acceptance,
    external_action: fixture.external_action,
    canonical_approvals: [],
  };
}

function externalTask(): { readonly task: TaskPacket; readonly approval: Approval } {
  const task = makeValidTaskPacket();
  const approval: Approval = {
    id: "APR-01J00000000000000000000031",
    kind: "external",
    granted_by: "Pitaji",
    issued_at: "2026-07-14T12:00:00.000Z",
    expires_at: "2026-07-14T13:00:00.000Z",
    target: "production campaign",
    environment: "production",
    scope: ["campaign.launch"],
    timing: "once",
    invalidation_conditions: ["target-change", "scope-change"],
  };
  task.approvals = [approval];
  task.authorization.external_action = {
    allowed: true,
    approval_ids: [approval.id],
    target: approval.target,
    environment: approval.environment,
    scope: [...approval.scope],
    timing: approval.timing,
  };
  return { task, approval };
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

describe("governance authority coverage", () => {
  it("accepts an authorized routine implementation", async () => {
    const result = evaluateAuthorityCoverage(input(await scenario("routine-task.json")));
    expect(result).toMatchObject({
      ok: true,
      value: {
        covered_change_ids: ["CHG-01J00000000000000000000001"],
        external_action_allowed: false,
        directional_acceptance: "not_applicable",
      },
    });
  });

  it("rejects worker acceptance of directional state", async () => {
    const result = evaluateAuthorityCoverage(input(await scenario("directional-task.json")));
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "authority.direction_requires_pitaji" }],
    });
  });

  it("accepts directional state only with exact Pitaji coverage", async () => {
    const fixture = await scenario("directional-task.json");
    const accepted = {
      ...(fixture.directional_acceptance as DirectionalAcceptance),
      accepted_by: "Pitaji",
      accepted_by_authority: "pitaji" as const,
    };
    const base = input({ ...fixture, directional_acceptance: accepted });
    const value: AuthorityCoverageInput = {
      ...base,
      canonical_approvals: [
        canonicalApproval(
          base.task_packet,
          "APR-01J00000000000000000000021",
          "directional",
          accepted,
        ),
      ],
    };
    const result = evaluateAuthorityCoverage(value);
    expect(result).toMatchObject({
      ok: true,
      value: { directional_acceptance: "pitaji" },
    });
  });

  it("rejects an expired canonical approval", async () => {
    const fixture = await scenario("directional-task.json");
    const accepted = {
      ...(fixture.directional_acceptance as DirectionalAcceptance),
      accepted_by: "Pitaji",
      accepted_by_authority: "pitaji" as const,
    };
    const base = input({ ...fixture, directional_acceptance: accepted });
    const value: AuthorityCoverageInput = {
      ...base,
      canonical_approvals: [
        canonicalApproval(
          base.task_packet,
          "APR-01J00000000000000000000022",
          "directional",
          accepted,
          "2026-07-14T12:03:59.000Z",
        ),
      ],
    };
    expect(evaluateAuthorityCoverage(value)).toMatchObject({
      ok: false,
      issues: [{ code: "approval.expired" }],
    });
  });

  it("requires approval for destructive deletion", async () => {
    const fixture = await scenario("routine-task.json");
    const path = fixture.actual_changed_paths[0] as string;
    const value = input({ ...fixture, deleted_paths: [path] });
    expect(evaluateAuthorityCoverage(value)).toMatchObject({
      ok: false,
      issues: [{ code: "authority.deletion_requires_pitaji" }],
    });
  });

  it("rejects authority below the immutable minimum", async () => {
    const fixture = await scenario("routine-task.json");
    const value = input({ ...fixture, minimum_authority: "integrator" });
    expect(evaluateAuthorityCoverage(value)).toMatchObject({
      ok: false,
      issues: [{ code: "authority.insufficient" }],
    });
  });

  it("rejects actual changed-path drift", async () => {
    const fixture = await scenario("routine-task.json");
    const value = input({ ...fixture, actual_changed_paths: ["lib/unreported.dart"] });
    expect(evaluateAuthorityCoverage(value)).toMatchObject({
      ok: false,
      issues: [{ code: "authority.changed_paths_drift" }],
    });
  });

  it.each([
    ["target", "production-project-b", "approval.target_drift"],
    ["environment", "staging", "approval.environment_drift"],
    ["scope", ["campaign.other"], "approval.scope_drift"],
    ["timing", "recurring", "approval.timing_drift"],
  ] as const)("rejects external approval %s drift", async (field, changed, code) => {
    const fixture = await scenario("external-action-task.json");
    const { task, approval } = externalTask();
    const authorized = fixture.external_action as ExternalActionExecution;
    const base = input(fixture, task);
    const value: AuthorityCoverageInput = {
      ...base,
      recorded_task_approvals: [structuredClone(approval)],
      external_action: { ...authorized, [field]: changed },
      canonical_approvals: [
        canonicalApproval(task, approval.id, "external_action", authorized),
      ],
    };
    expect(evaluateAuthorityCoverage(value)).toMatchObject({
      ok: false,
      issues: [{ code }],
    });
  });

  it("rejects an external action without task authority", async () => {
    const fixture = await scenario("external-action-task.json");
    expect(evaluateAuthorityCoverage(input(fixture))).toMatchObject({
      ok: false,
      issues: [{ code: "authority.external_action_forbidden" }],
    });
  });
});
