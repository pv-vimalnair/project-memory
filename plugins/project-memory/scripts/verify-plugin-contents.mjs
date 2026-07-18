#!/usr/bin/env node
// @ts-check
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  access,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { TextDecoder } from "node:util";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const temporaryRoot = path.join(packageRoot, ".tmp");
const installParent = path.join(temporaryRoot, "plugin-install");
const pluginRoot = path.join(installParent, "project-memory");
const logicalManifestPath = path.join(
  installParent,
  "project-memory.logical-manifest.json",
);
const executionReportPath = path.join(
  installParent,
  "project-memory.execution-report.json",
);

const REQUIRED_FILES = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "catalog/project-memory/v1/CHANGELOG.md",
  "catalog/project-memory/v1/fixtures/blueprints/ai-data/ai.analytics-decision-support.positive.yaml",
  "catalog/project-memory/v1/manifest.yaml",
  "dist/catalog/project-memory/1.0.0/SHA256SUMS",
  "dist/catalog/project-memory/1.0.0/catalog.bundle.json",
  "dist/catalog/project-memory/1.0.0/catalog.lock.json",
  "dist/project-memory-mcp.mjs",
  "dist/project-memory-mcp.mjs.sha256",
  "dist/project-memory.mjs",
  "dist/project-memory.mjs.sha256",
  "schemas/project-memory/v1/schema-index.json",
  "scripts/project-memory.mjs",
  "skills/project-memory/SKILL.md",
  "skills/project-memory/agents/openai.yaml",
  "skills/project-memory/references/agent-protocol.md",
  "templates/project-memory/PROJECT.md",
];

const EXACT_RUNTIME_FILES = new Set([
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "dist/project-memory-mcp.mjs",
  "dist/project-memory-mcp.mjs.sha256",
  "dist/project-memory.mjs",
  "dist/project-memory.mjs.sha256",
  "scripts/project-memory.mjs",
]);

class PluginVerificationError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "PluginVerificationError";
    this.code = code;
  }
}

/** @param {Uint8Array | string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {string} left @param {string} right */
function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/** @param {unknown} value @returns {unknown} */
function ordered(value) {
  if (Array.isArray(value)) return value.map((item) => ordered(item));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, item]) => [key, ordered(item)]),
  );
}

/** @param {unknown} value */
function canonicalJson(value) {
  return `${JSON.stringify(ordered(value))}\n`;
}

/** @param {unknown} value */
function record(value) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  return null;
}

/** @param {boolean} sanitized */
function offlineEnvironment(sanitized) {
  /** @type {NodeJS.ProcessEnv} */
  const environment = {};
  if (sanitized) {
    for (const name of [
      "APPDATA",
      "COMSPEC",
      "HOME",
      "LANG",
      "LOCALAPPDATA",
      "PATH",
      "Path",
      "PATHEXT",
      "SystemRoot",
      "TEMP",
      "TMP",
      "USERPROFILE",
      "WINDIR",
    ]) {
      if (process.env[name] !== undefined) environment[name] = process.env[name];
    }
  } else {
    Object.assign(environment, process.env);
  }
  const deniedProxy = "http://127.0.0.1:9";
  return {
    ...environment,
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

/**
 * @param {string} executable
 * @param {readonly string[]} arguments_
 * @param {string} cwd
 * @param {boolean} sanitizedEnvironment
 */
function runChecked(executable, arguments_, cwd, sanitizedEnvironment) {
  const result = spawnSync(executable, arguments_, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env: offlineEnvironment(sanitizedEnvironment),
  });
  if (result.error !== undefined) {
    throw new PluginVerificationError(
      "PLUGIN_COMMAND_FAILED",
      result.error.message,
    );
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "command failed").trim();
    throw new PluginVerificationError("PLUGIN_COMMAND_FAILED", detail);
  }
  return result.stdout;
}

