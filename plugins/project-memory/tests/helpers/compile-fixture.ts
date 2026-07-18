import { readFile } from "node:fs/promises";

import {
  failure,
  parseYamlDocument,
  success,
  type RuntimeResult,
} from "../../src/index.js";
import { loadCatalog } from "../../src/catalog/index.js";
import type {
  CompileWorkstreamInput,
  OutcomeIntent,
} from "../../src/planning/types.js";
import { loadResolvedPatterns } from "../../src/selection/load-pattern-halves.js";
import type {
  FeatureObservation,
  FeaturePredicate,
  ResolvedPatternCatalog,
} from "../../src/selection/types.js";
import {
  parseCompileScenario,
  type RawCompileOutcome,
  type RawCompileScenario,
} from "./compile-fixture-parser.js";

const CATALOG_ROOT = new URL("../../catalog/project-memory/v1/", import.meta.url);
let catalogResult: Promise<RuntimeResult<ResolvedPatternCatalog>> | undefined;

async function loadResolvedCatalog(): Promise<
  RuntimeResult<ResolvedPatternCatalog>
> {
  const loaded = await loadCatalog(CATALOG_ROOT);
  if (!loaded.ok) {
    return failure(
      "compile.catalog_load_failed",
      "locked compile catalog could not be loaded",
      CATALOG_ROOT.href,
      loaded.issues.map((issue) => `${issue.code}:${issue.path}`),
    );
  }
  return loadResolvedPatterns(loaded.value);
}

