import {
  canonicalJson,
  failure,
  sha256,
  success,
  validateWithSchema,
  type RuntimeResult,
} from "../../index.js";
import type { Claim, TaskPacket } from "../../planning/types.js";
import {
  evaluateAuthorityCoverage,
  type AuthorityCoverage,
} from "../authority/authority-coverage.js";
import type { CanonicalRecord } from "../contracts/index.js";
import { projectEffectiveState } from "../events/effective-state-projector.js";
import type { CanonicalSnapshot } from "../snapshot/snapshot-contracts.js";
import type {
  ReconciliationReady,
  ReconciliationSemanticBindings,
} from "./stale-base-reconciler.js";
import type {
  SingleRepoFinalizationInput,
  SingleRepoFinalizerDependencies,
} from "./single-repo-contracts.js";

const REVISION = /^[0-9a-f]{40}$/;
const TARGET_REF = /^refs\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function hashMap(value: Readonly<Record<string, unknown>>): string {
  return sha256(canonicalJson(value));
}

export function cloneFinalizationInput(
  input: SingleRepoFinalizationInput,
): SingleRepoFinalizationInput {
  const clone = <T>(value: T): T => JSON.parse(canonicalJson(value)) as T;
  return {
    ...input,
    root: new URL(input.root.href),
    task_packet: clone(input.task_packet),
    completion_packet: clone(input.completion_packet),
    recorded_task_approvals: clone(input.recorded_task_approvals),
    prior_gate_evidence: clone(input.prior_gate_evidence),
    submitted_checks: clone(input.submitted_checks),
    directional_acceptance: clone(input.directional_acceptance),
    external_action: clone(input.external_action),
  };
}

export async function preflightSingleRepo(
  dependencies: SingleRepoFinalizerDependencies,
  input: SingleRepoFinalizationInput,
): Promise<RuntimeResult<string>> {
  if (
    input.root.protocol !== "file:" ||
    !TARGET_REF.test(input.target_ref) ||
    input.target_ref.includes("..") ||
    !REVISION.test(input.expected_head)
  ) {
    return failure(
      "integration.input_invalid",
      "single-repository finalization requires a file Git root, safe ref, and full head",
    );
  }
  try {
    await dependencies.git.commonGitDir(input.root);
    const [head, checkedOut, memory, profile] = await Promise.all([
      dependencies.git.resolveRef(input.root, input.target_ref),
      dependencies.git.head(input.root),
      dependencies.git.listTree(input.root, input.expected_head, "docs/project-memory"),
      dependencies.git.listTree(
        input.root,
        input.expected_head,
        "docs/project-memory/profile.lock.yaml",
      ),
    ]);
    if (memory.length === 0 || !profile.includes("docs/project-memory/profile.lock.yaml")) {
      return failure(
        "integration.bootstrap_required",
        "normal task finalization requires an initialized Project Memory root",
        input.root.href,
      );
    }
    if (head !== input.expected_head || checkedOut !== head) {
      return failure(
        "integration.head_mismatch",
        "target ref and checked-out HEAD must equal the validated integration head",
        input.target_ref,
        [input.expected_head, head, checkedOut],
      );
    }
    return success(head);
  } catch (error: unknown) {
    return failure(
      "integration.repository_invalid",
      error instanceof Error ? error.message : String(error),
      input.root.href,
    );
  }
}

export function validateEmbeddedTask(snapshot: CanonicalSnapshot, task: TaskPacket): RuntimeResult<true> {
  const document = snapshot.tasks.find((candidate) => candidate.envelope.id === task.task_id);
  if (document === undefined) {
    return failure("integration.task_missing", "canonical task document is absent", task.task_id);
  }
  const statuses = [...document.body.matchAll(/^Status: ([a-z_]+)$/gmu)];
  const marker = "## Canonical Task Packet\n\n```json\n";
  const start = document.body.indexOf(marker);
  const end = start < 0 ? -1 : document.body.indexOf("\n```", start + marker.length);
  if (
    statuses.length !== 1 ||
    statuses[0]?.[1] !== "submitted" ||
    start < 0 ||
    end < 0
  ) {
    return failure(
      "integration.task_state_invalid",
      "canonical task must be submitted and retain one embedded packet",
      task.task_id,
    );
  }
  const serialized = canonicalJson(task);
  const embedded = document.body.slice(start + marker.length, end);
  const declared = /^Task packet SHA-256: ([0-9a-f]{64})$/mu.exec(document.body)?.[1];
  if (embedded !== serialized || declared !== sha256(serialized)) {
    return failure(
      "integration.task_packet_drift",
      "supplied task packet differs from the canonical submitted task",
      task.packet_id,
    );
  }
  return success(true);
}

