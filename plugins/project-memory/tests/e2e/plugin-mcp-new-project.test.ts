import { Buffer } from "node:buffer";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  callMcpTool,
  cleanupPluginWorkflow,
  preparePluginWorkflow,
  projectSnapshot,
  runGit,
  startPluginMcp,
  type McpSession,
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
const sessions: McpSession[] = [];

async function closeSession(session: McpSession): Promise<void> {
  const index = sessions.indexOf(session);
  if (index >= 0) sessions.splice(index, 1);
  const exited = await session.close();
  expect(exited.status, exited.stderr).toBe(0);
  expect(exited.signal).toBeNull();
  expect(exited.stderr).toBe("");
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map(async (session) => session.close()));
  await Promise.all(workflows.splice(0).map(cleanupPluginWorkflow));
}, 60_000);

describe("clean Plugin MCP workflow for a new project", () => {
  it("keeps startup compact and read-only, applies one confirmation, then resumes", async () => {
    const workflow = await preparePluginWorkflow("new");
    workflows.push(workflow);
    await rm(path.join(workflow.project_root, "BRIEF.md"));
    await Promise.all([
      writeFile(path.join(workflow.project_root, "AGENTS.md"), [
        "## Master: Pv Vimal Nair (Pitaji)",
        "",
        "- His mission: **Pocket Practice** \u2014 a daily learning habit app",
        "- His stack: Flutter, Firebase, Figma",
        "",
      ].join("\n"), "utf8"),
      writeFile(path.join(workflow.project_root, "pubspec.yaml"), [
        "name: pocket_practice",
        "description: A new Flutter project.",
        "dependencies:",
        "  flutter:",
        "    sdk: flutter",
        "  firebase_core: ^4.6.0",
        "",
      ].join("\n"), "utf8"),
      writeFile(path.join(workflow.project_root, "firebase.json"), "{}\n", "utf8"),
      mkdir(path.join(workflow.project_root, "android")),
      mkdir(path.join(workflow.project_root, "ios")),
    ]);
    runGit(workflow.project_root, ["add", "--all", "--", "."]);
    runGit(workflow.project_root, ["commit", "--quiet", "-m", "test: repository inferred bootstrap"]);
    runGit(workflow.project_root, ["switch", "-c", "version-5.6"]);
    const before = await projectSnapshot(workflow.project_root);
    let session = await startPluginMcp(workflow);
    sessions.push(session);
    const initialized = await session.request("initialize", {
      protocolVersion: "2025-06-18",
    });
    expect(initialized.error).toBeUndefined();
    expect(initialized.result).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "Project Memory", version: "0.1.0" },
    });

    const started = await callMcpTool(session, "project_memory_start", {
      root: workflow.project_url.href,
    });
    const serialized = JSON.stringify(started);
    expect(started.isError).toBeUndefined();
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(65_536);
    expect(serialized).not.toContain("profile_compilation");
    expect(started.structuredContent).toMatchObject({
      kind: "bootstrap_review_required",
      confirmation_required: true,
      summary: {
        operation: "bootstrap",
        repository: workflow.project_url.href,
        selected_blueprint: "application.consumer-mobile",
      },
    });
    expect(await projectSnapshot(workflow.project_root)).toEqual(before);

    const directive = started.structuredContent as {
      readonly proposal_handle: string;
    };
    expect(directive.proposal_handle).toMatch(/^pm-proposal-[0-9a-f]{32}$/);
    const proposalProcess = session.process_id;
    await closeSession(session);
    session = await startPluginMcp(workflow);
    sessions.push(session);
    expect(session.process_id).not.toBe(proposalProcess);
    const applyInitialized = await session.request("initialize", {
      protocolVersion: "2025-06-18",
    });
    expect(applyInitialized.error).toBeUndefined();

    const applied = await callMcpTool(session, "project_memory_apply", {
      mode: "bootstrap",
      proposal_handle: directive.proposal_handle,
      approval: { confirmed: true, granted_by: "Pitaji" },
    });
    expect(applied.isError, JSON.stringify(applied)).toBeUndefined();
    expect(applied.structuredContent).toMatchObject({
      status: "initialized_verified",
      target_ref: "refs/heads/version-5.6",
    });

    for (const relativePath of READING_ORDER) {
      await expect(access(path.join(
        workflow.project_root,
        ...relativePath.split("/"),
      ))).resolves.toBeUndefined();
    }
    const resumed = await callMcpTool(session, "project_memory_start", {
      root: workflow.project_url.href,
    });
    expect(resumed.isError).toBeUndefined();
    expect(resumed.structuredContent).toMatchObject({
      kind: "resume",
      reading_order: READING_ORDER,
      assigned_task_packets: [],
    });

    await closeSession(session);
  }, 120_000);
});
