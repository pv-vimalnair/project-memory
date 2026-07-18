import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { success } from "../../src/contracts/runtime-result.js";
import {
  canonicalMutationPlanHash,
  type CanonicalMutationPlan,
} from "../../src/contracts/canonical-mutation-plan.js";
import type { CanonicalRecord } from "../../src/governance/contracts/index.js";
import {
  bootstrapApprovalBinding,
} from "../../src/governance/integration/bootstrap-plan.js";
import type { IntegrationCoordinator } from "../../src/governance/integration/integration-coordinator.js";
import {
  buildInitialSourceProposal,
} from "../../src/cli/init/build-initial-source-proposal.js";
import {
  applyInitPlan,
  type InitApplyDependencies,
} from "../../src/cli/init/apply-init-plan.js";
import {
  initPlanHash,
  type InitPlan,
} from "../../src/cli/init/build-init-plan.js";
import { createInitCommands } from "../../src/cli/commands/init.js";
import { CommandRegistry } from "../../src/cli/command-registry.js";
import { executeCli } from "../../src/cli/main.js";

const FIXTURE = new URL("../fixtures/e2e/uninitialized-root/", import.meta.url);
const HEAD = "1".repeat(40);
const ROOT_ID = "ROOT-01J00000000000000000000000";
const APPROVAL_ID = "APR-01J00000000000000000000000";
const PLAN_ID = "PLAN-01J00000000000000000000000";
const CREATED_AT = "2026-07-16T10:00:00.000Z";
const EXPIRES_AT = "2026-07-16T11:00:00.000Z";
const roots: string[] = [];
let rootPath = "";
let root: URL;

async function copyFixture(): Promise<void> {
  rootPath = await mkdtemp(path.join(tmpdir(), "project-memory-init-"));
  roots.push(rootPath);
  await cp(fileURLToPath(FIXTURE), rootPath, { recursive: true });
  root = pathToFileURL(`${rootPath}${path.sep}`);
}

async function snapshot(directory: string): Promise<Readonly<Record<string, string>>> {
  const result: Record<string, string> = {};
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else result[path.relative(directory, absolute)] = (await readFile(absolute)).toString("base64");
    }
  }
  await visit(directory);
  return result;
}

function compilationPlan(): CanonicalMutationPlan<unknown> {
  const body: Omit<CanonicalMutationPlan<unknown>, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: PLAN_ID,
    mutation_kind: "profile.bootstrap",
    root_id: ROOT_ID,
    target_ref: "refs/heads/main",
    expected_head: HEAD,
    profile_lock_hash: "2".repeat(64),
    writes: [{
      relative_path: "docs/project-memory/project.yaml",
      bytes: new Uint8Array([1, 2, 3]),
      expected_existing_sha256: null,
      mode: "create",
    }],
    record_ids: [],
    event_ids: [],
    approval_ids: [APPROVAL_ID],
    evidence_ids: [],
    created_by: "codex",
    created_at: CREATED_AT,
    expires_at: EXPIRES_AT,
    metadata: { profile: { catalog: { release: "1.0.0" } } },
  };
  return { ...body, plan_hash: canonicalMutationPlanHash(body) };
}

function initPlan(overrides: Partial<InitPlan> = {}): InitPlan {
  const compilation = compilationPlan();
  const body: Omit<InitPlan, "plan_hash"> = {
    schema_version: "1.0.0",
    target_root_id: ROOT_ID,
    target_ref: "refs/heads/main",
    expected_head: HEAD,
    normalized_feature_hash: "4".repeat(64),
    selection: {
      disposition: "automatic",
      winner: null,
      runner_up: null,
      margin: null,
      ranked: [],
    },
    proposed_project_selection: {} as InitPlan["proposed_project_selection"],
    proposed_sources: {
      project: {} as InitPlan["proposed_sources"]["project"],
      constraints: [], policies: [], blueprint_documents: [], components: [], domains: [], root_relationships: [],
    },
    source_proposal: {
      schema_version: "1.0.0",
      facts: {},
      unresolved_required_facts: [],
      clarification: null,
    },
    source_proposal_hash: "5".repeat(64),
    unresolved_required_facts: [],
    required_approval_kinds: ["directional"],
    profile_compilation: compilation,
    replay: {
      root: root.href,
      brief_path: "brief.md",
      catalog_bundle_path: "catalog.bundle.json",
      agent_adapter: "adapter.codex",
      target_ref: "refs/heads/main",
      created_at: CREATED_AT,
      expires_at: EXPIRES_AT,
    },
    review_packet: {
      status: "review_required",
      reason: "Pitaji must approve the exact selection and source proposal.",
      approval_id: APPROVAL_ID,
    },
    ...overrides,
  };
  return { ...body, plan_hash: initPlanHash(body) };
}

function approval(plan: InitPlan): CanonicalRecord {
  const binding = bootstrapApprovalBinding({
    root,
    target_ref: plan.target_ref,
    root_id: plan.target_root_id,
    profile_lock_hash: plan.profile_compilation.profile_lock_hash,
    source_proposal_hash: plan.source_proposal_hash,
    compilation_plan_hash: plan.profile_compilation.plan_hash,
    created_at: plan.profile_compilation.created_at,
    expires_at: plan.profile_compilation.expires_at,
  });
  return {
    id: APPROVAL_ID,
    type: "approval",
    title: "Approve Project Memory bootstrap",
    status: "accepted",
    root_id: ROOT_ID,
    component_ids: [],
    initiative_id: null,
    workstream_id: null,
    task_id: null,
    actor_id: "Pitaji",
    authority_class: "pitaji",
    created_at: CREATED_AT,
    original_base_revision: HEAD,
    integration_base_revision: HEAD,
    catalog_versions: ["1.0.0"],
    relationships: [],
    payload: {
      approval_kind: "directional",
      granted_by: "Pitaji",
      ...binding,
      expires_at: EXPIRES_AT,
      invalidation_conditions: ["Any bound bootstrap input changes."],
    },
  };
}

