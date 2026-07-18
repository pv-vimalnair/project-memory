import { readdir, readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CatalogReleaseLock } from "../../../src/catalog/contracts/index.js";
import { loadCatalog } from "../../../src/catalog/load-catalog.js";
import { verifyCatalogRelease } from "../../../src/catalog/manifest/verify-catalog-release.js";
import { readUtf8Document } from "../../../src/core/document-io.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../../src/schema/registry.js";
import { validateWithSchema } from "../../../src/schema/validate.js";

const CATALOG_ROOT = new URL(
  "../../../catalog/project-memory/v1/",
  import.meta.url,
);
const RELEASE_ROOT = new URL(
  "../../../dist/catalog/project-memory/1.0.0/",
  import.meta.url,
);
const CATALOG_SOURCE_ROOT = new URL("../../../src/catalog/", import.meta.url);

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error("schema fixture registration failed");
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

async function sourceFileNames(root: URL): Promise<readonly string[]> {
  const names: string[] = [];
  const visit = async (directory: URL, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(new URL(`${entry.name}/`, directory), relative);
      } else if (entry.isFile()) {
        names.push(relative);
      }
    }
  };
  await visit(root, "");
  return names.sort();
}

describe("complete catalog release acceptance", () => {
  it("pins every active v1 total and ownership boundary", async () => {
    const loaded = await loadCatalog(CATALOG_ROOT);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues, null, 2));
    expect({
      blueprint_groups: loaded.value.blueprint_groups.size,
      blueprints: loaded.value.blueprints.size,
      components: loaded.value.components.size,
      domains: loaded.value.domains.size,
      overlays: loaded.value.overlays.size,
      adapters: loaded.value.adapters.size,
      pattern_taxonomy: loaded.value.pattern_taxonomy.size,
      companion_taxonomy: loaded.value.companion_taxonomy.size,
      blueprint_fixtures: loaded.value.fixtures.size,
    }).toEqual({
      blueprint_groups: 11,
      blueprints: 62,
      components: 78,
      domains: 15,
      overlays: 46,
      adapters: 15,
      pattern_taxonomy: 257,
      companion_taxonomy: 13,
      blueprint_fixtures: 150,
    });

    const forbidden = new Set([
      "score-candidates.ts",
      "normalize-feature-map.ts",
      "parse-yaml.ts",
      "canonical-json.ts",
      "hash.ts",
      "cli-parser.ts",
    ]);
    expect(
      (await sourceFileNames(CATALOG_SOURCE_ROOT)).filter((file) =>
        forbidden.has(file.split("/").at(-1) ?? file),
      ),
    ).toEqual([]);
  });

  it("documents extension, migration, SemVer, and immutable-history rules", async () => {
    const documents = await Promise.all(
      ["CHANGELOG.md", "VERSIONING.md", "EXTENSIONS.md"].map(async (name) =>
        readFile(new URL(name, CATALOG_ROOT), "utf8"),
      ),
    );
    const text = documents.join("\n");
    expect(text).toMatch(/SemVer/u);
    expect(text).toMatch(/namespace/u);
    expect(text).toMatch(/deprecated/u);
    expect(text).toMatch(/migration/u);
    expect(text).toMatch(/immutable/u);
    expect(text).toMatch(/11 blueprint groups/u);
    expect(text).toMatch(/257 pattern/u);
    expect(text).toMatch(/150 blueprint fixtures/u);
  });

  it("verifies the committed release lock and every source byte", async () => {
    const document = await readUtf8Document(RELEASE_ROOT, "catalog.lock.json");
    if (!document.ok) throw new Error(JSON.stringify(document.issues, null, 2));
    const lock = validateWithSchema<CatalogReleaseLock>(
      "project-memory/v1/catalog-release-lock",
      document.value,
    );
    if (!lock.ok) throw new Error(JSON.stringify(lock.issues, null, 2));
    const verified = await verifyCatalogRelease(
      RELEASE_ROOT,
      lock.value,
      CATALOG_ROOT,
    );
    if (!verified.ok) throw new Error(JSON.stringify(verified.issues, null, 2));
    expect(verified.value.valid).toBe(true);
    expect(verified.value.checked_paths).toHaveLength(965);
  }, 30_000);
});