export function effectiveClaimFromSnapshot(
  snapshot: CanonicalSnapshot,
  claimId: string,
  now: Date,
): RuntimeResult<Claim> {
  const document = snapshot.claims.find((candidate) =>
    candidate.value.id === claimId || candidate.value.claim_id === claimId
  );
  if (document === undefined) {
    return failure("claim.not_found", "canonical claim does not exist", claimId);
  }
  const claim = validateWithSchema<Claim>("project-memory/v1/claim", document.value);
  if (!claim.ok) return claim;
  const chain = snapshot.events.filter((event) => event.aggregate_id === claimId);
  const projected = projectEffectiveState(chain);
  if (!projected.ok) return projected;
  const state = projected.value.state.claim;
  const expiresAt = typeof state?.expires_at === "string"
    ? state.expires_at
    : claim.value.expires_at;
  const heartbeatAt = typeof state?.last_heartbeat_at === "string"
    ? state.last_heartbeat_at
    : claim.value.last_heartbeat_at;
  const expired =
    state?.status === "expired" ||
    Date.parse(expiresAt) <= now.getTime();
  return expired
    ? failure("claim.expired", "claim expired before integration validation", claimId)
    : success({
        ...claim.value,
        expires_at: expiresAt,
        last_heartbeat_at: heartbeatAt,
        status: "active",
      });
}

function activeClaims(
  snapshot: CanonicalSnapshot,
  ownClaimId: string,
  now: Date,
): RuntimeResult<readonly Claim[]> {
  const active: Claim[] = [];
  for (const document of snapshot.claims) {
    const id = document.value.id ?? document.value.claim_id;
    if (typeof id !== "string" || id === ownClaimId) continue;
    const claim = effectiveClaimFromSnapshot(snapshot, id, now);
    if (claim.ok) active.push(claim.value);
    else if (claim.issues[0]?.code !== "claim.expired") return claim;
  }
  return success(active.sort((left, right) => compareUtf8(left.id, right.id)));
}

function decisionHashes(
  task: TaskPacket,
  snapshot: CanonicalSnapshot,
): Readonly<Record<string, string>> {
  return Object.fromEntries([...task.decisions.accepted_record_ids]
    .sort(compareUtf8)
    .map((id) => {
      const record = snapshot.effective_records.find((candidate) => candidate.id === id);
      return [id, record === undefined ? "missing" : sha256(canonicalJson(record))];
    }));
}

function relevantApprovalRecords(
  task: TaskPacket,
  snapshot: CanonicalSnapshot,
): readonly CanonicalRecord[] {
  const ids = new Set([
    ...task.approvals.map((approval) => approval.id),
    ...task.authorization.external_action.approval_ids,
    ...(task.claim.coordination_exception_approval_id === null
      ? []
      : [task.claim.coordination_exception_approval_id]),
  ]);
  return snapshot.approvals
    .filter((record) => ids.has(record.id))
    .sort((left, right) => compareUtf8(left.id, right.id));
}

function semanticBindings(
  input: SingleRepoFinalizationInput,
  snapshot: CanonicalSnapshot,
): ReconciliationSemanticBindings {
  const task = input.task_packet;
  return {
    accepted_decision_hashes: decisionHashes(task, snapshot),
    profile_lock_hash: snapshot.profile_lock_hash,
    authority_hash: hashMap({
      authorization: task.authorization,
      packet_approvals: task.approvals,
      canonical_approvals: relevantApprovalRecords(task, snapshot),
      directional_acceptance: input.directional_acceptance,
      external_action: input.external_action,
    }),
    claimed_scope_hash: hashMap({
      components: task.claim.components,
      repositories: task.claim.repositories,
      paths: task.claim.paths,
      duties: task.claim.duties,
    }),
    behavior_hash: hashMap({
      goal: task.goal,
      patterns: task.patterns,
      decisions: task.decisions,
      completion_conditions: task.completion_conditions,
    }),
    evidence_policy_hash: hashMap({
      gates: task.gates,
      required_evidence: task.required_evidence,
      fallback: task.fallback_and_escalation,
    }),
  };
}

