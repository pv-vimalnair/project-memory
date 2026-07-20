import { describe, expect, it, vi } from "vitest";

import {
  canonicalMutationPlanHash,
  type CanonicalMutationPlan,
} from "../../src/contracts/canonical-mutation-plan.js";
import { success } from "../../src/contracts/runtime-result.js";
import {
  CommandRegistry,
  createDefaultCommandRegistry,
} from "../../src/cli/command-registry.js";
import { executeCli } from "../../src/cli/main.js";
import { createCatalogCommands } from "../../src/cli/commands/catalog.js";
import { createProfileCommands } from "../../src/cli/commands/profile.js";
import { createSelectCommands } from "../../src/cli/commands/select.js";
import { createInitiativeCommands } from "../../src/cli/commands/initiative.js";
import { createWorkstreamCommands } from "../../src/cli/commands/workstream.js";
import { createTaskCommands } from "../../src/cli/commands/task.js";
import type { IntegrationCoordinator } from "../../src/governance/integration/integration-coordinator.js";
import type {
  WorkLifecyclePlan,
  WorkLifecycleService,
} from "../../src/governance/work/work-lifecycle-contracts.js";

const HEAD = "1".repeat(40);
const ROOT = new URL("file:///fixture/");

function mutationPlan(kind: CanonicalMutationPlan["mutation_kind"] = "profile.evolution") {
  const body: Omit<CanonicalMutationPlan<unknown>, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: "PLAN-01J00000000000000000000000",
    mutation_kind: kind,
    root_id: "ROOT-01J00000000000000000000000",
    target_ref: "refs/heads/main",
    expected_head: HEAD,
    profile_lock_hash: "2".repeat(64),
    writes: [],
    record_ids: [],
    event_ids: [],
    approval_ids: [],
    evidence_ids: [],
    created_by: "codex",
    created_at: "2026-07-16T10:00:00.000Z",
    expires_at: "2026-07-16T11:00:00.000Z",
    metadata: {},
  };
  return { ...body, plan_hash: canonicalMutationPlanHash(body) };
}

function lifecyclePlan(): WorkLifecyclePlan {
  const base = mutationPlan("work_lifecycle");
  const { plan_hash: ignored, ...fields } = base;
  void ignored;
  const body: Omit<WorkLifecyclePlan, "plan_hash"> = {
    ...fields,
    mutation_kind: "work_lifecycle",
    metadata: {
      governance_kind: "work_lifecycle",
      operation: "create",
      artifact_type: "initiative",
      artifact_id: "INIT-01J00000000000000000000000",
      document_path: "docs/project-memory/initiatives/example.yaml",
      from_status: null,
      to_status: "proposed",
      document_revision: 1,
      event_hash: "3".repeat(64),
      authority_class: "pitaji",
    },
  };
  return { ...body, plan_hash: canonicalMutationPlanHash(body) };
}

function coordinator() {
  return {
    bootstrap: vi.fn(),
    finalizeMutation: vi.fn((plan: CanonicalMutationPlan<unknown>) => Promise.resolve(success({
      status: "mutation_integrated",
      plan_id: plan.plan_id,
      plan_hash: plan.plan_hash,
    } as never))),
    validate: vi.fn(),
    finalize: vi.fn(),
  } satisfies IntegrationCoordinator;
}

function inputReader(value: unknown = { root: ROOT.href }) {
  return vi.fn(() => Promise.resolve(success(value)));
}

async function execute(commands: ReturnType<CommandRegistry["paths"]> extends never ? never : ConstructorParameters<typeof CommandRegistry>[0], args: readonly string[]) {
  return executeCli(args, { registry: new CommandRegistry(commands), current_directory: ROOT });
}

describe("profile planning commands", () => {
  it("keeps plan read-only and recomputes apply exactly once before finalization", async () => {
    const plan = mutationPlan();
    const integration = coordinator();
    const planner = { plan: vi.fn(() => Promise.resolve(success(plan))) };
    const commands = createProfileCommands({
      profile_compiler: planner,
      verify: vi.fn(() => Promise.resolve(success({ valid: true }))),
      diff: vi.fn(() => Promise.resolve(success({ changes: [] }))),
      coordinator: integration,
      read_input: inputReader(),
    });

    const planned = await execute(commands, ["profile", "plan", "--input", "profile.json", "--json"]);
    expect(planned.exit_code).toBe(0);
    expect(integration.finalizeMutation).not.toHaveBeenCalled();

    planner.plan.mockClear();
    const applied = await execute(commands, [
      "profile", "apply", "--input", "profile.json",
      "--expected-plan-hash", plan.plan_hash, "--expected-head", HEAD, "--json",
    ]);
    expect(applied.exit_code).toBe(0);
    expect(planner.plan).toHaveBeenCalledTimes(1);
    expect(integration.finalizeMutation).toHaveBeenCalledTimes(1);
    expect("apply" in planner).toBe(false);
  });

  it("rejects plan or head drift before finalization", async () => {
    const plan = mutationPlan();
    const integration = coordinator();
    const commands = createProfileCommands({
      profile_compiler: { plan: () => Promise.resolve(success(plan)) },
      verify: () => Promise.resolve(success({ valid: true })),
      diff: () => Promise.resolve(success({ changes: [] })),
      coordinator: integration,
      read_input: inputReader(),
    });
    const result = await execute(commands, [
      "profile", "apply", "--input", "profile.json",
      "--expected-plan-hash", "9".repeat(64), "--expected-head", HEAD,
    ]);
    expect(result).toMatchObject({ exit_code: 4, envelope: { issues: [{ code: "CLI_PLAN_HASH_MISMATCH" }] } });
    expect(integration.finalizeMutation).not.toHaveBeenCalled();
  });
});

