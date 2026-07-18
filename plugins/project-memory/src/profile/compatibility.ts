import type {
  AdapterDefinition,
  BlueprintDefinition,
  CompanionTaxonomyBinding,
  ComponentDefinition,
  ComponentImpact,
  DomainDefinition,
  DomainImpact,
  OverlayDefinition,
  PatternTaxonomyBinding,
} from "../catalog/contracts/index.js";
import {
  classifyCatalogSource,
  type CatalogSourceKind as ParsedSourceKind,
  type SourceDescriptor,
} from "../catalog/loading/source-files.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import {
  decodeStrictUtf8,
  parseYamlDocument,
} from "../core/document-io.js";
import { sha256 } from "../core/hash.js";
import type {
  CompanionRuleCore,
  PatternCoreDefinition,
} from "../selection/contracts/core.js";
import { validateWithSchema } from "../schema/validate.js";
import type {
  ResolvedCatalogSelection,
  ResolvedCatalogSourceFile,
} from "./catalog-selection-resolver.js";
import type { LockedDefinition } from "./contracts/index.js";

type CatalogValue =
  | AdapterDefinition
  | BlueprintDefinition
  | CompanionRuleCore
  | CompanionTaxonomyBinding
  | ComponentDefinition
  | DomainDefinition
  | OverlayDefinition
  | PatternCoreDefinition
  | PatternTaxonomyBinding
  | Record<string, unknown>;

export interface ParsedProfileCatalogDocument {
  readonly kind: ParsedSourceKind;
  readonly id: string;
  readonly version: string | null;
  readonly value: CatalogValue;
  readonly file: ResolvedCatalogSourceFile;
}

export interface ProfileCatalogIndex {
  readonly blueprints: ReadonlyMap<string, BlueprintDefinition>;
  readonly overlays: ReadonlyMap<string, OverlayDefinition>;
  readonly components: ReadonlyMap<string, ComponentDefinition>;
  readonly domains: ReadonlyMap<string, DomainDefinition>;
  readonly adapters: ReadonlyMap<string, AdapterDefinition>;
  readonly pattern_cores: ReadonlyMap<string, PatternCoreDefinition>;
  readonly pattern_taxonomy: ReadonlyMap<string, PatternTaxonomyBinding>;
  readonly companion_cores: ReadonlyMap<string, CompanionRuleCore>;
  readonly companion_taxonomy: ReadonlyMap<string, CompanionTaxonomyBinding>;
  readonly documents: ReadonlyMap<string, ParsedProfileCatalogDocument>;
  readonly locks: ReadonlyMap<string, LockedDefinition>;
}

function expectedResolvedKind(
  kind: ParsedSourceKind,
): ResolvedCatalogSourceFile["kind"] {
  switch (kind) {
    case "blueprint":
      return "blueprint";
    case "pattern_core":
      return "pattern-core";
    case "pattern_taxonomy":
      return "pattern-taxonomy";
    case "companion_core":
      return "companion-core";
    case "companion_taxonomy":
      return "companion-taxonomy";
    default:
      return "definition-source";
  }
}

function unwrap(
  value: unknown,
  descriptor: SourceDescriptor,
  sourcePath: string,
): RuntimeResult<unknown> {
  if (descriptor.wrapper === null) return success(value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failure(
      "PROFILE_CATALOG_WRAPPER_INVALID",
      `expected sole wrapper ${descriptor.wrapper}`,
      sourcePath,
    );
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    !Object.hasOwn(record, descriptor.wrapper)
  ) {
    return failure(
      "PROFILE_CATALOG_WRAPPER_INVALID",
      `expected sole wrapper ${descriptor.wrapper}`,
      sourcePath,
    );
  }
  return success(record[descriptor.wrapper]);
}

function versionOf(value: Record<string, unknown>): string | null {
  for (const key of ["version", "pattern_version", "rule_version", "release"]) {
    if (typeof value[key] === "string") return value[key];
  }
  return null;
}

