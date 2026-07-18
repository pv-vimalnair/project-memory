import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../src/index.js";
import { mergeImpacts } from "../../src/planning/merge-impacts.js";
import type {
  ImpactEntry,
  ImpactMergeInput,
} from "../../src/planning/types.js";

const TARGET = "CMP-01J00000000000000000000001";
const SECOND_TARGET = "DOM-01J00000000000000000000001";

function impact(overrides: Partial<ImpactEntry> = {}): ImpactEntry {
  return {
    sourceId: "pattern.ux.flow.design",
    targetKind: "component",
    targetId: TARGET,
    requirement: "required",
    duties: ["modify"],
    readPaths: ["lib/features/settings/**"],
    writePaths: ["lib/features/settings/**"],
    requiredEvidenceIds: ["ux-review"],
    requiredRecordTypes: ["change"],
    responsibleRole: "worker",
    ...overrides,
  };
}

function mergeInput(overrides: Partial<ImpactMergeInput> = {}): ImpactMergeInput {
  return {
    immutableImpacts: [],
    rootPolicyImpacts: [],
    overlayImpacts: [],
    patternImpacts: [impact()],
    ownedPathsByTarget: { [TARGET]: ["lib/features/settings/**"] },
    claimCandidatePaths: ["lib/features/**"],
    acceptedDecisionScopes: [],
    approvalScopes: [],
    dependencyEdges: [],
    ...overrides,
  };
}

describe("impact precedence and path intersection", () => {
  it("rejects required impact against a not-applicable component", () => {
    const result = mergeImpacts(
      mergeInput({
        immutableImpacts: [
          impact({
            sourceId: "policy.settings.no-touch",
            requirement: "not_applicable",
            duties: ["no-touch"],
            readPaths: [],
            writePaths: [],
            responsibleRole: "Pitaji",
          }),
        ],
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "impact.required_not_applicable" }],
    });
  });

  it("preserves precedence provenance and narrows mutation paths", () => {
    const input = mergeInput({
      rootPolicyImpacts: [
        impact({
          sourceId: "policy.settings.validation",
          duties: ["inspect", "validate"],
          writePaths: [],
          responsibleRole: "validator",
        }),
      ],
      acceptedDecisionScopes: [["lib/features/settings/**"]],
      approvalScopes: [["lib/features/settings/profile/**"]],
    });
    const first = mergeImpacts(input);
    const second = mergeImpacts({
      ...input,
      rootPolicyImpacts: [...input.rootPolicyImpacts].reverse(),
      patternImpacts: [...input.patternImpacts].reverse(),
    });
    if (!first.ok || !second.ok) throw new Error("impact merge failed");

    expect(first.value.mutationPaths).toEqual([
      "lib/features/settings/profile/**",
    ]);
    expect(first.value.impacts[0]).toMatchObject({
      duties: ["inspect", "modify", "validate"],
      sourceIds: ["pattern.ux.flow.design", "policy.settings.validation"],
      responsibleRole: "validator",
    });
    expect(canonicalJson(first.value)).toBe(canonicalJson(second.value));
  });

  it("rejects no-touch combined with mutation", () => {
    expect(
      mergeImpacts(
        mergeInput({
          immutableImpacts: [
            impact({
              sourceId: "immutable.no-touch",
              duties: ["no-touch"],
              writePaths: [],
              responsibleRole: "Pitaji",
            }),
          ],
        }),
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "impact.no_touch_conflict" }],
    });
  });

  it("rejects an empty effective write scope", () => {
    expect(
      mergeImpacts(
        mergeInput({ claimCandidatePaths: ["firebase/functions/**"] }),
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "impact.empty_write_scope" }],
    });
  });

  it("fails closed when a required approval scope is absent", () => {
    expect(
      mergeImpacts(
        mergeInput({
          patternImpacts: [
            impact({ duties: ["release"], responsibleRole: "Pitaji" }),
          ],
          approvalRequired: true,
        }),
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "impact.missing_required_approval" }],
    });
  });

  it("rejects an impact whose target is not in the locked profile", () => {
    expect(
      mergeImpacts(
        mergeInput({ ownedPathsByTarget: {} }),
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "impact.unknown_target" }],
    });
  });
});

describe("impact dependency cycles", () => {
  function cyclicInput(coordinatedTargetIds: readonly string[] = []) {
    return mergeInput({
      patternImpacts: [
        impact(),
        impact({
          sourceId: "domain.settings.persistence",
          targetKind: "domain",
          targetId: SECOND_TARGET,
          readPaths: ["firebase/settings/**"],
          writePaths: ["firebase/settings/**"],
        }),
      ],
      ownedPathsByTarget: {
        [TARGET]: ["lib/features/settings/**"],
        [SECOND_TARGET]: ["firebase/settings/**"],
      },
      claimCandidatePaths: [
        "lib/features/settings/**",
        "firebase/settings/**",
      ],
      dependencyEdges: [
        { from: TARGET, to: SECOND_TARGET },
        { from: SECOND_TARGET, to: TARGET },
      ],
      coordinatedTargetIds,
    });
  }

  it("rejects a mutation cycle without coordinated claims", () => {
    expect(mergeImpacts(cyclicInput())).toMatchObject({
      ok: false,
      issues: [{ code: "impact.dependency_cycle_uncoordinated" }],
    });
  });

  it("allows a mutation cycle with explicit paths and coordination", () => {
    const result = mergeImpacts(cyclicInput([TARGET, SECOND_TARGET]));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.mutationPaths).toEqual([
      "firebase/settings/**",
      "lib/features/settings/**",
    ]);
  });
});
