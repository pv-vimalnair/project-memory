import { lstat, readFile } from "node:fs/promises";

import type { PlannedWrite } from "../contracts/planned-write.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import {
  decodeStrictUtf8,
  emitGeneratedYaml,
  normalizeGitTextBytes,
  parseJsonDocument,
  parseYamlDocument,
} from "../core/document-io.js";
import { sha256 } from "../core/hash.js";
import { resolveInside } from "../core/path-safety.js";
import {
  renderAdapters,
  type TargetByteSnapshot,
} from "../materialize/render-adapters.js";
import {
  renderProtocol,
  renderStartupContext,
} from "../materialize/render-startup-context.js";
import { validateWithSchema } from "../schema/validate.js";
import { profileLockHash, PROFILE_LOCK_PATH, PROJECT_SELECTION_PATH } from "./build-profile-lock.js";
import { SELECTED_CATALOG_LOCK_PATH } from "./build-selected-catalog-lock.js";
import { compareUtf8 } from "./catalog-selection-model.js";
import {
  ProfileLockSchema,
  ProjectSelectionSchema,
  SelectedCatalogLockSchema,
  type ProfileLock,
  type ProjectSelection,
  type SelectedCatalogLock,
  type ResolvedProfile,
} from "./contracts/index.js";
import { verifyProfileSources } from "./verify-profile-sources.js";
import { verifySelectedCatalogLock } from "./verify-selected-catalog-lock.js";


const ADAPTER_ROOT_PATHS = ["AGENTS.md", "CLAUDE.md"] as const;

export interface ProfileVerificationReport {
  readonly valid: boolean;
  readonly root_id: string;
  readonly profile_lock_hash: string;
  readonly selected_catalog_lock_hash: string;
  readonly checked_paths: readonly string[];
  readonly external_reads: readonly [];
}

export interface ProfileVerifier {
  verify(root: URL): Promise<RuntimeResult<ProfileVerificationReport>>;
}

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

async function readTarget(
  root: URL,
  relativePath: string,
  optional = false,
): Promise<RuntimeResult<Uint8Array | null>> {
  const resolved = await resolveInside(root, relativePath);
  if (!resolved.ok) return resolved;
  try {
    const stat = await lstat(resolved.value);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure(
        "PROFILE_TARGET_UNSAFE",
        "profile verification accepts regular target files only",
        relativePath,
      );
    }
    return success(normalizeGitTextBytes(
      new Uint8Array(await readFile(resolved.value)),
    ));
  } catch (error: unknown) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return success(null);
    }
    return failure(
      "PROFILE_TARGET_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
}

async function requiredBytes(
  root: URL,
  relativePath: string,
): Promise<RuntimeResult<Uint8Array>> {
  const result = await readTarget(root, relativePath);
  return !result.ok
    ? result
    : result.value === null
      ? failure("PROFILE_TARGET_READ_FAILED", "required target is missing", relativePath)
      : success(result.value);
}

async function loadProfileLock(
  root: URL,
): Promise<RuntimeResult<{ readonly lock: ProfileLock; readonly bytes: Uint8Array }>> {
  const bytes = await requiredBytes(root, PROFILE_LOCK_PATH);
  if (!bytes.ok) return bytes;
  const decoded = decodeStrictUtf8(bytes.value, PROFILE_LOCK_PATH);
  if (!decoded.ok) return decoded;
  const parsed = parseYamlDocument(decoded.value, PROFILE_LOCK_PATH);
  if (!parsed.ok) return parsed;
  const validated = validateWithSchema<ProfileLock>(ProfileLockSchema.$id, parsed.value);
  if (!validated.ok) return validated;
  const emitted = emitGeneratedYaml(validated.value);
  if (!emitted.ok) return emitted;
  if (!byteEqual(bytes.value, new TextEncoder().encode(emitted.value))) {
    return failure(
      "PROFILE_LOCK_NONCANONICAL",
      "profile lock bytes must match deterministic YAML emission",
      PROFILE_LOCK_PATH,
    );
  }
  const { lock_hash: lockHash, ...withoutHash } = validated.value;
  if (profileLockHash(withoutHash) !== lockHash) {
    return failure(
      "PROFILE_LOCK_HASH_MISMATCH",
      "profile lock hash does not match its canonical content",
      PROFILE_LOCK_PATH,
    );
  }
  return success({ lock: validated.value, bytes: bytes.value });
}

