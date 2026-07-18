import {
  failure,
  failureFromIssues,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type {
  BlueprintSelectableDefinition,
  PatternSelectableDefinition,
  SelectableDefinition,
  SelectionContext,
} from "./types.js";
import type {
  CandidateScore,
  NormalizedFeatureMap,
  SelectionDecision,
} from "./contracts/index.js";
import { evaluatePredicate } from "./evaluate-predicate.js";

interface ScoredCandidate {
  readonly trace: CandidateScore;
  readonly profile_exact: boolean;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function issue(
  code: string,
  path: string,
  message: string,
  references: readonly string[] = [],
): RuntimeIssue {
  return { code, severity: "error", path, message, references };
}

function validateCandidateContracts(
  definitions: readonly SelectableDefinition[],
): readonly RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];
  const definitionIds = new Set<string>();
  for (const definition of [...definitions].sort((left, right) =>
    compareUtf8(left.id, right.id)
  )) {
    if (definitionIds.has(definition.id)) {
      issues.push(
        issue(
          "selection.duplicate_candidate",
          definition.id,
          `candidate ${definition.id} appears more than once`,
        ),
      );
    }
    definitionIds.add(definition.id);
    const weights = definition.selection.positive_signals.map(
      (signal) => signal.weight,
    );
    const validWeights = weights.every(
      (weight) =>
        weight !== undefined &&
        Number.isInteger(weight) &&
        weight >= 1 &&
        weight <= 100,
    );
    const weightSum = weights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0);
    if (
      !validWeights ||
      definition.selection.max_positive_weight <= 0 ||
      weightSum !== definition.selection.max_positive_weight
    ) {
      issues.push(
        issue(
          "selection.max_positive_weight_invalid",
          `${definition.id}/selection/max_positive_weight`,
          "max positive weight must equal the positive signal weight sum and be greater than zero",
        ),
      );
    }
    for (const signal of definition.selection.negative_signals) {
      if (
        signal.penalty === undefined ||
        !Number.isInteger(signal.penalty) ||
        signal.penalty < 1 ||
        signal.penalty > 100
      ) {
        issues.push(
          issue(
            "selection.negative_penalty_invalid",
            `${definition.id}/selection/negative_signals/${signal.id}`,
            "negative signals require an integer penalty from 1 to 100",
          ),
        );
      }
    }
    const signalIds = [
      ...definition.selection.required_signals,
      ...definition.selection.positive_signals,
      ...definition.selection.negative_signals,
      ...definition.selection.exclusions,
    ].map((signal) => signal.id);
    if (new Set(signalIds).size !== signalIds.length) {
      issues.push(
        issue(
          "selection.duplicate_signal_id",
          `${definition.id}/selection`,
          "signal IDs must be unique within one candidate",
        ),
      );
    }
  }
  return issues.sort((left, right) => {
    const byPath = compareUtf8(left.path, right.path);
    return byPath === 0 ? compareUtf8(left.code, right.code) : byPath;
  });
}

function authorityRank(definition: SelectableDefinition): number {
  const mutation = {
    none: 0,
    "task-scoped": 1,
    "approval-required": 2,
  }[definition.authorization.mutation];
  const external =
    definition.authorization.external_action === "none" ? 0 : 3;
  return mutation + external;
}

function compatibilityCodes(
  definition: SelectableDefinition,
  context: SelectionContext,
): readonly string[] {
  const codes: string[] = [];
  const compatibility = definition.compatibility;
  if (!compatibility.root_kinds.includes(context.rootKind)) {
    codes.push("selection.root_kind_incompatible");
  }
  if (!compatibility.primary_archetypes.includes(context.primaryArchetype)) {
    codes.push("selection.archetype_incompatible");
  }
  if (
    compatibility.profile_ids.length > 0 &&
    !compatibility.profile_ids.includes(context.profileId)
  ) {
    codes.push("selection.profile_incompatible");
  }
  if (
    compatibility.required_overlays.some(
      (required) => !context.overlayIds.includes(required),
    )
  ) {
    codes.push("selection.required_overlay_missing");
  }
  if (
    compatibility.forbidden_overlays.some((forbidden) =>
      context.overlayIds.includes(forbidden)
    )
  ) {
    codes.push("selection.forbidden_overlay_present");
  }
  return codes;
}

function statusCodes(
  definition: SelectableDefinition,
  context: SelectionContext,
): readonly string[] {
  if (definition.status === "retired") return ["selection.status_retired"];
  if (
    definition.status === "deprecated" &&
    !context.lockedDefinitionIds.includes(definition.id) &&
    !context.migrationAllowed
  ) {
    return ["selection.status_deprecated"];
  }
  return [];
}

