#!/usr/bin/env node
// @ts-check
import { spawnSync } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const marketplacePath = path.join(repositoryRoot, ".agents", "plugins", "marketplace.json");
const manifestPath = path.join(packageRoot, ".codex-plugin", "plugin.json");
const runbookPath = path.join(
  repositoryRoot,
  "docs",
  "pilots",
  "CODEX_PLUGIN_INSTALL_PILOT.md",
);
const cleanVerifier = path.join(packageRoot, "scripts", "verify-plugin-contents.mjs");
const temporaryRoot = path.join(packageRoot, ".tmp");
const distRoot = path.join(packageRoot, "dist");
const typeScriptCompiler = path.join(packageRoot, "node_modules", "typescript", "bin", "tsc");
const bundleBuilder = path.join(packageRoot, "scripts", "build-plugin-bundle.mjs");

class MarketplaceVerificationError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "MarketplaceVerificationError";
    this.code = code;
  }
}

/** @param {unknown} value */
function record(value) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  return null;
}

/** @param {string} value */
function comparablePath(value) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** @param {string} root @param {string} candidate */
function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

/** @param {string} text @returns {unknown} */
function parseJson(text) {
  return JSON.parse(text);
}

/** @param {string} filename */
async function readJson(filename) {
  try {
    return parseJson(await readFile(filename, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MarketplaceVerificationError("MARKETPLACE_JSON_INVALID", message);
  }
}

async function assertRepositoryLayout() {
  const [repositoryStat, packageStat] = await Promise.all([
    lstat(repositoryRoot),
    lstat(packageRoot),
  ]);
  if (
    !repositoryStat.isDirectory() || repositoryStat.isSymbolicLink() ||
    !packageStat.isDirectory() || packageStat.isSymbolicLink()
  ) {
    throw new MarketplaceVerificationError(
      "MARKETPLACE_PLUGIN_ROOT_UNSAFE",
      "the repository and local plugin roots must be regular directories",
    );
  }
  const [repositoryReal, packageReal] = await Promise.all([
    realpath(repositoryRoot),
    realpath(packageRoot),
  ]);
  if (
    comparablePath(repositoryReal) !== comparablePath(repositoryRoot) ||
    comparablePath(packageReal) !== comparablePath(packageRoot) ||
    !isInside(repositoryReal, packageReal)
  ) {
    throw new MarketplaceVerificationError(
      "MARKETPLACE_PLUGIN_ROOT_OUTSIDE_REPOSITORY",
      "repository paths must be realpath-pinned and the plugin must remain inside the repository",
    );
  }
  return repositoryReal;
}

/** @param {string} root @param {string} filename @param {string} role */
async function assertRegularRepositoryFile(root, filename, role) {
  const stat = await lstat(filename);
  const resolved = await realpath(filename);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    comparablePath(resolved) !== comparablePath(filename) ||
    !isInside(root, resolved)
  ) {
    throw new MarketplaceVerificationError(
      "MARKETPLACE_INPUT_UNSAFE",
      `${role} must be a regular, symlink-free file inside the repository`,
    );
  }
  return {
    role,
    path: path.relative(root, resolved).replaceAll(path.sep, "/"),
    kind: "regular_file",
    symlink_free: true,
  };
}

/** @param {string} root @param {string} dirname @param {string} role */
async function assertSafeOutputRoot(root, dirname, role) {
  const lexical = path.resolve(dirname);
  if (!isInside(root, lexical)) {
    throw new MarketplaceVerificationError(
      "MARKETPLACE_OUTPUT_UNSAFE",
      `${role} must remain inside the repository`,
    );
  }
  let stat;
  try {
    stat = await lstat(lexical);
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === "ENOENT") {
      return {
        role,
        path: path.relative(root, lexical).replaceAll(path.sep, "/"),
        kind: "directory_or_absent",
        symlink_free: true,
      };
    }
    throw error;
  }
  const resolved = await realpath(lexical);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    comparablePath(resolved) !== comparablePath(lexical) ||
    !isInside(root, resolved)
  ) {
    throw new MarketplaceVerificationError(
      "MARKETPLACE_OUTPUT_UNSAFE",
      `${role} must be absent or a regular, symlink-free repository directory`,
    );
  }
  return {
    role,
    path: path.relative(root, resolved).replaceAll(path.sep, "/"),
    kind: "directory_or_absent",
    symlink_free: true,
  };
}

/** @param {string} runbook */
function assertPilotRunbook(runbook) {
  for (const requirement of [
    "PREPARED - NOT AUTHORIZED",
    "explicit Pitaji approval",
    "expected HEAD",
    "git rev-parse HEAD",
    "sanitized scratch repository",
    "codex plugin list",
    "New Codex App task/thread",
    "implicit invocation",
    "one confirmation",
    "no profile picker",
    "deterministic resume",
    "Evidence capture",
    "codex plugin remove project-memory@project-memory",
    "disposable, isolated source worktree",
    "not executable as written",
    "verified-absolute-cachebuster-script",
    "logical_manifest_sha256",
    "only `version` changed",
    "marketplace-list",
    "not_assessed",
    "plugins/project-memory/.tmp/**",
    "symlink-free",
    "post-cachebuster hash",
    "plugins/project-memory/dist/**",
    "external_not_bound",
    "existing isolated source worktree",
  ]) {
    if (!runbook.includes(requirement)) {
      throw new MarketplaceVerificationError(
        "MARKETPLACE_PILOT_RUNBOOK_INCOMPLETE",
        `pilot runbook is missing: ${requirement}`,
      );
    }
  }
}

