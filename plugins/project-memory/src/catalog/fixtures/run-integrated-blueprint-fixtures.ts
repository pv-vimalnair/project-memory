import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import {
  normalizeFeatureMap,
  type BlueprintSelectableDefinition,
  type FeatureObservation,
  type SelectionContext,
  type SelectionDecision,
} from "../../selection/index.js";
import type { BlueprintFixture } from "../contracts/index.js";
import type { CatalogSource } from "../load-catalog.js";

export interface IntegratedBlueprintFixtureFailure {
  readonly fixture_id: string;
  readonly expected_decision: BlueprintFixture["expected"]["decision"];
  readonly observed_disposition: SelectionDecision["disposition"] | "selector_error";
  readonly observed_winner_id: string | null;
  readonly missing_reason_codes: readonly string[];
  readonly selector_issue_codes: readonly string[];
}

export interface IntegratedBlueprintFixtureReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly failures: readonly IntegratedBlueprintFixtureFailure[];
}

export interface IntegratedBlueprintFixtureInput {
  readonly selectBlueprint: (
    definitions: readonly BlueprintSelectableDefinition[],
    features: ReturnType<typeof normalizeFeatureMap> extends RuntimeResult<infer T>
      ? T
      : never,
    context: SelectionContext,
  ) => RuntimeResult<SelectionDecision>;
  readonly catalog: CatalogSource;
  readonly fixtures: readonly BlueprintFixture[];
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function projectBlueprints(
  catalog: CatalogSource,
): readonly BlueprintSelectableDefinition[] {
  return [...catalog.blueprints.values()]
    .sort((left, right) => compareUtf8(left.id, right.id))
    .map((blueprint) => ({
      id: blueprint.id,
      version: blueprint.version,
      status: blueprint.status,
      kind: "blueprint" as const,
      compatibility: {
        root_kinds: blueprint.allowed_root_kinds,
        primary_archetypes: [blueprint.primary_archetype],
        profile_ids: [],
        required_overlays: [],
        forbidden_overlays: blueprint.overlays.forbidden,
      },
      selection: blueprint.selection,
      authorization: { mutation: "none", external_action: "none" },
    }));
}

function observations(fixture: BlueprintFixture): readonly FeatureObservation[] {
  return Object.entries(fixture.normalized_features)
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([id, value], index) => ({
      id,
      valueType: Array.isArray(value)
        ? "string-set"
        : typeof value === "boolean"
          ? "boolean"
          : typeof value === "number"
            ? "number"
            : "string",
      value,
      evidenceId: `EVD-${String(index + 1).padStart(26, "0")}`,
      sourceKind: "classifier",
      sourceRef: fixture.id,
      extractorId: "project-memory.catalog-fixture",
      extractorVersion: "1.0.0",
    }));
}

function contextFor(
  fixture: BlueprintFixture,
  catalog: CatalogSource,
): RuntimeResult<SelectionContext> {
  const targetId =
    fixture.expected.blueprint_id ??
    fixture.expected.prohibited_blueprint_ids?.[0];
  if (targetId === undefined) {
    return failure(
      "CATALOG_FIXTURE_TARGET_MISSING",
      "integrated blueprint fixtures require a selected or prohibited target",
      fixture.id,
    );
  }
  const target = catalog.blueprints.get(targetId);
  if (target === undefined) {
    return failure(
      "CATALOG_FIXTURE_TARGET_UNKNOWN",
      `unknown fixture target ${targetId}`,
      fixture.id,
      [targetId],
    );
  }
  const rootKind = fixture.normalized_features["root.kind"];
  if (typeof rootKind !== "string" || !target.allowed_root_kinds.includes(rootKind as never)) {
    return failure(
      "CATALOG_FIXTURE_ROOT_INVALID",
      `fixture root kind is incompatible with ${targetId}`,
      fixture.id,
      [targetId],
    );
  }
  const overlayValue = fixture.normalized_features["profile.overlays"];
  const overlayIds = Array.isArray(overlayValue) ? overlayValue : [];
  return success({
    rootKind: rootKind as SelectionContext["rootKind"],
    primaryArchetype: target.primary_archetype,
    profileId: "profile.catalog-fixture",
    overlayIds,
    lockedDefinitionIds: [],
    migrationAllowed: false,
  });
}

