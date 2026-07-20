import type { CanonicalMutationPlan } from "../contracts/canonical-mutation-plan.js";
import type { RuntimeResult } from "../contracts/runtime-result.js";

export type ArtifactKind =
  | "project-selection"
  | "profile-lock"
  | "tool-config"
  | "catalog-lock"
  | "canonical-source"
  | "governance-record"
  | "generated-view"
  | "archive-object";

export interface MigrationSemanticChange {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface MigrationTransformInput {
  readonly artifact_kind: ArtifactKind;
  readonly relative_path: string;
  readonly from_version: string;
  readonly to_version: string;
  readonly bytes: Uint8Array;
  readonly context: Readonly<Record<string, unknown>>;
}

export interface MigrationOutput {
  readonly bytes: Uint8Array;
  readonly semantic_diff: readonly MigrationSemanticChange[];
}

export interface MigrationDefinition {
  readonly id: string;
  readonly from_version: string;
  readonly to_version: string;
  readonly affected_artifacts: readonly ArtifactKind[];
  readonly authority_impact: "none" | "directional";
  transform(input: MigrationTransformInput): RuntimeResult<MigrationOutput>;
}

export interface MigrationSummary {
  readonly id: string;
  readonly from_version: string;
  readonly to_version: string;
  readonly affected_artifacts: readonly ArtifactKind[];
  readonly authority_impact: "none" | "directional";
}

export interface MigrationArtifactInput {
  readonly kind: ArtifactKind;
  readonly relative_path: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface MigrationPlanInput {
  readonly root_id: string;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly profile_lock_hash: string;
  readonly artifact: MigrationArtifactInput;
  readonly related_preimages?: readonly MigrationArtifactInput[];
  readonly from_version: string;
  readonly to_version: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly approval_ids: readonly string[];
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface AppliedMigrationStep {
  readonly migration_id: string;
  readonly from_version: string;
  readonly to_version: string;
  readonly input_sha256: string;
  readonly output_sha256: string;
  readonly semantic_diff: readonly MigrationSemanticChange[];
}

export interface MigrationMutationMetadata {
  readonly governance_kind: "migration";
  readonly migration_id: string;
  readonly artifact_kind: ArtifactKind;
  readonly artifact_path: string;
  readonly from_version: string;
  readonly to_version: string;
  readonly input_sha256: string;
  readonly output_sha256: string;
  readonly authority_impact: "none" | "directional";
  readonly steps: readonly AppliedMigrationStep[];
  readonly archive_preimage_path: string | null;
  readonly archive_preimage_paths: readonly string[];
  readonly migration_record_path: string | null;
}

export type MigrationMutationPlan = CanonicalMutationPlan<MigrationMutationMetadata>;

export interface MigrationService {
  list(): readonly MigrationSummary[];
  plan(input: MigrationPlanInput): Promise<RuntimeResult<MigrationMutationPlan>>;
}
