import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  catalogChecksums,
  catalogReleaseHash,
} from "../../src/catalog/manifest/build-catalog-bundle.js";
import type { CatalogReleaseLock } from "../../src/catalog/contracts/index.js";
import { canonicalJson } from "../../src/core/canonical-json.js";
import { sha256 } from "../../src/core/hash.js";
import type { ProjectSelection } from "../../src/profile/contracts/index.js";
import { CatalogSelectionResolver } from "../../src/profile/catalog-selection-resolver.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

interface SourceIdentity {
  readonly relative_path: string;
  readonly definition_id: string | null;
  readonly version: string | null;
  readonly schema_id: string | null;
}

interface FixtureOptions {
  readonly beforeLock?: (packageRoot: string) => Promise<void>;
  readonly afterLock?: (packageRoot: string) => Promise<void>;
}

const FIXTURE_ROOT = fileURLToPath(
  new URL("../fixtures/catalog-release/minimal-valid/", import.meta.url),
);
const TAMPERED_BLUEPRINT = fileURLToPath(
  new URL(
    "../fixtures/catalog-release/tampered/application.test.yaml",
    import.meta.url,
  ),
);
const PACKAGE_SCHEMA_ROOT = fileURLToPath(
  new URL("../../schemas/project-memory/v1/", import.meta.url),
);
const REQUIRED_SCHEMA_FILES = [
  "adapter-definition.schema.json",
  "blueprint-definition.schema.json",
  "blueprint-group-definition.schema.json",
  "catalog-manifest.schema.json",
  "companion-rule-core.schema.json",
  "companion-taxonomy.schema.json",
  "component-definition.schema.json",
  "domain-definition.schema.json",
  "overlay-definition.schema.json",
  "pattern-core.schema.json",
  "pattern-taxonomy.schema.json",
] as const;
const temporaryRoots: string[] = [];

