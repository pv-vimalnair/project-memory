import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalJson, sha256, success, type Clock } from "../../src/index.js";
import type { GateEvidence } from "../../src/governance/contracts/index.js";
import {
  createMultiRepoFinalizer,
  type FinalizeHubInput,
  type MultiRepoFinalizer,
  type PrepareSatelliteInput,
  type VerifySatelliteInput,
} from "../../src/governance/integration/integration-recovery.js";
import { IntegrationGitCliClient } from "../../src/governance/integration/integration-git-client.js";
import {
  createIntegrationLeaseStore,
  type NonceSource,
} from "../../src/governance/integration/integration-lease-store.js";
import { createCanonicalSnapshotBuilder } from "../../src/governance/snapshot/canonical-snapshot-builder.js";
import { createRevisionTreeReader } from "../../src/governance/snapshot/revision-tree-reader.js";
import { createViewGenerator } from "../../src/governance/views/generate-views.js";
import type { CompletionPacket, TaskPacket } from "../../src/planning/types.js";
import {
  cleanupSingleRepoRoots,
  cloneSeed,
  git,
  singleRepoRunner,
  trackSingleRepoRoot,
} from "./single-repo-seed-fixture.js";

const NOW = new Date("2026-07-14T12:04:00.000Z");

class FixedClock implements Clock {
  now(): Date {
    return new Date(NOW);
  }
}

class FixedNonces implements NonceSource {
  #next = 0;

  nextNonce(): string {
    this.#next += 1;
    return this.#next.toString(16).padStart(64, "0");
  }
}

function clone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

export function passingGateEvidence(failed = false): GateEvidence {
  const stdout = failed ? "regression failed" : "12 tests passed";
  return {
    schema_version: "1.0.0",
    gate_id: "gate.regression",
    definition_ref: "adapter.flutter.test@1.0.0",
    evidence_type: "test-result",
    execution_kind: "command",
    status: failed ? "failed" : "passed",
    required: true,
    conflict_sensitive: true,
    command: { executable: process.execPath, args: ["--version"], cwd: "." },
    verifier_role: null,
    exit_code: failed ? 1 : 0,
    stdout_redacted: stdout,
    stderr_redacted: "",
    stdout_sha256: sha256(stdout),
    stderr_sha256: sha256(""),
    evidence_ids: [],
    approval_refs: [],
    occurred_at: NOW.toISOString(),
    duration_ms: 5,
    not_run_reason: null,
  };
}

async function workCommit(
  repo: URL,
  repositoryId: string,
  integrationBase: string,
): Promise<string> {
  await git(repo, ["checkout", "--detach", integrationBase]);
  await mkdir(new URL("app/", repo), { recursive: true });
  await mkdir(new URL("artifacts/", repo), { recursive: true });
  await writeFile(
    new URL("app/task.txt", repo),
    `integrated ${repositoryId} result\n`,
    "utf8",
  );
  await writeFile(
    new URL("artifacts/task-result.json", repo),
    `${canonicalJson({ repository_id: repositoryId, verified: true })}\n`,
    "utf8",
  );
  await git(repo, ["add", "--all", "--", "."]);
  await git(repo, ["commit", "-m", `implement ${repositoryId}`]);
  return git(repo, ["rev-parse", "HEAD"]);
}

function completionFor(
  source: CompletionPacket,
  repositoryId: string,
): CompletionPacket {
  const completion = clone(source);
  const change = completion.changes[0];
  if (change === undefined) throw new Error("fixture completion change missing");
  return {
    ...completion,
    changes: [{
      ...change,
      files: ["app/task.txt"],
      artifacts: ["artifacts/task-result.json"],
      rationale: `Implemented ${repositoryId}`,
    }],
  };
}

export interface MultiRepoSatellite {
  readonly repo: URL;
  readonly repository_id: string;
  readonly work_commit: string;
  readonly prepare: PrepareSatelliteInput;
}

export interface MultiRepoHarness {
  readonly hub: URL;
  readonly hub_head: string;
  readonly task: TaskPacket;
  readonly finalizer: MultiRepoFinalizer;
  readonly satellites: readonly [MultiRepoSatellite, MultiRepoSatellite];
  verify(
    satellite: MultiRepoSatellite,
    prepared: Awaited<ReturnType<MultiRepoFinalizer["prepareSatellite"]>> extends infer R
      ? R extends { ok: true; value: infer V } ? V : never
      : never,
  ): VerifySatelliteInput;
  hubInput(satellites: readonly VerifySatelliteInput[]): FinalizeHubInput;
}

async function satellite(
  repositoryId: string,
  auditEvidenceId: string,
): Promise<MultiRepoSatellite> {
  const cloned = await cloneSeed();
  const work = await workCommit(cloned.repo, repositoryId, cloned.seed.main_head);
  return {
    repo: cloned.repo,
    repository_id: repositoryId,
    work_commit: work,
    prepare: {
      repo: cloned.repo,
      repository_id: repositoryId,
      integration_base_revision: cloned.seed.main_head,
      work_commit_hash: work,
      task_packet: clone(cloned.seed.task),
      completion_packet: completionFor(cloned.seed.completion, repositoryId),
      profile_version: "1.0.0",
      catalog_lock_hash: cloned.seed.catalog_lock_hash,
      gate_evidence: [passingGateEvidence()],
      archive_manifest_hashes: [],
      audit_evidence_id: auditEvidenceId,
      prepared_by: "agent.integrator",
    },
  };
}

export async function multiRepoHarness(): Promise<MultiRepoHarness> {
  const hubClone = await cloneSeed();
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "project-memory-multi-"));
  trackSingleRepoRoot(temporaryDirectory);
  const temporaryRoot = pathToFileURL(`${temporaryDirectory}${path.sep}`);
  const clock = new FixedClock();
  const gitClient = new IntegrationGitCliClient(singleRepoRunner);
  const snapshots = createCanonicalSnapshotBuilder(createRevisionTreeReader(singleRepoRunner));
  const views = createViewGenerator({
    clock,
    target_ref: "refs/heads/main",
    created_by: "agent.integrator",
    snapshots: { current: () => Promise.resolve(success({} as never)) },
  });
  const finalizer = createMultiRepoFinalizer({
    clock,
    git: gitClient,
    leases: createIntegrationLeaseStore({
      clock,
      git: gitClient,
      nonces: new FixedNonces(),
    }),
    snapshots,
    views,
    temporary_root: temporaryRoot,
    integrator_id: "agent.integrator",
  });
  const satellites = await Promise.all([
    satellite("satellite-a", "EVD-01J00000000000000000000007"),
    satellite("satellite-b", "EVD-01J00000000000000000000008"),
  ]);

  return {
    hub: hubClone.repo,
    hub_head: hubClone.seed.main_head,
    task: clone(hubClone.seed.task),
    finalizer,
    satellites,
    verify(item, prepared) {
      return { ...item.prepare, prepared };
    },
    hubInput(verified) {
      return {
        hub: hubClone.repo,
        target_ref: "refs/heads/main",
        expected_head: hubClone.seed.main_head,
        task_packet: clone(hubClone.seed.task),
        satellites: verified,
        audit_evidence_id: "EVD-01J00000000000000000000009",
        finalized_by: "agent.integrator",
      };
    },
  };
}

export async function cleanupMultiRepoHarnesses(): Promise<void> {
  await cleanupSingleRepoRoots();
}

export { git };
