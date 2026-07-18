import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyFileTransaction, canonicalJson, decodeStrictUtf8, failure, isSameOrChildPath, parseJsonDocument, sha256, success, validateWithSchema, type Clock, type RuntimeResult } from "../../index.js";
import type { CompletionPacket, TaskPacket } from "../../planning/types.js";
import { archiveManifestPath } from "../archive/content-addressed-archive.js";
import type { ArchiveManifest, GateEvidence, PreparedSatellite } from "../contracts/index.js";
import type { CanonicalSnapshotBuilder } from "../snapshot/snapshot-contracts.js";
import { GENERATED_VIEW_PATHS } from "../views/generate-views.js";
import type { IntegrationGitClient } from "./integration-git-client.js";
import { effectiveClaimFromSnapshot, validateEmbeddedTask } from "./single-repo-validation.js";
const REVISION = /^[0-9a-f]{40}$/;
const ZERO_REVISION = "0".repeat(40);
function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}
function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}
function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}
type PreparedCore = Omit<PreparedSatellite, "manifest_hash" | "manifest_ref">;
export function preparedManifestHash(value: PreparedSatellite | PreparedCore): string {
  const core = { ...value } as Record<string, unknown>;
  delete core.manifest_hash;
  delete core.manifest_ref;
  return sha256(canonicalJson(core));
}
export function preparedManifestRef(value: {
  readonly packet_id: string;
  readonly manifest_hash: string;
}): string {
  return `refs/project-memory/prepared/${value.packet_id}/${value.manifest_hash}`;
}
export function preparedManifestPath(value: {
  readonly packet_id: string;
  readonly manifest_hash: string;
}): string {
  return `docs/project-memory/governance/integration/prepared/${value.packet_id}/${value.manifest_hash}.json`;
}
export interface SatelliteBindingInput {
  readonly repo: URL;
  readonly repository_id: string;
  readonly integration_base_revision: string;
  readonly work_commit_hash: string;
  readonly task_packet: TaskPacket;
  readonly completion_packet: CompletionPacket;
  readonly profile_version: string;
  readonly catalog_lock_hash: string;
  readonly gate_evidence: readonly GateEvidence[];
  readonly archive_manifest_hashes: readonly string[];
  readonly audit_evidence_id: string;
  readonly prepared_by: string;
}
export type PrepareSatelliteInput = SatelliteBindingInput;
export interface VerifySatelliteInput extends SatelliteBindingInput {
  readonly prepared: PreparedSatellite;
}
export interface SatellitePreparer {
  prepareSatellite(input: PrepareSatelliteInput): Promise<RuntimeResult<PreparedSatellite>>;
  verifySatellite(input: VerifySatelliteInput): Promise<RuntimeResult<PreparedSatellite>>;
}
export interface SatellitePreparerDependencies {
  readonly clock: Clock;
  readonly git: IntegrationGitClient;
  readonly snapshots: CanonicalSnapshotBuilder;
  readonly temporary_root: URL;
}
function gateBindings(
  input: SatelliteBindingInput,
  now: Date,
): RuntimeResult<{ readonly hashes: readonly string[]; readonly evidence: readonly string[] }> {
  const byId = new Map(input.gate_evidence.map((gate) => [gate.gate_id, gate]));
  if (byId.size !== input.task_packet.gates.length) {
    return failure("satellite.gate_set_drift", "satellite requires one exact result per task gate");
  }
  const hashes: string[] = [];
  const evidenceIds: string[] = [];
  for (const gate of input.task_packet.gates) {
    const actual = byId.get(gate.id);
    const check = input.completion_packet.checks.find((value) => value.gate_id === gate.id);
    if (actual === undefined || check === undefined) {
      return failure("satellite.gate_missing", "task gate evidence is missing", gate.id);
    }
    const valid = validateWithSchema<GateEvidence>("project-memory/v1/gate-evidence", actual);
    if (!valid.ok) return valid;
    if (
      actual.definition_ref !== gate.definition_ref ||
      actual.evidence_type !== gate.evidence_type ||
      actual.required !== gate.required ||
      actual.conflict_sensitive !== gate.conflict_sensitive ||
      actual.status !== check.status ||
      check.command_or_check !== gate.command_or_check ||
      actual.stdout_redacted !== check.exact_result ||
      actual.stdout_sha256 !== sha256(actual.stdout_redacted) ||
      actual.stderr_sha256 !== sha256(actual.stderr_redacted) ||
      Date.parse(actual.occurred_at) > now.getTime() ||
      (gate.required && actual.status !== "passed")
    ) {
      return failure("satellite.gate_failed", "gate evidence drifted or a required gate failed", gate.id);
    }
    hashes.push(sha256(canonicalJson(actual)));
    evidenceIds.push(...actual.evidence_ids);
  }
  return success({ hashes: unique(hashes), evidence: unique(evidenceIds) });
}
function approvalIds(input: SatelliteBindingInput): readonly string[] {
  return unique([
    ...input.task_packet.approvals.map((approval) => approval.id),
    ...input.task_packet.authorization.external_action.approval_ids,
    ...(input.task_packet.claim.coordination_exception_approval_id === null
      ? []
      : [input.task_packet.claim.coordination_exception_approval_id]),
  ]);
}
async function blobHashes(
  git: IntegrationGitClient,
  repo: URL,
  revision: string,
  paths: readonly string[],
  missingCode: string,
): Promise<RuntimeResult<Readonly<Record<string, string>>>> {
  const result: Record<string, string> = {};
  for (const relativePath of unique(paths)) {
    const bytes = await git.readBlob(repo, revision, relativePath);
    if (bytes === null) return failure(missingCode, "bound Git blob is missing", relativePath);
    result[relativePath] = sha256(bytes);
  }
  return success(result);
}
async function verifyArchives(
  git: IntegrationGitClient,
  input: SatelliteBindingInput,
): Promise<RuntimeResult<readonly string[]>> {
  for (const hash of unique(input.archive_manifest_hashes)) {
    let relativePath: string;
    try {
      relativePath = archiveManifestPath(hash);
    } catch (error: unknown) {
      return failure("satellite.archive_invalid", String(error), hash);
    }
    const bytes = await git.readBlob(input.repo, input.work_commit_hash, relativePath);
    if (bytes === null) return failure("satellite.archive_missing", "archive manifest is missing", hash);
    const decoded = decodeStrictUtf8(bytes, relativePath);
    if (!decoded.ok) return decoded;
    const parsed = parseJsonDocument(decoded.value, relativePath);
    if (!parsed.ok) return parsed;
    const manifest = validateWithSchema<ArchiveManifest>(
      "project-memory/v1/archive-manifest",
      parsed.value,
    );
    if (!manifest.ok) return manifest;
    const { manifest_hash: ignored, ...body } = manifest.value;
    const object = await git.readBlob(
      input.repo,
      input.work_commit_hash,
      manifest.value.object_path,
    );
    if (
      ignored !== hash ||
      sha256(canonicalJson(body)) !== hash ||
      canonicalJson(manifest.value) !== decoded.value ||
      object === null ||
      sha256(object) !== manifest.value.stored_hash
    ) {
      return failure("satellite.archive_drift", "archive manifest or object hash drifted", hash);
    }
  }
  return success(unique(input.archive_manifest_hashes));
}


