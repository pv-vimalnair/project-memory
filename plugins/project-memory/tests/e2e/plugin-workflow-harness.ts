import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expect } from "vitest";

import type { InitPlan } from "../../src/cli/init/build-init-plan.js";
import type { CanonicalRecord } from "../../src/governance/contracts/index.js";
import { bootstrapApprovalBinding } from "../../src/governance/integration/bootstrap-plan.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURE_ROOT = fileURLToPath(new URL("../fixtures/plugin-workflows/", import.meta.url));

export interface LauncherResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly envelope: Readonly<Record<string, unknown>> | null;
}

export interface PluginWorkflow {
  readonly sandbox: string;
  readonly plugin_root: string;
  readonly project_root: string;
  readonly project_url: URL;
  readonly launcher: string;
}
export interface McpJsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
}

export interface McpSessionExit {
  readonly status: number;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
}

export interface McpSession {
  readonly process_id: number;
  request(method: string, params: unknown): Promise<McpJsonRpcResponse>;
  close(): Promise<McpSessionExit>;
}

export interface McpToolResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly structuredContent: unknown;
  readonly isError?: true;
}

function offlineEnvironment(): NodeJS.ProcessEnv {
  const deniedProxy = "http://127.0.0.1:9";
  return {
    ...process.env,
    ALL_PROXY: deniedProxy,
    HTTP_PROXY: deniedProxy,
    HTTPS_PROXY: deniedProxy,
    NO_PROXY: "",
    PROJECT_MEMORY_NETWORK: "disabled",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_offline: "true",
  };
}

export function runGit(root: string, arguments_: readonly string[]): string {
  const result = spawnSync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    env: {
      ...offlineEnvironment(),
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    },
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return result.stdout.trim();
}

async function copyPluginRuntime(pluginRoot: string): Promise<void> {
  for (const relativePath of [
    ".codex-plugin",
    ".mcp.json",
    "catalog/project-memory/v1",
    "schemas/project-memory/v1",
    "skills/project-memory",
    "templates/project-memory",
    "scripts/project-memory.mjs",
    "dist/catalog/project-memory/1.0.0",
  ]) {
    const source = path.join(PACKAGE_ROOT, ...relativePath.split("/"));
    const target = path.join(pluginRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
  }
}

async function buildCleanBundles(
  sandbox: string,
  pluginRoot: string,
): Promise<void> {
  const result = spawnSync(process.execPath, [
    path.join(PACKAGE_ROOT, "scripts", "build-plugin-bundle.mjs"),
  ], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    env: offlineEnvironment(),
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);

  const outputDirectory = path.join(pluginRoot, "dist");
  await mkdir(outputDirectory, { recursive: true });
  for (const name of [
    "project-memory-mcp.mjs",
    "project-memory-mcp.mjs.sha256",
    "project-memory.mjs",
    "project-memory.mjs.sha256",
  ]) {
    const output = path.join(outputDirectory, name);
    expect(path.relative(sandbox, output).startsWith("..")).toBe(false);
    await cp(path.join(PACKAGE_ROOT, "dist", name), output);
  }
}
export async function preparePluginWorkflow(
  fixture: "new" | "legacy",
): Promise<PluginWorkflow> {
  await mkdir(path.join(PACKAGE_ROOT, ".tmp"), { recursive: true });
  const sandbox = await mkdtemp(path.join(PACKAGE_ROOT, ".tmp", "plugin-workflow-"));
  const pluginRoot = path.join(sandbox, "plugin");
  const projectRoot = path.join(sandbox, "project");
  await Promise.all([
    copyPluginRuntime(pluginRoot),
    cp(path.join(FIXTURE_ROOT, fixture), projectRoot, { recursive: true }),
    mkdir(path.join(sandbox, "temp"), { recursive: true }),
  ]);
  await buildCleanBundles(sandbox, pluginRoot);
  expect(await readdir(pluginRoot)).not.toContain("node_modules");
  await writeFile(path.join(projectRoot, ".gitignore"), "/.tmp/\n", "utf8");
  runGit(projectRoot, ["init", "--quiet", "--initial-branch=main"]);
  runGit(projectRoot, ["config", "user.email", "project-memory@example.invalid"]);
  runGit(projectRoot, ["config", "user.name", "Project Memory Workflow"]);
  runGit(projectRoot, ["config", "core.autocrlf", "false"]);
  runGit(projectRoot, ["add", "--all", "--", "."]);
  runGit(projectRoot, ["commit", "--quiet", "-m", `test: ${fixture} plugin workflow`]);
  return {
    sandbox,
    plugin_root: pluginRoot,
    project_root: projectRoot,
    project_url: pathToFileURL(`${projectRoot}${path.sep}`),
    launcher: path.join(pluginRoot, "scripts", "project-memory.mjs"),
  };
}

export async function cleanupPluginWorkflow(workflow: PluginWorkflow): Promise<void> {
  await rm(workflow.sandbox, { recursive: true, force: true });
}

export function runLauncher(
  workflow: PluginWorkflow,
  arguments_: readonly string[],
): LauncherResult {
  const result = spawnSync(process.execPath, [workflow.launcher, ...arguments_], {
    cwd: workflow.project_root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    env: offlineEnvironment(),
    maxBuffer: 64 * 1024 * 1024,
  });
  let envelope: Readonly<Record<string, unknown>> | null = null;
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      envelope = parsed as Readonly<Record<string, unknown>>;
    }
  } catch {
    envelope = null;
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
    envelope,
  };
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function waitFor<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(label + " timed out"));
    }, 90_000);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

