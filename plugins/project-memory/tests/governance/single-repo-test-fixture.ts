import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  type Clock,
  canonicalJson,
  canonicalMutationPlanHash,
  failure,
  sha256,
  success,
  type IdFactory,
} from "../../src/index.js";
import {
  createArchiveStore,
  archiveManifestPath,
  type ArchiveStore,
} from "../../src/governance/archive/content-addressed-archive.js";
import type {
  ArchiveManifest,
  GateEvidence,
} from "../../src/governance/contracts/index.js";
import {
  createAuditEvidenceBuilder,
  type IntegrationAuditManifest,
} from "../../src/governance/integration/audit-evidence.js";
import {
  createSingleRepoFinalizer,
  type IntegrationReceipt,
  type SingleRepoFaultInjector,
  type SingleRepoFinalizationInput,
  type SingleRepoFinalizer,
} from "../../src/governance/integration/single-repo-finalizer.js";
import { IntegrationGitCliClient } from "../../src/governance/integration/integration-git-client.js";
import {
  createIntegrationLeaseStore,
  leaseUrl,
  mutexUrl,
  type NonceSource,
} from "../../src/governance/integration/integration-lease-store.js";
import { createStaleBaseReconciler } from "../../src/governance/integration/stale-base-reconciler.js";
import { createCanonicalSnapshotBuilder } from "../../src/governance/snapshot/canonical-snapshot-builder.js";
import { createRevisionTreeReader } from "../../src/governance/snapshot/revision-tree-reader.js";
import { createViewGenerator } from "../../src/governance/views/generate-views.js";
import { taskDocumentPath } from "../../src/governance/work/work-document.js";
import { createProfileVerifier } from "../../src/profile/verify-profile.js";
import type { CompletionPacket } from "../../src/planning/types.js";
import {
  cleanupSingleRepoRoots,
  cloneSeed,
  git,
  singleRepoRunner,
  trackSingleRepoRoot,
} from "./single-repo-seed-fixture.js";

const NOW = new Date("2026-07-14T12:04:00.000Z");
export class SingleRepoClock implements Clock {
  #timestamp = NOW.getTime();

  now(): Date {
    return new Date(this.#timestamp);
  }

  advance(milliseconds: number): void {
    this.#timestamp += milliseconds;
  }
}

class FixedNonces implements NonceSource {
  #counter = 0;

