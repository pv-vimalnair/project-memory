import {
  canonicalJson,
  failure,
  sha256,
  success,
  type RuntimeResult,
} from "../../index.js";
import type { CanonicalSnapshot } from "../snapshot/snapshot-contracts.js";
import {
  GENERATED_VIEW_PATHS,
  type GeneratedViewPlan,
} from "../views/generate-views.js";
import { sourceSetHash } from "../views/view-rendering.js";
import { validateCanonicalMutationPlan } from "./canonical-mutation-validation.js";
import type { PendingIntegration } from "./single-repo-contracts.js";

export interface BoundViewPlanIdentity {
  readonly root_id: string;
  readonly target_ref: string;
  readonly profile_lock_hash: string;
  readonly task_id: string;
}

const VIEW_ID_BY_PATH: Readonly<Record<string, string>> = Object.freeze({
  [GENERATED_VIEW_PATHS[0]]: "changelog",
  [GENERATED_VIEW_PATHS[1]]: "handoff",
  [GENERATED_VIEW_PATHS[2]]: "history",
  [GENERATED_VIEW_PATHS[3]]: "index",
  [GENERATED_VIEW_PATHS[4]]: "now",
  [GENERATED_VIEW_PATHS[5]]: "workstreams",
});

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson([...left].sort(compareUtf8)) ===
    canonicalJson([...right].sort(compareUtf8));
}

export function validateBoundViewPlan(
  plan: GeneratedViewPlan,
  binding: BoundViewPlanIdentity,
  snapshot: CanonicalSnapshot,
  sourceTree: string,
  now: Date,
): RuntimeResult<true> {
  const valid = validateCanonicalMutationPlan(plan, now);
  if (!valid.ok) return valid;
  const expectedPaths = [...GENERATED_VIEW_PATHS].sort(compareUtf8);
  const paths = plan.writes.map((write) => write.relative_path).sort(compareUtf8);
  const catalogVersion = snapshot.catalog_versions[0];
  const sourceHash = sourceSetHash(snapshot);
  if (
    catalogVersion === undefined ||
    plan.mutation_kind !== "view" ||
    plan.root_id !== binding.root_id ||
    plan.target_ref !== binding.target_ref ||
    plan.expected_head !== sourceTree ||
    plan.profile_lock_hash !== binding.profile_lock_hash ||
    plan.plan_id !== `views:${snapshot.root_id}:${sourceHash.slice(0, 12)}` ||
    plan.metadata.source_revision !== sourceTree ||
    plan.metadata.source_set_hash !== sourceHash ||
    !sameStrings(paths, expectedPaths) ||
    plan.metadata.generated_views.length !== expectedPaths.length ||
    plan.record_ids.length !== 0 ||
    plan.event_ids.length !== 0 ||
    plan.evidence_ids.length !== 0 ||
    !sameStrings(
      plan.approval_ids,
      snapshot.approvals.map((record) => record.id),
    )
  ) {
    return failure(
      "integration.view_plan_drift",
      "generated views must bind the exact pre-view integration snapshot",
      binding.task_id,
    );
  }

  const metadata = new Map(
    plan.metadata.generated_views.map((entry) => [entry.relative_path, entry]),
  );
  if (metadata.size !== expectedPaths.length) {
    return failure(
      "integration.view_plan_drift",
      "generated view metadata paths must be unique and complete",
      binding.task_id,
    );
  }
  for (const write of plan.writes) {
    const entry = metadata.get(write.relative_path);
    if (
      entry === undefined ||
      entry.view_id !== VIEW_ID_BY_PATH[write.relative_path] ||
      entry.source_revision !== sourceTree ||
      entry.profile_version !== snapshot.profile_lock.schema_version ||
      entry.profile_lock_hash !== snapshot.profile_lock_hash ||
      entry.catalog_version !== catalogVersion ||
      entry.catalog_lock_hash !== snapshot.selected_catalog_lock_hash ||
      entry.source_set_hash !== sourceHash ||
      entry.generated_at !== plan.created_at ||
      entry.content_hash !== sha256(write.bytes) ||
      write.mode !== "create_or_replace" ||
      write.expected_existing_sha256 !== null
    ) {
      return failure(
        "integration.view_plan_drift",
        "generated view bytes and metadata must match their deterministic source",
        write.relative_path,
      );
    }
  }
  return success(true);
}

export function validateSingleRepoViewPlan(
  plan: GeneratedViewPlan,
  pending: PendingIntegration,
  snapshot: CanonicalSnapshot,
  sourceTree: string,
  now: Date,
): RuntimeResult<true> {
  return validateBoundViewPlan(plan, {
    root_id: pending.input.task_packet.root.id,
    target_ref: pending.input.target_ref,
    profile_lock_hash: pending.input.task_packet.root.profile_lock_hash,
    task_id: pending.input.task_packet.task_id,
  }, snapshot, sourceTree, now);
}
