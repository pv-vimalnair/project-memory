import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  canonicalJson,
  failure,
  isSameOrChildPath,
  sha256,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../../index.js";
import type { ResolvedGateExecution } from "../../planning/types.js";
import type {
  GateEvidence,
  SubmittedCheckEvidence,
} from "../contracts/index.js";
import type { GateRunner } from "./gate-runner.js";
import type { IntegrationGitClient } from "./integration-git-client.js";

const REVISION = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TASK_ID = /^TASK-[0-9A-HJKMNP-TV-Z]{26}$/;
const EVIDENCE_ID = /^EVD-[0-9A-HJKMNP-TV-Z]{26}$/;
export interface ReconciliationSemanticBindings {
  readonly accepted_decision_hashes: Readonly<Record<string, string>>;
  readonly profile_lock_hash: string;
  readonly authority_hash: string;
  readonly claimed_scope_hash: string;
  readonly behavior_hash: string;
  readonly evidence_policy_hash: string;
}
export interface PriorGateEvidence {
  readonly gate_id: string;
  readonly evidence_id: string;
  readonly source_revision: string;
  readonly original_result_hash: string;
  readonly applicability_statement: string;
  readonly evidence: GateEvidence;
}
export interface CarriedGateEvidence {
  readonly gate_id: string;
  readonly evidence_id: string;
  readonly source_revision: string;
  readonly original_result_hash: string;
  readonly applicability_statement: string;
}
export interface ReconcileInput {
  readonly repo: URL;
  readonly task_id: string;
  readonly original_base_revision: string;
  readonly worker_head_revision: string;
  readonly integration_head: string;
  readonly expected_changed_paths: readonly string[];
  readonly claimed_paths: readonly string[];
  readonly semantic_bindings: {
    readonly original: ReconciliationSemanticBindings;
    readonly current: ReconciliationSemanticBindings;
  };
  readonly gates: readonly ResolvedGateExecution[];
  readonly prior_evidence: readonly PriorGateEvidence[];
  readonly submitted_checks: Readonly<Record<string, SubmittedCheckEvidence>>;
}
export interface EvidenceApplicabilityInput {
  readonly repo: URL;
  readonly worktree: URL;
  readonly integration_head: string;
  readonly reconciled_head_revision: string;
  readonly gate: ResolvedGateExecution;
  readonly prior_evidence: PriorGateEvidence;
}
export interface EvidenceApplicabilityAssessment {
  readonly applicable: boolean;
  readonly reason_code: string | null;
}
export interface EvidenceApplicabilityValidator {
  assess(
    input: EvidenceApplicabilityInput,
  ): Promise<RuntimeResult<EvidenceApplicabilityAssessment>>;
}
export interface ReconciliationReady {
  readonly status: "ready";
  readonly original_base_revision: string;
  readonly integration_base_revision: string;
  readonly worker_head_revision: string;
  readonly reconciled_head_revision: string;
  readonly reconciled_tree: string;
  readonly replayed_commit_ids: readonly string[];
  readonly changed_paths: readonly string[];
  readonly gate_evidence: readonly GateEvidence[];
  readonly carried_evidence: readonly CarriedGateEvidence[];
  readonly temporary_artifacts_removed: true;
}
export interface ReconciliationReturnToWorker {
  readonly status: "return_to_worker";
  readonly original_base_revision: string;
  readonly integration_base_revision: string;
  readonly worker_head_revision: string;
  readonly reason_codes: readonly string[];
  readonly details: readonly string[];
  readonly temporary_artifacts_removed: true;
}
export type ReconciliationOutcome = ReconciliationReady | ReconciliationReturnToWorker;
export interface StaleBaseReconciler {
  reconcile(input: ReconcileInput): Promise<RuntimeResult<ReconciliationOutcome>>;
}
export interface StaleBaseReconcilerDependencies {
  readonly git: IntegrationGitClient;
  readonly gates: GateRunner;
  readonly applicability: EvidenceApplicabilityValidator;
  readonly temporary_root: URL;
}
interface CandidateContext {
  readonly input: ReconcileInput;
  readonly worktree: URL;
  readonly candidate_revision: string;
  readonly tree: string;
  readonly commits: readonly string[];
  readonly changed_paths: readonly string[];
}
function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}
function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson(unique(left)) === canonicalJson(unique(right));
}
function safePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}
function pathCovered(scope: string, candidate: string): boolean {
  if (scope === "**" || scope === candidate) return true;
  if (!scope.endsWith("/**")) return false;
  const base = scope.slice(0, -3);
  return candidate === base || candidate.startsWith(`${base}/`);
}
function validBindings(value: ReconciliationSemanticBindings): boolean {
  return (
    Object.entries(value.accepted_decision_hashes).every(([id, hash]) =>
      /^DEC-[0-9A-HJKMNP-TV-Z]{26}$/.test(id) && SHA256.test(hash)
    ) &&
    [
      value.profile_lock_hash,
      value.authority_hash,
      value.claimed_scope_hash,
      value.behavior_hash,
      value.evidence_policy_hash,
    ].every((hash) => SHA256.test(hash))
  );
}

