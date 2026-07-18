import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import type {
  AcceptedSourceLockEntry,
  ProjectSelection,
  RootAddress,
  RootRelationshipSourceData,
} from "./contracts/index.js";
import {
  addChange,
  requireMigrationApproval,
  validateRevision,
  type PreviousContext,
  type ReconciledInstanceChange,
} from "./instance-binding-core.js";
import { validateRootRelationships } from "./validate-root-ownership.js";

function localRelationshipRoot(
  record: RootRelationshipSourceData,
): RootAddress {
  switch (record.kind) {
    case "portfolio-child":
      return record.portfolio;
    case "shared-platform-provider":
      return record.provider;
    case "shared-platform-consumer":
      return record.consumer;
  }
}

function relationshipAddressValue(record: RootRelationshipSourceData): unknown {
  switch (record.kind) {
    case "portfolio-child":
      return { kind: record.kind, portfolio: record.portfolio, child: record.child };
    case "shared-platform-provider":
      return {
        kind: record.kind,
        provider: record.provider,
        consumer: record.consumer,
        interface_roots: record.interface_refs.map((reference) => reference.root),
      };
    case "shared-platform-consumer":
      return {
        kind: record.kind,
        consumer: record.consumer,
        provider: record.provider,
        interface_roots: record.provider_interface_refs.map(
          (reference) => reference.root,
        ),
      };
  }
}

function previousRelationshipEntry(
  context: PreviousContext,
  id: string,
): RuntimeResult<AcceptedSourceLockEntry> {
  const entry = context.entries.get(`root-relationship:${id}`);
  return entry === undefined
    ? failure(
        "PROFILE_PREVIOUS_SOURCE_LOCK_MISSING",
        `previous root-relationship ${id} has no accepted source lock entry`,
        id,
      )
    : success(entry);
}

export function validateAndSortRelationships(
  selection: ProjectSelection,
  records: readonly RootRelationshipSourceData[],
): RuntimeResult<RootRelationshipSourceData[]> {
  if (records.length === 0) return success([]);
  const first = records[0];
  if (first === undefined) return success([]);
  const local = localRelationshipRoot(first);
  if (
    local.root_id !== selection.root.id ||
    local.namespace !== selection.root.namespace
  ) {
    return failure(
      "ROOT_RELATIONSHIP_LOCAL_ROOT_MISMATCH",
      "relationship local root does not match the selected root identity",
      selection.root.id,
    );
  }
  const validated = validateRootRelationships(local, records);
  return validated.ok
    ? success(validated.value.records)
    : { ok: false, issues: validated.issues };
}

export function reconcileRelationships(
  current: readonly RootRelationshipSourceData[],
  context: PreviousContext,
  removalApprovals: readonly string[],
  changes: ReconciledInstanceChange[],
): RuntimeResult<true> {
  const previousById = new Map(
    context.lock.profile.root_relationships.map((record) => [
      record.relationship_id,
      record,
    ]),
  );
  for (const record of current) {
    const previous = previousById.get(record.relationship_id);
    if (previous === undefined) {
      const approval = requireMigrationApproval(
        "root-relationship",
        record.relationship_id,
        record.approval_refs,
        [],
      );
      if (!approval.ok) return approval;
      addChange(
        changes,
        "added",
        "root-relationship",
        record.relationship_id,
        null,
        record.revision,
        approval.value,
      );
      continue;
    }
    const entry = previousRelationshipEntry(context, record.relationship_id);
    if (!entry.ok) return entry;
    const contentChanged = canonicalJson(previous) !== canonicalJson(record);
    const addressChanged =
      canonicalJson(relationshipAddressValue(previous)) !==
      canonicalJson(relationshipAddressValue(record));
    const revision = validateRevision(
      record.relationship_id,
      entry.value.revision,
      record.revision,
      contentChanged,
    );
    if (!revision.ok) return revision;
    if (addressChanged) {
      const approval = requireMigrationApproval(
        "root-relationship",
        record.relationship_id,
        record.approval_refs,
        entry.value.approval_refs,
      );
      if (!approval.ok) return approval;
      addChange(
        changes,
        "relationship-address-changed",
        "root-relationship",
        record.relationship_id,
        entry.value.revision,
        record.revision,
        approval.value,
      );
    }
  }
  const currentIds = new Set(current.map((record) => record.relationship_id));
  for (const previous of context.lock.profile.root_relationships) {
    if (currentIds.has(previous.relationship_id)) continue;
    const entry = previousRelationshipEntry(context, previous.relationship_id);
    if (!entry.ok) return entry;
    addChange(
      changes,
      "removed",
      "root-relationship",
      previous.relationship_id,
      entry.value.revision,
      null,
      removalApprovals,
    );
  }
  return success(true);
}
