import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "../../src/core/canonical-json.js";
import { sha256 } from "../../src/core/hash.js";
import {
  runGit,
  type PluginWorkflow,
} from "../e2e/plugin-workflow-harness.js";

const CONFIG_PATH = "tools/project-memory/config.json";
const CONTEXT_PATH = "PROJECT_CONTEXT.md";
const HANDOFF_PATH = "docs/project-memory/views/HANDOFF.md";

const V1_CONTEXT_STARTUP_ORDER = Object.freeze([
  "1. `PROJECT_CONTEXT.md`",
  "2. `docs/project-memory/profile.lock.yaml`",
  "3. `docs/project-memory/views/NOW.md`",
  "4. The assigned task packet",
  "5. Named component and domain documents",
  "6. Linked canonical records",
  "7. Archive only for historical investigation",
] as const);

const V1_HANDOFF_CONTINUATION = Object.freeze([
  "1. Read `PROJECT_CONTEXT.md`.",
  "2. Read `docs/project-memory/profile.lock.yaml`.",
  "3. Read `docs/project-memory/views/NOW.md`.",
  "4. Read the assigned workstream and task packet.",
  "5. Read named component/domain documents and linked records.",
] as const);

function projection(
  source: string,
  heading: string,
  nextHeading: string,
  lines: readonly string[],
  newline: "\n" | "\r\n",
): string {
  const normalized = source.replaceAll("\r\n", "\n");
  const start = normalized.indexOf(`${heading}\n\n`);
  const end = normalized.indexOf(`\n\n${nextHeading}`, start + heading.length);
  if (start < 0 || end < 0) {
    throw new Error(`v0.1.0 projection boundary is missing: ${heading}`);
  }
  const bodyStart = start + heading.length + 2;
  const projected = normalized.slice(0, bodyStart) +
    lines.join("\n") +
    normalized.slice(end);
  return projected.replaceAll("\n", newline);
}

async function hashInventory(
  root: string,
  paths: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  return Object.fromEntries(await Promise.all(paths.map(async (relativePath) => [
    relativePath,
    sha256(new Uint8Array(await readFile(path.join(
      root,
      ...relativePath.split("/"),
    )))),
  ] as const)));
}

function trackedPaths(root: string): readonly string[] {
  return runGit(root, ["ls-files", "-z"])
    .split("\0")
    .filter((relativePath) => relativePath.length > 0)
    .sort();
}

export async function convertWorkflowToRepositoryContractV1(
  workflow: PluginWorkflow,
  newline: "\n" | "\r\n",
): Promise<{
  readonly head: string;
  readonly canonical_hashes: Readonly<Record<string, string>>;
  readonly archive_hashes: Readonly<Record<string, string>>;
}> {
  if (runGit(workflow.project_root, ["status", "--porcelain"]) !== "") {
    throw new Error("v0.1.0 fixture conversion requires a clean checkout");
  }

  const configFile = path.join(workflow.project_root, ...CONFIG_PATH.split("/"));
  const config = JSON.parse(await readFile(configFile, "utf8")) as Record<string, unknown>;
  delete config.repository_contract_version;
  await writeFile(configFile, canonicalJson(config), "utf8");

  const contextFile = path.join(workflow.project_root, CONTEXT_PATH);
  await writeFile(contextFile, projection(
    await readFile(contextFile, "utf8"),
    "## Startup Order",
    "## Agent Rule",
    V1_CONTEXT_STARTUP_ORDER,
    newline,
  ), "utf8");

  const handoffFile = path.join(workflow.project_root, ...HANDOFF_PATH.split("/"));
  await writeFile(handoffFile, projection(
    await readFile(handoffFile, "utf8"),
    "## Startup Continuation Set",
    "## Active Work",
    V1_HANDOFF_CONTINUATION,
    newline,
  ), "utf8");

  runGit(workflow.project_root, [
    "add", "--", CONFIG_PATH, CONTEXT_PATH, HANDOFF_PATH,
  ]);
  runGit(workflow.project_root, [
    "commit", "--quiet", "-m", `test: sanitize v0.1.0 ${newline === "\n" ? "lf" : "crlf"} fixture`,
  ]);
  if (runGit(workflow.project_root, ["status", "--porcelain"]) !== "") {
    throw new Error("v0.1.0 fixture conversion did not leave a clean checkout");
  }

  const tracked = trackedPaths(workflow.project_root);
  const archives = tracked.filter((relativePath) =>
    relativePath.startsWith("docs/project-memory/archive/"));
  const canonical = tracked.filter((relativePath) =>
    relativePath.startsWith("docs/project-memory/") &&
    !relativePath.startsWith("docs/project-memory/archive/") &&
    !relativePath.startsWith("docs/project-memory/views/"));
  return {
    head: runGit(workflow.project_root, ["rev-parse", "HEAD"]),
    canonical_hashes: await hashInventory(workflow.project_root, canonical),
    archive_hashes: await hashInventory(workflow.project_root, archives),
  };
}
