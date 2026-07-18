import { lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  FixedClock,
  NodeCommandRunner,
  PROJECT_SCHEMA_REGISTRARS,
  canonicalJson,
  canonicalMutationPlanHash,
  failure,
  registerProjectSchemas,
  sha256,
  success,
  type CanonicalMutationPlan,
  type CommandSpec,
} from "../../src/index.js";
import type { CanonicalRecord } from "../../src/governance/contracts/index.js";
import {
  createBootstrapFinalizer,
  createBootstrapMutationHooks,
  bootstrapApprovalBinding,
  type BootstrapFinalizer,
  type BootstrapInput,
} from "../../src/governance/integration/bootstrap-finalizer.js";
import type { BootstrapFaultInjector } from "../../src/governance/integration/bootstrap-transaction.js";
import { createCanonicalMutationCoordinator } from "../../src/governance/integration/canonical-mutation-finalizer.js";
import { IntegrationGitCliClient } from "../../src/governance/integration/integration-git-client.js";
import {
  createIntegrationLeaseStore,
  leaseUrl,
  mutexUrl,
  type NonceSource,
} from "../../src/governance/integration/integration-lease-store.js";
import { createCanonicalSnapshotBuilder } from "../../src/governance/snapshot/canonical-snapshot-builder.js";
import { createRevisionTreeReader } from "../../src/governance/snapshot/revision-tree-reader.js";
import { createViewGenerator } from "../../src/governance/views/generate-views.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import { compileProductionProfilePlan } from "../helpers/production-profile-plan.js";

const NOW = new Date("2026-07-15T04:30:00.000Z");
const runner = new NodeCommandRunner();
const roots: string[] = [];
let productionPlan: ReturnType<typeof compileProductionProfilePlan> | null = null;

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
    args,
    cwd: root,
    timeout_ms: 30_000,
    env_allowlist: gitEnvironment(),
    max_output_bytes: 8_388_608,
  };
  const result = await runner.run(spec);
  if (result.exit_code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

class FixedNonces implements NonceSource {
  #counter = 0;

  nextNonce(): string {
    this.#counter += 1;
    return this.#counter.toString(16).padStart(64, "0");
  }
}

class ControlledIntegrationGit extends IntegrationGitCliClient {
  cas_allowed = true;

  override updateRef(
    repo: URL,
    ref: string,
    next: string,
    expected: string,
  ): Promise<boolean> {
    return this.cas_allowed
      ? super.updateRef(repo, ref, next, expected)
      : Promise.resolve(false);
  }
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

async function createRepository(): Promise<{
  readonly repo: URL;
  readonly temporary_root: URL;
  readonly head: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "project-memory-bootstrap-"));
  roots.push(directory);
  const repo = pathToFileURL(`${path.join(directory, "repo")}${path.sep}`);
  const temporaryRoot = pathToFileURL(`${path.join(directory, "temporary")}${path.sep}`);
  await mkdir(repo, { recursive: true });
  await mkdir(temporaryRoot, { recursive: true });
  const fixture = new URL(
    "../fixtures/governance/repositories/bootstrap/base/",
    import.meta.url,
  );
  const readme = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("README.md", fixture)),
  );
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(new URL("README.md", repo), readme),
  );
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.name", "Project Memory Test"]);
  await git(repo, ["config", "user.email", "project-memory@example.invalid"]);
  await git(repo, ["add", "--all", "--", "."]);
  await git(repo, ["commit", "-m", "base"]);
  return { repo, temporary_root: temporaryRoot, head: await git(repo, ["rev-parse", "HEAD"]) };
}

function rebindPlan(
  plan: CanonicalMutationPlan<unknown>,
  expectedHead: string,
): CanonicalMutationPlan<unknown> {
  const { plan_hash: ignored, ...body } = plan;
  void ignored;
  const rebound = { ...body, expected_head: expectedHead };
  return { ...rebound, plan_hash: canonicalMutationPlanHash(rebound) };
}

function approvalRecord(
  root: URL,
  plan: CanonicalMutationPlan<unknown>,
  sourceProposalHash: string,
): CanonicalRecord {
  const approvalId = plan.approval_ids[0];
  if (approvalId === undefined) throw new Error("fixture compiler plan has no approval");
  const metadata = plan.metadata as {
    readonly profile: { readonly catalog: { readonly release: string } };
  };
  const binding = bootstrapApprovalBinding({
    root,
    target_ref: plan.target_ref,
    root_id: plan.root_id,
    profile_lock_hash: plan.profile_lock_hash,
    source_proposal_hash: sourceProposalHash,
    compilation_plan_hash: plan.plan_hash,
    created_at: plan.created_at,
    expires_at: plan.expires_at,
  });
  return {
    id: approvalId,
    type: "approval",
    title: "Approve Project Memory bootstrap",
    status: "accepted",
    root_id: plan.root_id,
    component_ids: [],
    initiative_id: null,
    workstream_id: null,
    task_id: null,
    actor_id: "Pitaji",
    authority_class: "pitaji",
    created_at: plan.created_at,
    original_base_revision: plan.expected_head,
    integration_base_revision: plan.expected_head,
    catalog_versions: [metadata.profile.catalog.release],
    relationships: [],
    payload: {
      approval_kind: "directional",
      granted_by: "Pitaji",
      ...binding,
      expires_at: plan.expires_at,
      invalidation_conditions: ["Any bound bootstrap input changes."],
    },
  };
}

