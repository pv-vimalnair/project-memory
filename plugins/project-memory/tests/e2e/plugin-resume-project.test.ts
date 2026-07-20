import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { CanonicalMutationPlan } from "../../src/contracts/canonical-mutation-plan.js";
import { executeCli } from "../../src/cli/main.js";
import type { MutationReceipt } from "../../src/governance/integration/canonical-mutation-finalizer.js";
import { taskDocumentPath, workstreamDocumentPath } from "../../src/governance/work/work-lifecycle-service.js";
import type { TaskPacket } from "../../src/planning/types.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/registry.js";
import { makeValidTaskPacket } from "../fixtures/selection/runtime-packet-fixtures.js";
import {
  bootstrapPluginWorkflow,
  cleanupPluginWorkflow,
  preparePluginWorkflow,
  runGit,
  runLauncher,
  type LauncherResult,
  type PluginWorkflow,
} from "./plugin-workflow-harness.js";
import {
  TRUSTED_NODE_HOST_ADAPTER_MARKER,
  createTrustedNodeHostRegistry,
} from "./trusted-node-host-adapter.js";

const WORKSTREAM_ID = "WS-01J00000000000000000000001";
const TASK_ID = "TASK-01J00000000000000000000001";
const INTEGRATOR = "project-memory-integrator";
const workflows: PluginWorkflow[] = [];

beforeAll(() => {
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});
afterEach(async () => {
  await Promise.all(workflows.splice(0).map(cleanupPluginWorkflow));
});

type WorkflowRunner = (arguments_: readonly string[]) => Promise<LauncherResult>;

function trustedHostRunner(workflow: PluginWorkflow): WorkflowRunner {
  const registry = createTrustedNodeHostRegistry(workflow.project_url);
  return async (arguments_) => {
    const execution = await executeCli(arguments_, {
      registry,
      current_directory: workflow.project_url,
    });
    return {
      status: execution.exit_code,
      stdout: execution.stdout,
      stderr: execution.stderr,
      envelope: execution.envelope as unknown as Readonly<Record<string, unknown>>,
    };
  };
}

async function planAndApply(
  workflow: PluginWorkflow,
  sequence: number,
  command: readonly string[],
  input: unknown,
  run: WorkflowRunner,
): Promise<{ readonly plan: CanonicalMutationPlan<unknown>; readonly receipt: MutationReceipt }> {
  const relativeInput = `.tmp/project-memory/work-${String(sequence)}.json`;
  await writeFile(
    path.join(workflow.project_root, ...relativeInput.split("/")),
    `${JSON.stringify(input)}\n`,
    "utf8",
  );
  const planned = await run([
    ...command, "plan", "--input", relativeInput, "--json",
  ]);
  expect(planned.status, planned.stderr || planned.stdout).toBe(0);
  const plan = planned.envelope?.data as CanonicalMutationPlan<unknown>;
  expect(plan.plan_hash).toMatch(/^[0-9a-f]{64}$/);
  const applied = await run([
    ...command,
    "apply",
    "--input",
    relativeInput,
    "--expected-plan-hash",
    plan.plan_hash,
    "--expected-head",
    plan.expected_head,
    "--json",
  ]);
  expect(applied.status, applied.stderr || applied.stdout).toBe(0);
  return { plan, receipt: applied.envelope?.data as MutationReceipt };
}

