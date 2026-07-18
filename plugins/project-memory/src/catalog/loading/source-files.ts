import { readdir } from "node:fs/promises";

import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import { resolveInside } from "../../core/path-safety.js";
import type { SchemaId } from "../../schema/registry.js";
import { compareUtf8 } from "../issues.js";

export type CatalogSourceKind =
  | "manifest"
  | "blueprint_group"
  | "blueprint"
  | "component"
  | "domain"
  | "overlay"
  | "adapter"
  | "pattern_core"
  | "pattern_taxonomy"
  | "companion_core"
  | "companion_taxonomy"
  | "fixture"
  | "inventory";

export interface SourceDescriptor {
  readonly kind: CatalogSourceKind;
  readonly wrapper: string | null;
  readonly schema_id: SchemaId;
  readonly id_field: "id" | "pattern_id" | "rule_id";
  readonly suffix: ".yaml" | ".core.yaml" | ".taxonomy.yaml";
}

const DIRECTORY_DESCRIPTORS = Object.freeze([
  ["blueprint-groups/", "blueprint_group", "blueprint_group", "project-memory/v1/blueprint-group-definition"],
  ["blueprints/", "blueprint", "blueprint", "project-memory/v1/blueprint-definition"],
  ["components/", "component", "component_definition", "project-memory/v1/component-definition"],
  ["domains/", "domain", "domain_definition", "project-memory/v1/domain-definition"],
  ["overlays/", "overlay", "overlay_definition", "project-memory/v1/overlay-definition"],
  ["adapters/", "adapter", "adapter_definition", "project-memory/v1/adapter-definition"],
  ["fixtures/", "fixture", "fixture", "project-memory/v1/blueprint-fixture"],
  ["inventories/", "inventory", "inventory", "project-memory/v1/catalog-inventory"],
] as const satisfies readonly (readonly [
  string,
  CatalogSourceKind,
  string,
  SchemaId,
])[]);

export function classifyCatalogSource(
  relativePath: string,
): RuntimeResult<SourceDescriptor | null> {
  if (relativePath === "manifest.yaml") {
    return success({
      kind: "manifest",
      wrapper: "catalog",
      schema_id: "project-memory/v1/catalog-manifest",
      id_field: "id",
      suffix: ".yaml",
    });
  }
  if (relativePath.endsWith(".md") || relativePath.endsWith("/.gitkeep")) {
    return success(null);
  }
  if (relativePath.startsWith("patterns/")) {
    if (relativePath.endsWith(".core.yaml")) {
      return success({
        kind: "pattern_core",
        wrapper: null,
        schema_id: "project-memory/v1/pattern-core",
        id_field: "id",
        suffix: ".core.yaml",
      });
    }
    if (relativePath.endsWith(".taxonomy.yaml")) {
      return success({
        kind: "pattern_taxonomy",
        wrapper: "pattern_taxonomy",
        schema_id: "project-memory/v1/pattern-taxonomy",
        id_field: "pattern_id",
        suffix: ".taxonomy.yaml",
      });
    }
  }
  if (relativePath.startsWith("companion-rules/")) {
    if (relativePath.endsWith(".core.yaml")) {
      return success({
        kind: "companion_core",
        wrapper: null,
        schema_id: "project-memory/v1/companion-rule-core",
        id_field: "id",
        suffix: ".core.yaml",
      });
    }
    if (relativePath.endsWith(".taxonomy.yaml")) {
      return success({
        kind: "companion_taxonomy",
        wrapper: "companion_taxonomy",
        schema_id: "project-memory/v1/companion-taxonomy",
        id_field: "rule_id",
        suffix: ".taxonomy.yaml",
      });
    }
  }
  for (const [prefix, kind, wrapper, schemaId] of DIRECTORY_DESCRIPTORS) {
    if (relativePath.startsWith(prefix) && relativePath.endsWith(".yaml")) {
      return success({
        kind,
        wrapper,
        schema_id: schemaId,
        id_field: "id",
        suffix: ".yaml",
      });
    }
  }
  return failure(
    "CATALOG_UNEXPECTED_SOURCE",
    "unexpected file in catalog source tree",
    relativePath,
  );
}

async function visitDirectory(
  root: URL,
  relativeDirectory: string | null,
  files: string[],
): Promise<RuntimeResult<true>> {
  const directory =
    relativeDirectory === null
      ? success(root)
      : await resolveInside(root, relativeDirectory);
  if (!directory.ok) return directory;
  let entries;
  try {
    entries = await readdir(directory.value, { withFileTypes: true });
  } catch (error: unknown) {
    return failure(
      "CATALOG_DIRECTORY_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      relativeDirectory ?? ".",
    );
  }
  entries.sort((left, right) => compareUtf8(left.name, right.name));
  for (const entry of entries) {
    const relativePath =
      relativeDirectory === null
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      return failure(
        "CATALOG_UNSAFE_ENTRY",
        "symbolic links are forbidden in catalog sources",
        relativePath,
      );
    }
    if (entry.isDirectory()) {
      const nested = await visitDirectory(root, relativePath, files);
      if (!nested.ok) return nested;
      continue;
    }
    if (!entry.isFile()) {
      return failure(
        "CATALOG_UNSAFE_ENTRY",
        "catalog sources may contain regular files and directories only",
        relativePath,
      );
    }
    files.push(relativePath);
  }
  return success(true);
}

export async function walkCatalogFiles(
  root: URL,
): Promise<RuntimeResult<readonly string[]>> {
  if (root.protocol !== "file:") {
    return failure("PATH_ROOT_INVALID", "catalog root must be a file URL");
  }
  const files: string[] = [];
  const visited = await visitDirectory(root, null, files);
  if (!visited.ok) return visited;
  return success(files.sort(compareUtf8));
}
