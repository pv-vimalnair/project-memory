import { lstat, readFile } from "node:fs/promises";

import {
  applyFileTransaction,
  canonicalJson,
  failure,
  resolveInside,
  sha256,
  success,
  type PlannedWrite,
  type RuntimeResult,
} from "../../index.js";
import type { ArchivePlan } from "../archive/content-addressed-archive.js";
import { redactArchiveBytes } from "../archive/redactor.js";
import type { CanonicalRecord, GateEvidence } from "../contracts/index.js";
import { createAppendOnlyEventStore } from "../events/append-only-event-store.js";
import { recordWrite } from "../records/record-path.js";
import type { CanonicalSnapshot } from "../snapshot/snapshot-contracts.js";
import {
  parseWorkDocument,
  taskDocumentPath,
  transitionWorkDocument,
} from "../work/work-document.js";
import {
  auditManifestPath,
  type AuditArchiveReceipt,
  type AuditEvidenceBundle,
} from "./audit-evidence.js";
import type {
  PendingIntegration,
  SingleRepoFinalizerDependencies,
} from "./single-repo-contracts.js";
import type { ValidatedBindings } from "./single-repo-validation.js";

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

async function apply(
  root: URL,
  writes: readonly PlannedWrite[],
): Promise<RuntimeResult<true>> {
  const result = await applyFileTransaction(root, writes);
  return result.ok ? success(true, result.warnings) : result;
}

function scanWrites(writes: readonly PlannedWrite[]): RuntimeResult<true> {
  for (const write of writes) {
    const redacted = redactArchiveBytes(write.bytes);
    if (!redacted.ok) return redacted;
    if (!Buffer.from(redacted.value.bytes).equals(Buffer.from(write.bytes))) {
      return failure(
        "integration.secret_detected",
        "completion-derived canonical writes must not contain unredacted credentials",
        write.relative_path,
        redacted.value.report.rule_ids,
      );
    }
  }
  return success(true);
}

export interface CompletionArchiveBundle {
  readonly plan: ArchivePlan;
  readonly receipt: AuditArchiveReceipt;
}

export function planCompletionArchive(
  dependencies: SingleRepoFinalizerDependencies,
  pending: PendingIntegration,
): RuntimeResult<CompletionArchiveBundle> {
  const completion = pending.input.completion_packet;
  const bytes = new TextEncoder().encode(canonicalJson(completion));
  const plan = dependencies.archives.planIngest({
    root_id: pending.input.task_packet.root.id,
    target_ref: pending.input.target_ref,
    expected_head: pending.input.expected_head,
    profile_lock_hash: pending.input.task_packet.root.profile_lock_hash,
    actor_id: dependencies.integrator_id ?? "project-memory-integrator",
    object_kind: "completion-packet",
    media_type: "application/json",
    source_refs: [
      `packet:${completion.packet_id}`,
      `task:${completion.task_id}`,
      `worker:${completion.worker_head_revision}`,
    ],
    bytes,
  });
  if (!plan.ok) return plan;
  return success({
    plan: plan.value,
    receipt: {
      source_ref: `packet:${completion.packet_id}`,
      object_kind: "completion-packet",
      source_hash: plan.value.metadata.source_hash,
      stored_hash: plan.value.metadata.object_hash,
      manifest_hash: plan.value.metadata.manifest_hash,
      redaction_report: plan.value.metadata.redaction_report,
    },
  });
}

