import { canonicalMutationPlanHash } from "../contracts/canonical-mutation-plan.js";
import type { PlannedWrite } from "../contracts/planned-write.js";
import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import type {
  AppliedMigrationStep,
  MigrationMutationMetadata,
  MigrationMutationPlan,
  MigrationPlanInput,
} from "./contracts.js";

function compareUtf8(left: PlannedWrite, right: PlannedWrite): number {
  return Buffer.compare(Buffer.from(left.relative_path), Buffer.from(right.relative_path));
}

export function buildMigrationMutationPlan(input: {
  readonly request: MigrationPlanInput;
  readonly steps: readonly AppliedMigrationStep[];
  readonly output_bytes: Uint8Array;
  readonly authority_impact: "none" | "directional";
}): MigrationMutationPlan {
  const migrationId = input.steps.map((step) => step.migration_id).join("+") || "no-op";
  const inputHash = input.request.artifact.sha256;
  const outputHash = sha256(input.output_bytes);
  const changed = inputHash !== outputHash;
  const preimages = [input.request.artifact, ...(input.request.related_preimages ?? [])];
  const archivePaths = changed
    ? preimages
        .map((artifact) => `docs/project-memory/archive/migrations/${artifact.sha256}.bin`)
        .sort()
    : [];
  const archivePath = archivePaths[0] ?? null;
  const recordPath = changed
    ? `docs/project-memory/governance/migrations/${migrationId}.json`
    : null;
  const archiveWrites: PlannedWrite[] = changed
    ? preimages.map((artifact) => ({
        relative_path: `docs/project-memory/archive/migrations/${artifact.sha256}.bin`,
        bytes: new Uint8Array(artifact.bytes),
        expected_existing_sha256: null,
        mode: "create" as const,
      }))
    : [];
  const writes: PlannedWrite[] = changed ? [
    ...archiveWrites,
    {
      relative_path: recordPath as string,
      bytes: new TextEncoder().encode(canonicalJson({
        schema_version: "1.0.0",
        migration_id: migrationId,
        artifact_path: input.request.artifact.relative_path,
        from_version: input.request.from_version,
        to_version: input.request.to_version,
        input_sha256: inputHash,
        output_sha256: outputHash,
        preimages: preimages.map((artifact) => ({
          artifact_path: artifact.relative_path,
          sha256: artifact.sha256,
        })),
        steps: input.steps,
        created_at: input.request.created_at,
      })),
      expected_existing_sha256: null,
      mode: "create" as const,
    },
    {
      relative_path: input.request.artifact.relative_path,
      bytes: new Uint8Array(input.output_bytes),
      expected_existing_sha256: inputHash,
      mode: "replace" as const,
    },
  ].sort(compareUtf8) : [];
  const metadata: MigrationMutationMetadata = {
    governance_kind: "migration",
    migration_id: migrationId,
    artifact_kind: input.request.artifact.kind,
    artifact_path: input.request.artifact.relative_path,
    from_version: input.request.from_version,
    to_version: input.request.to_version,
    input_sha256: inputHash,
    output_sha256: outputHash,
    authority_impact: input.authority_impact,
    steps: input.steps,
    archive_preimage_path: archivePath,
    archive_preimage_paths: archivePaths,
    migration_record_path: recordPath,
  };
  const body: Omit<MigrationMutationPlan, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: `migration:${migrationId}:${inputHash.slice(0, 12)}`,
    mutation_kind: "migration",
    root_id: input.request.root_id,
    target_ref: input.request.target_ref,
    expected_head: input.request.expected_head,
    profile_lock_hash: input.request.profile_lock_hash,
    writes,
    record_ids: [],
    event_ids: [],
    approval_ids: [...new Set(input.request.approval_ids)].sort(),
    evidence_ids: [],
    created_by: input.request.created_by,
    created_at: input.request.created_at,
    expires_at: input.request.expires_at,
    metadata,
  };
  return { ...body, plan_hash: canonicalMutationPlanHash(body) };
}
