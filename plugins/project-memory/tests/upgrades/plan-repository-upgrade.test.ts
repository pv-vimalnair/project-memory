import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../src/core/canonical-json.js";
import { sha256 } from "../../src/core/hash.js";
import type { CanonicalSnapshot } from "../../src/governance/snapshot/snapshot-contracts.js";
import { GENERATED_VIEW_PATHS } from "../../src/governance/views/generate-views.js";
import { sourceSetHash } from "../../src/governance/views/view-rendering.js";
import { createProjectMemoryMigrationRegistry } from "../../src/migrations/index.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import {
  buildRepositoryUpgradePlan,
  type RepositoryUpgradePlanInput,
} from "../../src/upgrades/index.js";
import { compileProductionProfilePlan } from "../helpers/production-profile-plan.js";

const CREATED_AT = "2026-07-20T12:00:00.000Z";
const EXPIRES_AT = "2026-07-20T13:00:00.000Z";
const HEAD = "1".repeat(40);

async function fixture(): Promise<RepositoryUpgradePlanInput> {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) {
    throw new Error(JSON.stringify(registered.issues));
  }
  const compiled = await compileProductionProfilePlan();
  const doorway = compiled.plan.writes.find(
    (write) => write.relative_path === "PROJECT_CONTEXT.md",
  );
  const config = compiled.plan.writes.find(
    (write) => write.relative_path === "tools/project-memory/config.json",
  );
  if (doorway === undefined || config === undefined) {
    throw new Error("compiled fixture is missing upgrade artifacts");
  }
  const currentConfig = JSON.parse(
    new TextDecoder().decode(config.bytes),
  ) as Record<string, unknown>;
  delete currentConfig.repository_contract_version;
  const configBytes = new TextEncoder().encode(canonicalJson(currentConfig));
  const doorwayBytes = new TextEncoder().encode("legacy doorway bytes\n");
  const snapshot: CanonicalSnapshot = {
    source_revision: HEAD,
    source_kind: "tree",
    root_id: compiled.fixture.selection.root.id,
    profile_revision: compiled.plan.metadata.profile_lock.profile_revision,
    profile_lock_hash: compiled.plan.metadata.profile_lock.lock_hash,
    selected_catalog_lock_hash:
      compiled.plan.metadata.profile_lock.selected_catalog_lock_hash,
    catalog_versions: [compiled.fixture.selection.catalog.release],
    source_paths: [
      "docs/project-memory/project.yaml",
      "docs/project-memory/source/PROJECT.md",
    ],
    source_hashes: {
      "docs/project-memory/project.yaml": "2".repeat(64),
      "docs/project-memory/source/PROJECT.md": "3".repeat(64),
    },
    blob_object_ids: {
      "docs/project-memory/project.yaml": "4".repeat(40),
      "docs/project-memory/source/PROJECT.md": "5".repeat(40),
    },
    project: compiled.fixture.selection,
    profile_lock: compiled.plan.metadata.profile_lock,
    source_documents: [],
    components: [],
    domains: [],
    initiatives: [],
    workstreams: [],
    tasks: [],
    records: [],
    effective_records: [],
    evidence: [],
    risks: [],
    approvals: [],
    claims: [],
    events: [],
  };
  return {
    snapshot,
    target_ref: "refs/heads/main",
    expected_head: HEAD,
    config_bytes: configBytes,
    config_sha256: sha256(configBytes),
    doorway_bytes: doorwayBytes,
    doorway_sha256: sha256(doorwayBytes),
    created_at: CREATED_AT,
    expires_at: EXPIRES_AT,
  };
}

describe("repository contract upgrade planning", () => {
  it("builds a deterministic, allowlisted, non-directional plan", async () => {
    const input = await fixture();
    const registry = createProjectMemoryMigrationRegistry();
    expect(registry).toMatchObject({ ok: true });
    if (!registry.ok) return;

    const first = buildRepositoryUpgradePlan(input, registry.value);
    const second = buildRepositoryUpgradePlan(input, registry.value);
    expect(first).toMatchObject({ ok: true });
    expect(second).toEqual(first);
    if (!first.ok) return;

    expect(first.value.writes.map((write) => write.relative_path)).toEqual([
      "PROJECT_CONTEXT.md",
      "docs/project-memory/governance/migrations/repository-contract-1.0.0-to-1.1.0.json",
      "tools/project-memory/config.json",
    ]);
    expect(first.value.metadata.derived_paths).toEqual([...GENERATED_VIEW_PATHS]);
    expect(first.value.metadata.canonical_source_set_hash).toBe(
      sourceSetHash(input.snapshot),
    );
    expect(first.value.metadata.canonical_source_path_count).toBe(2);
    expect(first.value.metadata.authority_impact).toBe("none");
    expect(first.value.approval_ids).toEqual([]);
    expect(first.value.evidence_ids).toEqual([]);
    expect(first.value.profile_lock_hash).toBe(input.snapshot.profile_lock_hash);
    expect(first.value.expires_at).toBe(EXPIRES_AT);
    expect(first.value.writes.some((write) =>
      write.relative_path.startsWith("docs/project-memory/source/") ||
      write.relative_path.startsWith("docs/project-memory/archive/") ||
      write.relative_path.startsWith("docs/project-memory/catalog/") ||
      write.relative_path === "docs/project-memory/profile.lock.yaml"
    )).toBe(false);

    const writes = new Map(
      first.value.writes.map((write) => [write.relative_path, write]),
    );
    expect(writes.get("PROJECT_CONTEXT.md")).toMatchObject({
      mode: "replace",
      expected_existing_sha256: input.doorway_sha256,
    });
    expect(writes.get("tools/project-memory/config.json")).toMatchObject({
      mode: "replace",
      expected_existing_sha256: input.config_sha256,
    });
    expect(writes.get(first.value.metadata.migration_record_path)).toMatchObject({
      mode: "create",
      expected_existing_sha256: null,
    });

    const record = JSON.parse(new TextDecoder().decode(
      writes.get(first.value.metadata.migration_record_path)?.bytes,
    )) as Record<string, unknown>;
    expect(record).toMatchObject({
      schema_version: "1.0.0",
      migration_id: "project-memory-v1-1",
      from_version: "1.0.0",
      to_version: "1.1.0",
      authority_impact: "none",
      canonical_source_set_hash: sourceSetHash(input.snapshot),
      canonical_source_path_count: 2,
      created_at: CREATED_AT,
      created_by: "project-memory-upgrader",
    });
  });

  it("fails closed on stale bindings, bad hashes, or a non-one-hour replay window", async () => {
    const input = await fixture();
    const registry = createProjectMemoryMigrationRegistry();
    if (!registry.ok) throw new Error("migration registry fixture failed");

    expect(buildRepositoryUpgradePlan({
      ...input,
      expected_head: "9".repeat(40),
    }, registry.value)).toMatchObject({
      ok: false,
      issues: [{ code: "UPGRADE_SNAPSHOT_HEAD_MISMATCH" }],
    });
    expect(buildRepositoryUpgradePlan({
      ...input,
      config_sha256: "0".repeat(64),
    }, registry.value)).toMatchObject({
      ok: false,
      issues: [{ code: "UPGRADE_INPUT_HASH_MISMATCH" }],
    });
    expect(buildRepositoryUpgradePlan({
      ...input,
      expires_at: "2026-07-20T12:05:00.000Z",
    }, registry.value)).toMatchObject({
      ok: false,
      issues: [{ code: "UPGRADE_REPLAY_WINDOW_INVALID" }],
    });
  });
});
