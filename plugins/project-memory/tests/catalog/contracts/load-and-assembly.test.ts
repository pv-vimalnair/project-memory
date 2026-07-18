import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assembleCompanionRule } from "../../../src/catalog/assembly/assemble-companion-rule.js";
import { assemblePatternDefinition } from "../../../src/catalog/assembly/assemble-pattern.js";
import {
  registerCatalogSchemas,
  type CompanionTaxonomyBinding,
  type PatternTaxonomyBinding,
} from "../../../src/catalog/contracts/index.js";
import { registerSelectionSchemas } from "../../../src/selection/contracts/index.js";
import type {
  CompanionRuleCore,
  PatternCoreDefinition,
} from "../../../src/selection/contracts/core.js";
import { resetSchemaRegistryForTests } from "../../../src/schema/registry.js";

beforeEach(() => {
  resetSchemaRegistryForTests();
  registerCatalogSchemas();
  registerSelectionSchemas();
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("catalog half assembly", () => {
  it("assembles exact pattern and companion half pairs", () => {
    const pattern = assemblePatternDefinition(patternCore(), patternTaxonomy());
    const companion = assembleCompanionRule(
      companionCore(),
      companionTaxonomy(),
    );

    expect(pattern.ok && pattern.value.id).toBe(
      "engineering.feature.implement",
    );
    expect(companion.ok && companion.value.id).toBe("companion.mutation");
  });

  it("rejects field overlap between core and taxonomy", () => {
    const taxonomy = {
      ...patternTaxonomy(),
      evidence_requirements: ["unexpected"],
    };
    const result = assemblePatternDefinition(
      patternCore(),
      taxonomy,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("CATALOG_HALF_FIELD_OVERLAP");
    }
  });

  it("rejects exact version mismatch", () => {
    const result = assemblePatternDefinition(patternCore(), {
      ...patternTaxonomy(),
      pattern_version: "1.0.1",
    });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "CATALOG_HALF_VERSION_MISMATCH" }],
    });
  });
});

function patternCore(): PatternCoreDefinition {
  return {
    id: "engineering.feature.implement",
    version: "1.0.0",
    status: "active",
    purpose: "Implement one accepted bounded feature.",
    selection: {
      feature_schema_version: "1.0.0",
      required_signals: [],
      positive_signals: [],
      negative_signals: [],
      exclusions: [],
      max_positive_weight: 1,
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

function patternTaxonomy(): PatternTaxonomyBinding {
  return {
    pattern_id: "engineering.feature.implement",
    pattern_version: "1.0.0",
    compatibility: {
      root_kinds: ["product"],
      primary_archetypes: ["application-service"],
      required_overlays: [],
      forbidden_overlays: [],
    },
    overlay_applicability: {
      baked: [],
      allowed: [],
      forbidden: [],
    },
    component_impacts: [],
    domain_impacts: [],
  };
}

function companionCore(): CompanionRuleCore {
  return {
    id: "companion.mutation",
    version: "1.0.0",
    status: "active",
    purpose: "Require evidence for mutation work.",
    when: { all: [], any: [], none: [] },
    require_patterns: [],
    require_duties: ["validate", "record"],
    require_evidence: ["gate-results"],
    authority_effect: "narrow-only",
    conflict_policy: "fail_closed",
  };
}

function companionTaxonomy(): CompanionTaxonomyBinding {
  return {
    rule_id: "companion.mutation",
    rule_version: "1.0.0",
    compatibility: {
      root_kinds: ["product"],
      primary_archetypes: ["application-service"],
      required_overlays: [],
      forbidden_overlays: [],
    },
    overlay_applicability: {
      baked: [],
      allowed: [],
      forbidden: [],
    },
    component_impacts: [],
    domain_impacts: [],
  };
}