/** @param {string} relativePath */
function forbiddenPath(relativePath) {
  const normalized = relativePath.toLowerCase();
  const parts = normalized.split("/");
  const base = parts.at(-1) ?? "";
  const catalogRuntime = normalized === "catalog/project-memory/v1" ||
    normalized.startsWith("catalog/project-memory/v1/");
  const catalogRuntimeFixture = normalized === "catalog/project-memory/v1/fixtures" ||
    normalized.startsWith("catalog/project-memory/v1/fixtures/");
  const forbiddenFixture = !catalogRuntimeFixture &&
    parts.some((part) => part === "fixture" || part === "fixtures");
  const forbiddenNamedArtifact = !catalogRuntime &&
    /(?:credential|secret|raw[-_. ]?(?:model[-_. ]?)?output)/i.test(normalized);
  return parts.some((part) => [
    ".git",
    "coverage",
    "node_modules",
    "tests",
  ].includes(part)) ||
    forbiddenFixture ||
    forbiddenNamedArtifact ||
    parts.some((part) => part.startsWith(".env")) ||
    base.endsWith(".log");
}

/** @param {string} relativePath */
function allowlistedPath(relativePath) {
  if (EXACT_RUNTIME_FILES.has(relativePath)) return true;
  if (relativePath.startsWith("catalog/project-memory/v1/")) {
    return /\.(?:md|ya?ml|json)$/.test(relativePath);
  }
  if (relativePath.startsWith("skills/project-memory/")) {
    return /\.(?:md|ya?ml|json)$/.test(relativePath);
  }
  if (relativePath.startsWith("schemas/project-memory/v1/")) {
    return relativePath.endsWith(".json");
  }
  if (relativePath.startsWith("templates/project-memory/")) {
    return relativePath.endsWith(".md");
  }
  if (relativePath.startsWith("dist/catalog/project-memory/1.0.0/")) {
    return /\/(?:catalog\.bundle\.json|catalog\.lock\.json|SHA256SUMS)$/.test(
      relativePath,
    );
  }
  return false;
}

/** @param {string} relativePath @param {Uint8Array} bytes */
function assertSafeContent(relativePath, bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PluginVerificationError(
      "PLUGIN_CONTENT_FORBIDDEN_CONTENT",
      `${relativePath}: runtime artifacts must be UTF-8 text`,
    );
  }
  const forbidden = [
    /(?:^|[\s("'`])(?:[A-Za-z]:[\\/](?:Users|home|tmp|Documents|Desktop)[\\/]|\/(?:Users|home|tmp)\/)/m,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bsk-(?:proj|live|test)-[A-Za-z0-9_-]{8,}\b/,
    /"type"\s*:\s*"response_item"|"role"\s*:\s*"assistant"/,
    /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"']{8,}["']/i,
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new PluginVerificationError(
      "PLUGIN_CONTENT_FORBIDDEN_CONTENT",
      `${relativePath}: local paths, secrets, credentials, or raw model output are forbidden`,
    );
  }
}

/**
 * Inspect one candidate Plugin tree without changing it.
 * @param {string} root
 */
async function inspectPluginTree(root) {
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new PluginVerificationError(
      "PLUGIN_CONTENT_UNSAFE_ROOT",
      "Plugin root must be a regular directory",
    );
  }
  /** @type {{path: string, length: number, sha256: string}[]} */
  const entries = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    const children = (await readdir(current, { withFileTypes: true }))
      .sort((left, right) => compareUtf8(left.name, right.name));
    for (const child of children) {
      const target = path.join(current, child.name);
      const relativePath = path.relative(root, target).replaceAll(path.sep, "/");
      if (child.isSymbolicLink()) {
        throw new PluginVerificationError(
          "PLUGIN_CONTENT_FORBIDDEN_PATH",
          `${relativePath}: symlinks are forbidden`,
        );
      }
      if (forbiddenPath(relativePath)) {
        throw new PluginVerificationError(
          "PLUGIN_CONTENT_FORBIDDEN_PATH",
          `${relativePath}: development, secret, or generated residue is forbidden`,
        );
      }
      if (child.isDirectory()) {
        pending.push(target);
        continue;
      }
      if (!child.isFile() || !allowlistedPath(relativePath)) {
        throw new PluginVerificationError(
          "PLUGIN_CONTENT_NOT_ALLOWLISTED",
          `${relativePath}: file is outside the declared runtime allowlist`,
        );
      }
      const bytes = new Uint8Array(await readFile(target));
      assertSafeContent(relativePath, bytes);
      entries.push({
        path: relativePath,
        length: bytes.length,
        sha256: sha256(bytes),
      });
    }
  }
  return entries.sort((left, right) => compareUtf8(left.path, right.path));
}

