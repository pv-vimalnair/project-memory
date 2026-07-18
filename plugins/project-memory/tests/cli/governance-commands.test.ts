import { describe, expect, it, vi } from "vitest";

import {
  canonicalMutationPlanHash,
  type CanonicalMutationPlan,
} from "../../src/contracts/canonical-mutation-plan.js";
import { failure, success } from "../../src/contracts/runtime-result.js";
import { CommandRegistry } from "../../src/cli/command-registry.js";
import { executeCli } from "../../src/cli/main.js";
import { createClaimCommands } from "../../src/cli/commands/claim.js";
import { createViewsCommands } from "../../src/cli/commands/views.js";
import { createArchiveCommands } from "../../src/cli/commands/archive.js";
import { createIntegrateCommands } from "../../src/cli/commands/integrate.js";
import { createSatelliteCommands } from "../../src/cli/commands/satellite.js";
import { createHubCommands } from "../../src/cli/commands/hub.js";
import type { IntegrationCoordinator } from "../../src/governance/integration/integration-coordinator.js";
import type { MultiRepoFinalizer } from "../../src/governance/integration/integration-recovery.js";

const HEAD = "1".repeat(40);
const ROOT = new URL("file:///fixture/");

function plan(kind: CanonicalMutationPlan["mutation_kind"]) {
  const body: Omit<CanonicalMutationPlan<unknown>, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: "PLAN-01J00000000000000000000000",
    mutation_kind: kind,
    root_id: "ROOT-01J00000000000000000000000",
    target_ref: "refs/heads/main",
    expected_head: HEAD,
    profile_lock_hash: "2".repeat(64),
    writes: [], record_ids: [], event_ids: [], approval_ids: [], evidence_ids: [],
    created_by: "codex",
    created_at: "2026-07-16T10:00:00.000Z",
    expires_at: "2026-07-16T11:00:00.000Z",
    metadata: {},
  };
  return { ...body, plan_hash: canonicalMutationPlanHash(body) };
}

function coordinator(overrides: Partial<IntegrationCoordinator> = {}) {
  return {
    bootstrap: vi.fn(),
    finalizeMutation: vi.fn(() => Promise.resolve(success({ status: "mutation_integrated" } as never))),
    validate: vi.fn(() => Promise.resolve(success({ token: "validated" } as never))),
    finalize: vi.fn(() => Promise.resolve(success({ status: "integrated_verified" } as never))),
    ...overrides,
  } satisfies IntegrationCoordinator;
}

function reader(value: unknown = { root: ROOT.href }) {
  return vi.fn(() => Promise.resolve(success(value)));
}

async function run(commands: ConstructorParameters<typeof CommandRegistry>[0], args: readonly string[]) {
  return executeCli(args, { registry: new CommandRegistry(commands), current_directory: ROOT });
}

describe("claim governance commands", () => {
  it("maps conflicts and missing approvals without entering finalization", async () => {
    const integration = coordinator();
    const commands = createClaimCommands({
      plan_issue: () => Promise.resolve(failure("claim.conflict", "overlap")),
      plan_renew: () => Promise.resolve(failure("approval.required", "Pitaji approval required")),
      validate: () => Promise.resolve(success({ valid: true })),
      coordinator: integration,
      read_input: reader(),
    });
    expect((await run(commands, ["claim", "issue", "plan", "--input", "claim.json"])).exit_code).toBe(4);
    expect((await run(commands, ["claim", "renew", "plan", "--input", "claim.json"])).exit_code).toBe(3);
    expect(integration.finalizeMutation).not.toHaveBeenCalled();
  });

  it("recomputes an issue plan and finalizes exactly once", async () => {
    const planned = plan("claim");
    const integration = coordinator();
    const issue = vi.fn(() => Promise.resolve(success(planned)));
    const commands = createClaimCommands({
      plan_issue: issue,
      plan_renew: issue,
      validate: () => Promise.resolve(success({ valid: true })),
      coordinator: integration,
      read_input: reader(),
    });
    const result = await run(commands, [
      "claim", "issue", "apply", "--input", "claim.json",
      "--expected-plan-hash", planned.plan_hash, "--expected-head", HEAD,
    ]);
    expect(result.exit_code).toBe(0);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(integration.finalizeMutation).toHaveBeenCalledTimes(1);
  });
});

