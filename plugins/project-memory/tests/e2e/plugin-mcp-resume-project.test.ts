import { access } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  callMcpTool,
  cleanupPluginWorkflow,
  preparePluginWorkflow,
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

describe("clean Plugin MCP resume across processes", () => {
  it("recovers accepted context from the repository without prior process memory", async () => {
    const workflow = await preparePluginWorkflow("new");
    workflows.push(workflow);

    const bootstrapSession = await startPluginMcp(workflow);
    sessions.push(bootstrapSession);
    const bootstrapInitialized = await bootstrapSession.request("initialize", {
      protocolVersion: "2025-06-18",
    });
    expect(bootstrapInitialized.error).toBeUndefined();
    const started = await callMcpTool(bootstrapSession, "project_memory_start", {
      root: workflow.project_url.href,
      brief_path: "BRIEF.md",
    });
    const directive = started.structuredContent as {
      readonly proposal_handle: string;
      readonly summary: {
        readonly root_id: string;
        readonly profile_lock_hash: string;
      };
    };
    const applied = await callMcpTool(bootstrapSession, "project_memory_apply", {
      mode: "bootstrap",
      proposal_handle: directive.proposal_handle,
      approval: { confirmed: true, granted_by: "Pitaji" },
    });
    expect(applied.isError).toBeUndefined();
    expect(applied.structuredContent).toMatchObject({ status: "initialized_verified" });
    const firstProcess = bootstrapSession.process_id;
    await closeSession(bootstrapSession);

    const resumeSession = await startPluginMcp(workflow);
    sessions.push(resumeSession);
    expect(resumeSession.process_id).not.toBe(firstProcess);
    const resumeInitialized = await resumeSession.request("initialize", {
      protocolVersion: "2025-06-18",
    });
    expect(resumeInitialized.error).toBeUndefined();
    const resumed = await callMcpTool(resumeSession, "project_memory_start", {
      root: workflow.project_url.href,
    });
    expect(resumed.isError).toBeUndefined();
    expect(resumed.structuredContent).toMatchObject({
      kind: "resume",
      root_id: directive.summary.root_id,
      profile_lock_hash: directive.summary.profile_lock_hash,
      reading_order: READING_ORDER,
      assigned_task_packets: [],
    });
    for (const relativePath of READING_ORDER) {
      await expect(access(path.join(
        workflow.project_root,
        ...relativePath.split("/"),
      ))).resolves.toBeUndefined();
    }

    await closeSession(resumeSession);
  }, 120_000);
});
