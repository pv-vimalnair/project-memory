import { readFile } from "node:fs/promises";

import type { PlannedWrite } from "../../contracts/planned-write.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import { canonicalJson } from "../../core/canonical-json.js";
import { applyFileTransaction } from "../../core/file-transaction.js";
import { sha256 } from "../../core/hash.js";
import { resolveInside } from "../../core/path-safety.js";
import { assembleCompanionRule } from "../assembly/assemble-companion-rule.js";
import { assemblePatternDefinition } from "../assembly/assemble-pattern.js";
import type {
  CatalogReleaseArtifacts,
  CatalogReleaseLock,
} from "../contracts/index.js";
import { compareUtf8 } from "../issues.js";
import { loadCatalog, type CatalogSource } from "../load-catalog.js";
import { walkCatalogFiles } from "../loading/source-files.js";
import { validateCatalog } from "../validation/validate-catalog.js";

export interface BuildCatalogReleaseOptions {
  readonly sourceRoot: URL;
  readonly outputRoot: URL;
  readonly release: string;
  readonly checkClean?: boolean;
}

export interface BuiltCatalogRelease {
  readonly artifacts: CatalogReleaseArtifacts;
  readonly lock: CatalogReleaseLock;
  readonly bundle_bytes: Uint8Array;
  readonly lock_bytes: Uint8Array;
  readonly checksums_bytes: Uint8Array;
  readonly written: boolean;
}

interface SourceIdentity {
  readonly definition_id: string | null;
  readonly version: string | null;
  readonly schema_id: string | null;
}

interface ReleaseFile {
  readonly relative_path: string;
  readonly bytes: Uint8Array;
}

const SCHEMAS = Object.freeze({
  manifest: "project-memory/v1/catalog-manifest",
  blueprint_group: "project-memory/v1/blueprint-group-definition",
  blueprint: "project-memory/v1/blueprint-definition",
  component: "project-memory/v1/component-definition",
  domain: "project-memory/v1/domain-definition",
  overlay: "project-memory/v1/overlay-definition",
  adapter: "project-memory/v1/adapter-definition",
  pattern_core: "project-memory/v1/pattern-core",
  pattern_taxonomy: "project-memory/v1/pattern-taxonomy",
  companion_core: "project-memory/v1/companion-rule-core",
  companion_taxonomy: "project-memory/v1/companion-taxonomy",
  fixture: "project-memory/v1/blueprint-fixture",
  inventory: "project-memory/v1/catalog-inventory",
});

function utf8(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "utf8"));
}

