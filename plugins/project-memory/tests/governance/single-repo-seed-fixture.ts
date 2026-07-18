import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  NodeCommandRunner,
  applyFileTransaction,
  canonicalJson,
  registerProjectSchemas,

  type CommandSpec,
} from "../../src/index.js";
import type { CanonicalRecord } from "../../src/governance/contracts/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import { eventPath } from "../../src/governance/events/append-only-event-store.js";
import { signEvent } from "../../src/governance/events/event-chain-verifier.js";
import { recordWrite } from "../../src/governance/records/record-path.js";
import { createCanonicalSnapshotBuilder } from "../../src/governance/snapshot/canonical-snapshot-builder.js";
import { createRevisionTreeReader } from "../../src/governance/snapshot/revision-tree-reader.js";
import { planGeneratedViewsAt } from "../../src/governance/views/generate-views.js";
import { claimPath } from "../../src/governance/claims/claim-service.js";
import {
  parseWorkDocument,
  renderTaskPacket,
  renderWorkstream,
  taskDocumentPath,
  transitionWorkDocument,
  workstreamDocumentPath,
} from "../../src/governance/work/work-document.js";
import type { ProfileMutationMetadata } from "../../src/profile/contracts/index.js";
import type { CompletionPacket, TaskPacket } from "../../src/planning/types.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import {
  makeValidCompletionPacket,
  makeValidTaskPacket,
} from "../fixtures/selection/runtime-packet-fixtures.js";
import { compileProductionProfilePlan } from "../helpers/production-profile-plan.js";

const runner = new NodeCommandRunner();
const roots: string[] = [];
let seedPromise: Promise<SingleRepoSeed> | null = null;

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

