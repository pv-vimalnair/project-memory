import { describe, expect, it, vi } from "vitest";
import { AGENT_READING_ORDER_PREFIX } from "../../src/agent/start.js";

import type { AgentStartDirective } from "../../src/agent/contracts.js";
import {
  initPlanHash,
  type InitPlan,
} from "../../src/cli/init/build-init-plan.js";
import { canonicalMutationPlanHash } from "../../src/contracts/canonical-mutation-plan.js";
import { failure, success } from "../../src/contracts/runtime-result.js";
import { canonicalJson } from "../../src/core/canonical-json.js";
import { sha256 } from "../../src/core/hash.js";
import { GENERATED_VIEW_PATHS } from "../../src/governance/views/generate-views.js";
import { InMemoryProposalStore } from "../../src/host/proposal-store.js";
import {
  ProjectMemoryHost,
  type ProjectMemoryHostDependencies,
} from "../../src/host/project-memory-host.js";
import type { RepositoryUpgradePlan } from "../../src/upgrades/contracts.js";

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

const LEGACY_SCAN_BODY = {
  schema_version: "1.0.0" as const,
  root: ROOT.href,
  artifacts: [{
    relative_path: "HANDOFF.md",
    sha256: "8".repeat(64),
    byte_length: 12,
    git_revision: HEAD,
    detected_roles: ["handoff"] as const,
    sensitivity_findings: [],
  }],
};
const LEGACY_SCAN = {
  ...LEGACY_SCAN_BODY,
  scan_hash: sha256(canonicalJson(LEGACY_SCAN_BODY)),
};
const LEGACY_PROPOSAL_BODY = {
  schema_version: "1.0.0" as const,
  root_id: ROOT_ID,
  status: "review_required" as const,
  scan_hash: LEGACY_SCAN.scan_hash,
  mappings: [{
    source_path: "HANDOFF.md",
    source_sha256: "8".repeat(64),
    classification: "historical_status" as const,
    destination_kind: "view_candidate" as const,
    destination_path: null,
    accepted: false as const,
    rationale: "Review historical handoff evidence.",
  }],
};
const LEGACY_PENDING = {
  root_id: ROOT_ID,
  scan: LEGACY_SCAN,
  proposal: {
    ...LEGACY_PROPOSAL_BODY,
    proposal_hash: sha256(canonicalJson(LEGACY_PROPOSAL_BODY)),
  },
};
const LEGACY_DIRECTIVE: AgentStartDirective = {
  kind: "legacy_import_review_required",
  root_id: ROOT_ID,
  profile_lock_hash: "7".repeat(64),
  expected_head: HEAD,
  proposal: LEGACY_PENDING.proposal,
  pending: LEGACY_PENDING,
  warnings: [],
};
const BOOTSTRAP_DIRECTIVE: AgentStartDirective = {
  kind: "bootstrap_review_required",
  proposal: { confirmation_required: true, plan: PLAN },
  clarification: null,
  legacy_import_proposal: null,
  apply_command: ["init", "apply"],
};
const UPGRADE_PATHS = [
  "PROJECT_CONTEXT.md",
  "docs/project-memory/governance/migrations/repository-contract-1.0.0-to-1.1.0.json",
  "tools/project-memory/config.json",
] as const;
const UPGRADE_BODY: Omit<RepositoryUpgradePlan, "plan_hash"> = {
  schema_version: "1.0.0",
  plan_id: `repository-upgrade:${ROOT_ID}:aaaaaaaaaaaa`,
  mutation_kind: "migration",
  root_id: ROOT_ID,
  target_ref: "refs/heads/main",
  expected_head: HEAD,
  profile_lock_hash: "7".repeat(64),
  writes: UPGRADE_PATHS.map((relativePath, index) => ({
    relative_path: relativePath,
    bytes: new TextEncoder().encode(`upgrade-${String(index)}\n`),
    expected_existing_sha256: index === 1 ? null : "8".repeat(64),
    mode: index === 1 ? "create" as const : "replace" as const,
  })),
  record_ids: [], event_ids: [], approval_ids: [], evidence_ids: [],
  created_by: "project-memory-upgrader",
  created_at: CREATED_AT,
  expires_at: EXPIRES_AT,
  metadata: {
    governance_kind: "repository_upgrade",
    migration_id: "project-memory-v1-1",
    from_version: "1.0.0",
    to_version: "1.1.0",
    authority_impact: "none",
    canonical_source_set_hash: "9".repeat(64),
    canonical_source_path_count: 27,
    catalog_lock_hash: "a".repeat(64),
    config_input_sha256: "b".repeat(64),
    config_output_sha256: "c".repeat(64),
    doorway_input_sha256: "d".repeat(64),
    doorway_output_sha256: "e".repeat(64),
    changed_paths: UPGRADE_PATHS,
    derived_paths: [...GENERATED_VIEW_PATHS],
    migration_record_path: UPGRADE_PATHS[1],
    steps: [],
  },
};
const UPGRADE_PLAN: RepositoryUpgradePlan = {
  ...UPGRADE_BODY,
  plan_hash: canonicalMutationPlanHash(UPGRADE_BODY),
};
const UPGRADE_DIRECTIVE: AgentStartDirective = {
  kind: "upgrade_review_required",
  proposal: { confirmation_required: true, plan: UPGRADE_PLAN },
  warnings: [],
};
const RESUME_DIRECTIVE: AgentStartDirective = {
  kind: "resume",
  root_id: ROOT_ID,
  profile_lock_hash: UPGRADE_PLAN.profile_lock_hash,
  reading_order: [...AGENT_READING_ORDER_PREFIX],
  assigned_task_packets: [],
  warnings: [],
};

