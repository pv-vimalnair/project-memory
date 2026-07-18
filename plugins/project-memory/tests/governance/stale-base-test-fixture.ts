import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  FixedClock,
  NodeCommandRunner,
  canonicalJson,
  sha256,
  success,
  type CommandSpec,
} from "../../src/index.js";
import { createGateRunner } from "../../src/governance/integration/gate-runner.js";
import { IntegrationGitCliClient } from "../../src/governance/integration/integration-git-client.js";
import {
  createStaleBaseReconciler,
  type EvidenceApplicabilityValidator,
  type ReconcileInput,
  type ReconciliationSemanticBindings,
  type StaleBaseReconciler,
} from "../../src/governance/integration/stale-base-reconciler.js";
import type { GateEvidence } from "../../src/governance/contracts/index.js";
import type { ResolvedGateExecution } from "../../src/planning/types.js";

export const TASK_ID = "TASK-01J00000000000000000000061";
export const EVIDENCE_ID = "EVD-01J00000000000000000000061";
const DECISION_ID = "DEC-01J00000000000000000000061";
const NOW = new Date("2026-07-15T10:00:00.000Z");
const roots: string[] = [];

function gitEnvironment(): Readonly<Record<string, string>> {
  const result: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
  for (const name of ["PATH", "SystemRoot", "HOME", "USERPROFILE"]) {
    const value = process.env[name];
    if (value !== undefined) result[name] = value;
  }
  return result;
}

const runner = new NodeCommandRunner();

async function git(root: URL, args: readonly string[]): Promise<string> {
  const spec: CommandSpec = {
    executable: "git",
    args,
    cwd: root,
    timeout_ms: 30_000,
    env_allowlist: gitEnvironment(),
    max_output_bytes: 1_048_576,
  };
  const result = await runner.run(spec);
  if (result.exit_code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

export interface StaleRepo {
  readonly repo: URL;
  readonly temporary_root: URL;
  readonly original_base: string;
  readonly worker_head: string;
  readonly integration_head: string;
  readonly worker_path: string;
}

async function baseRepo(): Promise<{
  readonly directory: string;
  readonly repo: URL;
  readonly temporary_root: URL;
  readonly base: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "project-memory-stale-"));
  roots.push(directory);
  const repoPath = path.join(directory, "repo");
  const temporaryPath = path.join(directory, "temporary");
  const repo = pathToFileURL(`${repoPath}${path.sep}`);
  const temporaryRoot = pathToFileURL(`${temporaryPath}${path.sep}`);
  await mkdir(repo, { recursive: true });
  await mkdir(temporaryRoot, { recursive: true });
  await cp(
    new URL("../fixtures/governance/repositories/stale-base/base/", import.meta.url),
    repo,
    { recursive: true },
  );
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.name", "Project Memory Test"]);
  await git(repo, ["config", "user.email", "project-memory@example.invalid"]);
  await git(repo, ["add", "--all", "--", "."]);
  await git(repo, ["commit", "-m", "base"]);
  return { directory, repo, temporary_root: temporaryRoot, base: await git(repo, ["rev-parse", "HEAD"]) };
}

export async function createDivergedRepo(conflict = false): Promise<StaleRepo> {
  const fixture = await baseRepo();
  await git(fixture.repo, ["checkout", "-b", "worker"]);
  const workerPath = conflict ? "app.txt" : "worker.txt";
  await writeFile(new URL(workerPath, fixture.repo), conflict ? "worker state\n" : "worker addition\n", "utf8");
  await git(fixture.repo, ["add", "--all", "--", "."]);
  await git(fixture.repo, ["commit", "-m", "worker change"]);
  const workerHead = await git(fixture.repo, ["rev-parse", "HEAD"]);
  await git(fixture.repo, ["checkout", "main"]);
  const integrationPath = conflict ? "app.txt" : "integration.txt";
  await writeFile(
    new URL(integrationPath, fixture.repo),
    conflict ? "integration state\n" : "integration addition\n",
    "utf8",
  );
  await git(fixture.repo, ["add", "--all", "--", "."]);
  await git(fixture.repo, ["commit", "-m", "integration change"]);
  return {
    repo: fixture.repo,
    temporary_root: fixture.temporary_root,
    original_base: fixture.base,
    worker_head: workerHead,
    integration_head: await git(fixture.repo, ["rev-parse", "HEAD"]),
    worker_path: workerPath,
  };
}

