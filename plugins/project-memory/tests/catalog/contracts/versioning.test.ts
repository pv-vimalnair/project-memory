import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CatalogReleaseLock } from "../../../src/catalog/contracts/index.js";
import { loadCatalogInventory } from "../../../src/catalog/inventory/load-inventory.js";
import { compareCatalogReleases } from "../../../src/catalog/manifest/compare-releases.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../../src/schema/registry.js";

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error("schema fixture registration failed");
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("catalog manifest and versioning", () => {
  it("pins all v1 catalog totals in normative inventories", async () => {
    const result = await loadCatalogInventory(
      new URL("../../../catalog/project-memory/v1/", import.meta.url),
    );
    if (!result.ok) {
      throw new Error(JSON.stringify(result.issues, null, 2));
    }
    expect(result.value.blueprint_groups).toHaveLength(11);
    expect(result.value.blueprints).toHaveLength(62);
    expect(result.value.pattern_families).toHaveLength(16);
    expect(result.value.patterns).toHaveLength(257);
    expect(result.value.companion_rules).toHaveLength(13);
  });

  it("classifies a selection-boundary change as major", () => {
    const previous = releaseLock("1.0.0", [
      entry("patterns/engineering/engineering.feature.implement.core.yaml", "a"),
    ]);
    const changed = releaseLock("2.0.0", [
      entry("patterns/engineering/engineering.feature.implement.core.yaml", "b"),
    ]);
    const result = compareCatalogReleases(previous, changed);
    expect(result.ok && result.value).toBe("major");
  });

  it("classifies additive definitions as minor and documentation as patch", () => {
    const previous = releaseLock("1.0.0", [entry("CHANGELOG.md", "a")]);
    const additive = releaseLock("1.1.0", [
      entry("CHANGELOG.md", "a"),
      entry("components/component.new.yaml", "b", "component.new"),
    ]);
    const documentation = releaseLock("1.0.1", [entry("CHANGELOG.md", "b")]);
    expect(compareCatalogReleases(previous, additive)).toMatchObject({
      ok: true,
      value: "minor",
    });
    expect(compareCatalogReleases(previous, documentation)).toMatchObject({
      ok: true,
      value: "patch",
    });
  });
});

function entry(
  relativePath: string,
  hashSeed: "a" | "b",
  definitionId: string | null = null,
) {
  return {
    relative_path: relativePath,
    definition_id: definitionId,
    version: definitionId === null ? null : "1.0.0",
    schema_id: null,
    sha256: hashSeed.repeat(64),
  } as const;
}

function releaseLock(
  release: string,
  sourceEntries: CatalogReleaseLock["source_entries"],
): CatalogReleaseLock {
  return {
    schema_version: "1.0.0",
    catalog_id: "project-memory",
    release,
    source_entries: sourceEntries,
    generated_entries: [],
    release_hash: "c".repeat(64),
  };
}