async function readBytes(
  root: URL,
  relativePath: string,
): Promise<RuntimeResult<Uint8Array>> {
  const resolved = await resolveInside(root, relativePath);
  if (!resolved.ok) return resolved;
  try {
    return success(new Uint8Array(await readFile(resolved.value)));
  } catch (error: unknown) {
    return failure(
      "CATALOG_RELEASE_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
}

function byId<T extends { readonly id: string }>(
  values: Iterable<T>,
): readonly T[] {
  return [...values].sort((left, right) => compareUtf8(left.id, right.id));
}

function byBindingId<T extends { readonly pattern_id: string }>(
  values: Iterable<T>,
): readonly T[] {
  return [...values].sort((left, right) =>
    compareUtf8(left.pattern_id, right.pattern_id),
  );
}

function byRuleId<T extends { readonly rule_id: string }>(
  values: Iterable<T>,
): readonly T[] {
  return [...values].sort((left, right) =>
    compareUtf8(left.rule_id, right.rule_id),
  );
}

function identityMap(source: CatalogSource): ReadonlyMap<string, SourceIdentity> {
  const identities = new Map<string, SourceIdentity>();
  const add = (
    kind: string,
    id: string,
    version: string | null,
    schemaId: string,
  ): void => {
    const relativePath = source.source_paths.get(`${kind}:${id}`);
    if (relativePath !== undefined) {
      identities.set(relativePath, {
        definition_id: id,
        version,
        schema_id: schemaId,
      });
    }
  };

  if (source.manifest !== null) {
    const relativePath = source.source_paths.get("manifest:project-memory");
    if (relativePath !== undefined) {
      identities.set(relativePath, {
        definition_id: null,
        version: source.manifest.release,
        schema_id: SCHEMAS.manifest,
      });
    }
  }
  for (const value of source.blueprint_groups.values()) add("blueprint_group", value.id, value.version, SCHEMAS.blueprint_group);
  for (const value of source.blueprints.values()) add("blueprint", value.id, value.version, SCHEMAS.blueprint);
  for (const value of source.components.values()) add("component", value.id, value.version, SCHEMAS.component);
  for (const value of source.domains.values()) add("domain", value.id, value.version, SCHEMAS.domain);
  for (const value of source.overlays.values()) add("overlay", value.id, value.version, SCHEMAS.overlay);
  for (const value of source.adapters.values()) add("adapter", value.id, value.version, SCHEMAS.adapter);
  for (const value of source.pattern_cores.values()) add("pattern_core", value.id, value.version, SCHEMAS.pattern_core);
  for (const value of source.pattern_taxonomy.values()) add("pattern_taxonomy", value.pattern_id, value.pattern_version, SCHEMAS.pattern_taxonomy);
  for (const value of source.companion_cores.values()) add("companion_core", value.id, value.version, SCHEMAS.companion_core);
  for (const value of source.companion_taxonomy.values()) add("companion_taxonomy", value.rule_id, value.rule_version, SCHEMAS.companion_taxonomy);
  for (const value of source.fixtures.values()) add("fixture", value.id, null, SCHEMAS.fixture);
  for (const value of source.inventories.values()) add("inventory", value.id, value.version, SCHEMAS.inventory);
  return identities;
}

async function sourceLockEntries(
  sourceRoot: URL,
  source: CatalogSource,
): Promise<RuntimeResult<CatalogReleaseLock["source_entries"]>> {
  const walked = await walkCatalogFiles(sourceRoot);
  if (!walked.ok) return walked;
  const identities = identityMap(source);
  const entries: CatalogReleaseLock["source_entries"][number][] = [];
  for (const relativePath of walked.value) {
    const bytes = await readBytes(sourceRoot, relativePath);
    if (!bytes.ok) return bytes;
    const identity = identities.get(relativePath) ?? {
      definition_id: null,
      version: null,
      schema_id: null,
    };
    if (relativePath.endsWith(".yaml") && identity.schema_id === null) {
      return failure(
        "CATALOG_RELEASE_SOURCE_UNIDENTIFIED",
        "validated YAML source is missing release identity metadata",
        relativePath,
      );
    }
    entries.push({
      relative_path: relativePath,
      definition_id: identity.definition_id,
      version: identity.version,
      schema_id: identity.schema_id,
      sha256: sha256(bytes.value),
    });
  }
  return success(
    entries.sort((left, right) =>
      compareUtf8(left.relative_path, right.relative_path),
    ),
  );
}

function assembledPatterns(source: CatalogSource): RuntimeResult<readonly unknown[]> {
  const assembled: unknown[] = [];
  for (const id of [...source.pattern_cores.keys()].sort(compareUtf8)) {
    const core = source.pattern_cores.get(id);
    const taxonomy = source.pattern_taxonomy.get(id);
    if (core === undefined || taxonomy === undefined) {
      return failure(
        "CATALOG_HALF_MISSING",
        `pattern ${id} is missing a release half`,
        id,
      );
    }
    const result = assemblePatternDefinition(core, taxonomy);
    if (!result.ok) return result;
    assembled.push(result.value);
  }
  return success(assembled);
}

function assembledCompanions(source: CatalogSource): RuntimeResult<readonly unknown[]> {
  const assembled: unknown[] = [];
  for (const id of [...source.companion_cores.keys()].sort(compareUtf8)) {
    const core = source.companion_cores.get(id);
    const taxonomy = source.companion_taxonomy.get(id);
    if (core === undefined || taxonomy === undefined) {
      return failure(
        "CATALOG_HALF_MISSING",
        `companion ${id} is missing a release half`,
        id,
      );
    }
    const result = assembleCompanionRule(core, taxonomy);
    if (!result.ok) return result;
    assembled.push(result.value);
  }
  return success(assembled);
}

function bundleDocument(
  source: CatalogSource,
  release: string,
): RuntimeResult<Record<string, unknown>> {
  const patterns = assembledPatterns(source);
  if (!patterns.ok) return patterns;
  const companions = assembledCompanions(source);
  if (!companions.ok) return companions;
  return success({
    schema_version: "1.0.0",
    catalog_id: "project-memory",
    release,
    manifest: source.manifest,
    definitions: {
      blueprint_groups: byId(source.blueprint_groups.values()),
      blueprints: byId(source.blueprints.values()),
      components: byId(source.components.values()),
      domains: byId(source.domains.values()),
      overlays: byId(source.overlays.values()),
      adapters: byId(source.adapters.values()),
      pattern_cores: byId(source.pattern_cores.values()),
      pattern_taxonomy: byBindingId(source.pattern_taxonomy.values()),
      companion_cores: byId(source.companion_cores.values()),
      companion_taxonomy: byRuleId(source.companion_taxonomy.values()),
      fixtures: byId(source.fixtures.values()),
      inventories: byId(source.inventories.values()),
    },
    assembled: {
      patterns: patterns.value,
      companion_rules: companions.value,
    },
  });
}

export function catalogReleaseHash(
  lock: Pick<
    CatalogReleaseLock,
    "schema_version" | "catalog_id" | "release" | "source_entries" | "generated_entries"
  >,
): string {
  return sha256(
    canonicalJson({
      schema_version: lock.schema_version,
      catalog_id: lock.catalog_id,
      release: lock.release,
      source_entries: lock.source_entries,
      generated_entries: lock.generated_entries,
    }),
  );
}

export function catalogChecksums(
  bundleBytes: Uint8Array,
  lockBytes: Uint8Array,
): Uint8Array {
  return utf8(
    `${sha256(bundleBytes)}  catalog.bundle.json\n${sha256(lockBytes)}  catalog.lock.json\n`,
  );
}

async function reconcileReleaseFiles(
  outputRoot: URL,
  files: readonly ReleaseFile[],
  checkClean: boolean,
): Promise<RuntimeResult<boolean>> {
  const existing: (Uint8Array | null)[] = [];
  for (const file of files) {
    const resolved = await resolveInside(outputRoot, file.relative_path);
    if (!resolved.ok) return resolved;
    try {
      existing.push(new Uint8Array(await readFile(resolved.value)));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        existing.push(null);
      } else {
        return failure(
          "CATALOG_RELEASE_READ_FAILED",
          error instanceof Error ? error.message : String(error),
          file.relative_path,
        );
      }
    }
  }
  const present = existing.filter((bytes) => bytes !== null).length;
  if (present === files.length) {
    for (let index = 0; index < files.length; index += 1) {
      const expected = files[index];
      const actual = existing[index];
      if (
        expected === undefined ||
        actual === undefined ||
        actual === null ||
        !Buffer.from(expected.bytes).equals(Buffer.from(actual))
      ) {
        return failure(
          "CATALOG_RELEASE_IMMUTABLE",
          "an existing release differs from the deterministic source build",
          expected?.relative_path ?? "release",
        );
      }
    }
    return success(false);
  }
  if (present > 0) {
    return failure(
      "CATALOG_RELEASE_IMMUTABLE",
      "an existing release is incomplete and cannot be rewritten",
      "release",
    );
  }
  if (checkClean) {
    return failure(
      "CATALOG_RELEASE_MISSING",
      "check-clean requires an existing byte-identical release",
      "release",
    );
  }
  const writes: PlannedWrite[] = files.map((file) => ({
    relative_path: file.relative_path,
    bytes: file.bytes,
    expected_existing_sha256: null,
    mode: "create",
  }));
  const written = await applyFileTransaction(outputRoot, writes);
  return written.ok ? success(true) : written;
}

export async function buildCatalogRelease(
  options: BuildCatalogReleaseOptions,
): Promise<RuntimeResult<BuiltCatalogRelease>> {
  const loaded = await loadCatalog(options.sourceRoot);
  if (!loaded.ok) return loaded;
  const validated = validateCatalog(loaded.value, { strict: true });
  if (!validated.ok) return validated;
  const manifest = loaded.value.manifest;
  if (manifest === null || manifest.release !== options.release) {
    return failure(
      "CATALOG_RELEASE_VERSION_MISMATCH",
      `requested release ${options.release} does not match the catalog manifest`,
      "manifest.yaml",
    );
  }
  const sourceEntries = await sourceLockEntries(options.sourceRoot, loaded.value);
  if (!sourceEntries.ok) return sourceEntries;
  const bundle = bundleDocument(loaded.value, options.release);
  if (!bundle.ok) return bundle;
  const bundleBytes = utf8(canonicalJson(bundle.value));
  const generatedEntries: CatalogReleaseLock["generated_entries"] = [
    {
      relative_path: "catalog.bundle.json",
      definition_id: null,
      version: options.release,
      schema_id: null,
      sha256: sha256(bundleBytes),
    },
  ];
  const lockWithoutHash = {
    schema_version: "1.0.0" as const,
    catalog_id: "project-memory" as const,
    release: options.release,
    source_entries: sourceEntries.value,
    generated_entries: generatedEntries,
  };
  const lock: CatalogReleaseLock = {
    ...lockWithoutHash,
    release_hash: catalogReleaseHash(lockWithoutHash),
  };
  const lockBytes = utf8(canonicalJson(lock));
  const checksumsBytes = catalogChecksums(bundleBytes, lockBytes);
  const releaseRelative = `dist/catalog/project-memory/${options.release}`;
  const releaseFiles: ReleaseFile[] = [
    { relative_path: `${releaseRelative}/catalog.bundle.json`, bytes: bundleBytes },
    { relative_path: `${releaseRelative}/catalog.lock.json`, bytes: lockBytes },
    { relative_path: `${releaseRelative}/SHA256SUMS`, bytes: checksumsBytes },
  ];
  const reconciled = await reconcileReleaseFiles(
    options.outputRoot,
    releaseFiles,
    options.checkClean ?? false,
  );
  if (!reconciled.ok) return reconciled;
  const bundleTarget = await resolveInside(
    options.outputRoot,
    `${releaseRelative}/catalog.bundle.json`,
  );
  if (!bundleTarget.ok) return bundleTarget;
  return success({
    artifacts: {
      root: new URL("./", bundleTarget.value),
      lock,
      bundle_path: "catalog.bundle.json",
      lock_path: "catalog.lock.json",
      checksums_path: "SHA256SUMS",
    },
    lock,
    bundle_bytes: bundleBytes,
    lock_bytes: lockBytes,
    checksums_bytes: checksumsBytes,
    written: reconciled.value,
  });
}
