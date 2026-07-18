import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as foundation from "../../src/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

beforeEach(() => {
  resetSchemaRegistryForTests();
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("public schema index", () => {
  it("contains only unique, versioned schema identifiers", () => {
    const registration = foundation.registerProjectSchemas(
      foundation.PROJECT_SCHEMA_REGISTRARS,
    );

    expect(registration.ok).toBe(true);
    const identifiers = foundation
      .getRegisteredSchemas()
      .map((schema) => schema.$id);
    expect(identifiers.length).toBeGreaterThan(0);
    expect(new Set(identifiers).size).toBe(identifiers.length);
    expect(
      identifiers.every((identifier) =>
        /^project-memory\/v1\/[a-z][a-z0-9-]*$/.test(identifier),
      ),
    ).toBe(true);
  });

  it("does not expose the test-only registry reset through package exports", () => {
    expect(foundation).not.toHaveProperty("resetSchemaRegistryForTests");
  });
});