describe("views and archive commands", () => {
  it("keeps checks read-only and routes apply through the coordinator", async () => {
    const viewPlan = plan("view");
    const archivePlan = plan("archive");
    const integration = coordinator();
    const viewCheck = vi.fn(() => Promise.resolve(success({ drift: [] })));
    const archiveVerify = vi.fn(() => Promise.resolve(success({ valid: true })));
    const commands = [
      ...createViewsCommands({
        plan_generate: () => Promise.resolve(success(viewPlan)),
        check: viewCheck,
        coordinator: integration,
        read_input: reader(),
      }),
      ...createArchiveCommands({
        plan_ingest: () => Promise.resolve(success(archivePlan)),
        verify: archiveVerify,
        coordinator: integration,
        read_input: reader(),
      }),
    ];
    expect((await run(commands, ["views", "check", "--input", "root.json"])).exit_code).toBe(0);
    expect((await run(commands, ["archive", "verify", "--input", "archive.json"])).exit_code).toBe(0);
    expect(integration.finalizeMutation).not.toHaveBeenCalled();

    for (const [group, operation, value] of [
      ["views", "generate", viewPlan],
      ["archive", "ingest", archivePlan],
    ] as const) {
      expect((await run(commands, [
        group, operation, "apply", "--input", "input.json",
        "--expected-plan-hash", value.plan_hash, "--expected-head", HEAD,
      ])).exit_code).toBe(0);
    }
    expect(viewCheck).toHaveBeenCalledTimes(1);
    expect(archiveVerify).toHaveBeenCalledTimes(1);
    expect(integration.finalizeMutation).toHaveBeenCalledTimes(2);
  });
});

describe("explicit integration protocols", () => {
  it("validates from a completion packet and never accepts a caller lease", async () => {
    const integration = coordinator();
    const commands = createIntegrateCommands({ coordinator: integration, read_input: reader() });
    expect((await run(commands, ["integrate", "validate", "--input", "completion.json"])).exit_code).toBe(0);
    expect(integration.validate).toHaveBeenCalledTimes(1);
    expect(integration.finalize).not.toHaveBeenCalled();

    expect((await run(commands, ["integrate", "finalize", "--input", "completion.json"])).exit_code).toBe(0);
    expect(integration.validate).toHaveBeenCalledTimes(2);
    expect(integration.finalize).toHaveBeenCalledTimes(1);

    const rejected = await run(commands, [
      "integrate", "finalize", "--input", "completion.json", "--lease-id", "caller-token",
    ]);
    expect(rejected).toMatchObject({ exit_code: 2, envelope: { issues: [{ code: "CLI_FLAG_UNKNOWN" }] } });
  });

  it("blocks finalization when validation gates fail", async () => {
    const integration = coordinator({
      validate: vi.fn(() => Promise.resolve(failure("gate.failed", "required gate failed"))),
    });
    const result = await run(
      createIntegrateCommands({ coordinator: integration, read_input: reader() }),
      ["integrate", "finalize", "--input", "completion.json"],
    );
    expect(result.exit_code).not.toBe(0);
    expect(integration.finalize).not.toHaveBeenCalled();
  });

  it("delegates satellite preparation and hub finalization with exact inputs", async () => {
    const multi = {
      prepareSatellite: vi.fn(() => Promise.resolve(success({ preparation_id: "PREP-1" } as never))),
      finalizeHub: vi.fn(() => Promise.resolve(success({ status: "integrated_verified" } as never))),
      inspectRecovery: vi.fn(),
    } satisfies MultiRepoFinalizer;
    const commands = [
      ...createSatelliteCommands({ finalizer: multi, read_input: reader({ work_commit_hash: "3".repeat(40) }) }),
      ...createHubCommands({ finalizer: multi, read_input: reader({ preparation_id: "PREP-1" }) }),
    ];
    expect((await run(commands, ["satellite", "prepare", "--input", "satellite.json"])).exit_code).toBe(0);
    expect((await run(commands, ["hub", "finalize", "--input", "hub.json"])).exit_code).toBe(0);
    expect(multi.prepareSatellite).toHaveBeenCalledTimes(1);
    expect(multi.finalizeHub).toHaveBeenCalledTimes(1);
  });
});