export async function git(root: URL, args: readonly string[]): Promise<string> {
  const spec: CommandSpec = {
    executable: "git",
    args: ["-c", "core.longpaths=true", ...args],
    cwd: root,
    timeout_ms: 120_000,
    env_allowlist: gitEnvironment(),
    max_output_bytes: 67_108_864,
  };
  const result = await runner.run(spec);
  if (result.exit_code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function commitAll(root: URL, message: string): Promise<string> {
  await git(root, ["add", "--all", "--", "."]);
  await git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

async function apply(root: URL, writes: Parameters<typeof applyFileTransaction>[1]) {
  const result = await applyFileTransaction(root, writes);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
}

function rootApproval(
  id: string,
  rootId: string,
  catalogVersion: string,
  createdAt: string,
): CanonicalRecord {
  return {
    id,
    type: "approval",
    title: "Accept fixture root profile",
    status: "accepted",
    root_id: rootId,
    component_ids: [],
    initiative_id: null,
    workstream_id: null,
    task_id: null,
    actor_id: "Pitaji",
    authority_class: "pitaji",
    created_at: createdAt,
    original_base_revision: "0".repeat(40),
    integration_base_revision: "0".repeat(40),
    catalog_versions: [catalogVersion],
    relationships: [],
    payload: {
      approval_kind: "directional",
      granted_by: "Pitaji",
      target: `root:${rootId}`,
      environment: "test",
      scope: ["profile-bootstrap"],
      timing: "fixture",
      expires_at: null,
      invalidation_conditions: [],
    },
  };
}

function submittedTaskBytes(packet: TaskPacket, rootId: string, approvalId: string): Uint8Array {
  let parsed = parseWorkDocument(
    renderTaskPacket(packet, rootId, [approvalId]),
    "task_packet",
    packet.task_id,
    rootId,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  let bytes: Uint8Array = new Uint8Array();
  for (const status of ["claimed", "in_progress", "submitted"] as const) {
    bytes = transitionWorkDocument(parsed.value, status, []);
    parsed = parseWorkDocument(bytes, "task_packet", packet.task_id, rootId);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  }
  return bytes;
}

async function generateViews(root: URL, sourceTree: string, createdAt: string): Promise<void> {
  const snapshots = createCanonicalSnapshotBuilder(createRevisionTreeReader(runner));
  const snapshot = await snapshots.build(root, { kind: "tree", object_id: sourceTree });
  if (!snapshot.ok) throw new Error(JSON.stringify(snapshot.issues));
  const plan = planGeneratedViewsAt(snapshot.value, createdAt, {
    target_ref: "refs/heads/main",
    created_by: "fixture.integrator",
  });
  if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
  await apply(root, plan.value.writes);
}

function taskPacket(
  metadata: ProfileMutationMetadata,
  originalBase: string,
): TaskPacket {
  const base = makeValidTaskPacket();
  const component = metadata.profile.components[0];
  const duty = base.component_duties[0];
  const gate = base.gates[0];
  if (component === undefined || duty === undefined || gate === undefined) {
    throw new Error("production fixture lacks a component, duty, or gate");
  }
  return {
    ...base,
    root: {
      id: metadata.profile.root.id,
      profile_lock_hash: metadata.profile_lock.lock_hash,
      catalog_release: metadata.profile.catalog.release,
      catalog_hash: metadata.profile.catalog.release_hash,
    },
    selector: { ...base.selector, evidence_ids: [] },
    scope: { inclusions: ["app/task.txt"], exclusions: [] },
    resolved_inputs: {
      record_ids: [],
      artifact_refs: ["docs/project-memory/profile.lock.yaml"],
      original_base_revision: originalBase,
    },
    component_duties: [{
      ...duty,
      component_id: component.instance_id,
      read_scope: ["app/task.txt"],
      write_scope: ["app/task.txt"],
      resolution: {
        ...duty.resolution,
        evidence_ids: [],
      },
    }],
    claim: {
      ...base.claim,
      base_revision: originalBase,
      issued_at: "2026-07-14T12:00:00.000Z",
      expires_at: "2026-07-14T12:15:00.000Z",
      last_heartbeat_at: "2026-07-14T12:00:00.000Z",
      components: [component.instance_id],
      repositories: ["single-repo-fixture"],
      paths: ["app/task.txt"],
      required_evidence: ["regression-result"],
    },
    decisions: { accepted_record_ids: [], proposed_record_ids: [] },
    required_evidence: ["regression-result"],
    gates: [{
      ...gate,
      command_or_check: "fixture regression",
      execution: {
        kind: "command",
        executable: process.execPath,
        args: ["--version"],
        cwd: ".",
        timeout_ms: 30_000,
        env_allowlist: {},
      },
    }],
  };
}

function completionPacket(task: TaskPacket, workerHead: string): CompletionPacket {
  const base = makeValidCompletionPacket(task);
  const change = base.changes[0];
  const check = base.checks[0];
  if (change === undefined || check === undefined) {
    throw new Error("completion fixture lacks a change or check");
  }
  return {
    ...base,
    submitted_at: "2026-07-14T12:04:00.000Z",
    worker_head_revision: workerHead,
    scope_performed: ["app/task.txt"],
    changes: [{
      ...change,
      files: ["app/task.txt"],
      commits: [workerHead],
      artifacts: ["artifacts/task-result.json"],
      rationale: "Implemented the assigned fixture change",
    }],
    checks: [{
      ...check,
      command_or_check: "fixture regression",
      exact_result: "12 tests passed",
    }],
  };
}

export interface SingleRepoSeed {
  readonly repo: URL;
  readonly main_head: string;
  readonly original_base: string;
  readonly worker_head: string;
  readonly task: TaskPacket;
  readonly completion: CompletionPacket;
  readonly profile_lock_hash: string;
  readonly catalog_lock_hash: string;
}

async function buildSeed(): Promise<SingleRepoSeed> {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
  const directory = await mkdtemp(path.join(tmpdir(), "project-memory-single-seed-"));
  roots.push(directory);
  const repo = pathToFileURL(`${path.join(directory, "repo")}${path.sep}`);
  await mkdir(repo, { recursive: true });
  const fixture = new URL(
    "../fixtures/governance/repositories/single-repo/base/README.md",
    import.meta.url,
  );
  await writeFile(new URL("README.md", repo), await readFile(fixture));
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.name", "Project Memory Test"]);
  await git(repo, ["config", "user.email", "project-memory@example.invalid"]);
  await commitAll(repo, "base");

  const production = await compileProductionProfilePlan();
  const metadata = production.plan.metadata;
  const approvalId = production.plan.approval_ids[0];
  if (approvalId === undefined) throw new Error("production plan approval missing");
  await apply(repo, [
    ...production.plan.writes,
    recordWrite(rootApproval(
      approvalId,
      production.plan.root_id,
      metadata.profile.catalog.release,
      production.plan.created_at,
    )),
  ]);
  await git(repo, ["add", "--all", "--", "."]);
  const profileTree = await git(repo, ["write-tree"]);
  await generateViews(repo, profileTree, "2026-07-14T11:58:00.000Z");
  const originalBase = await commitAll(repo, "initialize governed fixture");

  const task = taskPacket(metadata, originalBase);
  const claimEvent = signEvent({
    aggregate_id: task.claim.id,
    event_type: "claim_issued",
    occurred_at: task.claim.issued_at,
    actor_id: task.claim.issuer,
    authority_class: "integrator",
    evidence_ids: [],
    payload: task.claim,
  }, null);
  await apply(repo, [
    {
      relative_path: workstreamDocumentPath(task.workstream_id),
      bytes: renderWorkstream({
        root: repo,
        workstream_id: task.workstream_id,
        initiative_id: null,
        title: "Single Repository Integration",
        objective: "Verify atomic task finalization",
        owners: ["agent.integrator"],
        dependencies: [],
      }, task.root.id, [approvalId]),
      expected_existing_sha256: null,
      mode: "create",
    },
    {
      relative_path: taskDocumentPath(task.workstream_id, task.task_id),
      bytes: submittedTaskBytes(task, task.root.id, approvalId),
      expected_existing_sha256: null,
      mode: "create",
    },
    {
      relative_path: claimPath(task.claim.id),
      bytes: new TextEncoder().encode(canonicalJson(task.claim)),
      expected_existing_sha256: null,
      mode: "create",
    },
    {
      relative_path: eventPath(claimEvent),
      bytes: new TextEncoder().encode(canonicalJson(claimEvent)),
      expected_existing_sha256: null,
      mode: "create",
    },
  ]);
  await git(repo, ["add", "--all", "--", "."]);
  const taskTree = await git(repo, ["write-tree"]);
  await generateViews(repo, taskTree, "2026-07-14T12:01:00.000Z");
  const mainHead = await commitAll(repo, "issue submitted task fixture");

  const worker = pathToFileURL(`${path.join(directory, "worker")}${path.sep}`);
  await git(repo, ["worktree", "add", "--detach", fileURLToPath(worker), originalBase]);
  await mkdir(new URL("app/", worker), { recursive: true });
  await writeFile(new URL("app/task.txt", worker), "integrated worker result\n", "utf8");
  const workerHead = await commitAll(worker, "implement fixture task");
  await git(repo, ["update-ref", "refs/heads/worker-task", workerHead]);
  await git(repo, ["worktree", "remove", fileURLToPath(worker)]);

  return {
    repo,
    main_head: mainHead,
    original_base: originalBase,
    worker_head: workerHead,
    task,
    completion: completionPacket(task, workerHead),
    profile_lock_hash: metadata.profile_lock.lock_hash,
    catalog_lock_hash: metadata.selected_catalog_lock.lock_hash,
  };
}

export function singleRepoSeed(): Promise<SingleRepoSeed> {
  seedPromise ??= buildSeed();
  return seedPromise;
}

export async function cloneSeed(): Promise<{ readonly repo: URL; readonly seed: SingleRepoSeed }> {
  const seed = await singleRepoSeed();
  const directory = await mkdtemp(path.join(tmpdir(), "project-memory-single-clone-"));
  roots.push(directory);
  const repo = pathToFileURL(`${path.join(directory, "repo")}${path.sep}`);
  await git(pathToFileURL(`${directory}${path.sep}`), [
    "clone",
    "--no-hardlinks",
    fileURLToPath(seed.repo),
    fileURLToPath(repo),
  ]);
  await git(repo, ["config", "user.name", "Project Memory Test"]);
  await git(repo, ["config", "user.email", "project-memory@example.invalid"]);
  return { repo, seed };
}

export function trackSingleRepoRoot(directory: string): void {
  roots.push(directory);
}

export async function cleanupSingleRepoRoots(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  seedPromise = null;
}

export { runner as singleRepoRunner };
