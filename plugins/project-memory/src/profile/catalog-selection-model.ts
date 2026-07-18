import type {
  AdapterDefinition,
  BlueprintDefinition,
  CompanionTaxonomyBinding,
  ComponentDefinition,
  DomainDefinition,
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
import { validateWithSchema } from "../schema/validate.js";
import type { ProjectSelection } from "./contracts/index.js";
import type {
  VerifiedCatalogRelease,
  VerifiedCatalogSourceFile,
} from "./catalog-release-reader.js";

export interface ParsedCatalogDocument {
  readonly descriptor: SourceDescriptor;
  readonly id: string;
  readonly version: string | null;
  readonly status: string | null;
  readonly value: unknown;
  readonly file: VerifiedCatalogSourceFile;
}

export interface DefinitionRequest {
  readonly kind:
    | "blueprint_group"
    | "blueprint"
    | "component"
    | "domain"
    | "overlay"
    | "adapter";
  readonly id: string;
  readonly expected_version: string | null;
}

export interface PatternPair {
  readonly core: ParsedCatalogDocument;
  readonly taxonomy: ParsedCatalogDocument;
}

export function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapDocument(
  value: unknown,
  descriptor: SourceDescriptor,
  sourcePath: string,
): RuntimeResult<unknown> {
  if (descriptor.wrapper === null) return success(value);
  const outer = record(value);
  if (
    outer === null ||
    Object.keys(outer).length !== 1 ||
    !Object.hasOwn(outer, descriptor.wrapper)
  ) {
    return failure(
      "CATALOG_DOCUMENT_WRAPPER_INVALID",
      `expected sole wrapper ${descriptor.wrapper}`,
      sourcePath,
    );
  }
  return success(outer[descriptor.wrapper]);
}

function documentVersion(value: Record<string, unknown>): string | null {
  for (const key of ["version", "pattern_version", "rule_version", "release"]) {
    const candidate = value[key];
    if (typeof candidate === "string") return candidate;
  }
  return null;
}

export function parseCatalogDocuments(
  release: VerifiedCatalogRelease,
): RuntimeResult<ReadonlyMap<string, ParsedCatalogDocument>> {
  const documents = new Map<string, ParsedCatalogDocument>();
  for (const file of release.source_files) {
    const classified = classifyCatalogSource(file.relative_path);
    if (!classified.ok) return classified;
    if (classified.value === null) {
      if (file.schema_id !== null) {
        return failure(
          "CATALOG_RELEASE_IDENTITY_MISMATCH",
          "non-catalog source unexpectedly has schema identity",
          file.relative_path,
        );
      }
      continue;
    }
    const descriptor = classified.value;
    if (file.schema_id !== descriptor.schema_id) {
      return failure(
        "CATALOG_RELEASE_IDENTITY_MISMATCH",
        "locked source schema does not match its catalog path",
        file.relative_path,
      );
    }
    const decoded = decodeStrictUtf8(file.bytes, file.relative_path);
    if (!decoded.ok) return decoded;
    const parsed = parseYamlDocument(decoded.value, file.relative_path);
    if (!parsed.ok) return parsed;
    const unwrapped = unwrapDocument(parsed.value, descriptor, file.relative_path);
    if (!unwrapped.ok) return unwrapped;
    const validated = validateWithSchema(descriptor.schema_id, unwrapped.value);
    if (!validated.ok) return validated;
    const valueRecord = record(validated.value);
    if (valueRecord === null) {
      return failure(
        "CATALOG_DOCUMENT_INVALID",
        "validated catalog definition must be an object",
        file.relative_path,
      );
    }
    const rawId = valueRecord[descriptor.id_field];
    if (typeof rawId !== "string") {
      return failure(
        "CATALOG_ID_MISSING",
        `validated source has no ${descriptor.id_field}`,
        file.relative_path,
      );
    }
    const isManifest = descriptor.kind === "manifest";
    if (
      (!isManifest && file.definition_id !== rawId) ||
      (isManifest && file.definition_id !== null)
    ) {
      return failure(
        "CATALOG_RELEASE_IDENTITY_MISMATCH",
        "locked definition ID does not match source bytes",
        file.relative_path,
      );
    }
    const version = documentVersion(valueRecord);
    if (file.version !== version) {
      return failure(
        "CATALOG_RELEASE_IDENTITY_MISMATCH",
        "locked definition version does not match source bytes",
        file.relative_path,
      );
    }
    const key = `${descriptor.kind}:${rawId}`;
    if (documents.has(key)) {
      return failure(
        "CATALOG_DUPLICATE_ID",
        `duplicate ${descriptor.kind} definition ${rawId}`,
        file.relative_path,
      );
    }
    const status = valueRecord.status;
    documents.set(key, {
      descriptor,
      id: rawId,
      version,
      status: typeof status === "string" ? status : null,
      value: validated.value,
      file,
    });
  }
  return success(documents);
}

export function requireCatalogDocument(
  documents: ReadonlyMap<string, ParsedCatalogDocument>,
  kind: ParsedSourceKind,
  id: string,
): RuntimeResult<ParsedCatalogDocument> {
  const document = documents.get(`${kind}:${id}`);
  return document === undefined
    ? failure(
        "CATALOG_REFERENCE_UNRESOLVED",
        `catalog reference ${id} has no ${kind} source`,
        id,
      )
    : success(document);
}

export function validateCatalogPairs(
  documents: ReadonlyMap<string, ParsedCatalogDocument>,
  coreKind: "pattern_core" | "companion_core",
  taxonomyKind: "pattern_taxonomy" | "companion_taxonomy",
): RuntimeResult<ReadonlyMap<string, PatternPair>> {
  const ids = new Set<string>();
  for (const document of documents.values()) {
    if (
      document.descriptor.kind === coreKind ||
      document.descriptor.kind === taxonomyKind
    ) {
      ids.add(document.id);
    }
  }
  const pairs = new Map<string, PatternPair>();
  for (const id of [...ids].sort(compareUtf8)) {
    const core = documents.get(`${coreKind}:${id}`);
    const taxonomy = documents.get(`${taxonomyKind}:${id}`);
    if (core === undefined || taxonomy === undefined) {
      return failure(
        "CATALOG_HALF_MISSING",
        `${id} must have exactly one core and one taxonomy half`,
        id,
      );
    }
    if (core.version !== taxonomy.version) {
      return failure(
        "CATALOG_DEFINITION_VERSION_CONFLICT",
        `${id} core and taxonomy versions differ`,
        id,
      );
    }
    pairs.set(id, { core, taxonomy });
  }
  return success(pairs);
}

export function isTaxonomyCompatible(
  taxonomy: PatternTaxonomyBinding | CompanionTaxonomyBinding,
  selection: ProjectSelection,
  overlays: ReadonlySet<string>,
): boolean {
  return (
    taxonomy.compatibility.root_kinds.includes(selection.root.kind) &&
    taxonomy.compatibility.primary_archetypes.includes(
      selection.root.primary_archetype,
    ) &&
    taxonomy.compatibility.required_overlays.every((id) => overlays.has(id)) &&
    taxonomy.compatibility.forbidden_overlays.every((id) => !overlays.has(id)) &&
    taxonomy.overlay_applicability.forbidden.every((id) => !overlays.has(id))
  );
}

export function definitionDependencies(
  document: ParsedCatalogDocument,
): readonly DefinitionRequest[] {
  switch (document.descriptor.kind) {
    case "blueprint": {
      const value = document.value as BlueprintDefinition;
      return [
        { kind: "blueprint_group", id: value.group_id, expected_version: null },
        ...[...value.overlays.baked, ...value.overlays.defaults].map((id) => ({
          kind: "overlay" as const,
          id,
          expected_version: null,
        })),
        ...value.default_components.map((id) => ({
          kind: "component" as const,
          id,
          expected_version: null,
        })),
        ...value.default_domains.map((id) => ({
          kind: "domain" as const,
          id,
          expected_version: null,
        })),
      ];
    }
    case "component":
      return (document.value as ComponentDefinition).default_domains.map((id) => ({
        kind: "domain" as const,
        id,
        expected_version: null,
      }));
    case "domain":
      return (document.value as DomainDefinition).default_components.map((id) => ({
        kind: "component" as const,
        id,
        expected_version: null,
      }));
    case "overlay": {
      const value = document.value as OverlayDefinition;
      return [
        ...value.requires_overlays.map((id) => ({
          kind: "overlay" as const,
          id,
          expected_version: null,
        })),
        ...value.default_components.map((id) => ({
          kind: "component" as const,
          id,
          expected_version: null,
        })),
        ...value.default_domains.map((id) => ({
          kind: "domain" as const,
          id,
          expected_version: null,
        })),
      ];
    }
    case "adapter": {
      const value = document.value as AdapterDefinition;
      return [
        ...value.default_components.map((id) => ({
          kind: "component" as const,
          id,
          expected_version: null,
        })),
        ...value.default_domains.map((id) => ({
          kind: "domain" as const,
          id,
          expected_version: null,
        })),
      ];
    }
    default:
      return [];
  }
}
