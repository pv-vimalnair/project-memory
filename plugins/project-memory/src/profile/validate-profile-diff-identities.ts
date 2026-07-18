import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type { ResolvedProfile } from "./contracts/index.js";

function uniqueIdentities<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  pathValue: string,
): RuntimeResult<true> {
  const seen = new Set<string>();
  for (const value of values) {
    const key = keyOf(value).normalize("NFC").toLowerCase();
    if (seen.has(key)) {
      return failure(
        "PROFILE_DIFF_IDENTITY_DUPLICATE",
        "resolved profile repeats a stable diff identity",
        `${pathValue}/${key}`,
      );
    }
    seen.add(key);
  }
  return success(true);
}

export function validateProfileDiffIdentities(
  profile: ResolvedProfile,
): RuntimeResult<true> {
  const checks = [
    uniqueIdentities(profile.overlays, (value) => value.id, "/overlays"),
    uniqueIdentities(profile.components, (value) => value.instance_id, "/components"),
    uniqueIdentities(profile.domains, (value) => value.instance_id, "/domains"),
    uniqueIdentities(
      profile.adapters,
      (value) => `${value.kind}:${value.definition_id}`,
      "/adapters",
    ),
    uniqueIdentities(profile.rules, (value) => `${value.kind}:${value.id}`, "/rules"),
    uniqueIdentities(profile.gates, (value) => value.id, "/gates"),
    uniqueIdentities(profile.templates, (value) => value.id, "/templates"),
    uniqueIdentities(
      profile.root_relationships,
      (value) => value.relationship_id,
      "/relationships",
    ),
  ];
  return checks.find((result) => !result.ok) ?? success(true);
}
