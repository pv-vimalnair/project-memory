import { describe, expect, it } from "vitest";

import {
  blueprintScoringCandidates,
  patternScoringCandidates,
  scoringContext,
  scoringFeatures,
} from "../fixtures/selection/runtime-fixtures.js";
import {
  scoreCandidates,
  selectBlueprint,
  selectPattern,
} from "../../src/selection/score-candidates.js";
import type {
  PatternSelectableDefinition,
} from "../../src/selection/types.js";

describe("candidate scoring", () => {
  it("auto-selects only at score 80 with margin 15", () => {
    const result = scoreCandidates(
      patternScoringCandidates,
      scoringFeatures,
      scoringContext,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.disposition).toBe("automatic");
    expect(result.value.winner?.score).toBe(80);
    expect(result.value.runner_up?.score).toBe(65);
    expect(result.value.margin).toBe(15);
  });

  it("keeps typed wrappers byte-for-byte equivalent to the shared scorer", () => {
    expect(
      selectBlueprint(
        blueprintScoringCandidates,
        scoringFeatures,
        scoringContext,
      ),
    ).toEqual(
      scoreCandidates(
        blueprintScoringCandidates,
        scoringFeatures,
        scoringContext,
      ),
    );
    expect(
      selectPattern(patternScoringCandidates, scoringFeatures, scoringContext),
    ).toEqual(
      scoreCandidates(patternScoringCandidates, scoringFeatures, scoringContext),
    );
  });

  it("rejects retired and unlocked deprecated definitions", () => {
    const retired = replaceCandidate(baseWinner(), { status: "retired" });
    const deprecated = replaceCandidate(baseRunner(), { status: "deprecated" });
    const result = scoreCandidates(
      [retired, deprecated],
      scoringFeatures,
      scoringContext,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.winner).toBeNull();
    expect(result.value.disposition).toBe("clarification_required");
    expect(
      result.value.ranked.find(
        (candidate) => candidate.definition_id === deprecated.id,
      )?.disqualification_codes,
    ).toContain("selection.status_deprecated");
    expect(
      result.value.ranked.find(
        (candidate) => candidate.definition_id === retired.id,
      )?.disqualification_codes,
    ).toContain("selection.status_retired");
  });

  it("permits a deprecated definition only when locked or migrating", () => {
    const candidate = replaceCandidate(baseWinner(), { status: "deprecated" });
    const locked = scoreCandidates([candidate], scoringFeatures, {
      ...scoringContext,
      lockedDefinitionIds: [candidate.id],
    });
    const migrating = scoreCandidates([candidate], scoringFeatures, {
      ...scoringContext,
      migrationAllowed: true,
    });
    expect(locked.ok && locked.value.winner?.eligible).toBe(true);
    expect(migrating.ok && migrating.value.winner?.eligible).toBe(true);
  });

  it.each([
    ["root kind", { root_kinds: ["program"] }, "selection.root_kind_incompatible"],
    ["archetype", { primary_archetypes: ["game-interactive"] }, "selection.archetype_incompatible"],
    ["profile", { profile_ids: ["profile.other"] }, "selection.profile_incompatible"],
    ["required overlay", { required_overlays: ["overlay.missing"] }, "selection.required_overlay_missing"],
    ["forbidden overlay", { forbidden_overlays: ["overlay.surface.mobile-first"] }, "selection.forbidden_overlay_present"],
  ] as const)("rejects incompatible %s", (_label, compatibility, code) => {
    const candidate = {
      ...baseWinner(),
      compatibility: { ...baseWinner().compatibility, ...compatibility },
    };
    const result = scoreCandidates([candidate], scoringFeatures, scoringContext);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.winner).toBeNull();
    expect(result.value.ranked[0]?.disqualification_codes).toContain(code);
  });

  it("applies required-signal and exclusion gates", () => {
    const required = signal("required", "assess");
    const exclusion = signal("excluded", "implement");
    const candidate = {
      ...baseWinner(),
      selection: {
        ...baseWinner().selection,
        required_signals: [required],
        exclusions: [exclusion],
      },
    };
    const result = scoreCandidates([candidate], scoringFeatures, scoringContext);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ranked[0]?.disqualification_codes).toEqual([
      "selection.exclusion_matched:excluded",
      "selection.required_signal_missing:required",
    ]);
  });

  it("fails closed on an invalid positive-weight contract", () => {
    const candidate = {
      ...baseWinner(),
      selection: { ...baseWinner().selection, max_positive_weight: 99 },
    };
    expect(
      scoreCandidates([candidate], scoringFeatures, scoringContext),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "selection.max_positive_weight_invalid" }],
    });
  });

  it("subtracts matched penalties and clamps raw score at zero", () => {
    const candidate = {
      ...withMatchedWeight(baseWinner(), 60),
      selection: {
        ...withMatchedWeight(baseWinner(), 60).selection,
        negative_signals: [
          { ...signal("penalty", "implement"), penalty: 80 },
        ],
      },
    };
    const result = scoreCandidates([candidate], scoringFeatures, scoringContext);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.winner?.score).toBe(0);
    expect(result.value.disposition).toBe("clarification_required");
  });

  it("tie-breaks by specificity, exact profile, precedence, then least authority", () => {
    const cases: readonly (readonly [string, readonly PatternSelectableDefinition[], string])[] = [
      [
        "specificity",
        equalCandidates({ secondSpecificity: 51 }),
        baseRunner().id,
      ],
      [
        "profile",
        equalCandidates({ firstProfiles: [] }),
        baseRunner().id,
      ],
      [
        "precedence",
        equalCandidates({ secondPrecedence: 51 }),
        baseRunner().id,
      ],
      [
        "authority",
        equalCandidates({ firstAuthority: "approval-required" }),
        baseRunner().id,
      ],
    ];
    for (const [, candidates, expectedId] of cases) {
      const result = scoreCandidates(candidates, scoringFeatures, scoringContext);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.winner?.definition_id).toBe(expectedId);
    }
  });

  it("routes semantic ties and each lower confidence band conservatively", () => {
    const tied = scoreCandidates(
      equalCandidates({}),
      scoringFeatures,
      scoringContext,
    );
    const belowSixty = scoreCandidates(
      [withMatchedWeight(baseWinner(), 59)],
      scoringFeatures,
      scoringContext,
    );
    const sixty = scoreCandidates(
      [withMatchedWeight(baseWinner(), 60)],
      scoringFeatures,
      scoringContext,
    );
    const narrowMargin = scoreCandidates(
      [baseWinner(), withMatchedWeight(baseRunner(), 66)],
      scoringFeatures,
      scoringContext,
    );
    expect(tied.ok && tied.value.disposition).toBe("integrator_review");
    expect(belowSixty.ok && belowSixty.value.disposition).toBe(
      "clarification_required",
    );
    expect(sixty.ok && sixty.value.disposition).toBe("integrator_review");
    expect(narrowMargin.ok && narrowMargin.value.margin).toBe(14);
    expect(narrowMargin.ok && narrowMargin.value.disposition).toBe(
      "integrator_review",
    );
  });

  it("rejects runtime kind mismatches in typed wrappers", () => {
    expect(
      selectPattern(
        blueprintScoringCandidates as unknown as readonly PatternSelectableDefinition[],
        scoringFeatures,
        scoringContext,
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "selection.candidate_kind_mismatch" }],
    });
  });
});

