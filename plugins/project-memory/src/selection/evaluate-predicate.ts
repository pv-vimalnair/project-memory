import type {
  FeaturePredicate,
  NormalizedFeatureMap,
} from "./contracts/index.js";
import type { PredicateEvaluation } from "./types.js";

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function evaluation(
  predicate: FeaturePredicate,
  matched: boolean,
  code: PredicateEvaluation["code"],
  evidenceIds: readonly string[],
): PredicateEvaluation {
  return {
    predicate_id: predicate.id,
    matched,
    code,
    evidence_ids: [...evidenceIds].sort(compareUtf8),
  };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry: unknown) => typeof entry === "string")
  );
}

function equalValues(left: unknown, right: unknown): boolean {
  if (isStringArray(left) && isStringArray(right)) {
    return JSON.stringify([...left].sort(compareUtf8)) ===
      JSON.stringify([...right].sort(compareUtf8));
  }
  return typeof left === typeof right && Object.is(left, right);
}

function existenceMatch(
  actual: unknown,
  expected: unknown,
): boolean | null {
  if (typeof actual === "boolean" && typeof expected === "boolean") {
    return actual === expected;
  }
  if (typeof actual === "string" && typeof expected === "string") {
    return actual === expected;
  }
  if (
    Array.isArray(actual) &&
    actual.every((entry) => typeof entry === "string") &&
    typeof expected === "string"
  ) {
    return actual.includes(expected);
  }
  return null;
}

function regexIsAnchored(pattern: string): boolean {
  if (!pattern.startsWith("^") || !pattern.endsWith("$")) return false;
  let escapingBackslashes = 0;
  for (let index = pattern.length - 2; index >= 0; index -= 1) {
    if (pattern[index] !== "\\") break;
    escapingBackslashes += 1;
  }
  return escapingBackslashes % 2 === 0;
}

function evaluateMatch(
  predicate: FeaturePredicate,
  actual: unknown,
): { readonly matched: boolean; readonly code?: PredicateEvaluation["code"] } {
  switch (predicate.operator) {
    case "equals":
      return { matched: equalValues(actual, predicate.expected) };
    case "in":
      return typeof actual === "string" &&
        Array.isArray(predicate.expected) &&
        predicate.expected.every((entry) => typeof entry === "string")
        ? { matched: predicate.expected.includes(actual) }
        : { matched: false, code: "predicate.type_mismatch" };
    case "contains_token": {
      if (typeof actual !== "string" || typeof predicate.expected !== "string") {
        return { matched: false, code: "predicate.type_mismatch" };
      }
      const tokens = actual
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter((token) => token.length > 0);
      return { matched: tokens.includes(predicate.expected.toLowerCase()) };
    }
    case "path_exists":
    case "record_exists":
    case "tag_present":
    case "relationship_exists": {
      const matched = existenceMatch(actual, predicate.expected);
      return matched === null
        ? { matched: false, code: "predicate.type_mismatch" }
        : { matched };
    }
    case "regex": {
      if (typeof actual !== "string" || typeof predicate.expected !== "string") {
        return { matched: false, code: "predicate.type_mismatch" };
      }
      if (!regexIsAnchored(predicate.expected)) {
        return { matched: false, code: "predicate.regex_unanchored" };
      }
      if (predicate.expected.length > 256) {
        return { matched: false, code: "predicate.regex_invalid" };
      }
      try {
        return { matched: new RegExp(predicate.expected, "u").test(actual) };
      } catch {
        return { matched: false, code: "predicate.regex_invalid" };
      }
    }
  }
}

export function evaluatePredicate(
  predicate: FeaturePredicate,
  features: NormalizedFeatureMap,
): PredicateEvaluation {
  const feature = features.features[predicate.feature];
  if (feature === undefined) {
    return evaluation(predicate, false, "predicate.feature_missing", []);
  }
  const evidenceIds = feature.evidence.map((item) => item.evidence_id);
  if (predicate.evidence_required && evidenceIds.length === 0) {
    return evaluation(predicate, false, "predicate.evidence_missing", []);
  }
  const result = evaluateMatch(predicate, feature.value);
  return evaluation(
    predicate,
    result.matched,
    result.code ?? (result.matched ? "predicate.matched" : "predicate.not_matched"),
    evidenceIds,
  );
}