function changeRecord(
  pending: PendingIntegration,
  bindings: ValidatedBindings,
  change: PendingIntegration["input"]["completion_packet"]["changes"][number],
  evidenceIds: readonly string[],
): CanonicalRecord {
  const task = pending.input.task_packet;
  return {
    id: change.change_id,
    type: "change",
    title: `Validated change ${change.change_id}`,
    status: "closed",
    root_id: task.root.id,
    component_ids: unique(task.component_duties.map((duty) => duty.component_id)),
    initiative_id: task.initiative_id,
    workstream_id: task.workstream_id,
    task_id: task.task_id,
    actor_id: pending.input.completion_packet.actor,
    authority_class: "worker",
    created_at: pending.input.completion_packet.submitted_at,
    original_base_revision: pending.input.completion_packet.original_base_revision,
    integration_base_revision: pending.input.expected_head,
    catalog_versions: [...bindings.current_snapshot.catalog_versions],
    relationships: evidenceIds.map((id) => ({
      type: "evidences" as const,
      target_id: id,
      note: null,
    })),
    payload: {
      summary: change.rationale,
      files: unique(change.files),
      commits: unique(change.commits),
      artifacts: unique(change.artifacts),
      authorization_refs: unique(change.authorization_refs),
    },
  };
}

function evidenceRecord(
  pending: PendingIntegration,
  bindings: ValidatedBindings,
  id: string,
  evidence: GateEvidence,
): CanonicalRecord {
  const task = pending.input.task_packet;
  return {
    id,
    type: "evidence",
    title: `Gate evidence for ${evidence.gate_id}`,
    status: "accepted",
    root_id: task.root.id,
    component_ids: unique(task.component_duties.map((duty) => duty.component_id)),
    initiative_id: task.initiative_id,
    workstream_id: task.workstream_id,
    task_id: task.task_id,
    actor_id: dependenciesActor(pending),
    authority_class: "integrator",
    created_at: evidence.occurred_at,
    original_base_revision: pending.input.completion_packet.original_base_revision,
    integration_base_revision: pending.input.expected_head,
    catalog_versions: [...bindings.current_snapshot.catalog_versions],
    relationships: [],
    payload: {
      evidence_type: evidence.evidence_type,
      exact_result: canonicalJson(evidence),
      source_refs: unique([
        `gate:${evidence.gate_id}`,
        `definition:${evidence.definition_ref}`,
        `worker:${pending.input.completion_packet.worker_head_revision}`,
      ]),
      hashes: { gate_evidence: sha256(canonicalJson(evidence)) },
      not_run_reason: evidence.not_run_reason,
    },
  };
}

function dependenciesActor(pending: PendingIntegration): string {
  return pending.lease.holder_id;
}

function factualRecordWrites(
  pending: PendingIntegration,
  bindings: ValidatedBindings,
  candidate: CanonicalSnapshot,
): RuntimeResult<readonly PlannedWrite[]> {
  const completion = pending.input.completion_packet;
  if (completion.records_updated.length > 0) {
    return failure(
      "integration.record_update_forbidden",
      "immutable canonical records must be superseded, never updated in place",
      completion.task_id,
      completion.records_updated,
    );
  }
  const evidenceById = new Map<string, GateEvidence>();
  for (const check of completion.checks) {
    if (check.evidence_id === null) continue;
    const evidence = pending.reconciliation.gate_evidence.find(
      (candidateEvidence) => candidateEvidence.gate_id === check.gate_id,
    );
    if (evidence === undefined || evidenceById.has(check.evidence_id)) {
      return failure(
        "integration.gate_record_invalid",
        "completion evidence IDs must map one-to-one to current gate evidence",
        check.gate_id,
      );
    }
    evidenceById.set(check.evidence_id, evidence);
  }
  const expectedIds = unique([
    ...completion.changes.map((change) => change.change_id),
    ...evidenceById.keys(),
    ...completion.proposed_decision_ids,
  ]);
  if (canonicalJson(unique(completion.records_created)) !== canonicalJson(expectedIds)) {
    return failure(
      "integration.record_set_drift",
      "completion record inventory must equal changes, gate evidence, and proposals",
      completion.task_id,
      expectedIds,
    );
  }
  for (const id of completion.proposed_decision_ids) {
    const proposal = candidate.records.find((record) => record.id === id);
    if (proposal?.type !== "decision" || proposal.status !== "proposed") {
      return failure(
        "integration.proposed_record_missing",
        "proposed decisions require exact worker-authored canonical records",
        id,
      );
    }
  }
  const evidenceIds = [...evidenceById.keys()].sort(compareUtf8);
  const records = [
    ...completion.changes.map((change) => changeRecord(pending, bindings, change, evidenceIds)),
    ...[...evidenceById].map(([id, evidence]) =>
      evidenceRecord(pending, bindings, id, evidence)
    ),
  ];
  const writes: PlannedWrite[] = [];
  for (const record of records) {
    const existing = candidate.records.find((candidateRecord) => candidateRecord.id === record.id);
    if (existing !== undefined) {
      if (canonicalJson(existing) !== canonicalJson(record)) {
        return failure(
          "integration.worker_record_drift",
          "worker-authored canonical record differs from verified factual projection",
          record.id,
        );
      }
    } else {
      writes.push(recordWrite(record));
    }
  }
  return success(writes.sort((left, right) =>
    compareUtf8(left.relative_path, right.relative_path)
  ));
}