export async function createCurrentBaseRepo(): Promise<StaleRepo> {
  const fixture = await baseRepo();
  await git(fixture.repo, ["checkout", "-b", "worker"]);
  await writeFile(new URL("worker.txt", fixture.repo), "worker addition\n", "utf8");
  await git(fixture.repo, ["add", "--all", "--", "."]);
  await git(fixture.repo, ["commit", "-m", "worker change"]);
  const workerHead = await git(fixture.repo, ["rev-parse", "HEAD"]);
  await git(fixture.repo, ["checkout", "main"]);
  return {
    repo: fixture.repo,
    temporary_root: fixture.temporary_root,
    original_base: fixture.base,
    worker_head: workerHead,
    integration_head: fixture.base,
    worker_path: "worker.txt",
  };
}

export function semanticBindings(
  overrides: Partial<ReconciliationSemanticBindings> = {},
): ReconciliationSemanticBindings {
  return {
    accepted_decision_hashes: { [DECISION_ID]: "1".repeat(64) },
    profile_lock_hash: "2".repeat(64),
    authority_hash: "3".repeat(64),
    claimed_scope_hash: "4".repeat(64),
    behavior_hash: "5".repeat(64),
    evidence_policy_hash: "6".repeat(64),
    ...overrides,
  };
}

export const conflictGate: ResolvedGateExecution = {
  id: "gate.current-base",
  definition_ref: "adapter.node.current-base@1.0.0",
  type: "test",
  command_or_check: "Verify the replayed worker file",
  required: true,
  conflict_sensitive: true,
  evidence_type: "test-result",
  execution: {
    kind: "command",
    executable: process.execPath,
    args: [
      "-e",
      "const fs=require('node:fs');process.exit(fs.existsSync('worker.txt')||fs.readFileSync('app.txt','utf8').includes('worker')?0:1)",
    ],
    cwd: ".",
    timeout_ms: 5_000,
    env_allowlist: {},
  },
};

export const carryGate: ResolvedGateExecution = {
  ...conflictGate,
  id: "gate.static-policy",
  definition_ref: "adapter.policy.static@1.0.0",
  command_or_check: "Reuse a revision-independent policy result",
  conflict_sensitive: false,
};

function carriedGateEvidence(): GateEvidence {
  return {
    schema_version: "1.0.0",
    gate_id: carryGate.id,
    definition_ref: carryGate.definition_ref,
    evidence_type: carryGate.evidence_type,
    execution_kind: "command",
    status: "passed",
    required: true,
    conflict_sensitive: false,
    command: { executable: "policy-check", args: ["verify"], cwd: "." },
    verifier_role: null,
    exit_code: 0,
    stdout_redacted: "policy passed",
    stderr_redacted: "",
    stdout_sha256: sha256("policy passed"),
    stderr_sha256: sha256(""),
    evidence_ids: [],
    approval_refs: [],
    occurred_at: NOW.toISOString(),
    duration_ms: 10,
    not_run_reason: null,
  };
}

export function reconcileInput(
  fixture: StaleRepo,
  overrides: Partial<ReconcileInput> = {},
): ReconcileInput {
  const prior = carriedGateEvidence();
  const semantics = semanticBindings();
  return {
    repo: fixture.repo,
    task_id: TASK_ID,
    original_base_revision: fixture.original_base,
    worker_head_revision: fixture.worker_head,
    integration_head: fixture.integration_head,
    expected_changed_paths: [fixture.worker_path],
    claimed_paths: [fixture.worker_path],
    semantic_bindings: { original: semantics, current: structuredClone(semantics) },
    gates: [carryGate, conflictGate],
    prior_evidence: [{
      gate_id: carryGate.id,
      evidence_id: EVIDENCE_ID,
      source_revision: fixture.worker_head,
      original_result_hash: sha256(canonicalJson(prior)),
      applicability_statement: "Static policy result is independent of source files.",
      evidence: prior,
    }],
    submitted_checks: {},
    ...overrides,
  };
}

export function reconciler(
  fixture: StaleRepo,
  applicability?: EvidenceApplicabilityValidator,
): StaleBaseReconciler {
  return createStaleBaseReconciler({
    git: new IntegrationGitCliClient(new NodeCommandRunner()),
    gates: createGateRunner({ clock: new FixedClock(NOW), runner: new NodeCommandRunner() }),
    applicability: applicability ?? {
      assess: () => Promise.resolve(success({ applicable: true, reason_code: null })),
    },
    temporary_root: fixture.temporary_root,
  });
}

export async function readAt(repo: URL, revision: string, relativePath: string): Promise<string> {
  return git(repo, ["show", `${revision}:${relativePath}`]);
}

export async function temporaryEntries(fixture: StaleRepo): Promise<readonly string[]> {
  return readdir(fixture.temporary_root);
}

export async function cleanupStaleRepos(): Promise<void> {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
}