function verifyCleanPlugin() {
  const deniedProxy = "http://127.0.0.1:9";
  const result = spawnSync(process.execPath, [cleanVerifier], {
    cwd: packageRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      ALL_PROXY: deniedProxy,
      HTTP_PROXY: deniedProxy,
      HTTPS_PROXY: deniedProxy,
      NO_PROXY: "",
      PROJECT_MEMORY_NETWORK: "disabled",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_offline: "true",
    },
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new MarketplaceVerificationError(
      "MARKETPLACE_CLEAN_PLUGIN_INVALID",
      result.error?.message ?? (result.stderr || result.stdout || "clean verifier failed").trim(),
    );
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = parseJson(result.stdout);
  } catch {
    throw new MarketplaceVerificationError(
      "MARKETPLACE_CLEAN_PLUGIN_INVALID",
      "clean verifier did not return JSON",
    );
  }
  const report = record(parsed);
  if (report?.valid !== true || report.network !== "disabled") {
    throw new MarketplaceVerificationError(
      "MARKETPLACE_CLEAN_PLUGIN_INVALID",
      "clean verifier did not prove a valid offline plugin",
    );
  }
  const validators = record(report.validators);
  const digest = report.logical_manifest_sha256;
  if (
    validators?.plugin !== "passed" ||
    validators.skill !== "passed" ||
    typeof digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(digest)
  ) {
    throw new MarketplaceVerificationError(
      "MARKETPLACE_CLEAN_PLUGIN_INVALID",
      "clean verifier did not return validator and logical-manifest evidence",
    );
  }
  return report;
}

async function main() {
  const repositoryReal = await assertRepositoryLayout();
  const boundInputs = await Promise.all([
    assertRegularRepositoryFile(repositoryReal, marketplacePath, "marketplace"),
    assertRegularRepositoryFile(repositoryReal, manifestPath, "plugin_manifest"),
    assertRegularRepositoryFile(repositoryReal, runbookPath, "pilot_runbook"),
    assertRegularRepositoryFile(repositoryReal, cleanVerifier, "clean_plugin_verifier"),
    assertRegularRepositoryFile(repositoryReal, typeScriptCompiler, "typescript_compiler"),
    assertRegularRepositoryFile(repositoryReal, bundleBuilder, "plugin_bundle_builder"),
  ]);
  const boundOutputs = await Promise.all([
    assertSafeOutputRoot(repositoryReal, temporaryRoot, "plugin_temporary_output"),
    assertSafeOutputRoot(repositoryReal, distRoot, "plugin_dist_output"),
  ]);
  const [marketplaceValue, manifestValue, runbook] = await Promise.all([
    readJson(marketplacePath),
    readJson(manifestPath),
    readFile(runbookPath, "utf8"),
  ]);
  const marketplace = record(marketplaceValue);
  const manifest = record(manifestValue);
  const plugins = marketplace?.plugins;
  if (
    marketplace?.name !== "project-memory" ||
    !Array.isArray(plugins) ||
    plugins.length !== 1
  ) {
    throw new MarketplaceVerificationError(
      "MARKETPLACE_DEFINITION_INVALID",
      "marketplace must contain exactly one project-memory plugin",
    );
  }
  const plugin = record(plugins[0]);
  const source = record(plugin?.source);
  const policy = record(plugin?.policy);
  if (
    plugin?.name !== "project-memory" ||
    source?.source !== "local" ||
    source.path !== "./plugins/project-memory" ||
    policy?.installation !== "AVAILABLE" ||
    policy.authentication !== "ON_INSTALL" ||
    manifest?.name !== plugin.name
  ) {
    throw new MarketplaceVerificationError(
      "MARKETPLACE_DEFINITION_INVALID",
      "marketplace source, policy, and plugin manifest must match the pinned local definition",
    );
  }
  assertPilotRunbook(runbook);
  const cleanReport = verifyCleanPlugin();
  const report = {
    schema_version: "1.0.0",
    valid: true,
    mode: "marketplace_read_only",
    repository_boundary: "realpath_pinned",
    bound_inputs: boundInputs,
    bound_outputs: boundOutputs,
    marketplace: {
      name: marketplace.name,
      plugin: {
        name: plugin.name,
        source: { source: source.source, path: source.path },
        policy: {
          installation: policy.installation,
          authentication: policy.authentication,
        },
      },
      manifest: { name: manifest.name },
    },
    clean_plugin: {
      valid: cleanReport.valid,
      network: cleanReport.network,
      logical_manifest_sha256: cleanReport.logical_manifest_sha256,
      validators: cleanReport.validators,
    },
    execution: {
      codex_cli_invoked: false,
      wrapper_codex_configuration_write_attempted: false,
      codex_configuration_changed: "not_assessed",
      repository_write_scope: [
        "plugins/project-memory/.tmp/**",
        "plugins/project-memory/dist/**",
      ],
      delegated_external_inputs: {
        boundary: "external_not_bound",
        inputs: ["process.execPath", "python", "git", "CODEX_HOME validators"],
      },
    },
    pilot: {
      status: "prepared_not_authorized",
      explicit_install_approval_required: true,
      isolated_scratch_repository_required: true,
      rollback_command: "codex plugin remove project-memory@project-memory",
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

export { assertRegularRepositoryFile, assertSafeOutputRoot };

const entry = process.argv[1];
if (
  entry !== undefined &&
  path.resolve(entry) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    const code = error instanceof MarketplaceVerificationError
      ? error.code
      : "MARKETPLACE_VERIFY_FAILED";
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${code}: ${message}\n`);
    process.exitCode = 1;
  }
}
