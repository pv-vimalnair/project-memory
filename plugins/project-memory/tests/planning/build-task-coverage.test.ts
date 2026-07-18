import { describe, expect, it } from "vitest";

import { buildTaskCoverage } from "../../src/planning/build-task-coverage.js";
import type {
  TaskAssignment,
  WorkstreamPatternSet,
  WorkstreamRequirement,
} from "../../src/planning/types.js";

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

function assignment(
  taskId: string,
  pattern: TaskAssignment["primaryPattern"],
  coveredRequirementIds: readonly string[],
): TaskAssignment {
  return {
    taskId,
    primaryPattern: pattern,
    coveredRequirementIds,
    claimedPaths: [],
    coordinationIds: ["coordination.referral"],
  };
}

describe("total workstream task coverage", () => {
  it("proves every requirement is assigned", () => {
    const result = buildTaskCoverage(patternSet, requirements, [
      assignment(
        "TASK-01J00000000000000000000001",
        patternSet.outcomePrimary,
        ["requirement.modify-referral"],
      ),
      assignment(
        "TASK-01J00000000000000000000002",
        patternSet.companions[0] as TaskAssignment["primaryPattern"],
        ["requirement.regression-gate"],
      ),
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value).toEqual({
      requirementTaskIds: {
        "requirement.modify-referral": [
          "TASK-01J00000000000000000000001",
        ],
        "requirement.regression-gate": [
          "TASK-01J00000000000000000000002",
        ],
      },
      unassignedRequirementIds: [],
      duplicateExclusiveRequirementIds: [],
    });
  });

  it("rejects an unassigned requirement", () => {
    expect(
      buildTaskCoverage(patternSet, requirements, [
        assignment(
          "TASK-01J00000000000000000000001",
          patternSet.outcomePrimary,
          ["requirement.modify-referral"],
        ),
      ]),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "coverage.unassigned_requirement" }],
    });
  });

  it("rejects duplicate owners of an exclusive requirement", () => {
    expect(
      buildTaskCoverage(patternSet, requirements.slice(0, 1), [
        assignment(
          "TASK-01J00000000000000000000001",
          patternSet.outcomePrimary,
          ["requirement.modify-referral"],
        ),
        assignment(
          "TASK-01J00000000000000000000002",
          patternSet.outcomePrimary,
          ["requirement.modify-referral"],
        ),
      ]),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "coverage.duplicate_exclusive_owner" }],
    });
  });

  it("rejects a coverage assignment from an unrelated pattern", () => {
    expect(
      buildTaskCoverage(patternSet, requirements.slice(0, 1), [
        assignment(
          "TASK-01J00000000000000000000002",
          patternSet.companions[0] as TaskAssignment["primaryPattern"],
          ["requirement.modify-referral"],
        ),
      ]),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "coverage.pattern_mismatch" }],
    });
  });
});
