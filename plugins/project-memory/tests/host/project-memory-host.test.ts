import { describe, expect, it, vi } from "vitest";

import type { AgentStartDirective } from "../../src/agent/contracts.js";
import {
  initPlanHash,
  type InitPlan,
} from "../../src/cli/init/build-init-plan.js";
import { failure, success } from "../../src/contracts/runtime-result.js";
import { InMemoryProposalStore } from "../../src/host/proposal-store.js";
import {
  ProjectMemoryHost,
  type ProjectMemoryHostDependencies,
} from "../../src/host/project-memory-host.js";

const ROOT = new URL("file:///C:/project/");
const HEAD = "1".repeat(40);
const ROOT_ID = "ROOT-01J00000000000000000000000";
const APPROVAL_ID = "APR-01J00000000000000000000000";
const CREATED_AT = "2026-07-17T12:00:00.000Z";
const EXPIRES_AT = "2026-07-17T13:00:00.000Z";

const PLAN_BODY = {
  target_root_id: ROOT_ID,
  target_ref: "refs/heads/main",
  expected_head: HEAD,
  selection: {
    disposition: "automatic",
    winner: { definition_id: "application.consumer-mobile" },
    runner_up: null,
    margin: null,
    ranked: [],
  },
  proposed_project_selection: {
    root: {
      id: ROOT_ID,
      namespace: "project",
      kind: "product",
      primary_archetype: "application",
      blueprint: { id: "application.consumer-mobile", version: "1.0.0" },
      lifecycle: "active",
    },
    overlays: ["overlay.security"],
    components: [{ definition: { id: "component.mobile-client", version: "1.0.0" } }],
    domains: [{ definition: { id: "domain.identity", version: "1.0.0" } }],
    adapters: {
      agent: [{ id: "adapter.codex", version: "1.0.0" }],
      runtime: [{ id: "adapter.flutter", version: "1.0.0" }],
      workflow: [{ id: "adapter.git", version: "1.0.0" }],
    },
    catalog: { release: "1.0.0", catalog_hash: "3".repeat(64) },
  },
  source_proposal: {
    schema_version: "1.0.0",
    facts: {
      name: {
        status: "evidenced",
        value: "Project",
        evidence: {
          evidence_id: "EVD-01J00000000000000000000000",
          source_kind: "brief",
          source_ref: "brief.md",
          source_sha256: "4".repeat(64),
          pointer: "/name",
          source_text: "Project",
        },
      },
    },
    unresolved_required_facts: [],
    clarification: null,
  },
  source_proposal_hash: "5".repeat(64),
  unresolved_required_facts: [],
  profile_compilation: {
    plan_hash: "6".repeat(64),
    profile_lock_hash: "7".repeat(64),
    created_at: CREATED_AT,
    expires_at: EXPIRES_AT,
  },
  replay: {
    root: ROOT.href,
    brief_path: "brief.md",
    catalog_bundle_path: "catalog.bundle.json",
    agent_adapter: "adapter.codex",
    target_ref: "refs/heads/main",
    created_at: CREATED_AT,
    expires_at: EXPIRES_AT,
  },
  review_packet: {
    status: "review_required",
    reason: "Pitaji approval required",
    approval_id: APPROVAL_ID,
  },
} as unknown as Omit<InitPlan, "plan_hash">;
const PLAN = {
  ...PLAN_BODY,
  plan_hash: initPlanHash(PLAN_BODY),
} as InitPlan;

const BOOTSTRAP_DIRECTIVE: AgentStartDirective = {
  kind: "bootstrap_review_required",
  proposal: { confirmation_required: true, plan: PLAN },
  clarification: null,
  legacy_import_proposal: null,
  apply_command: ["init", "apply"],
};

function harness(
  startDirective: AgentStartDirective = BOOTSTRAP_DIRECTIVE,
  applyResult = success({ status: "initialized_verified" } as never),
) {
  const dependencies: ProjectMemoryHostDependencies = {
    start: vi.fn(() => Promise.resolve(success(startDirective))),
    applyBootstrap: vi.fn(() => Promise.resolve(applyResult)),
  };
  const proposals = new InMemoryProposalStore({
    now: () => new Date("2026-07-17T12:30:00.000Z"),
    handle: () => "pm-proposal-00000000000000000000000000000001",
  });
  return { host: new ProjectMemoryHost(dependencies, proposals), dependencies };
}

