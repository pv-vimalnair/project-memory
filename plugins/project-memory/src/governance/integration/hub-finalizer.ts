import { lstat, mkdir, mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyFileTransaction,
  canonicalJson,
  failure,
  isSameOrChildPath,
  resolveInside,
  sha256,
  success,
  validateWithSchema,
  type Clock,
  type PlannedWrite,
  type RuntimeIssue,
  type RuntimeResult,
} from "../../index.js";
import type { TaskPacket } from "../../planning/types.js";
import type { CanonicalRecord, HubFinalizationReceipt, PreparedSatellite } from "../contracts/index.js";
import { createAppendOnlyEventStore } from "../events/append-only-event-store.js";
import { recordWrite } from "../records/record-path.js";
import type { CanonicalSnapshotBuilder } from "../snapshot/snapshot-contracts.js";
import { GENERATED_VIEW_PATHS, type ViewGenerator } from "../views/generate-views.js";
import { parseWorkDocument, taskDocumentPath, transitionWorkDocument } from "../work/work-document.js";
import type { IntegrationGitClient } from "./integration-git-client.js";
import type { IntegrationLeaseStore, LeaseToken } from "./integration-lease-store.js";
import type { SatellitePreparer, VerifySatelliteInput } from "./satellite-preparer.js";
import { effectiveClaimFromSnapshot, validateEmbeddedTask } from "./single-repo-validation.js";
import { validateBoundViewPlan } from "./single-repo-view-validation.js";
const REVISION = /^[0-9a-f]{40}$/;
const TARGET_REF = /^refs\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}
function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}
function hashes(writes: readonly PlannedWrite[]): Readonly<Record<string, string>> {
  return Object.fromEntries([...writes]
    .sort((left, right) => compareUtf8(left.relative_path, right.relative_path))
    .map((write) => [write.relative_path, sha256(write.bytes)]));
}
export interface FinalizeHubInput {
  readonly hub: URL;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly task_packet: TaskPacket;
  readonly satellites: readonly VerifySatelliteInput[];
  readonly audit_evidence_id: string;
  readonly finalized_by: string;
}
export interface HubFinalizer {
  finalizeHub(input: FinalizeHubInput): Promise<RuntimeResult<HubFinalizationReceipt>>;
}
export interface HubFinalizerDependencies {
  readonly clock: Clock;
  readonly git: IntegrationGitClient;
  readonly leases: IntegrationLeaseStore;
  readonly snapshots: CanonicalSnapshotBuilder;
  readonly views: Pick<ViewGenerator, "plan">;
  readonly satellites: SatellitePreparer;
  readonly temporary_root: URL;
  readonly integrator_id: string;
  readonly lease_ttl_ms?: number;
}
export interface HubFinalizationArtifact {
  readonly schema_version: "1.0.0";
  readonly evidence_type: "multi-repository-hub-finalization";
  readonly input_hash: string;
  readonly hub_root_id: string;
  readonly packet_id: string;
  readonly task_id: string;
  readonly target_ref: string;
  readonly previous_revision: string;
  readonly satellite_manifest_hashes: readonly string[];
  readonly satellite_commit_hashes: readonly string[];
  readonly audit_evidence_id: string;
  readonly source_tree: string;
  readonly generated_view_hashes: Readonly<Record<string, string>>;
  readonly finalized_at: string;
  readonly finalized_by: string;
}
function satelliteKey(input: VerifySatelliteInput) {
  return {
    repository_id: input.repository_id,
    integration_base_revision: input.integration_base_revision,
    work_commit_hash: input.work_commit_hash,
    task_packet_hash: sha256(canonicalJson(input.task_packet)),
    completion_packet_hash: sha256(canonicalJson(input.completion_packet)),
    profile_version: input.profile_version,
    catalog_lock_hash: input.catalog_lock_hash,
    gate_evidence_hash: sha256(canonicalJson(input.gate_evidence)),
    archive_manifest_hashes: unique(input.archive_manifest_hashes),
    audit_evidence_id: input.audit_evidence_id,
    prepared_by: input.prepared_by,
    prepared: input.prepared,
  };
}
export function hubFinalizationInputHash(input: FinalizeHubInput): string {
  return sha256(canonicalJson({
    target_ref: input.target_ref,
    expected_head: input.expected_head,
    task_packet_hash: sha256(canonicalJson(input.task_packet)),
    satellites: [...input.satellites]
      .sort((left, right) => compareUtf8(left.prepared.manifest_hash, right.prepared.manifest_hash))
      .map(satelliteKey),
    audit_evidence_id: input.audit_evidence_id,
    finalized_by: input.finalized_by,
  }));
}
export function hubFinalizationArtifactPath(packetId: string, inputHash: string): string {
  return `docs/project-memory/governance/integration/hub/${packetId}/${inputHash}.json`;
}
export function hubReceiptHash(
  value: HubFinalizationReceipt | Omit<HubFinalizationReceipt, "receipt_hash">,
): string {
  const body = { ...value } as Record<string, unknown>;
  delete body.receipt_hash;
  return sha256(canonicalJson(body));
}
function receipt(
  artifact: HubFinalizationArtifact,
  commitRevision: string,
): RuntimeResult<HubFinalizationReceipt> {
  const body: Omit<HubFinalizationReceipt, "receipt_hash"> = {
    schema_version: "1.0.0",
    status: "hub_finalized",
    hub_root_id: artifact.hub_root_id,
    packet_id: artifact.packet_id,
    previous_revision: artifact.previous_revision,
    commit_revision: commitRevision,
    satellite_manifest_hashes: [...artifact.satellite_manifest_hashes],
    satellite_commit_hashes: [...artifact.satellite_commit_hashes],
    audit_evidence_id: artifact.audit_evidence_id,
    generated_view_hashes: artifact.generated_view_hashes,
    finalized_at: artifact.finalized_at,
    finalized_by: artifact.finalized_by,
  };
  return validateWithSchema<HubFinalizationReceipt>(
    "project-memory/v1/hub-finalization",
    { ...body, receipt_hash: hubReceiptHash(body) },
  );
}
function parseHubArtifact(bytes: Uint8Array): HubFinalizationArtifact | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value = JSON.parse(text) as HubFinalizationArtifact;
    return canonicalJson(value) === text ? value : null;
  } catch {
    return null;
  }
}
async function existingReceipt(
  dependencies: HubFinalizerDependencies,
  input: FinalizeHubInput,
  current: string,
): Promise<RuntimeResult<HubFinalizationReceipt> | null> {
  const inputHash = hubFinalizationInputHash(input);
  const relativePath = hubFinalizationArtifactPath(input.task_packet.packet_id, inputHash);
  const bytes = await dependencies.git.readBlob(input.hub, current, relativePath);
  if (bytes === null) return null;
  const artifact = parseHubArtifact(bytes);
  const parents = await dependencies.git.commitParents(input.hub, current);
  if (
    artifact === null ||
    artifact.input_hash !== inputHash ||
    artifact.packet_id !== input.task_packet.packet_id ||
    artifact.task_id !== input.task_packet.task_id ||
    artifact.previous_revision !== input.expected_head ||
    artifact.target_ref !== input.target_ref ||
    canonicalJson(parents) !== canonicalJson([input.expected_head])
  ) return failure("hub.receipt_drift", "existing hub receipt artifact is not exact", relativePath);
  const snapshot = await dependencies.snapshots.build(input.hub, {
    kind: "commit",
    object_id: current,
  });
  if (!snapshot.ok) return snapshot;
  const task = snapshot.value.tasks.find((document) =>
    document.envelope.id === input.task_packet.task_id &&
    /^Status: integrated_verified$/mu.test(document.body));
  if (task === undefined) return failure("hub.task_not_integrated", "existing receipt lacks completion state");
  return receipt(artifact, current);
}
async function removeViews(worktree: URL): Promise<RuntimeResult<true>> {
  for (const relativePath of GENERATED_VIEW_PATHS) {
    const target = await resolveInside(worktree, relativePath);
    if (!target.ok) return target;
    try {
      const info = await lstat(target.value);
      if (info.isSymbolicLink() || !info.isFile()) {
        return failure("hub.view_unsafe", "generated views must be regular files", relativePath);
      }
      await unlink(target.value);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return failure("hub.view_remove_failed", String(error), relativePath);
      }
    }
  }
  return success(true);
}
async function taskWrite(
  worktree: URL,
  task: TaskPacket,
  approvals: readonly string[],
): Promise<RuntimeResult<PlannedWrite>> {
  const relativePath = taskDocumentPath(task.workstream_id, task.task_id);
  const target = await resolveInside(worktree, relativePath);
  if (!target.ok) return target;
  try {
    const info = await lstat(target.value);
    const bytes = new Uint8Array(await readFile(target.value));
    if (info.isSymbolicLink() || !info.isFile()) throw new Error("task is not a regular file");
    const parsed = parseWorkDocument(bytes, "task_packet", task.task_id, task.root.id);
    if (!parsed.ok) return parsed;
    if (parsed.value.status !== "submitted") {
      return failure("hub.task_state_invalid", "only a submitted hub task may finalize", task.task_id);
    }
    return success({
      relative_path: relativePath,
      bytes: transitionWorkDocument(parsed.value, "integrated_verified", approvals),
      expected_existing_sha256: sha256(bytes),
      mode: "replace",
    });
  } catch (error: unknown) {
    return failure("hub.task_read_failed", String(error), relativePath);
  }
}
function auditRecord(
  input: FinalizeHubInput,
  prepared: readonly PreparedSatellite[],
  finalizedAt: string,
): RuntimeResult<CanonicalRecord> {
  const manifests = prepared.map((value) => value.manifest_hash).sort(compareUtf8);
  const commits = prepared.map((value) => value.commit_hash).sort(compareUtf8);
  return validateWithSchema<CanonicalRecord>("project-memory/v1/canonical-record", {
    id: input.audit_evidence_id,
    type: "evidence",
    title: `Hub finalization for ${input.task_packet.packet_id}`,
    status: "accepted",
    root_id: input.task_packet.root.id,
    component_ids: unique(input.task_packet.component_duties.map((duty) => duty.component_id)),
    initiative_id: input.task_packet.initiative_id,
    workstream_id: input.task_packet.workstream_id,
    task_id: input.task_packet.task_id,
    actor_id: input.finalized_by,
    authority_class: "integrator",
    created_at: finalizedAt,
    original_base_revision: input.task_packet.resolved_inputs.original_base_revision,
    integration_base_revision: input.expected_head,
    catalog_versions: [input.task_packet.root.catalog_release],
    relationships: [],
    payload: {
      evidence_type: "multi-repository-hub-finalization",
      exact_result: canonicalJson({ manifests, commits }),
      source_refs: unique([...manifests.map((hash) => `manifest:${hash}`), ...commits.map((hash) => `commit:${hash}`)]),
      hashes: {
        satellite_manifest_set: sha256(canonicalJson(manifests)),
        satellite_commit_set: sha256(canonicalJson(commits)),
      },
      not_run_reason: null,
    },
  });
}
async function executeHub(
  dependencies: HubFinalizerDependencies,
  input: FinalizeHubInput,
  lease: LeaseToken,
  prepared: readonly PreparedSatellite[],
  worktree: URL,
): Promise<RuntimeResult<HubFinalizationReceipt>> {
  const now = dependencies.clock.now();
  if (!Number.isFinite(now.getTime())) return failure("hub.clock_invalid", "hub clock is invalid");
  const finalizedAt = now.toISOString();
  const approvals = unique(prepared.flatMap((value) => value.approval_ids));
  const task = await taskWrite(worktree, input.task_packet, approvals);
  if (!task.ok) return task;
  const audit = auditRecord(input, prepared, finalizedAt);
  if (!audit.ok) return audit;
  if (!await applyWrites(worktree, [task.value, recordWrite(audit.value)])) {
    return failure("hub.source_apply_failed", "hub source writes could not be applied");
  }
  const events = createAppendOnlyEventStore();
  const event = await events.planAppend(worktree, {
    aggregate_id: input.task_packet.task_id,
    event_type: "hub_finalized",
    occurred_at: finalizedAt,
    actor_id: input.finalized_by,
    authority_class: "integrator",
    evidence_ids: [input.audit_evidence_id],
    payload: {
      packet_id: input.task_packet.packet_id,
      satellite_manifest_hashes: prepared.map((value) => value.manifest_hash).sort(compareUtf8),
      satellite_commit_hashes: prepared.map((value) => value.commit_hash).sort(compareUtf8),
    },
  });
  if (!event.ok) return event;
  if (!await applyWrites(worktree, [event.value])) {
    return failure("hub.event_apply_failed", "hub event could not be applied");
  }
  const removed = await removeViews(worktree);
  if (!removed.ok) return removed;
  await dependencies.git.stageAll(worktree);
  const sourceTree = await dependencies.git.writeTree(worktree);
  const snapshot = await dependencies.snapshots.build(worktree, { kind: "tree", object_id: sourceTree });
  if (!snapshot.ok) return snapshot;
  const activeClaim = effectiveClaimFromSnapshot(snapshot.value, input.task_packet.claim.id, now);
  if (!activeClaim.ok) return activeClaim;
  const plan = dependencies.views.plan(snapshot.value);
  if (!plan.ok) return plan;
  const validViews = validateBoundViewPlan(plan.value, {
    root_id: input.task_packet.root.id,
    target_ref: input.target_ref,
    profile_lock_hash: input.task_packet.root.profile_lock_hash,
    task_id: input.task_packet.task_id,
  }, snapshot.value, sourceTree, now);
  if (!validViews.ok) return validViews;
  if (!await applyWrites(worktree, plan.value.writes)) {
    return failure("hub.view_apply_failed", "generated views could not be applied");
  }
  const viewHashes = hashes(plan.value.writes);
  const inputHash = hubFinalizationInputHash(input);
  const artifact: HubFinalizationArtifact = {
    schema_version: "1.0.0",
    evidence_type: "multi-repository-hub-finalization",
    input_hash: inputHash,
    hub_root_id: input.task_packet.root.id,
    packet_id: input.task_packet.packet_id,
    task_id: input.task_packet.task_id,
    target_ref: input.target_ref,
    previous_revision: input.expected_head,
    satellite_manifest_hashes: prepared.map((value) => value.manifest_hash).sort(compareUtf8),
    satellite_commit_hashes: prepared.map((value) => value.commit_hash).sort(compareUtf8),
    audit_evidence_id: input.audit_evidence_id,
    source_tree: sourceTree,
    generated_view_hashes: viewHashes,
    finalized_at: finalizedAt,
    finalized_by: input.finalized_by,
  };
  if (!await applyWrites(worktree, [{
    relative_path: hubFinalizationArtifactPath(input.task_packet.packet_id, inputHash),
    bytes: new TextEncoder().encode(canonicalJson(artifact)),
    expected_existing_sha256: null,
    mode: "create",
  }])) return failure("hub.artifact_apply_failed", "hub receipt artifact could not be applied");
  await dependencies.git.stageAll(worktree);
  const tree = await dependencies.git.writeTree(worktree);
  const renewed = await dependencies.leases.heartbeat(lease);
  if (!renewed.ok) return renewed;
  const commit = await dependencies.git.commitTree(
    input.hub,
    tree,
    input.expected_head,
    `project-memory(hub-finalized): ${input.task_packet.task_id}`,
  );
  const updated = await dependencies.git.updateRef(
    input.hub,
    input.target_ref,
    commit,
    input.expected_head,
  );
  return updated
    ? receipt(artifact, commit)
    : failure("hub.cas_lost", "hub target changed before compare-and-swap", input.target_ref);
}
async function applyWrites(root: URL, writes: readonly PlannedWrite[]): Promise<boolean> {
  return (await applyFileTransaction(root, writes)).ok;
}
function cleanupIssue(code: string, error: unknown, pathValue: string): RuntimeIssue {
  return { code, severity: "error", path: pathValue, message: String(error), references: [] };
}
async function verifyHubSatellites(
  dependencies: HubFinalizerDependencies,
  input: FinalizeHubInput,
): Promise<RuntimeResult<readonly PreparedSatellite[]>> {
  const prepared: PreparedSatellite[] = [];
  const taskHash = sha256(canonicalJson(input.task_packet));
  for (const satellite of input.satellites) {
    const verified = await dependencies.satellites.verifySatellite(satellite);
    if (!verified.ok) return verified;
    if (
      verified.value.root_id !== input.task_packet.root.id ||
      verified.value.task_id !== input.task_packet.task_id ||
      verified.value.packet_id !== input.task_packet.packet_id ||
      verified.value.task_packet_hash !== taskHash
    ) return failure("hub.satellite_binding_drift", "satellite targets another exact hub task");
    prepared.push(verified.value);
  }
  if (
    unique(prepared.map((value) => value.manifest_hash)).length !== prepared.length ||
    unique(prepared.map((value) => value.commit_hash)).length !== prepared.length
  ) return failure("hub.satellite_duplicate", "hub satellites must be unique");
  return success(prepared);
}
export function createHubFinalizer(dependencies: HubFinalizerDependencies): HubFinalizer {
  async function finalizeHub(input: FinalizeHubInput): Promise<RuntimeResult<HubFinalizationReceipt>> {
    if (
      input.hub.protocol !== "file:" ||
      !REVISION.test(input.expected_head) ||
      !TARGET_REF.test(input.target_ref) ||
      input.target_ref.includes("..") ||
      input.satellites.length === 0 ||
      input.finalized_by !== dependencies.integrator_id
    ) return failure("hub.input_invalid", "hub finalization bindings are invalid");
    let current: string;
    try { current = await dependencies.git.resolveRef(input.hub, input.target_ref); }
    catch (error: unknown) { return failure("hub.ref_invalid", String(error), input.target_ref); }
    if (current !== input.expected_head) {
      return (await existingReceipt(dependencies, input, current)) ??
        failure("hub.head_mismatch", "hub target is stale", input.target_ref);
    }
    if (await dependencies.git.head(input.hub) !== current) {
      return failure("hub.head_mismatch", "checked-out hub HEAD differs from target ref");
    }
    const now = dependencies.clock.now();
    if (!Number.isFinite(now.getTime())) return failure("hub.clock_invalid", "hub clock is invalid");
    const taskValid = validateWithSchema<TaskPacket>("project-memory/v1/task-packet", input.task_packet);
    if (!taskValid.ok) return taskValid;
    const snapshot = await dependencies.snapshots.build(input.hub, { kind: "commit", object_id: current });
    if (!snapshot.ok) return snapshot;
    const embedded = validateEmbeddedTask(snapshot.value, input.task_packet);
    if (!embedded.ok) return embedded;
    const claim = effectiveClaimFromSnapshot(snapshot.value, input.task_packet.claim.id, now);
    if (!claim.ok) return claim;
    const taskBoundClaim = {
      ...claim.value,
      expires_at: input.task_packet.claim.expires_at,
      last_heartbeat_at: input.task_packet.claim.last_heartbeat_at,
    };
    if (
      canonicalJson(taskBoundClaim) !== canonicalJson(input.task_packet.claim) ||
      snapshot.value.root_id !== input.task_packet.root.id ||
      snapshot.value.profile_lock_hash !== input.task_packet.root.profile_lock_hash ||
      snapshot.value.records.some((record) => record.id === input.audit_evidence_id)
    ) return failure("hub.binding_drift", "hub root, profile, or audit evidence binding drifted");
    const acquired = await dependencies.leases.acquire({
      repo: input.hub,
      root_id: input.task_packet.root.id,
      holder_id: dependencies.integrator_id,
      authority_class: "integrator",
      base_revision: input.expected_head,
      target_ref: input.target_ref,
      ttl_ms: dependencies.lease_ttl_ms ?? 5 * 60_000,
    });
    if (!acquired.ok) return acquired;
    const lockedHead = await dependencies.git.resolveRef(input.hub, input.target_ref);
    const prepared = lockedHead === input.expected_head
      ? await verifyHubSatellites(dependencies, input)
      : failure("hub.head_mismatch", "hub target changed after lease acquisition");
    if (!prepared.ok) {
      const released = await dependencies.leases.release(acquired.value);
      return released.ok ? prepared : { ok: false, issues: [...prepared.issues, ...released.issues] };
    }
    let generated: URL | null = null;
    let worktree: URL | null = null;
    let created = false;
    let result: RuntimeResult<HubFinalizationReceipt>;
    const cleanup: RuntimeIssue[] = [];
    try {
      const temporaryPath = fileURLToPath(dependencies.temporary_root);
      if (
        dependencies.temporary_root.protocol !== "file:" ||
        isSameOrChildPath(fileURLToPath(input.hub), temporaryPath)
      ) throw new Error("temporary root must be a file URL outside the hub");
      await mkdir(dependencies.temporary_root, { recursive: true });
      const directory = await mkdtemp(path.join(temporaryPath, "hub-finalize-"));
      generated = pathToFileURL(`${directory}${path.sep}`);
      worktree = new URL("worktree/", generated);
      await dependencies.git.createDetachedWorktree(input.hub, input.expected_head, worktree);
      created = true;
      result = await executeHub(dependencies, input, acquired.value, prepared.value, worktree);
    } catch (error: unknown) {
      result = failure("hub.finalization_failed", error instanceof Error ? error.message : String(error));
    } finally {
      if (created && worktree !== null) {
        try { await dependencies.git.removeWorktree(input.hub, worktree); }
        catch (error: unknown) { cleanup.push(cleanupIssue("hub.worktree_cleanup_failed", error, worktree.href)); }
      }
      if (generated !== null) {
        try { await rm(generated, { recursive: true, force: true }); }
        catch (error: unknown) { cleanup.push(cleanupIssue("hub.temporary_cleanup_failed", error, generated.href)); }
      }
      const released = await dependencies.leases.release(acquired.value);
      if (!released.ok) cleanup.push(...released.issues);
    }
    return cleanup.length === 0 ? result : { ok: false, issues: cleanup };
  }
  return { finalizeHub };
}
