import { constants } from "node:fs";
import { access, lstat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  failure,
  failureFromIssues,
  runCommand,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../../index.js";
import {
  decodeStrictUtf8,
  parseJsonDocument,
  parseYamlDocument,
} from "../../core/document-io.js";
import { resolveInside } from "../../core/path-safety.js";
import { NodeCommandRunner } from "../../core/command-runner.js";
import { GENERATED_VIEW_PATHS } from "../../governance/views/generate-views.js";
import type { CliCommand } from "../command-registry.js";
import {
  CONFIG_RELATIVE_PATH,
  discoverProjectRoot,
  readToolConfigDocument,
  validateToolConfigDocument,
  type ToolConfig,
} from "../config.js";

export type DoctorCheckStatus = "passed" | "failed" | "warning";
export type DoctorCheckId =
  | "runtime"
  | "git"
  | "config"
  | "schema"
  | "project"
  | "profile_lock"
  | "catalog_lock"
  | "hub"
  | "views"
  | "staging";

export interface DoctorCheck {
  readonly id: DoctorCheckId;
  readonly status: DoctorCheckStatus;
  readonly message: string;
  readonly issue: RuntimeIssue | null;
}

export interface DoctorReport {
  readonly schema_version: "1.0.0";
  readonly root: string;
  readonly root_id: string | null;
  readonly valid: boolean;
  readonly checks: readonly DoctorCheck[];
}

export interface DoctorGitState {
  readonly head: string;
  readonly repository_root: URL;
}

export interface DoctorViewState {
  readonly valid: boolean;
  readonly drifted_paths: readonly string[];
}

export interface DoctorDependencies {
  readonly node_version: () => string;
  readonly git: (root: URL) => Promise<RuntimeResult<DoctorGitState>>;
  readonly hub: (root: URL, config: ToolConfig) => Promise<RuntimeResult<true>>;
  readonly views: (
    root: URL,
    expectedHead: string,
  ) => Promise<RuntimeResult<DoctorViewState>>;
  readonly staging: (root: URL) => Promise<RuntimeResult<true>>;
}

const PROJECT_PATH = "docs/project-memory/project.yaml";
const PROFILE_LOCK_PATH = "docs/project-memory/profile.lock.yaml";
const CATALOG_LOCK_PATH = "docs/project-memory/catalog.lock.json";
const SHA256 = /^[0-9a-f]{64}$/;

function issue(code: string, message: string, pathValue = ""): RuntimeIssue {
  return { code, severity: "error", path: pathValue, message, references: [] };
}

function passed(id: DoctorCheckId, message: string): DoctorCheck {
  return { id, status: "passed", message, issue: null };
}

function failed(id: DoctorCheckId, value: RuntimeIssue): DoctorCheck {
  return { id, status: "failed", message: value.message, issue: value };
}

function warning(id: DoctorCheckId, message: string): DoctorCheck {
  return {
    id,
    status: "warning",
    message,
    issue: { code: "DOCTOR_CHECK_SKIPPED", severity: "warning", path: id, message, references: [] },
  };
}

function fromResult<T>(
  id: DoctorCheckId,
  result: RuntimeResult<T>,
  message: string,
): DoctorCheck {
  return result.ok ? passed(id, message) : failed(id, result.issues[0] ?? issue("DOCTOR_FAILED", message, id));
}

function commandEnvironment(): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
  for (const name of ["PATH", "SystemRoot", "HOME", "USERPROFILE"]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

async function gitOutput(root: URL, args: readonly string[]): Promise<RuntimeResult<string>> {
  const result = await runCommand({
    executable: "git",
    args,
    cwd: root,
    timeout_ms: 15_000,
    env_allowlist: commandEnvironment(),
    max_output_bytes: 131_072,
  }, new NodeCommandRunner());
  if (!result.ok) return result;
  if (result.value.timed_out) return failure("GIT_TIMEOUT", "Git diagnostic timed out");
  if (result.value.output_truncated) return failure("GIT_OUTPUT_TRUNCATED", "Git diagnostic output was truncated");
  if (result.value.exit_code !== 0) {
    return failure(
      "GIT_NOT_FOUND",
      result.value.stderr.trim() || `Git exited with ${String(result.value.exit_code)}`,
    );
  }
  return success(result.value.stdout.trim());
}

async function defaultGit(root: URL): Promise<RuntimeResult<DoctorGitState>> {
  const repository = await gitOutput(root, ["rev-parse", "--show-toplevel"]);
  if (!repository.ok) return repository;
  const head = await gitOutput(root, ["rev-parse", "--verify", "HEAD"]);
  if (!head.ok) return head;
  if (!/^[0-9a-f]{40}$/.test(head.value)) {
    return failure("GIT_HEAD_INVALID", "Git HEAD was not an exact SHA-1", head.value);
  }
  return success({
    head: head.value,
    repository_root: pathToFileURL(`${path.resolve(repository.value)}${path.sep}`),
  });
}

async function defaultHub(root: URL, config: ToolConfig): Promise<RuntimeResult<true>> {
  if (config.hub.kind === "local") return success(true);
  const result = await gitOutput(root, ["ls-remote", "--exit-code", config.hub.repository, "HEAD"]);
  return result.ok
    ? success(true)
    : failure("HUB_UNREACHABLE", "configured hub repository is unreachable", config.hub.repository);
}

async function viewRevision(root: URL, relativePath: string): Promise<RuntimeResult<string>> {
  const target = await resolveInside(root, relativePath);
  if (!target.ok) return target;
  try {
    const stat = await lstat(target.value);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure("DOCTOR_VIEW_UNSAFE", "generated view must be a regular file", relativePath);
    }
    const decoded = decodeStrictUtf8(new Uint8Array(await readFile(target.value)), relativePath);
    if (!decoded.ok) return decoded;
    if (relativePath.endsWith(".json")) {
      const parsed = parseJsonDocument(decoded.value, relativePath);
      if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
        return failure("DOCTOR_VIEW_METADATA_INVALID", "view metadata is invalid", relativePath);
      }
      const metadata = (parsed.value as Record<string, unknown>).metadata;
      const revision = typeof metadata === "object" && metadata !== null
        ? (metadata as Record<string, unknown>).source_revision
        : null;
      return typeof revision === "string"
        ? success(revision)
        : failure("DOCTOR_VIEW_METADATA_INVALID", "view source revision is missing", relativePath);
    }
    const revision = /^<!-- source_revision: ([0-9a-f]{40}) -->$/m.exec(decoded.value)?.[1];
    return revision === undefined
      ? failure("DOCTOR_VIEW_METADATA_INVALID", "view source revision is missing", relativePath)
      : success(revision);
  } catch (error: unknown) {
    return failure(
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "DOCTOR_VIEW_MISSING"
        : "DOCTOR_VIEW_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
}

async function defaultViews(root: URL, expectedHead: string): Promise<RuntimeResult<DoctorViewState>> {
  const drifted: string[] = [];
  for (const relativePath of GENERATED_VIEW_PATHS) {
    const revision = await viewRevision(root, relativePath);
    if (!revision.ok) return revision;
    if (revision.value !== expectedHead) drifted.push(relativePath);
  }
  return success({ valid: drifted.length === 0, drifted_paths: drifted });
}

async function defaultStaging(): Promise<RuntimeResult<true>> {
  try {
    await access(tmpdir(), constants.W_OK);
    return success(true);
  } catch (error: unknown) {
    return failure(
      "FILESYSTEM_STAGING_UNWRITABLE",
      error instanceof Error ? error.message : String(error),
      tmpdir(),
    );
  }
}

export function createDefaultDoctorDependencies(): DoctorDependencies {
  return {
    node_version: () => process.versions.node,
    git: defaultGit,
    hub: defaultHub,
    views: defaultViews,
    staging: defaultStaging,
  };
}

async function readDocument(
  root: URL,
  relativePath: string,
  missingCode: string,
): Promise<RuntimeResult<Record<string, unknown>>> {
  const target = await resolveInside(root, relativePath);
  if (!target.ok) return target;
  try {
    const stat = await lstat(target.value);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure("DOCTOR_DOCUMENT_UNSAFE", "diagnostic target must be a regular file", relativePath);
    }
    const decoded = decodeStrictUtf8(new Uint8Array(await readFile(target.value)), relativePath);
    if (!decoded.ok) return decoded;
    const parsed = relativePath.endsWith(".json")
      ? parseJsonDocument(decoded.value, relativePath)
      : parseYamlDocument(decoded.value, relativePath);
    if (!parsed.ok) return parsed;
    return typeof parsed.value === "object" && parsed.value !== null && !Array.isArray(parsed.value)
      ? success(parsed.value as Record<string, unknown>)
      : failure("DOCTOR_DOCUMENT_INVALID", "diagnostic target must contain an object", relativePath);
  } catch (error: unknown) {
    return failure(
      (error as NodeJS.ErrnoException).code === "ENOENT" ? missingCode : "DOCTOR_DOCUMENT_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
}

function rootIdFromProject(value: Record<string, unknown>): string | null {
  const root = value.root;
  if (typeof root !== "object" || root === null) return null;
  const id = (root as Record<string, unknown>).id;
  return typeof id === "string" ? id : null;
}

function compatibleHeader(
  value: Record<string, unknown>,
  pathValue: string,
): RuntimeResult<true> {
  return value.schema_version === "1.0.0"
    ? success(true)
    : failure("SCHEMA_VERSION_UNSUPPORTED", "document schema version must be 1.0.0", pathValue);
}

export async function inspectRepository(
  root: URL,
  dependencies: DoctorDependencies = createDefaultDoctorDependencies(),
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const major = Number.parseInt(dependencies.node_version().split(".")[0] ?? "", 10);
  checks.push(major === 24
    ? passed("runtime", "Node.js major 24 is active")
    : failed("runtime", issue("NODE_VERSION_UNSUPPORTED", "Node.js major 24 is required")));

  const git = await dependencies.git(root);
  checks.push(fromResult("git", git, "Git repository and HEAD are available"));

  const configDocument = await readToolConfigDocument(root);
  checks.push(fromResult("config", configDocument, `${CONFIG_RELATIVE_PATH} is readable`));
  const config = configDocument.ok ? validateToolConfigDocument(configDocument.value) : null;
  checks.push(config === null
    ? warning("schema", "configuration schema check skipped because config is unavailable")
    : fromResult("schema", config, "tool configuration schema is compatible"));

  if (config === null || !config.ok) {
    for (const id of ["project", "profile_lock", "catalog_lock", "hub", "views"] as const) {
      checks.push(warning(id, `${id} check skipped because configuration is invalid`));
    }
  } else {
    const project = await readDocument(root, PROJECT_PATH, "PROJECT_SELECTION_MISSING");
    if (!project.ok) {
      checks.push(fromResult("project", project, "project selection is available"));
    } else {
      const header = compatibleHeader(project.value, PROJECT_PATH);
      const rootId = rootIdFromProject(project.value);
      const binding = !header.ok
        ? header
        : rootId === config.value.root_id
          ? success(true)
          : failure("DOCTOR_ROOT_ID_MISMATCH", "project selection root does not match config", PROJECT_PATH);
      checks.push(fromResult("project", binding, "project selection is bound to the configured root"));
    }

    const profile = await readDocument(root, PROFILE_LOCK_PATH, "PROFILE_LOCK_MISSING");
    if (!profile.ok) {
      checks.push(fromResult("profile_lock", profile, "profile lock is available"));
    } else {
      const header = compatibleHeader(profile.value, PROFILE_LOCK_PATH);
      const binding = !header.ok
        ? header
        : profile.value.root_id === config.value.root_id &&
            typeof profile.value.lock_hash === "string" && SHA256.test(profile.value.lock_hash)
          ? success(true)
          : failure("PROFILE_LOCK_BINDING_INVALID", "profile lock header does not bind to config", PROFILE_LOCK_PATH);
      checks.push(fromResult("profile_lock", binding, "profile lock header is valid and bound"));
    }

    const catalog = await readDocument(root, CATALOG_LOCK_PATH, "SELECTED_CATALOG_LOCK_MISSING");
    if (!catalog.ok) {
      checks.push(fromResult("catalog_lock", catalog, "catalog lock is available"));
    } else {
      const header = compatibleHeader(catalog.value, CATALOG_LOCK_PATH);
      const valid = !header.ok
        ? header
        : typeof catalog.value.lock_hash === "string" && SHA256.test(catalog.value.lock_hash)
          ? success(true)
          : failure("SELECTED_CATALOG_LOCK_INVALID", "catalog lock header is invalid", CATALOG_LOCK_PATH);
      checks.push(fromResult("catalog_lock", valid, "selected catalog lock header is valid"));
    }

    const hub = await dependencies.hub(root, config.value);
    checks.push(fromResult("hub", hub, "configured hub relationship is reachable"));

    if (!config.value.policy.generated_view_check) {
      checks.push(passed("views", "generated view check is disabled by accepted policy"));
    } else if (!git.ok) {
      checks.push(warning("views", "generated view check skipped because Git HEAD is unavailable"));
    } else {
      const views = await dependencies.views(root, git.value.head);
      const validViews = !views.ok
        ? views
        : views.value.valid
          ? success(true)
          : failure(
              "DOCTOR_VIEWS_STALE",
              "generated views do not match the current source revision",
              views.value.drifted_paths.join(","),
            );
      checks.push(fromResult("views", validViews, "generated views are current"));
    }
  }

  const staging = await dependencies.staging(root);
  checks.push(fromResult("staging", staging, "transaction staging location is writable"));
  return {
    schema_version: "1.0.0",
    root: root.href,
    root_id: config?.ok === true ? config.value.root_id : null,
    valid: checks.every((check) => check.status !== "failed"),
    checks,
  };
}

function rootFromFlag(value: string, currentDirectory: URL): RuntimeResult<URL> {
  if (currentDirectory.protocol !== "file:") {
    return failure("CLI_ROOT_INVALID", "current directory must be a file URL");
  }
  try {
    const rootPath = value.startsWith("file:")
      ? fileURLToPath(new URL(value))
      : path.resolve(fileURLToPath(currentDirectory), value);
    return success(pathToFileURL(`${rootPath}${path.sep}`));
  } catch (error: unknown) {
    return failure("CLI_ROOT_INVALID", error instanceof Error ? error.message : String(error), value);
  }
}

export function createDoctorCommand(
  dependencies: DoctorDependencies = createDefaultDoctorDependencies(),
): CliCommand<DoctorReport> {
  return {
    path: ["doctor"],
    mutates: false,
    async run(context, invocation) {
      const rootFlag = invocation.flags.root;
      const resolved = typeof rootFlag === "string"
        ? rootFromFlag(rootFlag, context.current_directory)
        : await discoverProjectRoot(context.current_directory);
      if (!resolved.ok) return resolved;
      const report = await inspectRepository(resolved.value, dependencies);
      const failures = report.checks
        .filter((check) => check.status === "failed" && check.issue !== null)
        .map((check) => check.issue as RuntimeIssue);
      if (failures.length > 0) return failureFromIssues(failures);
      const warnings = report.checks
        .filter((check) => check.status === "warning" && check.issue !== null)
        .map((check) => check.issue as RuntimeIssue);
      return success(report, warnings);
    },
  };
}