async function expectedPrepared(
  dependencies: SatellitePreparerDependencies,
  input: SatelliteBindingInput,
  preparedAt: string,
): Promise<RuntimeResult<PreparedSatellite>> {
  try {
    if (
      input.repo.protocol !== "file:" ||
      input.repository_id.trim().length === 0 ||
      input.prepared_by.trim().length === 0 ||
      !REVISION.test(input.integration_base_revision) ||
      !REVISION.test(input.work_commit_hash)
    ) return failure("satellite.input_invalid", "satellite bindings are malformed");
    const task = validateWithSchema<TaskPacket>("project-memory/v1/task-packet", input.task_packet);
    if (!task.ok) return task;
    const completion = validateWithSchema<CompletionPacket>(
      "project-memory/v1/completion-packet",
      input.completion_packet,
    );
    if (!completion.ok) return completion;
    if (
      task.value.packet_id !== completion.value.packet_id ||
      task.value.task_id !== completion.value.task_id ||
      task.value.workstream_id !== completion.value.workstream_id ||
      task.value.claim.id !== completion.value.claim_id ||
      completion.value.original_base_revision !== task.value.resolved_inputs.original_base_revision ||
      completion.value.original_base_revision !== task.value.claim.base_revision ||
      completion.value.changes.some((change) =>
        !change.commits.includes(completion.value.worker_head_revision))
    ) return failure("satellite.packet_binding_invalid", "task and completion identities differ");
    const objects = await Promise.all([
      completion.value.original_base_revision,
      completion.value.worker_head_revision,
      input.integration_base_revision,
      input.work_commit_hash,
    ].map((revision) => dependencies.git.objectExists(input.repo, revision)));
    if (objects.some((exists) => !exists)) {
      return failure("satellite.object_missing", "one or more bound Git commits are absent");
    }
    const parents = await dependencies.git.commitParents(input.repo, input.work_commit_hash);
    const originalToWorker = await dependencies.git.mergeBase(
      input.repo,
      completion.value.original_base_revision,
      completion.value.worker_head_revision,
    );
    const originalToIntegration = await dependencies.git.mergeBase(
      input.repo,
      completion.value.original_base_revision,
      input.integration_base_revision,
    );
    if (
      !same(parents, [input.integration_base_revision]) ||
      originalToWorker !== completion.value.original_base_revision ||
      originalToIntegration !== completion.value.original_base_revision
    ) return failure("satellite.ancestry_drift", "work, worker, and integration ancestry is not exact");

    const now = dependencies.clock.now();
    if (!Number.isFinite(now.getTime()) || Date.parse(preparedAt) > now.getTime()) {
      return failure("satellite.clock_invalid", "preparation time is invalid or in the future");
    }
    const current = await dependencies.snapshots.build(input.repo, {
      kind: "commit",
      object_id: input.integration_base_revision,
    });
    if (!current.ok) return current;
    const original = await dependencies.snapshots.build(input.repo, {
      kind: "commit",
      object_id: completion.value.original_base_revision,
    });
    if (!original.ok) return original;
    const embedded = validateEmbeddedTask(current.value, task.value);
    if (!embedded.ok) return embedded;
    const claim = effectiveClaimFromSnapshot(current.value, task.value.claim.id, now);
    if (!claim.ok) return claim;
    const taskBoundClaim = {
      ...claim.value,
      expires_at: task.value.claim.expires_at,
      last_heartbeat_at: task.value.claim.last_heartbeat_at,
    };
    if (
      !same(taskBoundClaim, task.value.claim) ||
      current.value.root_id !== task.value.root.id ||
      current.value.profile_lock_hash !== task.value.root.profile_lock_hash ||
      original.value.profile_lock_hash !== task.value.root.profile_lock_hash ||
      current.value.profile_lock.schema_version !== input.profile_version ||
      current.value.catalog_versions[0] !== task.value.root.catalog_release ||
      current.value.selected_catalog_lock_hash !== input.catalog_lock_hash ||
      current.value.project.catalog.catalog_hash !== task.value.root.catalog_hash
    ) return failure("satellite.profile_binding_drift", "root, profile, or catalog binding drifted");

    const changed = unique(await dependencies.git.changedPaths(
      input.repo,
      input.integration_base_revision,
      input.work_commit_hash,
    ));
    const declaredFiles = unique(completion.value.changes.flatMap((change) => change.files));
    const artifacts = unique(completion.value.changes.flatMap((change) => change.artifacts));
    if (
      !same(changed, unique([...declaredFiles, ...artifacts])) ||
      declaredFiles.some((relativePath) => !task.value.claim.paths.includes(relativePath))
    ) return failure("satellite.scope_drift", "actual work differs from declared and claimed paths");
    const artifactHashes = await blobHashes(
      dependencies.git,
      input.repo,
      input.work_commit_hash,
      artifacts,
      "satellite.artifact_missing",
    );
    if (!artifactHashes.ok) return artifactHashes;
    const viewHashes = await blobHashes(
      dependencies.git,
      input.repo,
      input.work_commit_hash,
      GENERATED_VIEW_PATHS,
      "satellite.view_missing",
    );
    if (!viewHashes.ok) return viewHashes;
    const gates = gateBindings(input, now);
    if (!gates.ok) return gates;
    const approvals = approvalIds(input);
    const knownApprovals = new Set([
      ...task.value.approvals.map((approval) => approval.id),
      ...current.value.approvals.map((approval) => approval.id),
    ]);
    const changeApprovalIds = completion.value.changes.flatMap((change) => change.authorization_refs);
    if (
      approvals.some((id) => !knownApprovals.has(id)) ||
      changeApprovalIds.some((id) => !approvals.includes(id)) ||
      (task.value.authorization.mutation === "approval-required" && approvals.length === 0) ||
      input.gate_evidence.some((gate) => gate.approval_refs.some((id) => !approvals.includes(id)))
    ) return failure("satellite.approval_drift", "task, change, or gate approval is unbound");
    const archives = await verifyArchives(dependencies.git, input);
    if (!archives.ok) return archives;
    const core: PreparedCore = {
      schema_version: "1.0.0",
      root_id: task.value.root.id,
      repository_id: input.repository_id,
      task_id: task.value.task_id,
      packet_id: task.value.packet_id,
      state: "prepared",
      original_base_revision: completion.value.original_base_revision,
      integration_base_revision: input.integration_base_revision,
      commit_hash: input.work_commit_hash,
      task_packet_hash: sha256(canonicalJson(task.value)),
      completion_packet_hash: sha256(canonicalJson(completion.value)),
      profile_version: input.profile_version,
      profile_lock_hash: task.value.root.profile_lock_hash,
      catalog_version: task.value.root.catalog_release,
      catalog_lock_hash: input.catalog_lock_hash,
      approval_ids: [...approvals],
      evidence_ids: unique([
        input.audit_evidence_id,
        ...gates.value.evidence,
        ...completion.value.checks.flatMap((check) =>
          check.evidence_id === null ? [] : [check.evidence_id]),
      ]),
      gate_evidence_hashes: [...gates.value.hashes],
      changed_paths: [...changed],
      artifact_hashes: artifactHashes.value,
      generated_view_hashes: viewHashes.value,
      archive_manifest_hashes: [...archives.value],
      audit_evidence_id: input.audit_evidence_id,
      prepared_at: preparedAt,
      prepared_by: input.prepared_by,
    };
    const manifestHash = preparedManifestHash(core);
    const prepared = {
      ...core,
      manifest_hash: manifestHash,
      manifest_ref: preparedManifestRef({ packet_id: core.packet_id, manifest_hash: manifestHash }),
    };
    return validateWithSchema<PreparedSatellite>(
      "project-memory/v1/prepared-satellite",
      prepared,
    );
  } catch (error: unknown) {
    return failure(
      "satellite.validation_failed",
      error instanceof Error ? error.message : String(error),
      input.repository_id,
    );
  }
}

