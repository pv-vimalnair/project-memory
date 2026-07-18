import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadCatalog } from "../../../src/catalog/load-catalog.js";
import { validateCatalog } from "../../../src/catalog/validation/validate-catalog.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../../src/schema/registry.js";

const CATALOG_ROOT = new URL(
  "../../../catalog/project-memory/v1/",
  import.meta.url,
);

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error("schema fixture registration failed");
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("complete v1 catalog content", () => {
  it("loads and validates every locked definition count", async () => {
    const loaded = await loadCatalog(CATALOG_ROOT);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues, null, 2));
    expect({
      blueprint_groups: loaded.value.blueprint_groups.size,
      blueprints: loaded.value.blueprints.size,
      components: loaded.value.components.size,
      domains: loaded.value.domains.size,
      overlays: loaded.value.overlays.size,
      adapters: loaded.value.adapters.size,
      pattern_cores: loaded.value.pattern_cores.size,
      pattern_taxonomy: loaded.value.pattern_taxonomy.size,
      companion_cores: loaded.value.companion_cores.size,
      companion_taxonomy: loaded.value.companion_taxonomy.size,
      fixtures: loaded.value.fixtures.size,
    }).toEqual({
      blueprint_groups: 11,
      blueprints: 62,
      components: 78,
      domains: 15,
      overlays: 46,
      adapters: 15,
      pattern_cores: 257,
      pattern_taxonomy: 257,
      companion_cores: 13,
      companion_taxonomy: 13,
      fixtures: 150,
    });
    const validated = validateCatalog(loaded.value, { strict: true });
    if (!validated.ok) {
      throw new Error(JSON.stringify(validated.issues.slice(0, 25), null, 2));
    }
    expect(validated.value.valid).toBe(true);
  });

  it("provides paired blueprint fixtures and complete pattern halves", async () => {
    const loaded = await loadCatalog(CATALOG_ROOT);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues, null, 2));
    for (const blueprint of loaded.value.blueprints.values()) {
      expect(loaded.value.fixtures.has(`fixture.${blueprint.id}.positive`)).toBe(
        true,
      );
      expect(loaded.value.fixtures.has(`fixture.${blueprint.id}.anti`)).toBe(
        true,
      );
      expect(blueprint.positive_examples.length).toBeGreaterThan(0);
      expect(blueprint.negative_examples.length).toBeGreaterThan(0);
    }
    for (const pattern of loaded.value.pattern_cores.values()) {
      expect(loaded.value.pattern_taxonomy.has(pattern.id)).toBe(true);
      expect(pattern.selection.max_positive_weight).toBe(
        pattern.selection.positive_signals.reduce(
          (sum, signal) => sum + (signal.weight ?? 0),
          0,
        ),
      );
      expect(pattern.duties.length).toBeGreaterThan(0);
      expect(pattern.completion_conditions.length).toBeGreaterThan(0);
    }
    for (const companion of loaded.value.companion_cores.values()) {
      expect(loaded.value.companion_taxonomy.has(companion.id)).toBe(true);
      expect(companion.authority_effect).toBe("narrow-only");
      expect(companion.conflict_policy).toBe("fail_closed");
    }
  });
});
