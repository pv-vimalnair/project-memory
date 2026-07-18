import semver from "semver";

import type {
  BlueprintDefinition,
  CatalogManifest,
  CompanionTaxonomyBinding,
  PatternTaxonomyBinding,
} from "../catalog/contracts/index.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type {
  CompanionRuleCore,
  PatternCoreDefinition,
} from "../selection/contracts/core.js";
import { validateWithSchema } from "../schema/validate.js";
import type {
  CatalogSourceKind,
  LockedDefinition,
  ProjectSelection,
} from "./contracts/index.js";
import { ProjectSelectionSchema } from "./contracts/index.js";
import {
  readVerifiedCatalogRelease,
  type VerifiedCatalogSchemaFile,
} from "./catalog-release-reader.js";
import {
  compareUtf8,
  definitionDependencies,
  isTaxonomyCompatible,
  parseCatalogDocuments,
  requireCatalogDocument,
  validateCatalogPairs,
  type DefinitionRequest,
  type ParsedCatalogDocument,
} from "./catalog-selection-model.js";

export interface ResolvedCatalogSourceFile {
  readonly kind: CatalogSourceKind;
  readonly definition_ids: readonly string[];
  readonly source_relative_path: string;
  readonly target_relative_path: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface ResolvedCatalogSelection {
  readonly release: string;
  readonly release_hash: string;
  readonly files: readonly ResolvedCatalogSourceFile[];
  readonly blueprint: BlueprintDefinition;
  readonly definitions: readonly LockedDefinition[];
  readonly required_schema_ids: readonly string[];
}

function lockedKind(
  kind: DefinitionRequest["kind"],
): LockedDefinition["kind"] | null {
  return kind === "blueprint_group" ? null : kind;
}

function sourceKind(document: ParsedCatalogDocument): CatalogSourceKind {
  switch (document.descriptor.kind) {
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

function resolvedSource(
  document: ParsedCatalogDocument,
  definitionIds: readonly string[] = [document.id],
): ResolvedCatalogSourceFile {
  return {
    kind: sourceKind(document),
    definition_ids: [...definitionIds].sort(compareUtf8),
    source_relative_path: document.file.relative_path,
    target_relative_path: `docs/project-memory/catalog/selected/${document.file.relative_path}`,
    bytes: document.file.bytes,
    sha256: document.file.sha256,
  };
}

function resolvedSchema(
  schema: VerifiedCatalogSchemaFile,
  definitionIds: readonly string[],
): ResolvedCatalogSourceFile {
  return {
    kind: "generated-schema",
    definition_ids: [...definitionIds].sort(compareUtf8),
    source_relative_path: schema.source_relative_path,
    target_relative_path: schema.source_relative_path,
    bytes: schema.bytes,
    sha256: schema.sha256,
  };
}

export class CatalogSelectionResolver {
  async resolve(
    selection: ProjectSelection,
    releaseRoot: URL,
  ): Promise<RuntimeResult<ResolvedCatalogSelection>> {
    const validatedSelection = validateWithSchema<ProjectSelection>(
      ProjectSelectionSchema.$id,
      selection,
    );
    if (!validatedSelection.ok) return validatedSelection;
    const verified = await readVerifiedCatalogRelease(
      releaseRoot,
      selection.catalog.release,
      selection.catalog.catalog_hash,
    );
    if (!verified.ok) return verified;
    const parsed = parseCatalogDocuments(verified.value);
    if (!parsed.ok) return parsed;
    const documents = parsed.value;
    const patternPairs = validateCatalogPairs(
      documents,
      "pattern_core",
      "pattern_taxonomy",
    );
    if (!patternPairs.ok) return patternPairs;
    const companionPairs = validateCatalogPairs(
      documents,
      "companion_core",
      "companion_taxonomy",
    );
    if (!companionPairs.ok) return companionPairs;

    const files = new Map<string, ResolvedCatalogSourceFile>();
    const definitions = new Map<string, LockedDefinition>();
    const schemaUsage = new Map<string, Set<string>>();
    const addDocument = (
      document: ParsedCatalogDocument,
      kind: LockedDefinition["kind"] | null,
      definitionIds: readonly string[] = [document.id],
    ): RuntimeResult<true> => {
      const resolved = resolvedSource(document, definitionIds);
      const existing = files.get(resolved.target_relative_path);
      if (
        existing !== undefined &&
        (existing.sha256 !== resolved.sha256 || existing.kind !== resolved.kind)
      ) {
        return failure(
          "CATALOG_CLOSURE_PATH_CONFLICT",
          "two catalog sources resolve to unequal target bytes",
          resolved.target_relative_path,
        );
      }
      files.set(resolved.target_relative_path, resolved);
      if (document.file.schema_id !== null) {
        const users = schemaUsage.get(document.file.schema_id) ?? new Set<string>();
        for (const id of definitionIds) users.add(id);
        schemaUsage.set(document.file.schema_id, users);
      }
      if (kind === null) return success(true);
      if (document.version === null) {
        return failure(
          "CATALOG_RELEASE_IDENTITY_MISMATCH",
          "selected definition has no version",
          document.file.relative_path,
        );
      }
      const locked: LockedDefinition = {
        kind,
        id: document.id,
        version: document.version,
        target_path: resolved.target_relative_path,
        target_sha256: resolved.sha256,
      };
      const previous = definitions.get(`${kind}:${document.id}`);
      if (
        previous !== undefined &&
        (previous.version !== locked.version ||
          previous.target_sha256 !== locked.target_sha256)
      ) {
        return failure(
          "CATALOG_DEFINITION_VERSION_CONFLICT",
          "definition cycle reached a non-identical version or hash",
          document.id,
        );
      }
      definitions.set(`${kind}:${document.id}`, locked);
      return success(true);
    };

    const manifest = requireCatalogDocument(documents, "manifest", "project-memory");
    if (!manifest.ok) return manifest;
    const manifestValue = manifest.value.value as CatalogManifest;
    if (
      manifestValue.release !== verified.value.release ||
      manifestValue.source_root !== "catalog/project-memory/v1" ||
      manifestValue.generated_paths.schemas !== "schemas/project-memory/v1" ||
      manifestValue.generated_paths.release !==
        `dist/catalog/project-memory/${verified.value.release}`
    ) {
      return failure(
        "CATALOG_RELEASE_LAYOUT_MISMATCH",
        "catalog manifest does not describe the verified package layout",
        manifest.value.file.relative_path,
      );
    }
    const manifestAdded = addDocument(manifest.value, null, []);
    if (!manifestAdded.ok) return manifestAdded;

    const queue: DefinitionRequest[] = [
      {
        kind: "blueprint",
        id: selection.root.blueprint.id,
        expected_version: selection.root.blueprint.version,
      },
      ...selection.overlays.map((id) => ({
        kind: "overlay" as const,
        id,
        expected_version: null,
      })),
      ...selection.components.map((binding) => ({
        kind: "component" as const,
        id: binding.definition.id,
        expected_version: binding.definition.version,
      })),
      ...selection.domains.map((binding) => ({
        kind: "domain" as const,
        id: binding.definition.id,
        expected_version: binding.definition.version,
      })),
      ...Object.values(selection.adapters)
        .flat()
        .map((adapter) => ({
          kind: "adapter" as const,
          id: adapter.id,
          expected_version: adapter.version,
        })),
    ];
    const visited = new Map<string, string>();
    let blueprint: BlueprintDefinition | null = null;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const request = queue[cursor];
      if (request === undefined) continue;
      const document = requireCatalogDocument(documents, request.kind, request.id);
      if (!document.ok) return document;
      if (
        request.expected_version !== null &&
        document.value.version !== request.expected_version
      ) {
        return failure(
          "CATALOG_DEFINITION_VERSION_CONFLICT",
          `selected ${request.id} version ${request.expected_version} does not match ${String(document.value.version)}`,
          request.id,
        );
      }
      if (document.value.status !== "active") {
        return failure(
          "CATALOG_DEFINITION_NOT_SELECTABLE",
          `${request.id} is ${String(document.value.status)}`,
          request.id,
        );
      }
      const visitKey = `${request.kind}:${request.id}`;
      const identity = `${String(document.value.version)}:${document.value.file.sha256}`;
      const priorIdentity = visited.get(visitKey);
      if (priorIdentity !== undefined && priorIdentity !== identity) {
        return failure(
          "CATALOG_DEFINITION_VERSION_CONFLICT",
          "definition cycle did not converge to an identical tuple",
          request.id,
        );
      }
      if (priorIdentity === identity) continue;
      visited.set(visitKey, identity);
      const added = addDocument(document.value, lockedKind(request.kind));
      if (!added.ok) return added;
      if (request.kind === "blueprint") {
        blueprint = document.value.value as BlueprintDefinition;
      }
      queue.push(...definitionDependencies(document.value));
    }
    if (blueprint === null) {
      return failure(
        "CATALOG_REFERENCE_UNRESOLVED",
        "selected blueprint was not resolved",
        selection.root.blueprint.id,
      );
    }

    const overlayIds = new Set(
      [...definitions.values()]
        .filter((definition) => definition.kind === "overlay")
        .map((definition) => definition.id),
    );
    const selectedPatterns = new Set<string>();
    const selectedCompanions = new Set<string>();
    for (const [id, pair] of patternPairs.value) {
      const core = pair.core.value as PatternCoreDefinition;
      const taxonomy = pair.taxonomy.value as PatternTaxonomyBinding;
      if (
        core.status === "active" &&
        isTaxonomyCompatible(taxonomy, selection, overlayIds)
      ) {
        selectedPatterns.add(id);
      }
    }

    const addPattern = (
      id: string,
      versionRange: string | null,
    ): RuntimeResult<boolean> => {
      const pair = patternPairs.value.get(id);
      if (pair === undefined) {
        return failure(
          "CATALOG_REFERENCE_UNRESOLVED",
          `required pattern ${id} is missing`,
          id,
        );
      }
      const core = pair.core.value as PatternCoreDefinition;
      const taxonomy = pair.taxonomy.value as PatternTaxonomyBinding;
      if (core.status !== "active") {
        return failure(
          "CATALOG_DEFINITION_NOT_SELECTABLE",
          `required pattern ${id} is ${core.status}`,
          id,
        );
      }
      if (!isTaxonomyCompatible(taxonomy, selection, overlayIds)) {
        return failure(
          "CATALOG_REFERENCE_INCOMPATIBLE",
          `required pattern ${id} is incompatible with the selected profile`,
          id,
        );
      }
      if (versionRange !== null && !semver.satisfies(core.version, versionRange)) {
        return failure(
          "CATALOG_DEFINITION_VERSION_CONFLICT",
          `pattern ${id} version ${core.version} does not satisfy ${versionRange}`,
          id,
        );
      }
      const before = selectedPatterns.size;
      selectedPatterns.add(id);
      return success(selectedPatterns.size !== before);
    };
    const addCompanion = (id: string): RuntimeResult<boolean> => {
      const pair = companionPairs.value.get(id);
      if (pair === undefined) {
        return failure(
          "CATALOG_REFERENCE_UNRESOLVED",
          `required companion ${id} is missing`,
          id,
        );
      }
      const core = pair.core.value as CompanionRuleCore;
      const taxonomy = pair.taxonomy.value as CompanionTaxonomyBinding;
      if (core.status !== "active") {
        return failure(
          "CATALOG_DEFINITION_NOT_SELECTABLE",
          `required companion ${id} is ${core.status}`,
          id,
        );
      }
      if (!isTaxonomyCompatible(taxonomy, selection, overlayIds)) {
        return failure(
          "CATALOG_REFERENCE_INCOMPATIBLE",
          `required companion ${id} is incompatible with the selected profile`,
          id,
        );
      }
      const before = selectedCompanions.size;
      selectedCompanions.add(id);
      return success(selectedCompanions.size !== before);
    };

    let changed = true;
    while (changed) {
      changed = false;
      let evaluateAllCompanions = false;
      for (const id of [...selectedPatterns].sort(compareUtf8)) {
        const pair = patternPairs.value.get(id);
        if (pair === undefined) continue;
        const core = pair.core.value as PatternCoreDefinition;
        evaluateAllCompanions ||= core.composition.triggers_companions;
        for (const companionId of core.composition.mandatory_companion_rule_ids) {
          const added = addCompanion(companionId);
          if (!added.ok) return added;
          changed ||= added.value;
        }
      }
      if (evaluateAllCompanions) {
        for (const [id, pair] of companionPairs.value) {
          const core = pair.core.value as CompanionRuleCore;
          const taxonomy = pair.taxonomy.value as CompanionTaxonomyBinding;
          if (
            core.status === "active" &&
            isTaxonomyCompatible(taxonomy, selection, overlayIds)
          ) {
            const added = addCompanion(id);
            if (!added.ok) return added;
            changed ||= added.value;
          }
        }
      }
      for (const id of [...selectedCompanions].sort(compareUtf8)) {
        const pair = companionPairs.value.get(id);
        if (pair === undefined) continue;
        const core = pair.core.value as CompanionRuleCore;
        for (const required of core.require_patterns) {
          if (required.condition === false) continue;
          const added = addPattern(required.id, required.version_range);
          if (!added.ok) return added;
          changed ||= added.value;
        }
      }
    }

    for (const id of [...selectedPatterns].sort(compareUtf8)) {
      const pair = patternPairs.value.get(id);
      if (pair === undefined) continue;
      const coreAdded = addDocument(pair.core, "pattern");
      if (!coreAdded.ok) return coreAdded;
      const taxonomyAdded = addDocument(pair.taxonomy, null);
      if (!taxonomyAdded.ok) return taxonomyAdded;
    }
    for (const id of [...selectedCompanions].sort(compareUtf8)) {
      const pair = companionPairs.value.get(id);
      if (pair === undefined) continue;
      const coreAdded = addDocument(pair.core, "companion");
      if (!coreAdded.ok) return coreAdded;
      const taxonomyAdded = addDocument(pair.taxonomy, null);
      if (!taxonomyAdded.ok) return taxonomyAdded;
    }

    const schemaById = new Map(
      verified.value.schema_files.map((schema) => [schema.id, schema] as const),
    );
    for (const [schemaId, users] of [...schemaUsage].sort(([left], [right]) =>
      compareUtf8(left, right),
    )) {
      const schema = schemaById.get(schemaId);
      if (schema === undefined) {
        return failure(
          "CATALOG_SCHEMA_MISSING",
          `required emitted schema ${schemaId} is missing`,
          schemaId,
        );
      }
      const resolved = resolvedSchema(schema, [...users]);
      files.set(resolved.target_relative_path, resolved);
    }

    return success({
      release: verified.value.release,
      release_hash: verified.value.release_hash,
      files: [...files.values()].sort((left, right) =>
        compareUtf8(left.target_relative_path, right.target_relative_path),
      ),
      blueprint,
      definitions: [...definitions.values()].sort((left, right) =>
        compareUtf8(`${left.kind}:${left.id}`, `${right.kind}:${right.id}`),
      ),
      required_schema_ids: [...schemaUsage.keys()].sort(compareUtf8),
    });
  }
}
