import { failure, success } from "../contracts/runtime-result.js";
import { sha256 } from "../core/hash.js";
import type { MigrationPlanInput, MigrationService } from "./contracts.js";
import { executeMigrationPath } from "./apply-path.js";
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
      const executed = executeMigrationPath(registry, {
        artifact_kind: input.artifact.kind,
        relative_path: input.artifact.relative_path,
        from_version: input.from_version,
        to_version: input.to_version,
        bytes: input.artifact.bytes,
        context: input.context ?? {},
      });
      if (!executed.ok) return executed;
      if (
        executed.value.authority_impact === "directional" &&
        input.approval_ids.length === 0
      ) {
        return failure("MIGRATION_APPROVAL_REQUIRED", "directional migration requires Pitaji approval");
      }
      return success(buildMigrationMutationPlan({
        request: input,
        steps: executed.value.steps,
        output_bytes: executed.value.bytes,
        authority_impact: executed.value.authority_impact,
      }));
    },
  };
}
