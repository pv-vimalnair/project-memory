import type { PlannedWrite } from "../contracts/planned-write.js";
import {
  canonicalMutationPlanHash,
} from "../contracts/canonical-mutation-plan.js";
import {
  failure,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import {
  decodeStrictUtf8,
  emitGeneratedYaml,
  parseYamlDocument,
} from "../core/document-io.js";
import { sha256 } from "../core/hash.js";
import { validateWithSchema } from "../schema/validate.js";
import {
  buildSelectedCatalogLock,
  SELECTED_CATALOG_LOCK_PATH,
} from "./build-selected-catalog-lock.js";
import { buildSelectedCatalogVendoring } from "./vendor-selected-catalog.js";
import {
  buildProfileLock,
  PROFILE_LOCK_PATH,
  PROJECT_SELECTION_PATH,
} from "./build-profile-lock.js";
import type {
  ResolvedCatalogSelection,
} from "./catalog-selection-resolver.js";
import { compareUtf8 } from "./catalog-selection-model.js";
import {
  ProjectSelectionSchema,
  ResolvedProfileSchema,
  validateProfileContractConsistency,
  type AcceptedProfileSourceSet,
  type ProfileCanonicalMutationPlan,
  type ProfileCompiler,
  type ProfileLock,
  type ProfileMutationMetadata,
  type ProfilePlanInput,
  type ProjectSelection,
  type ResolvedProfile,
  type SelectedCatalogLock,
} from "./contracts/index.js";
import { expandResolvedProfile } from "./expand-profile.js";
import { reconcileInstanceBindings } from "./instance-bindings.js";

export interface ProfileCatalogResolver {
  resolve(
    selection: ProjectSelection,
    releaseRoot: URL,
  ): Promise<RuntimeResult<ResolvedCatalogSelection>>;
}

export interface ProfileSourceRenderer {
  render(
    selection: ProjectSelection,
    sources: AcceptedProfileSourceSet,
    profile: ResolvedProfile,
  ): RuntimeResult<readonly PlannedWrite[]>;
}

export interface ProfileArtifactRenderInput {
  readonly selection: ProjectSelection;
  readonly sources: AcceptedProfileSourceSet;
  readonly profile: ResolvedProfile;
  readonly selected_catalog_lock: SelectedCatalogLock;
  readonly profile_lock: ProfileLock;
}

export interface ProfileArtifactRenderer {
  render(input: ProfileArtifactRenderInput): RuntimeResult<readonly PlannedWrite[]>;
}

export interface ProfileTargetReader {
  read(
    root: URL,
    relativePath: string,
  ): Promise<RuntimeResult<Uint8Array | null>>;
}

export interface ProfilePlanningDependencies {
  readonly catalog: ProfileCatalogResolver;
  readonly source_renderer: ProfileSourceRenderer;
  readonly artifact_renderer: ProfileArtifactRenderer;
  readonly target_reader: ProfileTargetReader;
}

interface ParsedPlanningInput {
  readonly selection: ProjectSelection;
  readonly project_hash: string;
}

function sortedWarnings(values: readonly RuntimeIssue[]): RuntimeIssue[] {
  return [...values].sort((left, right) =>
    compareUtf8(
      `${left.code}:${left.path}:${left.message}:${left.references.join("\u0000")}`,
      `${right.code}:${right.path}:${right.message}:${right.references.join("\u0000")}`,
    ),
  );
}

function parsePlanningInput(bytes: Uint8Array): RuntimeResult<ParsedPlanningInput> {
  const decoded = decodeStrictUtf8(bytes, PROJECT_SELECTION_PATH);
  if (!decoded.ok) return { ok: false, issues: decoded.issues };
  const parsed = parseYamlDocument(decoded.value, PROJECT_SELECTION_PATH);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const selection = validateWithSchema<ProjectSelection>(
    ProjectSelectionSchema.$id,
    parsed.value,
  );
  if (!selection.ok) return { ok: false, issues: selection.issues };
  return success({ selection: selection.value, project_hash: sha256(bytes) });
}

function validateMutationApprovalScope(
  input: ProfilePlanInput,
  selection: ProjectSelection,
): RuntimeResult<true> {
  const expected =
    input.previous_profile_lock === null
      ? "profile.bootstrap"
      : "profile.evolution";
  const approval = input.approval_records.find(
    (record) => record.id === selection.acceptance.approval_id,
  );
  return approval?.scope === expected
    ? success(true)
    : failure(
        "PROFILE_APPROVAL_SCOPE_MISMATCH",
        `profile plan requires a ${expected} approval`,
        selection.acceptance.approval_id,
      );
}
function dynamicTruthPath(relativePath: string): boolean {
  if (relativePath.startsWith("docs/project-memory/views/")) return true;
  const dynamicRoots = [
    "docs/project-memory/initiatives/",
    "docs/project-memory/workstreams/",
    "docs/project-memory/records/",
    "docs/project-memory/governance/",
    "docs/project-memory/archive/",
  ];
  return (
    dynamicRoots.some((root) => relativePath.startsWith(root)) &&
    !relativePath.endsWith("/.gitkeep")
  );
}

function normalizedPath(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function validateDraftWrites(
  values: readonly PlannedWrite[],
): RuntimeResult<PlannedWrite[]> {
  const seen = new Set<string>();
  const writes: PlannedWrite[] = [];
  for (const write of values) {
    const key = normalizedPath(write.relative_path);
    if (seen.has(key)) {
      return failure(
        "PROFILE_WRITE_DUPLICATE",
        `profile plan repeats target path ${write.relative_path}`,
        write.relative_path,
      );
    }
    seen.add(key);
    if (dynamicTruthPath(write.relative_path)) {
      return failure(
        "PROFILE_DYNAMIC_TRUTH_FORBIDDEN",
        "profile compiler cannot plan dynamic work, record, archive, or view truth",
        write.relative_path,
      );
    }
    if (write.expected_existing_sha256 !== null) {
      return failure(
        "PROFILE_DRAFT_PREIMAGE_FORBIDDEN",
        "renderers cannot supply target pre-image hashes",
        write.relative_path,
      );
    }
    writes.push(write);
  }
  return success(
    writes.sort((left, right) =>
      compareUtf8(left.relative_path, right.relative_path),
    ),
  );
}

async function pinPreimages(
  root: URL,
  drafts: readonly PlannedWrite[],
  reader: ProfileTargetReader,
): Promise<RuntimeResult<PlannedWrite[]>> {
  const writes: PlannedWrite[] = [];
  const warnings: RuntimeIssue[] = [];
  for (const draft of drafts) {
    const current = await reader.read(root, draft.relative_path);
    if (!current.ok) return { ok: false, issues: current.issues };
    warnings.push(...current.warnings);
    if (draft.mode === "create" && current.value !== null) {
      return failure(
        "PROFILE_WRITE_COLLISION",
        "create-only compiler output collides with an existing path",
        draft.relative_path,
      );
    }
    if (draft.mode === "replace" && current.value === null) {
      return failure(
        "PROFILE_WRITE_TARGET_MISSING",
        "replace-only compiler output has no existing target",
        draft.relative_path,
      );
    }
    writes.push({
      ...draft,
      expected_existing_sha256:
        current.value === null ? null : sha256(current.value),
    });
  }
  return success(writes, warnings);
}

function lockWrites(
  selectedCatalogLock: SelectedCatalogLock,
  profileLock: ProfileLock,
): RuntimeResult<PlannedWrite[]> {
  const yaml = emitGeneratedYaml(profileLock);
  if (!yaml.ok) return { ok: false, issues: yaml.issues };
  return success([
    {
      relative_path: SELECTED_CATALOG_LOCK_PATH,
      bytes: new TextEncoder().encode(canonicalJson(selectedCatalogLock)),
      expected_existing_sha256: null,
      mode: "create_or_replace",
    },
    {
      relative_path: PROFILE_LOCK_PATH,
      bytes: new TextEncoder().encode(yaml.value),
      expected_existing_sha256: null,
      mode: "create_or_replace",
    },
  ]);
}

function projectSelectionWrite(input: ProfilePlanInput): PlannedWrite {
  return {
    relative_path: PROJECT_SELECTION_PATH,
    bytes: input.project_yaml,
    expected_existing_sha256: null,
    mode: "create_or_replace",
  };
}

function withAcceptedRelationships(
  profile: ResolvedProfile,
  relationships: ResolvedProfile["root_relationships"],
): RuntimeResult<ResolvedProfile> {
  return validateWithSchema<ResolvedProfile>(ResolvedProfileSchema.$id, {
    ...profile,
    root_relationships: [...relationships],
  });
}

export async function buildProfileMutationPlan(
  input: ProfilePlanInput,
  dependencies: ProfilePlanningDependencies,
): Promise<RuntimeResult<ProfileCanonicalMutationPlan>> {
  const warnings: RuntimeIssue[] = [];
  const parsed = parsePlanningInput(input.project_yaml);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  warnings.push(...parsed.warnings);
  const consistent = validateProfileContractConsistency(
    parsed.value.selection,
    input.accepted_sources,
    input.approval_records,
  );
  if (!consistent.ok) return { ok: false, issues: consistent.issues };
  warnings.push(...consistent.warnings);
  const approvalScope = validateMutationApprovalScope(input, parsed.value.selection);
  if (!approvalScope.ok) return { ok: false, issues: approvalScope.issues };
  warnings.push(...approvalScope.warnings);
  const reconciled = reconcileInstanceBindings(
    input.previous_profile_lock,
    parsed.value.selection,
    input.accepted_sources,
  );
  if (!reconciled.ok) return { ok: false, issues: reconciled.issues };
  warnings.push(...reconciled.warnings);
  const catalog = await dependencies.catalog.resolve(
    parsed.value.selection,
    input.catalog_release_root,
  );
  if (!catalog.ok) return { ok: false, issues: catalog.issues };
  warnings.push(...catalog.warnings);
  const expanded = expandResolvedProfile(parsed.value.selection, catalog.value);
  if (!expanded.ok) return { ok: false, issues: expanded.issues };
  warnings.push(...expanded.warnings);
  const profile = withAcceptedRelationships(
    expanded.value,
    reconciled.value.relationships,
  );
  if (!profile.ok) return { ok: false, issues: profile.issues };
  warnings.push(...profile.warnings);
  const selectedCatalogLock = buildSelectedCatalogLock(catalog.value);
  if (!selectedCatalogLock.ok) {
    return { ok: false, issues: selectedCatalogLock.issues };
  }
  warnings.push(...selectedCatalogLock.warnings);
  const catalogWrites = buildSelectedCatalogVendoring(
    catalog.value,
    selectedCatalogLock.value,
  );
  if (!catalogWrites.ok) return { ok: false, issues: catalogWrites.issues };
  warnings.push(...catalogWrites.warnings);
  const sourceWrites = dependencies.source_renderer.render(
    parsed.value.selection,
    input.accepted_sources,
    profile.value,
  );
  if (!sourceWrites.ok) return { ok: false, issues: sourceWrites.issues };
  warnings.push(...sourceWrites.warnings);
  const profileLock = buildProfileLock({
    selection: parsed.value.selection,
    accepted_sources: input.accepted_sources,
    profile: profile.value,
    selected_catalog_lock: selectedCatalogLock.value,
    source_writes: sourceWrites.value,
    project_hash: parsed.value.project_hash,
    previous_profile_lock: input.previous_profile_lock,
  });
  if (!profileLock.ok) return { ok: false, issues: profileLock.issues };
  warnings.push(...profileLock.warnings);
  const artifacts = dependencies.artifact_renderer.render({
    selection: parsed.value.selection,
    sources: input.accepted_sources,
    profile: profile.value,
    selected_catalog_lock: selectedCatalogLock.value,
    profile_lock: profileLock.value,
  });
  if (!artifacts.ok) return { ok: false, issues: artifacts.issues };
  warnings.push(...artifacts.warnings);
  const generatedLocks = lockWrites(selectedCatalogLock.value, profileLock.value);
  if (!generatedLocks.ok) return { ok: false, issues: generatedLocks.issues };
  warnings.push(...generatedLocks.warnings);
  const drafts = validateDraftWrites([
    projectSelectionWrite(input),
    ...catalogWrites.value,
    ...sourceWrites.value,
    ...generatedLocks.value,
    ...artifacts.value,
  ]);
  if (!drafts.ok) return { ok: false, issues: drafts.issues };
  const pinned = await pinPreimages(
    input.target_root,
    drafts.value,
    dependencies.target_reader,
  );
  if (!pinned.ok) return { ok: false, issues: pinned.issues };
  warnings.push(...pinned.warnings);

  const metadata: ProfileMutationMetadata = {
    project_hash: parsed.value.project_hash,
    profile: profile.value,
    selected_catalog_lock: selectedCatalogLock.value,
    profile_lock: profileLock.value,
  };
  const withoutHash: Omit<ProfileCanonicalMutationPlan, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: input.plan_id,
    mutation_kind:
      input.previous_profile_lock === null
        ? "profile.bootstrap"
        : "profile.evolution",
    root_id: parsed.value.selection.root.id,
    target_ref: input.target_ref,
    expected_head: input.expected_head,
    profile_lock_hash: profileLock.value.lock_hash,
    writes: pinned.value,
    record_ids: [],
    event_ids: [],
    approval_ids: [...new Set(input.approval_records.map((record) => record.id))].sort(
      compareUtf8,
    ),
    evidence_ids: [],
    created_by: input.created_by,
    created_at: input.created_at,
    expires_at: input.expires_at,
    metadata,
  };
  const plan: ProfileCanonicalMutationPlan = {
    ...withoutHash,
    plan_hash: canonicalMutationPlanHash(withoutHash),
  };
  return success(plan, sortedWarnings(warnings));
}

export function profileCompilerFromDependencies(
  dependencies: ProfilePlanningDependencies,
): ProfileCompiler {
  return {
    plan: (input) => buildProfileMutationPlan(input, dependencies),
  };
}
