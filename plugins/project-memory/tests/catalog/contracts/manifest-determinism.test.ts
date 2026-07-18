import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCatalogRelease } from "../../../src/catalog/manifest/build-catalog-bundle.js";
import { verifyCatalogRelease } from "../../../src/catalog/manifest/verify-catalog-release.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../../src/schema/registry.js";

const CATALOG_ROOT = new URL(
  "../../../catalog/project-memory/v1/",
  import.meta.url,
);
const temporaryRoots: string[] = [];

async function temporaryOutputRoot(): Promise<URL> {
  const root = await mkdtemp(path.join(tmpdir(), "project-memory-catalog-"));
  temporaryRoots.push(root);
  return pathToFileURL(`${root}${path.sep}`);
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error("schema fixture registration failed");
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("deterministic catalog release", () => {
  it("emits byte-identical releases from identical sources", async () => {
    const first = await buildCatalogRelease({
      sourceRoot: CATALOG_ROOT,
      outputRoot: await temporaryOutputRoot(),
      release: "1.0.0",
    });
    const second = await buildCatalogRelease({
      sourceRoot: CATALOG_ROOT,
      outputRoot: await temporaryOutputRoot(),
      release: "1.0.0",
    });
    if (!first.ok) throw new Error(JSON.stringify(first.issues, null, 2));
    if (!second.ok) throw new Error(JSON.stringify(second.issues, null, 2));

    expect(first.value.bundle_bytes).toEqual(second.value.bundle_bytes);
    expect(first.value.lock_bytes).toEqual(second.value.lock_bytes);
    expect(first.value.checksums_bytes).toEqual(second.value.checksums_bytes);
    expect(first.value.lock.release_hash).toBe(second.value.lock.release_hash);

    const verification = await verifyCatalogRelease(
      first.value.artifacts.root,
      first.value.lock,
      CATALOG_ROOT,
    );
    if (!verification.ok) {
      throw new Error(JSON.stringify(verification.issues, null, 2));
    }
    expect(verification.value.valid).toBe(true);
  }, 30_000);

  it("accepts identical existing bytes and rejects release rewrites", async () => {
    const outputRoot = await temporaryOutputRoot();
    const first = await buildCatalogRelease({
      sourceRoot: CATALOG_ROOT,
      outputRoot,
      release: "1.0.0",
    });
    if (!first.ok) throw new Error(JSON.stringify(first.issues, null, 2));

    const clean = await buildCatalogRelease({
      sourceRoot: CATALOG_ROOT,
      outputRoot,
      release: "1.0.0",
      checkClean: true,
    });
    if (!clean.ok) throw new Error(JSON.stringify(clean.issues, null, 2));
    expect(clean.value.written).toBe(false);

    const bundleUrl = new URL("catalog.bundle.json", first.value.artifacts.root);
    const original = await readFile(bundleUrl);
    await writeFile(bundleUrl, Buffer.concat([original, Buffer.from("tampered")]));
    const rewrite = await buildCatalogRelease({
      sourceRoot: CATALOG_ROOT,
      outputRoot,
      release: "1.0.0",
    });
    expect(rewrite.ok).toBe(false);
    if (!rewrite.ok) {
      expect(rewrite.issues.map((issue) => issue.code)).toContain(
        "CATALOG_RELEASE_IMMUTABLE",
      );
    }
  }, 30_000);
});
