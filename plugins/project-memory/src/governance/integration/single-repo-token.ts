import { canonicalJson, sha256 } from "../../index.js";
import type { ReconciliationReady } from "./stale-base-reconciler.js";
import type {
  SingleRepoFinalizationInput,
  ValidatedIntegration,
} from "./single-repo-contracts.js";

export function validatedToken(
  input: SingleRepoFinalizationInput,
  leaseNonce: string,
  reconciliation: ReconciliationReady,
  approvalHashes: Readonly<Record<string, string>>,
  gateHashes: Readonly<Record<string, string>>,
  validatedAt: string,
  expiresAt: string,
): ValidatedIntegration {
  const body: Omit<ValidatedIntegration, "validation_id"> = {
    schema_version: "1.0.0",
    root_id: input.task_packet.root.id,
    target_ref: input.target_ref,
    expected_head: input.expected_head,
    task_packet_hash: sha256(canonicalJson(input.task_packet)),
    completion_hash: sha256(canonicalJson(input.completion_packet)),
    approval_hashes: approvalHashes,
    gate_evidence_hashes: gateHashes,
    lease_nonce_hash: sha256(leaseNonce),
    reconciled_head_revision: reconciliation.reconciled_head_revision,
    validated_at: validatedAt,
    expires_at: expiresAt,
  };
  return { ...body, validation_id: sha256(canonicalJson(body)) };
}

export function tokenIsExact(token: ValidatedIntegration): boolean {
  const { validation_id: ignored, ...body } = token;
  void ignored;
  return sha256(canonicalJson(body)) === token.validation_id;
}
