import { describe, expect, it, vi } from "vitest";

import { failure, success } from "../../src/contracts/runtime-result.js";
import type { InitPlan } from "../../src/cli/init/build-init-plan.js";
import type { DoctorReport } from "../../src/cli/commands/doctor.js";
import type { ProfileVerificationReport } from "../../src/profile/verify-profile.js";
import type { ViewDriftReport } from "../../src/governance/views/view-drift.js";
import {
  AGENT_READING_ORDER_PREFIX,
  startAgentSession,
} from "../../src/agent/index.js";
import type { AgentStartDependencies } from "../../src/agent/contracts.js";

const ROOT = new URL("file:///C:/project/");
const HEAD = "1".repeat(40);
const ROOT_ID = "ROOT-01J00000000000000000000000";
const PROFILE_HASH = "2".repeat(64);


function doctorReport(): DoctorReport {
  return {
    schema_version: "1.0.0",
    root: ROOT.href,
    root_id: ROOT_ID,
    valid: true,
    checks: [],
  };
}

function profileReport(): ProfileVerificationReport {
  return {
    valid: true,
    root_id: ROOT_ID,
    profile_lock_hash: PROFILE_HASH,
    selected_catalog_lock_hash: "3".repeat(64),
    checked_paths: [],
    external_reads: [],
  };
}

function viewReport(overrides: Partial<ViewDriftReport> = {}): ViewDriftReport {
  return {
    valid: true,
    source_revision: HEAD,
    source_set_hash: "4".repeat(64),
    generated_at: "2026-07-16T10:00:00.000Z",
    checked_paths: [],
    drifted_paths: [],
    missing_paths: [],
    metadata_invalid_paths: [],
    ...overrides,
  };
}

function initPlan(fields: readonly string[] = []): InitPlan {
  return {
    schema_version: "1.0.0",
    target_root_id: ROOT_ID,
    target_ref: "refs/heads/main",
    expected_head: HEAD,
    normalized_feature_hash: "5".repeat(64),
    selection: {
      disposition: "automatic",
      winner: { definition_id: "application.consumer-mobile" },
    } as InitPlan["selection"],
    proposed_project_selection: {
      root: { blueprint: { id: "application.consumer-mobile" } },
    } as InitPlan["proposed_project_selection"],
    proposed_sources: {} as InitPlan["proposed_sources"],
    source_proposal: {
      schema_version: "1.0.0",
      facts: {},
      unresolved_required_facts: fields,
      clarification: fields.length === 0
        ? null
        : {
            kind: "required_facts",
            question: `Please provide together: ${fields.join(", ")}.`,
            fields,
          },
    },
    source_proposal_hash: "6".repeat(64),
    unresolved_required_facts: fields,
    required_approval_kinds: ["directional"],
    profile_compilation: {} as InitPlan["profile_compilation"],
    replay: {
      root: ROOT.href,
      brief_path: "brief.md",
      catalog_bundle_path: "catalog.bundle.json",
      agent_adapter: "adapter.codex",
      target_ref: "refs/heads/main",
      created_at: "2026-07-16T10:00:00.000Z",
      expires_at: "2026-07-16T11:00:00.000Z",
    },
    review_packet: {
      status: "review_required",
      reason: "Pitaji approval required",
      approval_id: "APR-01J00000000000000000000000",
    },
    plan_hash: "7".repeat(64),
  };
}

function dependencies(
  overrides: Partial<AgentStartDependencies> = {},
): AgentStartDependencies & {
  readonly write: ReturnType<typeof vi.fn>;
  readonly commit: ReturnType<typeof vi.fn>;
  readonly claim: ReturnType<typeof vi.fn>;
  readonly lease: ReturnType<typeof vi.fn>;
  readonly finalize: ReturnType<typeof vi.fn>;
} {
  return {
    doctor: vi.fn(() => Promise.resolve(success(doctorReport()))),
    planInitialization: vi.fn(() => Promise.resolve(success(initPlan()))),
    verifyProfile: vi.fn(() => Promise.resolve(success(profileReport()))),
    verifyViews: vi.fn(() => Promise.resolve(success(viewReport()))),
    findAssignedTaskPackets: vi.fn(() => Promise.resolve(success([
      "docs/project-memory/workstreams/WS-01/tasks/TASK-02/TASK.md",
    ]))),
    write: vi.fn(),
    commit: vi.fn(),
    claim: vi.fn(),
    lease: vi.fn(),
    finalize: vi.fn(),
    ...overrides,
  };
}

