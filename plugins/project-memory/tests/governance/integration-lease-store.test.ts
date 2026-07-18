import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  PROJECT_SCHEMA_REGISTRARS,
  canonicalJson,
  registerProjectSchemas,
  type Clock,
  type GitClient,
  type GitStatusEntry,
} from "../../src/index.js";
import type { CanonicalRecord } from "../../src/governance/contracts/index.js";
import {
  createIntegrationLeaseStore,
  leaseUrl,
  mutexUrl,
  type AcquireLeaseInput,
  type NonceSource,
} from "../../src/governance/integration/integration-lease-store.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const BASE = "0123456789abcdef0123456789abcdef01234567";
const ROOT_ID = "ROOT-01J00000000000000000000001";
const roots: string[] = [];

class MutableClock implements Clock {
  #value = new Date("2026-07-14T12:00:00.000Z");

  now(): Date {
    return new Date(this.#value.getTime());
  }

  set(value: string): void {
    this.#value = new Date(value);
  }
}

class CounterNonce implements NonceSource {
  #counter = 0;

  nextNonce(): string {
    this.#counter += 1;
    return this.#counter.toString(16).padStart(64, "0");
  }
}

class FakeGit implements GitClient {
  headRevision = BASE;

  constructor(private readonly common: URL) {}