function catalog(): Promise<RuntimeResult<ResolvedPatternCatalog>> {
  catalogResult ??= loadResolvedCatalog();
  return catalogResult;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function evidenceId(counter: { value: number }): string {
  counter.value += 1;
  return `EVD-01J${String(counter.value).padStart(23, "0")}`;
}

function observation(
  scenario: RawCompileScenario,
  outcome: RawCompileOutcome,
  counter: { value: number },
  id: string,
  value: string | number | boolean | readonly string[],
): FeatureObservation {
  return {
    id,
    valueType: Array.isArray(value)
      ? "string-set"
      : typeof value === "string"
        ? "string"
        : typeof value === "number"
          ? "number"
          : "boolean",
    value,
    evidenceId: evidenceId(counter),
    sourceKind: "brief",
    sourceRef: `${scenario.scenario_id}:${outcome.id}:${id}`,
    sourceText: outcome.statement,
    extractorId: "fixture.compile-scenario",
    extractorVersion: "1.0.0",
  };
}

function observations(
  scenario: RawCompileScenario,
  outcome: RawCompileOutcome,
  counter: { value: number },
): readonly FeatureObservation[] {
  const base: FeatureObservation[] = [
    observation(scenario, outcome, counter, "action.mode", outcome.mode),
    observation(scenario, outcome, counter, "work.family", outcome.family),
    observation(scenario, outcome, counter, "work.object", outcome.object),
    observation(
      scenario,
      outcome,
      counter,
      "project.tags",
      [...new Set([outcome.family, outcome.object])].sort(compareUtf8),
    ),
    observation(scenario, outcome, counter, "work.anti-patterns", []),
    observation(scenario, outcome, counter, "work.exclusions", []),
  ];
  for (const [id, value] of Object.entries(scenario.feature_flags).sort(
    ([left], [right]) => compareUtf8(left, right),
  )) {
    base.push(observation(scenario, outcome, counter, id, value));
  }
  return base;
}

function outcomeIntent(outcome: RawCompileOutcome): OutcomeIntent {
  return {
    id: outcome.id,
    statement: outcome.statement,
    primaryMode: outcome.mode,
    acceptanceCriteria: [...outcome.acceptance_criteria],
    authorityClass: outcome.authority_class,
    releaseFate: outcome.release_fate,
    canCompleteIndependently: outcome.can_complete_independently,
    dependsOnOutcomeIds: [...outcome.depends_on],
  };
}

function conditions(
  outcome: RawCompileOutcome,
): readonly FeaturePredicate[] {
  return (outcome.enabled_when_any ?? []).map((condition, index) => ({
    id: `${outcome.id}.enabled.${String(index + 1)}`,
    feature: condition.feature,
    operator: "equals",
    expected: condition.expected,
    evidence_required: true,
  }));
}

function hydrate(
  scenario: RawCompileScenario,
  resolvedCatalog: ResolvedPatternCatalog,
): RuntimeResult<CompileWorkstreamInput> {
  const outcomeIds = new Set(scenario.outcomes.map((outcome) => outcome.id));
  if (
    outcomeIds.size !== scenario.outcomes.length ||
    scenario.outcomes.some((outcome) =>
      outcome.depends_on.some((id) => !outcomeIds.has(id)),
    ) ||
    Object.keys(scenario.external_authorizations).some(
      (id) => !outcomeIds.has(id),
    )
  ) {
    return failure(
      "compile.fixture_outcome_reference_invalid",
      "outcome IDs and all outcome references must be unique and known",
      scenario.scenario_id,
    );
  }
  const counter = { value: 0 };
  const observationsByOutcome: Record<string, readonly FeatureObservation[]> = {};
  const outcomeConditionsByOutcome: Record<
    string,
    readonly FeaturePredicate[]
  > = {};
  const authorizedPathsByOutcome: Record<string, readonly string[]> = {};
  const exclusionsByOutcome: Record<string, readonly string[]> = {};
  for (const outcome of scenario.outcomes) {
    observationsByOutcome[outcome.id] = observations(
      scenario,
      outcome,
      counter,
    );
    outcomeConditionsByOutcome[outcome.id] = conditions(outcome);
    authorizedPathsByOutcome[outcome.id] = [...outcome.paths];
    exclusionsByOutcome[outcome.id] = [...outcome.exclusions];
  }
  return success({
    outcomes: scenario.outcomes.map(outcomeIntent),
    observationsByOutcome,
    outcomeConditionsByOutcome,
    catalog: resolvedCatalog,
    selectionContext: {
      rootKind: scenario.root.kind,
      primaryArchetype: scenario.root.primary_archetype,
      profileId: scenario.root.profile_id,
      overlayIds: [...scenario.root.overlay_ids],
      lockedDefinitionIds: [],
      migrationAllowed: false,
    },
    applicability: {
      rootKind: scenario.root.kind,
      primaryArchetype: scenario.root.primary_archetype,
      overlayIds: [...scenario.root.overlay_ids],
      artifactTypes: [...scenario.artifact_types],
    },
    root: {
      id: scenario.root.id,
      profile_lock_hash: scenario.root.profile_lock_hash,
      catalog_release: scenario.root.catalog_release,
      catalog_hash: scenario.root.catalog_hash,
    },
    initiativeId: scenario.initiative_id,
    repository: scenario.repository,
    originalBaseRevision: scenario.original_base_revision,
    integratorId: scenario.integrator_id,
    workerId: scenario.worker_id,
    components: scenario.components.map((component) => ({
      instanceId: component.instance_id,
      definitionId: component.definition_id,
      type: component.type,
      tags: [...component.tags],
      dependencyRules: [...component.dependency_rules],
      paths: [...component.paths],
    })),
    domains: [],
    authorizedPathsByOutcome,
    exclusionsByOutcome,
    approvals: scenario.approvals.map((approval) => structuredClone(approval)),
    externalAuthorizationByOutcome: structuredClone(
      scenario.external_authorizations,
    ),
    acceptedDecisionIds: [...scenario.accepted_decision_ids],
    proposedDecisionIds: [...scenario.proposed_decision_ids],
    artifactRefs: [...scenario.artifact_refs],
    claimTtlMs: scenario.claim.ttl_ms,
    heartbeatInterval: scenario.claim.heartbeat_interval,
    renewalPolicy: scenario.claim.renewal_policy,
  });
}

export async function readCompileFixture(
  source: URL,
): Promise<RuntimeResult<CompileWorkstreamInput>> {
  if (source.protocol !== "file:") {
    return failure(
      "compile.fixture_url_invalid",
      "compile fixture must be one local file URL",
      source.href,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await readFile(source);
  } catch (error: unknown) {
    return failure(
      "compile.fixture_read_failed",
      error instanceof Error ? error.message : String(error),
      source.href,
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    return failure(
      "compile.fixture_utf8_invalid",
      error instanceof Error ? error.message : String(error),
      source.href,
    );
  }
  const document = parseYamlDocument(text, source.href);
  if (!document.ok) return document;
  const parsed = parseCompileScenario(document.value, source.href);
  if (!parsed.ok) return parsed;
  const resolved = await catalog();
  return resolved.ok ? hydrate(parsed.value, resolved.value) : resolved;
}
