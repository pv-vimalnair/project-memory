import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../../src/cli/command-registry.js";
import { executeCli } from "../../src/cli/main.js";
import { success } from "../../src/contracts/runtime-result.js";
import {
  ProjectMemoryMcpServer,
  routeMcpMessage,
  type McpToolResult,
  type ProjectMemoryMcpServerDependencies,
} from "../../src/mcp/server.js";

const ROOT = new URL("file:///C:/project/");
const PROPOSAL_HANDLE = "pm-proposal-00000000000000000000000000000001";
const REVIEW_HANDLE = "pm-proposal-00000000000000000000000000000002";
const IMPORT_HANDLE = "pm-proposal-00000000000000000000000000000003";
const SOURCE_REVIEW = {
  source_path: "HANDOFF.md",
  source_sha256: "4".repeat(64),
  source_git_revision: "2".repeat(40),
  disposition: "import",
  rationale: "Keep the completed work.",
  facts: [{
    source_line_start: 1,
    source_line_end: 1,
    category: "completed_work",
    title: "Launch completed",
    statement: "Launch work is complete.",
    rationale: "The handoff records completion.",
    confidence: "high",
  }],
} as const;

function command(
  path: readonly string[],
  mutates: boolean,
  value: unknown,
) {
  return {
    path,
    mutates,
    run: vi.fn(() => Promise.resolve(success(value))),
  };
}

function harness(overrides: {
  readonly readValue?: unknown;
  readonly resolveProposal?: ProjectMemoryMcpServerDependencies["resolveProposal"];
} = {}) {
  const readCommand = command(["doctor"], false, overrides.readValue ?? { valid: true });
  const writeCommand = command(["init", "apply"], true, { status: "initialized_verified" });
  const developerCommand = command(["benchmark", "run"], false, { accepted: true });
  const registry = new CommandRegistry([readCommand, writeCommand, developerCommand]);
  const host = {
    start: vi.fn(() => Promise.resolve(success({
      kind: "bootstrap_review_required",
      proposal_handle: PROPOSAL_HANDLE,
      confirmation_required: true,
      expires_at: "2026-07-17T13:00:00.000Z",
      summary: { plan_hash: "1".repeat(64), expected_head: "2".repeat(40) },
      clarification: null,
      legacy_import_proposal: null,
    } as never))),
    applyBootstrap: vi.fn(() => Promise.resolve(success({
      status: "initialized_verified",
    } as never))),
    planLegacyImport: vi.fn(() => Promise.resolve(success({
      operation: "legacy_import",
      proposal_handle: IMPORT_HANDLE,
      confirmation_required: true,
      plan_hash: "5".repeat(64),
      expected_head: "2".repeat(40),
      expires_at: "2026-07-17T13:00:00.000Z",
      groups: [],
    } as never))),
    applyLegacyImport: vi.fn(() => Promise.resolve(success({
      status: "mutation_integrated",
      plan_hash: "5".repeat(64),
    } as never))),
  };
  const dependencies: ProjectMemoryMcpServerDependencies = {
    createHost: vi.fn(() => host),
    createRegistry: vi.fn(() => registry),
    execute: executeCli,
    ...(overrides.resolveProposal === undefined
      ? {}
      : { resolveProposal: overrides.resolveProposal }),
  };
  return {
    server: new ProjectMemoryMcpServer(dependencies),
    dependencies,
    host,
    readCommand,
    writeCommand,
    developerCommand,
  };
}

async function callTool(
  server: ProjectMemoryMcpServer,
  name: string,
  arguments_: unknown,
): Promise<McpToolResult> {
  return await server.request("tools/call", {
    name,
    arguments: arguments_,
  }) as McpToolResult;
}

function expectMatchingContent(result: McpToolResult): void {
  expect(result.content).toHaveLength(1);
  expect(result.content[0]).toMatchObject({ type: "text" });
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  expect(JSON.parse(text)).toEqual(result.structuredContent);
}

