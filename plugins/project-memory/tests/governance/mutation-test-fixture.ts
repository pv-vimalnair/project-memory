import { createHash } from "node:crypto";
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  canonicalMutationPlanHash,
  sha256,
  success,
  type CanonicalMutationKind,
  type CanonicalMutationPlan,
  type GitStatusEntry,
  type PlannedWrite,
  type RuntimeResult,
} from "../../src/index.js";
import type {
  CanonicalMutationGitClient,
  CanonicalMutationRepositoryValidator,
  MutationBindingValidator,
  MutationFaultInjector,
  PlanAuthorityValidator,
} from "../../src/governance/integration/canonical-mutation-finalizer.js";
import { createIntegrationLeaseStore } from "../../src/governance/integration/integration-lease-store.js";
import type { CanonicalSnapshot } from "../../src/governance/snapshot/snapshot-contracts.js";
import { GENERATED_VIEW_PATHS, type GeneratedViewPlan } from "../../src/governance/views/generate-views.js";

export const BASE = "0123456789abcdef0123456789abcdef01234567";
export const PROFILE = "a".repeat(64);
export const ROOT_ID = "ROOT-01J00000000000000000000001";
export const APPROVAL_ID = "APR-01J00000000000000000000001";
export const EVIDENCE_ID = "EVD-01J00000000000000000000001";
const roots: string[] = [];

export class MutableClock {
  value = new Date("2026-07-14T12:00:00.000Z");

  now(): Date {
    return new Date(this.value.getTime());
  }
}

class CounterIds {
  #counter = 0;

  next(prefix: string): string {
    this.#counter += 1;
    return `${prefix}-${this.#counter.toString().padStart(26, "0")}`;
  }
}

class CounterNonce {
  #counter = 0;

  nextNonce(): string {
    this.#counter += 1;
    return this.#counter.toString(16).padStart(64, "0");
  }
}

async function files(root: URL): Promise<Map<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>();
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      if (entry.isFile()) {
        result.set(path.relative(fileURLToPath(root), absolute).replaceAll("\\", "/"), new Uint8Array(await readFile(absolute)));
      }
    }
  }
  await visit(fileURLToPath(root));
  return result;
}

function treeId(entries: ReadonlyMap<string, Uint8Array>): string {
  const digest = createHash("sha1");
  for (const [relativePath, bytes] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
    digest.update(relativePath);
    digest.update("\0");
    digest.update(bytes);
    digest.update("\0");
  }
  return digest.digest("hex");
}

export class FakeMutationGit implements CanonicalMutationGitClient {
  readonly refs = new Map([["refs/heads/main", BASE]]);
  readonly trees = new Map<string, ReadonlyMap<string, Uint8Array>>();
  readonly commits = new Map<string, ReadonlyMap<string, Uint8Array>>();
  readonly worktrees: URL[] = [];
  create_calls = 0;
  cas_allowed = true;

  constructor(private readonly common: URL) {}

  head(): Promise<string> {
    return Promise.resolve(this.refs.get("refs/heads/main") ?? BASE);
  }

  resolveRef(_repo: URL, ref: string): Promise<string> {
    const value = this.refs.get(ref);
    if (value === undefined) throw new Error(`missing ref: ${ref}`);
    return Promise.resolve(value);
  }

  statusPorcelain(): Promise<readonly GitStatusEntry[]> {
    return Promise.resolve([]);
  }

  commonGitDir(): Promise<URL> {
    return Promise.resolve(this.common);
  }

  mergeBase(): Promise<string> {
    return Promise.resolve(BASE);
  }

  changedPaths(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }

  objectExists(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async createDetachedWorktree(repo: URL, revision: string, destination: URL): Promise<void> {
    if (revision !== (this.refs.get("refs/heads/main") ?? "")) throw new Error("stale worktree base");
    this.create_calls += 1;
    await cp(repo, destination, { recursive: true });
    this.worktrees.push(destination);
  }

  removeWorktree(_repo: URL, destination: URL): Promise<void> {
    return rm(destination, { recursive: true, force: true });
  }

  stageAll(): Promise<void> {
    return Promise.resolve();
  }

  async writeTree(worktree: URL): Promise<string> {
    const snapshot = await files(worktree);
    const id = treeId(snapshot);
    this.trees.set(id, snapshot);
    return id;
  }

  commitTree(_repo: URL, tree: string, parent: string, message: string): Promise<string> {
    const snapshot = this.trees.get(tree);
    if (snapshot === undefined) throw new Error("missing tree");
    const commit = createHash("sha1").update(`${tree}\0${parent}\0${message}`).digest("hex");
    this.commits.set(commit, snapshot);
    return Promise.resolve(commit);
  }

  updateRef(_repo: URL, ref: string, next: string, expected: string): Promise<boolean> {
    if (!this.cas_allowed || this.refs.get(ref) !== expected) return Promise.resolve(false);
    this.refs.set(ref, next);
    return Promise.resolve(true);
  }

  committedFile(commit: string, relativePath: string): Uint8Array | undefined {
    return this.commits.get(commit)?.get(relativePath);
  }
}

function snapshot(sourceRevision: string): CanonicalSnapshot {
  return {
    source_revision: sourceRevision,
    source_kind: "tree",
    root_id: ROOT_ID,
    profile_revision: 1,
    profile_lock_hash: PROFILE,
    selected_catalog_lock_hash: "b".repeat(64),
    catalog_versions: ["1.0.0"],
    source_paths: [],
    source_hashes: {},
    blob_object_ids: {},
    project: {} as CanonicalSnapshot["project"],
    profile_lock: { schema_version: "1.0.0" } as CanonicalSnapshot["profile_lock"],
    source_documents: [],
    components: [],
    domains: [],
    initiatives: [],
    workstreams: [],
    tasks: [],
    records: [],
    effective_records: [],
    evidence: [],
    risks: [],
    approvals: [],
    claims: [],
    events: [],
  };
}

function viewPlan(sourceRevision: string): GeneratedViewPlan {
  const writes: PlannedWrite[] = GENERATED_VIEW_PATHS.map((relativePath) => ({
    relative_path: relativePath,
    bytes: new TextEncoder().encode(`generated:${relativePath}:${sourceRevision}\n`),
    expected_existing_sha256: null,
    mode: "create_or_replace",
  }));
  const withoutHash: Omit<GeneratedViewPlan, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: `views:${sourceRevision}`,
    mutation_kind: "view",
    root_id: ROOT_ID,
    target_ref: "refs/heads/main",
    expected_head: sourceRevision,
    profile_lock_hash: PROFILE,
    writes,
    record_ids: [],
    event_ids: [],
    approval_ids: [APPROVAL_ID],
    evidence_ids: [],
    created_by: "view-generator",
    created_at: "2026-07-14T12:00:00.000Z",
    expires_at: "2026-07-14T12:05:00.000Z",
    metadata: { governance_kind: "views", source_revision: sourceRevision, source_set_hash: "c".repeat(64), generated_views: [] },
  };
  return { ...withoutHash, plan_hash: canonicalMutationPlanHash(withoutHash) };
}