  head(): Promise<string> {
    return Promise.resolve(this.headRevision);
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

  createDetachedWorktree(): Promise<void> {
    return Promise.resolve();
  }

  removeWorktree(): Promise<void> {
    return Promise.resolve();
  }
}

async function directories(): Promise<{ readonly common: URL; readonly repo: URL }> {
  const root = await mkdtemp(path.join(tmpdir(), "project-memory-lease-"));
  roots.push(root);
  return {
    common: pathToFileURL(`${path.join(root, "common.git")}${path.sep}`),
    repo: pathToFileURL(`${path.join(root, "worktree")}${path.sep}`),
  };
}

function acquire(repo: URL, holderId: string): AcquireLeaseInput {
  return {
    repo,
    root_id: ROOT_ID,
    holder_id: holderId,
    authority_class: "integrator",
    base_revision: BASE,
    target_ref: "refs/heads/main",
    ttl_ms: 60_000,
  };
}

function takeoverApproval(
  priorHolder: string,
  grantedBy: string = "Pitaji",
): CanonicalRecord {
  return {
    id: "APR-01J00000000000000000000091",
    type: "approval",
    title: "Stale integration lease takeover",
    status: "accepted",
    root_id: ROOT_ID,
    component_ids: [],
    initiative_id: null,
    workstream_id: null,
    task_id: null,
    actor_id: grantedBy,
    authority_class: grantedBy === "Pitaji" ? "pitaji" : "integrator",
    created_at: "2026-07-14T12:01:01.000Z",
    original_base_revision: BASE,
    integration_base_revision: BASE,
    catalog_versions: ["1.0.0"],
    relationships: [],
    payload: {
      approval_kind: "lease_takeover",
      granted_by: grantedBy,
      target: priorHolder,
      environment: "refs/heads/main",
      scope: [BASE],
      timing: "stale-lease-takeover",
      expires_at: "2026-07-14T13:00:00.000Z",
      invalidation_conditions: ["holder-change", "base-change", "ref-change"],
    },
  };
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

afterAll(async () => {
  resetSchemaRegistryForTests();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("shared integration lease", () => {
  it("allows exactly one holder across concurrent worktrees", async () => {
    const paths = await directories();
    const clock = new MutableClock();
    const git = new FakeGit(paths.common);
    const store = createIntegrationLeaseStore({
      clock,
      git,
      nonces: new CounterNonce(),
    });
    const attempts = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        store.acquire(acquire(new URL(`worktree-${String(index)}/`, paths.repo), `integrator-${String(index)}`)),
      ),
    );
    expect(attempts.filter((attempt) => attempt.ok)).toHaveLength(1);
    const failureCodes = attempts
      .filter((attempt) => !attempt.ok)
      .map((attempt) => attempt.issues[0]?.code);
    expect(failureCodes).toEqual(
      Array.from({ length: 15 }, () => "lease.already_held"),
    );
    const persisted = await readFile(leaseUrl(paths.common), "utf8");
    const parsed = JSON.parse(persisted) as unknown;
    expect(persisted).toBe(canonicalJson(parsed));
    await expect(lstat(mutexUrl(paths.common))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("heartbeats and releases only with the exact holder nonce", async () => {
    const paths = await directories();
    const clock = new MutableClock();
    const git = new FakeGit(paths.common);
    const store = createIntegrationLeaseStore({ clock, git, nonces: new CounterNonce() });
    const acquired = await store.acquire(acquire(paths.repo, "integrator-a"));
    if (!acquired.ok) throw new Error(JSON.stringify(acquired.issues));
    expect(
      await store.heartbeat({ ...acquired.value, nonce: "f".repeat(64) }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "lease.holder_mismatch" }],
    });
    clock.set("2026-07-14T12:00:30.000Z");
    expect(await store.heartbeat(acquired.value)).toMatchObject({
      ok: true,
      value: { expires_at: "2026-07-14T12:01:30.000Z" },
    });
    expect(
      await store.release({ ...acquired.value, nonce: "e".repeat(64) }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "lease.holder_mismatch" }],
    });
    expect((await store.release(acquired.value)).ok).toBe(true);
    expect(await store.acquire(acquire(paths.repo, "integrator-b"))).toMatchObject({ ok: true });
  });

  it("fails heartbeat after repository base drift", async () => {
    const paths = await directories();
    const clock = new MutableClock();
    const git = new FakeGit(paths.common);
    const store = createIntegrationLeaseStore({ clock, git, nonces: new CounterNonce() });
    const acquired = await store.acquire(acquire(paths.repo, "integrator-a"));
    if (!acquired.ok) throw new Error(JSON.stringify(acquired.issues));
    git.headRevision = "b".repeat(40);
    expect(await store.heartbeat(acquired.value)).toMatchObject({
      ok: false,
      issues: [{ code: "lease.base_drift" }],
    });
  });

  it("requires exact approved takeover of a stale lease", async () => {
    const paths = await directories();
    const clock = new MutableClock();
    const git = new FakeGit(paths.common);
    const store = createIntegrationLeaseStore({ clock, git, nonces: new CounterNonce() });
    const acquired = await store.acquire(acquire(paths.repo, "integrator-a"));
    if (!acquired.ok) throw new Error(JSON.stringify(acquired.issues));
    clock.set("2026-07-14T12:01:01.000Z");
    expect(await store.acquire(acquire(paths.repo, "integrator-b"))).toMatchObject({
      ok: false,
      issues: [{ code: "lease.takeover_required" }],
    });
    expect(
      await store.takeover({
        ...acquire(paths.repo, "integrator-b"),
        approval: takeoverApproval("integrator-a", "unrelated-human"),
        designated_integration_owner_id: "designated-owner",
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "lease.takeover_not_approved" }],
    });
    const takeover = await store.takeover({
      ...acquire(paths.repo, "integrator-b"),
      approval: takeoverApproval("integrator-a"),
      designated_integration_owner_id: "designated-owner",
    });
    if (!takeover.ok) throw new Error(JSON.stringify(takeover.issues));
    expect(takeover.value).toMatchObject({
      holder_id: "integrator-b",
      takeover_approval_id: "APR-01J00000000000000000000091",
      takeover_event: { event_type: "lease_taken_over" },
      audit_evidence: { prior_holder_id: "integrator-a" },
    });
  });

  it("recovers a crashed expired mutex without taking over a live lease", async () => {
    const paths = await directories();
    const commonPath = fileURLToPath(paths.common);
    const fixture = fileURLToPath(
      new URL("../fixtures/governance/gates/lease-contender.mjs", import.meta.url),
    );
    const child = spawn(process.execPath, [fixture, commonPath, "2026-07-14T12:00:00.000Z"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("contender timeout"));
      }, 10_000);
      child.once("error", reject);
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString("utf8").includes("mutex-acquired")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    child.kill();
    const clock = new MutableClock();
    clock.set("2026-07-14T12:00:31.000Z");
    const store = createIntegrationLeaseStore({
      clock,
      git: new FakeGit(paths.common),
      nonces: new CounterNonce(),
    });
    expect(await store.acquire(acquire(paths.repo, "integrator-recovery"))).toMatchObject({ ok: true });
    await expect(lstat(mutexUrl(paths.common))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