function validateInput(input: ReconcileInput): RuntimeResult<true> {
  const gates = input.gates.map((gate) => gate.id);
  const prior = input.prior_evidence.map((evidence) => evidence.gate_id);
  if (
    input.repo.protocol !== "file:" ||
    !TASK_ID.test(input.task_id) ||
    !REVISION.test(input.original_base_revision) ||
    !REVISION.test(input.worker_head_revision) ||
    !REVISION.test(input.integration_head) ||
    input.expected_changed_paths.some((value) => !safePath(value)) ||
    input.claimed_paths.some((value) => !safePath(value) && value !== "**") ||
    new Set(gates).size !== gates.length ||
    new Set(prior).size !== prior.length ||
    !validBindings(input.semantic_bindings.original) ||
    !validBindings(input.semantic_bindings.current)
  ) {
    return failure(
      "stale.input_invalid",
      "reconciliation input must bind exact revisions, paths, gates, evidence, and semantic hashes",
      input.task_id,
    );
  }
  return success(true);
}
function semanticReasons(input: ReconcileInput): string[] {
  const original = input.semantic_bindings.original;
  const current = input.semantic_bindings.current;
  const reasons: string[] = [];
  if (canonicalJson(original.accepted_decision_hashes) !== canonicalJson(current.accepted_decision_hashes)) {
    reasons.push("stale.decision_changed");
  }
  if (original.profile_lock_hash !== current.profile_lock_hash) reasons.push("stale.profile_changed");
  if (original.authority_hash !== current.authority_hash) reasons.push("stale.authority_changed");
  if (original.claimed_scope_hash !== current.claimed_scope_hash) reasons.push("stale.claimed_scope_changed");
  if (original.behavior_hash !== current.behavior_hash) reasons.push("stale.behavior_changed");
  if (original.evidence_policy_hash !== current.evidence_policy_hash) {
    reasons.push("stale.evidence_policy_changed");
  }
  return reasons;
}

function returnWork(
  input: ReconcileInput,
  reasonCodes: readonly string[],
  details: readonly string[] = [],
): RuntimeResult<ReconciliationOutcome> {
  return success({
    status: "return_to_worker",
    original_base_revision: input.original_base_revision,
    integration_base_revision: input.integration_head,
    worker_head_revision: input.worker_head_revision,
    reason_codes: unique(reasonCodes),
    details: unique(details),
    temporary_artifacts_removed: true,
  });
}

function semanticReturn(
  input: ReconcileInput,
  reasons: readonly string[],
  details: readonly string[] = [],
): RuntimeResult<ReconciliationOutcome> {
  return returnWork(input, ["stale.semantic_conflict", ...reasons], details);
}

function validPrior(
  prior: PriorGateEvidence,
  gate: ResolvedGateExecution,
  workerHead: string,
): boolean {
  return (
    prior.gate_id === gate.id &&
    EVIDENCE_ID.test(prior.evidence_id) &&
    prior.source_revision === workerHead &&
    SHA256.test(prior.original_result_hash) &&
    prior.original_result_hash === sha256(canonicalJson(prior.evidence)) &&
    prior.applicability_statement.trim().length > 0 &&
    prior.evidence.gate_id === gate.id &&
    prior.evidence.definition_ref === gate.definition_ref &&
    prior.evidence.evidence_type === gate.evidence_type &&
    !prior.evidence.conflict_sensitive &&
    prior.evidence.status === "passed"
  );
}

