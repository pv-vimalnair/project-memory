import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateCatalogCommand } from "../../../src/catalog/commands/validate-catalog-command.js";
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

describe("catalog validate command flags", () => {
  it("preserves strict validation when a scope is supplied", async () => {
    const validated = await validateCatalogCommand({
      root: CATALOG_ROOT,
      scope: "all",
      strict: true,
    });
    if (!validated.ok) {
      throw new Error(JSON.stringify(validated.issues, null, 2));
    }
    expect(validated.value.details).toMatchObject({
      scope: "all",
      strict: true,
    });
  });
});