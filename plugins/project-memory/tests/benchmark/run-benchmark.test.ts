import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadCatalog } from "../../src/catalog/load-catalog.js";
import {
  loadBenchmarkCases,
  importCatalogGoldenCases,
  runCatalogBenchmark,
} from "../../src/benchmark/run-benchmark.js";
import {
  buildBenchmarkReport,
  assessLowerReasoningTrials,
} from "../../src/benchmark/report.js";
import type { BenchmarkCaseResult } from "../../src/benchmark/contracts.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const CATALOG_ROOT = new URL(
  "../../catalog/project-memory/v1/",
  import.meta.url,
);
const BRIEFS_ROOT = new URL("../../benchmarks/briefs/", import.meta.url);

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error("schema fixture registration failed");
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("150-brief acceptance benchmark", () => {
  it("imports every catalog golden case with the complete expected contract", async () => {
    const catalog = await loadCatalog(CATALOG_ROOT);
    if (!catalog.ok) throw new Error(JSON.stringify(catalog.issues, null, 2));

    const imported = importCatalogGoldenCases(catalog.value);
    const persisted = await loadBenchmarkCases(BRIEFS_ROOT);
    if (!persisted.ok) throw new Error(JSON.stringify(persisted.issues, null, 2));

    expect(imported).toHaveLength(150);
    expect(persisted.value).toEqual(imported);
    expect(new Set(imported.map((item) => item.id))).toHaveLength(150);
    expect(imported.every((item) => (
      item.expected.root_boundary.kind.length > 0 &&
      (item.expected.blueprint === null || item.expected.blueprint.length > 0) &&
      Array.isArray(item.expected.components) &&
      Array.isArray(item.expected.domains) &&
      Array.isArray(item.expected.overlays) &&
      Array.isArray(item.expected.patterns) &&
      item.expected.authority.mutation === "none" &&
      item.expected.authority.external_action === "none" &&
      item.expected.evidence.source_fixture_id === item.id &&
      item.expected.gates.length > 0 &&
      item.max_clarification_questions <= 1
    ))).toBe(true);
  });

  it("meets the deterministic resolution gates without inventing trial evidence", async () => {
    const catalog = await loadCatalog(CATALOG_ROOT);
    if (!catalog.ok) throw new Error(JSON.stringify(catalog.issues, null, 2));
    const cases = await loadBenchmarkCases(BRIEFS_ROOT);
    if (!cases.ok) throw new Error(JSON.stringify(cases.issues, null, 2));

    const report = runCatalogBenchmark(catalog.value, cases.value);
    if (!report.ok) throw new Error(JSON.stringify(report.issues, null, 2));

    expect(report.value).toMatchObject({
      case_count: 150,
      supported_count: 150,
      supported_correct_count: 150,
      supported_resolution_rate: 1,
      schema_invention_count: 0,
      authority_expansion_count: 0,
      max_clarification_questions: 0,
      deterministic_gate_passed: true,
      v1_accepted: false,
      lower_reasoning_trials: {
        recorded_runs: 0,
        accepted: false,
      },
    });
    expect(report.value.gate_failures).toEqual([]);
  });

  it("fails exact gates for low resolution, schema invention, authority expansion, or excess clarification", async () => {
    const catalog = await loadCatalog(CATALOG_ROOT);
    if (!catalog.ok) throw new Error(JSON.stringify(catalog.issues, null, 2));
    const cases = importCatalogGoldenCases(catalog.value);
    const results: BenchmarkCaseResult[] = cases.map((item, index) => ({
      case_id: item.id,
      correct: index >= 4,
      clarification_questions: index === 0 ? 2 : 0,
      invented_definition_ids: index === 1 ? ["x-local-invented"] : [],
      requested_authority: {
        mutation: index === 2 ? "task-scoped" : "none",
        external_action: index === 3 ? "explicit-approval-required" : "none",
      },
      issue_codes: [],
    }));

    const report = buildBenchmarkReport(cases, results, []);

    expect(report.supported_resolution_rate).toBeLessThan(0.98);
    expect(report.schema_invention_count).toBe(1);
    expect(report.authority_expansion_count).toBe(2);
    expect(report.max_clarification_questions).toBe(2);
    expect(report.deterministic_gate_passed).toBe(false);
    expect(report.gate_failures).toEqual([
      "BENCHMARK_RESOLUTION_BELOW_THRESHOLD",
      "BENCHMARK_SCHEMA_INVENTION",
      "BENCHMARK_AUTHORITY_EXPANSION",
      "BENCHMARK_CLARIFICATION_LIMIT_EXCEEDED",
    ]);
  });

  it("requires two complete, credential-free lower-reasoning runs before acceptance", () => {
    const cases = Array.from({ length: 30 }, (_, index) =>
      `fixture.supported.${String(index + 1).padStart(2, "0")}`,
    );
    const run = (runId: string) => ({
      run_id: runId,
      fixed_prompt_sha256: "a".repeat(64),
      clean_repository_sha: "b".repeat(40),
      model_tool_id: "lower-reasoning-runner-v1",
      raw_result_sha256: "c".repeat(64),
      rubric_sha256: "d".repeat(64),
      reviewer: "independent-reviewer",
      recorded_at: "2026-07-14T00:00:00.000Z",
      supported_case_ids: cases,
      redacted_evidence_paths: [`benchmarks/lower-reasoning-trials/${runId}.json`],
      contains_credentials: false,
      supported_resolution_rate: 1,
      schema_invention_count: 0,
      authority_expansion_count: 0,
      max_clarification_questions: 1,
    } as const);

    expect(assessLowerReasoningTrials([run("run-01")])).toMatchObject({
      recorded_runs: 1,
      accepted: false,
    });
    expect(assessLowerReasoningTrials([run("run-01"), run("run-02")])).toMatchObject({
      recorded_runs: 2,
      accepted: true,
    });
    expect(assessLowerReasoningTrials([
      run("run-01"),
      { ...run("run-02"), contains_credentials: true },
    ])).toMatchObject({ accepted: false });
  });

  it("documents the fixed lower-reasoning protocol without storing credentials", async () => {
    const protocol = await readFile(
      new URL("../../benchmarks/lower-reasoning-trials/README.md", import.meta.url),
      "utf8",
    );
    expect(protocol).toContain("two independent runs");
    expect(protocol).toContain("30 supported briefs");
    expect(protocol).toContain("raw-result SHA-256");
    expect(protocol).toContain("Never store credentials");
  });
});