async function evaluateCandidate(
  context: CandidateContext,
  dependencies: StaleBaseReconcilerDependencies,
): Promise<RuntimeResult<ReconciliationOutcome>> {
  const { input, worktree, candidate_revision: candidate } = context;
  const evidence: GateEvidence[] = [];
  const carried: CarriedGateEvidence[] = [];
  for (const gate of [...input.gates].sort((left, right) => compareUtf8(left.id, right.id))) {
    if (gate.conflict_sensitive) continue;
    const prior = input.prior_evidence.find((item) => item.gate_id === gate.id);
    if (prior === undefined || !validPrior(prior, gate, input.worker_head_revision)) {
      return returnWork(input, ["stale.evidence_invalid"], [gate.id]);
    }
    const applicable = await dependencies.applicability.assess({
      repo: input.repo,
      worktree,
      integration_head: input.integration_head,
      reconciled_head_revision: candidate,
      gate,
      prior_evidence: prior,
    });
    if (!applicable.ok) return applicable;
    if (!applicable.value.applicable) {
      return returnWork(input, [
        applicable.value.reason_code ?? "stale.evidence_not_applicable",
      ], [gate.id]);
    }
    evidence.push(prior.evidence);
    carried.push({
      gate_id: gate.id,
      evidence_id: prior.evidence_id,
      source_revision: prior.source_revision,
      original_result_hash: prior.original_result_hash,
      applicability_statement: prior.applicability_statement,
    });
  }

  for (const gate of [...input.gates].sort((left, right) => compareUtf8(left.id, right.id))) {
    if (!gate.conflict_sensitive) continue;
    const rerun = await dependencies.gates.run(
      worktree,
      gate,
      input.submitted_checks[gate.id],
    );
    if (!rerun.ok) {
      return returnWork(
        input,
        ["stale.gate_rerun_failed"],
        rerun.issues.map((issue) => `${gate.id}:${issue.code}`),
      );
    }
    evidence.push(rerun.value);
    if (gate.required && rerun.value.status !== "passed") {
      return returnWork(input, ["stale.gate_rerun_failed"], [gate.id]);
    }
  }

  return success({
    status: "ready",
    original_base_revision: input.original_base_revision,
    integration_base_revision: input.integration_head,
    worker_head_revision: input.worker_head_revision,
    reconciled_head_revision: candidate,
    reconciled_tree: context.tree,
    replayed_commit_ids: context.commits,
    changed_paths: context.changed_paths,
    gate_evidence: evidence.sort((left, right) => compareUtf8(left.gate_id, right.gate_id)),
    carried_evidence: carried.sort((left, right) => compareUtf8(left.gate_id, right.gate_id)),
    temporary_artifacts_removed: true,
  });
}

function cleanupIssue(code: string, error: unknown): RuntimeIssue {
  return {
    code,
    severity: "error",
    path: "",
    message: error instanceof Error ? error.message : String(error),
    references: [],
  };
}

function withCleanup<T>(result: RuntimeResult<T>, issues: readonly RuntimeIssue[]): RuntimeResult<T> {
  if (issues.length === 0) return result;
  return result.ok
    ? { ok: false, issues }
    : { ok: false, issues: [...result.issues, ...issues] };
}

