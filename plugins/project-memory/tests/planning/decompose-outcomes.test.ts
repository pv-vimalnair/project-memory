import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../src/index.js";
import { decomposeOutcomes } from "../../src/planning/decompose-outcomes.js";
import type { OutcomeIntent } from "../../src/planning/types.js";

const compoundOutcomes: readonly OutcomeIntent[] = [
  {
    id: "outcome.settings-audit",
    statement: "Audit the settings flow",
    primaryMode: "assess",
    acceptanceCriteria: ["Evidence-backed findings are recorded"],
    authorityClass: "integrator",
    releaseFate: "none",
    canCompleteIndependently: true,
    dependsOnOutcomeIds: [],
  },
  {
    id: "outcome.settings-redesign",
    statement: "Redesign the accepted settings problems",
    primaryMode: "design",
    acceptanceCriteria: ["A reviewed design resolves accepted findings"],
    authorityClass: "Pitaji",
    releaseFate: "none",
    canCompleteIndependently: true,
    dependsOnOutcomeIds: ["outcome.settings-audit"],
  },
  {
    id: "outcome.settings-implementation",
    statement: "Implement the accepted settings design",
    primaryMode: "implement",
    acceptanceCriteria: ["The accepted design is implemented and validated"],
    authorityClass: "integrator",
    releaseFate: "planned",
    canCompleteIndependently: true,
    dependsOnOutcomeIds: ["outcome.settings-redesign"],
  },
];

describe("outcome decomposition", () => {
  it("splits audit, redesign, and implementation into sibling workstreams", () => {
    const result = decomposeOutcomes(compoundOutcomes);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.workstreams.map((item) => item.primaryMode)).toEqual([
      "assess",
      "design",
      "implement",
    ]);
    expect(result.value.dependencyEdges).toEqual([
      {
        from: "outcome.settings-audit",
        to: "outcome.settings-redesign",
      },
      {
        from: "outcome.settings-redesign",
        to: "outcome.settings-implementation",
      },
    ]);
  });

  it("is byte-stable when outcomes are shuffled", () => {
    const first = decomposeOutcomes(compoundOutcomes);
    const second = decomposeOutcomes([...compoundOutcomes].reverse());
    if (!first.ok || !second.ok) throw new Error("decomposition failed");
    expect(canonicalJson(first.value)).toBe(canonicalJson(second.value));
  });

  it("rejects a dependency cycle", () => {
    const first = compoundOutcomes[0];
    if (first === undefined) throw new Error("missing fixture outcome");
    const result = decomposeOutcomes([
      { ...first, dependsOnOutcomeIds: ["outcome.settings-redesign"] },
      compoundOutcomes[1] as OutcomeIntent,
    ]);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "outcome.dependency_cycle" }],
    });
  });

  it("rejects an unknown dependency", () => {
    const first = compoundOutcomes[0];
    if (first === undefined) throw new Error("missing fixture outcome");
    expect(
      decomposeOutcomes([
        { ...first, dependsOnOutcomeIds: ["outcome.missing"] },
      ]),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "outcome.unknown_dependency" }],
    });
  });
});
