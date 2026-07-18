import { beforeEach, describe, expect, it } from "vitest";

import {
  PROJECT_SCHEMA_REGISTRARS,
  registerProjectSchemas,
} from "../../src/index.js";
import { validateClaimAndApprovals } from "../../src/planning/validate-claim-approval.js";
import type {
  Approval,
  AuthorityValidationContext,
  TaskPacket,
} from "../../src/planning/types.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import { makeValidTaskPacket } from "../fixtures/selection/runtime-fixtures.js";

const NOW = "2026-07-14T12:04:00.000Z";

function context(
  task: TaskPacket,
  overrides: Partial<AuthorityValidationContext> = {},
): AuthorityValidationContext {
  return {
    now: NOW,
    expectedIssuer: "agent.integrator",
    currentBaseRevision: task.claim.base_revision,
    conflictingClaims: [],
    recordedApprovals: [],
    ...overrides,
  };
}

function externalTask(): { task: TaskPacket; approval: Approval } {
  const task = makeValidTaskPacket();
  const approval: Approval = {
    id: "APR-01J00000000000000000000001",
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

describe("claim and approval validation", () => {
  it("accepts the canonical active claim", () => {
    const task = makeValidTaskPacket();
    expect(validateClaimAndApprovals(task, context(task))).toMatchObject({
      ok: true,
      value: { valid: true, claimId: task.claim.id, approvalIds: [] },
    });
  });

  it("fails an expired claim before completion can be accepted", () => {
    const task = makeValidTaskPacket();
    task.claim.expires_at = "2026-07-14T12:03:59.000Z";
    expect(validateClaimAndApprovals(task, context(task))).toMatchObject({
      ok: false,
      issues: [{ code: "claim.expired" }],
    });
  });

  it("rejects a stale heartbeat", () => {
    const task = makeValidTaskPacket();
    expect(
      validateClaimAndApprovals(
        task,
        context(task, { now: "2026-07-14T12:06:00.000Z" }),
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "claim.stale_heartbeat" }],
    });
  });

  it("rejects overlapping active claims without coordination approval", () => {
    const task = makeValidTaskPacket();
    const conflict = structuredClone(task.claim);
    conflict.id = "CLAIM-01J00000000000000000000002";
    expect(
      validateClaimAndApprovals(
        task,
        context(task, { conflictingClaims: [conflict] }),
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "claim.overlap_without_coordination" }],
    });
  });

  it("accepts an unchanged recorded external approval", () => {
    const { task, approval } = externalTask();
    expect(
      validateClaimAndApprovals(
        task,
        context(task, { recordedApprovals: [structuredClone(approval)] }),
      ),
    ).toMatchObject({
      ok: true,
      value: { approvalIds: [approval.id] },
    });
  });

  it.each([
    ["target", "different campaign"],
    ["environment", "staging"],
    ["timing", "recurring"],
  ] as const)("rejects external approval %s drift", (field, value) => {
    const { task, approval } = externalTask();
    const recorded: Approval = { ...approval, [field]: value };
    expect(
      validateClaimAndApprovals(
        task,
        context(task, { recordedApprovals: [recorded] }),
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "approval.drift" }],
    });
  });
});
