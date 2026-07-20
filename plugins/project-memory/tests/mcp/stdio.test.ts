import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");
let temporaryRoot = "";
let entrypoint = "";

beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "project-memory-mcp-stdio-"));
  entrypoint = path.join(temporaryRoot, "project-memory-mcp.mjs");
  await build({
    entryPoints: [path.join(PACKAGE_ROOT, "src", "mcp.ts")],
    outfile: entrypoint,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: {
      js: 'import { createRequire as __projectMemoryCreateRequire } from "node:module"; const require = __projectMemoryCreateRequire(import.meta.url);',
    },
    legalComments: "none",
    logLevel: "silent",
  });
}, 30_000);

afterAll(async () => {
  if (temporaryRoot.length > 0) {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

function runProtocol(lines: readonly unknown[]): Promise<{
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint], {
      cwd: PACKAGE_ROOT,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HTTP_PROXY: "http://127.0.0.1:1",
        HTTPS_PROXY: "http://127.0.0.1:1",
        ALL_PROXY: "http://127.0.0.1:1",
        NO_PROXY: "",
        PROJECT_MEMORY_NETWORK: "disabled",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("MCP stdio process did not exit"));
    }, 20_000);
    child.once("exit", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr });
    });
    child.stdin.end(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  });
}

describe("Project Memory MCP stdio entrypoint", () => {
  it("serves initialize, tool discovery, and ping offline, then exits cleanly", async () => {
    const execution = await runProtocol([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 3, method: "ping", params: {} },
    ]);

    expect(execution.exitCode, execution.stderr).toBe(0);
    expect(execution.signal).toBeNull();
    expect(execution.stderr).toBe("");
    const responses = execution.stdout
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as {
        readonly id: number;
        readonly result: Record<string, unknown>;
      });
    expect(responses).toHaveLength(3);
    expect(responses[0]).toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "Project Memory", version: "0.1.1" },
      },
    });
    expect(responses[1]).toMatchObject({
      id: 2,
      result: {
        tools: [
          { name: "project_memory_start" },
          { name: "project_memory_read" },
          { name: "project_memory_apply" },
        ],
      },
    });
    expect(responses[2]).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
  }, 30_000);

  it("rejects malformed guided-history requests with JSON-RPC -32602", async () => {
    const execution = await runProtocol([{
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "project_memory_read",
        arguments: {
          mode: "legacy_import",
          review_handle: "pm-proposal-00000000000000000000000000000001",
          created_by: "codex",
          sources: [{ unsupported: true }],
        },
      },
    }]);
    expect(execution.exitCode, execution.stderr).toBe(0);
    expect(execution.stderr).toBe("");
    const response = JSON.parse(execution.stdout.trim()) as {
      readonly id: number;
      readonly error: { readonly code: number };
    };
    expect(response).toMatchObject({ id: 4, error: { code: -32602 } });
  }, 30_000);
});
