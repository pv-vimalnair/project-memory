import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bundleCommand } from "../../../src/catalog/commands/bundle-command.js";
import { lockCommand } from "../../../src/catalog/commands/lock-command.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../../src/schema/registry.js";

const CATALOG_ROOT = new URL(
  "../../../catalog/project-memory/v1/",
  import.meta.url,
);
let temporaryRoot: string | null = null;

beforeEach(async () => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error("schema fixture registration failed");
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "project-memory-release-command-"));
});

afterEach(async () => {
  resetSchemaRegistryForTests();
  if (temporaryRoot !== null) {
    await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = null;
  }
});

describe("catalog release commands", () => {
  it("builds and verifies the release through stable command reports", async () => {
    if (temporaryRoot === null) throw new Error("temporary root missing");
    const outputRoot = pathToFileURL(`${temporaryRoot}${path.sep}`);
    const built = await bundleCommand({
      root: CATALOG_ROOT,
      output_root: outputRoot,
      release: "1.0.0",
    });
    if (!built.ok) throw new Error(JSON.stringify(built.issues, null, 2));
    expect(built.value).toMatchObject({
      command: "bundle",
      valid: true,
      counts: { generated_artifacts: 3 },
    });

    const verified = await lockCommand({
      root: CATALOG_ROOT,
      output_root: outputRoot,
      release: "1.0.0",
      check: true,
    });
    if (!verified.ok) throw new Error(JSON.stringify(verified.issues, null, 2));
    expect(verified.value).toMatchObject({
      command: "lock",
      valid: true,
      counts: { invalid: 0 },
    });
  }, 30_000);
});