export interface MutationHarness {
  readonly repo: URL;
  readonly temp: URL;
  readonly common: URL;
  readonly clock: MutableClock;
  readonly git: FakeMutationGit;
  readonly dependencies: {
    readonly repo: URL;
    readonly temporary_root: URL;
    readonly clock: MutableClock;
    readonly ids: CounterIds;
    readonly git: FakeMutationGit;
    readonly leases: ReturnType<typeof createIntegrationLeaseStore>;
    readonly snapshots: { build(root: URL, source: { readonly object_id: string }): Promise<RuntimeResult<CanonicalSnapshot>> };
    readonly views: { plan(value: CanonicalSnapshot): RuntimeResult<GeneratedViewPlan> };
    readonly bindings: MutationBindingValidator;
    readonly authority: PlanAuthorityValidator;
    readonly repository: CanonicalMutationRepositoryValidator;
    readonly faults?: MutationFaultInjector;
  };
}

export async function mutationHarness(faults?: MutationFaultInjector): Promise<MutationHarness> {
  const directory = await mkdtemp(path.join(tmpdir(), "project-memory-mutation-"));
  roots.push(directory);
  const repo = pathToFileURL(`${path.join(directory, "repo")}${path.sep}`);
  const temp = pathToFileURL(`${path.join(directory, "temp")}${path.sep}`);
  const common = pathToFileURL(`${path.join(directory, "common.git")}${path.sep}`);
  await mkdir(temp, { recursive: true });
  const fixture = new URL("../fixtures/governance/repositories/mutations/base/", import.meta.url);
  await cp(fixture, repo, { recursive: true });
  const clock = new MutableClock();
  const git = new FakeMutationGit(common);
  const leases = createIntegrationLeaseStore({ clock, git, nonces: new CounterNonce() });
  const bindings: MutationBindingValidator = { verify: () => Promise.resolve(success(true)) };
  const authority: PlanAuthorityValidator = { verify: () => Promise.resolve(success(true)) };
  const repository: CanonicalMutationRepositoryValidator = { validate: () => Promise.resolve(success(true)) };
  return {
    repo,
    temp,
    common,
    clock,
    git,
    dependencies: {
      repo,
      temporary_root: temp,
      clock,
      ids: new CounterIds(),
      git,
      leases,
      snapshots: { build: (_root, source) => Promise.resolve(success(snapshot(source.object_id))) },
      views: { plan: (value) => success(viewPlan(value.source_revision)) },
      bindings,
      authority,
      repository,
      ...(faults === undefined ? {} : { faults }),
    },
  };
}

export async function mutationPlan(
  harness: MutationHarness,
  mutationKind: CanonicalMutationKind = "administrative",
): Promise<CanonicalMutationPlan> {
  const relativePath = "docs/project-memory/source/NOTE.md";
  const previous = new Uint8Array(await readFile(new URL(relativePath, harness.repo)));
  const withoutHash: Omit<CanonicalMutationPlan, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: `mutation:${mutationKind}`,
    mutation_kind: mutationKind,
    root_id: ROOT_ID,
    target_ref: "refs/heads/main",
    expected_head: BASE,
    profile_lock_hash: PROFILE,
    writes: [{
      relative_path: relativePath,
      bytes: new TextEncoder().encode(`integrated:${mutationKind}\n`),
      expected_existing_sha256: sha256(previous),
      mode: "replace",
    }],
    record_ids: [],
    event_ids: [],
    approval_ids: [APPROVAL_ID],
    evidence_ids: [EVIDENCE_ID],
    created_by: "agent.integrator",
    created_at: "2026-07-14T12:00:00.000Z",
    expires_at: "2026-07-14T12:05:00.000Z",
    metadata: { governance_kind: mutationKind, required_approval_ids: [APPROVAL_ID], required_evidence_ids: [EVIDENCE_ID] },
  };
  return { ...withoutHash, plan_hash: canonicalMutationPlanHash(withoutHash) };
}

export async function pathMissing(target: URL): Promise<boolean> {
  try {
    await lstat(target);
    return false;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

export async function cleanupMutationHarnesses(): Promise<void> {
  await Promise.all(roots.map((directory) => rm(directory, { recursive: true, force: true })));
}