/** @param {readonly {path: string}[]} entries */
function assertRequiredRuntime(entries) {
  const paths = new Set(entries.map((entry) => entry.path));
  const missing = REQUIRED_FILES.filter((relativePath) => !paths.has(relativePath));
  if (missing.length > 0) {
    throw new PluginVerificationError(
      "PLUGIN_CONTENT_REQUIRED_MISSING",
      `required runtime files are missing: ${missing.join(", ")}`,
    );
  }
  for (const prefix of [
    "catalog/project-memory/v1/",
    "schemas/project-memory/v1/",
    "templates/project-memory/",
  ]) {
    if (![...paths].some((relativePath) => relativePath.startsWith(prefix))) {
      throw new PluginVerificationError(
        "PLUGIN_CONTENT_REQUIRED_MISSING",
        `required runtime group is empty: ${prefix}`,
      );
    }
  }
}

async function ensureBuildArtifacts() {
  const typeScript = path.join(packageRoot, "node_modules", "typescript", "bin", "tsc");
  try {
    await access(typeScript);
  } catch {
    throw new PluginVerificationError(
      "PLUGIN_BUILD_DEPENDENCY_MISSING",
      "the pinned local TypeScript compiler is unavailable; run npm ci first",
    );
  }
  runChecked(
    process.execPath,
    [typeScript, "-p", "tsconfig.build.json"],
    packageRoot,
    false,
  );
  runChecked(
    process.execPath,
    [path.join(packageRoot, "scripts", "build-plugin-bundle.mjs")],
    packageRoot,
    false,
  );
}

async function copyRuntimeAllowlist() {
  await rm(installParent, { recursive: true, force: true });
  await mkdir(pluginRoot, { recursive: true });
  for (const relativePath of [
    ".codex-plugin",
    ".mcp.json",
    "catalog/project-memory/v1",
    "skills/project-memory",
    "scripts/project-memory.mjs",
    "dist/project-memory-mcp.mjs",
    "dist/project-memory-mcp.mjs.sha256",
    "dist/project-memory.mjs",
    "dist/project-memory.mjs.sha256",
    "schemas/project-memory/v1",
    "templates/project-memory",
  ]) {
    const source = path.join(packageRoot, ...relativePath.split("/"));
    const target = path.join(pluginRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, force: false, errorOnExist: true });
  }
  await rm(
    path.join(pluginRoot, "schemas", "project-memory", "v1", ".gitkeep"),
    { force: true },
  );
}

/* eslint-disable @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-unsafe-call,
  @typescript-eslint/no-unsafe-member-access -- Freshly compiled local modules are validated immediately. */
async function buildCatalogIntoCleanCopy() {
  const [{ buildCatalogRelease }, { PROJECT_SCHEMA_REGISTRARS }, { registerProjectSchemas }] =
    await Promise.all([
      import(pathToFileURL(path.join(
        packageRoot,
        "dist/catalog/manifest/build-catalog-bundle.js",
      )).href),
      import(pathToFileURL(path.join(
        packageRoot,
        "dist/schema/project-registrars.js",
      )).href),
      import(pathToFileURL(path.join(
        packageRoot,
        "dist/schema/registry.js",
      )).href),
    ]);
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) {
    throw new PluginVerificationError(
      "PLUGIN_CATALOG_BUILD_FAILED",
      JSON.stringify(registered.issues),
    );
  }
  const built = await buildCatalogRelease({
    sourceRoot: pathToFileURL(
      `${path.join(packageRoot, "catalog", "project-memory", "v1")}${path.sep}`,
    ),
    outputRoot: pathToFileURL(`${pluginRoot}${path.sep}`),
    release: "1.0.0",
  });
  if (!built.ok) {
    throw new PluginVerificationError(
      "PLUGIN_CATALOG_BUILD_FAILED",
      JSON.stringify(built.issues),
    );
  }
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

