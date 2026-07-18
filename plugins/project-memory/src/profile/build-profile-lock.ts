import type { PlannedWrite } from "../contracts/planned-write.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import { validateWithSchema } from "../schema/validate.js";
import { compareUtf8 } from "./catalog-selection-model.js";
import type {
  AcceptedProfileSourceSet,
  AcceptedSourceLockEntry,
  ProfileLock,
  ProjectSelection,
  ResolvedProfile,
  SelectedCatalogLock,
} from "./contracts/index.js";
import { ProfileLockSchema } from "./contracts/index.js";

export const PROFILE_LOCK_PATH = "docs/project-memory/profile.lock.yaml";
export const PROJECT_SELECTION_PATH = "docs/project-memory/project.yaml";

export interface BuildProfileLockInput {
  readonly selection: ProjectSelection;
  readonly accepted_sources: AcceptedProfileSourceSet;
  readonly profile: ResolvedProfile;
  readonly selected_catalog_lock: SelectedCatalogLock;
  readonly source_writes: readonly PlannedWrite[];
  readonly project_hash: string;
  readonly previous_profile_lock: ProfileLock | null;
}

export function profileLockHash(
  lock: Omit<ProfileLock, "lock_hash">,
): string {
  return sha256(canonicalJson(lock));
}

function componentPath(id: string): string {
  return `docs/project-memory/components/${id}/COMPONENT.md`;
}

function domainPath(id: string): string {
  return `docs/project-memory/domains/${id}/DOMAIN.md`;
}

function writeIndex(
  writes: readonly PlannedWrite[],
): RuntimeResult<ReadonlyMap<string, PlannedWrite>> {
  const indexed = new Map<string, PlannedWrite>();
  for (const write of writes) {
    if (indexed.has(write.relative_path)) {
      return failure(
        "PROFILE_WRITE_DUPLICATE",
        `accepted source renderer repeats ${write.relative_path}`,
        write.relative_path,
      );
    }
    indexed.set(write.relative_path, write);
  }
  return success(indexed);
}

function sourceEntry(
  writes: ReadonlyMap<string, PlannedWrite>,
  kind: AcceptedSourceLockEntry["kind"],
  sourceId: string,
  revision: number,
  targetPath: string,
  approvalRefs: readonly string[],
): RuntimeResult<AcceptedSourceLockEntry> {
  const write = writes.get(targetPath);
  if (write === undefined) {
    return failure(
      "PROFILE_SOURCE_WRITE_MISSING",
      `${kind} ${sourceId} has no rendered accepted source bytes`,
      targetPath,
    );
  }
  return success({
    kind,
    source_id: sourceId,
    revision,
    target_path: targetPath,
    sha256: sha256(write.bytes),
    approval_refs: [...approvalRefs].sort(compareUtf8),
  });
}

function appendEntry(
  target: AcceptedSourceLockEntry[],
  result: RuntimeResult<AcceptedSourceLockEntry>,
): RuntimeResult<true> {
  if (!result.ok) return { ok: false, issues: result.issues };
  target.push(result.value);
  return success(true);
}

function buildAcceptedSourceEntries(
  sources: AcceptedProfileSourceSet,
  sourceWrites: readonly PlannedWrite[],
): RuntimeResult<AcceptedSourceLockEntry[]> {
  const indexed = writeIndex(sourceWrites);
  if (!indexed.ok) return { ok: false, issues: indexed.issues };
  const entries: AcceptedSourceLockEntry[] = [];
  const project = appendEntry(
    entries,
    sourceEntry(
      indexed.value,
      "project",
      sources.project.id,
      sources.project.revision,
      "docs/project-memory/source/PROJECT.md",
      sources.project.approval_refs,
    ),
  );
  if (!project.ok) return project;
  for (const record of sources.constraints) {
    const added = appendEntry(
      entries,
      sourceEntry(
        indexed.value,
        "constraint",
        record.id,
        record.revision,
        "docs/project-memory/source/CONSTRAINTS.md",
        record.approval_refs,
      ),
    );
    if (!added.ok) return added;
  }
  for (const record of sources.policies) {
    const added = appendEntry(
      entries,
      sourceEntry(
        indexed.value,
        "policy",
        record.id,
        record.revision,
        "docs/project-memory/source/POLICIES.md",
        record.approval_refs,
      ),
    );
    if (!added.ok) return added;
  }
  for (const record of sources.blueprint_documents) {
    const added = appendEntry(
      entries,
      sourceEntry(
        indexed.value,
        "blueprint-document",
        record.id,
        record.revision,
        record.relative_path,
        record.approval_refs,
      ),
    );
    if (!added.ok) return added;
  }
  for (const record of sources.components) {
    const added = appendEntry(
      entries,
      sourceEntry(
        indexed.value,
        "component",
        record.id,
        record.revision,
        componentPath(record.id),
        record.approval_refs,
      ),
    );
    if (!added.ok) return added;
  }
  for (const record of sources.domains) {
    const added = appendEntry(
      entries,
      sourceEntry(
        indexed.value,
        "domain",
        record.id,
        record.revision,
        domainPath(record.id),
        record.approval_refs,
      ),
    );
    if (!added.ok) return added;
  }
  for (const record of sources.root_relationships) {
    const added = appendEntry(
      entries,
      sourceEntry(
        indexed.value,
        "root-relationship",
        record.relationship_id,
        record.revision,
        "docs/project-memory/source/ROOT_RELATIONSHIPS.md",
        record.approval_refs,
      ),
    );
    if (!added.ok) return added;
  }
  return success(
    entries.sort((left, right) =>
      compareUtf8(
        `${left.kind}:${left.source_id}`,
        `${right.kind}:${right.source_id}`,
      ),
    ),
  );
}

export function buildProfileLock(
  input: BuildProfileLockInput,
): RuntimeResult<ProfileLock> {
  if (
    input.selection.root.id !== input.accepted_sources.project.id ||
    input.selection.root.id !== input.profile.root.id
  ) {
    return failure(
      "PROFILE_LOCK_ROOT_MISMATCH",
      "selection, accepted sources, and resolved profile must share one root ID",
      input.selection.root.id,
    );
  }
  const entries = buildAcceptedSourceEntries(
    input.accepted_sources,
    input.source_writes,
  );
  if (!entries.ok) return { ok: false, issues: entries.issues };
  const withoutHash: Omit<ProfileLock, "lock_hash"> = {
    schema_version: "1.0.0",
    profile_revision:
      input.previous_profile_lock === null
        ? 1
        : input.previous_profile_lock.profile_revision + 1,
    root_id: input.selection.root.id,
    project_hash: input.project_hash,
    selected_catalog_lock_hash: input.selected_catalog_lock.lock_hash,
    accepted_source_entries: entries.value,
    profile: input.profile,
  };
  const lock: ProfileLock = {
    ...withoutHash,
    lock_hash: profileLockHash(withoutHash),
  };
  return validateWithSchema<ProfileLock>(ProfileLockSchema.$id, lock);
}