async function reconcile(
  input: ReconcileInput,
  dependencies: StaleBaseReconcilerDependencies,
): Promise<RuntimeResult<ReconciliationOutcome>> {
  const valid = validateInput(input);
  if (!valid.ok) return valid;
  const semantic = semanticReasons(input);
  if (semantic.length > 0) return semanticReturn(input, semantic);

  try {
    const exists = await Promise.all([
      dependencies.git.objectExists(input.repo, input.original_base_revision),
      dependencies.git.objectExists(input.repo, input.worker_head_revision),
      dependencies.git.objectExists(input.repo, input.integration_head),
    ]);
    if (exists.some((value) => !value)) {
      return failure("stale.revision_missing", "reconciliation revision does not exist", input.task_id);
    }
    const [workerBase, integrationBase] = await Promise.all([
      dependencies.git.mergeBase(input.repo, input.original_base_revision, input.worker_head_revision),
      dependencies.git.mergeBase(input.repo, input.original_base_revision, input.integration_head),
    ]);
    if (
      workerBase !== input.original_base_revision ||
      integrationBase !== input.original_base_revision
    ) {
      return semanticReturn(input, ["stale.history_diverged"]);
    }
    const originalPaths = unique(await dependencies.git.changedPaths(
      input.repo,
      input.original_base_revision,
      input.worker_head_revision,
    ));
    if (
      !sameStrings(originalPaths, input.expected_changed_paths) ||
      originalPaths.some((candidate) =>
        !input.claimed_paths.some((scope) => pathCovered(scope, candidate))
      )
    ) {
      return semanticReturn(input, ["stale.claimed_scope_changed"], originalPaths);
    }
  } catch (error: unknown) {
    return failure(
      "stale.preflight_failed",
      error instanceof Error ? error.message : String(error),
      input.task_id,
    );
  }

  if (dependencies.temporary_root.protocol !== "file:") {
    return failure(
      "stale.temporary_root_invalid",
      "temporary reconciliation root must be a file URL outside the repository",
      input.task_id,
    );
  }
  const repoPath = fileURLToPath(input.repo);
  const temporaryPath = fileURLToPath(dependencies.temporary_root);
  if (isSameOrChildPath(repoPath, temporaryPath)) {
    return failure(
      "stale.temporary_root_invalid",
      "temporary reconciliation root must be a file URL outside the repository",
      input.task_id,
    );
  }

  let generatedRoot: URL | null = null;
  let worktree: URL | null = null;
  let worktreeCreated = false;
  let result: RuntimeResult<ReconciliationOutcome>;
  const cleanup: RuntimeIssue[] = [];
  try {
    await mkdir(dependencies.temporary_root, { recursive: true });
    const generatedPath = await mkdtemp(path.join(temporaryPath, "reconcile-"));
    generatedRoot = pathToFileURL(`${generatedPath}${path.sep}`);
    worktree = pathToFileURL(path.join(generatedPath, "worktree"));
    const stale = input.original_base_revision !== input.integration_head;
    const startingRevision = stale
      ? input.integration_head
      : input.worker_head_revision;
    await dependencies.git.createDetachedWorktree(input.repo, startingRevision, worktree);
    worktreeCreated = true;
    const commits = stale
      ? await dependencies.git.listCommits(
          input.repo,
          input.original_base_revision,
          input.worker_head_revision,
        )
      : [];
    let conflict = false;
    for (const commit of commits) {
      const replayed = await dependencies.git.cherryPickNoCommit(worktree, commit);
      if (replayed.exit_code !== 0 || replayed.timed_out || replayed.output_truncated) {
        conflict = true;
        break;
      }
    }
    if (conflict) {
      result = returnWork(input, ["stale.textual_conflict"]);
    } else {
      await dependencies.git.stageAll(worktree);
      const tree = await dependencies.git.writeTree(worktree);
      const candidate = stale
        ? await dependencies.git.commitTree(
            input.repo,
            tree,
            input.integration_head,
            `project-memory(reconcile): ${input.task_id}`,
          )
        : input.worker_head_revision;
      const paths = unique(await dependencies.git.changedPaths(
        input.repo,
        input.integration_head,
        candidate,
      ));
      if (
        !sameStrings(paths, input.expected_changed_paths) ||
        paths.some((candidatePath) =>
          !input.claimed_paths.some((scope) => pathCovered(scope, candidatePath))
        )
      ) {
        result = semanticReturn(input, ["stale.claimed_scope_changed"], paths);
      } else {
        result = await evaluateCandidate({
          input,
          worktree,
          candidate_revision: candidate,
          tree,
          commits,
          changed_paths: paths,
        }, dependencies);
      }
    }
  } catch (error: unknown) {
    result = failure(
      "stale.reconciliation_failed",
      error instanceof Error ? error.message : String(error),
      input.task_id,
    );
  } finally {
    if (worktreeCreated && worktree !== null) {
      try {
        await dependencies.git.removeWorktree(input.repo, worktree);
      } catch (error: unknown) {
        cleanup.push(cleanupIssue("stale.worktree_cleanup_failed", error));
      }
    }
    if (generatedRoot !== null) {
      try {
        await rm(generatedRoot, { recursive: true, force: true });
      } catch (error: unknown) {
        cleanup.push(cleanupIssue("stale.temporary_cleanup_failed", error));
      }
    }
  }
  return withCleanup(result, cleanup);
}

export function createStaleBaseReconciler(
  dependencies: StaleBaseReconcilerDependencies,
): StaleBaseReconciler {
  return { reconcile: (input) => reconcile(input, dependencies) };
}
