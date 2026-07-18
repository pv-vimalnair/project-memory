import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PROJECT_SCHEMA_REGISTRARS,
  canonicalJson,
  registerProjectSchemas,
} from "../../src/index.js";
import {
  loadCatalog,
  type CatalogSource,
} from "../../src/catalog/index.js";
import { expandCompanions } from "../../src/selection/expand-companions.js";
import { loadResolvedPatterns } from "../../src/selection/load-pattern-halves.js";
import { normalizeFeatureMap } from "../../src/selection/normalize-feature-map.js";
import type {
  CompanionExpansionInput,
  ResolvedPatternCatalog,
} from "../../src/selection/types.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

let source: CatalogSource;
let catalog: ResolvedPatternCatalog;

function features() {
  const normalized = normalizeFeatureMap([
    {
      id: "action.mode",
      valueType: "string",
      value: "implement",
      evidenceId: "EVD-01J00000000000000000000001",
      sourceRef: "brief:1",
    },
    {
      id: "work.family",
      valueType: "string",
      value: "engineering",
      evidenceId: "EVD-01J00000000000000000000002",
      sourceRef: "brief:2",
    },
    {
      id: "work.object",
      valueType: "string",
      value: "feature",
      evidenceId: "EVD-01J00000000000000000000003",
      sourceRef: "brief:3",
    },
  ]);
  if (!normalized.ok) throw new Error(JSON.stringify(normalized.issues));
  return normalized.value;
}

function expansion(
  primaryPatternIds: readonly string[],
): CompanionExpansionInput {
  return {
    catalog,
    primaryPatternIds,
    features: features(),
    applicability: {
      rootKind: "product",
      primaryArchetype: "application-service",
      overlayIds: ["overlay.lifecycle.active"],
      artifactTypes: ["code/runtime"],
    },
  };
}

beforeAll(async () => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
  const loaded = await loadCatalog(
    new URL("../../catalog/project-memory/v1/", import.meta.url),
  );
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
  source = loaded.value;
  const resolved = loadResolvedPatterns(source);
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
  catalog = resolved.value;
});

afterAll(() => {
  resetSchemaRegistryForTests();
});

describe("resolved catalog half assembly", () => {
  it("assembles every exact core/taxonomy pair in stable order", () => {
    expect([...catalog.patterns.keys()]).toEqual(
      [...catalog.patterns.keys()].sort(),
    );
    expect(catalog.patterns).toHaveLength(257);
    expect(catalog.companionRules).toHaveLength(13);
    const engineering = catalog.patterns.get("engineering.feature.implement");
    expect(engineering).toMatchObject({
      version: "1.0.0",
      authorization: { mutation: "task-scoped" },
    });
    expect(engineering?.component_impacts.length).toBeGreaterThan(0);
  });

  it("fails closed when a taxonomy half is missing", () => {
    const patternTaxonomy = new Map(source.pattern_taxonomy);
    patternTaxonomy.delete("engineering.feature.implement");
    expect(
      loadResolvedPatterns({ ...source, pattern_taxonomy: patternTaxonomy }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "pattern.missing_taxonomy_half" }],
    });
  });
});

describe("fixed-point companion expansion", () => {
  it("expands mutation companions to a stable fixed point", () => {
    const result = expandCompanions(expansion(["engineering.feature.implement"]));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));

    expect(result.value.patterns.map((pattern) => pattern.id)).toEqual([
      "engineering.feature.implement",
      "governance.documentation.validate",
      "governance.evidence.validate",
      "qa.regression.validate",
    ]);
    expect(result.value.appliedRuleIds).toEqual(["companion.mutation"]);
    expect(
      result.value.patterns.find(
        (pattern) => pattern.id === "qa.regression.validate",
      ),
    ).toMatchObject({
      version: "1.0.0",
      provenanceRuleIds: ["companion.mutation"],
      sourcePatternIds: ["engineering.feature.implement"],
    });
  });

  it("is byte-identical when initial patterns are shuffled", () => {
    const first = expandCompanions(
      expansion([
        "governance.context.assess",
        "engineering.feature.implement",
      ]),
    );
    const second = expandCompanions(
      expansion([
        "engineering.feature.implement",
        "governance.context.assess",
      ]),
    );
    if (!first.ok || !second.ok) throw new Error("closure failed");
    expect(canonicalJson(first.value)).toBe(canonicalJson(second.value));
  });

  it("rejects incompatible initial pattern pairs", () => {
    const context = catalog.patterns.get("governance.context.assess");
    if (context === undefined) throw new Error("missing context pattern");
    const patterns = new Map(catalog.patterns);
    patterns.set("governance.context.assess", {
      ...context,
      composition: {
        ...context.composition,
        incompatible_pattern_ids: ["engineering.feature.implement"],
      },
    });
    const result = expandCompanions({
      ...expansion([
        "governance.context.assess",
        "engineering.feature.implement",
      ]),
      catalog: { ...catalog, patterns },
    });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "companion.incompatible_pair" }],
    });
  });
  it("fails when a companion predicate cannot be resolved", () => {
    const mutation = catalog.companionRules.get("companion.mutation");
    if (mutation === undefined) throw new Error("missing mutation rule");
    const companionRules = new Map(catalog.companionRules);
    companionRules.set("companion.mutation", {
      ...mutation,
      when: {
        ...mutation.when,
        all: [
          {
            id: "missing-evidence",
            feature: "unknown.required-feature",
            operator: "equals",
            expected: true,
            evidence_required: true,
          },
        ],
      },
    });
    const result = expandCompanions({
      ...expansion(["engineering.feature.implement"]),
      catalog: { ...catalog, companionRules },
    });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "companion.condition_unresolved" }],
    });
  });
});