async function resolvePreparedRef(
  dependencies: SatellitePreparerDependencies,
  repo: URL,
  ref: string,
): Promise<string | null> {
  try {
    return await dependencies.git.resolveRef(repo, ref);
  } catch {
    return null;
  }
}

export function createSatellitePreparer(
  dependencies: SatellitePreparerDependencies,
): SatellitePreparer {
  async function verifySatellite(
    input: VerifySatelliteInput,
  ): Promise<RuntimeResult<PreparedSatellite>> {
    if (!(await dependencies.git.objectExists(input.repo, input.work_commit_hash))) {
      return failure("satellite.object_missing", "bound work commit is absent", input.work_commit_hash);
    }
    const supplied = validateWithSchema<PreparedSatellite>(
      "project-memory/v1/prepared-satellite",
      input.prepared,
    );
    if (!supplied.ok) return supplied;
    const expected = await expectedPrepared(dependencies, input, supplied.value.prepared_at);
    if (!expected.ok) return expected;
    if (!same(expected.value, supplied.value)) {
      return failure("satellite.manifest_drift", "prepared manifest metadata is not exact");
    }
    const metadataCommit = await resolvePreparedRef(
      dependencies,
      input.repo,
      supplied.value.manifest_ref,
    );
    if (metadataCommit === null) {
      return failure("satellite.prepared_ref_missing", "immutable prepared ref is absent");
    }
    const parents = await dependencies.git.commitParents(input.repo, metadataCommit);
    const relativePath = preparedManifestPath(supplied.value);
    const delta = unique(await dependencies.git.changedPaths(
      input.repo,
      supplied.value.commit_hash,
      metadataCommit,
    ));
    const bytes = await dependencies.git.readBlob(input.repo, metadataCommit, relativePath);
    if (
      !same(parents, [supplied.value.commit_hash]) ||
      !same(delta, [relativePath]) ||
      bytes === null ||
      new TextDecoder().decode(bytes) !== canonicalJson(supplied.value)
    ) return failure("satellite.metadata_commit_drift", "prepared ref, parent, delta, or bytes drifted");
    return success(supplied.value);
  }

  async function prepareSatellite(
    input: PrepareSatelliteInput,
  ): Promise<RuntimeResult<PreparedSatellite>> {
    const now = dependencies.clock.now();
    if (!Number.isFinite(now.getTime())) {
      return failure("satellite.clock_invalid", "preparation clock is invalid");
    }
    const prepared = await expectedPrepared(dependencies, input, now.toISOString());
    if (!prepared.ok) return prepared;
    const existing = await resolvePreparedRef(dependencies, input.repo, prepared.value.manifest_ref);
    if (existing !== null) return verifySatellite({ ...input, prepared: prepared.value });
    if (dependencies.temporary_root.protocol !== "file:") {
      return failure("satellite.temporary_root_invalid", "temporary root must be a file URL");
    }
    const repoPath = fileURLToPath(input.repo);
    const temporaryPath = fileURLToPath(dependencies.temporary_root);
    if (isSameOrChildPath(repoPath, temporaryPath)) {
      return failure("satellite.temporary_root_invalid", "temporary root must be outside the repository");
    }
    let generated: URL | null = null;
    let worktree: URL | null = null;
    let created = false;
    let result: RuntimeResult<PreparedSatellite>;
    let cleanupError: unknown = null;
    try {
      await mkdir(dependencies.temporary_root, { recursive: true });
      const directory = await mkdtemp(path.join(temporaryPath, "satellite-prepare-"));
      generated = pathToFileURL(`${directory}${path.sep}`);
      worktree = new URL("worktree/", generated);
      await dependencies.git.createDetachedWorktree(input.repo, input.work_commit_hash, worktree);
      created = true;
      const applied = await applyFileTransaction(worktree, [{
        relative_path: preparedManifestPath(prepared.value),
        bytes: new TextEncoder().encode(canonicalJson(prepared.value)),
        expected_existing_sha256: null,
        mode: "create",
      }]);
      if (!applied.ok) {
        result = applied;
      } else {
      await dependencies.git.stageAll(worktree);
      const tree = await dependencies.git.writeTree(worktree);
      const metadataCommit = await dependencies.git.commitTree(
        input.repo,
        tree,
        input.work_commit_hash,
        `project-memory(satellite-prepared): ${input.repository_id}`,
      );
      const updated = await dependencies.git.updateRef(
        input.repo,
        prepared.value.manifest_ref,
        metadataCommit,
        ZERO_REVISION,
      );
      result = updated
        ? success(prepared.value)
        : await verifySatellite({ ...input, prepared: prepared.value });
      }
    } catch (error: unknown) {
      result = failure(
        "satellite.preparation_failed",
        error instanceof Error ? error.message : String(error),
        input.repository_id,
      );
    } finally {
      if (created && worktree !== null) {
        try { await dependencies.git.removeWorktree(input.repo, worktree); }
        catch (error: unknown) { cleanupError = error; }
      }
      if (generated !== null) {
        try { await rm(generated, { recursive: true, force: true }); }
        catch (error: unknown) { cleanupError ??= error; }
      }
    }
    return cleanupError === null ? result : failure(
      "satellite.cleanup_failed", cleanupError instanceof Error ? cleanupError.message : "unknown cleanup failure",
      input.repository_id,
    );
  }

  return { prepareSatellite, verifySatellite };
}
