import { describe, expect, it } from "vitest";

import { evaluatePredicate } from "../../src/selection/evaluate-predicate.js";
import { normalizeFeatureMap } from "../../src/selection/normalize-feature-map.js";
import type {
  FeaturePredicate,
  NormalizedFeatureMap,
} from "../../src/selection/types.js";

describe("predicate evaluation", () => {
  it.each([
    ["equals", "action.mode", "implement"],
    ["in", "action.mode", ["change", "implement"]],
    ["contains_token", "request.text", "audit"],
    ["path_exists", "repository.paths", "lib/app.dart"],
    ["record_exists", "memory.records", "decision.auth"],
    ["tag_present", "project.tags", "mobile"],
    ["relationship_exists", "graph.relationships", "feature->auth"],
    ["regex", "request.text", "^Implement audit$"]
  ] as const)("matches %s deterministically", (operator, feature, expected) => {
    const result = evaluatePredicate(
      predicate(
        operator,
        feature,
        typeof expected === "object" ? [...expected] : expected,
      ),
      featureMap(),
    );
    expect(result).toMatchObject({
      predicate_id: `predicate.${operator}`,
      matched: true,
      code: "predicate.matched",
    });
    expect(result.evidence_ids).toEqual([
      "EVD-01J00000000000000000000001",
    ]);
  });

  it("returns stable missing-feature, evidence, and type codes", () => {
    expect(
      evaluatePredicate(
        predicate("equals", "missing.value", "x"),
        featureMap(),
      ).code,
    ).toBe("predicate.feature_missing");

    const withoutEvidence: NormalizedFeatureMap = {
      schema_version: "1.0.0",
      features: {
        "request.text": {
          id: "request.text",
          value_type: "string",
          value: "audit",
          evidence: [],
        },
      },
    };
    expect(
      evaluatePredicate(
        predicate("equals", "request.text", "audit"),
        withoutEvidence,
      ).code,
    ).toBe("predicate.evidence_missing");
    expect(
      evaluatePredicate(
        predicate("contains_token", "request.count", "audit"),
        featureMap(),
      ).code,
    ).toBe("predicate.type_mismatch");
  });

  it("rejects unsafe regular expressions", () => {
    expect(
      evaluatePredicate(
        predicate("regex", "request.text", "audit"),
        featureMap(),
      ).code,
    ).toBe("predicate.regex_unanchored");
    expect(
      evaluatePredicate(
        predicate("regex", "request.text", "^(audit$"),
        featureMap(),
      ).code,
    ).toBe("predicate.regex_invalid");
    expect(
      evaluatePredicate(
        predicate("regex", "request.text", `^${"a".repeat(255)}$`),
        featureMap(),
      ).code,
    ).toBe("predicate.regex_invalid");
  });
});

function predicate(
  operator: FeaturePredicate["operator"],
  feature: string,
  expected: FeaturePredicate["expected"],
): FeaturePredicate {
  return {
    id: `predicate.${operator}`,
    feature,
    operator,
    expected,
    evidence_required: true,
  };
}

function featureMap(): NormalizedFeatureMap {
  const observations = [
    ["action.mode", "string", "implement"],
    ["request.text", "string", "Implement audit"],
    ["request.count", "number", 1],
    ["repository.paths", "string-set", ["lib/app.dart"]],
    ["memory.records", "string-set", ["decision.auth"]],
    ["project.tags", "string-set", ["mobile"]],
    ["graph.relationships", "string-set", ["feature->auth"]],
  ] as const;
  const result = normalizeFeatureMap(
    observations.map(([id, valueType, value]) => ({
      id,
      valueType,
      value,
      evidenceId: "EVD-01J00000000000000000000001",
      sourceRef: "brief:1",
    })),
  );
  if (!result.ok) throw new Error("predicate fixture normalization failed");
  return result.value;
}
