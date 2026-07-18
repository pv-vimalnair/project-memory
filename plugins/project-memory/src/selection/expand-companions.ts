import { satisfies } from "semver";

import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { evaluatePredicate } from "./evaluate-predicate.js";
import type {
  CompanionClosure,
  CompanionExpansionInput,
  ExpandedPatternReference,
  ResolvedCompanionRule,
  ResolvedPattern,
} from "./types.js";

interface MutableProvenance {
  readonly ruleIds: Set<string>;
  readonly sourcePatternIds: Set<string>;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function applicable(
  definition: ResolvedPattern | ResolvedCompanionRule,
  input: CompanionExpansionInput,
): boolean {
  const { applicability } = input;
  return (
    definition.compatibility.root_kinds.includes(applicability.rootKind) &&
    definition.compatibility.primary_archetypes.includes(
      applicability.primaryArchetype,
    ) &&
    definition.compatibility.required_overlays.every((overlay) =>
      applicability.overlayIds.includes(overlay),
    ) &&
    definition.compatibility.forbidden_overlays.every(
      (overlay) => !applicability.overlayIds.includes(overlay),
    ) &&
    definition.overlay_applicability.forbidden.every(
      (overlay) => !applicability.overlayIds.includes(overlay),
    )
  );
}

function ruleApplies(
  rule: ResolvedCompanionRule,
  input: CompanionExpansionInput,
): RuntimeResult<boolean> {
  const predicates = [
    ...rule.when.all,
    ...rule.when.any,
    ...rule.when.none,
  ];
  const evaluations = predicates.map((predicate) =>
    evaluatePredicate(predicate, input.features),
  );
  const unresolved = evaluations.find(
    (evaluation) =>
      evaluation.code !== "predicate.matched" &&
      evaluation.code !== "predicate.not_matched",
  );
  if (unresolved !== undefined) {
    return failure(
      "companion.condition_unresolved",
      "companion predicates must resolve from normalized evidence",
      rule.id,
      [unresolved.predicate_id, unresolved.code],
    );
  }
  const byId = new Map(
    evaluations.map((evaluation) => [evaluation.predicate_id, evaluation]),
  );
  const matched = (id: string) => byId.get(id)?.matched === true;
  return success(
    rule.when.all.every((predicate) => matched(predicate.id)) &&
      (rule.when.any.length === 0 ||
        rule.when.any.some((predicate) => matched(predicate.id))) &&
      rule.when.none.every((predicate) => !matched(predicate.id)),
  );
}

function authorityExpanded(
  source: ResolvedPattern,
  required: ResolvedPattern,
): boolean {
  const sourceMutation = source.authorization.mutation;
  const requiredMutation = required.authorization.mutation;
  if (sourceMutation === "none" && requiredMutation !== "none") return true;
  if (
    sourceMutation === "approval-required" &&
    requiredMutation === "task-scoped"
  ) {
    return true;
  }
  if (
    source.authorization.external_action === "none" &&
    required.authorization.external_action !== "none"
  ) {
    return true;
  }
  return false;
}

function incompatible(
  left: ResolvedPattern,
  right: ResolvedPattern,
): boolean {
  return (
    left.composition.incompatible_pattern_ids.includes(right.id) ||
    right.composition.incompatible_pattern_ids.includes(left.id)
  );
}

function requiredPattern(
  rule: ResolvedCompanionRule,
  sourcePatterns: readonly ResolvedPattern[],
  requiredId: string,
  versionRange: string,
  input: CompanionExpansionInput,
): RuntimeResult<ResolvedPattern> {
  const pattern = input.catalog.patterns.get(requiredId);
  if (pattern === undefined) {
    return failure(
      "companion.required_pattern_missing",
      "companion rule references an unknown pattern",
      rule.id,
      [requiredId],
    );
  }
  if (!satisfies(pattern.version, versionRange, { includePrerelease: false })) {
    return failure(
      "companion.version_conflict",
      "resolved pattern version does not satisfy companion requirement",
      rule.id,
      [requiredId, pattern.version, versionRange],
    );
  }
  if (!applicable(pattern, input)) {
    return failure(
      "companion.required_pattern_incompatible",
      "required companion pattern is not applicable to this product root",
      rule.id,
      [requiredId],
    );
  }
  const authoritySource = sourcePatterns.find((source) =>
    authorityExpanded(source, pattern),
  );
  if (authoritySource !== undefined) {
    return failure(
      "companion.authority_expansion",
      "companion closure may narrow but never expand authority",
      rule.id,
      [authoritySource.id, requiredId],
    );
  }
  return success(pattern);
}

function closureResult(
  primaryIds: readonly string[],
  patterns: ReadonlyMap<string, ResolvedPattern>,
  provenance: ReadonlyMap<string, MutableProvenance>,
  appliedRuleIds: ReadonlySet<string>,
  iterations: number,
): CompanionClosure {
  const primarySet = new Set(primaryIds);
  const references: ExpandedPatternReference[] = [...patterns.values()]
    .sort((left, right) => compareUtf8(left.id, right.id))
    .map((pattern) => {
      const entry = provenance.get(pattern.id);
      return {
        id: pattern.id,
        version: pattern.version,
        provenanceRuleIds: [...(entry?.ruleIds ?? [])].sort(compareUtf8),
        sourcePatternIds: [...(entry?.sourcePatternIds ?? [])].sort(compareUtf8),
      };
    });
  return {
    patterns: references,
    primaryPatternIds: [...primaryIds],
    companionPatternIds: references
      .map((reference) => reference.id)
      .filter((id) => !primarySet.has(id)),
    appliedRuleIds: [...appliedRuleIds].sort(compareUtf8),
    iterations,
  };
}

export function expandCompanions(
  input: CompanionExpansionInput,
): RuntimeResult<CompanionClosure> {
  const primaryIds = [...new Set(input.primaryPatternIds)].sort(compareUtf8);
  if (primaryIds.length === 0) {
    return failure(
      "companion.primary_required",
      "companion closure requires at least one primary pattern",
    );
  }
  const patterns = new Map<string, ResolvedPattern>();
  const provenance = new Map<string, MutableProvenance>();
  for (const id of primaryIds) {
    const pattern = input.catalog.patterns.get(id);
    if (pattern === undefined) {
      return failure(
        "companion.primary_missing",
        "initial pattern does not exist in the resolved catalog",
        id,
      );
    }
    if (pattern.status !== "active" || !applicable(pattern, input)) {
      return failure(
        "companion.primary_incompatible",
        "initial pattern is not active and applicable",
        id,
      );
    }
    patterns.set(id, pattern);
    provenance.set(id, { ruleIds: new Set(), sourcePatternIds: new Set() });
  }

  const initialPatterns = [...patterns.values()];
  for (let leftIndex = 0; leftIndex < initialPatterns.length; leftIndex += 1) {
    const left = initialPatterns[leftIndex];
    if (left === undefined) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < initialPatterns.length;
      rightIndex += 1
    ) {
      const right = initialPatterns[rightIndex];
      if (right !== undefined && incompatible(left, right)) {
        return failure(
          "companion.incompatible_pair",
          "initial companion closure contains incompatible patterns",
          left.id,
          [left.id, right.id],
        );
      }
    }
  }
  const appliedRuleIds = new Set<string>();
  const expansionBound =
    input.catalog.patterns.size + input.catalog.companionRules.size;
  for (let iteration = 1; iteration <= expansionBound; iteration += 1) {
    const ruleSources = new Map<string, Set<string>>();
    for (const pattern of [...patterns.values()].sort((left, right) =>
      compareUtf8(left.id, right.id),
    )) {
      if (!pattern.composition.triggers_companions) continue;
      for (const ruleId of pattern.composition.mandatory_companion_rule_ids) {
        const sources = ruleSources.get(ruleId) ?? new Set<string>();
        sources.add(pattern.id);
        ruleSources.set(ruleId, sources);
      }
    }

    let added = false;
    for (const ruleId of [...ruleSources.keys()].sort(compareUtf8)) {
      const rule = input.catalog.companionRules.get(ruleId);
      if (rule === undefined) {
        return failure(
          "companion.rule_missing",
          "pattern references an unknown mandatory companion rule",
          ruleId,
        );
      }
      if (rule.status !== "active" || !applicable(rule, input)) {
        return failure(
          "companion.rule_incompatible",
          "mandatory companion rule is not active and applicable",
          ruleId,
        );
      }
      const applies = ruleApplies(rule, input);
      if (!applies.ok) return applies;
      if (!applies.value) continue;
      appliedRuleIds.add(ruleId);
      const sourceIds = [...(ruleSources.get(ruleId) ?? [])].sort(compareUtf8);
      const sourcePatterns = sourceIds.map((id) => patterns.get(id) as ResolvedPattern);
      for (const requirement of [...rule.require_patterns].sort((left, right) =>
        compareUtf8(left.id, right.id),
      )) {
        if (requirement.condition === false) continue;
        if (typeof requirement.condition === "string") {
          return failure(
            "companion.condition_unresolved",
            "string companion requirements must be resolved before closure",
            rule.id,
            [requirement.id, requirement.condition],
          );
        }
        const required = requiredPattern(
          rule,
          sourcePatterns,
          requirement.id,
          requirement.version_range,
          input,
        );
        if (!required.ok) return required;
        const conflict = [...patterns.values()].find((existing) =>
          incompatible(existing, required.value),
        );
        if (conflict !== undefined) {
          return failure(
            "companion.incompatible_pair",
            "companion closure contains incompatible patterns",
            rule.id,
            [conflict.id, required.value.id],
          );
        }
        const entry = provenance.get(required.value.id) ?? {
          ruleIds: new Set<string>(),
          sourcePatternIds: new Set<string>(),
        };
        entry.ruleIds.add(ruleId);
        sourceIds.forEach((id) => entry.sourcePatternIds.add(id));
        provenance.set(required.value.id, entry);
        if (!patterns.has(required.value.id)) {
          patterns.set(required.value.id, required.value);
          added = true;
        }
      }
    }
    if (!added) {
      return success(
        closureResult(
          primaryIds,
          patterns,
          provenance,
          appliedRuleIds,
          iteration,
        ),
      );
    }
  }
  return failure(
    "companion.expansion_bound",
    "companion closure exceeded its deterministic expansion bound",
  );
}