function taskPacket(input: {
  readonly root_id: string;
  readonly profile_lock_hash: string;
  readonly catalog_release: string;
  readonly catalog_hash: string;
  readonly head: string;
  readonly issued_at: string;
}): TaskPacket {
  const packet = makeValidTaskPacket();
  return {
    ...packet,
    root: {
      id: input.root_id,
      profile_lock_hash: input.profile_lock_hash,
      catalog_release: input.catalog_release,
      catalog_hash: input.catalog_hash,
    },
    workstream_id: WORKSTREAM_ID,
    task_id: TASK_ID,
    assignment: {
      ...packet.assignment,
      issued_by: INTEGRATOR,
      issued_at: input.issued_at,
    },
    selector: { ...packet.selector, evidence_ids: [] },
    resolved_inputs: {
      record_ids: [],
      artifact_refs: [],
      original_base_revision: input.head,
    },
    component_duties: [],
    domain_duties: [],
    claim: {
      ...packet.claim,
      issuer: INTEGRATOR,
      base_revision: input.head,
      issued_at: input.issued_at,
      expires_at: new Date(Date.parse(input.issued_at) + 15 * 60_000).toISOString(),
      last_heartbeat_at: input.issued_at,
      components: [],
      repositories: ["local-project"],
      paths: [],
      duties: [],
      required_evidence: [],
    },
    decisions: { accepted_record_ids: [], proposed_record_ids: [] },
    approvals: [],
    gates: [],
    memory_updates: { ...packet.memory_updates, update_record_ids: [] },
  };
}

