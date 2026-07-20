import { canonicalMutationPlanHash } from "../contracts/canonical-mutation-plan.js";
import type { PlannedWrite } from "../contracts/planned-write.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import { GENERATED_VIEW_PATHS } from "../governance/views/generate-views.js";
import { sourceSetHash } from "../governance/views/view-rendering.js";
import {
  PROJECT_CONTEXT_PATH,
  renderStartupContext,
} from "../materialize/render-startup-context.js";
import { CONFIG_RELATIVE_PATH } from "../cli/config.js";
import { executeMigrationPath } from "../migrations/apply-path.js";
import type { MigrationRegistry } from "../migrations/registry.js";
import {
  LEGACY_REPOSITORY_CONTRACT_VERSION,
  REPOSITORY_CONTRACT_VERSION,
} from "../version.js";
import type {
  RepositoryUpgradeMetadata,
  RepositoryUpgradePlan,
  RepositoryUpgradePlanInput,
} from "./contracts.js";

export const REPOSITORY_UPGRADE_RECORD_PATH =
  "docs/project-memory/governance/migrations/repository-contract-1.0.0-to-1.1.0.json" as const;

const CREATED_BY = "project-memory-upgrader" as const;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ONE_HOUR_MS = 60 * 60 * 1000;

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function validateReplayWindow(
  createdAt: string,
  expiresAt: string,
): RuntimeResult<true> {
  if (!UTC_TIMESTAMP.test(createdAt) || !UTC_TIMESTAMP.test(expiresAt)) {
    return failure(
      "UPGRADE_REPLAY_WINDOW_INVALID",
      "repository upgrade timestamps must be canonical UTC timestamps",
    );
  }
  const created = Date.parse(createdAt);
  const expires = Date.parse(expiresAt);
  if (
    !Number.isFinite(created) ||
    !Number.isFinite(expires) ||
    expires - created !== ONE_HOUR_MS
  ) {
    return failure(
      "UPGRADE_REPLAY_WINDOW_INVALID",
      "repository upgrade proposals must remain valid for exactly one hour",
    );
  }
  return success(true);
}

function validateInputBindings(
  input: RepositoryUpgradePlanInput,
): RuntimeResult<true> {
  if (input.snapshot.source_revision !== input.expected_head) {
    return failure(
      "UPGRADE_SNAPSHOT_HEAD_MISMATCH",
      "upgrade snapshot must bind the expected HEAD",
      input.expected_head,
    );
  }
  if (
    sha256(input.config_bytes) !== input.config_sha256 ||
    sha256(input.doorway_bytes) !== input.doorway_sha256
  ) {
    return failure(
      "UPGRADE_INPUT_HASH_MISMATCH",
      "upgrade input bytes must match their supplied preimage hashes",
    );
  }
  return validateReplayWindow(input.created_at, input.expires_at);
}

function migrationRecordBytes(
  metadata: RepositoryUpgradeMetadata,
  createdAt: string,
): Uint8Array {
  return new TextEncoder().encode(canonicalJson({
    schema_version: "1.0.0",
    migration_id: metadata.migration_id,
    from_version: metadata.from_version,
    to_version: metadata.to_version,
    authority_impact: metadata.authority_impact,
    canonical_source_set_hash: metadata.canonical_source_set_hash,
    canonical_source_path_count: metadata.canonical_source_path_count,
    catalog_lock_hash: metadata.catalog_lock_hash,
    config_input_sha256: metadata.config_input_sha256,
    config_output_sha256: metadata.config_output_sha256,
    doorway_input_sha256: metadata.doorway_input_sha256,
    doorway_output_sha256: metadata.doorway_output_sha256,
    changed_paths: metadata.changed_paths,
    derived_paths: metadata.derived_paths,
    steps: metadata.steps,
    created_at: createdAt,
    created_by: CREATED_BY,
  }));
}

export function buildRepositoryUpgradePlan(
  input: RepositoryUpgradePlanInput,
  registry: MigrationRegistry,
): RuntimeResult<RepositoryUpgradePlan> {
  const bindings = validateInputBindings(input);
  if (!bindings.ok) return bindings;

  const migrated = executeMigrationPath(registry, {
    artifact_kind: "tool-config",
    relative_path: CONFIG_RELATIVE_PATH,
    from_version: LEGACY_REPOSITORY_CONTRACT_VERSION,
    to_version: REPOSITORY_CONTRACT_VERSION,
    bytes: input.config_bytes,
    context: {},
  });
  if (!migrated.ok) return migrated;
  if (migrated.value.authority_impact !== "none") {
    return failure(
      "UPGRADE_AUTHORITY_UNEXPECTED",
      "repository contract v1.1 upgrade must remain non-directional",
      migrated.value.authority_impact,
    );
  }

  const doorway = renderStartupContext(
    input.snapshot.project,
    input.snapshot.profile_lock.profile,
    input.snapshot.profile_lock,
  );
  if (!doorway.ok) return doorway;

  const changedPaths = [
    PROJECT_CONTEXT_PATH,
    REPOSITORY_UPGRADE_RECORD_PATH,
    CONFIG_RELATIVE_PATH,
  ].sort(compareUtf8);
  const metadata: RepositoryUpgradeMetadata = {
    governance_kind: "repository_upgrade",
    migration_id: "project-memory-v1-1",
    from_version: LEGACY_REPOSITORY_CONTRACT_VERSION,
    to_version: REPOSITORY_CONTRACT_VERSION,
    authority_impact: "none",
    canonical_source_set_hash: sourceSetHash(input.snapshot),
    canonical_source_path_count: input.snapshot.source_paths.length,
    catalog_lock_hash: input.snapshot.selected_catalog_lock_hash,
    config_input_sha256: input.config_sha256,
    config_output_sha256: sha256(migrated.value.bytes),
    doorway_input_sha256: input.doorway_sha256,
    doorway_output_sha256: sha256(doorway.value.bytes),
    changed_paths: changedPaths,
    derived_paths: [...GENERATED_VIEW_PATHS],
    migration_record_path: REPOSITORY_UPGRADE_RECORD_PATH,
    steps: migrated.value.steps,
  };
  const writes: PlannedWrite[] = [
    {
      relative_path: PROJECT_CONTEXT_PATH,
      bytes: new Uint8Array(doorway.value.bytes),
      expected_existing_sha256: input.doorway_sha256,
      mode: "replace" as const,
    },
    {
      relative_path: REPOSITORY_UPGRADE_RECORD_PATH,
      bytes: migrationRecordBytes(metadata, input.created_at),
      expected_existing_sha256: null,
      mode: "create" as const,
    },
    {
      relative_path: CONFIG_RELATIVE_PATH,
      bytes: new Uint8Array(migrated.value.bytes),
      expected_existing_sha256: input.config_sha256,
      mode: "replace" as const,
    },
  ].sort((left, right) => compareUtf8(left.relative_path, right.relative_path));
  const body: Omit<RepositoryUpgradePlan, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: `repository-upgrade:${input.snapshot.root_id}:${input.config_sha256.slice(0, 12)}`,
    mutation_kind: "migration",
    root_id: input.snapshot.root_id,
    target_ref: input.target_ref,
    expected_head: input.expected_head,
    profile_lock_hash: input.snapshot.profile_lock_hash,
    writes,
    record_ids: [],
    event_ids: [],
    approval_ids: [],
    evidence_ids: [],
    created_by: CREATED_BY,
    created_at: input.created_at,
    expires_at: input.expires_at,
    metadata,
  };
  return success({
    ...body,
    plan_hash: canonicalMutationPlanHash(body),
  });
}