async function loadSelection(
  root: URL,
  lock: ProfileLock,
): Promise<RuntimeResult<ProjectSelection>> {
  const bytes = await requiredBytes(root, PROJECT_SELECTION_PATH);
  if (!bytes.ok) return bytes;
  if (sha256(bytes.value) !== lock.project_hash) {
    return failure(
      "PROFILE_PROJECT_HASH_MISMATCH",
      "project selection bytes do not match the profile lock",
      PROJECT_SELECTION_PATH,
    );
  }
  const decoded = decodeStrictUtf8(bytes.value, PROJECT_SELECTION_PATH);
  if (!decoded.ok) return decoded;
  const parsed = parseYamlDocument(decoded.value, PROJECT_SELECTION_PATH);
  if (!parsed.ok) return parsed;
  return validateWithSchema<ProjectSelection>(ProjectSelectionSchema.$id, parsed.value);
}

async function loadSelectedCatalogLock(
  root: URL,
): Promise<RuntimeResult<SelectedCatalogLock>> {
  const bytes = await requiredBytes(root, SELECTED_CATALOG_LOCK_PATH);
  if (!bytes.ok) return bytes;
  const decoded = decodeStrictUtf8(bytes.value, SELECTED_CATALOG_LOCK_PATH);
  if (!decoded.ok) return decoded;
  const parsed = parseJsonDocument(decoded.value, SELECTED_CATALOG_LOCK_PATH);
  if (!parsed.ok) return parsed;
  return validateWithSchema<SelectedCatalogLock>(
    SelectedCatalogLockSchema.$id,
    parsed.value,
  );
}

function profileMatchesSelection(
  selection: ProjectSelection,
  profile: ResolvedProfile,
): boolean {
  const selectedOverlays = [...selection.overlays].sort(compareUtf8);
  const resolvedOverlays = profile.overlays
    .map((overlay) => overlay.id)
    .sort(compareUtf8);
  const selectedAdapters = Object.entries(selection.adapters)
    .flatMap(([kind, values]) =>
      values.map((value) => `${kind}:${value.id}:${value.version}`),
    )
    .sort(compareUtf8);
  const resolvedAdapters = profile.adapters
    .map(
      (value) =>
        `${value.kind}:${value.definition_id}:${value.definition_version}`,
    )
    .sort(compareUtf8);
  const selectedComponents = selection.components
    .map(
      (value) =>
        `${value.instance_id}:${value.definition.id}:${value.definition.version}:${value.slug}`,
    )
    .sort(compareUtf8);
  const resolvedComponents = profile.components
    .map(
      (value) =>
        `${value.instance_id}:${value.definition_id}:${value.definition_version}:${value.slug}`,
    )
    .sort(compareUtf8);
  const selectedDomains = selection.domains
    .map(
      (value) =>
        `${value.instance_id}:${value.definition.id}:${value.definition.version}:${value.slug}`,
    )
    .sort(compareUtf8);
  const resolvedDomains = profile.domains
    .map(
      (value) =>
        `${value.instance_id}:${value.definition_id}:${value.definition_version}:${value.slug}`,
    )
    .sort(compareUtf8);
  return (
    selection.root.id === profile.root.id &&
    selection.root.namespace === profile.root.namespace &&
    selection.root.kind === profile.root.kind &&
    selection.root.primary_archetype === profile.root.primary_archetype &&
    selection.root.lifecycle === profile.root.lifecycle &&
    selection.root.blueprint.id === profile.blueprint.id &&
    selection.root.blueprint.version === profile.blueprint.version &&
    canonicalJson(selectedOverlays) === canonicalJson(resolvedOverlays) &&
    canonicalJson(selectedAdapters) === canonicalJson(resolvedAdapters) &&
    canonicalJson(selectedComponents) === canonicalJson(resolvedComponents) &&
    canonicalJson(selectedDomains) === canonicalJson(resolvedDomains)
  );
}

async function verifyExactWrite(
  root: URL,
  write: PlannedWrite,
  code: string,
): Promise<RuntimeResult<true>> {
  const bytes = await requiredBytes(root, write.relative_path);
  return !bytes.ok
    ? bytes
    : byteEqual(bytes.value, write.bytes)
      ? success(true)
      : failure(code, "compiler-owned target bytes are inconsistent", write.relative_path);
}

