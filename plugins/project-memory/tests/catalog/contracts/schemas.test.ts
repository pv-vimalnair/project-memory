import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BlueprintDefinitionSchema,
  CATALOG_SCHEMA_IDS,
  PatternTaxonomyBindingSchema,
  generateCatalogSchemaDocuments,
  registerCatalogSchemas,
} from "../../../src/catalog/contracts/index.js";
import { catalogFoundation } from "../../../src/catalog/foundation.js";
import { resetSchemaRegistryForTests } from "../../../src/schema/registry.js";

beforeEach(() => {
  resetSchemaRegistryForTests();
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("catalog contracts", () => {
  it("registers strict Ajv 2020 schemas", () => {
    registerCatalogSchemas();
    const valid = {
      id: "application.consumer-mobile",
      version: "1.0.0",
      status: "active",
      group_id: "blueprint-group.application-service",
      allowed_root_kinds: ["product"],
      primary_archetype: "application-service",
      purpose: "Consumer value is delivered through a mobile application.",
      selection: {
        feature_schema_version: "1.0.0",
        required_signals: [],
        positive_signals: [],
        negative_signals: [],
        exclusions: [],
        max_positive_weight: 1,
        specificity_rank: 20,
        precedence: 20,
      },
      overlays: { baked: [], defaults: [], forbidden: [] },
      default_components: ["component.mobile-client"],
      default_domains: ["domain.product-strategy"],
      adapter_slots: ["mobile-client"],
      required_documents: ["source/PRD.md"],
      validation_gates: ["gate.profile.references-valid"],
      positive_examples: ["A consumer habit application."],
      negative_examples: ["A reusable mobile SDK."],
    };
    expect(
      catalogFoundation.validateWithSchema(BlueprintDefinitionSchema.$id, valid)
        .ok,
    ).toBe(true);
    expect(
      catalogFoundation.validateWithSchema(BlueprintDefinitionSchema.$id, {
        ...valid,
        invented: true,
      }).ok,
    ).toBe(false);
  });

  it("keeps taxonomy fields separate from core fields", () => {
    registerCatalogSchemas();
    const invalid = {
      pattern_id: "engineering.feature.implement",
      pattern_version: "1.0.0",
      compatibility: {},
      overlay_applicability: {},
      component_impacts: [],
      domain_impacts: [],
      selection: {},
    };
    expect(
      catalogFoundation.validateWithSchema(
        PatternTaxonomyBindingSchema.$id,
        invalid,
      ).ok,
    ).toBe(false);
  });

  it("publishes exactly twelve sorted catalog schema documents", () => {
    expect(CATALOG_SCHEMA_IDS).toEqual([
      "project-memory/v1/adapter-definition",
      "project-memory/v1/blueprint-definition",
      "project-memory/v1/blueprint-fixture",
      "project-memory/v1/blueprint-group-definition",
      "project-memory/v1/catalog-inventory",
      "project-memory/v1/catalog-manifest",
      "project-memory/v1/catalog-release-lock",
      "project-memory/v1/companion-taxonomy",
      "project-memory/v1/component-definition",
      "project-memory/v1/domain-definition",
      "project-memory/v1/overlay-definition",
      "project-memory/v1/pattern-taxonomy",
    ]);
    const documents = generateCatalogSchemaDocuments();
    expect([...documents.keys()]).toEqual(CATALOG_SCHEMA_IDS);
    for (const [id, document] of documents) {
      expect(JSON.parse(document)).toMatchObject({ $id: id });
    }
  });
});