function observedReasonCodes(
  fixture: BlueprintFixture,
  decision: SelectionDecision,
): readonly string[] {
  const codes = new Set<string>();
  const expectedId = fixture.expected.blueprint_id;
  if (expectedId !== undefined && decision.winner?.definition_id === expectedId) {
    codes.add(
      fixture.kind === "blueprint-boundary"
        ? "boundary-primary-match"
        : "exact-shape-match",
    );
    codes.add("compatible-root");
  }
  for (const prohibitedId of fixture.expected.prohibited_blueprint_ids ?? []) {
    const trace = decision.ranked.find(
      (candidate) => candidate.definition_id === prohibitedId,
    );
    if (
      trace?.disqualification_codes.some((code) =>
        code.startsWith("selection.exclusion_matched:"),
      )
    ) {
      codes.add("explicit-exclusion");
      if (fixture.kind === "blueprint-boundary") {
        codes.add("competitor-excluded");
      }
    }
  }
  return [...codes].sort(compareUtf8);
}

function outcomeMatches(
  fixture: BlueprintFixture,
  decision: SelectionDecision,
): boolean {
  if (fixture.expected.decision === "review_required") {
    return decision.disposition === "integrator_review";
  }
  if (fixture.expected.decision === "selected") {
    if (decision.winner?.definition_id !== fixture.expected.blueprint_id) {
      return false;
    }
    return (fixture.expected.prohibited_blueprint_ids ?? []).every(
      (id) =>
        decision.ranked.find((candidate) => candidate.definition_id === id)
          ?.eligible === false,
    );
  }
  return (fixture.expected.prohibited_blueprint_ids ?? []).every(
    (id) =>
      decision.ranked.find((candidate) => candidate.definition_id === id)
        ?.eligible === false,
  );
}

export function runIntegratedBlueprintFixtures(
  input: IntegratedBlueprintFixtureInput,
): RuntimeResult<IntegratedBlueprintFixtureReport> {
  const candidates = projectBlueprints(input.catalog);
  const failures: IntegratedBlueprintFixtureFailure[] = [];
  const fixtures = [...input.fixtures].sort((left, right) =>
    compareUtf8(left.id, right.id),
  );
  for (const fixture of fixtures) {
    const normalized = normalizeFeatureMap(observations(fixture));
    if (!normalized.ok) {
      failures.push({
        fixture_id: fixture.id,
        expected_decision: fixture.expected.decision,
        observed_disposition: "selector_error",
        observed_winner_id: null,
        missing_reason_codes: fixture.expected.reason_codes,
        selector_issue_codes: normalized.issues
          .map((issue) => issue.code)
          .sort(compareUtf8),
      });
      continue;
    }
    const context = contextFor(fixture, input.catalog);
    if (!context.ok) {
      failures.push({
        fixture_id: fixture.id,
        expected_decision: fixture.expected.decision,
        observed_disposition: "selector_error",
        observed_winner_id: null,
        missing_reason_codes: fixture.expected.reason_codes,
        selector_issue_codes: context.issues
          .map((issue) => issue.code)
          .sort(compareUtf8),
      });
      continue;
    }
    const selected = input.selectBlueprint(candidates, normalized.value, context.value);
    if (!selected.ok) {
      failures.push({
        fixture_id: fixture.id,
        expected_decision: fixture.expected.decision,
        observed_disposition: "selector_error",
        observed_winner_id: null,
        missing_reason_codes: fixture.expected.reason_codes,
        selector_issue_codes: selected.issues.map((issue) => issue.code).sort(compareUtf8),
      });
      continue;
    }
    const observedCodes = observedReasonCodes(fixture, selected.value);
    const missingCodes = fixture.expected.reason_codes.filter(
      (code) => !observedCodes.includes(code),
    );
    if (!outcomeMatches(fixture, selected.value) || missingCodes.length > 0) {
      failures.push({
        fixture_id: fixture.id,
        expected_decision: fixture.expected.decision,
        observed_disposition: selected.value.disposition,
        observed_winner_id: selected.value.winner?.definition_id ?? null,
        missing_reason_codes: [...missingCodes].sort(compareUtf8),
        selector_issue_codes: [],
      });
    }
  }
  return success({
    total: fixtures.length,
    passed: fixtures.length - failures.length,
    failed: failures.length,
    failures,
  });
}
