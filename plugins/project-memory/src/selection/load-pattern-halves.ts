import { readdir } from "node:fs/promises";

import { assembleCompanionRule } from "../catalog/assembly/assemble-companion-rule.js";
import { assemblePatternDefinition } from "../catalog/assembly/assemble-pattern.js";
import type { CatalogSource } from "../catalog/load-catalog.js";

import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { readUtf8Document } from "../core/document-io.js";
import { resolveInside } from "../core/path-safety.js";
import {
  getRegisteredSchemas,
  type SchemaId,
} from "../schema/registry.js";
import { validateWithSchema } from "../schema/validate.js";
import type {
  CompanionRuleCore,
  PatternCoreDefinition,
} from "./contracts/core.js";
import type {
  ResolvedCompanionRule,
  ResolvedPattern,
} from "./contracts/resolved.js";
import type { ResolvedPatternCatalog } from "./types.js";

interface CoreIdentity {
  readonly id: string;
  readonly version: string;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function validateOwnedContracts(
  expectedSchemaIds: readonly string[],
): RuntimeResult<{ readonly schema_ids: readonly string[] }> {
  const unique = new Set(expectedSchemaIds);
  if (unique.size !== expectedSchemaIds.length) {
    return failure(
      "SELECTION_SCHEMA_ID_DUPLICATE",
      "expected schema identifiers contain duplicates",
    );
  }
  const invalid = [...unique].filter(
    (id) => !/^project-memory[/]v1[/][a-z][a-z0-9-]*$/.test(id),
  );
  if (invalid.length > 0) {
    return failure(
      "SELECTION_SCHEMA_ID_INVALID",
      "invalid schema identifiers: " + invalid.sort(compareUtf8).join(","),
    );
  }
  const registered = new Set(
    getRegisteredSchemas().map((schema) => schema.$id),
  );
  const missing = [...unique].filter((id) => !registered.has(id as SchemaId));
  if (missing.length > 0) {
    return failure(
      "SELECTION_SCHEMA_ID_MISSING",
      "unregistered schema identifiers: " + missing.sort(compareUtf8).join(","),
    );
  }
  return success({ schema_ids: [...unique].sort(compareUtf8) });
}

async function loadCoreDirectory<T extends CoreIdentity>(
  catalogRoot: URL,
  directory: string,
  suffix: ".core.yaml",
  schemaId: SchemaId,
): Promise<RuntimeResult<readonly T[]>> {
  const confined = await resolveInside(catalogRoot, directory);
  if (!confined.ok) return confined;
  let entries;
  try {
    entries = await readdir(confined.value, { withFileTypes: true });
  } catch (error: unknown) {
    return failure(
      "SELECTION_CORE_DIRECTORY_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      directory,
    );
  }
  entries.sort((left, right) => compareUtf8(left.name, right.name));
  const values: T[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    const relativePath = directory + "/" + entry.name;
    if (entry.isSymbolicLink() || !entry.isFile()) {
      return failure(
        "SELECTION_CORE_UNSAFE_ENTRY",
        "core directories may contain regular files only",
        relativePath,
      );
    }
    if (entry.name.endsWith(".taxonomy.yaml")) continue;
    if (!entry.name.endsWith(suffix)) {
      return failure(
        "SELECTION_CORE_UNEXPECTED_FILE",
        "unexpected file in a core directory",
        relativePath,
      );
    }
    const document = await readUtf8Document(catalogRoot, relativePath);
    if (!document.ok) return document;
    const validated = validateWithSchema<T>(schemaId, document.value);
    if (!validated.ok) return validated;
    const expectedName = validated.value.id + suffix;
    if (entry.name !== expectedName) {
      return failure(
        "SELECTION_CORE_FILENAME_MISMATCH",
        "expected filename " + expectedName,
        relativePath,
      );
    }
    if (ids.has(validated.value.id)) {
      return failure(
        "SELECTION_CORE_DUPLICATE_ID",
        "duplicate core identifier " + validated.value.id,
        relativePath,
      );
    }
    ids.add(validated.value.id);
    values.push(validated.value);
  }
  return success(values);
}

export async function loadPatternCoreHalves(
  catalogRoot: URL,
  familyIds: readonly string[],
): Promise<RuntimeResult<readonly PatternCoreDefinition[]>> {
  const unique = new Set(familyIds);
  if (
    unique.size !== familyIds.length ||
    familyIds.some((family) => !/^[a-z][a-z0-9-]*$/.test(family))
  ) {
    return failure(
      "SELECTION_PATTERN_FAMILY_INVALID",
      "pattern family identifiers must be unique lowercase slugs",
    );
  }
  const patterns: PatternCoreDefinition[] = [];
  const ids = new Set<string>();
  for (const family of [...familyIds].sort(compareUtf8)) {
    const loaded = await loadCoreDirectory<PatternCoreDefinition>(
      catalogRoot,
      "patterns/" + family,
      ".core.yaml",
      "project-memory/v1/pattern-core",
    );
    if (!loaded.ok) return loaded;
    for (const pattern of loaded.value) {
      if (ids.has(pattern.id)) {
        return failure(
          "SELECTION_CORE_DUPLICATE_ID",
          "duplicate pattern core identifier " + pattern.id,
          pattern.id,
        );
      }
      ids.add(pattern.id);
      patterns.push(pattern);
    }
  }
  return success(patterns);
}

export async function loadCompanionCoreHalves(
  catalogRoot: URL,
): Promise<RuntimeResult<readonly CompanionRuleCore[]>> {
  return loadCoreDirectory<CompanionRuleCore>(
    catalogRoot,
    "companion-rules",
    ".core.yaml",
    "project-memory/v1/companion-rule-core",
  );
}
export function loadResolvedPatterns(
  source: CatalogSource,
): RuntimeResult<ResolvedPatternCatalog> {
  const patterns = new Map<string, ResolvedPattern>();
  const companionRules = new Map<string, ResolvedCompanionRule>();
  for (const id of [...source.pattern_cores.keys()].sort(compareUtf8)) {
    const core = source.pattern_cores.get(id);
    const taxonomy = source.pattern_taxonomy.get(id);
    if (core === undefined) {
      return failure(
        "pattern.missing_core_half",
        "pattern manifest identity has no matching core half",
        id,
      );
    }
    if (taxonomy === undefined) {
      return failure(
        "pattern.missing_taxonomy_half",
        "pattern core has no matching taxonomy half",
        id,
      );
    }
    const assembled = assemblePatternDefinition(core, taxonomy);
    if (!assembled.ok) return assembled;
    patterns.set(id, assembled.value);
  }
  for (const id of [...source.pattern_taxonomy.keys()].sort(compareUtf8)) {
    if (!source.pattern_cores.has(id)) {
      return failure(
        "pattern.missing_core_half",
        "pattern taxonomy has no matching core half",
        id,
      );
    }
  }
  for (const id of [...source.companion_cores.keys()].sort(compareUtf8)) {
    const core = source.companion_cores.get(id);
    const taxonomy = source.companion_taxonomy.get(id);
    if (core === undefined) {
      return failure(
        "companion.missing_core_half",
        "companion manifest identity has no matching core half",
        id,
      );
    }
    if (taxonomy === undefined) {
      return failure(
        "companion.missing_taxonomy_half",
        "companion core has no matching taxonomy half",
        id,
      );
    }
    const assembled = assembleCompanionRule(core, taxonomy);
    if (!assembled.ok) return assembled;
    companionRules.set(id, assembled.value);
  }
  for (const id of [...source.companion_taxonomy.keys()].sort(compareUtf8)) {
    if (!source.companion_cores.has(id)) {
      return failure(
        "companion.missing_core_half",
        "companion taxonomy has no matching core half",
        id,
      );
    }
  }
  return success({ patterns, companionRules });
}