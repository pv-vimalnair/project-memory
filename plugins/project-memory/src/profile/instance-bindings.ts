import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { compareUtf8 } from "./catalog-selection-model.js";
import type {
  AcceptedProfileSourceSet,
  ProfileLock,
  ProjectSelection,
} from "./contracts/index.js";
import {
  addChange,
  previousContext,
  reconcileInstances,
  requireMigrationApproval,
  validateRevision,
  validateSelectionSources,
  validateStableIds,
  type ReconciledInstanceBindings,
  type ReconciledInstanceChange,
} from "./instance-binding-core.js";
import {
  reconcileRelationships,
  validateAndSortRelationships,
} from "./instance-binding-relationships.js";

export type {
  InstanceBindingArtifactKind,
  InstanceBindingChangeKind,
  ReconciledInstanceBindings,
  ReconciledInstanceChange,
} from "./instance-binding-core.js";

function hasRemovedIdentity(
  previous: ProfileLock,
  componentIds: ReadonlySet<string>,
  domainIds: ReadonlySet<string>,
  relationshipIds: ReadonlySet<string>,
): boolean {
  return (
    previous.profile.components.some(
      (binding) => !componentIds.has(binding.instance_id),
    ) ||
    previous.profile.domains.some(
      (binding) => !domainIds.has(binding.instance_id),
    ) ||
    previous.profile.root_relationships.some(
      (record) => !relationshipIds.has(record.relationship_id),
    )
  );
}

function sortedBindings(selection: ProjectSelection): {
  readonly components: ProjectSelection["components"];
  readonly domains: ProjectSelection["domains"];
} {
  return {
    components: [...selection.components].sort((left, right) =>
      compareUtf8(left.instance_id, right.instance_id),
    ),
    domains: [...selection.domains].sort((left, right) =>
      compareUtf8(left.instance_id, right.instance_id),
    ),
  };
}

export function reconcileInstanceBindings(
  previous: ProfileLock | null,
  selection: ProjectSelection,
  acceptedSources: AcceptedProfileSourceSet,
): RuntimeResult<ReconciledInstanceBindings> {
  const stableIds = validateStableIds(selection, acceptedSources);
  if (!stableIds.ok) return { ok: false, issues: stableIds.issues };
  const aligned = validateSelectionSources(selection, acceptedSources);
  if (!aligned.ok) return { ok: false, issues: aligned.issues };
  const relationships = validateAndSortRelationships(
    selection,
    acceptedSources.root_relationships,
  );
  if (!relationships.ok) return { ok: false, issues: relationships.issues };
  const sorted = sortedBindings(selection);
  if (previous === null) {
    return success({
      root: {
        instance_id: selection.root.id,
        namespace: selection.root.namespace,
        source_revision: acceptedSources.project.revision,
      },
      components: sorted.components,
      domains: sorted.domains,
      relationships: relationships.value,
      changes: [],
    });
  }

  const context = previousContext(previous);
  if (!context.ok) return { ok: false, issues: context.issues };
  const rootChanged =
    previous.profile.root.id !== selection.root.id ||
    previous.profile.root.namespace !== selection.root.namespace;
  const projectRevision = validateRevision(
    selection.root.id,
    context.value.project_entry.revision,
    acceptedSources.project.revision,
    rootChanged,
  );
  if (!projectRevision.ok) {
    return { ok: false, issues: projectRevision.issues };
  }

  const changes: ReconciledInstanceChange[] = [];
  let rootMigrationApprovals: string[] = [];
  if (rootChanged) {
    const approval = requireMigrationApproval(
      "root",
      selection.root.id,
      acceptedSources.project.approval_refs,
      context.value.project_entry.approval_refs,
    );
    if (!approval.ok) return { ok: false, issues: approval.issues };
    rootMigrationApprovals = approval.value;
    addChange(
      changes,
      "root-address-changed",
      "root",
      selection.root.id,
      context.value.project_entry.revision,
      acceptedSources.project.revision,
      approval.value,
    );
  }
  const removalApproval = requireMigrationApproval(
    "root",
    selection.root.id,
    acceptedSources.project.approval_refs,
    context.value.project_entry.approval_refs,
  );
  const removalApprovals = removalApproval.ok
    ? removalApproval.value
    : rootMigrationApprovals;

  const components = reconcileInstances(
    "component",
    previous.profile.root.id,
    sorted.components,
    acceptedSources.components,
    previous.profile.components,
    context.value,
    removalApprovals,
    changes,
  );
  if (!components.ok) return { ok: false, issues: components.issues };
  const domains = reconcileInstances(
    "domain",
    previous.profile.root.id,
    sorted.domains,
    acceptedSources.domains,
    previous.profile.domains,
    context.value,
    removalApprovals,
    changes,
  );
  if (!domains.ok) return { ok: false, issues: domains.issues };

  const componentIds = new Set(
    sorted.components.map((binding) => binding.instance_id),
  );
  const domainIds = new Set(
    sorted.domains.map((binding) => binding.instance_id),
  );
  const relationshipIds = new Set(
    relationships.value.map((record) => record.relationship_id),
  );
  if (
    hasRemovedIdentity(previous, componentIds, domainIds, relationshipIds) &&
    removalApprovals.length === 0
  ) {
    return failure(
      "PROFILE_MIGRATION_APPROVAL_REQUIRED",
      "removing a persistent instance requires a new project approval",
      selection.root.id,
    );
  }
  const relationshipResult = reconcileRelationships(
    relationships.value,
    context.value,
    removalApprovals,
    changes,
  );
  if (!relationshipResult.ok) {
    return { ok: false, issues: relationshipResult.issues };
  }
  changes.sort((left, right) =>
    compareUtf8(
      `${left.artifact_kind}:${left.instance_id}:${left.kind}`,
      `${right.artifact_kind}:${right.instance_id}:${right.kind}`,
    ),
  );
  return success({
    root: {
      instance_id: selection.root.id,
      namespace: selection.root.namespace,
      source_revision: acceptedSources.project.revision,
    },
    components: sorted.components,
    domains: sorted.domains,
    relationships: relationships.value,
    changes,
  });
}