function harness(
  startDirective: AgentStartDirective = BOOTSTRAP_DIRECTIVE,
  applyResult = success({ status: "initialized_verified" } as never),
) {
  const dependencies: ProjectMemoryHostDependencies = {
    start: vi.fn(() => Promise.resolve(success(startDirective))),
    applyUpgrade: vi.fn(() => Promise.resolve(success({
      status: "mutation_integrated" as const,
      plan_id: UPGRADE_PLAN.plan_id,
      plan_hash: UPGRADE_PLAN.plan_hash,
      previous_revision: HEAD,
      commit_revision: "f".repeat(40),
      integrated_at: CREATED_AT,
      audit_evidence_id: "EVIDENCE-UPGRADE-0001",
      derived_view_hashes: {},
      audit_artifact_hashes: {},
    }))),
    applyBootstrap: vi.fn(() => Promise.resolve(applyResult)),
  };
  const proposals = new InMemoryProposalStore({
    now: () => new Date("2026-07-17T12:30:00.000Z"),
    handle: () => "pm-proposal-00000000000000000000000000000001",
  });
  return { host: new ProjectMemoryHost(dependencies, proposals), dependencies };
}

describe("ProjectMemoryHost", () => {
  it("returns a compact legacy review handle without scan or proposal internals", async () => {
    const { host } = harness(LEGACY_DIRECTIVE);
    const result = await host.start({
      root: ROOT,
      brief_path: null,
      adapter_id: "adapter.codex",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: "legacy_import_review_required",
        review_handle: "pm-proposal-00000000000000000000000000000001",
        confirmation_required: false,
        root_id: ROOT_ID,
        expected_head: HEAD,
        sources: [{
          source_path: "HANDOFF.md",
          source_sha256: "8".repeat(64),
          detected_roles: ["handoff"],
          source_git_revision: HEAD,
          sensitivity_finding_count: 0,
        }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("mappings");
    expect(JSON.stringify(result)).not.toContain("scan_hash");
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(65_536);
  });

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

  it("issues a compact upgrade and returns verified resume after one confirmation", async () => {
    const { host, dependencies } = harness(UPGRADE_DIRECTIVE);
    const started = await host.start({
      root: ROOT, brief_path: null, adapter_id: "adapter.codex",
    });
    expect(started).toMatchObject({
      ok: true,
      value: {
        kind: "upgrade_review_required",
        confirmation_required: true,
        summary: {
          operation: "upgrade",
          from_version: "1.0.0",
          to_version: "1.1.0",
          plan_hash: UPGRADE_PLAN.plan_hash,
          preserves_existing_canonical_history: true,
        },
      },
    });
    if (!started.ok || started.value.kind !== "upgrade_review_required") return;
    vi.mocked(dependencies.start).mockResolvedValueOnce(success(RESUME_DIRECTIVE));
    const applied = await host.applyUpgrade({
      proposal_handle: started.value.proposal_handle,
      approval: { confirmed: true },
    });
    expect(applied).toMatchObject({
      ok: true,
      value: {
        status: "upgraded_verified",
        receipt: { status: "mutation_integrated" },
        repository_contract_version: "1.1.0",
        root_id: ROOT_ID,
        reading_order: AGENT_READING_ORDER_PREFIX,
      },
    });
    expect(dependencies.applyUpgrade).toHaveBeenCalledWith(ROOT, UPGRADE_PLAN);
    expect(await host.applyUpgrade({
      proposal_handle: started.value.proposal_handle,
      approval: { confirmed: true },
    })).toMatchObject({
      ok: false, issues: [{ code: "HOST_PROPOSAL_NOT_FOUND" }],
    });
  });

  it("preserves an existing legacy review after the upgrade verifies", async () => {
    const { host, dependencies } = harness(UPGRADE_DIRECTIVE);
    const started = await host.start({
      root: ROOT,
      brief_path: null,
      adapter_id: "adapter.codex",
    });
    if (!started.ok || started.value.kind !== "upgrade_review_required") return;
    vi.mocked(dependencies.start).mockResolvedValueOnce(success(LEGACY_DIRECTIVE));

    expect(await host.applyUpgrade({
      proposal_handle: started.value.proposal_handle,
      approval: { confirmed: true },
    })).toMatchObject({
      ok: true,
      value: {
        status: "upgraded_verified",
        root_id: ROOT_ID,
        reading_order: AGENT_READING_ORDER_PREFIX,
        post_upgrade_state: "legacy_import_review_required",
      },
    });
  });

  it("retains an upgrade proposal after denial or coordinator failure", async () => {
    const { host, dependencies } = harness(UPGRADE_DIRECTIVE);
    const started = await host.start({ root: ROOT, brief_path: null, adapter_id: "adapter.codex" });
    if (!started.ok || started.value.kind !== "upgrade_review_required") return;
    const denied = {
      proposal_handle: started.value.proposal_handle,
      approval: { confirmed: false },
    };
    expect(await host.applyUpgrade(denied)).toMatchObject({
      ok: false, issues: [{ code: "HOST_APPROVAL_REQUIRED" }],
    });
    vi.mocked(dependencies.applyUpgrade).mockResolvedValue(failure(
      "UPGRADE_PLAN_CHANGED", "repository changed",
    ));
    const approved = { ...denied, approval: { confirmed: true } };
    expect(await host.applyUpgrade(approved)).toMatchObject({
      ok: false, issues: [{ code: "UPGRADE_PLAN_CHANGED" }],
    });
    expect(await host.applyUpgrade(approved)).toMatchObject({
      ok: false, issues: [{ code: "UPGRADE_PLAN_CHANGED" }],
    });
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
