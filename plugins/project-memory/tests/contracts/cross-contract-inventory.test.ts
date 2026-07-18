import { describe, expect, expectTypeOf, it } from "vitest";

import {
  PATTERN_FAMILY_IDS,
  PATTERN_MODE_VALUES,
  PRIMARY_ARCHETYPE_VALUES,
  ROOT_KIND_VALUES,
  SELECTION_DISPOSITION_VALUES,
  type PatternModeValue,
  type PrimaryArchetypeValue,
  type RootKindValue,
} from "../../src/contracts/vocabulary.js";
import {
  PatternIdSchema,
  PatternModeSchema,
  PrimaryArchetypeSchema,
  RootKindSchema,
  type PatternMode as CatalogPatternMode,
  type PrimaryArchetype,
  type RootKind,
} from "../../src/catalog/contracts/common.js";
import { classifyCatalogSource } from "../../src/catalog/loading/source-files.js";
import { SelectionResultSchema } from "../../src/selection/contracts/selection.js";
import type { SelectionContext } from "../../src/selection/types.js";
import type { PatternMode as PlanningPatternMode } from "../../src/planning/types.js";

describe("checkpoint B cross-contract inventory", () => {
  it("locks the approved vocabulary counts and literals", () => {
    expect(ROOT_KIND_VALUES).toHaveLength(5);
    expect(PRIMARY_ARCHETYPE_VALUES).toHaveLength(11);
    expect(PATTERN_MODE_VALUES).toHaveLength(9);
    expect(PATTERN_FAMILY_IDS).toHaveLength(16);
    expect(SELECTION_DISPOSITION_VALUES).toHaveLength(3);
    expect(unionLiterals(RootKindSchema)).toEqual([...ROOT_KIND_VALUES]);
    expect(unionLiterals(PrimaryArchetypeSchema)).toEqual([
      ...PRIMARY_ARCHETYPE_VALUES,
    ]);
    expect(unionLiterals(PatternModeSchema)).toEqual([...PATTERN_MODE_VALUES]);
    expect(
      unionLiterals(SelectionResultSchema.properties.disposition),
    ).toEqual([...SELECTION_DISPOSITION_VALUES]);
  });

  it("keeps TypeScript surfaces narrowed to the same vocabularies", () => {
    expectTypeOf<RootKind>().toEqualTypeOf<RootKindValue>();
    expectTypeOf<PrimaryArchetype>().toEqualTypeOf<PrimaryArchetypeValue>();
    expectTypeOf<CatalogPatternMode>().toEqualTypeOf<PatternModeValue>();
    expectTypeOf<PlanningPatternMode>().toEqualTypeOf<PatternModeValue>();
    expectTypeOf<SelectionContext["rootKind"]>().toEqualTypeOf<RootKindValue>();
    expectTypeOf<SelectionContext["primaryArchetype"]>().toEqualTypeOf<
      PrimaryArchetypeValue
    >();
  });

  it("restricts pattern IDs to the approved families and modes", () => {
    const pattern = new RegExp(String(PatternIdSchema.pattern));
    for (const family of PATTERN_FAMILY_IDS) {
      for (const mode of PATTERN_MODE_VALUES) {
        expect(pattern.test(`${family}.sample.${mode}`)).toBe(true);
      }
    }
    expect(pattern.test("unknown.sample.implement")).toBe(false);
    expect(pattern.test("engineering.sample.unknown")).toBe(false);
  });

  it("locks every source path to its canonical YAML wrapper key", () => {
    const cases = [
      ["manifest.yaml", "catalog"],
      ["blueprint-groups/blueprint-group.application-service.yaml", "blueprint_group"],
      ["blueprints/application.consumer-mobile.yaml", "blueprint"],
      ["components/component.client.yaml", "component_definition"],
      ["domains/domain.identity.yaml", "domain_definition"],
      ["overlays/runtime/overlay.runtime.realtime.yaml", "overlay_definition"],
      ["adapters/adapter.codex.yaml", "adapter_definition"],
      ["patterns/engineering/engineering.feature.implement.core.yaml", null],
      ["patterns/engineering/engineering.feature.implement.taxonomy.yaml", "pattern_taxonomy"],
      ["companion-rules/companion.mutation.core.yaml", null],
      ["companion-rules/companion.mutation.taxonomy.yaml", "companion_taxonomy"],
      ["fixtures/application.consumer-mobile.positive.yaml", "fixture"],
      ["inventories/inventory.blueprints.yaml", "inventory"],
    ] as const;
    for (const [sourcePath, wrapper] of cases) {
      const result = classifyCatalogSource(sourcePath);
      expect(result.ok && result.value?.wrapper).toBe(wrapper);
    }
  });
});

function unionLiterals(schema: unknown): readonly string[] {
  if (typeof schema !== "object" || schema === null || !("anyOf" in schema)) {
    throw new Error("expected a literal union schema");
  }
  const anyOf = (schema as { readonly anyOf: readonly unknown[] }).anyOf;
  return anyOf.map((entry) => {
    if (typeof entry !== "object" || entry === null || !("const" in entry)) {
      throw new Error("expected a literal schema member");
    }
    return String((entry as { readonly const: unknown }).const);
  });
}
