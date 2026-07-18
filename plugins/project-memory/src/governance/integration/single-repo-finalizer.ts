import {
  canonicalJson,
  failure,
  sha256,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../../index.js";
import { finalizeSingleRepoTransaction } from "./single-repo-transaction.js";
import {
  hitSingleRepoFault,
  type IntegrationReceipt,
  type PendingIntegration,
  type SingleRepoFinalizationInput,
  type SingleRepoFinalizer,
  type SingleRepoFinalizerDependencies,
  type ValidatedIntegration,
} from "./single-repo-contracts.js";
import {
  cloneFinalizationInput,
  preflightSingleRepo,
  validateBindings,
  verifyReconciliationGates,
} from "./single-repo-validation.js";
import { tokenIsExact, validatedToken } from "./single-repo-token.js";

export {
  SINGLE_REPO_FAULT_POINTS,
  type IntegrationReceipt,
  type SingleRepoFaultInjector,
  type SingleRepoFaultPoint,
  type SingleRepoFinalizationInput,
  type SingleRepoFinalizer,
  type SingleRepoFinalizerDependencies,
  type ValidatedIntegration,
} from "./single-repo-contracts.js";

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function appendIssues<T>(
  result: RuntimeResult<T>,
  issues: readonly RuntimeIssue[],
): RuntimeResult<T> {
  if (issues.length === 0) return result;
  return result.ok
    ? { ok: false, issues }
    : { ok: false, issues: [...result.issues, ...issues] };
}

function thrownFailure<T>(
  code: string,
  error: unknown,
  path: string,
): RuntimeResult<T> {
  return failure(
    code,
    error instanceof Error ? error.message : String(error),
    path,
  );
}

function tokenMatchesPending(
  supplied: ValidatedIntegration,
  pending: PendingIntegration,
): boolean {
  const input = pending.input;
  return (
    tokenIsExact(supplied) &&
    sameCanonical(supplied, pending.token) &&
    supplied.root_id === input.task_packet.root.id &&
    supplied.target_ref === input.target_ref &&
    supplied.expected_head === input.expected_head &&
    supplied.task_packet_hash === sha256(canonicalJson(input.task_packet)) &&
    supplied.completion_hash === sha256(canonicalJson(input.completion_packet)) &&
    supplied.lease_nonce_hash === sha256(pending.lease.nonce) &&
    supplied.reconciled_head_revision ===
      pending.reconciliation.reconciled_head_revision
  );
}

function tokenCurrent(token: ValidatedIntegration, now: Date): RuntimeResult<true> {
  if (!Number.isFinite(now.getTime())) {
    return failure("integration.clock_invalid", "integration clock is invalid");
  }
  const validatedAt = Date.parse(token.validated_at);
  const expiresAt = Date.parse(token.expires_at);
  if (
    !Number.isFinite(validatedAt) ||
    !Number.isFinite(expiresAt) ||
    validatedAt > now.getTime() ||
    expiresAt <= now.getTime()
  ) {
    return failure(
      "integration.validation_expired",
      "validated integration token is expired or has invalid timestamps",
      token.validation_id,
    );
  }
  return success(true);
}

function returnToWorker(
  taskId: string,
  reasonCodes: readonly string[],
  details: readonly string[],
): RuntimeResult<never> {
  return failure(
    "integration.return_to_worker",
    "stale-base reconciliation requires fresh worker action",
    taskId,
    [...reasonCodes, ...details],
  );
}

export function createSingleRepoFinalizer(
  dependencies: SingleRepoFinalizerDependencies,
): SingleRepoFinalizer {
  const pendingById = new Map<string, PendingIntegration>();

  async function validate(
    supplied: SingleRepoFinalizationInput,
  ): Promise<RuntimeResult<ValidatedIntegration>> {
    const initial = await preflightSingleRepo(dependencies, supplied);
    if (!initial.ok) return initial;
    const input = cloneFinalizationInput(supplied);
    const acquired = await dependencies.leases.acquire({
      repo: input.root,
      root_id: input.task_packet.root.id,
      holder_id: dependencies.integrator_id ?? "project-memory-integrator",
      authority_class: "integrator",
      base_revision: input.expected_head,
      target_ref: input.target_ref,
      ttl_ms: dependencies.lease_ttl_ms ?? 5 * 60_000,
    });
    if (!acquired.ok) return acquired;

    let lease = acquired.value;
    let retained = false;
    let result: RuntimeResult<ValidatedIntegration>;
    const cleanup: RuntimeIssue[] = [];
    try {
      await hitSingleRepoFault(dependencies.faults, "after_lease");
      const checkedHead = await preflightSingleRepo(dependencies, input);
      if (!checkedHead.ok) {
        result = checkedHead;
      } else {
        const bound = await validateBindings(dependencies, input, dependencies.clock.now());
        if (!bound.ok) {
          result = bound;
        } else {
          const reconciled = await dependencies.reconciler.reconcile({
            repo: input.root,
            task_id: input.task_packet.task_id,
            original_base_revision: input.completion_packet.original_base_revision,
            worker_head_revision: input.completion_packet.worker_head_revision,
            integration_head: input.expected_head,
            expected_changed_paths: bound.value.changed_paths,
            claimed_paths: bound.value.effective_task.claim.paths,
            semantic_bindings: {
              original: bound.value.original_semantics,
              current: bound.value.current_semantics,
            },
            gates: bound.value.effective_task.gates,
            prior_evidence: input.prior_gate_evidence,
            submitted_checks: input.submitted_checks,
          });
          if (!reconciled.ok) {
            result = reconciled;
          } else if (reconciled.value.status === "return_to_worker") {
            result = returnToWorker(
              input.task_packet.task_id,
              reconciled.value.reason_codes,
              reconciled.value.details,
            );
          } else {
            await hitSingleRepoFault(dependencies.faults, "after_reconcile");
            const gates = verifyReconciliationGates(input, reconciled.value);
            if (!gates.ok) {
              result = gates;
            } else {
              await hitSingleRepoFault(dependencies.faults, "after_gates");
              const renewed = await dependencies.leases.heartbeat(lease);
              if (!renewed.ok) {
                result = renewed;
              } else {
                lease = renewed.value;
                const now = dependencies.clock.now();
                const token = validatedToken(
                  input,
                  lease.nonce,
                  reconciled.value,
                  bound.value.approval_hashes,
                  gates.value,
                  now.toISOString(),
                  lease.expires_at,
                );
                if (pendingById.has(token.validation_id)) {
                  result = failure(
                    "integration.validation_active",
                    "an identical integration validation is already active",
                    token.validation_id,
                  );
                } else {
                  pendingById.set(token.validation_id, {
                    input,
                    lease,
                    reconciliation: reconciled.value,
                    approval_ids: bound.value.authority.approval_ids,
                    approval_hashes: bound.value.approval_hashes,
                    gate_evidence_hashes: gates.value,
                    token,
                  });
                  retained = true;
                  result = success(token);
                }
              }
            }
          }
        }
      }
    } catch (error: unknown) {
      result = thrownFailure(
        "integration.validation_failed",
        error,
        input.task_packet.task_id,
      );
    } finally {
      if (!retained) {
        const released = await dependencies.leases.release(lease);
        if (!released.ok) cleanup.push(...released.issues);
      }
    }
    return appendIssues(result, cleanup);
  }

  async function finalize(
    token: ValidatedIntegration,
  ): Promise<RuntimeResult<IntegrationReceipt>> {
    const pending = pendingById.get(token.validation_id);
    if (pending === undefined) {
      return failure(
        "integration.validation_unknown",
        "validated integration token is unknown or already consumed",
        token.validation_id,
      );
    }
    pendingById.delete(token.validation_id);
    let active = pending;
    let result: RuntimeResult<IntegrationReceipt>;
    const cleanup: RuntimeIssue[] = [];
    try {
      if (!tokenMatchesPending(token, pending)) {
        result = failure(
          "integration.validated_binding_drift",
          "validated integration bindings changed before finalization",
          token.validation_id,
        );
      } else {
        const current = tokenCurrent(token, dependencies.clock.now());
        if (!current.ok) {
          result = current;
        } else {
          const preflight = await preflightSingleRepo(dependencies, pending.input);
          if (!preflight.ok) {
            result = preflight;
          } else {
            const renewed = await dependencies.leases.heartbeat(pending.lease);
            if (!renewed.ok) {
              result = renewed;
            } else {
              active = { ...pending, lease: renewed.value };
              const bindings = await validateBindings(
                dependencies,
                pending.input,
                dependencies.clock.now(),
              );
              if (!bindings.ok) {
                result = bindings;
              } else if (!sameCanonical(
                bindings.value.approval_hashes,
                pending.approval_hashes,
              )) {
                result = failure(
                  "integration.approval_binding_drift",
                  "approval hashes changed after integration validation",
                  token.validation_id,
                );
              } else {
                const gates = verifyReconciliationGates(
                  pending.input,
                  pending.reconciliation,
                );
                if (!gates.ok) {
                  result = gates;
                } else if (!sameCanonical(gates.value, pending.gate_evidence_hashes)) {
                  result = failure(
                    "integration.gate_binding_drift",
                    "gate-evidence hashes changed after integration validation",
                    token.validation_id,
                  );
                } else {
                  result = await finalizeSingleRepoTransaction(
                    dependencies,
                    active,
                    bindings.value,
                  );
                }
              }
            }
          }
        }
      }
    } catch (error: unknown) {
      result = thrownFailure(
        "integration.finalization_failed",
        error,
        pending.input.task_packet.task_id,
      );
    } finally {
      const released = await dependencies.leases.release(active.lease);
      if (!released.ok) cleanup.push(...released.issues);
    }
    return appendIssues(result, cleanup);
  }

  return { validate, finalize };
}
