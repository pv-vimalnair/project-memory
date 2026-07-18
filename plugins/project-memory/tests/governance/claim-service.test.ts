import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  PROJECT_SCHEMA_REGISTRARS,
  registerProjectSchemas,
  success,
  type Clock,
} from "../../src/index.js";
import {
  claimPath,
  createClaimService,
  type ClaimPlanningContext,
} from "../../src/governance/claims/claim-service.js";
import type { ClaimOperationPlan } from "../../src/governance/claims/claim-service.js";
import type { Approval, Claim } from "../../src/planning/types.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import { makeValidTaskPacket } from "../fixtures/selection/runtime-fixtures.js";

const BASE = "0123456789abcdef0123456789abcdef01234567";
const roots: string[] = [];

class MutableClock implements Clock {
  #value = new Date("2026-07-14T12:04:00.000Z");

  now(): Date {
    return new Date(this.#value.getTime());
  }

  set(value: string): void {
    this.#value = new Date(value);
  }
}

async function temporaryRoot(): Promise<URL> {
  const directory = await mkdtemp(path.join(tmpdir(), "project-memory-claims-"));
  roots.push(directory);
  return pathToFileURL(`${directory}${path.sep}`);
}

function context(): ClaimPlanningContext {
  return {
    root_id: "ROOT-01J00000000000000000000001",
    target_ref: "refs/heads/main",
    expected_head: BASE,
    profile_lock_hash: "a".repeat(64),
    actor_id: "agent.integrator",
  };
}

function service(clock: MutableClock) {
  return createClaimService({
    clock,
    context: { context: () => Promise.resolve(success(context())) },
  });
}

function claim(overrides: Partial<Claim> = {}): Claim {
  return { ...makeValidTaskPacket().claim, ...overrides };
}

function secondClaim(overrides: Partial<Claim> = {}): Claim {
  return claim({
    id: "CLAIM-01J00000000000000000000002",
    assignee_id: "agent.codex-worker-2",
    ...overrides,
  });
}

async function applyPlan(root: URL, plan: ClaimOperationPlan): Promise<void> {
  for (const write of plan.writes) {
    expect(write.mode).toBe("create");
    const target = path.join(fileURLToPath(root), ...write.relative_path.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, write.bytes, { flag: "wx" });
  }
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

afterAll(async () => {
  resetSchemaRegistryForTests();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("claim service", () => {
  it("plans immutable claim issuance without directly writing", async () => {
    const root = await temporaryRoot();
    const clock = new MutableClock();
    const issued = claim();
    const result = await service(clock).planIssue({
      root,
      claim: issued,
      requested_by: issued.issuer,
      coordination_id: null,
      recorded_approvals: [],
    });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.writes).toHaveLength(2);
    expect(result.value.writes.every((write) => write.mode === "create")).toBe(true);
    await expect(readFile(new URL(claimPath(issued.id), root))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await applyPlan(root, result.value);
    const effective = await service(clock).effectiveClaim(root, issued.id);
    expect(effective).toMatchObject({
      ok: true,
      value: { status: "active", claim: { id: issued.id } },
    });
  });

  it("rejects overlapping write paths in one repository", async () => {
    const root = await temporaryRoot();
    const clock = new MutableClock();
    const first = claim();
    const manager = service(clock);
    const planned = await manager.planIssue({
      root,
      claim: first,
      requested_by: first.issuer,
      coordination_id: null,
      recorded_approvals: [],
    });
    if (!planned.ok) throw new Error(JSON.stringify(planned.issues));
    await applyPlan(root, planned.value);
    expect(
      await manager.planIssue({
        root,
        claim: secondClaim(),
        requested_by: first.issuer,
        coordination_id: null,
        recorded_approvals: [],
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "claim.write_conflict" }],
    });
  });

  it("allows overlapping reads", async () => {
    const root = await temporaryRoot();
    const clock = new MutableClock();
    const manager = service(clock);
    const first = claim({ duties: ["inspect", "validate"] });
    const planned = await manager.planIssue({
      root,
      claim: first,
      requested_by: first.issuer,
      coordination_id: null,
      recorded_approvals: [],
    });
    if (!planned.ok) throw new Error(JSON.stringify(planned.issues));
    await applyPlan(root, planned.value);
    expect(
      await manager.planIssue({
        root,
        claim: secondClaim({ duties: ["inspect"] }),
        requested_by: first.issuer,
        coordination_id: null,
        recorded_approvals: [],
      }),
    ).toMatchObject({ ok: true });
  });

  it("requires a new claim when the base revision changed", async () => {
    const root = await temporaryRoot();
    const clock = new MutableClock();
    const manager = service(clock);
    const issued = claim();
    const planned = await manager.planIssue({
      root,
      claim: issued,
      requested_by: issued.issuer,
      coordination_id: null,
      recorded_approvals: [],
    });
    if (!planned.ok) throw new Error(JSON.stringify(planned.issues));
    await applyPlan(root, planned.value);
    expect(
      await manager.planRenew({
        root,
        claim_id: issued.id,
        requested_by: issued.issuer,
        current_base_revision: "b".repeat(40),
        requested_expires_at: "2026-07-14T13:00:00.000Z",
        coordination_id: null,
        recorded_approvals: [],
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "claim.base_changed" }],
    });
  });

  it("heartbeats and renews through events without changing issued bytes", async () => {
    const root = await temporaryRoot();
    const clock = new MutableClock();
    const manager = service(clock);
    const issued = claim();
    const planned = await manager.planIssue({
      root,
      claim: issued,
      requested_by: issued.issuer,
      coordination_id: null,
      recorded_approvals: [],
    });
    if (!planned.ok) throw new Error(JSON.stringify(planned.issues));
    await applyPlan(root, planned.value);
    const immutable = await readFile(new URL(claimPath(issued.id), root));
    const heartbeat = await manager.planHeartbeat({
      root,
      claim_id: issued.id,
      requested_by: issued.assignee_id,
    });
    if (!heartbeat.ok) throw new Error(JSON.stringify(heartbeat.issues));
    expect(heartbeat.value.writes).toHaveLength(1);
    await applyPlan(root, heartbeat.value);
    const renewed = await manager.planRenew({
      root,
      claim_id: issued.id,
      requested_by: issued.issuer,
      current_base_revision: issued.base_revision,
      requested_expires_at: "2026-07-14T13:00:00.000Z",
      coordination_id: null,
      recorded_approvals: [],
    });
    if (!renewed.ok) throw new Error(JSON.stringify(renewed.issues));
    await applyPlan(root, renewed.value);
    expect(await readFile(new URL(claimPath(issued.id), root))).toEqual(immutable);
    expect(await manager.effectiveClaim(root, issued.id)).toMatchObject({
      ok: true,
      value: {
        status: "active",
        last_heartbeat_at: "2026-07-14T12:04:00.000Z",
        expires_at: "2026-07-14T13:00:00.000Z",
      },
    });
  });

  it("permits renewal only by the original issuer", async () => {
    const root = await temporaryRoot();
    const clock = new MutableClock();
    const manager = service(clock);
    const issued = claim();
    const planned = await manager.planIssue({
      root,
      claim: issued,
      requested_by: issued.issuer,
      coordination_id: null,
      recorded_approvals: [],
    });
    if (!planned.ok) throw new Error(JSON.stringify(planned.issues));
    await applyPlan(root, planned.value);
    expect(
      await manager.planRenew({
        root,
        claim_id: issued.id,
        requested_by: issued.assignee_id,
        current_base_revision: issued.base_revision,
        requested_expires_at: "2026-07-14T13:00:00.000Z",
        coordination_id: null,
        recorded_approvals: [],
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "claim.issuer_required" }],
    });
  });

  it("treats wall-clock expiry as immediate and plans an append-only expiry", async () => {
    const root = await temporaryRoot();
    const clock = new MutableClock();
    const manager = service(clock);
    const issued = claim();
    const planned = await manager.planIssue({
      root,
      claim: issued,
      requested_by: issued.issuer,
      coordination_id: null,
      recorded_approvals: [],
    });
    if (!planned.ok) throw new Error(JSON.stringify(planned.issues));
    await applyPlan(root, planned.value);
    clock.set("2026-07-14T12:16:00.000Z");
    expect(await manager.effectiveClaim(root, issued.id)).toMatchObject({
      ok: true,
      value: { status: "expired" },
    });
    const expiry = await manager.planExpire({
      root,
      claim_id: issued.id,
      requested_by: issued.issuer,
    });
    if (!expiry.ok) throw new Error(JSON.stringify(expiry.issues));
    expect(expiry.value.writes).toHaveLength(1);
    expect(
      await manager.planIssue({
        root,
        claim: secondClaim({
          issued_at: "2026-07-14T12:16:00.000Z",
          last_heartbeat_at: "2026-07-14T12:16:00.000Z",
          expires_at: "2026-07-14T12:31:00.000Z",
        }),
        requested_by: issued.issuer,
        coordination_id: null,
        recorded_approvals: [],
      }),
    ).toMatchObject({ ok: true });
  });

  it("allows an overlap only with a linked approval and coordination ID", async () => {
    const root = await temporaryRoot();
    const clock = new MutableClock();
    const manager = service(clock);
    const first = claim();
    const planned = await manager.planIssue({
      root,
      claim: first,
      requested_by: first.issuer,
      coordination_id: null,
      recorded_approvals: [],
    });
    if (!planned.ok) throw new Error(JSON.stringify(planned.issues));
    await applyPlan(root, planned.value);
    const approval: Approval = {
      id: "APR-01J00000000000000000000071",
      kind: "coordination",
      granted_by: "Pitaji",
      issued_at: "2026-07-14T12:00:00.000Z",
      expires_at: "2026-07-14T13:00:00.000Z",
      target: "coordination.referral",
      environment: "repository",
      scope: ["lib/features/referral/**"],
      timing: "while-both-claims-active",
      invalidation_conditions: ["scope-change", "base-change"],
    };
    const coordinated = secondClaim({
      coordination_exception_approval_id: approval.id,
    });
    expect(
      await manager.planIssue({
        root,
        claim: coordinated,
        requested_by: coordinated.issuer,
        coordination_id: "coordination.referral",
        recorded_approvals: [approval],
      }),
    ).toMatchObject({
      ok: true,
      value: { approval_ids: [approval.id] },
    });
  });
});