function coordinator() {
  return {
    bootstrap: vi.fn(() => Promise.resolve(success({ status: "initialized_verified" } as never))),
    finalizeMutation: vi.fn(),
    validate: vi.fn(),
    finalize: vi.fn(),
  } satisfies IntegrationCoordinator;
}

function applyDependencies(plan: InitPlan, state: { dirty?: boolean; head?: string } = {}) {
  const integration = coordinator();
  const build_plan = vi.fn(() => Promise.resolve(success(plan)));
  const dependencies: InitApplyDependencies = {
    build_plan,
    git: {
      head: () => Promise.resolve(state.head ?? HEAD),
      statusPorcelain: () => Promise.resolve(state.dirty === true ? [{ index_status: "M", worktree_status: " ", path: "changed" }] : []),
    },
    coordinator: integration,
    now: () => new Date("2026-07-16T10:30:00.000Z"),
  };
  return { dependencies, integration, build_plan };
}

beforeEach(copyFixture);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("initial source proposal", () => {
  it("groups all missing required facts into one focused clarification", () => {
    const proposed = buildInitialSourceProposal({
      root,
      brief_path: "brief.md",
      brief_text: 'name: "Only a name"\n',
    });

    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    expect(proposed.value.unresolved_required_facts.length).toBeGreaterThan(1);
    expect(proposed.value.clarification).toMatchObject({ kind: "required_facts" });
    expect(proposed.value.facts.name).toMatchObject({ status: "evidenced", value: "Only a name" });
    expect(proposed.value.facts.mission).toMatchObject({ status: "unresolved", value: null });
  });
});

describe("init CLI planning", () => {
  it("is read-only against the target and always requires Pitaji review", async () => {
    const planned = initPlan();
    const before = await snapshot(rootPath);
    const commands = createInitCommands({
      build_plan: () => Promise.resolve(success(planned)),
      apply_plan: () => Promise.resolve(success({ status: "initialized_verified" } as never)),
    });
    const execution = await executeCli([
      "init", "plan", "--root", rootPath, "--brief", "brief.md",
      "--catalog", "catalog.bundle.json", "--agent-adapter", "adapter.codex", "--json",
    ], { registry: new CommandRegistry(commands), current_directory: root });

    expect(execution.exit_code).toBe(0);
    expect(execution.envelope.status).toBe("review_required");
    expect(execution.stdout).toContain('"bytes_base64":"AQID"');
    expect(execution.stdout).not.toContain('"0":1');
    expect(await snapshot(rootPath)).toEqual(before);
  });
});

describe("init apply boundary", () => {
  it("boots through the one-time coordinator protocol", async () => {
    const plan = initPlan();
    const harness = applyDependencies(plan);
    const result = await applyInitPlan({ saved_plan: plan, approval_record: approval(plan) }, harness.dependencies);

    expect(result.ok).toBe(true);
    expect(harness.build_plan).toHaveBeenCalledTimes(1);
    expect(harness.integration.bootstrap).toHaveBeenCalledTimes(1);
    expect(harness.integration.finalizeMutation).not.toHaveBeenCalled();
  });

  it("refuses a dirty canonical root", async () => {
    const plan = initPlan();
    const harness = applyDependencies(plan, { dirty: true });
    expect(await applyInitPlan({ saved_plan: plan, approval_record: approval(plan) }, harness.dependencies)).toMatchObject({
      ok: false,
      issues: [{ code: "GIT_DIRTY_ROOT" }],
    });
    expect(harness.integration.bootstrap).not.toHaveBeenCalled();
  });

  it("refuses head drift and a replayed plan drift", async () => {
    const saved = initPlan();
    const headHarness = applyDependencies(saved, { head: "9".repeat(40) });
    expect(await applyInitPlan({ saved_plan: saved, approval_record: approval(saved) }, headHarness.dependencies)).toMatchObject({
      ok: false,
      issues: [{ code: "INIT_HEAD_DRIFT" }],
    });

    const drifted = initPlan({ source_proposal_hash: "8".repeat(64) });
    const planHarness = applyDependencies(drifted);
    expect(await applyInitPlan({ saved_plan: saved, approval_record: approval(saved) }, planHarness.dependencies)).toMatchObject({
      ok: false,
      issues: [{ code: "INIT_PLAN_HASH_MISMATCH" }],
    });
  });

  it("requires exact, current Pitaji approval", async () => {
    const plan = initPlan();
    const harness = applyDependencies(plan);
    const wrong = { ...approval(plan), actor_id: "another-agent" } as CanonicalRecord;
    expect(await applyInitPlan({ saved_plan: plan, approval_record: wrong }, harness.dependencies)).toMatchObject({
      ok: false,
      issues: [{ code: "bootstrap.approval_invalid" }],
    });
    expect(harness.integration.bootstrap).not.toHaveBeenCalled();
  });

  it("binds the init plan hash to canonical content", () => {
    const plan = initPlan();
    const { plan_hash: ignored, ...body } = plan;
    expect(ignored).toBe(initPlanHash(body));
  });
});