function approvalHashes(
  input: SingleRepoFinalizationInput,
  snapshot: CanonicalSnapshot,
  authority: AuthorityCoverage,
): RuntimeResult<Readonly<Record<string, string>>> {
  const hashes: Record<string, string> = {};
  for (const id of authority.approval_ids) {
    const canonical = snapshot.approvals.find((record) => record.id === id);
    const packet = input.recorded_task_approvals.find((approval) => approval.id === id);
    if (canonical === undefined && packet === undefined) {
      return failure(
        "integration.approval_binding_missing",
        "validated authority references an approval without hashable canonical bytes",
        id,
      );
    }
    if (canonical !== undefined) hashes[`canonical:${id}`] = sha256(canonicalJson(canonical));
    if (packet !== undefined) hashes[`task:${id}`] = sha256(canonicalJson(packet));
  }
  return success(Object.fromEntries(
    Object.entries(hashes).sort(([left], [right]) => compareUtf8(left, right)),
  ));
}

async function deletedPaths(
  dependencies: SingleRepoFinalizerDependencies,
  input: SingleRepoFinalizationInput,
  changedPaths: readonly string[],
): Promise<RuntimeResult<readonly string[]>> {
  const deleted: string[] = [];
  try {
    for (const relativePath of changedPaths) {
      if (
        await dependencies.git.readBlob(
          input.root,
          input.completion_packet.worker_head_revision,
          relativePath,
        ) === null
      ) deleted.push(relativePath);
    }
    return success(deleted.sort(compareUtf8));
  } catch (error: unknown) {
    return failure(
      "integration.diff_read_failed",
      error instanceof Error ? error.message : String(error),
      input.completion_packet.task_id,
    );
  }
}

export interface ValidatedBindings {
  readonly current_snapshot: CanonicalSnapshot;
  readonly original_snapshot: CanonicalSnapshot;
  readonly effective_task: TaskPacket;
  readonly authority: AuthorityCoverage;
  readonly changed_paths: readonly string[];
  readonly deleted_paths: readonly string[];
  readonly approval_hashes: Readonly<Record<string, string>>;
  readonly original_semantics: ReconciliationSemanticBindings;
  readonly current_semantics: ReconciliationSemanticBindings;
}