async function taskWrite(
  pending: PendingIntegration,
  worktree: URL,
): Promise<RuntimeResult<PlannedWrite>> {
  const task = pending.input.task_packet;
  const relativePath = taskDocumentPath(task.workstream_id, task.task_id);
  const resolved = await resolveInside(worktree, relativePath);
  if (!resolved.ok) return resolved;
  try {
    const info = await lstat(resolved.value);
    if (info.isSymbolicLink() || !info.isFile()) {
      return failure("integration.task_path_unsafe", "task document must be a regular file", relativePath);
    }
    const bytes = new Uint8Array(await readFile(resolved.value));
    const parsed = parseWorkDocument(bytes, "task_packet", task.task_id, task.root.id);
    if (!parsed.ok) return parsed;
    if (parsed.value.status !== "submitted") {
      return failure(
        "integration.task_state_invalid",
        "only a submitted task can become integrated_verified",
        task.task_id,
      );
    }
    return success({
      relative_path: relativePath,
      bytes: transitionWorkDocument(parsed.value, "integrated_verified", pending.approval_ids),
      expected_existing_sha256: sha256(bytes),
      mode: "replace",
    });
  } catch (error: unknown) {
    return failure(
      "integration.task_read_failed",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
}

export interface IntegrationSourceBundle {
  readonly audit: AuditEvidenceBundle;
  readonly archive: CompletionArchiveBundle;
  readonly writes: readonly PlannedWrite[];
}

export async function applyIntegrationSources(
  dependencies: SingleRepoFinalizerDependencies,
  pending: PendingIntegration,
  bindings: ValidatedBindings,
  candidate: CanonicalSnapshot,
  archive: CompletionArchiveBundle,
  worktree: URL,
): Promise<RuntimeResult<IntegrationSourceBundle>> {
  const records = factualRecordWrites(pending, bindings, candidate);
  if (!records.ok) return records;
  const audit = dependencies.audit.build({
    root_id: pending.input.task_packet.root.id,
    component_ids: pending.input.task_packet.component_duties.map((duty) => duty.component_id),
    initiative_id: pending.input.task_packet.initiative_id,
    workstream_id: pending.input.task_packet.workstream_id,
    task_id: pending.input.task_packet.task_id,
    packet_id: pending.input.task_packet.packet_id,
    claim_id: pending.input.task_packet.claim.id,
    worker_id: pending.input.completion_packet.actor,
    integrated_by: dependencies.integrator_id ?? "project-memory-integrator",
    original_base_revision: pending.input.completion_packet.original_base_revision,
    integration_base_revision: pending.input.expected_head,
    worker_head_revision: pending.input.completion_packet.worker_head_revision,
    changed_paths: bindings.changed_paths,
    authorization_refs: unique(pending.input.completion_packet.changes.flatMap(
      (change) => change.authorization_refs,
    )),
    approval_ids: pending.approval_ids,
    lease: { holder_id: pending.lease.holder_id, nonce: pending.lease.nonce },
    gates: pending.reconciliation.gate_evidence,
    profile_version: bindings.current_snapshot.profile_lock.schema_version,
    profile_lock_hash: bindings.current_snapshot.profile_lock_hash,
    catalog_version: bindings.current_snapshot.catalog_versions[0] ?? "",
    catalog_lock_hash: bindings.current_snapshot.selected_catalog_lock_hash,
    generated_view_hashes: {},
    completion_archive_manifest_hash: archive.receipt.manifest_hash,
    archive_receipts: [archive.receipt],
    prepared_commit_hash: null,
    final_commit_hash: null,
    remaining_risks: pending.input.completion_packet.remaining_risk_ids,
  });
  if (!audit.ok) return audit;
  if (
    candidate.records.some((record) => record.id === audit.value.record.id) ||
    records.value.some((write) => write.relative_path.endsWith(`/${audit.value.record.id}.json`))
  ) {
    return failure(
      "integration.audit_id_collision",
      "integration audit evidence ID already exists",
      audit.value.record.id,
    );
  }
  const task = await taskWrite(pending, worktree);
  if (!task.ok) return task;
  const initialWrites = [
    ...records.value,
    ...audit.value.writes,
    task.value,
  ];
  const initialSafe = scanWrites(initialWrites);
  if (!initialSafe.ok) return initialSafe;
  const applied = await apply(worktree, initialWrites);
  if (!applied.ok) return applied;

  const events = createAppendOnlyEventStore();
  const evidenceIds = unique([
    audit.value.record.id,
    ...pending.input.completion_packet.checks.flatMap((check) =>
      check.evidence_id === null ? [] : [check.evidence_id]
    ),
  ]);
  const validated = await events.planAppend(worktree, {
    aggregate_id: pending.input.task_packet.task_id,
    event_type: "integration_validated",
    occurred_at: pending.token.validated_at,
    actor_id: dependencies.integrator_id ?? "project-memory-integrator",
    authority_class: "integrator",
    evidence_ids: evidenceIds,
    payload: {
      packet_id: pending.input.task_packet.packet_id,
      claim_id: pending.input.task_packet.claim.id,
      completion_hash: pending.token.completion_hash,
      gate_evidence_hashes: pending.gate_evidence_hashes,
    },
  });
  if (!validated.ok) return validated;
  const validatedSafe = scanWrites([validated.value]);
  if (!validatedSafe.ok) return validatedSafe;
  const validatedApplied = await apply(worktree, [validated.value]);
  if (!validatedApplied.ok) return validatedApplied;
  const integrated = await events.planAppend(worktree, {
    aggregate_id: pending.input.task_packet.task_id,
    event_type: "integrated_verified",
    occurred_at: dependencies.clock.now().toISOString(),
    actor_id: dependencies.integrator_id ?? "project-memory-integrator",
    authority_class: "integrator",
    evidence_ids: evidenceIds,
    payload: {
      packet_id: pending.input.task_packet.packet_id,
      claim_id: pending.input.task_packet.claim.id,
      integration_base_revision: pending.input.expected_head,
      completion_archive_manifest_hash: archive.receipt.manifest_hash,
      audit_manifest_path: auditManifestPath(pending.input.task_packet.packet_id),
    },
  });
  if (!integrated.ok) return integrated;
  const integratedSafe = scanWrites([integrated.value]);
  if (!integratedSafe.ok) return integratedSafe;
  const integratedApplied = await apply(worktree, [integrated.value]);
  if (!integratedApplied.ok) return integratedApplied;
  return success({
    audit: audit.value,
    archive,
    writes: [...initialWrites, validated.value, integrated.value],
  });
}

export async function applyArchive(
  worktree: URL,
  archive: CompletionArchiveBundle,
): Promise<RuntimeResult<true>> {
  const safe = scanWrites(archive.plan.writes);
  return safe.ok ? apply(worktree, archive.plan.writes) : safe;
}