class PluginMcpSession implements McpSession {
  readonly process_id: number;
  readonly #lines: ReadLineInterface;
  readonly #responses: AsyncIterator<string>;
  readonly #exit: Promise<McpSessionExit>;
  #stderr = "";
  #nextId = 1;
  #closed = false;
  #requestActive = false;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    if (child.pid === undefined) throw new Error("MCP process did not start");
    this.process_id = child.pid;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.#stderr += chunk;
    });
    this.#lines = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
      terminal: false,
    });
    this.#responses = this.#lines[Symbol.asyncIterator]();
    this.#exit = new Promise((resolve) => {
      child.once("error", (error) => {
        resolve({
          status: 1,
          signal: null,
          stderr: this.#stderr + error.message,
        });
      });
      child.once("exit", (status, signal) => {
        resolve({
          status: status ?? 1,
          signal,
          stderr: this.#stderr,
        });
      });
    });
  }

  async request(method: string, params: unknown): Promise<McpJsonRpcResponse> {
    if (this.#closed) throw new Error("MCP session is closed");
    if (this.#requestActive) throw new Error("MCP requests must be sequential");
    this.#requestActive = true;
    const id = this.#nextId++;
    try {
      await waitFor(new Promise<void>((resolve, reject) => {
        this.child.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
          (error) => {
            if (error === null || error === undefined) resolve();
            else reject(error);
          },
        );
      }), "MCP request write");
      const requestedName = recordValue(params)?.name;
      const operation = typeof requestedName === "string" ? requestedName : method;
      const next = await waitFor(
        this.#responses.next(),
        "MCP response for " + operation,
      );
      if (next.done) {
        const exited = await this.#exit;
        throw new Error("MCP process closed before responding: " + exited.stderr);
      }
      const parsed = JSON.parse(next.value) as unknown;
      const response = recordValue(parsed);
      if (
        response === null ||
        response.jsonrpc !== "2.0" ||
        response.id !== id
      ) {
        throw new Error("MCP returned an invalid or out-of-order response");
      }
      return response as unknown as McpJsonRpcResponse;
    } finally {
      this.#requestActive = false;
    }
  }

  async close(): Promise<McpSessionExit> {
    if (!this.#closed) {
      this.#closed = true;
      this.child.stdin.end();
    }
    const exited = await waitFor(this.#exit, "MCP process exit");
    this.#lines.close();
    return exited;
  }
}

export async function startPluginMcp(
  workflow: PluginWorkflow,
): Promise<McpSession> {
  const parsed = JSON.parse(await readFile(
    path.join(workflow.plugin_root, ".mcp.json"),
    "utf8",
  )) as unknown;
  const servers = recordValue(recordValue(parsed)?.mcpServers);
  const server = recordValue(servers?.["project-memory"]);
  const command = server?.command;
  const args = server?.args;
  const cwd = server?.cwd;
  if (
    typeof command !== "string" ||
    !Array.isArray(args) ||
    !args.every((value) => typeof value === "string") ||
    typeof cwd !== "string"
  ) {
    throw new Error("clean Plugin MCP declaration is invalid");
  }
  const resolvedCwd = path.resolve(workflow.plugin_root, cwd);
  const relativeCwd = path.relative(workflow.plugin_root, resolvedCwd);
  if (
    relativeCwd === ".." ||
    relativeCwd.startsWith(".." + path.sep) ||
    path.isAbsolute(relativeCwd)
  ) {
    throw new Error("clean Plugin MCP cwd escapes the Plugin root");
  }
  return new PluginMcpSession(spawn(command, args, {
    cwd: resolvedCwd,
    env: {
      ...offlineEnvironment(),
      TEMP: path.join(workflow.sandbox, "temp"),
      TMP: path.join(workflow.sandbox, "temp"),
      TMPDIR: path.join(workflow.sandbox, "temp"),
    },
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  }));
}

export async function callMcpTool(
  session: McpSession,
  name: "project_memory_start" | "project_memory_read" | "project_memory_apply",
  arguments_: unknown,
): Promise<McpToolResult> {
  const response = await session.request("tools/call", {
    name,
    arguments: arguments_,
  });
  if (response.error !== undefined) {
    throw new Error(
      "MCP request failed " + String(response.error.code) + ": " + response.error.message,
    );
  }
  const result = recordValue(response.result);
  if (
    result === null ||
    !Array.isArray(result.content) ||
    !Object.prototype.hasOwnProperty.call(result, "structuredContent")
  ) {
    throw new Error("MCP tool returned an invalid result");
  }
  return result as unknown as McpToolResult;
}

function bootstrapApproval(root: URL, plan: InitPlan): CanonicalRecord {
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

export async function bootstrapPluginWorkflow(
  workflow: PluginWorkflow,
): Promise<InitPlan> {
  const started = runLauncher(workflow, [
    "agent", "start", "--root", ".", "--brief", "BRIEF.md", "--json",
  ]);
  expect(started.status, started.stderr || started.stdout).toBe(0);
  const data = started.envelope?.data as {
    readonly proposal: { readonly plan: InitPlan };
    readonly apply_command: readonly string[];
  };
  const inputDirectory = path.join(workflow.project_root, ".tmp", "project-memory");
  await mkdir(inputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(inputDirectory, "init.plan.json"),
      `${JSON.stringify(data.proposal.plan)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(inputDirectory, "init.approval.json"),
      `${JSON.stringify(bootstrapApproval(workflow.project_url, data.proposal.plan))}\n`,
      "utf8",
    ),
  ]);
  const applied = runLauncher(workflow, data.apply_command);
  expect(applied.status, applied.stderr || applied.stdout).toBe(0);
  return data.proposal.plan;
}
export async function projectSnapshot(
  root: string,
): Promise<Readonly<Record<string, string>>> {
  const files: Record<string, string> = {};
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === ".tmp") continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      if (entry.isFile()) {
        files[path.relative(root, absolute).replaceAll(path.sep, "/")] =
          (await readFile(absolute)).toString("base64");
      }
    }
  }
  await visit(root);
  return files;
}
