import path from "node:path";

import {
  failure,
  failureFromIssues,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { readUtf8Document } from "../core/document-io.js";
import { validateWithSchema } from "../schema/validate.js";
import type {
  AdapterDefinition,
  BlueprintDefinition,
  BlueprintFixture,
  BlueprintGroupDefinition,
  CatalogInventory,
  CatalogManifest,
  CompanionTaxonomyBinding,
  ComponentDefinition,
  DomainDefinition,
  OverlayDefinition,
  PatternTaxonomyBinding,
} from "./contracts/index.js";
import { catalogIssue, sortCatalogIssues } from "./issues.js";
import {
  classifyCatalogSource,
  walkCatalogFiles,
  type SourceDescriptor,
} from "./loading/source-files.js";
import type {
  CompanionRuleCore,
  PatternCoreDefinition,
} from "../selection/contracts/core.js";

export interface CatalogSource {
  readonly blueprint_groups: ReadonlyMap<string, BlueprintGroupDefinition>;
  readonly blueprints: ReadonlyMap<string, BlueprintDefinition>;
  readonly components: ReadonlyMap<string, ComponentDefinition>;
  readonly domains: ReadonlyMap<string, DomainDefinition>;
  readonly overlays: ReadonlyMap<string, OverlayDefinition>;
  readonly adapters: ReadonlyMap<string, AdapterDefinition>;
  readonly pattern_cores: ReadonlyMap<string, PatternCoreDefinition>;
  readonly pattern_taxonomy: ReadonlyMap<string, PatternTaxonomyBinding>;
  readonly companion_cores: ReadonlyMap<string, CompanionRuleCore>;
  readonly companion_taxonomy: ReadonlyMap<string, CompanionTaxonomyBinding>;
  readonly fixtures: ReadonlyMap<string, BlueprintFixture>;
  readonly inventories: ReadonlyMap<string, CatalogInventory>;
  readonly manifest: CatalogManifest | null;
  readonly source_paths: ReadonlyMap<string, string>;
}

type CatalogValue =
  | AdapterDefinition
  | BlueprintDefinition
  | BlueprintFixture
  | BlueprintGroupDefinition
  | CatalogInventory
  | CatalogManifest
  | CompanionRuleCore
  | CompanionTaxonomyBinding
  | ComponentDefinition
  | DomainDefinition
  | OverlayDefinition
  | PatternCoreDefinition
  | PatternTaxonomyBinding;

interface LoadedSource {
  readonly descriptor: SourceDescriptor;
  readonly id: string;
  readonly path: string;
  readonly value: CatalogValue;
}

interface CatalogBuilder {
  readonly blueprint_groups: Map<string, BlueprintGroupDefinition>;
  readonly blueprints: Map<string, BlueprintDefinition>;
  readonly components: Map<string, ComponentDefinition>;
  readonly domains: Map<string, DomainDefinition>;
  readonly overlays: Map<string, OverlayDefinition>;
  readonly adapters: Map<string, AdapterDefinition>;
  readonly pattern_cores: Map<string, PatternCoreDefinition>;
  readonly pattern_taxonomy: Map<string, PatternTaxonomyBinding>;
  readonly companion_cores: Map<string, CompanionRuleCore>;
  readonly companion_taxonomy: Map<string, CompanionTaxonomyBinding>;
  readonly fixtures: Map<string, BlueprintFixture>;
  readonly inventories: Map<string, CatalogInventory>;
  manifest: CatalogManifest | null;
  readonly source_paths: Map<string, string>;
}

function createBuilder(): CatalogBuilder {
  return {
    blueprint_groups: new Map(),
    blueprints: new Map(),
    components: new Map(),
    domains: new Map(),
    overlays: new Map(),
    adapters: new Map(),
    pattern_cores: new Map(),
    pattern_taxonomy: new Map(),
    companion_cores: new Map(),
    companion_taxonomy: new Map(),
    fixtures: new Map(),
    inventories: new Map(),
    manifest: null,
    source_paths: new Map(),
  };
}

function unwrapDocument(
  document: unknown,
  descriptor: SourceDescriptor,
  relativePath: string,
): RuntimeResult<unknown> {
  if (descriptor.wrapper === null) return success(document);
  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document)
  ) {
    return failure(
      "CATALOG_DOCUMENT_WRAPPER_INVALID",
      `expected wrapper ${descriptor.wrapper}`,
      relativePath,
    );
  }
  const record = document as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== descriptor.wrapper) {
    return failure(
      "CATALOG_DOCUMENT_WRAPPER_INVALID",
      `expected sole wrapper ${descriptor.wrapper}`,
      relativePath,
      keys,
    );
  }
  return success(record[descriptor.wrapper]);
}

function sourceScopedIssues(
  relativePath: string,
  issues: readonly RuntimeIssue[],
): readonly RuntimeIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path:
      issue.path === "/"
        ? relativePath
        : `${relativePath}${issue.path.startsWith("/") ? "" : "/"}${issue.path}`,
  }));
}

function expectedFileNames(
  descriptor: SourceDescriptor,
  id: string,
): ReadonlySet<string> {
  if (descriptor.kind === "manifest") return new Set(["manifest.yaml"]);
  const names = new Set([`${id}${descriptor.suffix}`]);
  if (descriptor.kind === "fixture" && id.startsWith("fixture.")) {
    names.add(`${id.slice("fixture.".length)}${descriptor.suffix}`);
    names.add(`${id.split(".").at(-1) ?? id}${descriptor.suffix}`);
    const fixtureTail = id.split(".").at(-1);
    if (fixtureTail !== undefined && fixtureTail.startsWith("case-")) {
      names.add(`${fixtureTail.slice("case-".length)}${descriptor.suffix}`);
    }
  }
  if (descriptor.kind === "inventory" && id.startsWith("inventory.")) {
    const unprefixed = id.slice("inventory.".length);
    const tail = id.split(".").at(-1) ?? id;
    names.add(`${unprefixed}${descriptor.suffix}`);
    names.add(`${tail}${descriptor.suffix}`);
    if (id.startsWith("inventory.blueprints.")) {
      names.add(`blueprint-group.${tail}${descriptor.suffix}`);
    }
  }
  return names;
}

