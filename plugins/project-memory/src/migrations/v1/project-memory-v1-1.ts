import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import { canonicalJson } from "../../core/canonical-json.js";
import {
  decodeStrictUtf8,
  parseJsonDocument,
} from "../../core/document-io.js";
import {
  LEGACY_REPOSITORY_CONTRACT_VERSION,
  REPOSITORY_CONTRACT_VERSION,
} from "../../version.js";
import type {
  MigrationDefinition,
  MigrationOutput,
  MigrationTransformInput,
} from "../contracts.js";
import { createMigrationRegistry } from "../registry.js";

const LEGACY_HEADER = /^# generated_at: ([^\r\n]+)(\r?\n)/;
const NORMALIZED_HEADER = /^# generated_metadata: normalized(?:\r?\n)/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProfileMetadata(
  input: MigrationTransformInput,
): RuntimeResult<MigrationOutput> {
  const decoded = decodeStrictUtf8(input.bytes, input.relative_path);
  if (!decoded.ok) return decoded;
  if (NORMALIZED_HEADER.test(decoded.value)) {
    return success({ bytes: new Uint8Array(input.bytes), semantic_diff: [] });
  }
  const match = LEGACY_HEADER.exec(decoded.value);
  if (match === null) {
    return failure(
      "MIGRATION_METADATA_HEADER_MISSING",
      "profile lock has neither legacy nor normalized generated metadata",
      input.relative_path,
    );
  }
  const generatedAt = match[1] ?? "";
  const newline = match[2] ?? "\n";
  const normalized = decoded.value.replace(
    LEGACY_HEADER,
    `# generated_metadata: normalized${newline}`,
  );
  return success({
    bytes: new TextEncoder().encode(normalized),
    semantic_diff: [{
      path: "/generated_metadata",
      before: generatedAt,
      after: "normalized",
    }],
  });
}

function addRepositoryContractVersion(
  input: MigrationTransformInput,
): RuntimeResult<MigrationOutput> {
  const decoded = decodeStrictUtf8(input.bytes, input.relative_path);
  if (!decoded.ok) return decoded;
  const parsed = parseJsonDocument(decoded.value, input.relative_path);
  if (!parsed.ok) return parsed;
  if (!isRecord(parsed.value)) {
    return failure(
      "MIGRATION_CONFIG_INVALID",
      "tool configuration must be a JSON object",
      input.relative_path,
    );
  }
  if (Object.hasOwn(parsed.value, "repository_contract_version")) {
    return failure(
      "MIGRATION_CONFIG_NOT_LEGACY",
      "pre-marker configuration must not contain a repository contract version",
      input.relative_path,
    );
  }
  return success({
    bytes: new TextEncoder().encode(canonicalJson({
      ...parsed.value,
      repository_contract_version: REPOSITORY_CONTRACT_VERSION,
    })),
    semantic_diff: [{
      path: "/repository_contract_version",
      before: null,
      after: REPOSITORY_CONTRACT_VERSION,
    }],
  });
}

export const projectMemoryV1_1Migration: MigrationDefinition = {
  id: "project-memory-v1-1",
  from_version: LEGACY_REPOSITORY_CONTRACT_VERSION,
  to_version: REPOSITORY_CONTRACT_VERSION,
  affected_artifacts: ["profile-lock", "tool-config"],
  authority_impact: "none",
  transform(input) {
    if (input.artifact_kind === "profile-lock") {
      return normalizeProfileMetadata(input);
    }
    if (input.artifact_kind === "tool-config") {
      return addRepositoryContractVersion(input);
    }
    return failure(
      "MIGRATION_ARTIFACT_UNSUPPORTED",
      "v1.1 migration cannot transform this artifact",
      input.relative_path,
    );
  },
};

export const createProjectMemoryMigrationRegistry = () =>
  createMigrationRegistry([projectMemoryV1_1Migration]);
