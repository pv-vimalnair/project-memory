import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { InitPlan } from "../../src/cli/init/build-init-plan.js";
import type { CanonicalRecord } from "../../src/governance/contracts/index.js";
import { bootstrapApprovalBinding } from "../../src/governance/integration/bootstrap-plan.js";
import {
  cleanupPluginWorkflow,
  preparePluginWorkflow,
  projectSnapshot,
  runGit,
  runLauncher,
  type PluginWorkflow,
} from "./plugin-workflow-harness.js";

const READING_ORDER = [
  "PROJECT_CONTEXT.md",
  "docs/project-memory/PROTOCOL.md",
  "docs/project-memory/profile.lock.yaml",
  "docs/project-memory/views/NOW.md",
  "docs/project-memory/views/HANDOFF.md",
] as const;
const workflows: PluginWorkflow[] = [];

afterEach(async () => {
  await Promise.all(workflows.splice(0).map(cleanupPluginWorkflow));
});

function approval(root: URL, plan: InitPlan): CanonicalRecord {
  const compilation = plan.profile_compilation;
  return {
    id: plan.review_packet.approval_id,
    type: "approval",
    title: "Approve exact Project Memory bootstrap",
    status: "accepted",
    root_id: plan.target_root_id,
    component_ids: [],
    initiative_id: null,
    workstream_id: null,
    task_id: null,
    actor_id: "Pitaji",
    authority_class: "pitaji",
    created_at: compilation.created_at,
    original_base_revision: plan.expected_head,
    integration_base_revision: plan.expected_head,
    catalog_versions: [plan.proposed_project_selection.catalog.release],
    relationships: [],
    payload: {
      approval_kind: "directional",
      granted_by: "Pitaji",
      ...bootstrapApprovalBinding({
        root,
        target_ref: plan.target_ref,
        root_id: plan.target_root_id,
        profile_lock_hash: compilation.profile_lock_hash,
        source_proposal_hash: plan.source_proposal_hash,
        compilation_plan_hash: compilation.plan_hash,
        created_at: compilation.created_at,
        expires_at: compilation.expires_at,
      }),
      expires_at: compilation.expires_at,
      invalidation_conditions: ["Any bound bootstrap input changes."],
    },
  };
}

describe("automatic Plugin workflow for a new project", () => {
  it("reviews a natural brief, applies one exact bootstrap, then resumes in fixed order", async () => {
    const workflow = await preparePluginWorkflow("new");
    workflows.push(workflow);
    const before = await projectSnapshot(workflow.project_root);

    const started = runLauncher(workflow, [
      "agent", "start", "--root", ".", "--brief", "BRIEF.md", "--json",
    ]);

    expect(started.status, started.stderr || started.stdout).toBe(0);
    expect(started.envelope).toMatchObject({
      status: "review_required",
      data: {
        kind: "bootstrap_review_required",
        proposal: {
          confirmation_required: true,
          plan: {
            selection: {
              winner: { definition_id: "application.consumer-mobile" },
            },
          },
        },
      },
    });
    const data = started.envelope?.data as {
      readonly proposal: {
        readonly confirmation_required: true;
        readonly plan: InitPlan;
      };
      readonly apply_command: readonly string[];
    };
    const plan = data.proposal.plan;
    expect(plan.plan_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.source_proposal.facts).not.toHaveProperty("blueprint");
    expect(plan.source_proposal.facts).not.toHaveProperty("profile");
    expect(await projectSnapshot(workflow.project_root)).toEqual(before);

    const inputDirectory = path.join(workflow.project_root, ".tmp", "project-memory");
    await mkdir(inputDirectory, { recursive: true });
    const serializedPlan = `${JSON.stringify(plan)}\n`;
    await writeFile(path.join(inputDirectory, "init.plan.json"), serializedPlan, "utf8");
    await writeFile(
      path.join(inputDirectory, "init.approval.json"),
      `${JSON.stringify(approval(workflow.project_url, plan))}\n`,
      "utf8",
    );
    expect(JSON.parse(serializedPlan)).toEqual(plan);

    const applied = runLauncher(workflow, data.apply_command);
    expect(applied.status, applied.stderr || applied.stdout).toBe(0);
    expect(applied.envelope).toMatchObject({
      status: "success",
      data: {
        status: "initialized_verified",
        root_id: plan.target_root_id,
        compilation_plan_hash: plan.profile_compilation.plan_hash,
      },
    });
    for (const relativePath of READING_ORDER) {
      await expect(access(path.join(workflow.project_root, ...relativePath.split("/"))))
        .resolves.toBeUndefined();
    }
    const auditRoot = path.join(
      workflow.project_root,
      "docs", "project-memory", "governance", "integration", "bootstrap",
    );
    expect((await readdir(auditRoot)).some((name) => name.endsWith(".json"))).toBe(true);
    expect(runGit(workflow.project_root, ["rev-list", "--count", "HEAD"])).toBe("2");
    const finalHead = runGit(workflow.project_root, ["rev-parse", "HEAD"]);
    const viewIndex = JSON.parse(await readFile(
      path.join(workflow.project_root, "docs", "project-memory", "views", "INDEX.json"),
      "utf8",
    )) as { readonly metadata: { readonly source_revision: string } };
    expect(viewIndex.metadata.source_revision).toMatch(/^[0-9a-f]{40}$/);
    expect(viewIndex.metadata.source_revision).not.toBe(finalHead);

    const duplicate = runLauncher(workflow, data.apply_command);
    expect(duplicate.status).not.toBe(0);
    expect(runGit(workflow.project_root, ["rev-list", "--count", "HEAD"])).toBe("2");

    const resumed = runLauncher(workflow, [
      "agent", "start", "--root", ".", "--json",
    ]);
    expect(resumed.status, resumed.stderr || resumed.stdout).toBe(0);
    expect(resumed.envelope, JSON.stringify(resumed.envelope)).toMatchObject({
      status: "success",
      data: {
        kind: "resume",
        root_id: plan.target_root_id,
        profile_lock_hash: plan.profile_compilation.profile_lock_hash,
        reading_order: READING_ORDER,
        assigned_task_packets: [],
      },
    });
  }, 120_000);
});
