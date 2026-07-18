import {
  failure,
  success,
  type Clock,
  type IdFactory,
  type RuntimeResult,
} from "../index.js";
import { decomposeOutcomes } from "../planning/decompose-outcomes.js";
import type {
  CompileDomainBinding,
  CompileWorkstreamInput,
  CompileWorkstreamResult,
  CoverageMap,
  OutcomeIntent,
} from "../planning/types.js";
import { compileTaskPacket } from "./compile-workstream-packet.js";
import { resolveCompiledImpacts } from "./compile-workstream-impacts.js";
import { evaluatePredicate } from "./evaluate-predicate.js";
import { expandCompanions } from "./expand-companions.js";
import { normalizeFeatureMap } from "./normalize-feature-map.js";
import { selectPattern } from "./score-candidates.js";
import type {
  NormalizedFeatureMap,
  PatternSelectableDefinition,
  ResolvedPattern,
  SelectionDecision,
} from "./types.js";

interface SelectedOutcome {
  readonly outcome: OutcomeIntent;
  readonly features: NormalizedFeatureMap;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function selectable(pattern: ResolvedPattern): PatternSelectableDefinition {
  return {
    id: pattern.id,
    version: pattern.version,
    status: pattern.status,
    kind: "pattern",
    compatibility: {
      ...pattern.compatibility,
      profile_ids: [],
    },
    selection: pattern.selection,
    authorization: {
      mutation: pattern.authorization.mutation,
      external_action: pattern.authorization.external_action,
    },
  };
}

function normalizedOutcome(
  input: CompileWorkstreamInput,
  outcome: OutcomeIntent,
): RuntimeResult<SelectedOutcome | null> {
  const observations = input.observationsByOutcome[outcome.id];
  if (observations === undefined) {
    return failure(
      "compile.observations_missing",
      "every outcome requires normalized source observations",
      outcome.id,
    );
  }
  const normalized = normalizeFeatureMap(observations);
  if (!normalized.ok) return normalized;
  const conditions = input.outcomeConditionsByOutcome[outcome.id] ?? [];
  const evaluations = conditions.map((predicate) =>
    evaluatePredicate(predicate, normalized.value),
  );
  const unresolved = evaluations.find(
    (evaluation) =>
      evaluation.code !== "predicate.matched" &&
      evaluation.code !== "predicate.not_matched",
  );
  if (unresolved !== undefined) {
    return failure(
      "compile.outcome_condition_unresolved",
      "conditional outcomes must resolve from evidence before compilation",
      outcome.id,
      [unresolved.predicate_id, unresolved.code],
    );
  }
  const enabled = conditions.length === 0 || evaluations.some((item) => item.matched);
  return success(enabled ? { outcome, features: normalized.value } : null);
}

function activeOutcomes(
  input: CompileWorkstreamInput,
): RuntimeResult<readonly SelectedOutcome[]> {
  const selected: SelectedOutcome[] = [];
  for (const outcome of [...input.outcomes].sort((left, right) =>
    compareUtf8(left.id, right.id),
  )) {
    const normalized = normalizedOutcome(input, outcome);
    if (!normalized.ok) return normalized;
    if (normalized.value !== null) selected.push(normalized.value);
  }
  const activeIds = new Set(selected.map((item) => item.outcome.id));
  const broken = selected.find((item) =>
    item.outcome.dependsOnOutcomeIds.some((id) => !activeIds.has(id)),
  );
  if (broken !== undefined) {
    return failure(
      "compile.disabled_dependency",
      "an enabled outcome cannot depend on a conditionally disabled outcome",
      broken.outcome.id,
      broken.outcome.dependsOnOutcomeIds.filter((id) => !activeIds.has(id)),
    );
  }
  return success(selected);
}

function selectedPattern(
  input: CompileWorkstreamInput,
  features: NormalizedFeatureMap,
): RuntimeResult<SelectionDecision> {
  const definitions = [...input.catalog.patterns.values()]
    .sort((left, right) => compareUtf8(left.id, right.id))
    .map(selectable);
  const decision = selectPattern(definitions, features, input.selectionContext);
  if (!decision.ok) return decision;
  if (decision.value.winner === null) {
    return failure(
      "compile.pattern_unresolved",
      "workstream compilation requires one evidence-backed primary pattern",
    );
  }
  return decision;
}

function resolvedPatterns(
  input: CompileWorkstreamInput,
  patternIds: readonly string[],
): RuntimeResult<readonly ResolvedPattern[]> {
  const patterns: ResolvedPattern[] = [];
  for (const id of patternIds) {
    const pattern = input.catalog.patterns.get(id);
    if (pattern === undefined) {
      return failure(
        "compile.pattern_missing",
        "locked companion closure references an unavailable pattern",
        id,
      );
    }
    patterns.push(pattern);
  }
  return success(patterns.sort((left, right) => compareUtf8(left.id, right.id)));
}

function nextId(ids: IdFactory, prefix: "WS" | "TASK"): RuntimeResult<string> {
  try {
    return success(ids.next(prefix));
  } catch (error: unknown) {
    return failure(
      "compile.id_generation_failed",
      error instanceof Error ? error.message : String(error),
      prefix,
    );
  }
}

function mergeCoverage(
  target: Record<string, readonly string[]>,
  source: CoverageMap,
): RuntimeResult<true> {
  for (const [requirementId, taskIds] of Object.entries(source.requirementTaskIds)) {
    if (target[requirementId] !== undefined) {
      return failure(
        "compile.coverage_collision",
        "compiled requirement identifiers must be globally unique",
        requirementId,
      );
    }
    target[requirementId] = [...taskIds];
  }
  return success(true);
}

export function compileWorkstream(
  input: CompileWorkstreamInput,
  clock: Clock,
  ids: IdFactory,
): RuntimeResult<CompileWorkstreamResult> {
  const evaluated = clock.now();
  if (!Number.isFinite(evaluated.getTime())) {
    return failure("compile.clock_invalid", "compile clock must be valid");
  }
  const evaluatedAt = evaluated.toISOString();
  const frozenClock: Clock = { now: () => new Date(evaluated.getTime()) };
  const active = activeOutcomes(input);
  if (!active.ok) return active;
  const byId = new Map(active.value.map((item) => [item.outcome.id, item]));
  const initiative = decomposeOutcomes(active.value.map((item) => item.outcome));
  if (!initiative.ok) return initiative;

  const patternSets: CompileWorkstreamResult["patternSets"][number][] = [];
  const assignments: CompileWorkstreamResult["assignments"][number][] = [];
  const taskPackets: CompileWorkstreamResult["taskPackets"][number][] = [];
  const requirementTaskIds: Record<string, readonly string[]> = {};
  let domains: readonly CompileDomainBinding[] = input.domains;

  for (const outcome of initiative.value.workstreams) {
    const selected = byId.get(outcome.id);
    if (selected === undefined) {
      return failure("compile.outcome_state_missing", "active outcome state is unavailable", outcome.id);
    }
    const decision = selectedPattern(input, selected.features);
    if (!decision.ok) return decision;
    const primaryId = decision.value.winner?.definition_id as string;
    const closure = expandCompanions({
      primaryPatternIds: [primaryId],
      features: selected.features,
      catalog: input.catalog,
      applicability: input.applicability,
    });
    if (!closure.ok) return closure;
    const patterns = resolvedPatterns(
      input,
      closure.value.patterns.map((pattern) => pattern.id),
    );
    if (!patterns.ok) return patterns;
    const scopedInput: CompileWorkstreamInput = { ...input, domains };
    const impacts = resolveCompiledImpacts(scopedInput, outcome, patterns.value, ids);
    if (!impacts.ok) return impacts;
    domains = impacts.value.domains;
    const workstreamId = nextId(ids, "WS");
    if (!workstreamId.ok) return workstreamId;
    const taskId = nextId(ids, "TASK");
    if (!taskId.ok) return taskId;
    const compiled = compileTaskPacket({
      source: scopedInput,
      outcome,
      features: selected.features,
      decision: decision.value,
      closure: closure.value,
      patterns: patterns.value,
      impacts: impacts.value.plan,
      workstreamId: workstreamId.value,
      taskId: taskId.value,
      evaluatedAt,
    }, frozenClock, ids);
    if (!compiled.ok) return compiled;
    const merged = mergeCoverage(requirementTaskIds, compiled.value.coverage);
    if (!merged.ok) return merged;
    patternSets.push(compiled.value.patternSet);
    assignments.push(...compiled.value.assignments);
    taskPackets.push(compiled.value.packet);
  }
  return success({
    initiative: initiative.value,
    workstreams: initiative.value.workstreams,
    patternSets,
    assignments,
    taskPackets,
    coverage: {
      requirementTaskIds,
      unassignedRequirementIds: [],
      duplicateExclusiveRequirementIds: [],
    },
  });
}