function scoreCandidate(
  definition: SelectableDefinition,
  features: NormalizedFeatureMap,
  context: SelectionContext,
): ScoredCandidate {
  const disqualifications = [
    ...statusCodes(definition, context),
    ...compatibilityCodes(definition, context),
  ];
  for (const signal of definition.selection.required_signals) {
    if (!evaluatePredicate(signal, features).matched) {
      disqualifications.push(`selection.required_signal_missing:${signal.id}`);
    }
  }
  for (const signal of definition.selection.exclusions) {
    if (evaluatePredicate(signal, features).matched) {
      disqualifications.push(`selection.exclusion_matched:${signal.id}`);
    }
  }
  const matchedPositive = definition.selection.positive_signals.filter(
    (signal) => evaluatePredicate(signal, features).matched,
  );
  const matchedNegative = definition.selection.negative_signals.filter(
    (signal) => evaluatePredicate(signal, features).matched,
  );
  const positive = matchedPositive.reduce(
    (sum, signal) => sum + (signal.weight ?? 0),
    0,
  );
  const negative = matchedNegative.reduce(
    (sum, signal) => sum + (signal.penalty ?? 0),
    0,
  );
  const raw = Math.max(0, positive - negative);
  const score = Math.min(
    100,
    Math.round((100 * raw) / definition.selection.max_positive_weight),
  );
  return {
    profile_exact: definition.compatibility.profile_ids.includes(
      context.profileId,
    ),
    trace: {
      definition_id: definition.id,
      version: definition.version,
      eligible: disqualifications.length === 0,
      score,
      matched_positive_ids: [...new Set(matchedPositive.map((item) => item.id))].sort(compareUtf8),
      matched_negative_ids: [...new Set(matchedNegative.map((item) => item.id))].sort(compareUtf8),
      disqualification_codes: [...new Set(disqualifications)].sort(compareUtf8),
      specificity_rank: definition.selection.specificity_rank,
      precedence: definition.selection.precedence,
      authority_rank: authorityRank(definition),
    },
  };
}

function compareScored(left: ScoredCandidate, right: ScoredCandidate): number {
  if (left.trace.eligible !== right.trace.eligible) {
    return left.trace.eligible ? -1 : 1;
  }
  if (left.trace.score !== right.trace.score) {
    return right.trace.score - left.trace.score;
  }
  if (left.trace.specificity_rank !== right.trace.specificity_rank) {
    return right.trace.specificity_rank - left.trace.specificity_rank;
  }
  if (left.profile_exact !== right.profile_exact) {
    return left.profile_exact ? -1 : 1;
  }
  if (left.trace.precedence !== right.trace.precedence) {
    return right.trace.precedence - left.trace.precedence;
  }
  if (left.trace.authority_rank !== right.trace.authority_rank) {
    return left.trace.authority_rank - right.trace.authority_rank;
  }
  const byId = compareUtf8(left.trace.definition_id, right.trace.definition_id);
  return byId === 0
    ? compareUtf8(right.trace.version, left.trace.version)
    : byId;
}

function semanticTie(left: ScoredCandidate, right: ScoredCandidate): boolean {
  return (
    left.trace.score === right.trace.score &&
    left.trace.specificity_rank === right.trace.specificity_rank &&
    left.profile_exact === right.profile_exact &&
    left.trace.precedence === right.trace.precedence &&
    left.trace.authority_rank === right.trace.authority_rank
  );
}

export function scoreCandidates(
  definitions: readonly SelectableDefinition[],
  features: NormalizedFeatureMap,
  context: SelectionContext,
): RuntimeResult<SelectionDecision> {
  const invalid = validateCandidateContracts(definitions);
  if (invalid.length > 0) return failureFromIssues(invalid);
  const scored = definitions
    .map((definition) => scoreCandidate(definition, features, context))
    .sort(compareScored);
  const eligible = scored.filter((candidate) => candidate.trace.eligible);
  const winner = eligible[0] ?? null;
  const runnerUp = eligible[1] ?? null;
  const margin =
    winner === null
      ? null
      : runnerUp === null
        ? 100
        : winner.trace.score - runnerUp.trace.score;
  let disposition: SelectionDecision["disposition"];
  if (winner === null || winner.trace.score < 60) {
    disposition = "clarification_required";
  } else if (
    runnerUp !== null && semanticTie(winner, runnerUp)
  ) {
    disposition = "integrator_review";
  } else if (winner.trace.score >= 80 && (margin ?? 0) >= 15) {
    disposition = "automatic";
  } else {
    disposition = "integrator_review";
  }
  return success({
    disposition,
    winner: winner?.trace ?? null,
    runner_up: runnerUp?.trace ?? null,
    margin,
    ranked: scored.map((candidate) => candidate.trace),
  });
}

function kindCheckedScore(
  expected: "blueprint" | "pattern",
  definitions: readonly SelectableDefinition[],
  features: NormalizedFeatureMap,
  context: SelectionContext,
): RuntimeResult<SelectionDecision> {
  const mismatch = definitions.find((definition) => definition.kind !== expected);
  return mismatch === undefined
    ? scoreCandidates(definitions, features, context)
    : failure(
        "selection.candidate_kind_mismatch",
        `expected ${expected} candidate, found ${mismatch.kind}`,
        mismatch.id,
      );
}

export function selectBlueprint(
  definitions: readonly BlueprintSelectableDefinition[],
  features: NormalizedFeatureMap,
  context: SelectionContext,
): RuntimeResult<SelectionDecision> {
  return kindCheckedScore("blueprint", definitions, features, context);
}

export function selectPattern(
  definitions: readonly PatternSelectableDefinition[],
  features: NormalizedFeatureMap,
  context: SelectionContext,
): RuntimeResult<SelectionDecision> {
  return kindCheckedScore("pattern", definitions, features, context);
}