/** @param {string} relativePath */
async function verifyBundle(relativePath) {
  const bundlePath = path.join(pluginRoot, ...relativePath.split("/"));
  const [bundle, hashFile] = await Promise.all([
    readFile(bundlePath),
    readFile(`${bundlePath}.sha256`, "utf8"),
  ]);
  const digest = sha256(bundle);
  if (hashFile !== `${digest}\n`) {
    throw new PluginVerificationError(
      "PLUGIN_BUNDLE_HASH_MISMATCH",
      relativePath + ": bundled bytes do not match the SHA-256 file",
    );
  }
  const source = bundle.toString("utf8");
  if (/(?:from\s*|require\(|import\()\s*["']node:(?:dgram|dns|http|https|net|tls)/.test(source)) {
    throw new PluginVerificationError(
      "PLUGIN_BUNDLE_NETWORK_CAPABILITY",
      relativePath + ": bundled code imports a Node network module",
    );
  }
  return { path: relativePath, length: bundle.length, sha256: digest };
}

function findPython() {
  const candidates = [...new Set([
    process.env.PYTHON,
    "python",
    "python3",
  ].filter((value) => value !== undefined))];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      env: offlineEnvironment(false),
    });
    if (result.error === undefined && result.status === 0) return candidate;
  }
  throw new PluginVerificationError(
    "PLUGIN_VALIDATOR_PYTHON_MISSING",
    "Python is required for the official Plugin validators",
  );
}

async function runOfficialValidators() {
  const codexHome = process.env.CODEX_HOME ?? path.join(homedir(), ".codex");
  const skillValidator = path.join(
    codexHome,
    "skills",
    ".system",
    "skill-creator",
    "scripts",
    "quick_validate.py",
  );
  const pluginValidator = path.join(
    codexHome,
    "skills",
    ".system",
    "plugin-creator",
    "scripts",
    "validate_plugin.py",
  );
  try {
    await Promise.all([access(skillValidator), access(pluginValidator)]);
  } catch {
    throw new PluginVerificationError(
      "PLUGIN_OFFICIAL_VALIDATOR_MISSING",
      "both official Codex skill and Plugin validators are required",
    );
  }
  const python = findPython();
  runChecked(
    python,
    [skillValidator, path.join(pluginRoot, "skills", "project-memory")],
    packageRoot,
    false,
  );
  runChecked(python, [pluginValidator, pluginRoot], packageRoot, false);
  return { plugin: "passed", skill: "passed" };
}

async function prepareSmokeRepository() {
  const root = path.join(installParent, "runtime-smoke");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(root, "BRIEF.md"),
      [
        "name: Clean Plugin Smoke",
        "mission: Verify clean automatic Project Memory startup",
        "namespace: project-memory-clean-smoke",
        "root_kind: product",
        "primary_archetype: application-service",
        "blueprint: application.consumer-mobile",
        "lifecycle: active",
        "owners:",
        "  - release-verification",
        "runtime_adapters:",
        "  - adapter.flutter",
        "workflow_adapters:",
        "  - adapter.figma",
        "success_criteria:",
        "  - Clean install returns a bootstrap proposal",
        "included_scope:",
        "  - Clean Plugin startup",
        "excluded_scope:",
        "  - Production deployment",
      ].join("\n") + "\n",
      "utf8",
    ),
    writeFile(
      path.join(root, "package.json"),
      '{"name":"project-memory-clean-smoke","private":true}\n',
      "utf8",
    ),
  ]);
  const gitEnvironment = {
    ...offlineEnvironment(true),
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  };
  const runGit = (/** @type {readonly string[]} */ arguments_) => {
    const result = spawnSync("git", arguments_, {
      cwd: root,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      env: gitEnvironment,
    });
    if (result.error !== undefined || result.status !== 0) {
      throw new PluginVerificationError(
        "PLUGIN_SMOKE_GIT_FAILED",
        result.error?.message ?? (result.stderr || "Git command failed"),
      );
    }
  };
  runGit(["init", "--quiet", "--initial-branch=main"]);
  runGit(["config", "user.email", "project-memory@example.invalid"]);
  runGit(["config", "user.name", "Project Memory Verification"]);
  runGit(["add", "--", "BRIEF.md", "package.json"]);
  runGit(["commit", "--quiet", "-m", "test: clean plugin smoke fixture"]);
  return root;
}

