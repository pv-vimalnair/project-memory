import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadCatalog } from "../../../src/catalog/load-catalog.js";
import { fixturesCommand } from "../../../src/catalog/commands/fixtures-command.js";
import { runIntegratedBlueprintFixtures } from "../../../src/catalog/fixtures/run-integrated-blueprint-fixtures.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../../src/schema/registry.js";
import { selectBlueprint } from "../../../src/selection/index.js";

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

describe("catalog and selection integration contract", () => {
  it("matches all 150 catalog-owned blueprint expectations", async () => {
    const loaded = await loadCatalog(CATALOG_ROOT);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues, null, 2));

    const result = runIntegratedBlueprintFixtures({
      selectBlueprint,
      catalog: loaded.value,
      fixtures: [...loaded.value.fixtures.values()],
    });

    if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
    expect(result.value).toMatchObject({ total: 150, passed: 150, failed: 0 });
    expect(result.value.failures).toEqual([]);
  });

  it("locks every exact core and taxonomy pair", async () => {
    const loaded = await loadCatalog(CATALOG_ROOT);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues, null, 2));

    expect(loaded.value.pattern_cores.size).toBe(257);
    expect(loaded.value.pattern_taxonomy.size).toBe(257);
    expect([...loaded.value.pattern_cores].every(([id, core]) => {
      const taxonomy = loaded.value.pattern_taxonomy.get(id);
      return taxonomy?.pattern_version === core.version;
    })).toBe(true);

    expect(loaded.value.companion_cores.size).toBe(13);
    expect(loaded.value.companion_taxonomy.size).toBe(13);
    expect([...loaded.value.companion_cores].every(([id, core]) => {
      const taxonomy = loaded.value.companion_taxonomy.get(id);
      return taxonomy?.rule_version === core.version;
    })).toBe(true);
  });

  it("exposes the integrated fixture result through the catalog command", async () => {
    const result = await fixturesCommand({
      root: CATALOG_ROOT,
      check: true,
      integrated: true,
      suite: "blueprint",
    });
    if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
    expect(result.value.counts).toMatchObject({
      positive: 62,
      anti: 62,
      boundary: 26,
      total: 150,
      passed: 150,
      failed: 0,
    });
  });
});
