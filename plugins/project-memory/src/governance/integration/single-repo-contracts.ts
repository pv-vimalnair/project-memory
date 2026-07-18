import type {
  Clock,
  RuntimeResult,
} from "../../index.js";
import type {
  Approval,
  CompletionPacket,
  TaskPacket,
} from "../../planning/types.js";
import type { ProfileVerifier } from "../../profile/verify-profile.js";
import type { ArchiveStore } from "../archive/content-addressed-archive.js";
import type {
  DirectionalAcceptance,
  ExternalActionExecution,
} from "../authority/authority-coverage.js";
import type { SubmittedCheckEvidence } from "../contracts/index.js";
import type { CanonicalSnapshotBuilder } from "../snapshot/snapshot-contracts.js";
import type { ViewGenerator } from "../views/generate-views.js";
import type { AuditEvidenceBuilder } from "./audit-evidence.js";
import type { IntegrationGitClient } from "./integration-git-client.js";
import type {
  IntegrationLeaseStore,
  LeaseToken,
} from "./integration-lease-store.js";
import type {
  PriorGateEvidence,
  ReconciliationReady,
  StaleBaseReconciler,
} from "./stale-base-reconciler.js";

export const SINGLE_REPO_FAULT_POINTS = Object.freeze([
  "after_lease",
  "after_reconcile",
  "after_gates",
  "after_completion_archive",
  "after_record_plan",
  "after_view_plan",
  "after_tree_write",
  "before_ref_update",
] as const);

export type SingleRepoFaultPoint = (typeof SINGLE_REPO_FAULT_POINTS)[number];

export interface SingleRepoFaultInjector {
  hit(point: SingleRepoFaultPoint): void | Promise<void>;
}

export interface SingleRepoFinalizationInput {
  readonly root: URL;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly task_packet: TaskPacket;
  readonly completion_packet: CompletionPacket;
  readonly expected_issuer: string;
  readonly recorded_task_approvals: readonly Approval[];
  readonly prior_gate_evidence: readonly PriorGateEvidence[];
  readonly submitted_checks: Readonly<Record<string, SubmittedCheckEvidence>>;
  readonly directional_acceptance: DirectionalAcceptance | null;
  readonly external_action: ExternalActionExecution | null;
}

export interface ValidatedIntegration {
  readonly schema_version: "1.0.0";
  readonly validation_id: string;
  readonly root_id: string;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly task_packet_hash: string;
  readonly completion_hash: string;
  readonly approval_hashes: Readonly<Record<string, string>>;
  readonly gate_evidence_hashes: Readonly<Record<string, string>>;
  readonly lease_nonce_hash: string;
  readonly reconciled_head_revision: string;
  readonly validated_at: string;
  readonly expires_at: string;
}

export interface IntegrationReceipt {
  readonly schema_version: "1.0.0";
  readonly status: "integrated_verified";
  readonly root_id: string;
  readonly task_id: string;
  readonly packet_id: string;
  readonly claim_id: string;
  readonly previous_revision: string;
  readonly original_base_revision: string;
  readonly integration_base_revision: string;
  readonly worker_head_revision: string;
  readonly reconciled_head_revision: string;
  readonly commit_revision: string;
  readonly evidence_id: string;
  readonly audit_manifest_path: string;
  readonly audit_manifest_hash: string;
  readonly completion_archive_manifest_hash: string;
  readonly archive_manifest_hashes: readonly string[];
  readonly gate_evidence_hashes: Readonly<Record<string, string>>;
  readonly generated_view_hashes: Readonly<Record<string, string>>;
  readonly transaction_audit_path: string;
  readonly transaction_audit_hash: string;
  readonly integrated_at: string;
}

export interface SingleRepoFinalizer {
  validate(input: SingleRepoFinalizationInput): Promise<RuntimeResult<ValidatedIntegration>>;
  finalize(input: ValidatedIntegration): Promise<RuntimeResult<IntegrationReceipt>>;
}

export interface SingleRepoFinalizerDependencies {
  readonly clock: Clock;
  readonly git: IntegrationGitClient;
  readonly leases: IntegrationLeaseStore;
  readonly reconciler: StaleBaseReconciler;
  readonly snapshots: CanonicalSnapshotBuilder;
  readonly views: Pick<ViewGenerator, "plan">;
  readonly archives: ArchiveStore;
  readonly audit: AuditEvidenceBuilder;
  readonly verifier: ProfileVerifier;
  readonly temporary_root: URL;
  readonly faults?: SingleRepoFaultInjector;
  readonly integrator_id?: string;
  readonly lease_ttl_ms?: number;
}

export interface PendingIntegration {
  readonly input: SingleRepoFinalizationInput;
  readonly lease: LeaseToken;
  readonly reconciliation: ReconciliationReady;
  readonly approval_ids: readonly string[];
  readonly approval_hashes: Readonly<Record<string, string>>;
  readonly gate_evidence_hashes: Readonly<Record<string, string>>;
  readonly token: ValidatedIntegration;
}

export async function hitSingleRepoFault(
  faults: SingleRepoFaultInjector | undefined,
  point: SingleRepoFaultPoint,
): Promise<void> {
  await faults?.hit(point);
}
