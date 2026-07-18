import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerPlanningSchemas } from "../../src/planning/contracts.js";
import {
  registerSelectionSchemas,
} from "../../src/selection/contracts/index.js";
import {
  loadCompanionCoreHalves,
  loadPatternCoreHalves,
  validateOwnedContracts,
} from "../../src/selection/load-pattern-halves.js";
import { emitJsonSchemas } from "../../src/schema/emit.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const EXPECTED_SCHEMA_IDS = [
  "project-memory/v1/approval",
  "project-memory/v1/claim",
  "project-memory/v1/companion-rule-core",
  "project-memory/v1/completion-packet",
  "project-memory/v1/normalized-feature-map",
  "project-memory/v1/pattern-core",
  "project-memory/v1/resolved-companion-rule",
  "project-memory/v1/resolved-pattern",
  "project-memory/v1/selection-result",
  "project-memory/v1/task-assignment",
  "project-memory/v1/task-packet",
  "project-memory/v1/workstream-pattern-set",
  "project-memory/v1/workstream-plan",
] as const;

const temporaryRoots: string[] = [];

beforeEach(() => {
  resetSchemaRegistryForTests();
});

afterEach(async () => {
  resetSchemaRegistryForTests();
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("selection/planning contracts", () => {
  it("registers the exact owned schema IDs once", () => {
    const ids = [
      ...registerSelectionSchemas(),
      ...registerPlanningSchemas(),
    ].sort();
    expect(ids).toEqual(EXPECTED_SCHEMA_IDS);
    const result = validateOwnedContracts(EXPECTED_SCHEMA_IDS);
    expect(result.ok).toBe(true);
  });

  it("emits the thirteen schemas deterministically", async () => {
    registerSelectionSchemas();
    registerPlanningSchemas();
    const output = await mkdtemp(path.join(tmpdir(), "selection-schemas-"));
    temporaryRoots.push(output);
    const outputUrl = pathToFileURL(output + path.sep);

    const first = await emitJsonSchemas(outputUrl);
    const firstIndex = await readFile(
      path.join(output, "schema-index.json"),
      "utf8",
    );
    const second = await emitJsonSchemas(outputUrl);
    const secondIndex = await readFile(
      path.join(output, "schema-index.json"),
      "utf8",
    );

    expect(first.ok && first.value).toHaveLength(13);
    expect(second.ok).toBe(true);
    expect(secondIndex).toBe(firstIndex);
    const parsed = JSON.parse(firstIndex) as {
      readonly schemas: readonly { readonly id: string }[];
    };
    expect(parsed.schemas.map((entry) => entry.id)).toEqual(
      EXPECTED_SCHEMA_IDS,
    );
  });

  it("loads path-confined pattern and companion core halves", async () => {
    registerSelectionSchemas();
    const root = await mkdtemp(path.join(tmpdir(), "selection-cores-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "patterns", "engineering"), {
      recursive: true,
    });
    await mkdir(path.join(root, "companion-rules"), { recursive: true });
    await writeFile(
      path.join(
        root,
        "patterns",
        "engineering",
        "engineering.feature.implement.core.yaml",
      ),
      JSON.stringify(patternCore()),
      "utf8",
    );
    await writeFile(
      path.join(
        root,
        "companion-rules",
        "companion.mutation.core.yaml",
      ),
      JSON.stringify(companionCore()),
      "utf8",
    );

    const rootUrl = pathToFileURL(root + path.sep);
    const patterns = await loadPatternCoreHalves(rootUrl, ["engineering"]);
    const companions = await loadCompanionCoreHalves(rootUrl);

    expect(patterns.ok && patterns.value.map((item) => item.id)).toEqual([
      "engineering.feature.implement",
    ]);
    expect(companions.ok && companions.value.map((item) => item.id)).toEqual([
      "companion.mutation",
    ]);
  });

  it("rejects a filename and definition ID mismatch", async () => {
    registerSelectionSchemas();
    const root = await mkdtemp(path.join(tmpdir(), "selection-mismatch-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "patterns", "engineering"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, "patterns", "engineering", "wrong.core.yaml"),
      JSON.stringify(patternCore()),
      "utf8",
    );

    const result = await loadPatternCoreHalves(
      pathToFileURL(root + path.sep),
      ["engineering"],
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "SELECTION_CORE_FILENAME_MISMATCH" }],
    });
  });
});

function patternCore(): Readonly<Record<string, unknown>> {
  return {
    id: "engineering.feature.implement",
    version: "1.0.0",
    status: "active",
    purpose: "Implement one accepted bounded feature.",
    selection: {
      feature_schema_version: "1.0.0",
      required_signals: [{
        id: "mode-implement",
        feature: "action.mode",
        operator: "equals",
        expected: "implement",
        evidence_required: true,
      }],
      positive_signals: [{
        id: "feature-change",
        feature: "work.object",
        operator: "equals",
        expected: "feature",
        evidence_required: true,
        weight: 100,
      }],
      negative_signals: [],
      exclusions: [],
      max_positive_weight: 100,
      specificity_rank: 50,
      precedence: 50,
    },
    composition: {
      allowed_primary_pattern_ids: [],
      mandatory_companion_rule_ids: ["companion.mutation"],
      incompatible_pattern_ids: [],
      triggers_companions: true,
    },
    duties: ["modify", "record"],
    write_scope: ["claim-owned-paths"],
    authorization: {
      mutation: "task-scoped",
      task_result_submission: "worker",
      factual_integration: "integrator",
      workstream_activation: "automatic-by-rule",
      directional_acceptance: "Pitaji",
      external_action: "none",
    },
    inputs: ["accepted-scope"],
    outputs: ["implementation-change"],
    evidence: ["exact-diff"],
    gates: ["claim-valid"],
    memory_updates: ["change-record"],
    completion_conditions: ["accepted-scope-complete"],
    fallback_and_escalation: ["stop-on-implicit-authority"],
  };
}

function companionCore(): Readonly<Record<string, unknown>> {
  return {
    id: "companion.mutation",
    version: "1.0.0",
    status: "active",
    purpose: "Add evidence and validation to mutation work.",
    when: {
      all: [{
        id: "mutation-mode",
        feature: "action.mode",
        operator: "in",
        expected: ["implement", "change"],
        evidence_required: true,
      }],
      any: [],
      none: [],
    },
    require_patterns: [{
      id: "governance.evidence.validate",
      version_range: "^1.0.0",
      condition: true,
    }],
    require_duties: ["validate", "record"],
    require_evidence: ["required-gate-results"],
    authority_effect: "narrow-only",
    conflict_policy: "fail_closed",
  };
}
