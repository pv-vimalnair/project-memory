import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { compareUtf8 } from "./catalog-selection-model.js";
import type {
  AcceptedProfileSourceSet,
  AcceptedSourceLockEntry,
  ComponentInstanceBinding,
  ComponentInstanceData,
  DomainInstanceBinding,
  DomainInstanceData,
  ProfileLock,
  ProjectSelection,
  ResolvedComponentInstance,
  ResolvedDomainInstance,
  RootRelationshipSourceData,
} from "./contracts/index.js";

export type InstanceBindingChangeKind =
  | "added"
  | "removed"
  | "definition-replaced"
  | "parent-moved"
  | "relationship-address-changed"
  | "root-address-changed"
  | "slug-changed";

export type InstanceBindingArtifactKind =
  | "root"
  | "component"
  | "domain"
  | "root-relationship";

export interface ReconciledInstanceChange {
  readonly kind: InstanceBindingChangeKind;
  readonly artifact_kind: InstanceBindingArtifactKind;
  readonly instance_id: string;
  readonly previous_revision: number | null;
  readonly next_revision: number | null;
  readonly approval_refs: string[];
}

export interface ReconciledInstanceBindings {
  readonly root: {
    readonly instance_id: string;
    readonly namespace: string;
    readonly source_revision: number;
  };
  readonly components: ComponentInstanceBinding[];
  readonly domains: DomainInstanceBinding[];
  readonly relationships: RootRelationshipSourceData[];
  readonly changes: ReconciledInstanceChange[];
}

type InstanceBinding = ComponentInstanceBinding | DomainInstanceBinding;
type InstanceSource = ComponentInstanceData | DomainInstanceData;
type ResolvedInstance = ResolvedComponentInstance | ResolvedDomainInstance;

export interface PreviousContext {
  readonly lock: ProfileLock;
  readonly entries: ReadonlyMap<string, AcceptedSourceLockEntry>;
  readonly project_entry: AcceptedSourceLockEntry;
}

function entryKey(kind: AcceptedSourceLockEntry["kind"], id: string): string {
  return `${kind}:${id}`;
}

