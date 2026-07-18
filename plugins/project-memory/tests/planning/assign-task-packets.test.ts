import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../src/index.js";
import { assignTaskPackets } from "../../src/planning/assign-task-packets.js";
import type {
  TaskAssignmentInput,
  WorkstreamPatternSet,
  WorkstreamRequirement,
} from "../../src/planning/types.js";

const PRIMARY_TASK = "TASK-01J00000000000000000000001";
const VALIDATION_TASK = "TASK-01J00000000000000000000002";

const patternSet: WorkstreamPatternSet = {
  outcomePrimary: {
    id: "engineering.feature.implement",
    version: "1.0.0",
    provenanceRuleIds: [],
  },
  companions: [
    {
      id: "qa.regression.validate",
      version: "1.0.0",
      provenanceRuleIds: ["companion.mutation"],
    },
  ],
};

const requirements: readonly WorkstreamRequirement[] = [
  {
    id: "requirement.modify-referral",
    kind: "duty",
    exclusive: true,
    coordinationRequired: false,
    sourcePatternIds: ["engineering.feature.implement"],
  },
  {
    id: "requirement.regression-gate",
    kind: "gate",
    exclusive: false,
    coordinationRequired: true,
    sourcePatternIds: ["qa.regression.validate"],
  },
];

function input(overrides: Partial<TaskAssignmentInput> = {}): TaskAssignmentInput {
  return {
    patternSet,
    requirements,
    authorizedPaths: ["lib/features/referral/**"],
    taskCandidates: [
      {
        taskId: PRIMARY_TASK,
        primaryPatternId: "engineering.feature.implement",
        requestedRequirementIds: ["requirement.modify-referral"],
        claimedPaths: ["lib/features/referral/**"],
        coordinationIds: [],
      },
      {
        taskId: VALIDATION_TASK,
        primaryPatternId: "qa.regression.validate",
        requestedRequirementIds: ["requirement.regression-gate"],
        claimedPaths: [],
        coordinationIds: ["coordination.referral-regression"],
      },
    ],
    ...overrides,
  };
}

describe("task packet assignment", () => {
  it("assigns one mutation owner and one dedicated validation task", () => {
    const result = assignTaskPackets(input());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value).toEqual([
      {
        taskId: PRIMARY_TASK,
        primaryPattern: patternSet.outcomePrimary,
        coveredRequirementIds: ["requirement.modify-referral"],
        claimedPaths: ["lib/features/referral/**"],
        coordinationIds: [],
      },
      {
        taskId: VALIDATION_TASK,
        primaryPattern: patternSet.companions[0],
        coveredRequirementIds: ["requirement.regression-gate"],
        claimedPaths: [],
        coordinationIds: ["coordination.referral-regression"],
      },
    ]);
  });

  it("rejects a task pattern outside the workstream", () => {
    const value = input();
    const first = value.taskCandidates[0];
    if (first === undefined) throw new Error("missing task candidate");
    expect(
      assignTaskPackets({
        ...value,
        taskCandidates: [
          { ...first, primaryPatternId: "security.application.assess" },
          ...value.taskCandidates.slice(1),
        ],
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "task.pattern_not_in_workstream" }],
    });
  });

  it("rejects invented requirement IDs", () => {
    const value = input();
    const first = value.taskCandidates[0];
    if (first === undefined) throw new Error("missing task candidate");
    expect(
      assignTaskPackets({
        ...value,
        taskCandidates: [
          { ...first, requestedRequirementIds: ["requirement.invented"] },
          ...value.taskCandidates.slice(1),
        ],
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "coverage.unknown_requirement" }],
    });
  });

  it("rejects a claim path outside accepted authorization", () => {
    const value = input();
    const first = value.taskCandidates[0];
    if (first === undefined) throw new Error("missing task candidate");
    expect(
      assignTaskPackets({
        ...value,
        taskCandidates: [
          { ...first, claimedPaths: ["firebase/functions/**"] },
          ...value.taskCandidates.slice(1),
        ],
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "coverage.unauthorized_path" }],
    });
  });

  it("rejects overlapping paths without shared coordination", () => {
    const value = input();
    const second = value.taskCandidates[1];
    if (second === undefined) throw new Error("missing validation candidate");
    expect(
      assignTaskPackets({
        ...value,
        taskCandidates: [
          value.taskCandidates[0] as (typeof value.taskCandidates)[number],
          {
            ...second,
            claimedPaths: ["lib/features/referral/widgets/**"],
            coordinationIds: ["coordination.other"],
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "coverage.overlap_without_coordination" }],
    });
  });

  it("is stable across shuffled candidate and nested ID order", () => {
    const first = assignTaskPackets(input());
    const shuffled = input({
      taskCandidates: [...input().taskCandidates]
        .reverse()
        .map((candidate) => ({
          ...candidate,
          requestedRequirementIds: [...candidate.requestedRequirementIds].reverse(),
          coordinationIds: [...candidate.coordinationIds].reverse(),
        })),
    });
    const second = assignTaskPackets(shuffled);
    if (!first.ok || !second.ok) throw new Error("assignment failed");
    expect(canonicalJson(first.value)).toBe(canonicalJson(second.value));
  });
});