function parseSelectedSource(
  file: ResolvedCatalogSourceFile,
): RuntimeResult<ParsedProfileCatalogDocument | null> {
  if (file.kind === "generated-schema") return success(null);
  if (sha256(file.bytes) !== file.sha256) {
    return failure(
      "PROFILE_CATALOG_SOURCE_HASH_MISMATCH",
      "selected catalog source hash does not match its bytes",
      file.source_relative_path,
    );
  }
  const classified = classifyCatalogSource(file.source_relative_path);
  if (!classified.ok) return classified;
  if (classified.value === null) return success(null);
  const descriptor = classified.value;
  if (file.kind !== expectedResolvedKind(descriptor.kind)) {
    return failure(
      "PROFILE_CATALOG_SOURCE_KIND_MISMATCH",
      "selected catalog source kind does not match its release path",
      file.source_relative_path,
    );
  }
  const decoded = decodeStrictUtf8(file.bytes, file.source_relative_path);
  if (!decoded.ok) return decoded;
  const parsed = parseYamlDocument(decoded.value, file.source_relative_path);
  if (!parsed.ok) return parsed;
  const unwrapped = unwrap(parsed.value, descriptor, file.source_relative_path);
  if (!unwrapped.ok) return unwrapped;
  const validated = validateWithSchema<CatalogValue>(
    descriptor.schema_id,
    unwrapped.value,
  );
  if (!validated.ok) return validated;
  const value = validated.value as unknown as Record<string, unknown>;
  const id = value[descriptor.id_field];
  if (typeof id !== "string") {
    return failure(
      "PROFILE_CATALOG_ID_MISSING",
      `selected catalog source has no ${descriptor.id_field}`,
      file.source_relative_path,
    );
  }
  if (!file.definition_ids.includes(id) && descriptor.kind !== "manifest") {
    return failure(
      "PROFILE_CATALOG_IDENTITY_MISMATCH",
      "selected catalog source ID is absent from its byte lock identity",
      file.source_relative_path,
    );
  }
  return success({
    kind: descriptor.kind,
    id,
    version: versionOf(value),
    value: validated.value,
    file,
  });
}

function addDefinition<T>(
  map: Map<string, T>,
  document: ParsedProfileCatalogDocument,
): RuntimeResult<true> {
  if (map.has(document.id)) {
    return failure(
      "PROFILE_CATALOG_DEFINITION_DUPLICATE",
      `selected catalog repeats ${document.id}`,
      document.file.source_relative_path,
    );
  }
  map.set(document.id, document.value as T);
  return success(true);
}

function lockedSourceKind(
  kind: LockedDefinition["kind"],
): ParsedSourceKind | null {
  switch (kind) {
    case "blueprint":
      return "blueprint";
    case "overlay":
      return "overlay";
    case "component":
      return "component";
    case "domain":
      return "domain";
    case "adapter":
      return "adapter";
    case "pattern":
      return "pattern_core";
    case "companion":
      return "companion_core";
    default:
      return null;
  }
}

function validateLockedSource(
  lock: LockedDefinition,
  documents: ReadonlyMap<string, ParsedProfileCatalogDocument>,
): RuntimeResult<true> {
  const sourceKind = lockedSourceKind(lock.kind);
  if (sourceKind === null) {
    return failure(
      "PROFILE_CATALOG_DEFINITION_UNSUPPORTED",
      `profile expansion cannot resolve ${lock.kind} ${lock.id}`,
      lock.id,
    );
  }
  const document = documents.get(`${sourceKind}:${lock.id}`);
  if (document === undefined) {
    return failure(
      "PROFILE_CATALOG_DEFINITION_MISSING",
      `locked ${lock.kind} ${lock.id} has no selected source bytes`,
      lock.id,
    );
  }
  if (
    document.version !== lock.version ||
    document.file.target_relative_path !== lock.target_path ||
    document.file.sha256 !== lock.target_sha256
  ) {
    return failure(
      "PROFILE_CATALOG_LOCK_MISMATCH",
      `locked ${lock.kind} ${lock.id} does not match its selected bytes`,
      lock.id,
    );
  }
  return success(true);
}

