import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BlueprintFixture } from "../catalog/contracts/index.js";
import { runIntegratedBlueprintFixtures } from "../catalog/fixtures/run-integrated-blueprint-fixtures.js";
import type { CatalogSource } from "../catalog/load-catalog.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { decodeStrictUtf8, parseYamlDocument } from "../core/document-io.js";
import { selectBlueprint } from "../selection/index.js";
import type {
  BenchmarkAuthority,
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkFeatureValue,
  BenchmarkReport,
  ExpectedResolution,
  LowerReasoningTrialRecord,
} from "./contracts.js";
import { buildBenchmarkReport } from "./report.js";

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function expectedTarget(fixture: BlueprintFixture): string {
  const target = fixture.expected.blueprint_id ?? fixture.expected.prohibited_blueprint_ids?.[0];
  if (target === undefined) throw new TypeError(`benchmark fixture ${fixture.id} has no target`);
  return target;
}

export function importCatalogGoldenCases(
  catalog: CatalogSource,
): readonly BenchmarkCase[] {
  return [...catalog.fixtures.values()]
    .sort((left, right) => compareUtf8(left.id, right.id))
    .map((fixture) => {
      const targetId = expectedTarget(fixture);
      const blueprint = catalog.blueprints.get(targetId);
      if (blueprint === undefined) {
        throw new TypeError(`benchmark fixture ${fixture.id} targets unknown blueprint ${targetId}`);
      }
      const rootKind = fixture.normalized_features["root.kind"];
      if (typeof rootKind !== "string") {
        throw new TypeError(`benchmark fixture ${fixture.id} has no root boundary`);
      }
      return {
        id: fixture.id,
        supported: true,
        brief: fixture.description ?? `Resolve the supported project shape in ${fixture.id}.`,
        normalized_features: fixture.normalized_features,
        expected: {
          decision: fixture.expected.decision,
          root_boundary: {
            kind: rootKind,
            primary_archetype: blueprint.primary_archetype,
          },
          blueprint: fixture.expected.blueprint_id ?? null,
          prohibited_blueprints: sorted(fixture.expected.prohibited_blueprint_ids ?? []),
          reason_codes: sorted(fixture.expected.reason_codes),
          components: sorted(blueprint.default_components),
          domains: sorted(blueprint.default_domains),
          overlays: sorted([...blueprint.overlays.baked, ...blueprint.overlays.defaults]),
          patterns: [],
          authority: { mutation: "none", external_action: "none" },
          evidence: { required: true, source_fixture_id: fixture.id },
          gates: sorted(blueprint.validation_gates),
        },
        max_clarification_questions: 0,
      } satisfies BenchmarkCase;
    });
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringList(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

function featureMap(value: unknown): Readonly<Record<string, BenchmarkFeatureValue>> | null {
  const source = record(value);
  if (source === null) return null;
  const result: Record<string, BenchmarkFeatureValue> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean" &&
      !(Array.isArray(entry) && entry.every((item) => typeof item === "string"))
    ) return null;
    result[key] = entry;
  }
  return result;
}

function authority(value: unknown): BenchmarkAuthority | null {
  const source = record(value);
  if (source === null) return null;
  const mutation = source.mutation;
  const external = source.external_action;
  if (!(["none", "task-scoped", "approval-required"] as const).includes(mutation as never)) return null;
  if (!(["none", "explicit-approval-required"] as const).includes(external as never)) return null;
  return {
    mutation: mutation as BenchmarkAuthority["mutation"],
    external_action: external as BenchmarkAuthority["external_action"],
  };
}

function expectedResolution(value: unknown): ExpectedResolution | null {
  const source = record(value);
  const boundary = record(source?.root_boundary);
  const evidence = record(source?.evidence);
  const parsedAuthority = authority(source?.authority);
  const prohibited = stringList(source?.prohibited_blueprints);
  const reasonCodes = stringList(source?.reason_codes);
  const components = stringList(source?.components);
  const domains = stringList(source?.domains);
  const overlays = stringList(source?.overlays);
  const patterns = stringList(source?.patterns);
  const gates = stringList(source?.gates);
  if (
    source === null ||
    !(["selected", "rejected", "review_required"] as const).includes(source.decision as never) ||
    boundary === null || typeof boundary.kind !== "string" ||
    typeof boundary.primary_archetype !== "string" ||
    !(typeof source.blueprint === "string" || source.blueprint === null) ||
    prohibited === null || reasonCodes === null || components === null ||
    domains === null || overlays === null || patterns === null ||
    parsedAuthority === null || evidence === null ||
    typeof evidence.required !== "boolean" ||
    typeof evidence.source_fixture_id !== "string" || gates === null || gates.length === 0
  ) return null;
  return {
    decision: source.decision as ExpectedResolution["decision"],
    root_boundary: {
      kind: boundary.kind,
      primary_archetype: boundary.primary_archetype,
    },
    blueprint: source.blueprint,
    prohibited_blueprints: prohibited,
    reason_codes: reasonCodes,
    components,
    domains,
    overlays,
    patterns,
    authority: parsedAuthority,
    evidence: {
      required: evidence.required,
      source_fixture_id: evidence.source_fixture_id,
    },
    gates,
  };
}