export interface BootstrapHarness {
  readonly repo: URL;
  readonly temporary_root: URL;
  readonly common_git_dir: URL;
  readonly head: string;
  readonly git_client: ControlledIntegrationGit;
  readonly finalizer: BootstrapFinalizer;
  readonly coordinator_calls: { value: number };
  readonly input: BootstrapInput;
}

export async function bootstrapHarness(
  faults?: BootstrapFaultInjector,
): Promise<BootstrapHarness> {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
  const repository = await createRepository();
  productionPlan ??= compileProductionProfilePlan();
  const production = await productionPlan;
  const plan = rebindPlan(production.plan, repository.head);
  const sourceProposalHash = sha256(canonicalJson(production.fixture.input.accepted_sources));
  const approval = approvalRecord(repository.repo, plan, sourceProposalHash);
  const input: BootstrapInput = {
    root: repository.repo,
    target_ref: plan.target_ref,
    expected_head: repository.head,
    root_id: plan.root_id,
    accepted_sources: production.fixture.input.accepted_sources,
    compilation_plan: plan,
    expected_plan_hash: plan.plan_hash,
    source_proposal_hash: sourceProposalHash,
    approval_record: approval,
  };
  const clock = new FixedClock(NOW);
  const gitClient = new ControlledIntegrationGit(runner);
  const snapshots = createCanonicalSnapshotBuilder(createRevisionTreeReader(runner));
  const leases = createIntegrationLeaseStore({
    clock,
    git: gitClient,
    nonces: new FixedNonces(),
  });
  const transactionCoordinator = createCanonicalMutationCoordinator({
    repo: repository.repo,
    temporary_root: repository.temporary_root,
    clock,
    git: gitClient,
    leases,
    snapshots,
    views: createViewGenerator({
      clock,
      target_ref: plan.target_ref,
      snapshots: {
        current: () => Promise.resolve(failure("test.unused", "not used")),
      },
    }),
    bindings: {
      verify: () => Promise.resolve(failure("test.binding_called", "bootstrap called task binding")),
    },
    authority: {
      verify: () => Promise.resolve(failure("test.authority_called", "bootstrap called task authority")),
    },
    repository: { validate: () => Promise.resolve(success(true)) },
    bootstrap: createBootstrapMutationHooks({ git: gitClient }),
    ...(faults === undefined ? {} : { bootstrap_faults: faults }),
  });
  const coordinatorCalls = { value: 0 };
  const coordinator = {
    finalizeMutation(plan: CanonicalMutationPlan<unknown>) {
      coordinatorCalls.value += 1;
      return transactionCoordinator.finalizeMutation(plan);
    },
  };
  return {
    ...repository,
    common_git_dir: await gitClient.commonGitDir(repository.repo),
    git_client: gitClient,
    finalizer: createBootstrapFinalizer({ clock, git: gitClient, coordinator }),
    coordinator_calls: coordinatorCalls,
    input,
  };
}

export function replanBootstrapInput(
  input: BootstrapInput,
  changes: Partial<CanonicalMutationPlan<unknown>>,
): BootstrapInput {
  const candidate = { ...input.compilation_plan, ...changes };
  const { plan_hash: ignored, ...body } = candidate;
  void ignored;
  const plan = { ...body, plan_hash: canonicalMutationPlanHash(body) };
  return {
    ...input,
    target_ref: plan.target_ref,
    expected_head: plan.expected_head,
    root_id: plan.root_id,
    compilation_plan: plan,
    expected_plan_hash: plan.plan_hash,
    approval_record: approvalRecord(input.root, plan, input.source_proposal_hash),
  };
}

export async function readJsonAt<T>(
  repo: URL,
  revision: string,
  relativePath: string,
): Promise<T> {
  return JSON.parse(await git(repo, ["show", `${revision}:${relativePath}`])) as T;
}

export async function commitCount(repo: URL, before: string, after: string): Promise<number> {
  return Number(await git(repo, ["rev-list", "--count", `${before}..${after}`]));
}

export async function expectCoordinationClean(harness: BootstrapHarness): Promise<void> {
  if (!(await missing(leaseUrl(harness.common_git_dir)))) throw new Error("lease leaked");
  if (!(await missing(mutexUrl(harness.common_git_dir)))) throw new Error("mutex leaked");
  if ((await readdir(harness.temporary_root)).length !== 0) throw new Error("temporary root leaked");
  const worktrees = (await git(harness.repo, ["worktree", "list", "--porcelain"]))
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("worktree "));
  if (worktrees.length !== 1) throw new Error("detached worktree metadata leaked");
}

export async function cleanupBootstrapHarnesses(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
