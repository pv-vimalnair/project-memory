import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../../src/core/canonical-json.js";
import type { RuntimeResult } from "../../../src/contracts/runtime-result.js";
import * as migrationModule from "../../../src/migrations/index.js";
import type {
  AppliedMigrationStep,
  MigrationTransformInput,
} from "../../../src/migrations/contracts.js";
import type { MigrationRegistry } from "../../../src/migrations/registry.js";

interface ExecutedPath {
  readonly bytes: Uint8Array;
  readonly steps: readonly AppliedMigrationStep[];
  readonly authority_impact: "none" | "directional";
}

type ExecutePath = (
  registry: MigrationRegistry,
  input: MigrationTransformInput,
) => RuntimeResult<ExecutedPath>;

function preMarkerConfig(): Readonly<Record<string, unknown>> {
  return {
    schema_version: "1.0.0",
    root_id: "ROOT-01J01000000000000000000000",
    memory_root: "docs/project-memory",
    profile_lock: "docs/project-memory/profile.lock.yaml",
    catalog_lock: "docs/project-memory/catalog.lock.json",
    hub: { kind: "local", repository: "." },
    policy: {
      require_clean_canonical_tree: true,
      generated_view_check: true,
      archive_secret_scan: true,
    },
  };
}

describe("Project Memory v1.1 migration", () => {
  it("normalizes LF and CRLF pre-marker config through one registered path", () => {
    const exports = migrationModule as unknown as Readonly<Record<string, unknown>>;
    expect(typeof exports.createProjectMemoryMigrationRegistry).toBe("function");
    expect(typeof exports.executeMigrationPath).toBe("function");
    expect(exports.projectMemoryV1_1Migration).toMatchObject({
      id: "project-memory-v1-1",
      from_version: "1.0.0",
      to_version: "1.1.0",
      affected_artifacts: ["profile-lock", "tool-config"],
      authority_impact: "none",
    });
    if (
      typeof exports.createProjectMemoryMigrationRegistry !== "function" ||
      typeof exports.executeMigrationPath !== "function"
    ) return;

    const createRegistry = exports.createProjectMemoryMigrationRegistry as
      () => RuntimeResult<MigrationRegistry>;
    const execute = exports.executeMigrationPath as ExecutePath;
    const registry = createRegistry();
    expect(registry).toMatchObject({ ok: true });
    if (!registry.ok) return;

    const outputs: string[] = [];
    for (const newline of ["\n", "\r\n"]) {
      const input = `${JSON.stringify(preMarkerConfig(), null, 2)}\n`.replaceAll("\n", newline);
      const migrated = execute(registry.value, {
        artifact_kind: "tool-config",
        relative_path: "tools/project-memory/config.json",
        from_version: "1.0.0",
        to_version: "1.1.0",
        bytes: new TextEncoder().encode(input),
        context: {},
      });
      expect(migrated).toMatchObject({ ok: true });
      if (!migrated.ok) continue;
      outputs.push(new TextDecoder().decode(migrated.value.bytes));
      expect(migrated.value.authority_impact).toBe("none");
      expect(migrated.value.steps).toHaveLength(1);
      expect(migrated.value.steps[0]?.semantic_diff).toEqual([{
        path: "/repository_contract_version",
        before: null,
        after: "1.1.0",
      }]);
    }

    expect(outputs).toEqual([
      canonicalJson({
        ...preMarkerConfig(),
        repository_contract_version: "1.1.0",
      }),
      canonicalJson({
        ...preMarkerConfig(),
        repository_contract_version: "1.1.0",
      }),
    ]);
  });
});
