import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import { compareUtf8 } from "./catalog-selection-model.js";

function semanticValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(semanticValue)
      .sort((left, right) => compareUtf8(canonicalJson(left), canonicalJson(right)));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([key, entry]) => [key, semanticValue(entry)]),
    );
  }
  return value;
}

export function semanticProfileJson(value: unknown): string {
  return canonicalJson(semanticValue(value));
}

export function semanticProfileFingerprint(value: unknown): string {
  return sha256(semanticProfileJson(value));
}

export function semanticSetOnlyAdds(
  before: readonly unknown[],
  after: readonly unknown[],
): boolean {
  const afterSet = new Set(after.map(semanticProfileJson));
  return before.every((value) => afterSet.has(semanticProfileJson(value)));
}