async function runCleanLauncher() {
  const repository = await prepareSmokeRepository();
  const launcher = path.join(pluginRoot, "scripts", "project-memory.mjs");
  const environment = offlineEnvironment(true);
  const run = (/** @type {readonly string[]} */ arguments_) => {
    const result = spawnSync(process.execPath, [launcher, ...arguments_], {
      cwd: repository,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      env: environment,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error !== undefined || result.status !== 0) {
      throw new PluginVerificationError(
        "PLUGIN_CLEAN_LAUNCH_FAILED",
        result.error?.message ?? (result.stderr || "clean launcher failed"),
      );
    }
    return result.stdout;
  };
  const version = run(["--version"]).trim();
  const started = /** @type {unknown} */ (JSON.parse(run([
    "agent",
    "start",
    "--root",
    ".",
    "--brief",
    "BRIEF.md",
    "--json",
  ])));
  const envelope = record(started);
  const data = envelope === null ? null : record(envelope.data);
  const kind = data?.kind;
  if (version !== "0.1.0" || kind !== "bootstrap_review_required") {
    throw new PluginVerificationError(
      "PLUGIN_CLEAN_LAUNCH_INVALID",
      "clean launcher did not return the pinned version and bootstrap directive",
    );
  }
  return {
    version,
    agent_start: kind,
    node_modules_present: false,
  };
}

const EXPECTED_MCP_CONFIG = {
  mcpServers: {
    "project-memory": {
      command: "node",
      args: ["./dist/project-memory-mcp.mjs"],
      cwd: ".",
      tool_timeout_sec: 900,
    },
  },
};

async function cleanMcpEntrypoint() {
  /** @type {unknown} */
  let manifest;
  /** @type {unknown} */
  let config;
  try {
    manifest = /** @type {unknown} */ (JSON.parse(await readFile(
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
      "utf8",
    )));
    config = /** @type {unknown} */ (JSON.parse(
      await readFile(path.join(pluginRoot, ".mcp.json"), "utf8"),
    ));
  } catch {
    throw new PluginVerificationError(
      "PLUGIN_MCP_DECLARATION_INVALID",
      "Plugin MCP declaration must be valid JSON",
    );
  }
  if (
    record(manifest)?.mcpServers !== "./.mcp.json" ||
    canonicalJson(config) !== canonicalJson(EXPECTED_MCP_CONFIG)
  ) {
    throw new PluginVerificationError(
      "PLUGIN_MCP_DECLARATION_INVALID",
      "Plugin must declare exactly one bundled local stdio MCP server",
    );
  }
  return path.join(pluginRoot, "dist", "project-memory-mcp.mjs");
}

async function runCleanMcp() {
  const entrypoint = await cleanMcpEntrypoint();
  let nodeModulesPresent = true;
  try {
    await access(path.join(pluginRoot, "node_modules"));
  } catch {
    nodeModulesPresent = false;
  }
  if (nodeModulesPresent) {
    throw new PluginVerificationError(
      "PLUGIN_MCP_DEPENDENCY_RESIDUE",
      "clean MCP smoke must run without node_modules",
    );
  }

  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "ping", params: {} },
  ];
  const result = spawnSync(process.execPath, [entrypoint], {
    cwd: pluginRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    input: messages.map((message) => JSON.stringify(message)).join("\n") + "\n",
    env: offlineEnvironment(true),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new PluginVerificationError(
      "PLUGIN_CLEAN_MCP_FAILED",
      result.error?.message ?? (result.stderr || "clean MCP smoke failed"),
    );
  }

  /** @type {unknown[]} */
  let responses;
  try {
    responses = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => /** @type {unknown} */ (JSON.parse(line)));
  } catch {
    throw new PluginVerificationError(
      "PLUGIN_CLEAN_MCP_INVALID",
      "clean MCP smoke returned invalid JSON",
    );
  }
  const initialized = record(record(responses[0])?.result);
  const listed = record(record(responses[1])?.result);
  const pinged = record(record(responses[2])?.result);
  const listedTools = Array.isArray(listed?.tools)
    ? /** @type {unknown[]} */ (listed.tools)
    : [];
  const tools = listedTools.map((tool) => record(tool)?.name);
  const expectedTools = [
    "project_memory_start",
    "project_memory_read",
    "project_memory_apply",
  ];
  if (
    responses.length !== 3 ||
    record(responses[0])?.id !== 1 ||
    initialized?.protocolVersion !== "2025-06-18" ||
    record(responses[1])?.id !== 2 ||
    JSON.stringify(tools) !== JSON.stringify(expectedTools) ||
    record(responses[2])?.id !== 3 ||
    pinged === null ||
    Object.keys(pinged).length !== 0 ||
    result.stderr !== ""
  ) {
    throw new PluginVerificationError(
      "PLUGIN_CLEAN_MCP_INVALID",
      "clean MCP did not complete initialize, tool discovery, and ping",
    );
  }
  return {
    initialize: "passed",
    tools: expectedTools,
    ping: "passed",
    node_modules_present: false,
  };
}