async function walkFiles(root: string, relative = ""): Promise<string[]> {
  const directory = path.join(root, ...relative.split("/").filter(Boolean));
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) =>
    Buffer.from(left.name).compare(Buffer.from(right.name)),
  )) {
    const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await walkFiles(root, child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function buildFixture(
  options: FixtureOptions = {},
): Promise<{ releaseRoot: URL; selection: ProjectSelection; packageRoot: string }> {
  const packageRoot = await mkdtemp(path.join(tmpdir(), "project-memory-profile-catalog-"));
  temporaryRoots.push(packageRoot);
  await cp(FIXTURE_ROOT, packageRoot, { recursive: true });
  const schemaRoot = path.join(packageRoot, "schemas", "project-memory", "v1");
  await mkdir(schemaRoot, { recursive: true });
  await Promise.all(
    REQUIRED_SCHEMA_FILES.map((fileName) =>
      cp(path.join(PACKAGE_SCHEMA_ROOT, fileName), path.join(schemaRoot, fileName)),
    ),
  );
  await options.beforeLock?.(packageRoot);

  const identities = JSON.parse(
    await readFile(path.join(packageRoot, "source-identities.json"), "utf8"),
  ) as SourceIdentity[];
  const sourceRoot = path.join(packageRoot, "catalog", "project-memory", "v1");
  const sourceEntries: CatalogReleaseLock["source_entries"] = [];
  for (const identity of [...identities].sort((left, right) =>
    Buffer.from(left.relative_path).compare(Buffer.from(right.relative_path)),
  )) {
    try {
      const bytes = await readFile(
        path.join(sourceRoot, ...identity.relative_path.split("/")),
      );
      sourceEntries.push({ ...identity, sha256: sha256(bytes) });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const schemaPaths = (await walkFiles(schemaRoot)).filter(
    (relativePath) => relativePath !== "schema-index.json",
  );
  const schemas = [];
  for (const relativePath of schemaPaths) {
    const bytes = await readFile(path.join(schemaRoot, ...relativePath.split("/")));
    const document = JSON.parse(bytes.toString("utf8")) as { $id: string };
    schemas.push({ id: document.$id, path: relativePath, sha256: sha256(bytes) });
  }
  schemas.sort((left, right) => Buffer.from(left.id).compare(Buffer.from(right.id)));
  await writeFile(
    path.join(schemaRoot, "schema-index.json"),
    canonicalJson({ schema_version: "1.0.0", schemas }),
  );

  const bundleBytes = Buffer.from(
    canonicalJson({ catalog_id: "project-memory", release: "1.0.0" }),
  );
  const generatedEntries: CatalogReleaseLock["generated_entries"] = [
    {
      relative_path: "catalog.bundle.json",
      definition_id: null,
      version: "1.0.0",
      schema_id: null,
      sha256: sha256(bundleBytes),
    },
  ];
  const lockWithoutHash = {
    schema_version: "1.0.0" as const,
    catalog_id: "project-memory" as const,
    release: "1.0.0",
    source_entries: sourceEntries,
    generated_entries: generatedEntries,
  };
  const lock: CatalogReleaseLock = {
    ...lockWithoutHash,
    release_hash: catalogReleaseHash(lockWithoutHash),
  };
  const lockBytes = Buffer.from(canonicalJson(lock));
  const releaseRootPath = path.join(
    packageRoot,
    "dist",
    "catalog",
    "project-memory",
    "1.0.0",
  );
  await mkdir(releaseRootPath, { recursive: true });
  await Promise.all([
    writeFile(path.join(releaseRootPath, "catalog.bundle.json"), bundleBytes),
    writeFile(path.join(releaseRootPath, "catalog.lock.json"), lockBytes),
    writeFile(
      path.join(releaseRootPath, "SHA256SUMS"),
      catalogChecksums(bundleBytes, lockBytes),
    ),
  ]);
  await options.afterLock?.(packageRoot);

  return {
    packageRoot,
    releaseRoot: pathToFileURL(`${releaseRootPath}${path.sep}`),
    selection: {
      schema_version: "1.0.0",
      root: {
        id: "ROOT-01J00000000000000000000000",
        namespace: "fixture.app",
        kind: "product",
        primary_archetype: "application-service",
        blueprint: { id: "application.test", version: "1.0.0" },
        lifecycle: "active",
      },
      overlays: ["overlay.surface.mobile"],
      components: [
        {
          instance_id: "CMP-01J00000000000000000000000",
          definition: { id: "component.mobile", version: "1.0.0" },
          slug: "mobile",
          source_revision: 1,
        },
      ],
      domains: [
        {
          instance_id: "DOM-01J00000000000000000000000",
          definition: { id: "domain.product", version: "1.0.0" },
          slug: "product",
          source_revision: 1,
        },
      ],
      adapters: {
        agent: [{ id: "adapter.codex", version: "1.0.0" }],
        runtime: [],
        workflow: [],
      },
      catalog: { release: "1.0.0", catalog_hash: lock.release_hash },
      acceptance: {
        approval_id: "APR-01J00000000000000000000000",
        accepted_by: "Pitaji",
        accepted_at: "2026-07-15T03:45:00.000Z",
      },
    },
  };
}

function sourcePath(packageRoot: string, relativePath: string): string {
  return path.join(
    packageRoot,
    "catalog",
    "project-memory",
    "v1",
    ...relativePath.split("/"),
  );
}

function schemaPath(packageRoot: string, fileName: string): string {
  return path.join(
    packageRoot,
    "schemas",
    "project-memory",
    "v1",
    fileName,
  );
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("catalog selection resolver", () => {
  it("returns both pattern halves, companion halves, transitive definitions, and schemas", async () => {
    const fixture = await buildFixture();
    const result = await new CatalogSelectionResolver().resolve(
      fixture.selection,
      fixture.releaseRoot,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));

    expect(
      result.value.files.map((file) => [file.kind, file.source_relative_path]),
    ).toEqual(
      expect.arrayContaining([
        ["blueprint", "blueprints/application-service/application.test.yaml"],
        ["pattern-core", "patterns/engineering/engineering.feature.implement.core.yaml"],
        ["pattern-taxonomy", "patterns/engineering/engineering.feature.implement.taxonomy.yaml"],
        ["companion-core", "companion-rules/companion.mutation.core.yaml"],
        ["companion-taxonomy", "companion-rules/companion.mutation.taxonomy.yaml"],
        ["definition-source", "components/component.mobile.yaml"],
        ["generated-schema", "schemas/project-memory/v1/pattern-core.schema.json"],
      ]),
    );
    expect(result.value.files.map((file) => file.target_relative_path)).toEqual(
      [...result.value.files]
        .map((file) => file.target_relative_path)
        .sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
    );
    expect(result.value.required_schema_ids).toContain(
      "project-memory/v1/pattern-core",
    );
  });

  it("rejects one changed source byte before parsing it as trusted", async () => {
    const fixture = await buildFixture({
      afterLock: async (packageRoot) => {
        await cp(
          TAMPERED_BLUEPRINT,
          sourcePath(
            packageRoot,
            "blueprints/application-service/application.test.yaml",
          ),
        );
      },
    });
    await expect(
      new CatalogSelectionResolver().resolve(
        fixture.selection,
        fixture.releaseRoot,
      ),
    ).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "CATALOG_RELEASE_SOURCE_HASH_MISMATCH" }],
    });
  });

  it("rejects a catalog with one missing pattern half", async () => {
    const fixture = await buildFixture({
      beforeLock: async (packageRoot) => {
        await unlink(
          sourcePath(
            packageRoot,
            "patterns/engineering/engineering.feature.implement.taxonomy.yaml",
          ),
        );
      },
    });
    await expect(
      new CatalogSelectionResolver().resolve(fixture.selection, fixture.releaseRoot),
    ).resolves.toMatchObject({ ok: false, issues: [{ code: "CATALOG_HALF_MISSING" }] });
  });

  it("rejects a missing selected blueprint source", async () => {
    const fixture = await buildFixture({
      beforeLock: async (packageRoot) => {
        await unlink(
          sourcePath(
            packageRoot,
            "blueprints/application-service/application.test.yaml",
          ),
        );
      },
    });
    await expect(
      new CatalogSelectionResolver().resolve(fixture.selection, fixture.releaseRoot),
    ).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "CATALOG_REFERENCE_UNRESOLVED" }],
    });
  });

  it("rejects a required emitted schema that is absent", async () => {
    const fixture = await buildFixture({
      beforeLock: async (packageRoot) => {
        await unlink(schemaPath(packageRoot, "pattern-core.schema.json"));
      },
    });
    await expect(
      new CatalogSelectionResolver().resolve(fixture.selection, fixture.releaseRoot),
    ).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "CATALOG_SCHEMA_MISSING" }],
    });
  });

  it("rejects a deprecated definition selected for the profile", async () => {
    const fixture = await buildFixture({
      beforeLock: async (packageRoot) => {
        const target = sourcePath(packageRoot, "components/component.mobile.yaml");
        const text = await readFile(target, "utf8");
        await writeFile(target, text.replace("status: active", "status: deprecated"));
      },
    });
    await expect(
      new CatalogSelectionResolver().resolve(fixture.selection, fixture.releaseRoot),
    ).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "CATALOG_DEFINITION_NOT_SELECTABLE" }],
    });
  });

  it("rejects a selection for a different catalog release", async () => {
    const fixture = await buildFixture();
    const selection: ProjectSelection = {
      ...fixture.selection,
      catalog: { ...fixture.selection.catalog, release: "2.0.0" },
    };
    await expect(
      new CatalogSelectionResolver().resolve(selection, fixture.releaseRoot),
    ).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "CATALOG_RELEASE_VERSION_MISMATCH" }],
    });
  });

  it("rejects an unresolved transitive definition reference", async () => {
    const fixture = await buildFixture({
      beforeLock: async (packageRoot) => {
        const target = sourcePath(
          packageRoot,
          "blueprints/application-service/application.test.yaml",
        );
        const text = await readFile(target, "utf8");
        await writeFile(
          target,
          text.replace("    - component.mobile", "    - component.missing"),
        );
      },
    });
    await expect(
      new CatalogSelectionResolver().resolve(fixture.selection, fixture.releaseRoot),
    ).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "CATALOG_REFERENCE_UNRESOLVED" }],
    });
  });

  it("rejects a selected definition version conflict", async () => {
    const fixture = await buildFixture();
    const component = fixture.selection.components[0];
    if (component === undefined) throw new Error("component fixture missing");
    const selection: ProjectSelection = {
      ...fixture.selection,
      components: [
        { ...component, definition: { ...component.definition, version: "2.0.0" } },
      ],
    };
    await expect(
      new CatalogSelectionResolver().resolve(selection, fixture.releaseRoot),
    ).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "CATALOG_DEFINITION_VERSION_CONFLICT" }],
    });
  });

  it("includes an unlisted dependency reached through the fixed-point closure", async () => {
    const fixture = await buildFixture({
      beforeLock: async (packageRoot) => {
        const target = sourcePath(packageRoot, "components/component.mobile.yaml");
        const text = await readFile(target, "utf8");
        await writeFile(
          target,
          text.replace("    - domain.product", "    - domain.product\n    - domain.extra"),
        );
      },
    });
    const result = await new CatalogSelectionResolver().resolve(
      fixture.selection,
      fixture.releaseRoot,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
    expect(result.value.definitions).toContainEqual(
      expect.objectContaining({ kind: "domain", id: "domain.extra" }),
    );
  });
});
