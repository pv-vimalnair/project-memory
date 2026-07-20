import type { CanonicalMutationPlan } from "../contracts/canonical-mutation-plan.js";
import type { CanonicalSnapshot } from "../governance/snapshot/snapshot-contracts.js";
import type { AppliedMigrationStep } from "../migrations/contracts.js";

export interface RepositoryUpgradeMetadata {
  readonly governance_kind: "repository_upgrade";
  readonly migration_id: "project-memory-v1-1";
  readonly from_version: "1.0.0";
  readonly to_version: "1.1.0";
  readonly authority_impact: "none";
  readonly canonical_source_set_hash: string;
  readonly canonical_source_path_count: number;
  readonly catalog_lock_hash: string;
  readonly config_input_sha256: string;
  readonly config_output_sha256: string;
  readonly doorway_input_sha256: string;
  readonly doorway_output_sha256: string;
  readonly changed_paths: readonly string[];
  readonly derived_paths: readonly string[];
  readonly migration_record_path: string;
  readonly steps: readonly AppliedMigrationStep[];
}

export type RepositoryUpgradePlan =
  CanonicalMutationPlan<RepositoryUpgradeMetadata>;

export interface RepositoryUpgradePlanInput {
  readonly snapshot: CanonicalSnapshot;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly config_bytes: Uint8Array;
  readonly config_sha256: string;
  readonly doorway_bytes: Uint8Array;
  readonly doorway_sha256: string;
  readonly created_at: string;
  readonly expires_at: string;
}

export interface RepositoryUpgradeReplay {
  readonly created_at: string;
  readonly expires_at: string;
}
