import { describe, expect, it } from "vitest";

import type { InitPlan } from "../../src/cli/init/build-init-plan.js";
import { InMemoryProposalStore } from "../../src/host/proposal-store.js";

const ROOT = new URL("file:///C:/project/");
const PLAN = {
  expected_head: "1".repeat(40),
  plan_hash: "2".repeat(64),
  replay: { expires_at: "2026-07-17T13:00:00.000Z" },
} as InitPlan;

describe("InMemoryProposalStore", () => {
  it("binds an unguessable handle to one exact bootstrap plan", () => {
    const store = new InMemoryProposalStore({
      now: () => new Date("2026-07-17T12:00:00.000Z"),
      handle: () => "pm-proposal-00000000000000000000000000000001",
    });

    const issued = store.issue(ROOT, PLAN);

    expect(issued).toMatchObject({
      ok: true,
      value: {
        handle: "pm-proposal-00000000000000000000000000000001",
        plan_hash: PLAN.plan_hash,
        expected_head: PLAN.expected_head,
        expires_at: PLAN.replay.expires_at,
      },
    });
    expect(store.resolve(issued.ok ? issued.value.handle : "")).toMatchObject({
      ok: true,
      value: { root: ROOT, plan: PLAN },
    });
  });

  it("rejects unknown, expired, or already-consumed handles", () => {
    let now = new Date("2026-07-17T12:00:00.000Z");
    const store = new InMemoryProposalStore({
      now: () => now,
      handle: () => "pm-proposal-00000000000000000000000000000002",
    });

    expect(store.resolve("pm-proposal-missing")).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_NOT_FOUND" }],
    });

    const issued = store.issue(ROOT, PLAN);
    if (!issued.ok) throw new Error("fixture failed");
    now = new Date("2026-07-17T13:00:00.000Z");
    expect(store.resolve(issued.value.handle)).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_EXPIRED" }],
    });

    now = new Date("2026-07-17T12:00:00.000Z");
    const consumedStore = new InMemoryProposalStore({
      now: () => now,
      handle: () => "pm-proposal-00000000000000000000000000000003",
    });
    const consumable = consumedStore.issue(ROOT, PLAN);
    if (!consumable.ok) throw new Error("fixture failed");
    expect(consumedStore.consume(consumable.value.handle).ok).toBe(true);
    expect(consumedStore.resolve(consumable.value.handle)).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_NOT_FOUND" }],
    });
  });

  it("fails closed instead of evicting an active proposal", () => {
    let next = 0;
    const store = new InMemoryProposalStore({
      now: () => new Date("2026-07-17T12:00:00.000Z"),
      handle: () => `pm-proposal-${String(next += 1).padStart(32, "0")}`,
    });

    for (let index = 0; index < 8; index += 1) {
      expect(store.issue(ROOT, PLAN).ok).toBe(true);
    }
    expect(store.issue(ROOT, PLAN)).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_CACHE_FULL" }],
    });
  });
});