function baseWinner(): PatternSelectableDefinition {
  const value = patternScoringCandidates[0];
  if (value === undefined) throw new Error("winner fixture missing");
  return value;
}

function baseRunner(): PatternSelectableDefinition {
  const value = patternScoringCandidates[1];
  if (value === undefined) throw new Error("runner fixture missing");
  return value;
}

function replaceCandidate(
  candidate: PatternSelectableDefinition,
  patch: Partial<PatternSelectableDefinition>,
): PatternSelectableDefinition {
  return { ...candidate, ...patch };
}

function signal(id: string, expected: string) {
  return {
    id,
    feature: "action.mode",
    operator: "equals" as const,
    expected,
    evidence_required: true,
  };
}

function withMatchedWeight(
  candidate: PatternSelectableDefinition,
  weight: number,
): PatternSelectableDefinition {
  const first = candidate.selection.positive_signals[0];
  const second = candidate.selection.positive_signals[1];
  if (first === undefined || second === undefined) {
    throw new Error("positive scoring fixture incomplete");
  }
  return {
    ...candidate,
    selection: {
      ...candidate.selection,
      positive_signals: [
        { ...first, weight },
        { ...second, weight: 100 - weight },
      ],
    },
  };
}

interface EqualCandidateOptions {
  readonly firstProfiles?: readonly string[];
  readonly secondSpecificity?: number;
  readonly secondPrecedence?: number;
  readonly firstAuthority?: "none" | "task-scoped" | "approval-required";
}

function equalCandidates(
  options: EqualCandidateOptions,
): readonly PatternSelectableDefinition[] {
  const firstBase = withMatchedWeight(baseWinner(), 80);
  const secondBase = withMatchedWeight(baseRunner(), 80);
  return [
    {
      ...firstBase,
      compatibility: {
        ...firstBase.compatibility,
        profile_ids: options.firstProfiles ?? firstBase.compatibility.profile_ids,
      },
      authorization: {
        ...firstBase.authorization,
        mutation: options.firstAuthority ?? firstBase.authorization.mutation,
      },
    },
    {
      ...secondBase,
      selection: {
        ...secondBase.selection,
        specificity_rank:
          options.secondSpecificity ?? secondBase.selection.specificity_rank,
        precedence: options.secondPrecedence ?? secondBase.selection.precedence,
      },
    },
  ];
}

