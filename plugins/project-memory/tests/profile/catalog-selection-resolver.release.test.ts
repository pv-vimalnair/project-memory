import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CatalogReleaseLock } from "../../src/catalog/contracts/index.js";
import { canonicalJson } from "../../src/core/canonical-json.js";
import { buildSelectedCatalogLock } from "../../src/profile/build-selected-catalog-lock.js";
import { buildSelectedCatalogVendoring } from "../../src/profile/vendor-selected-catalog.js";
import { verifySelectedCatalogLock } from "../../src/profile/verify-selected-catalog-lock.js";
import { CatalogSelectionResolver } from "../../src/profile/catalog-selection-resolver.js";
import type { ProjectSelection } from "../../src/profile/contracts/index.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const RELEASE_ROOT = new URL(
  "../../dist/catalog/project-memory/1.0.0/",
  import.meta.url,
);

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("frozen catalog selection release", () => {
  it("resolves the real 1.0.0 catalog from its accepted release hash", async () => {
    const lock = JSON.parse(
      await readFile(new URL("catalog.lock.json", RELEASE_ROOT), "utf8"),
    ) as CatalogReleaseLock;
    const selection: ProjectSelection = {
      schema_version: "1.0.0",
      root: {
        id: "ROOT-01J00000000000000000000000",
        namespace: "lifeof.app",
        kind: "product",
        primary_archetype: "application-service",
        blueprint: { id: "application.consumer-mobile", version: "1.0.0" },
        lifecycle: "production",
      },
      overlays: ["overlay.surface.mobile"],
      components: [
        {
          instance_id: "CMP-01J00000000000000000000000",
          definition: { id: "component.mobile-client", version: "1.0.0" },
          slug: "mobile-client",
          source_revision: 1,
        },
      ],
      domains: [
        {
          instance_id: "DOM-01J00000000000000000000000",
          definition: { id: "domain.product-strategy", version: "1.0.0" },
          slug: "product-strategy",
          source_revision: 1,
        },
      ],
      adapters: {
        agent: [{ id: "adapter.codex", version: "1.0.0" }],
        runtime: [],
        workflow: [],
      },
      catalog: { release: lock.release, catalog_hash: lock.release_hash },
      acceptance: {
        approval_id: "APR-01J00000000000000000000000",
        accepted_by: "Pitaji",
        accepted_at: "2026-07-15T03:45:00.000Z",
      },
    };

    const result = await new CatalogSelectionResolver().resolve(
      selection,
      RELEASE_ROOT,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
    expect(result.value.release_hash).toBe(lock.release_hash);
    expect(result.value.files.filter((file) => file.kind === "pattern-core")).toHaveLength(257);
    expect(result.value.files.filter((file) => file.kind === "companion-core")).toHaveLength(13);
    expect(result.value.files.map((file) => file.target_relative_path)).toEqual(
      [...result.value.files]
        .map((file) => file.target_relative_path)
        .sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
    );
    const selectedLock = buildSelectedCatalogLock(result.value);
    if (!selectedLock.ok) {
      throw new Error(JSON.stringify(selectedLock.issues, null, 2));
    }
    const writes = buildSelectedCatalogVendoring(result.value, selectedLock.value);
    if (!writes.ok) throw new Error(JSON.stringify(writes.issues, null, 2));
    expect(selectedLock.value.entries).toHaveLength(result.value.files.length);
    expect(writes.value).toHaveLength(result.value.files.length);

    const targetRoot = await mkdtemp(
      path.join(tmpdir(), "project-memory-full-selected-catalog-"),
    );
    try {
      for (const write of writes.value) {
        const target = path.join(targetRoot, ...write.relative_path.split("/"));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, write.bytes);
      }
      const lockTarget = path.join(
        targetRoot,
        "docs",
        "project-memory",
        "catalog.lock.json",
      );
      await mkdir(path.dirname(lockTarget), { recursive: true });
      await writeFile(lockTarget, canonicalJson(selectedLock.value));
      resetSchemaRegistryForTests();
      const targetVerification = await verifySelectedCatalogLock(
        pathToFileURL(`${targetRoot}${path.sep}`),
      );
      expect(targetVerification).toMatchObject({
        ok: true,
        value: { external_reads: [], lock_hash: selectedLock.value.lock_hash },
      });
    } finally {
      await rm(targetRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