function benchmarkCase(value: unknown, sourcePath: string): RuntimeResult<BenchmarkCase> {
  const source = record(value);
  const features = featureMap(source?.normalized_features);
  const expected = expectedResolution(source?.expected);
  if (
    source === null || typeof source.id !== "string" || source.id.length === 0 ||
    typeof source.supported !== "boolean" || typeof source.brief !== "string" ||
    source.brief.length === 0 || features === null || expected === null ||
    (source.max_clarification_questions !== 0 && source.max_clarification_questions !== 1)
  ) {
    return failure("BENCHMARK_CASE_INVALID", "benchmark case does not match the v1 contract", sourcePath);
  }
  return success({
    id: source.id,
    supported: source.supported,
    brief: source.brief,
    normalized_features: features,
    expected,
    max_clarification_questions: source.max_clarification_questions,
  });
}

async function collectYamlFiles(rootPath: string): Promise<RuntimeResult<readonly string[]>> {
  try {
    const rootStat = await lstat(rootPath);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      return failure("BENCHMARK_INPUT_UNSAFE", "benchmark input must be a regular directory", rootPath);
    }
    const pending = [rootPath];
    const files: string[] = [];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) continue;
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const target = path.join(current, entry.name);
        if (entry.isSymbolicLink()) {
          return failure("BENCHMARK_INPUT_UNSAFE", "benchmark inputs cannot contain symlinks", target);
        }
        if (entry.isDirectory()) pending.push(target);
        if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) files.push(target);
      }
    }
    return success(files.sort(compareUtf8));
  } catch (error: unknown) {
    return failure(
      "BENCHMARK_INPUT_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      rootPath,
    );
  }
}

export async function loadBenchmarkCases(
  inputRoot: URL,
): Promise<RuntimeResult<readonly BenchmarkCase[]>> {
  if (inputRoot.protocol !== "file:") {
    return failure("BENCHMARK_INPUT_INVALID", "benchmark input must use a file URL", inputRoot.href);
  }
  const files = await collectYamlFiles(fileURLToPath(inputRoot));
  if (!files.ok) return files;
  if (files.value.length === 0) {
    return failure("BENCHMARK_INPUT_EMPTY", "benchmark input contains no YAML files", inputRoot.href);
  }
  const cases: BenchmarkCase[] = [];
  for (const file of files.value) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(file));
    } catch (error: unknown) {
      return failure("BENCHMARK_INPUT_READ_FAILED", error instanceof Error ? error.message : String(error), file);
    }
    const decoded = decodeStrictUtf8(bytes, file);
    if (!decoded.ok) return decoded;
    const parsed = parseYamlDocument(decoded.value, file);
    if (!parsed.ok) return parsed;
    const document = record(parsed.value);
    if (document === null || document.schema_version !== "1.0.0" || !Array.isArray(document.cases)) {
      return failure("BENCHMARK_DOCUMENT_INVALID", "benchmark document must contain v1 cases", file);
    }
    for (const value of document.cases) {
      const decodedCase = benchmarkCase(value, file);
      if (!decodedCase.ok) return decodedCase;
      cases.push(decodedCase.value);
    }
  }
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.id)) return failure("BENCHMARK_CASE_DUPLICATE", `duplicate benchmark case ${item.id}`, item.id);
    ids.add(item.id);
  }
  return success(cases.sort((left, right) => compareUtf8(left.id, right.id)));
}

function fixtureFromCase(item: BenchmarkCase): BlueprintFixture {
  return {
    id: item.id,
    kind: item.expected.decision === "rejected"
      ? "blueprint-anti"
      : item.expected.prohibited_blueprints.length > 0
        ? "blueprint-boundary"
        : "blueprint-positive",
    description: item.brief,
    normalized_features: item.normalized_features as BlueprintFixture["normalized_features"],
    expected: {
      decision: item.expected.decision,
      ...(item.expected.blueprint === null ? {} : { blueprint_id: item.expected.blueprint }),
      ...(item.expected.prohibited_blueprints.length === 0
        ? {}
        : { prohibited_blueprint_ids: [...item.expected.prohibited_blueprints] }),
      reason_codes: [...item.expected.reason_codes],
    },
  };
}

export function runCatalogBenchmark(
  catalog: CatalogSource,
  cases: readonly BenchmarkCase[],
  trials: readonly LowerReasoningTrialRecord[] = [],
): RuntimeResult<BenchmarkReport> {
  const supportedCases = cases.filter((item) => item.supported);
  const integrated = runIntegratedBlueprintFixtures({
    selectBlueprint,
    catalog,
    fixtures: supportedCases.map(fixtureFromCase),
  });
  if (!integrated.ok) return integrated;
  const failures = new Map(integrated.value.failures.map((item) => [item.fixture_id, item]));
  const results: BenchmarkCaseResult[] = cases.map((item) => {
    const failed = failures.get(item.id);
    const invented = failed?.observed_winner_id !== null &&
      failed?.observed_winner_id !== undefined &&
      !catalog.blueprints.has(failed.observed_winner_id)
      ? [failed.observed_winner_id]
      : [];
    return {
      case_id: item.id,
      correct: item.supported ? failed === undefined : true,
      clarification_questions: 0,
      invented_definition_ids: invented,
      requested_authority: { mutation: "none", external_action: "none" },
      issue_codes: failed === undefined
        ? []
        : sorted([
            ...failed.selector_issue_codes,
            ...failed.missing_reason_codes,
            "BENCHMARK_EXPECTATION_MISMATCH",
          ]),
    };
  });
  return success(buildBenchmarkReport(cases, results, trials));
}