describe("read-only agent startup", () => {
  it("blocks an empty repository until one grouped brief is available", async () => {
    const deps = dependencies({
      doctor: vi.fn(() => Promise.resolve(failure("CONFIG_NOT_FOUND", "no project memory"))),
    });
    const result = await startAgentSession(
      { root: ROOT, brief_path: null, adapter_id: "adapter.codex" },
      deps,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { kind: "blocked", issues: [{ code: "AGENT_BRIEF_REQUIRED" }] },
    });
    expect(deps.planInitialization).not.toHaveBeenCalled();
  });

  it("returns an engine-selected bootstrap proposal without a profile menu or mutation", async () => {
    const deps = dependencies({
      doctor: vi.fn(() => Promise.resolve(failure("CONFIG_MISSING", "not initialized"))),
    });
    const result = await startAgentSession(
      { root: ROOT, brief_path: "brief.md", adapter_id: "adapter.codex" },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "bootstrap_review_required") return;
    expect(result.value.proposal.plan.proposed_project_selection.root.blueprint.id)
      .toBe("application.consumer-mobile");
    expect(result.value.proposal.confirmation_required).toBe(true);
    expect(result.value.proposal).not.toHaveProperty("profile_choices");
    expect(result.value.apply_command.slice(0, 2)).toEqual(["init", "apply"]);
    expect(result.value.apply_command).toContain(result.value.proposal.plan.plan_hash);
    expect(result.value.apply_command).toContain(result.value.proposal.plan.expected_head);
    expect(result.value.apply_command.join(" ")).not.toMatch(/lease|[|;&]/);
    for (const operation of [deps.write, deps.commit, deps.claim, deps.lease, deps.finalize]) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it("returns the planner's single grouped clarification", async () => {
    const deps = dependencies({
      doctor: vi.fn(() => Promise.resolve(failure("CONFIG_MISSING", "not initialized"))),
      planInitialization: vi.fn(() => Promise.resolve(success(initPlan(["mission", "owners"])))),
    });
    const result = await startAgentSession(
      { root: ROOT, brief_path: "brief.md", adapter_id: "adapter.codex" },
      deps,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: "bootstrap_review_required",
        clarification: { kind: "required_facts", fields: ["mission", "owners"] },
      },
    });
  });

  it("resumes an initialized root in a deterministic reading order", async () => {
    const deps = dependencies({
      findAssignedTaskPackets: vi.fn(() => Promise.resolve(success([
        "docs/project-memory/workstreams/WS-02/tasks/TASK-03/TASK.md",
        "docs/project-memory/workstreams/WS-01/tasks/TASK-02/TASK.md",
      ]))),
    });
    const result = await startAgentSession(
      { root: ROOT, brief_path: null, adapter_id: "adapter.codex" },
      deps,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: "resume",
        root_id: ROOT_ID,
        profile_lock_hash: PROFILE_HASH,
        reading_order: [
          ...AGENT_READING_ORDER_PREFIX,
          "docs/project-memory/workstreams/WS-01/tasks/TASK-02/TASK.md",
          "docs/project-memory/workstreams/WS-02/tasks/TASK-03/TASK.md",
        ],
        warnings: [],
      },
    });
    expect(deps.planInitialization).not.toHaveBeenCalled();
  });

  it("blocks a stale profile lock before checking views", async () => {
    const deps = dependencies({
      verifyProfile: vi.fn(() => Promise.resolve(failure(
        "PROFILE_LOCK_HASH_MISMATCH",
        "stale lock",
      ))),
    });
    const result = await startAgentSession(
      { root: ROOT, brief_path: null, adapter_id: "adapter.codex" },
      deps,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { kind: "blocked", issues: [{ code: "PROFILE_LOCK_HASH_MISMATCH" }] },
    });
    expect(deps.verifyViews).not.toHaveBeenCalled();
  });

  it("blocks stale generated views before locating work", async () => {
    const deps = dependencies({
      verifyViews: vi.fn(() => Promise.resolve(success(viewReport({
        valid: false,
        drifted_paths: ["docs/project-memory/views/NOW.md"],
      })))),
    });
    const result = await startAgentSession(
      { root: ROOT, brief_path: null, adapter_id: "adapter.codex" },
      deps,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { kind: "blocked", issues: [{ code: "AGENT_VIEWS_STALE" }] },
    });
    expect(deps.findAssignedTaskPackets).not.toHaveBeenCalled();
  });

  it("resumes in the fixed reading order when no task packet is assigned", async () => {
    const deps = dependencies({
      findAssignedTaskPackets: vi.fn(() => Promise.resolve(success([]))),
    });
    const result = await startAgentSession(
      { root: ROOT, brief_path: null, adapter_id: "adapter.codex" },
      deps,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: "resume",
        reading_order: AGENT_READING_ORDER_PREFIX,
        assigned_task_packets: [],
      },
    });
  });

  it("converts an injected dependency rejection into a stable blocked directive", async () => {
    const deps = dependencies({
      doctor: vi.fn(() => Promise.reject(new Error("private stack detail"))),
    });
    const result = await startAgentSession(
      { root: ROOT, brief_path: null, adapter_id: "adapter.codex" },
      deps,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { kind: "blocked", issues: [{ code: "AGENT_DEPENDENCY_REJECTED", path: "doctor" }] },
    });
    expect(JSON.stringify(result)).not.toContain("private stack detail");
  });
});
