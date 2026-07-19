import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type { CommandRegistry } from "../cli/command-registry.js";
import { executeCli } from "../cli/main.js";
import { createNodeCommandRegistry } from "../cli/node-composition.js";
import { parseCliArguments } from "../cli/parse-args.js";
import type { RuntimeResult } from "../contracts/runtime-result.js";
import {
  createNodeProjectMemoryHost,
  FileProposalStore,
  type ProjectMemoryHost,
  type StoredBootstrapProposal,
} from "../host/index.js";
import { PACKAGE_VERSION } from "../version.js";
const MAX_TOOL_RESPONSE_BYTES = 65_536;
const SERVER_INSTRUCTIONS = "Use project_memory_start before substantive repository work. Project Memory is repository-first, offline, and coordinator-governed. Never ask the user to select a profile.";
const READ_COMMANDS = new Set([
  "archive ingest plan",
  "archive verify",
  "catalog selected verify",
  "claim issue plan",
  "claim renew plan",
  "claim validate",
  "completion validate",
  "doctor",
  "import plan",
  "init plan",
  "initiative create plan",
  "initiative transition plan",
  "integrate validate",
  "migrate plan",
  "profile diff",
  "profile plan",
  "profile verify",
  "select root",
  "select work",
  "task create plan",
  "task materialize",
  "task transition plan",
  "views check",
  "views generate plan",
  "workstream compile",
  "workstream create plan",
  "workstream transition plan",
]);
const APPLY_COMMANDS = new Set([
  "archive ingest apply",
  "claim issue apply",
  "claim renew apply",
  "hub finalize",
  "import apply",
  "init apply",
  "initiative create apply",
  "initiative transition apply",
  "integrate finalize",
  "migrate apply",
  "profile apply",
  "satellite prepare",
  "task create apply",
  "task transition apply",
  "views generate apply",
  "workstream create apply",
  "workstream transition apply",
]);
const TOOLS = Object.freeze([
  {
    name: "project_memory_start",
    description: "Start or resume Project Memory for one local repository without mutating it.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["root"],
      properties: {
        root: { type: "string", format: "uri" },
        brief_path: {
          type: ["string", "null"],
          description: "Optional repository-relative path to a pre-existing structured initialization brief. Omit it to infer from repository evidence; never use a task dataset, prompt, schema, or output file.",
        },
        adapter_id: { type: "string", default: "adapter.codex" },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "project_memory_read",
    description: "Run one allowlisted read-only Project Memory protocol command in-process.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["root", "arguments"],
      properties: {
        root: { type: "string", format: "uri" },
        arguments: { type: "array", items: { type: "string" } },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "project_memory_apply",
    description: "Apply an approved bootstrap handle or one allowlisted coordinator-governed mutation.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["mode"],
      properties: {
        mode: { enum: ["bootstrap", "command"] },
        proposal_handle: { type: "string" },
        approval: { type: "object" },
        root: { type: "string", format: "uri" },
        arguments: { type: "array", items: { type: "string" } },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
] as const);
export interface McpTextContent {
  readonly type: "text";
  readonly text: string;
}
export interface McpToolResult {
  readonly content: readonly McpTextContent[];
  readonly structuredContent: unknown;
  readonly isError?: true;
}

type ProjectMemoryHostAdapter = Pick<ProjectMemoryHost, "start" | "applyBootstrap">;

export interface ProjectMemoryMcpServerDependencies {
  readonly createHost: (root: URL) => ProjectMemoryHostAdapter;
  readonly createRegistry: (root: URL) => CommandRegistry;
  readonly execute: typeof executeCli;
  readonly resolveProposal?: (
    handle: string,
  ) => Promise<RuntimeResult<StoredBootstrapProposal>>;
}

interface ProjectMemoryRuntime {
  readonly host: ProjectMemoryHostAdapter;
  readonly registry: CommandRegistry;
}

function defaultDependencies(): ProjectMemoryMcpServerDependencies {
  const proposals = new FileProposalStore();
  return {
    createHost: (root) => createNodeProjectMemoryHost(root),
    createRegistry: (root) => createNodeCommandRegistry(root),
    execute: executeCli,
    resolveProposal: (handle) => proposals.resolve(handle),
  };
}

function normalizedJson(value: unknown): unknown {
  const serialized = JSON.stringify(value, (_key, item: unknown) =>
    item instanceof Uint8Array
      ? { bytes_base64: Buffer.from(item).toString("base64") }
      : item);
  return JSON.parse(serialized) as unknown;
}

function toolResult(
  structuredContent: unknown,
  text: string,
  isError: boolean,
): McpToolResult {
  const content = [{ type: "text" as const, text }];
  return isError
    ? { content, structuredContent, isError: true }
    : { content, structuredContent };
}

function compactTextContent(structuredContent: unknown): string {
  const projection: Record<string, unknown> = {
    code: "MCP_STRUCTURED_CONTENT_AVAILABLE",
    message: "Complete Project Memory response is available in structuredContent.",
  };
  if (
    typeof structuredContent !== "object" ||
    structuredContent === null ||
    Array.isArray(structuredContent)
  ) {
    return JSON.stringify(projection);
  }
  const record = structuredContent as Record<string, unknown>;
  for (const key of [
    "schema_version",
    "command",
    "status",
    "kind",
    "proposal_handle",
    "confirmation_required",
    "expires_at",
    "summary",
    "clarification",
  ] as const) {
    if (record[key] !== undefined) projection[key] = record[key];
  }
  return JSON.stringify(projection);
}

function toolFailure(code: string, message: string, details?: unknown): McpToolResult {
  return boundedToolResult({ code, message, ...(details === undefined ? {} : { details }) }, true);
}

function boundedToolResult(value: unknown, isError = false): McpToolResult {
  const structuredContent = normalizedJson(value);
  const result = toolResult(structuredContent, JSON.stringify(structuredContent), isError);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") <= MAX_TOOL_RESPONSE_BYTES) {
    return result;
  }
  const compactResult = toolResult(
    structuredContent,
    compactTextContent(structuredContent),
    isError,
  );
  if (Buffer.byteLength(JSON.stringify(compactResult), "utf8") <= MAX_TOOL_RESPONSE_BYTES) {
    return compactResult;
  }
  const failure = {
    code: "MCP_RESPONSE_TOO_LARGE",
    message: "Project Memory tool response exceeds the 64 KiB transport limit",
  };
  return toolResult(failure, JSON.stringify(failure), true);
}

function runtimeToolResult<T>(result: RuntimeResult<T>): McpToolResult {
  if (result.ok) return boundedToolResult(result.value);
  const issue = result.issues[0];
  return toolFailure(
    issue?.code ?? "MCP_RUNTIME_FAILED",
    issue?.message ?? "Project Memory operation failed",
    { issues: result.issues },
  );
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new McpProtocolError(-32602, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new McpProtocolError(-32602, `${label} contains unsupported field ${unexpected}`);
  }
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new McpProtocolError(-32602, `${label} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new McpProtocolError(-32602, `${label} must be an array of strings`);
  }
  return value;
}

function rootUrl(value: unknown): URL {
  const raw = stringValue(value, "root");
  try {
    const root = new URL(raw);
    if (root.protocol !== "file:") {
      throw new Error("root must use the file protocol");
    }
    return root;
  } catch (error: unknown) {
    throw new McpProtocolError(
      -32602,
      error instanceof Error ? error.message : "root must be a valid file URL",
    );
  }
}

export class McpProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "McpProtocolError";
  }
}

export class ProjectMemoryMcpServer {
  readonly #runtimes = new Map<string, ProjectMemoryRuntime>();
  readonly #proposalHosts = new Map<string, ProjectMemoryHostAdapter>();

  constructor(
    private readonly dependencies: ProjectMemoryMcpServerDependencies = defaultDependencies(),
  ) {}

  async request(method: string, params: unknown): Promise<unknown> {
    if (method === "initialize") {
      const input = objectValue(params, "initialize params");
      return {
        protocolVersion: stringValue(input.protocolVersion, "protocolVersion"),
        capabilities: { tools: {} },
        serverInfo: { name: "Project Memory", version: PACKAGE_VERSION },
        instructions: SERVER_INSTRUCTIONS,
      };
    }
    if (method === "ping") return {};
    if (method === "tools/list") return { tools: TOOLS };
    if (method === "tools/call") return this.callTool(params);
    throw new McpProtocolError(-32601, `Method not found: ${method}`);
  }

  private runtime(root: URL): ProjectMemoryRuntime {
    const key = root.href;
    const existing = this.#runtimes.get(key);
    if (existing !== undefined) return existing;
    const created = {
      host: this.dependencies.createHost(root),
      registry: this.dependencies.createRegistry(root),
    };
    this.#runtimes.set(key, created);
    return created;
  }

  private async callTool(params: unknown): Promise<McpToolResult> {
    const input = objectValue(params, "tools/call params");
    onlyKeys(input, new Set(["name", "arguments", "_meta"]), "tools/call params");
    const name = stringValue(input.name, "tool name");
    if (name === "project_memory_start") return this.start(input.arguments);
    if (name === "project_memory_read") return this.read(input.arguments);
    if (name === "project_memory_apply") return this.apply(input.arguments);
    throw new McpProtocolError(-32602, `Unknown Project Memory tool: ${name}`);
  }

  private async start(arguments_: unknown): Promise<McpToolResult> {
    const input = objectValue(arguments_, "project_memory_start arguments");
    onlyKeys(input, new Set(["root", "brief_path", "adapter_id"]), "project_memory_start arguments");
    const root = rootUrl(input.root);
    const briefPath = input.brief_path === undefined || input.brief_path === null
      ? null
      : stringValue(input.brief_path, "brief_path");
    const adapterId = input.adapter_id === undefined
      ? "adapter.codex"
      : stringValue(input.adapter_id, "adapter_id");
    try {
      const started = await this.runtime(root).host.start({
        root,
        brief_path: briefPath,
        adapter_id: adapterId,
      });
      if (started.ok && started.value.kind === "bootstrap_review_required") {
        this.#proposalHosts.set(started.value.proposal_handle, this.runtime(root).host);
      }
      return runtimeToolResult(started);
    } catch {
      return toolFailure("MCP_HOST_REJECTED", "Project Memory startup host rejected");
    }
  }

  private async read(arguments_: unknown): Promise<McpToolResult> {
    const input = objectValue(arguments_, "project_memory_read arguments");
    onlyKeys(input, new Set(["root", "arguments"]), "project_memory_read arguments");
    const root = rootUrl(input.root);
    return this.runCommand(root, stringArray(input.arguments, "arguments"), false);
  }

  private async apply(arguments_: unknown): Promise<McpToolResult> {
    const input = objectValue(arguments_, "project_memory_apply arguments");
    const mode = stringValue(input.mode, "mode");
    if (mode === "bootstrap") {
      onlyKeys(input, new Set(["mode", "proposal_handle", "approval"]), "bootstrap apply arguments");
      const proposalHandle = stringValue(input.proposal_handle, "proposal_handle");
      const approval = objectValue(input.approval, "approval");
      onlyKeys(approval, new Set(["confirmed", "granted_by"]), "approval");
      if (typeof approval.confirmed !== "boolean") {
        throw new McpProtocolError(-32602, "approval.confirmed must be boolean");
      }
      let host = this.#proposalHosts.get(proposalHandle);
      if (host === undefined) {
        const resolveProposal = this.dependencies.resolveProposal;
        if (resolveProposal === undefined) {
          return toolFailure(
            "HOST_PROPOSAL_NOT_FOUND",
            "proposal handle is unknown or already consumed",
          );
        }
        const proposal = await resolveProposal(proposalHandle);
        if (!proposal.ok) return runtimeToolResult(proposal);
        host = this.runtime(proposal.value.root).host;
        this.#proposalHosts.set(proposalHandle, host);
      }
      try {
        const applied = await host.applyBootstrap({
          proposal_handle: proposalHandle,
          approval: {
            confirmed: approval.confirmed,
            granted_by: stringValue(approval.granted_by, "approval.granted_by"),
          },
        });
        if (applied.ok) this.#proposalHosts.delete(proposalHandle);
        return runtimeToolResult(applied);
      } catch {
        return toolFailure("MCP_HOST_REJECTED", "Project Memory bootstrap host rejected");
      }
    }
    if (mode === "command") {
      onlyKeys(input, new Set(["mode", "root", "arguments"]), "command apply arguments");
      return this.runCommand(
        rootUrl(input.root),
        stringArray(input.arguments, "arguments"),
        true,
      );
    }
    throw new McpProtocolError(-32602, "mode must be bootstrap or command");
  }

  private async runCommand(
    root: URL,
    arguments_: readonly string[],
    mutating: boolean,
  ): Promise<McpToolResult> {
    const runtime = this.runtime(root);
    const parsed = parseCliArguments(arguments_, runtime.registry.paths());
    if (!parsed.ok) return runtimeToolResult(parsed);
    const label = parsed.value.command_path.join(" ");
    const handler = runtime.registry.resolve(parsed.value.command_path);
    if (handler === undefined) {
      return toolFailure("CLI_COMMAND_UNKNOWN", `unknown command ${label}`);
    }
    if (!READ_COMMANDS.has(label) && !APPLY_COMMANDS.has(label)) {
      return toolFailure(
        "MCP_COMMAND_NOT_EXPOSED",
        `${label} remains available only through the developer CLI`,
      );
    }
    if (handler.mutates !== mutating) {
      return toolFailure(
        "MCP_OPERATION_CLASS_MISMATCH",
        mutating
          ? `${label} is read-only and cannot run through project_memory_apply`
          : `${label} mutates and cannot run through project_memory_read`,
      );
    }
    try {
      const execution = await this.dependencies.execute(arguments_, {
        registry: runtime.registry,
        current_directory: root,
      });
      return boundedToolResult(
        execution.envelope,
        execution.envelope.status === "failed",
      );
    } catch {
      return toolFailure("MCP_COMMAND_REJECTED", "Project Memory command execution rejected");
    }
  }
}

export type JsonRpcId = string | number | null;

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
}

function validId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === "string" || typeof value === "number";
}

function errorResponse(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export async function routeMcpMessage(
  server: ProjectMemoryMcpServer,
  raw: unknown,
): Promise<JsonRpcResponse | null> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return errorResponse(null, -32700, "Parse error");
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return errorResponse(null, -32600, "Invalid Request");
  }
  const message = parsed as Record<string, unknown>;
  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  const id = validId(message.id) ? message.id : null;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string" || (hasId && !validId(message.id))) {
    return hasId ? errorResponse(id, -32600, "Invalid Request") : null;
  }
  try {
    const result = await server.request(message.method, message.params ?? {});
    return hasId ? { jsonrpc: "2.0", id, result } : null;
  } catch (error: unknown) {
    if (!hasId) return null;
    return error instanceof McpProtocolError
      ? errorResponse(id, error.code, error.message)
      : errorResponse(id, -32603, "Internal error");
  }
}

export interface StartProjectMemoryMcpServerOptions {
  readonly server?: ProjectMemoryMcpServer;
  readonly input?: Readable;
  readonly output?: Writable;
}

function writeResponse(output: Writable, response: JsonRpcResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    output.write(`${JSON.stringify(response)}\n`, (error: Error | null | undefined) => {
      if (error === null || error === undefined) resolve();
      else reject(error);
    });
  });
}

export async function startProjectMemoryMcpServer(
  options: StartProjectMemoryMcpServerOptions = {},
): Promise<void> {
  const server = options.server ?? new ProjectMemoryMcpServer();
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    const response = await routeMcpMessage(server, line);
    if (response !== null) await writeResponse(output, response);
  }
}
