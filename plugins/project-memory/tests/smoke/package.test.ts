import { describe, expect, it } from "vitest";

import { PACKAGE_SCHEMA_VERSION } from "../../src/index.js";

describe("package foundation", () => {
  it("exports the v1 schema version", () => {
    expect(PACKAGE_SCHEMA_VERSION).toBe("1.0.0");
  });
});
