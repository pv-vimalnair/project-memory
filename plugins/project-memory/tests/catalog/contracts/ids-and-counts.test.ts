import { describe, expect, it } from "vitest";

import {
  EXPECTED_CATALOG_COUNTS,
  validateCatalogCounts,
} from "../../../src/catalog/validation/validate-counts.js";
import type { CatalogSource } from "../../../src/catalog/load-catalog.js";

describe("catalog ID and count locks", () => {
  it("pins the approved v1 counts", () => {
    expect(EXPECTED_CATALOG_COUNTS).toEqual({
      blueprint_groups: 11,
      blueprints: 62,
      pattern_families: 16,
      patterns: 257,
      companion_rules: 13,
    });
  });

  it("fails a strict incomplete catalog", () => {
    const result = validateCatalogCounts(emptyCatalog());
    expect(result.some((issue) => issue.code === "CATALOG_COUNT_MISMATCH")).toBe(
      true,
    );
  });
});

function emptyCatalog(): CatalogSource {
  return {
    blueprint_groups: new Map(),
    blueprints: new Map(),
    components: new Map(),
    domains: new Map(),
    overlays: new Map(),
    adapters: new Map(),
    pattern_cores: new Map(),
    pattern_taxonomy: new Map(),
    companion_cores: new Map(),
    companion_taxonomy: new Map(),
    fixtures: new Map(),
    inventories: new Map(),
    manifest: null,
    source_paths: new Map(),
  };
}