export function indexResolvedCatalogSelection(
  catalog: ResolvedCatalogSelection,
): RuntimeResult<ProfileCatalogIndex> {
  const documents = new Map<string, ParsedProfileCatalogDocument>();
  const blueprints = new Map<string, BlueprintDefinition>();
  const overlays = new Map<string, OverlayDefinition>();
  const components = new Map<string, ComponentDefinition>();
  const domains = new Map<string, DomainDefinition>();
  const adapters = new Map<string, AdapterDefinition>();
  const patternCores = new Map<string, PatternCoreDefinition>();
  const patternTaxonomy = new Map<string, PatternTaxonomyBinding>();
  const companionCores = new Map<string, CompanionRuleCore>();
  const companionTaxonomy = new Map<string, CompanionTaxonomyBinding>();
  for (const file of catalog.files) {
    const parsed = parseSelectedSource(file);
    if (!parsed.ok) return parsed;
    if (parsed.value === null) continue;
    const document = parsed.value;
    const key = `${document.kind}:${document.id}`;
    if (documents.has(key)) {
      return failure(
        "PROFILE_CATALOG_DEFINITION_DUPLICATE",
        `selected catalog repeats ${key}`,
        document.file.source_relative_path,
      );
    }
    documents.set(key, document);
    let added: RuntimeResult<true> = success(true);
    switch (document.kind) {
      case "blueprint":
        added = addDefinition(blueprints, document);
        break;
      case "overlay":
        added = addDefinition(overlays, document);
        break;
      case "component":
        added = addDefinition(components, document);
        break;
      case "domain":
        added = addDefinition(domains, document);
        break;
      case "adapter":
        added = addDefinition(adapters, document);
        break;
      case "pattern_core":
        added = addDefinition(patternCores, document);
        break;
      case "pattern_taxonomy":
        added = addDefinition(patternTaxonomy, document);
        break;
      case "companion_core":
        added = addDefinition(companionCores, document);
        break;
      case "companion_taxonomy":
        added = addDefinition(companionTaxonomy, document);
        break;
      default:
        break;
    }
    if (!added.ok) return added;
  }

  const locks = new Map<string, LockedDefinition>();
  for (const lock of catalog.definitions) {
    const key = `${lock.kind}:${lock.id}`;
    const existing = locks.get(key);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(lock)) {
        return failure(
          "PROFILE_DEFINITION_VERSION_CONFLICT",
          `unequal duplicate lock for ${lock.id}`,
          lock.id,
        );
      }
      continue;
    }
    const validSource = validateLockedSource(lock, documents);
    if (!validSource.ok) return validSource;
    locks.set(key, lock);
  }
  const parsedBlueprint = blueprints.get(catalog.blueprint.id);
  if (
    parsedBlueprint === undefined ||
    parsedBlueprint.version !== catalog.blueprint.version
  ) {
    return failure(
      "PROFILE_BLUEPRINT_SOURCE_MISMATCH",
      "resolved blueprint metadata does not match selected source bytes",
      catalog.blueprint.id,
    );
  }
  return success({
    blueprints,
    overlays,
    components,
    domains,
    adapters,
    pattern_cores: patternCores,
    pattern_taxonomy: patternTaxonomy,
    companion_cores: companionCores,
    companion_taxonomy: companionTaxonomy,
    documents,
    locks,
  });
}

export function componentImpactMatches(
  impact: ComponentImpact,
  definition: ComponentDefinition,
): boolean {
  const selector = impact.selector;
  if ("id" in selector) return selector.id === definition.id;
  if ("type" in selector) return selector.type === definition.type;
  if ("tag" in selector) return definition.tags.includes(selector.tag);
  return true;
}

export function domainImpactMatches(
  impact: DomainImpact,
  definition: DomainDefinition,
): boolean {
  const selector = impact.selector;
  return "id" in selector
    ? selector.id === definition.id
    : definition.tags.includes(selector.tag);
}
