import { failure, success } from "../contracts/runtime-result.js";
import { sha256 } from "../core/hash.js";
import type {
  AppliedMigrationStep,
  MigrationPlanInput,
  MigrationService,
} from "./contracts.js";
import { buildMigrationMutationPlan } from "./plan-mutation.js";
import type { MigrationRegistry } from "./registry.js";

export function createMigrationService(
  registry: MigrationRegistry,
): MigrationService {
  return {
    list: () => registry.list(),
    async plan(input: MigrationPlanInput) {
      await Promise.resolve();
      const actualHash = sha256(input.artifact.bytes);
      if (actualHash !== input.artifact.sha256) {
        return failure(
          "MIGRATION_INPUT_HASH_MISMATCH",
          "migration input bytes do not match the supplied source hash",
          input.artifact.relative_path,
        );
      }
      const related = input.related_preimages ?? [];
      const seenPaths = new Set([input.artifact.relative_path]);
      const seenHashes = new Set([input.artifact.sha256]);
      for (const artifact of related) {
        if (sha256(artifact.bytes) !== artifact.sha256) {
          return failure(
            "MIGRATION_INPUT_HASH_MISMATCH",
            "migration preimage bytes do not match the supplied source hash",
            artifact.relative_path,
          );
        }
        if (seenPaths.has(artifact.relative_path) || seenHashes.has(artifact.sha256)) {
          return failure(
            "MIGRATION_PREIMAGE_DUPLICATE",
            "migration preimages must have unique paths and content hashes",
            artifact.relative_path,
          );
        }
        seenPaths.add(artifact.relative_path);
        seenHashes.add(artifact.sha256);
      }
      const path = registry.path(input.from_version, input.to_version);
      if (!path.ok) return path;
      if (path.value.some((definition) => !definition.affected_artifacts.includes(input.artifact.kind))) {
        return failure(
          "MIGRATION_ARTIFACT_UNSUPPORTED",
          "migration path does not support the requested artifact kind",
          input.artifact.kind,
        );
      }
      const authority = path.value.some((definition) => definition.authority_impact === "directional")
        ? "directional" as const
        : "none" as const;
      if (authority === "directional" && input.approval_ids.length === 0) {
        return failure("MIGRATION_APPROVAL_REQUIRED", "directional migration requires Pitaji approval");
      }
      let bytes = new Uint8Array(input.artifact.bytes);
      let version = input.from_version;
      const steps: AppliedMigrationStep[] = [];
      for (const definition of path.value) {
        const stepInput = new Uint8Array(bytes);
        const transformed = definition.transform({
          artifact_kind: input.artifact.kind,
          relative_path: input.artifact.relative_path,
          from_version: definition.from_version,
          to_version: definition.to_version,
          bytes: stepInput,
          context: input.context ?? {},
        });
        if (!transformed.ok) return transformed;
        if (!(transformed.value.bytes instanceof Uint8Array)) {
          return failure("MIGRATION_OUTPUT_INVALID", "migration transform must return bytes", definition.id);
        }
        const output = new Uint8Array(transformed.value.bytes);
        steps.push({
          migration_id: definition.id,
          from_version: definition.from_version,
          to_version: definition.to_version,
          input_sha256: sha256(bytes),
          output_sha256: sha256(output),
          semantic_diff: transformed.value.semantic_diff,
        });
        bytes = output;
        version = definition.to_version;
      }
      if (version !== input.to_version) {
        return failure("MIGRATION_PATH_INCOMPLETE", "migration path did not reach the requested version");
      }
      return success(buildMigrationMutationPlan({
        request: input,
        steps,
        output_bytes: bytes,
        authority_impact: authority,
      }));
    },
  };
}
