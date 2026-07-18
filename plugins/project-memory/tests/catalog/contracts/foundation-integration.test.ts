import { describe, expect, it } from "vitest";

import { catalogFoundation } from "../../../src/catalog/foundation.js";

describe("catalog foundation integration", () => {
  it("exposes only foundation-owned infrastructure", () => {
    expect(Object.keys(catalogFoundation).sort()).toEqual([
      "canonicalJson",
      "parseJsonDocument",
      "parseYamlDocument",
      "readUtf8Document",
      "registerSchema",
      "resolveInside",
      "sha256",
      "validateWithSchema",
    ]);
  });
});
