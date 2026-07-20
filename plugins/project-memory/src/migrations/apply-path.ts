import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { sha256 } from "../core/hash.js";
import type {
  AppliedMigrationStep,
  MigrationTransformInput,
} from "./contracts.js";
import type { MigrationRegistry } from "./registry.js";

export type ExecuteMigrationPathInput = MigrationTransformInput;

export interface ExecutedMigrationPath {
  readonly bytes: Uint8Array;
  readonly steps: readonly AppliedMigrationStep[];
  readonly authority_impact: "none" | "directional";
}

export function executeMigrationPath(
  registry: MigrationRegistry,
  input: ExecuteMigrationPathInput,
): RuntimeResult<ExecutedMigrationPath> {
  const path = registry.path(input.from_version, input.to_version);
  if (!path.ok) return path;
  if (path.value.some((definition) =>
    !definition.affected_artifacts.includes(input.artifact_kind))) {
    return failure(
      "MIGRATION_ARTIFACT_UNSUPPORTED",
      "migration path does not support the requested artifact kind",
      input.artifact_kind,
    );
  }

  let bytes = new Uint8Array(input.bytes);
  const steps: AppliedMigrationStep[] = [];
  for (const definition of path.value) {
    const transformed = definition.transform({
      ...input,
      from_version: definition.from_version,
      to_version: definition.to_version,
      bytes: new Uint8Array(bytes),
    });
    if (!transformed.ok) return transformed;
    if (!(transformed.value.bytes instanceof Uint8Array)) {
      return failure(
        "MIGRATION_OUTPUT_INVALID",
        "migration transform must return bytes",
        definition.id,
      );
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
  }

  return success({
    bytes,
    steps,
    authority_impact: path.value.some(
      (definition) => definition.authority_impact === "directional",
    ) ? "directional" : "none",
  });
}