describe("ProjectMemoryMcpServer", () => {
  it("initializes with the requested protocol version and offline instructions", async () => {
    const { server } = harness();

    expect(await server.request("initialize", { protocolVersion: "2025-06-18" }))
      .toEqual({
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "Project Memory", version: "0.1.0" },
        instructions: "Use project_memory_start before substantive repository work. Project Memory is repository-first, offline, and coordinator-governed. Never ask the user to select a profile.",
      });
  });

  it("advertises exactly the three Project Memory tools", async () => {
    const { server } = harness();
    const result = await server.request("tools/list", {}) as {
      readonly tools: readonly {
        readonly name: string;
        readonly annotations: { readonly readOnlyHint: boolean };
      }[];
    };

    expect(result.tools.map((tool) => ({
      name: tool.name,
      annotations: { readOnlyHint: tool.annotations.readOnlyHint },
    }))).toEqual([
      { name: "project_memory_start", annotations: { readOnlyHint: true } },
      { name: "project_memory_read", annotations: { readOnlyHint: true } },
      { name: "project_memory_apply", annotations: { readOnlyHint: false } },
    ]);
  });

  it("labels brief_path as repository initialization context, not task input", async () => {
    const { server } = harness();
    const result = await server.request("tools/list", {}) as {
      readonly tools: readonly {
        readonly name: string;
        readonly inputSchema: {
          readonly properties: {
            readonly brief_path?: { readonly description?: string };
          };
        };
      }[];
    };

    const start = result.tools.find((tool) => tool.name === "project_memory_start");
    expect(start?.inputSchema.properties.brief_path?.description).toBe(
      "Optional repository-relative path to a pre-existing structured initialization brief. Omit it to infer from repository evidence; never use a task dataset, prompt, schema, or output file.",
    );
  });

  it("routes startup to one compact host and remembers its proposal handle", async () => {
    const { server, dependencies, host } = harness();

    const started = await callTool(server, "project_memory_start", {
      root: ROOT.href,
      brief_path: "brief.md",
    });
    expect(started).toMatchObject({
      structuredContent: {
        kind: "bootstrap_review_required",
        proposal_handle: PROPOSAL_HANDLE,
      },
    });
    expectMatchingContent(started);
    expect(dependencies.createHost).toHaveBeenCalledTimes(1);

    const applied = await callTool(server, "project_memory_apply", {
      mode: "bootstrap",
      proposal_handle: PROPOSAL_HANDLE,
      approval: { confirmed: true, granted_by: "Pitaji" },
    });
    expect(applied).toMatchObject({
      structuredContent: { status: "initialized_verified" },
    });
    expect(host.applyBootstrap).toHaveBeenCalledWith({
      proposal_handle: PROPOSAL_HANDLE,
      approval: { confirmed: true, granted_by: "Pitaji" },
    });
  });

  it("recovers a reviewed proposal after the MCP process changes", async () => {
    const resolveProposal = vi.fn(() => Promise.resolve(success({
      kind: "bootstrap" as const,
      root: ROOT,
      plan: {} as never,
    })));
    const { server, dependencies, host } = harness({ resolveProposal });

    const applied = await callTool(server, "project_memory_apply", {
      mode: "bootstrap",
      proposal_handle: PROPOSAL_HANDLE,
      approval: { confirmed: true, granted_by: "Pitaji" },
    });

    expect(applied).toMatchObject({
      structuredContent: { status: "initialized_verified" },
    });
    expect(resolveProposal).toHaveBeenCalledWith(PROPOSAL_HANDLE);
    expect(dependencies.createHost).toHaveBeenCalledWith(ROOT);
    expect(host.applyBootstrap).toHaveBeenCalledWith({
      proposal_handle: PROPOSAL_HANDLE,
      approval: { confirmed: true, granted_by: "Pitaji" },
    });
  });

  it("routes one typed guided-history plan and apply through the existing tools", async () => {
    const { server, host } = harness();
    vi.mocked(host.start).mockResolvedValueOnce(success({
      kind: "legacy_import_review_required",
      review_handle: REVIEW_HANDLE,
      confirmation_required: false,
      expected_head: "2".repeat(40),
      sources: [{ source_path: "HANDOFF.md", source_sha256: "4".repeat(64) }],
    } as never));

    const started = await callTool(server, "project_memory_start", { root: ROOT.href });
    expect(started).toMatchObject({
      structuredContent: {
        kind: "legacy_import_review_required",
        review_handle: REVIEW_HANDLE,
      },
    });
    const planned = await callTool(server, "project_memory_read", {
      mode: "legacy_import",
      review_handle: REVIEW_HANDLE,
      created_by: "codex",
      sources: [SOURCE_REVIEW],
    });
    expect(planned).toMatchObject({
      structuredContent: {
        operation: "legacy_import",
        proposal_handle: IMPORT_HANDLE,
      },
    });
    expect(host.planLegacyImport).toHaveBeenCalledWith({
      review_handle: REVIEW_HANDLE,
      created_by: "codex",
      sources: [SOURCE_REVIEW],
    });
    const applied = await callTool(server, "project_memory_apply", {
      mode: "legacy_import",
      proposal_handle: IMPORT_HANDLE,
      approval: { confirmed: true, granted_by: "Pitaji" },
    });
    expect(applied).toMatchObject({
      structuredContent: { status: "mutation_integrated" },
    });
    expect(host.applyLegacyImport).toHaveBeenCalledWith({
      proposal_handle: IMPORT_HANDLE,
      approval: { confirmed: true, granted_by: "Pitaji" },
    });
    expect(Buffer.byteLength(JSON.stringify(planned), "utf8")).toBeLessThanOrEqual(65_536);
  });

  it("recovers guided review and apply handles across MCP processes", async () => {
    const resolveProposal = vi.fn((handle: string) => Promise.resolve(success(
      handle === REVIEW_HANDLE
        ? { kind: "legacy_review", root: ROOT }
        : { kind: "legacy_import", root: ROOT },
    ) as never));
    const planning = harness({ resolveProposal });
    expect(await callTool(planning.server, "project_memory_read", {
      mode: "legacy_import",
      review_handle: REVIEW_HANDLE,
      created_by: "codex",
      sources: [SOURCE_REVIEW],
    })).toMatchObject({ structuredContent: { proposal_handle: IMPORT_HANDLE } });

    const applying = harness({ resolveProposal });
    expect(await callTool(applying.server, "project_memory_apply", {
      mode: "legacy_import",
      proposal_handle: IMPORT_HANDLE,
      approval: { confirmed: true, granted_by: "Pitaji" },
    })).toMatchObject({ structuredContent: { status: "mutation_integrated" } });
    expect(resolveProposal).toHaveBeenCalledWith(REVIEW_HANDLE);
    expect(resolveProposal).toHaveBeenCalledWith(IMPORT_HANDLE);
  });
  it("accepts standard MCP metadata on tool calls", async () => {
    const { server, host } = harness();

    const started = await server.request("tools/call", {
      name: "project_memory_start",
      arguments: { root: ROOT.href },
      _meta: { "openai/trace_id": "synthetic-trace" },
    }) as McpToolResult;

    expect(started).toMatchObject({
      structuredContent: {
        kind: "bootstrap_review_required",
        proposal_handle: PROPOSAL_HANDLE,
      },
    });
    expect(host.start).toHaveBeenCalledTimes(1);
  });

  it("rejects a mutating command through project_memory_read", async () => {
    const { server, writeCommand } = harness();

    expect(await callTool(server, "project_memory_read", {
      root: ROOT.href,
      arguments: ["init", "apply", "--plan", "plan.json", "--approval", "approval.json"],
    })).toMatchObject({
      isError: true,
      structuredContent: { code: "MCP_OPERATION_CLASS_MISMATCH" },
    });
    expect(writeCommand.run).not.toHaveBeenCalled();
  });

  it("rejects a read-only command through project_memory_apply", async () => {
    const { server, readCommand } = harness();

    expect(await callTool(server, "project_memory_apply", {
      mode: "command",
      root: ROOT.href,
      arguments: ["doctor"],
    })).toMatchObject({
      isError: true,
      structuredContent: { code: "MCP_OPERATION_CLASS_MISMATCH" },
    });
    expect(readCommand.run).not.toHaveBeenCalled();
  });

  it("returns the in-process CLI envelope instead of rendered stdout", async () => {
    const { server, readCommand } = harness();

    const result = await callTool(server, "project_memory_read", {
      root: ROOT.href,
      arguments: ["doctor"],
    });

    expect(result).toMatchObject({
      structuredContent: {
        schema_version: "1.0.0",
        command: "doctor",
        status: "success",
        data: { valid: true },
      },
    });
    expectMatchingContent(result);
    expect(readCommand.run).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("project-memory doctor: success");
  });

  it("keeps benchmark and developer-only operations CLI-only", async () => {
    const { server, developerCommand } = harness();

    expect(await callTool(server, "project_memory_read", {
      root: ROOT.href,
      arguments: ["benchmark", "run", "--input", "briefs", "--output", "report.json"],
    })).toMatchObject({
      isError: true,
      structuredContent: { code: "MCP_COMMAND_NOT_EXPOSED" },
    });
    expect(developerCommand.run).not.toHaveBeenCalled();
  });

  it("preserves structured content when only its text duplication exceeds 64 KiB", async () => {
    const { server } = harness({ readValue: { text: "x".repeat(33_000) } });

    const result = await callTool(server, "project_memory_read", {
      root: ROOT.href,
      arguments: ["doctor"],
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      command: "doctor",
      status: "success",
      data: { text: "x".repeat(33_000) },
    });
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      code: "MCP_STRUCTURED_CONTENT_AVAILABLE",
      command: "doctor",
      status: "success",
    });
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(65_536);
  });

  it("fails closed when structured content itself exceeds 64 KiB", async () => {
    const { server } = harness({ readValue: { text: "x".repeat(70_000) } });

    const result = await callTool(server, "project_memory_read", {
      root: ROOT.href,
      arguments: ["doctor"],
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: { code: "MCP_RESPONSE_TOO_LARGE" },
    });
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(65_536);
    expect(JSON.stringify(result)).not.toContain("x".repeat(1_000));
  });
});

describe("routeMcpMessage", () => {
  it("returns standard JSON-RPC errors for unknown methods and invalid tool arguments", async () => {
    const { server } = harness();

    expect(await routeMcpMessage(server, {
      jsonrpc: "2.0",
      id: 1,
      method: "unknown/method",
      params: {},
    })).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601 },
    });

    expect(await routeMcpMessage(server, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "project_memory_start",
        arguments: { root: 42 },
      },
    })).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32602 },
    });
  });

  it("returns -32602 for malformed guided-history fields", async () => {
    const { server } = harness();
    expect(await routeMcpMessage(server, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "project_memory_read",
        arguments: {
          mode: "legacy_import",
          review_handle: REVIEW_HANDLE,
          created_by: "codex",
          sources: [{ ...SOURCE_REVIEW, unsupported: true }],
        },
      },
    })).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32602 },
    });
  });
  it("processes notifications without emitting a response", async () => {
    const { server } = harness();

    expect(await routeMcpMessage(server, {
      jsonrpc: "2.0",
      method: "ping",
      params: {},
    })).toBeNull();
  });
});
