import semver from "semver";

import type {
  AdapterDefinition,
  CompanionTaxonomyBinding,
  PatternTaxonomyBinding,
} from "../catalog/contracts/index.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { compareUtf8, isTaxonomyCompatible } from "./catalog-selection-model.js";
import type { ProfileCatalogIndex } from "./compatibility.js";
import type {
  LockedDefinition,
  ProjectSelection,
  ResolvedGateExecution,
  ResolvedRule,
} from "./contracts/index.js";
import { sortedUniqueStrings } from "./profile-expansion-structure.js";

export interface ResolvedProfileRules {
  readonly values: ResolvedRule[];
  readonly pattern_taxonomy: ReadonlyMap<string, PatternTaxonomyBinding>;
  readonly companion_taxonomy: ReadonlyMap<string, CompanionTaxonomyBinding>;
}

type RuleLock = LockedDefinition & {
  readonly kind: "pattern" | "companion";
};

function isRuleLock(lock: LockedDefinition): lock is RuleLock {
  return lock.kind === "pattern" || lock.kind === "companion";
}

function selectedRuleLocks(index: ProfileCatalogIndex): RuleLock[] {
  return [...index.locks.values()]
    .filter(isRuleLock)
    .sort((left, right) =>
      compareUtf8(`${left.kind}:${left.id}`, `${right.kind}:${right.id}`),
    );
}

export function resolveProfileRules(
  selection: ProjectSelection,
  index: ProfileCatalogIndex,
  overlays: readonly LockedDefinition[],
): RuntimeResult<ResolvedProfileRules> {
  const overlayIds = new Set(overlays.map((overlay) => overlay.id));
  const values: ResolvedRule[] = [];
  const ruleIds = new Set<string>();
  for (const lock of selectedRuleLocks(index)) {
    const core =
      lock.kind === "pattern"
        ? index.pattern_cores.get(lock.id)
        : index.companion_cores.get(lock.id);
    const taxonomy =
      lock.kind === "pattern"
        ? index.pattern_taxonomy.get(lock.id)
        : index.companion_taxonomy.get(lock.id);
    if (core === undefined || taxonomy === undefined) {
      return failure(
        "PROFILE_RULE_CLOSURE_INCOMPLETE",
        `${lock.id} is missing a core or taxonomy half`,
        lock.id,
      );
    }
    const taxonomyVersion =
      "pattern_version" in taxonomy
        ? taxonomy.pattern_version
        : taxonomy.rule_version;
    if (core.version !== lock.version || taxonomyVersion !== lock.version) {
      return failure(
        "PROFILE_DEFINITION_VERSION_CONFLICT",
        `${lock.id} rule halves do not match the locked version`,
        lock.id,
      );
    }
    if (
      core.status !== "active" ||
      !isTaxonomyCompatible(taxonomy, selection, overlayIds)
    ) {
      return failure(
        "PROFILE_RULE_INCOMPATIBLE",
        `${lock.id} is not active and compatible with the selected profile`,
        lock.id,
      );
    }
    ruleIds.add(lock.id);
    values.push({
      kind: lock.kind,
      id: lock.id,
      version: lock.version,
      target_path: lock.target_path,
      target_sha256: lock.target_sha256,
    });
  }

  for (const [id, pattern] of index.pattern_cores) {
    if (!ruleIds.has(id)) continue;
    for (const companionId of pattern.composition.mandatory_companion_rule_ids) {
      if (!ruleIds.has(companionId)) {
        return failure(
          "PROFILE_RULE_CLOSURE_INCOMPLETE",
          `${id} requires companion ${companionId}`,
          id,
          [companionId],
        );
      }
    }
  }
  for (const [id, companion] of index.companion_cores) {
    if (!ruleIds.has(id)) continue;
    for (const required of companion.require_patterns) {
      const pattern = index.pattern_cores.get(required.id);
      if (
        required.condition !== false &&
        (pattern === undefined ||
          !ruleIds.has(required.id) ||
          !semver.satisfies(pattern.version, required.version_range))
      ) {
        return failure(
          "PROFILE_RULE_CLOSURE_INCOMPLETE",
          `${id} requires pattern ${required.id}@${required.version_range}`,
          id,
          [required.id],
        );
      }
    }
  }
  return success({
    values: values.sort((left, right) => compareUtf8(left.id, right.id)),
    pattern_taxonomy: index.pattern_taxonomy,
    companion_taxonomy: index.companion_taxonomy,
  });
}

export function buildProfileGates(
  blueprintId: string,
  blueprintGates: readonly string[],
  adapters: readonly AdapterDefinition[],
  index: ProfileCatalogIndex,
  rules: readonly ResolvedRule[],
): RuntimeResult<ResolvedGateExecution[]> {
  const commands = sortedUniqueStrings(
    adapters.flatMap((adapter) => adapter.supported_commands),
  );
  const evidence = new Set(blueprintGates);
  for (const adapter of adapters) {
    adapter.validation_gates.forEach((item) => evidence.add(item));
  }
  for (const rule of rules) {
    if (rule.kind === "pattern") {
      const core = index.pattern_cores.get(rule.id);
      core?.gates.forEach((item) => evidence.add(item));
      core?.evidence.forEach((item) => evidence.add(item));
    } else {
      index.companion_cores
        .get(rule.id)
        ?.require_evidence.forEach((item) => evidence.add(item));
    }
  }
  const requiredEvidence = [...evidence].sort(compareUtf8);
  if (requiredEvidence.length === 0) return success([]);
  if (commands.length === 0) {
    return failure(
      "PROFILE_GATE_CLOSURE_INCOMPLETE",
      "profile validation requirements have no selected adapter commands",
      blueprintId,
    );
  }
  return success([
    {
      id: `gate.profile.${blueprintId}`,
      source_definition_ids: sortedUniqueStrings([
        blueprintId,
        ...adapters.map((adapter) => adapter.id),
        ...rules.map((rule) => rule.id),
      ]),
      commands,
      required_evidence: requiredEvidence,
    },
  ]);
}