describe("ProjectMemoryHost", () => {
  it("returns a compact bootstrap summary without compilation bytes", async () => {
    const { host } = harness();

    const result = await host.start({
      root: ROOT,
      brief_path: "brief.md",
      adapter_id: "adapter.codex",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: "bootstrap_review_required",
        proposal_handle: "pm-proposal-00000000000000000000000000000001",
        confirmation_required: true,
        summary: {
          operation: "bootstrap",
          repository: ROOT.href,
          plan_hash: PLAN.plan_hash,
          expected_head: PLAN.expected_head,
          root_id: ROOT_ID,
          selected_blueprint: "application.consumer-mobile",
          selected_components: ["component.mobile-client"],
          selected_domains: ["domain.identity"],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("profile_compilation");
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(65_536);
  });

  it("applies a cached bootstrap once through the injected coordinator path", async () => {
    const { host, dependencies } = harness();
    const started = await host.start({
      root: ROOT,
      brief_path: "brief.md",
      adapter_id: "adapter.codex",
    });
    if (!started.ok || started.value.kind !== "bootstrap_review_required") {
      throw new Error("fixture failed");
    }

    const applied = await host.applyBootstrap({
      proposal_handle: started.value.proposal_handle,
      approval: { confirmed: true, granted_by: "Pitaji" },
    });

    expect(applied).toMatchObject({ ok: true, value: { status: "initialized_verified" } });
    expect(dependencies.applyBootstrap).toHaveBeenCalledTimes(1);
    const appliedInput = vi.mocked(dependencies.applyBootstrap).mock.calls[0]?.[0];
    expect(appliedInput).toMatchObject({
      saved_plan: PLAN,
      approval_record: {
        id: APPROVAL_ID,
        type: "approval",
        status: "accepted",
        actor_id: "Pitaji",
        authority_class: "pitaji",
        payload: { granted_by: "Pitaji" },
      },
    });
    expect(await host.applyBootstrap({
      proposal_handle: started.value.proposal_handle,
      approval: { confirmed: true, granted_by: "Pitaji" },
    })).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_NOT_FOUND" }],
    });
  });

  it("requires explicit Pitaji confirmation", async () => {
    const { host, dependencies } = harness();
    const started = await host.start({
      root: ROOT,
      brief_path: "brief.md",
      adapter_id: "adapter.codex",
    });
    if (!started.ok || started.value.kind !== "bootstrap_review_required") {
      throw new Error("fixture failed");
    }

    expect(await host.applyBootstrap({
      proposal_handle: started.value.proposal_handle,
      approval: { confirmed: false, granted_by: "Pitaji" },
    })).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_APPROVAL_REQUIRED" }],
    });
    expect(dependencies.applyBootstrap).not.toHaveBeenCalled();
  });

  it("retains a proposal when the coordinator path rejects the apply", async () => {
    const { host, dependencies } = harness(
      BOOTSTRAP_DIRECTIVE,
      failure("INIT_HEAD_DRIFT", "repository changed"),
    );
    const started = await host.start({
      root: ROOT,
      brief_path: "brief.md",
      adapter_id: "adapter.codex",
    });
    if (!started.ok || started.value.kind !== "bootstrap_review_required") {
      throw new Error("fixture failed");
    }

    const input = {
      proposal_handle: started.value.proposal_handle,
      approval: { confirmed: true as const, granted_by: "Pitaji" as const },
    };
    expect(await host.applyBootstrap(input)).toMatchObject({
      ok: false,
      issues: [{ code: "INIT_HEAD_DRIFT" }],
    });
    expect(await host.applyBootstrap(input)).toMatchObject({
      ok: false,
      issues: [{ code: "INIT_HEAD_DRIFT" }],
    });
    expect(dependencies.applyBootstrap).toHaveBeenCalledTimes(2);
  });

  it("passes deterministic resume directives through without a proposal", async () => {
    const resume: AgentStartDirective = {
      kind: "resume",
      root_id: ROOT_ID,
      profile_lock_hash: "7".repeat(64),
      reading_order: ["PROJECT_CONTEXT.md"],
      assigned_task_packets: [],
      warnings: [],
    };
    const { host } = harness(resume);

    expect(await host.start({ root: ROOT, brief_path: null, adapter_id: "adapter.codex" }))
      .toEqual(success(resume));
  });
});