async function verifyGeneratedArtifacts(
  root: URL,
  selection: ProjectSelection,
  lock: ProfileLock,
): Promise<RuntimeResult<readonly string[]>> {
  const startup = renderStartupContext(selection, lock.profile, lock);
  if (!startup.ok) return startup;
  const protocol = renderProtocol();
  for (const write of [startup.value, protocol]) {
    const verified = await verifyExactWrite(root, write, "PROFILE_GENERATED_ARTIFACT_MISMATCH");
    if (!verified.ok) return verified;
  }

  const snapshotFiles = new Map<string, Uint8Array>();
  for (const pathValue of ADAPTER_ROOT_PATHS) {
    const bytes = await readTarget(root, pathValue, true);
    if (!bytes.ok) return bytes;
    if (bytes.value !== null) snapshotFiles.set(pathValue, bytes.value);
  }
  const snapshot: TargetByteSnapshot = { files: snapshotFiles };
  const adapters = renderAdapters(lock.profile, snapshot);
  if (!adapters.ok) return adapters;
  const checked = [startup.value.relative_path, protocol.relative_path];
  for (const write of adapters.value) {
    const verified = await verifyExactWrite(
      root,
      write,
      "PROFILE_ADAPTER_ARTIFACT_MISMATCH",
    );
    if (!verified.ok) return verified;
    checked.push(write.relative_path);
  }
  checked.push(...snapshotFiles.keys());
  return success([...new Set(checked)].sort(compareUtf8));
}

async function verifyProfile(
  root: URL,
): Promise<RuntimeResult<ProfileVerificationReport>> {
  if (root.protocol !== "file:") {
    return failure("PATH_ROOT_INVALID", "profile target root must be a file URL");
  }
  const loaded = await loadProfileLock(root);
  if (!loaded.ok) return loaded;
  const selection = await loadSelection(root, loaded.value.lock);
  if (!selection.ok) return selection;
  if (!profileMatchesSelection(selection.value, loaded.value.lock.profile)) {
    return failure(
      "PROFILE_SELECTION_RESOLUTION_MISMATCH",
      "resolved profile does not match the accepted project selection",
      PROFILE_LOCK_PATH,
    );
  }
  const selectedCatalogLock = await loadSelectedCatalogLock(root);
  if (!selectedCatalogLock.ok) return selectedCatalogLock;
  const catalog = await verifySelectedCatalogLock(root);
  if (!catalog.ok) return catalog;
  if (
    catalog.value.lock_hash !== loaded.value.lock.selected_catalog_lock_hash ||
    selectedCatalogLock.value.lock_hash !== catalog.value.lock_hash ||
    selection.value.catalog.release !== selectedCatalogLock.value.catalog_release ||
    selection.value.catalog.catalog_hash !==
      selectedCatalogLock.value.source_release_hash ||
    loaded.value.lock.profile.catalog.release !==
      selectedCatalogLock.value.catalog_release ||
    loaded.value.lock.profile.catalog.release_hash !==
      selectedCatalogLock.value.source_release_hash
  ) {
    return failure(
      "PROFILE_CATALOG_LOCK_MISMATCH",
      "profile lock does not reference the verified selected catalog lock",
      SELECTED_CATALOG_LOCK_PATH,
    );
  }
  const sources = await verifyProfileSources(root, loaded.value.lock);
  if (!sources.ok) return sources;
  const artifacts = await verifyGeneratedArtifacts(
    root,
    selection.value,
    loaded.value.lock,
  );
  if (!artifacts.ok) return artifacts;
  return success({
    valid: true,
    root_id: loaded.value.lock.root_id,
    profile_lock_hash: loaded.value.lock.lock_hash,
    selected_catalog_lock_hash: catalog.value.lock_hash,
    checked_paths: [
      PROFILE_LOCK_PATH,
      PROJECT_SELECTION_PATH,
      ...catalog.value.checked_paths,
      ...sources.value,
      ...artifacts.value,
    ].filter((value, index, values) => values.indexOf(value) === index).sort(compareUtf8),
    external_reads: [],
  });
}

export function createProfileVerifier(): ProfileVerifier {
  return { verify: verifyProfile };
}