describe("catalog and selection commands", () => {
  it("keeps master release and selected-catalog verification distinct", async () => {
    const plan = mutationPlan("administrative");
    const integration = coordinator();
    const releaseVerify = vi.fn(() => Promise.resolve(success({ lock: "release" })));
    const selectedVerify = vi.fn(() => Promise.resolve(success({ lock: "selected" })));
    const commands = createCatalogCommands({
      release_plan: vi.fn(() => Promise.resolve(success(plan))),
      release_verify: releaseVerify,
      selected_verify: selectedVerify,
      coordinator: integration,
      read_input: inputReader(),
    });

    expect((await execute(commands, ["catalog", "release", "verify", "--input", "release.json"])).exit_code).toBe(0);
    expect((await execute(commands, ["catalog", "selected", "verify", "--input", "selected.json"])).exit_code).toBe(0);
    expect(releaseVerify).toHaveBeenCalledTimes(1);
    expect(selectedVerify).toHaveBeenCalledTimes(1);

    expect((await execute(commands, [
      "catalog", "release", "apply", "--input", "release.json",
      "--expected-plan-hash", plan.plan_hash, "--expected-head", HEAD,
    ])).exit_code).toBe(0);
    expect(integration.finalizeMutation).toHaveBeenCalledTimes(1);
  });

  it("exposes selection and compilation checks as read-only commands", async () => {
    const calls = {
      root: vi.fn(() => Promise.resolve(success({ selected: "root" }))),
      work: vi.fn(() => Promise.resolve(success({ selected: "work" }))),
      compile: vi.fn(() => Promise.resolve(success({ compiled: true }))),
      materialize: vi.fn(() => Promise.resolve(success({ packet: true }))),
      completion: vi.fn(() => Promise.resolve(success({ valid: true }))),
    };
    const commands = createSelectCommands({
      select_root: calls.root,
      select_work: calls.work,
      compile_workstream: calls.compile,
      materialize_task: calls.materialize,
      validate_completion: calls.completion,
      read_input: inputReader(),
    });
    for (const path of [
      ["select", "root"], ["select", "work"], ["workstream", "compile"],
      ["task", "materialize"], ["completion", "validate"],
    ]) {
      expect((await execute(commands, [...path, "--input", "input.json"])).exit_code).toBe(0);
    }
    expect(Object.values(calls).every((call) => call.mock.calls.length === 1)).toBe(true);
  });
});

describe("governed work lifecycle commands", () => {
  it("routes every create and transition apply through the shared coordinator", async () => {
    const plan = lifecyclePlan();
    const service = {
      planCreateInitiative: vi.fn(() => Promise.resolve(success(plan))),
      planCreateWorkstream: vi.fn(() => Promise.resolve(success(plan))),
      planCreateTaskPacket: vi.fn(() => Promise.resolve(success(plan))),
      planTransition: vi.fn(() => Promise.resolve(success(plan))),
    } satisfies WorkLifecycleService;
    const integration = coordinator();
    const options = { service, coordinator: integration, read_input: inputReader() };
    const commands = [
      ...createInitiativeCommands(options),
      ...createWorkstreamCommands(options),
      ...createTaskCommands(options),
    ];

    for (const [artifact, operation] of [
      ["initiative", "create"], ["initiative", "transition"],
      ["workstream", "create"], ["workstream", "transition"],
      ["task", "create"], ["task", "transition"],
    ] as const) {
      const result = await execute(commands, [
        artifact, operation, "apply", "--input", "work.json",
        "--expected-plan-hash", plan.plan_hash, "--expected-head", HEAD,
      ]);
      expect(result.exit_code).toBe(0);
    }
    expect(integration.finalizeMutation).toHaveBeenCalledTimes(6);
    expect(service.planCreateInitiative).toHaveBeenCalledTimes(1);
    expect(service.planCreateWorkstream).toHaveBeenCalledTimes(1);
    expect(service.planCreateTaskPacket).toHaveBeenCalledTimes(1);
    expect(service.planTransition).toHaveBeenCalledTimes(3);
    expect("apply" in service).toBe(false);
  });

  it("does not accept coordinator lease tokens from callers", async () => {
    const plan = lifecyclePlan();
    const service = {
      planCreateInitiative: () => Promise.resolve(success(plan)),
      planCreateWorkstream: () => Promise.resolve(success(plan)),
      planCreateTaskPacket: () => Promise.resolve(success(plan)),
      planTransition: () => Promise.resolve(success(plan)),
    } satisfies WorkLifecycleService;
    const result = await execute(createInitiativeCommands({
      service, coordinator: coordinator(), read_input: inputReader(),
    }), ["initiative", "create", "plan", "--input", "work.json", "--lease-id", "caller-token"]);
    expect(result).toMatchObject({ exit_code: 2, envelope: { issues: [{ code: "CLI_FLAG_UNKNOWN" }] } });
  });
});

describe("default migration command wiring", () => {
  it("uses the injected migration service instead of the unavailable fallback", async () => {
    const plan = mutationPlan("migration");
    const service = {
      list: () => [],
      plan: vi.fn(() => Promise.resolve(success(plan as never))),
    };
    const integration = coordinator();
    const registry = createDefaultCommandRegistry({
      migration: {
        service,
        coordinator: integration,
        read_input: inputReader({}),
      },
    });

    const result = await executeCli([
      "migrate", "plan", "--input", "migration.json",
    ], { registry, current_directory: ROOT });
    expect(result.exit_code).toBe(0);
    expect(service.plan).toHaveBeenCalledTimes(1);
    expect(integration.finalizeMutation).not.toHaveBeenCalled();
  });
});
