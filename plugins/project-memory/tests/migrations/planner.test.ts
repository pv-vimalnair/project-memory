import { describe, expect, it, vi } from "vitest";

import { success } from "../../src/contracts/runtime-result.js";
import { sha256 } from "../../src/core/hash.js";
import { CommandRegistry } from "../../src/cli/command-registry.js";
import { createMigrateCommands } from "../../src/cli/commands/migrate.js";
import { executeCli } from "../../src/cli/main.js";
import type { IntegrationCoordinator } from "../../src/governance/integration/integration-coordinator.js";
import {
  createMigrationRegistry,
  createMigrationService,
  type MigrationDefinition,
  type MigrationPlanInput,
} from "../../src/migrations/index.js";

const ROOT = new URL("file:///fixture/");
const HEAD = "1".repeat(40);
const SOURCE = new TextEncoder().encode('{"schema_version":"1.0.0","generated_at":"old"}\n');

function definition(): MigrationDefinition {
  return {
    id: "normalize-generated-metadata",
    from_version: "1.0.0",
    to_version: "1.1.0",
    affected_artifacts: ["profile-lock"],
    authority_impact: "none",
    transform: (input) => success({
      bytes: new TextEncoder().encode(
        new TextDecoder().decode(input.bytes).replace('"generated_at":"old"', '"generated_at":"normalized"'),
      ),
      semantic_diff: [{ path: "/generated_at", before: "old", after: "normalized" }],
    }),
  };
}

function input(overrides: Partial<MigrationPlanInput> = {}): MigrationPlanInput {
  return {
    root_id: "ROOT-01J00000000000000000000000",
    target_ref: "refs/heads/main",
    expected_head: HEAD,
    profile_lock_hash: "2".repeat(64),
    artifact: {
      kind: "profile-lock",
      relative_path: "docs/project-memory/profile.lock.yaml",
      bytes: SOURCE,
      sha256: sha256(SOURCE),
    },
    from_version: "1.0.0",
    to_version: "1.1.0",
    created_by: "codex",
    created_at: "2026-07-16T10:00:00.000Z",
    expires_at: "2026-07-16T11:00:00.000Z",
    approval_ids: [],
    ...overrides,
  };
}

function service() {
  const registry = createMigrationRegistry([definition()]);
  if (!registry.ok) throw new Error("fixture registry failed");
  return createMigrationService(registry.value);
}

describe("migration planner", () => {
  it("rejects an input hash mismatch", async () => {
    expect(await service().plan(input({
      artifact: { ...input().artifact, sha256: "9".repeat(64) },
    }))).toMatchObject({
      ok: false,
      issues: [{ code: "MIGRATION_INPUT_HASH_MISMATCH" }],
    });
  });

  it("is deterministic and pure, including dry-run use", async () => {
    const original = new Uint8Array(SOURCE);
    const first = await service().plan(input());
    const second = await service().plan(input());
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.plan_hash).toBe(second.value.plan_hash);
    expect(first.value.writes.map((write) => write.relative_path)).toEqual([
      "docs/project-memory/archive/migrations/" + sha256(SOURCE) + ".bin",
      "docs/project-memory/governance/migrations/normalize-generated-metadata.json",
      "docs/project-memory/profile.lock.yaml",
    ]);
    expect(SOURCE).toEqual(original);
    expect("apply" in service()).toBe(false);
    expect("write" in service()).toBe(false);
  });

  it("recomputes CLI apply and delegates only to finalizeMutation", async () => {
    const migration = service();
    const planned = await migration.plan(input());
    if (!planned.ok) throw new Error("fixture planning failed");
    const planSpy = vi.spyOn(migration, "plan");
    const integration = {
      bootstrap: vi.fn(),
      finalizeMutation: vi.fn(() => Promise.resolve(success({ status: "mutation_integrated" } as never))),
      validate: vi.fn(),
      finalize: vi.fn(),
    } satisfies IntegrationCoordinator;
    const commands = createMigrateCommands({
      service: migration,
      coordinator: integration,
      read_input: () => Promise.resolve(success(input())),
    });
    const execution = await executeCli([
      "migrate", "apply", "--input", "migration.json",
      "--expected-plan-hash", planned.value.plan_hash,
      "--expected-head", HEAD,
    ], { registry: new CommandRegistry(commands), current_directory: ROOT });
    expect(execution.exit_code).toBe(0);
    expect(planSpy).toHaveBeenCalledTimes(1);
    expect(integration.finalizeMutation).toHaveBeenCalledTimes(1);
  });
});
