import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerCatalogSchemas } from "../../../src/catalog/contracts/index.js";
import { loadCatalog } from "../../../src/catalog/load-catalog.js";
import { validateCatalog } from "../../../src/catalog/validation/validate-catalog.js";
import { registerSelectionSchemas } from "../../../src/selection/contracts/index.js";
import { resetSchemaRegistryForTests } from "../../../src/schema/registry.js";

beforeEach(() => {
  resetSchemaRegistryForTests();
  registerCatalogSchemas();
  registerSelectionSchemas();
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("invalid catalog corpus", () => {
  it.each([
    ["duplicate-id", "CATALOG_DUPLICATE_ID"],
    ["unknown-reference", "CATALOG_UNKNOWN_REFERENCE"],
    ["pattern-version-mismatch", "CATALOG_HALF_VERSION_MISMATCH"],
    ["overlay-conflict", "CATALOG_OVERLAY_CONFLICT"],
  ])("%s fails closed", async (folder, code) => {
    const loaded = await loadCatalog(
      new URL(
        "../../fixtures/catalog-invalid/" + folder + "/",
        import.meta.url,
      ),
    );
    if (!loaded.ok) {
      expect(loaded.issues.some((issue) => issue.code === code)).toBe(true);
      return;
    }
    const validated = validateCatalog(loaded.value, { strict: false });
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.issues.some((issue) => issue.code === code)).toBe(true);
    }
  });
});
