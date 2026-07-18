import { describe, expect, it } from "vitest";

import {
  canonicalMutationPlanHash,
  type CanonicalMutationPlan,
  type PlannedWrite,
} from "../../src/index.js";

const encoder = new TextEncoder();

function plannedWrite(relativePath: string, value: string): PlannedWrite {
  return {
    relative_path: relativePath,
    bytes: encoder.encode(value),
    expected_existing_sha256: null,
    mode: "create",
  };
}

function plan(
  writes: readonly PlannedWrite[],
): Omit<CanonicalMutationPlan<{ readonly reason: string }>, "plan_hash"> {
  return {
    schema_version: "1.0.0",
    plan_id: "CHG-01J00000000000000000000000",
    mutation_kind: "record",
    root_id: "ROOT-01J00000000000000000000000",
    target_ref: "refs/heads/main",
    expected_head: "0123456789abcdef0123456789abcdef01234567",
    profile_lock_hash:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    writes,
    record_ids: ["DEC-01J00000000000000000000000"],
    event_ids: [],
    approval_ids: [],
    evidence_ids: [],
    created_by: "agent:test",
    created_at: "2026-07-14T12:00:00.000Z",
    expires_at: "2026-07-14T12:15:00.000Z",
    metadata: { reason: "contract" },
  };
}

describe("canonicalMutationPlanHash", () => {
  it("is independent of write input order", () => {
    const left = plan([
      plannedWrite("docs/project-memory/zeta.yaml", "zeta\n"),
      plannedWrite("docs/project-memory/alpha.yaml", "alpha\n"),
    ]);
    const right = plan([...left.writes].reverse());

    expect(canonicalMutationPlanHash(left)).toBe(canonicalMutationPlanHash(right));
  });

  it("changes when written bytes or a stable plan field changes", () => {
    const baseline = plan([
      plannedWrite("docs/project-memory/record.yaml", "before\n"),
    ]);
    const changedBytes = plan([
      plannedWrite("docs/project-memory/record.yaml", "after\n"),
    ]);
    const changedHead = {
      ...baseline,
      expected_head: "fedcba9876543210fedcba9876543210fedcba98",
    };

    const baselineHash = canonicalMutationPlanHash(baseline);
    expect(canonicalMutationPlanHash(changedBytes)).not.toBe(baselineHash);
    expect(canonicalMutationPlanHash(changedHead)).not.toBe(baselineHash);
  });
});