export async function validateBindings(
  dependencies: SingleRepoFinalizerDependencies,
  input: SingleRepoFinalizationInput,
  now: Date,
): Promise<RuntimeResult<ValidatedBindings>> {
  if (!Number.isFinite(now.getTime())) {
    return failure("integration.clock_invalid", "integration validation requires a valid clock");
  }
  const task = input.task_packet;
  const completion = input.completion_packet;
  if (
    task.root.id.trim().length === 0 ||
    task.packet_id !== completion.packet_id ||
    task.task_id !== completion.task_id ||
    task.workstream_id !== completion.workstream_id ||
    task.claim.id !== completion.claim_id ||
    task.root.profile_lock_hash.length !== 64
  ) {
    return failure(
      "integration.packet_binding_invalid",
      "task and completion packet identities are not exact",
      task.task_id,
    );
  }
  const current = await dependencies.snapshots.build(input.root, {
    kind: "commit",
    object_id: input.expected_head,
  });
  if (!current.ok) return current;
  const original = await dependencies.snapshots.build(input.root, {
    kind: "commit",
    object_id: completion.original_base_revision,
  });
  if (!original.ok) return original;
  const taskBound = validateEmbeddedTask(current.value, task);
  if (!taskBound.ok) return taskBound;
  if (
    current.value.root_id !== task.root.id ||
    current.value.profile_lock_hash !== task.root.profile_lock_hash ||
    current.value.profile_lock_hash !== original.value.profile_lock_hash ||
    current.value.catalog_versions[0] !== task.root.catalog_release ||
    current.value.project.catalog.catalog_hash !== task.root.catalog_hash
  ) {
    return failure(
      "integration.profile_binding_drift",
      "task root, profile, or catalog differs from canonical revision-pinned truth",
      task.task_id,
    );
  }
  const ownClaim = effectiveClaimFromSnapshot(current.value, task.claim.id, now);
  if (!ownClaim.ok) return ownClaim;
  if (canonicalJson({ ...ownClaim.value, expires_at: task.claim.expires_at, last_heartbeat_at: task.claim.last_heartbeat_at }) !== canonicalJson(task.claim)) {
    return failure(
      "integration.claim_binding_drift",
      "canonical immutable claim differs from the task-bound claim",
      task.claim.id,
    );
  }
  const effectiveTask: TaskPacket = { ...task, claim: ownClaim.value };
  const conflicts = activeClaims(current.value, task.claim.id, now);
  if (!conflicts.ok) return conflicts;
  let changed: readonly string[];
  try {
    changed = unique(await dependencies.git.changedPaths(
      input.root,
      completion.original_base_revision,
      completion.worker_head_revision,
    ));
  } catch (error: unknown) {
    return failure(
      "integration.diff_read_failed",
      error instanceof Error ? error.message : String(error),
      completion.task_id,
    );
  }
  const deleted = await deletedPaths(dependencies, input, changed);
  if (!deleted.ok) return deleted;
  const evidenceIds = unique([
    ...current.value.evidence.map((record) => record.id),
    ...completion.checks.flatMap((check) =>
      check.evidence_id === null ? [] : [check.evidence_id]
    ),
  ]);
  const authority = evaluateAuthorityCoverage({
    task_packet: effectiveTask,
    completion_packet: completion,
    evaluated_at: now.toISOString(),
    expected_issuer: input.expected_issuer,
    current_base_revision: completion.original_base_revision,
    conflicting_claims: conflicts.value,
    recorded_task_approvals: input.recorded_task_approvals,
    available_evidence_ids: evidenceIds,
    approved_exception_ids: current.value.approvals.map((record) => record.id),
    actor_authority: "integrator",
    minimum_authority: "integrator",
    actual_changed_paths: changed,
    deleted_paths: deleted.value,
    directional_acceptance: input.directional_acceptance,
    external_action: input.external_action,
    canonical_approvals: current.value.approvals,
  });
  if (!authority.ok) return authority;
  const approvals = approvalHashes(input, current.value, authority.value);
  if (!approvals.ok) return approvals;
  return success({
    current_snapshot: current.value,
    original_snapshot: original.value,
    effective_task: effectiveTask,
    authority: authority.value,
    changed_paths: changed,
    deleted_paths: deleted.value,
    approval_hashes: approvals.value,
    original_semantics: semanticBindings(input, original.value),
    current_semantics: semanticBindings(input, current.value),
  });
}

export function verifyReconciliationGates(
  input: SingleRepoFinalizationInput,
  reconciliation: ReconciliationReady,
): RuntimeResult<Readonly<Record<string, string>>> {
  const actual = new Map(reconciliation.gate_evidence.map((gate) => [gate.gate_id, gate]));
  if (actual.size !== input.task_packet.gates.length) {
    return failure(
      "integration.gate_set_drift",
      "reconciliation must return one exact result for every task gate",
      input.task_packet.task_id,
    );
  }
  const hashes: Record<string, string> = {};
  for (const gate of input.task_packet.gates) {
    const evidence = actual.get(gate.id);
    const completion = input.completion_packet.checks.find((check) => check.gate_id === gate.id);
    if (
      evidence === undefined ||
      completion === undefined ||
      evidence.definition_ref !== gate.definition_ref ||
      evidence.evidence_type !== gate.evidence_type ||
      evidence.required !== gate.required ||
      evidence.conflict_sensitive !== gate.conflict_sensitive ||
      evidence.status !== completion.status ||
      evidence.stdout_redacted !== completion.exact_result ||
      (gate.required && evidence.status !== "passed")
    ) {
      return failure(
        "integration.gate_failed",
        "current-base gate evidence differs from the completion packet or did not pass",
        gate.id,
      );
    }
    hashes[gate.id] = sha256(canonicalJson(evidence));
  }
  return success(Object.fromEntries(
    Object.entries(hashes).sort(([left], [right]) => compareUtf8(left, right)),
  ));
}
