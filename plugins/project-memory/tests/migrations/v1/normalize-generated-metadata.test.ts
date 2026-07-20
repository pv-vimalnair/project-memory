import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../../../src/cli/command-registry.js";
import { createMigrateCommands } from "../../../src/cli/commands/migrate.js";
import { executeCli } from "../../../src/cli/main.js";
import { parseYamlDocument } from "../../../src/core/document-io.js";
import { sha256 } from "../../../src/core/hash.js";
import { success } from "../../../src/contracts/runtime-result.js";
import type { IntegrationCoordinator } from "../../../src/governance/integration/integration-coordinator.js";
import {
  createMigrationRegistry,
  createMigrationService,
  normalizeGeneratedMetadataMigration,
  type MigrationPlanInput,
} from "../../../src/migrations/index.js";

const FIXTURE = new URL("../../fixtures/migrations/profile-v1-metadata/", import.meta.url);
const ROOT = new URL("file:///fixture/");
const HEAD = "1".repeat(40);

async function bytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(name, FIXTURE)));
}

async function request(
  profileName = "profile.before.yaml",
  fromVersion = "1.0.0",
  toVersion = "1.1.0",
): Promise<MigrationPlanInput> {
  const profile = await bytes(profileName);
  const catalog = await bytes("catalog.lock.json");
  return {
    root_id: "ROOT-01J00000000000000000000000",
    target_ref: "refs/heads/main",
    expected_head: HEAD,
    profile_lock_hash: sha256(profile),
    artifact: {
      kind: "profile-lock",
      relative_path: "docs/project-memory/profile.lock.yaml",
      bytes: profile,
      sha256: sha256(profile),
    },
    related_preimages: [{
      kind: "catalog-lock",
      relative_path: "docs/project-memory/catalog.lock.json",
      bytes: catalog,
      sha256: sha256(catalog),
    }],
    from_version: fromVersion,
    to_version: toVersion,
    created_by: "codex",
    created_at: "2026-07-16T10:00:00.000Z",
    expires_at: "2026-07-16T11:00:00.000Z",
    approval_ids: [],
  };
}

function service() {
  const registry = createMigrationRegistry([normalizeGeneratedMetadataMigration]);
  if (!registry.ok) throw new Error("fixture registry failed");
  return createMigrationService(registry.value);
}

describe("normalize generated profile metadata", () => {
  it("matches exact golden bytes while preserving semantic and authority content", async () => {
    const input = await request();
    const expected = await bytes("profile.after.yaml");
    const planned = await service().plan(input);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const replacement = planned.value.writes.find(
      (write) => write.relative_path === "docs/project-memory/profile.lock.yaml",
    );
    expect(replacement?.bytes).toEqual(expected);
    expect(replacement?.expected_existing_sha256).toBe(input.artifact.sha256);
    expect(planned.value.metadata.output_sha256).toBe(sha256(expected));
    expect(planned.value.metadata.steps[0]?.semantic_diff).toEqual([{
      path: "/generated_metadata",
      before: "2026-07-15T03:45:00.000Z",
      after: "normalized",
    }]);

    const beforeValue = parseYamlDocument(new TextDecoder().decode(input.artifact.bytes), "before");
    const afterValue = parseYamlDocument(new TextDecoder().decode(expected), "after");
    expect(beforeValue.ok && beforeValue.value).toEqual(afterValue.ok && afterValue.value);
    expect(new TextDecoder().decode(expected)).toContain('accepted_by: "Pitaji"');
    expect(new TextDecoder().decode(expected)).toContain("APR-01J00000000000000000000000");
  });

  it("archives exact profile and catalog lock preimages and then becomes a no-op", async () => {
    const input = await request();
    const planned = await service().plan(input);
    if (!planned.ok) throw new Error("fixture planning failed");
    const catalog = input.related_preimages?.[0];
    if (catalog === undefined) throw new Error("catalog fixture missing");
    const archivePaths = [
      `docs/project-memory/archive/migrations/${input.artifact.sha256}.bin`,
      `docs/project-memory/archive/migrations/${catalog.sha256}.bin`,
    ].sort();
    expect(planned.value.writes.map((write) => write.relative_path)).toEqual([
      ...archivePaths,
      "docs/project-memory/governance/migrations/project-memory-v1-1.json",
      "docs/project-memory/profile.lock.yaml",
    ]);
    expect(planned.value.metadata.archive_preimage_paths).toEqual(archivePaths);

    const second = await service().plan(await request("profile.after.yaml", "1.1.0", "1.1.0"));
    expect(second).toMatchObject({ ok: true, value: { writes: [] } });
  });

  it("persists only through IntegrationCoordinator.finalizeMutation", async () => {
    const migration = service();
    const input = await request();
    const planned = await migration.plan(input);
    if (!planned.ok) throw new Error("fixture planning failed");
    const integration = {
      bootstrap: vi.fn(),
      finalizeMutation: vi.fn(() => Promise.resolve(success({ status: "mutation_integrated" } as never))),
      validate: vi.fn(),
      finalize: vi.fn(),
    } satisfies IntegrationCoordinator;
    const planSpy = vi.spyOn(migration, "plan");
    const execution = await executeCli([
      "migrate", "apply", "--input", "migration.json",
      "--expected-plan-hash", planned.value.plan_hash,
      "--expected-head", HEAD,
    ], {
      registry: new CommandRegistry(createMigrateCommands({
        service: migration,
        coordinator: integration,
        read_input: () => Promise.resolve(success(input)),
      })),
      current_directory: ROOT,
    });
    expect(execution.exit_code).toBe(0);
    expect(planSpy).toHaveBeenCalledTimes(1);
    expect(integration.finalizeMutation).toHaveBeenCalledTimes(1);
    expect("apply" in migration).toBe(false);
  });
});