  nextNonce(): string {
    this.#counter += 1;
    return this.#counter.toString(16).padStart(64, "0");
  }
}

class FixedIds implements IdFactory {
  next(prefix: Parameters<IdFactory["next"]>[0]): string {
    if (prefix !== "EVD") throw new Error(`unexpected ID prefix: ${prefix}`);
    return "EVD-01J00000000000000000000009";
  }
}

function cloned<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function completionWithSecret(completion: CompletionPacket): CompletionPacket {
  return {
    ...completion,
    worker_attestation:
      `${completion.worker_attestation} Diagnostic api_key="synthetic-test-secret".`,
  };
}

function gateEvidence(failed: boolean): GateEvidence {
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
    command: {
      executable: process.execPath,
      args: ["--version"],
      cwd: ".",
    },
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

async function missing(target: URL): Promise<boolean> {
  try {
    await lstat(target);
    return false;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

export interface SingleRepoHarnessOptions {
  readonly completion_secret?: boolean;
  readonly gate_failure?: boolean;
  readonly archive_failure?: boolean;
  readonly view_failure?: boolean;
  readonly view_metadata_drift?: boolean;
  readonly lease_ttl_ms?: number;
  readonly faults?: SingleRepoFaultInjector;
}

export interface SingleRepoHarness {
  readonly repo: URL;
  readonly temporary_root: URL;
  readonly common_git_dir: URL;
  readonly finalizer: SingleRepoFinalizer;
  readonly input: SingleRepoFinalizationInput;
  readonly clock: SingleRepoClock;
}

export async function singleRepoHarness(
  options: SingleRepoHarnessOptions = {},
): Promise<SingleRepoHarness> {
  const clonedSeed = await cloneSeed();
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "project-memory-single-tmp-"));
  trackSingleRepoRoot(temporaryDirectory);
  const temporaryRoot = pathToFileURL(`${temporaryDirectory}${path.sep}`);
  const clock = new SingleRepoClock();
  const gitClient = new IntegrationGitCliClient(singleRepoRunner);
  const snapshots = createCanonicalSnapshotBuilder(
    createRevisionTreeReader(singleRepoRunner),
  );
  const gates = {
    run: () => Promise.resolve(success(gateEvidence(options.gate_failure ?? false))),
  };
  const reconciler = createStaleBaseReconciler({
    git: gitClient,
    gates,
    applicability: {
      assess: () => Promise.resolve(success({ applicable: true, reason_code: null })),
    },
    temporary_root: temporaryRoot,
  });
  const viewGenerator = createViewGenerator({
    clock,
    target_ref: "refs/heads/main",
    created_by: "agent.integrator",
    snapshots: {
      current: () => Promise.resolve(failure("test.unused", "not used")),
    },
  });
  const views = options.view_failure === true
    ? { plan: () => failure("integration.view_injected", "injected view failure") }
    : options.view_metadata_drift === true
      ? {
          plan(snapshot: Parameters<typeof viewGenerator.plan>[0]) {
            const planned = viewGenerator.plan(snapshot);
            if (!planned.ok) return planned;
            const { plan_hash: ignored, ...body } = planned.value;
            void ignored;
            const drifted = {
              ...body,
              metadata: { ...body.metadata, source_set_hash: "f".repeat(64) },
            };
            return success({
              ...drifted,
              plan_hash: canonicalMutationPlanHash(drifted),
            });
          },
        }
      : viewGenerator;
  const archiveStore = createArchiveStore({ clock });
  const archives: ArchiveStore = options.archive_failure === true
    ? {
        ...archiveStore,
        planIngest: () => failure("archive.injected", "injected archive failure"),
      }
    : archiveStore;
  const finalizer = createSingleRepoFinalizer({
    clock,
    git: gitClient,
    leases: createIntegrationLeaseStore({
      clock,
      git: gitClient,
      nonces: new FixedNonces(),
    }),
    reconciler,
    snapshots,
    views,
    archives,
    audit: createAuditEvidenceBuilder({ clock, ids: new FixedIds() }),
    verifier: createProfileVerifier(),
    temporary_root: temporaryRoot,
    integrator_id: "agent.integrator",
    ...(options.lease_ttl_ms === undefined
      ? {}
      : { lease_ttl_ms: options.lease_ttl_ms }),
    ...(options.faults === undefined ? {} : { faults: options.faults }),
  });
  const completion = options.completion_secret === true
    ? completionWithSecret(cloned(clonedSeed.seed.completion))
    : cloned(clonedSeed.seed.completion);
  const input: SingleRepoFinalizationInput = {
    root: clonedSeed.repo,
    target_ref: "refs/heads/main",
    expected_head: clonedSeed.seed.main_head,
    task_packet: cloned(clonedSeed.seed.task),
    completion_packet: completion,
    expected_issuer: "agent.integrator",
    recorded_task_approvals: [],
    prior_gate_evidence: [],
    submitted_checks: {},
    directional_acceptance: null,
    external_action: null,
  };
  return {
    repo: clonedSeed.repo,
    temporary_root: temporaryRoot,
    common_git_dir: await gitClient.commonGitDir(clonedSeed.repo),
    finalizer,
    clock,
    input,
  };
}

export async function expectSingleRepoClean(harness: SingleRepoHarness): Promise<void> {
  if (!(await missing(leaseUrl(harness.common_git_dir)))) throw new Error("lease leaked");
  if (!(await missing(mutexUrl(harness.common_git_dir)))) throw new Error("mutex leaked");
  if ((await readdir(harness.temporary_root)).length !== 0) {
    throw new Error("temporary integration artifacts leaked");
  }
  const worktrees = (await git(harness.repo, ["worktree", "list", "--porcelain"]))
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("worktree "));
  if (worktrees.length !== 1) throw new Error("integration worktree metadata leaked");
}

async function jsonAt<T>(repo: URL, revision: string, relativePath: string): Promise<T> {
  return JSON.parse(await git(repo, ["show", `${revision}:${relativePath}`])) as T;
}

export async function readTaskStatus(
  harness: SingleRepoHarness,
  revision: string,
): Promise<string> {
  const text = await git(harness.repo, [
    "show",
    `${revision}:${taskDocumentPath(harness.input.task_packet.workstream_id, harness.input.task_packet.task_id)}`,
  ]);
  return /^Status: ([a-z_]+)$/mu.exec(text)?.[1] ?? "missing";
}

export async function readIntegrationAudit(
  harness: SingleRepoHarness,
  receipt: IntegrationReceipt,
): Promise<IntegrationAuditManifest> {
  return jsonAt<IntegrationAuditManifest>(
    harness.repo,
    receipt.commit_revision,
    receipt.audit_manifest_path,
  );
}

export async function readArchiveObject(
  harness: SingleRepoHarness,
  revision: string,
  manifestHash: string,
): Promise<string> {
  const manifest = await readArchiveManifest(harness, revision, manifestHash);
  return git(harness.repo, ["show", `${revision}:${manifest.object_path}`]);
}

export async function readArchiveManifest(
  harness: SingleRepoHarness,
  revision: string,
  manifestHash: string,
): Promise<ArchiveManifest> {
  return jsonAt<ArchiveManifest>(
    harness.repo,
    revision,
    archiveManifestPath(manifestHash),
  );
}
export interface UninitializedRepository {
  readonly repo: URL;
  readonly head: string;
  readonly lease_created: () => boolean;
}

export async function uninitializedRepository(): Promise<UninitializedRepository> {
  const directory = await mkdtemp(path.join(tmpdir(), "project-memory-uninitialized-"));
  trackSingleRepoRoot(directory);
  const repo = pathToFileURL(`${path.join(directory, "repo")}${path.sep}`);
  await mkdir(repo, { recursive: true });
  await writeFile(new URL("README.md", repo), "ordinary repository\n", "utf8");
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.name", "Project Memory Test"]);
  await git(repo, ["config", "user.email", "project-memory@example.invalid"]);
  await git(repo, ["add", "--all", "--", "."]);
  await git(repo, ["commit", "-m", "base"]);
  const common = pathToFileURL(`${path.join(directory, "repo", ".git")}${path.sep}`);
  return {
    repo,
    head: await git(repo, ["rev-parse", "HEAD"]),
    lease_created: () => existsSync(leaseUrl(common)),
  };
}

export async function cleanupSingleRepoHarnesses(): Promise<void> {
  await cleanupSingleRepoRoots();
}

export { git };
