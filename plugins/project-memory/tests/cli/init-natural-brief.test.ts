import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import type { BlueprintDefinition } from "../../src/catalog/contracts/index.js";
import { inferBlueprintFromBrief } from "../../src/cli/init/build-init-plan.js";

interface CatalogDocument {
  readonly definitions: { readonly blueprints: readonly BlueprintDefinition[] };
}

let blueprints: readonly BlueprintDefinition[] = [];

beforeAll(async () => {
  const document = JSON.parse(await readFile(
    new URL("../../dist/catalog/project-memory/1.0.0/catalog.bundle.json", import.meta.url),
    "utf8",
  )) as CatalogDocument;
  blueprints = document.definitions.blueprints;
});

describe("catalog-derived natural brief classification", () => {
  it("derives one active blueprint and its sole allowed root kind", () => {
    const result = inferBlueprintFromBrief(
      new URL("file:///C:/project/"),
      "BRIEF.md",
      "Build an application consumer mobile experience for daily practice.",
      blueprints,
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        blueprint: { id: "application.consumer-mobile", status: "active" },
        root_kind: "product",
        observations: [
          { id: "root.kind", value: "product" },
          { id: "product.shape", value: "application.consumer-mobile" },
        ],
      },
    });
  });

  it.each([
    "Don't build an application consumer mobile.",
    "Build an application consumer mobile for daily habit tracking but do not build any application consumer mobile.",
    "Build an application for each consumer but avoid mobile features.",
    "Build an application desktop but not an application consumer mobile.",
  ])("fails closed when mobile evidence is negated or contradictory: %s", (brief) => {
    const result = inferBlueprintFromBrief(
      new URL("file:///C:/project/"),
      "BRIEF.md",
      brief,
      blueprints,
    );

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "INIT_BLUEPRINT_CLARIFICATION_REQUIRED" }],
    });
  });

  it("fails closed when no catalog identifier is evidenced", () => {
    const result = inferBlueprintFromBrief(
      new URL("file:///C:/project/"),
      "BRIEF.md",
      "Help people practice a little every day.",
      blueprints,
    );

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "INIT_BLUEPRINT_CLARIFICATION_REQUIRED", path: "BRIEF.md" }],
    });
  });

  it("fails closed when strongest catalog evidence is tied", () => {
    const result = inferBlueprintFromBrief(
      new URL("file:///C:/project/"),
      "BRIEF.md",
      "Build an application consumer mobile multisurface experience.",
      blueprints,
    );

    expect(result).toMatchObject({
      ok: false,
      issues: [{
        code: "INIT_BLUEPRINT_CLARIFICATION_REQUIRED",
        references: [
          "application.consumer-mobile",
          "application.consumer-multisurface",
        ],
      }],
    });
  });
});