async function loadSourceDocument(
  root: URL,
  relativePath: string,
  descriptor: SourceDescriptor,
): Promise<RuntimeResult<LoadedSource>> {
  const document = await readUtf8Document(root, relativePath);
  if (!document.ok) return document;
  const unwrapped = unwrapDocument(document.value, descriptor, relativePath);
  if (!unwrapped.ok) return unwrapped;
  const validated = validateWithSchema<CatalogValue>(
    descriptor.schema_id,
    unwrapped.value,
  );
  if (!validated.ok) {
    return failureFromIssues(sourceScopedIssues(relativePath, validated.issues));
  }
  const identity = validated.value as unknown as Record<string, unknown>;
  const rawId = identity[descriptor.id_field];
  if (typeof rawId !== "string") {
    return failure(
      "CATALOG_ID_MISSING",
      `validated source has no ${descriptor.id_field}`,
      relativePath,
    );
  }
  const basename = path.posix.basename(relativePath);
  if (!expectedFileNames(descriptor, rawId).has(basename)) {
    return failure(
      "CATALOG_FILENAME_ID_MISMATCH",
      `filename does not match definition ID ${rawId}`,
      relativePath,
      [...expectedFileNames(descriptor, rawId)],
    );
  }
  return success({ descriptor, id: rawId, path: relativePath, value: validated.value });
}

function addToMap<T>(
  map: Map<string, T>,
  loaded: LoadedSource,
  value: T,
  builder: CatalogBuilder,
): RuntimeIssue | null {
  const sourceKey = `${loaded.descriptor.kind}:${loaded.id}`;
  const existing = builder.source_paths.get(sourceKey);
  if (map.has(loaded.id)) {
    return catalogIssue(
      "CATALOG_DUPLICATE_ID",
      loaded.path,
      `duplicate ${loaded.descriptor.kind} ID ${loaded.id}`,
      existing === undefined ? [loaded.id] : [loaded.id, existing],
    );
  }
  map.set(loaded.id, value);
  builder.source_paths.set(sourceKey, loaded.path);
  return null;
}

function addLoadedSource(
  builder: CatalogBuilder,
  loaded: LoadedSource,
): RuntimeIssue | null {
  switch (loaded.descriptor.kind) {
    case "manifest": {
      if (builder.manifest !== null) {
        return catalogIssue(
          "CATALOG_DUPLICATE_ID",
          loaded.path,
          "catalog contains multiple manifests",
          ["project-memory"],
        );
      }
      builder.manifest = loaded.value as CatalogManifest;
      builder.source_paths.set("manifest:project-memory", loaded.path);
      return null;
    }
    case "blueprint_group":
      return addToMap(builder.blueprint_groups, loaded, loaded.value as BlueprintGroupDefinition, builder);
    case "blueprint":
      return addToMap(builder.blueprints, loaded, loaded.value as BlueprintDefinition, builder);
    case "component":
      return addToMap(builder.components, loaded, loaded.value as ComponentDefinition, builder);
    case "domain":
      return addToMap(builder.domains, loaded, loaded.value as DomainDefinition, builder);
    case "overlay":
      return addToMap(builder.overlays, loaded, loaded.value as OverlayDefinition, builder);
    case "adapter":
      return addToMap(builder.adapters, loaded, loaded.value as AdapterDefinition, builder);
    case "pattern_core":
      return addToMap(builder.pattern_cores, loaded, loaded.value as PatternCoreDefinition, builder);
    case "pattern_taxonomy":
      return addToMap(builder.pattern_taxonomy, loaded, loaded.value as PatternTaxonomyBinding, builder);
    case "companion_core":
      return addToMap(builder.companion_cores, loaded, loaded.value as CompanionRuleCore, builder);
    case "companion_taxonomy":
      return addToMap(builder.companion_taxonomy, loaded, loaded.value as CompanionTaxonomyBinding, builder);
    case "fixture":
      return addToMap(builder.fixtures, loaded, loaded.value as BlueprintFixture, builder);
    case "inventory":
      return addToMap(builder.inventories, loaded, loaded.value as CatalogInventory, builder);
  }
}

export async function loadCatalog(
  root: URL,
): Promise<RuntimeResult<CatalogSource>> {
  const walked = await walkCatalogFiles(root);
  if (!walked.ok) return walked;
  const builder = createBuilder();
  const issues: RuntimeIssue[] = [];
  for (const relativePath of walked.value) {
    const classified = classifyCatalogSource(relativePath);
    if (!classified.ok) {
      issues.push(...classified.issues);
      continue;
    }
    if (classified.value === null) continue;
    const loaded = await loadSourceDocument(root, relativePath, classified.value);
    if (!loaded.ok) {
      issues.push(...loaded.issues);
      continue;
    }
    const duplicate = addLoadedSource(builder, loaded.value);
    if (duplicate !== null) issues.push(duplicate);
  }
  if (issues.length > 0) return failureFromIssues(sortCatalogIssues(issues));
  return success(builder);
}

export type { CatalogSourceKind } from "./loading/source-files.js";