/** @param {string} value */
function inspectionRoot(value) {
  if (!/^\.tmp\/[A-Za-z0-9._/-]+$/.test(value)) {
    throw new PluginVerificationError(
      "PLUGIN_INSPECTION_PATH_INVALID",
      "--inspect requires a child of .tmp",
    );
  }
  const resolved = path.resolve(packageRoot, value);
  const relative = path.relative(temporaryRoot, resolved);
  if (
    relative === "" || relative === ".." ||
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  ) {
    throw new PluginVerificationError(
      "PLUGIN_INSPECTION_PATH_INVALID",
      "--inspect must remain inside package .tmp",
    );
  }
  return resolved;
}

async function verifyCleanPlugin() {
  await ensureBuildArtifacts();
  await copyRuntimeAllowlist();
  await buildCatalogIntoCleanCopy();
  const entries = await inspectPluginTree(pluginRoot);
  assertRequiredRuntime(entries);
  const manifest = {
    schema_version: "1.0.0",
    plugin: "project-memory",
    entries,
  };
  const manifestBytes = canonicalJson(manifest);
  await writeFile(logicalManifestPath, manifestBytes, "utf8");
  const [bundle, mcpBundle, validators, launcher, mcp] = await Promise.all([
    verifyBundle("dist/project-memory.mjs"),
    verifyBundle("dist/project-memory-mcp.mjs"),
    runOfficialValidators(),
    runCleanLauncher(),
    runCleanMcp(),
  ]);
  const report = {
    schema_version: "1.0.0",
    valid: true,
    plugin_root: "project-memory",
    network: "disabled",
    logical_manifest_sha256: sha256(manifestBytes),
    bundle,
    mcp_bundle: mcpBundle,
    mcp,
    validators,
    launcher,
  };
  const reportBytes = canonicalJson(report);
  await writeFile(executionReportPath, reportBytes, "utf8");
  process.stdout.write(reportBytes);
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length === 0) {
    await verifyCleanPlugin();
    return;
  }
  if (arguments_.length === 2 && arguments_[0] === "--inspect") {
    const root = inspectionRoot(arguments_[1] ?? "");
    const entries = await inspectPluginTree(root);
    process.stdout.write(canonicalJson({
      schema_version: "1.0.0",
      valid: true,
      entries,
    }));
    return;
  }
  throw new PluginVerificationError(
    "PLUGIN_VERIFY_USAGE",
    "usage: verify-plugin-contents.mjs [--inspect .tmp/<directory>]",
  );
}

const entry = process.argv[1];
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    const code = error instanceof PluginVerificationError
      ? error.code
      : "PLUGIN_VERIFY_FAILED";
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${code}: ${message}\n`);
    process.exitCode = 1;
  }
}
