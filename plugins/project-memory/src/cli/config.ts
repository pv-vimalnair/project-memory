import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Type, type Static } from "@sinclair/typebox";

import {
  DefinitionIdSchema,
  SemVerSchema,
} from "../catalog/contracts/common.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import {
  decodeStrictUtf8,
  parseJsonDocument,
} from "../core/document-io.js";
import { resolveInside } from "../core/path-safety.js";
import {
  getSchemaValidator,
  registerSchema,
  type SchemaId,
} from "../schema/registry.js";
import { validateWithSchema } from "../schema/validate.js";
import {
  InstanceIdSchema,
  NonBlankStringSchema,
  SafeRelativePathSchema,
  Sha256Schema,
} from "../profile/contracts/project-selection.js";
import { REPOSITORY_CONTRACT_VERSION } from "../version.js";

export const CONFIG_RELATIVE_PATH = "tools/project-memory/config.json";
export const TOOL_CONFIG_SCHEMA_ID = "project-memory/v1/tool-config" as const;
export const CLI_SCHEMA_IDS = [TOOL_CONFIG_SCHEMA_ID] as const satisfies readonly SchemaId[];

export const SafeRepositoryReferenceSchema = Type.String({
  minLength: 1,
  pattern: "^(?!-)(?![A-Za-z]:[\\\\/])(?!/)(?!file:)(?!.*[\\u0000\\r\\n])(?=.*\\S).+$",
});

const RuntimeAdapterSchema = Type.Object({
  kind: Type.Union([
    Type.Literal("agent"),
    Type.Literal("runtime"),
    Type.Literal("workflow"),
  ]),
  definition_id: DefinitionIdSchema,
  definition_version: SemVerSchema,
  target_path: SafeRelativePathSchema,
  target_sha256: Sha256Schema,
}, { additionalProperties: false });

const RuntimeGateSchema = Type.Object({
  id: NonBlankStringSchema,
  source_definition_ids: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
  commands: Type.Array(NonBlankStringSchema, { uniqueItems: true }),
  required_evidence: Type.Array(NonBlankStringSchema, { uniqueItems: true }),
}, { additionalProperties: false });

export const ToolConfigSchema = Type.Object({
  schema_version: Type.Literal("1.0.0"),
  repository_contract_version: Type.Optional(
    Type.Literal(REPOSITORY_CONTRACT_VERSION),
  ),
  root_id: InstanceIdSchema("ROOT"),
  memory_root: Type.Literal("docs/project-memory"),
  profile_lock: Type.Literal("docs/project-memory/profile.lock.yaml"),
  catalog_lock: Type.Literal("docs/project-memory/catalog.lock.json"),
  hub: Type.Union([
    Type.Object({
      kind: Type.Literal("local"),
      repository: Type.Literal("."),
    }, { additionalProperties: false }),
    Type.Object({
      kind: Type.Literal("satellite"),
      repository: SafeRepositoryReferenceSchema,
    }, { additionalProperties: false }),
  ]),
  policy: Type.Object({
    require_clean_canonical_tree: Type.Boolean(),
    generated_view_check: Type.Boolean(),
    archive_secret_scan: Type.Boolean(),
  }, { additionalProperties: false }),
  adapters: Type.Optional(Type.Array(RuntimeAdapterSchema, { uniqueItems: true })),
  commands: Type.Optional(Type.Array(NonBlankStringSchema, { uniqueItems: true })),
  gates: Type.Optional(Type.Array(RuntimeGateSchema, { uniqueItems: true })),
}, {
  $id: TOOL_CONFIG_SCHEMA_ID,
  additionalProperties: false,
});

export type ToolConfig = Static<typeof ToolConfigSchema>;

export function registerCliSchemas(): readonly SchemaId[] {
  if (getSchemaValidator(TOOL_CONFIG_SCHEMA_ID) === undefined) {
    registerSchema(ToolConfigSchema);
  }
  return CLI_SCHEMA_IDS;
}

export async function readToolConfigDocument(
  root: URL,
): Promise<RuntimeResult<unknown>> {
  const resolved = await resolveInside(root, CONFIG_RELATIVE_PATH);
  if (!resolved.ok) return resolved;
  try {
    const stat = await lstat(resolved.value);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure(
        "CONFIG_UNSAFE",
        "tool configuration must be a regular file",
        CONFIG_RELATIVE_PATH,
      );
    }
    const bytes = new Uint8Array(await readFile(resolved.value));
    const decoded = decodeStrictUtf8(bytes, CONFIG_RELATIVE_PATH);
    return decoded.ok ? parseJsonDocument(decoded.value, CONFIG_RELATIVE_PATH) : decoded;
  } catch (error: unknown) {
    return failure(
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "CONFIG_MISSING"
        : "CONFIG_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      CONFIG_RELATIVE_PATH,
    );
  }
}

export function validateToolConfigDocument(
  value: unknown,
): RuntimeResult<ToolConfig> {
  registerCliSchemas();
  return validateWithSchema<ToolConfig>(TOOL_CONFIG_SCHEMA_ID, value);
}

export async function loadToolConfig(root: URL): Promise<RuntimeResult<ToolConfig>> {
  const document = await readToolConfigDocument(root);
  return document.ok ? validateToolConfigDocument(document.value) : document;
}

async function exists(value: string): Promise<boolean> {
  try {
    await lstat(value);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function discoverProjectRoot(
  start: URL,
): Promise<RuntimeResult<URL>> {
  if (start.protocol !== "file:") {
    return failure("CONFIG_DISCOVERY_ROOT_INVALID", "root discovery requires a file URL");
  }
  try {
    const startingPath = await realpath(fileURLToPath(start));
    const startingStat = await lstat(startingPath);
    let current = startingStat.isDirectory() ? startingPath : path.dirname(startingPath);
    for (;;) {
      const configPath = path.join(current, ...CONFIG_RELATIVE_PATH.split("/"));
      if (await exists(configPath)) {
        const configStat = await lstat(configPath);
        if (configStat.isSymbolicLink() || !configStat.isFile()) {
          return failure("CONFIG_UNSAFE", "tool configuration must be a regular file", configPath);
        }
        return success(pathToFileURL(`${current}${path.sep}`));
      }
      if (await exists(path.join(current, ".git"))) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return failure(
      "CONFIG_NOT_FOUND",
      `could not find ${CONFIG_RELATIVE_PATH} before the Git worktree boundary`,
      fileURLToPath(start),
    );
  } catch (error: unknown) {
    return failure(
      "CONFIG_DISCOVERY_FAILED",
      error instanceof Error ? error.message : String(error),
      fileURLToPath(start),
    );
  }
}
