import {
  canonicalMutationPlanHash,
  failure,
  sha256,
  success,
  type CanonicalMutationPlan,
  type Clock,
  type PlannedWrite,
  type RuntimeResult,
} from "../../index.js";

import type { GeneratedViewMetadata } from "../contracts/index.js";
import type { CanonicalSnapshot } from "../snapshot/snapshot-contracts.js";
import { renderChangelog } from "./render-changelog.js";
import { renderHandoff } from "./render-handoff.js";
import { renderHistory } from "./render-history.js";
import { renderIndex } from "./render-index.js";
import { renderNow } from "./render-now.js";
import { renderWorkstreams } from "./render-workstreams.js";
import {
  FilesystemViewTargetReader,
  verifyViewDrift,
  type ViewDriftReport,
  type ViewSnapshotProvider,
  type ViewTargetReader,
} from "./view-drift.js";
import {
  sourceSetHash,
  type ViewRenderContext,
  type ViewRenderMetadata,
} from "./view-rendering.js";

export const GENERATED_VIEW_PATHS = Object.freeze([
  "docs/project-memory/views/CHANGELOG.md",
  "docs/project-memory/views/HANDOFF.md",
  "docs/project-memory/views/HISTORY.md",
  "docs/project-memory/views/INDEX.json",
  "docs/project-memory/views/NOW.md",
  "docs/project-memory/views/WORKSTREAMS.md",
] as const);

type ViewId = GeneratedViewMetadata["view_id"];

interface ViewDefinition {
  readonly id: ViewId;
  readonly relative_path: (typeof GENERATED_VIEW_PATHS)[number];
  readonly render: (context: ViewRenderContext) => string;
}

const VIEW_DEFINITIONS: readonly ViewDefinition[] = Object.freeze([
  { id: "changelog", relative_path: GENERATED_VIEW_PATHS[0], render: renderChangelog },
  { id: "handoff", relative_path: GENERATED_VIEW_PATHS[1], render: renderHandoff },
  { id: "history", relative_path: GENERATED_VIEW_PATHS[2], render: renderHistory },
  { id: "index", relative_path: GENERATED_VIEW_PATHS[3], render: renderIndex },
  { id: "now", relative_path: GENERATED_VIEW_PATHS[4], render: renderNow },
  {
    id: "workstreams",
    relative_path: GENERATED_VIEW_PATHS[5],
    render: renderWorkstreams,
  },
]);

export interface ViewMutationMetadata {
  readonly governance_kind: "views";
  readonly source_revision: string;
  readonly source_set_hash: string;
  readonly generated_views: readonly GeneratedViewMetadata[];
}

export type GeneratedViewPlan = CanonicalMutationPlan<ViewMutationMetadata>;

export interface ViewGenerator {
  plan(snapshot: CanonicalSnapshot): RuntimeResult<GeneratedViewPlan>;
  verify(root: URL): Promise<RuntimeResult<ViewDriftReport>>;
}

export interface ViewGeneratorDependencies {
  readonly clock: Clock;
  readonly snapshots: ViewSnapshotProvider;
  readonly targets?: ViewTargetReader;
  readonly target_ref?: string;
  readonly created_by?: string;
}

interface PlanOptions {
  readonly target_ref: string;
  readonly created_by: string;
}

const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function contextFor(
  snapshot: CanonicalSnapshot,
  generatedAt: string,
): RuntimeResult<ViewRenderContext> {
  const catalogVersion = snapshot.catalog_versions[0];
  if (
    catalogVersion === undefined ||
    !UTC_TIMESTAMP.test(generatedAt) ||
    !/^[0-9a-f]{40}$/.test(snapshot.source_revision) ||
    !/^[0-9a-f]{64}$/.test(snapshot.profile_lock_hash) ||
    !/^[0-9a-f]{64}$/.test(snapshot.selected_catalog_lock_hash)
  ) {
    return failure(
      "view.snapshot_invalid",
      "view generation requires exact source, profile, catalog, and timestamp bindings",
      snapshot.root_id,
    );
  }
  const metadata: ViewRenderMetadata = {
    source_revision: snapshot.source_revision,
    profile_version: snapshot.profile_lock.schema_version,
    profile_lock_hash: snapshot.profile_lock_hash,
    catalog_version: catalogVersion,
    catalog_lock_hash: snapshot.selected_catalog_lock_hash,
    source_set_hash: sourceSetHash(snapshot),
    generated_at: generatedAt,
  };
  return success({ snapshot, metadata });
}

export function planGeneratedViewsAt(
  snapshot: CanonicalSnapshot,
  generatedAt: string,
  options: PlanOptions = {
    target_ref: "refs/heads/main",
    created_by: "view-generator",
  },
): RuntimeResult<GeneratedViewPlan> {
  const context = contextFor(snapshot, generatedAt);
  if (!context.ok) return context;
  const writes: PlannedWrite[] = [];
  const metadata: GeneratedViewMetadata[] = [];
  for (const definition of VIEW_DEFINITIONS) {
    const bytes = new TextEncoder().encode(definition.render(context.value));
    writes.push({
      relative_path: definition.relative_path,
      bytes,
      expected_existing_sha256: null,
      mode: "create_or_replace",
    });
    metadata.push({
      schema_version: "1.0.0",
      view_id: definition.id,
      relative_path: definition.relative_path,
      ...context.value.metadata,
      content_hash: sha256(bytes),
    });
  }
  const expiresAt = new Date(new Date(generatedAt).getTime() + 5 * 60 * 1000).toISOString();
  const withoutHash: Omit<GeneratedViewPlan, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: `views:${snapshot.root_id}:${context.value.metadata.source_set_hash.slice(0, 12)}`,
    mutation_kind: "view",
    root_id: snapshot.root_id,
    target_ref: options.target_ref,
    expected_head: snapshot.source_revision,
    profile_lock_hash: snapshot.profile_lock_hash,
    writes,
    record_ids: [],
    event_ids: [],
    approval_ids: snapshot.approvals.map((record) => record.id).sort(),
    evidence_ids: [],
    created_by: options.created_by,
    created_at: generatedAt,
    expires_at: expiresAt,
    metadata: {
      governance_kind: "views",
      source_revision: snapshot.source_revision,
      source_set_hash: context.value.metadata.source_set_hash,
      generated_views: metadata,
    },
  };
  return success({
    ...withoutHash,
    plan_hash: canonicalMutationPlanHash(withoutHash),
  });
}

export function createViewGenerator(
  dependencies: ViewGeneratorDependencies,
): ViewGenerator {
  const options: PlanOptions = {
    target_ref: dependencies.target_ref ?? "refs/heads/main",
    created_by: dependencies.created_by ?? "view-generator",
  };
  const targets = dependencies.targets ?? new FilesystemViewTargetReader();
  const planAt = (snapshot: CanonicalSnapshot, generatedAt: string) =>
    planGeneratedViewsAt(snapshot, generatedAt, options);
  return {
    plan(snapshot) {
      return planAt(snapshot, dependencies.clock.now().toISOString());
    },
    verify(root) {
      return verifyViewDrift(
        root,
        GENERATED_VIEW_PATHS,
        dependencies.snapshots,
        targets,
        planAt,
      );
    },
  };
}
