import { describe, expect, it } from "vitest";

import { success } from "../../src/contracts/runtime-result.js";
import {
  createMigrationRegistry,
  type MigrationDefinition,
} from "../../src/migrations/index.js";

function migration(
  id: string,
  from: string,
  to: string,
): MigrationDefinition {
  return {
    id,
    from_version: from,
    to_version: to,
    affected_artifacts: ["profile-lock"],
    authority_impact: "none",
    transform: (input) => success({
      bytes: input.bytes,
      semantic_diff: [],
    }),
  };
}

describe("migration registry", () => {
  it("resolves one-hop and deterministic multi-hop forward paths", () => {
    const created = createMigrationRegistry([
      migration("v1-v2", "1.0.0", "2.0.0"),
      migration("v2-v3", "2.0.0", "3.0.0"),
    ]);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.path("1.0.0", "2.0.0")).toMatchObject({
      ok: true,
      value: [{ id: "v1-v2" }],
    });
    expect(created.value.path("1.0.0", "3.0.0")).toMatchObject({
      ok: true,
      value: [{ id: "v1-v2" }, { id: "v2-v3" }],
    });
  });

  it("rejects missing and ambiguous shortest paths", () => {
    const registry = createMigrationRegistry([
      migration("v1-v2", "1.0.0", "2.0.0"),
      migration("v1-v15", "1.0.0", "1.5.0"),
      migration("v2-v3", "2.0.0", "3.0.0"),
      migration("v15-v3", "1.5.0", "3.0.0"),
    ]);
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    expect(registry.value.path("3.0.0", "4.0.0")).toMatchObject({
      ok: false, issues: [{ code: "MIGRATION_PATH_MISSING" }],
    });
    expect(registry.value.path("1.0.0", "3.0.0")).toMatchObject({
      ok: false, issues: [{ code: "MIGRATION_PATH_AMBIGUOUS" }],
    });
  });

  it.each([
    [
      [migration("duplicate-a", "1.0.0", "2.0.0"), migration("duplicate-b", "1.0.0", "2.0.0")],
      "MIGRATION_EDGE_DUPLICATE",
    ],
    [[migration("downgrade", "2.0.0", "1.0.0")], "MIGRATION_DOWNGRADE_FORBIDDEN"],
    [
      [migration("cycle-up", "1.0.0", "2.0.0"), migration("cycle-down", "2.0.0", "1.0.0")],
      "MIGRATION_REGISTRY_CYCLE",
    ],
  ] as const)("rejects an invalid registry %#", (definitions, code) => {
    expect(createMigrationRegistry(definitions)).toMatchObject({
      ok: false,
      issues: [{ code }],
    });
  });
});
