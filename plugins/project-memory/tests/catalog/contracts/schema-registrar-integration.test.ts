import { afterEach, beforeEach, expect, it } from "vitest";

import {
  CATALOG_SCHEMA_IDS,
  registerCatalogSchemas,
} from "../../../src/catalog/contracts/index.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../../src/schema/registry.js";

beforeEach(() => {
  resetSchemaRegistryForTests();
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

it("wires catalog schemas into the foundation emitter", () => {
  expect(PROJECT_SCHEMA_REGISTRARS).toContain(registerCatalogSchemas);
  const result = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual(expect.arrayContaining([...CATALOG_SCHEMA_IDS]));
  }
});
