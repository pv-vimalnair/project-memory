import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { failure, success, type RuntimeResult } from "../contracts/runtime-result.js";
import { SystemClock } from "../core/clock.js";
import { NodeCommandRunner } from "../core/command-runner.js";
import { decodeStrictUtf8, parseJsonDocument } from "../core/document-io.js";
import { resolveInside } from "../core/path-safety.js";
import { IntegrationGitCliClient } from "../governance/integration/integration-git-client.js";
import { createCanonicalSnapshotBuilder } from "../governance/snapshot/canonical-snapshot-builder.js";
import { createRevisionTreeReader } from "../governance/snapshot/revision-tree-reader.js";
import { createViewGenerator, GENERATED_VIEW_PATHS } from "../governance/views/generate-views.js";
import type { ViewDriftReport } from "../governance/views/view-drift.js";

const INDEX_PATH = "docs/project-memory/views/INDEX.json";
const DERIVED_AUDIT = /^docs\/project-memory\/governance\/integration\/(?:bootstrap\/ROOT-[0-9A-HJKMNP-TV-Z]{26}|mutations\/[0-9a-f]{64})[.]json$/u;
const REVISION = /^[0-9a-f]{40}$/;

function gitEnvironment(overrides: Readonly<Record<string, string>> = {}): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
    ...overrides,
  };
  for (const name of ["PATH", "SystemRoot", "HOME", "USERPROFILE"]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

async function embeddedSourceRevision(root: URL): Promise<RuntimeResult<string>> {
  const target = await resolveInside(root, INDEX_PATH);
  if (!target.ok) return target;
  try {
    const stat = await lstat(target.value);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure("AGENT_VIEW_INDEX_UNSAFE", "view index must be a regular file", INDEX_PATH);
    }
    const decoded = decodeStrictUtf8(new Uint8Array(await readFile(target.value)), INDEX_PATH);
    if (!decoded.ok) return decoded;
    const parsed = parseJsonDocument(decoded.value, INDEX_PATH);
    if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
      return failure("AGENT_VIEW_INDEX_INVALID", "view index metadata is invalid", INDEX_PATH);
    }
    const metadata = (parsed.value as Readonly<Record<string, unknown>>).metadata;
    const revision = typeof metadata === "object" && metadata !== null
      ? (metadata as Readonly<Record<string, unknown>>).source_revision
      : null;
    return typeof revision === "string" && REVISION.test(revision)
      ? success(revision)
      : failure("AGENT_VIEW_SOURCE_INVALID", "view index source tree is invalid", INDEX_PATH);
  } catch (error: unknown) {
    return failure(
      "AGENT_VIEW_INDEX_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      INDEX_PATH,
    );
  }
}

async function runGit(
  runner: NodeCommandRunner,
  root: URL,
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
): Promise<RuntimeResult<string>> {
  try {
    const result = await runner.run({
      executable: "git",
      args: ["-c", "core.longpaths=true", ...args],
      cwd: root,
      timeout_ms: 120_000,
      env_allowlist: environment,
      max_output_bytes: 4_194_304,
    });
    return result.exit_code === 0 && !result.timed_out && !result.output_truncated
      ? success(result.stdout.trim())
      : failure(
          "AGENT_VIEW_GIT_FAILED",
          result.stderr.trim() || "Git source-tree verification failed",
          args[0] ?? "git",
        );
  } catch (error: unknown) {
    return failure(
      "AGENT_VIEW_GIT_FAILED",
      error instanceof Error ? error.message : String(error),
      args[0] ?? "git",
    );
  }
}

async function derivedSourceTree(
  root: URL,
  runner: NodeCommandRunner,
  git: IntegrationGitCliClient,
): Promise<RuntimeResult<string>> {
  let head: string;
  let parents: readonly string[];
  let changed: readonly string[];
  try {
    head = await git.head(root);
    parents = await git.commitParents(root, head);
    changed = parents.length === 1
      ? await git.changedPaths(root, parents[0] ?? "", head)
      : [];
  } catch (error: unknown) {
    return failure(
      "AGENT_VIEW_BINDING_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      root.href,
    );
  }
  if (parents.length !== 1) {
    return failure(
      "AGENT_VIEW_HEAD_INVALID",
      "generated views require a single-parent canonical finalization commit",
      head,
    );
  }
  const audits = changed.filter((relativePath) => DERIVED_AUDIT.test(relativePath));
  if (audits.length !== 1) {
    return failure(
      "AGENT_VIEW_AUDIT_BINDING_INVALID",
      "current canonical commit must add exactly one recognized integration audit",
      head,
      audits,
    );
  }
  const temporary = await mkdtemp(path.join(tmpdir(), "project-memory-view-index-"));
  try {
    const objects = path.join(temporary, "objects");
    const index = path.join(temporary, "index");
    await mkdir(objects, { recursive: true });
    const common = await git.commonGitDir(root);
    const environment = gitEnvironment({
      GIT_INDEX_FILE: index,
      GIT_OBJECT_DIRECTORY: objects,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(fileURLToPath(common), "objects"),
    });
    const loaded = await runGit(runner, root, ["read-tree", head], environment);
    if (!loaded.ok) return loaded;
    const removed = await runGit(runner, root, [
      "rm", "--cached", "--force", "--quiet", "--ignore-unmatch", "--",
      ...GENERATED_VIEW_PATHS,
      audits[0] ?? "",
    ], environment);
    if (!removed.ok) return removed;
    const written = await runGit(runner, root, ["write-tree"], environment);
    return !written.ok
      ? written
      : REVISION.test(written.value)
        ? written
        : failure("AGENT_VIEW_SOURCE_INVALID", "derived source tree is not a Git tree ID", head);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export interface NodeViewVerifier {
  verify(root: URL): Promise<RuntimeResult<ViewDriftReport>>;
}

export function createNodeViewVerifier(): NodeViewVerifier {
  const runner = new NodeCommandRunner();
  const git = new IntegrationGitCliClient(runner);
  const snapshots = createCanonicalSnapshotBuilder(createRevisionTreeReader(runner));
  const views = createViewGenerator({
    clock: new SystemClock(),
    snapshots: {
      async current(root) {
        const embedded = await embeddedSourceRevision(root);
        if (!embedded.ok) return embedded;
        const derived = await derivedSourceTree(root, runner, git);
        if (!derived.ok) return derived;
        if (embedded.value !== derived.value) {
          return failure(
            "AGENT_VIEW_SOURCE_UNBOUND",
            "generated views do not bind the current commit's exact pre-derived source tree",
            INDEX_PATH,
            [derived.value, embedded.value],
          );
        }
        return snapshots.build(root, { kind: "tree", object_id: embedded.value });
      },
    },
  });
  return { verify: (root) => views.verify(root) };
}