describe("automatic Plugin workflow for an initialized project", () => {
  it("keeps one root while coordinator-integrating one workstream and one task", async () => {
    const workflow = await preparePluginWorkflow("new");
    workflows.push(workflow);
    const bootstrap = await bootstrapPluginWorkflow(workflow);
    const initialResume = runLauncher(workflow, ["agent", "start", "--root", ".", "--json"]);
    expect(
      initialResume.envelope,
      JSON.stringify(initialResume.envelope, null, 2),
    ).toMatchObject({
      status: "success",
      data: { kind: "resume", root_id: bootstrap.target_root_id },
    });
    const projectPath = path.join(workflow.project_root, "docs", "project-memory", "project.yaml");
    const contextPath = path.join(workflow.project_root, "PROJECT_CONTEXT.md");
    const projectBefore = await readFile(projectPath, "utf8");
    const contextBefore = await readFile(contextPath, "utf8");
    const createdAt = new Date().toISOString();
    const bundle = await readFile(
      path.join(workflow.plugin_root, "dist", "project-memory.mjs"),
      "utf8",
    );
    expect(bundle).not.toContain("createTrustedNodeHostRegistry");
    expect(bundle).not.toContain(TRUSTED_NODE_HOST_ADAPTER_MARKER);

    const deniedInput = ".tmp/project-memory/default-denied.json";
    const workstreamInput = {
      root: workflow.project_url.href,
      created_at: createdAt,
      workstream_id: WORKSTREAM_ID,
      initiative_id: null,
      title: "Add daily lesson tracking",
      objective: "Deliver one bounded improvement inside the established product root.",
      owners: [INTEGRATOR],
      dependencies: [],
    };
    await writeFile(
      path.join(workflow.project_root, ...deniedInput.split("/")),
      `${JSON.stringify(workstreamInput)}\n`,
      "utf8",
    );
    const denied = runLauncher(workflow, [
      "workstream", "create", "plan", "--input", deniedInput, "--json",
    ]);
    expect(denied.status, denied.stderr || denied.stdout).not.toBe(0);
    expect(denied.envelope).toMatchObject({
      status: "failed",
      issues: [{ code: "runtime.trusted_integrator_required" }],
    });

    const importInput = ".tmp/project-memory/import-denied.json";
    const head = runGit(workflow.project_root, ["rev-parse", "HEAD"]);
    const importNow = new Date();
    await writeFile(
      path.join(workflow.project_root, ...importInput.split("/")),
      `${JSON.stringify({
        root_id: bootstrap.target_root_id,
        target_ref: "refs/heads/main",
        expected_head: head,
        profile_lock_hash: bootstrap.profile_compilation.profile_lock_hash,
        proposal_hash: "b".repeat(64),
        created_by: INTEGRATOR,
        created_at: importNow.toISOString(),
        expires_at: new Date(importNow.getTime() + 5 * 60_000).toISOString(),
        approval_ids: [],
        candidates: [],
      })}\n`,
      "utf8",
    );
    const importPlanResult = runLauncher(workflow, [
      "import", "plan", "--input", importInput, "--json",
    ]);
    expect(importPlanResult.status, importPlanResult.stderr || importPlanResult.stdout).toBe(0);
    const importPlan = importPlanResult.envelope?.data as CanonicalMutationPlan<unknown>;
    const importDenied = runLauncher(workflow, [
      "import", "apply", "--input", importInput,
      "--expected-plan-hash", importPlan.plan_hash,
      "--expected-head", importPlan.expected_head,
      "--json",
    ]);
    expect(importDenied.status, importDenied.stderr || importDenied.stdout).not.toBe(0);
    expect(importDenied.envelope).toMatchObject({
      status: "failed",
      issues: [{ code: "runtime.trusted_integrator_required" }],
    });

    const runTrusted = trustedHostRunner(workflow);
    const created = await planAndApply(workflow, 1, ["workstream", "create"], {
      root: workflow.project_url.href,
      created_at: createdAt,
      workstream_id: WORKSTREAM_ID,
      initiative_id: null,
      title: "Add daily lesson tracking",
      objective: "Deliver one bounded improvement inside the established product root.",
      owners: [INTEGRATOR],
      dependencies: [],
    }, runTrusted);
    const activated = await planAndApply(workflow, 2, ["workstream", "transition"], {
      root: workflow.project_url.href,
      created_at: createdAt,
      artifact_type: "workstream",
      artifact_id: WORKSTREAM_ID,
      workstream_id: null,
      expected_status: "planned",
      next_status: "active",
      approval_ids: [],
      evidence_ids: [],
    }, runTrusted);
    const taskHead = runGit(workflow.project_root, ["rev-parse", "HEAD"]);
    const taskCreated = await planAndApply(workflow, 3, ["task", "create"], {
      root: workflow.project_url.href,
      created_at: createdAt,
      packet: taskPacket({
        root_id: bootstrap.target_root_id,
        profile_lock_hash: bootstrap.profile_compilation.profile_lock_hash,
        catalog_release: bootstrap.proposed_project_selection.catalog.release,
        catalog_hash: bootstrap.proposed_project_selection.catalog.catalog_hash,
        head: taskHead,
        issued_at: createdAt,
      }),
    }, runTrusted);

    for (const result of [created, activated, taskCreated]) {
      expect(result.plan.root_id).toBe(bootstrap.target_root_id);
      expect(result.plan.mutation_kind).toBe("work_lifecycle");
      expect(result.receipt).toMatchObject({
        status: "mutation_integrated",
        plan_hash: result.plan.plan_hash,
      });
    }
    expect(await readFile(projectPath, "utf8")).toBe(projectBefore);
    expect(await readFile(contextPath, "utf8")).toBe(contextBefore);
    expect((await readdir(path.join(workflow.project_root, "docs", "project-memory")))
      .filter((name) => name === "project.yaml")).toEqual(["project.yaml"]);
    expect(await readFile(
      path.join(workflow.project_root, ...workstreamDocumentPath(WORKSTREAM_ID).split("/")),
      "utf8",
    )).toContain(`root_id: ${bootstrap.target_root_id}`);
    const taskPath = taskDocumentPath(WORKSTREAM_ID, TASK_ID);
    expect(await readFile(path.join(workflow.project_root, ...taskPath.split("/")), "utf8"))
      .toContain("Status: issued");
    const mutationAudits = await readdir(path.join(
      workflow.project_root,
      "docs", "project-memory", "governance", "integration", "mutations",
    ));
    expect(mutationAudits).toHaveLength(3);
    expect(runGit(workflow.project_root, ["rev-list", "--count", "HEAD"])).toBe("5");

    const resumed = runLauncher(workflow, ["agent", "start", "--root", ".", "--json"]);
    expect(resumed.status, resumed.stderr || resumed.stdout).toBe(0);
    expect(resumed.envelope, JSON.stringify(resumed.envelope, null, 2)).toMatchObject({
      status: "success",
      data: {
        kind: "resume",
        root_id: bootstrap.target_root_id,
        assigned_task_packets: [taskPath],
      },
    });
    const resumedData = resumed.envelope?.data as {
      readonly reading_order: readonly string[];
    };
    expect(resumedData.reading_order).toContain(taskPath);
  }, 180_000);
});