function duplicate(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

export function validateStableIds(
  selection: ProjectSelection,
  sources: AcceptedProfileSourceSet,
): RuntimeResult<true> {
  for (const binding of [
    ...(selection.components as readonly unknown[]),
    ...(selection.domains as readonly unknown[]),
  ]) {
    if (
      typeof binding !== "object" ||
      binding === null ||
      !("instance_id" in binding) ||
      typeof binding.instance_id !== "string" ||
      binding.instance_id.length === 0
    ) {
      return failure(
        "PROFILE_INSTANCE_ID_REQUIRED",
        "every accepted component and domain addition requires a stable instance ID",
        "/selection",
      );
    }
  }
  const selectionIds = [
    ...selection.components.map((binding) => binding.instance_id),
    ...selection.domains.map((binding) => binding.instance_id),
  ];
  const sourceIds = [
    ...sources.components.map((record) => record.id),
    ...sources.domains.map((record) => record.id),
    ...sources.root_relationships.map((record) => record.relationship_id),
  ];
  const repeated = duplicate(selectionIds) ?? duplicate(sourceIds);
  return repeated === null
    ? success(true)
    : failure(
        "PROFILE_INSTANCE_ID_DUPLICATE",
        `stable instance ID appears more than once: ${repeated}`,
        repeated,
      );
}

function alignInstances(
  kind: "component" | "domain",
  rootId: string,
  bindings: readonly InstanceBinding[],
  sources: readonly InstanceSource[],
): RuntimeResult<true> {
  if (bindings.length !== sources.length) {
    return failure(
      "PROFILE_SOURCE_SELECTION_MISMATCH",
      `${kind} selection and accepted sources have different cardinality`,
      `/${kind}s`,
    );
  }
  const byId = new Map(sources.map((source) => [source.id, source]));
  for (const binding of bindings) {
    const source = byId.get(binding.instance_id);
    if (
      source === undefined ||
      source.root_id !== rootId ||
      source.definition.id !== binding.definition.id ||
      source.definition.version !== binding.definition.version ||
      source.slug !== binding.slug ||
      source.revision !== binding.source_revision
    ) {
      return failure(
        "PROFILE_SOURCE_SELECTION_MISMATCH",
        `${kind} ${binding.instance_id} does not match its accepted source`,
        binding.instance_id,
      );
    }
  }
  return success(true);
}

export function validateSelectionSources(
  selection: ProjectSelection,
  sources: AcceptedProfileSourceSet,
): RuntimeResult<true> {
  if (selection.root.id !== sources.project.id) {
    return failure(
      "PROFILE_SOURCE_SELECTION_MISMATCH",
      "selected root ID does not match the accepted project source",
      selection.root.id,
    );
  }
  const components = alignInstances(
    "component",
    selection.root.id,
    selection.components,
    sources.components,
  );
  if (!components.ok) return components;
  return alignInstances(
    "domain",
    selection.root.id,
    selection.domains,
    sources.domains,
  );
}

export function previousContext(
  lock: ProfileLock,
): RuntimeResult<PreviousContext> {
  const entries = new Map<string, AcceptedSourceLockEntry>();
  for (const entry of lock.accepted_source_entries) {
    const key = entryKey(entry.kind, entry.source_id);
    if (entries.has(key)) {
      return failure(
        "PROFILE_PREVIOUS_SOURCE_DUPLICATE",
        `previous profile lock repeats accepted source ${key}`,
        key,
      );
    }
    entries.set(key, entry);
  }
  const projectEntries = lock.accepted_source_entries.filter(
    (entry) => entry.kind === "project",
  );
  const projectEntry = projectEntries[0];
  if (projectEntries.length !== 1 || projectEntry === undefined) {
    return failure(
      "PROFILE_PREVIOUS_SOURCE_LOCK_MISSING",
      "previous profile lock requires exactly one project source entry",
      "/previous/accepted_source_entries",
    );
  }
  return success({ lock, entries, project_entry: projectEntry });
}

function newApprovalRefs(
  next: readonly string[],
  previous: readonly string[],
): string[] {
  const prior = new Set(previous);
  return [...new Set(next.filter((reference) => !prior.has(reference)))].sort(
    compareUtf8,
  );
}

export function requireMigrationApproval(
  artifactKind: InstanceBindingArtifactKind,
  instanceId: string,
  next: readonly string[],
  previous: readonly string[],
): RuntimeResult<string[]> {
  const added = newApprovalRefs(next, previous);
  return added.length > 0
    ? success(added)
    : failure(
        "PROFILE_MIGRATION_APPROVAL_REQUIRED",
        `${artifactKind} ${instanceId} identity change requires a new accepted approval`,
        instanceId,
      );
}

function requirePreviousEntry(
  context: PreviousContext,
  kind: "component" | "domain" | "root-relationship",
  id: string,
): RuntimeResult<AcceptedSourceLockEntry> {
  const entry = context.entries.get(entryKey(kind, id));
  return entry === undefined
    ? failure(
        "PROFILE_PREVIOUS_SOURCE_LOCK_MISSING",
        `previous ${kind} ${id} has no accepted source lock entry`,
        id,
      )
    : success(entry);
}

export function validateRevision(
  id: string,
  previous: number,
  next: number,
  changed: boolean,
): RuntimeResult<true> {
  if (next < previous) {
    return failure(
      "PROFILE_SOURCE_REVISION_ROLLBACK",
      `${id} source revision moved backward`,
      id,
    );
  }
  if (changed && next <= previous) {
    return failure(
      "PROFILE_SOURCE_REVISION_REQUIRED",
      `${id} changed without incrementing its source revision`,
      id,
    );
  }
  return success(true);
}

export function addChange(
  changes: ReconciledInstanceChange[],
  kind: InstanceBindingChangeKind,
  artifactKind: InstanceBindingArtifactKind,
  instanceId: string,
  previousRevision: number | null,
  nextRevision: number | null,
  approvalRefs: readonly string[],
): void {
  changes.push({
    kind,
    artifact_kind: artifactKind,
    instance_id: instanceId,
    previous_revision: previousRevision,
    next_revision: nextRevision,
    approval_refs: [...approvalRefs].sort(compareUtf8),
  });
}

export function reconcileInstances(
  kind: "component" | "domain",
  previousRootId: string,
  bindings: readonly InstanceBinding[],
  sources: readonly InstanceSource[],
  previousValues: readonly ResolvedInstance[],
  context: PreviousContext,
  removalApprovals: readonly string[],
  changes: ReconciledInstanceChange[],
): RuntimeResult<true> {
  const currentSources = new Map(sources.map((source) => [source.id, source]));
  const previousById = new Map(
    previousValues.map((value) => [value.instance_id, value]),
  );
  for (const binding of bindings) {
    const source = currentSources.get(binding.instance_id);
    if (source === undefined) {
      return failure(
        "PROFILE_SOURCE_SELECTION_MISMATCH",
        `${kind} ${binding.instance_id} has no accepted source`,
        binding.instance_id,
      );
    }
    const previous = previousById.get(binding.instance_id);
    if (previous === undefined) {
      const approval = requireMigrationApproval(
        kind,
        binding.instance_id,
        source.approval_refs,
        [],
      );
      if (!approval.ok) return approval;
      addChange(
        changes,
        "added",
        kind,
        binding.instance_id,
        null,
        source.revision,
        approval.value,
      );
      continue;
    }
    const entry = requirePreviousEntry(context, kind, binding.instance_id);
    if (!entry.ok) return entry;
    const definitionChanged =
      previous.definition_id !== binding.definition.id ||
      previous.definition_version !== binding.definition.version;
    const parentChanged = previousRootId !== source.root_id;
    const slugChanged = previous.slug !== binding.slug;
    const revision = validateRevision(
      binding.instance_id,
      entry.value.revision,
      source.revision,
      definitionChanged || parentChanged || slugChanged,
    );
    if (!revision.ok) return revision;
    let migrationApprovals: string[] = [];
    if (definitionChanged || parentChanged) {
      const approval = requireMigrationApproval(
        kind,
        binding.instance_id,
        source.approval_refs,
        entry.value.approval_refs,
      );
      if (!approval.ok) return approval;
      migrationApprovals = approval.value;
    }
    if (definitionChanged) {
      addChange(
        changes,
        "definition-replaced",
        kind,
        binding.instance_id,
        entry.value.revision,
        source.revision,
        migrationApprovals,
      );
    }
    if (parentChanged) {
      addChange(
        changes,
        "parent-moved",
        kind,
        binding.instance_id,
        entry.value.revision,
        source.revision,
        migrationApprovals,
      );
    }
    if (slugChanged) {
      addChange(
        changes,
        "slug-changed",
        kind,
        binding.instance_id,
        entry.value.revision,
        source.revision,
        [],
      );
    }
  }
  const currentIds = new Set(bindings.map((binding) => binding.instance_id));
  for (const previous of previousValues) {
    if (currentIds.has(previous.instance_id)) continue;
    const entry = requirePreviousEntry(context, kind, previous.instance_id);
    if (!entry.ok) return entry;
    addChange(
      changes,
      "removed",
      kind,
      previous.instance_id,
      entry.value.revision,
      null,
      removalApprovals,
    );
  }
  return success(true);
}
