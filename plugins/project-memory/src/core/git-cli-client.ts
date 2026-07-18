import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { CommandRunner } from "../contracts/command-runner.js";
import type {
  GitClient,
  GitStatusEntry,
} from "../contracts/git-client.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { NodeCommandRunner } from "./command-runner.js";

function gitEnvironment(): Readonly<Record<string, string>> {
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
function isSafeLocalBranchRef(value: string): boolean {
  return /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value) &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !value.includes("//") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.endsWith(".lock");
}

export async function currentGitBranchRef(
  repo: URL,
  runner: CommandRunner = new NodeCommandRunner(),
): Promise<RuntimeResult<string>> {
  try {
    const result = await runner.run({
      executable: "git",
      args: ["-c", "core.longpaths=true", "symbolic-ref", "--quiet", "HEAD"],
      cwd: repo,
      timeout_ms: 30_000,
      env_allowlist: gitEnvironment(),
      max_output_bytes: 65_536,
    });
    if (result.timed_out) {
      return failure("GIT_CURRENT_BRANCH_FAILED", "Git branch lookup timed out", repo.href);
    }
    if (result.output_truncated) {
      return failure("GIT_CURRENT_BRANCH_FAILED", "Git branch lookup exceeded its output bound", repo.href);
    }
    if (result.exit_code !== 0) {
      return failure(
        "GIT_CURRENT_BRANCH_UNAVAILABLE",
        "Project Memory requires a checked-out local branch",
        repo.href,
      );
    }
    const branch = result.stdout.trim();
    return isSafeLocalBranchRef(branch)
      ? success(branch)
      : failure(
          "GIT_CURRENT_BRANCH_INVALID",
          "Git returned an unsafe checked-out branch ref",
          repo.href,
        );
  } catch (error: unknown) {
    return failure(
      "GIT_CURRENT_BRANCH_FAILED",
      error instanceof Error ? error.message : String(error),
      repo.href,
    );
  }
}

function assertRevision(value: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
    value.includes("..") ||
    value.includes("@{")
  ) {
    throw new TypeError(`unsafe Git revision: ${value}`);
  }
}

function records(value: string): readonly string[] {
  const parts = value.split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

export class GitCliClient implements GitClient {
  constructor(private readonly runner: CommandRunner) {}

  async #run(repo: URL, args: readonly string[]): Promise<string> {
    const result = await this.runner.run({
      executable: "git",
      args: ["-c", "core.longpaths=true", ...args],
      cwd: repo,
      timeout_ms: 30_000,
      env_allowlist: gitEnvironment(),
      max_output_bytes: 4_194_304,
    });
    if (result.timed_out) throw new Error("Git command timed out");
    if (result.output_truncated) throw new Error("Git command output exceeded its bound");
    if (result.exit_code !== 0) {
      throw new Error(`Git command failed with exit ${String(result.exit_code)}: ${result.stderr.trim()}`);
    }
    return result.stdout;
  }

  async head(repo: URL): Promise<string> {
    return (await this.#run(repo, ["rev-parse", "--verify", "HEAD"])).trim();
  }

  async statusPorcelain(repo: URL): Promise<readonly GitStatusEntry[]> {
    const entries = records(await this.#run(repo, ["status", "--porcelain=v1", "-z"]));
    const result: GitStatusEntry[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === undefined || entry.length < 4) {
        throw new Error("Git returned malformed porcelain status");
      }
      const indexStatus = entry[0] ?? " ";
      const worktreeStatus = entry[1] ?? " ";
      const currentPath = entry.slice(3);
      const renamed = "RC".includes(indexStatus) || "RC".includes(worktreeStatus);
      if (renamed) {
        const originalPath = entries[index + 1];
        if (originalPath === undefined) throw new Error("Git rename status is incomplete");
        index += 1;
        result.push({
          index_status: indexStatus,
          worktree_status: worktreeStatus,
          path: currentPath,
          original_path: originalPath,
        });
      } else {
        result.push({
          index_status: indexStatus,
          worktree_status: worktreeStatus,
          path: currentPath,
        });
      }
    }
    return result;
  }

  async commonGitDir(repo: URL): Promise<URL> {
    const output = (await this.#run(repo, ["rev-parse", "--git-common-dir"])).trim();
    const resolved = path.resolve(fileURLToPath(repo), output);
    return pathToFileURL(`${resolved}${path.sep}`);
  }

  async mergeBase(repo: URL, left: string, right: string): Promise<string> {
    assertRevision(left);
    assertRevision(right);
    return (await this.#run(repo, ["merge-base", left, right])).trim();
  }

  async changedPaths(
    repo: URL,
    base: string,
    head: string,
  ): Promise<readonly string[]> {
    assertRevision(base);
    assertRevision(head);
    return records(
      await this.#run(repo, ["diff", "--name-only", "-z", `${base}..${head}`, "--"]),
    );
  }

  async objectExists(repo: URL, revision: string): Promise<boolean> {
    assertRevision(revision);
    const result = await this.runner.run({
      executable: "git",
      args: ["cat-file", "-e", `${revision}^{commit}`],
      cwd: repo,
      timeout_ms: 30_000,
      env_allowlist: gitEnvironment(),
      max_output_bytes: 65_536,
    });
    if (result.exit_code === 0) return true;
    if (result.exit_code === 1 || result.exit_code === 128) return false;
    throw new Error(`Git object check failed with exit ${String(result.exit_code)}`);
  }

  async createDetachedWorktree(
    repo: URL,
    revision: string,
    destination: URL,
  ): Promise<void> {
    assertRevision(revision);
    await this.#run(repo, [
      "-c",
      "core.autocrlf=false",
      "worktree",
      "add",
      "--detach",
      fileURLToPath(destination),
      revision,
    ]);
  }

  async removeWorktree(repo: URL, destination: URL): Promise<void> {
    await this.#run(repo, ["worktree", "remove", fileURLToPath(destination)]);
  }
}

export async function ensureCleanGitRoot(
  git: GitClient,
  repo: URL,
): Promise<RuntimeResult<true>> {
  try {
    const status = await git.statusPorcelain(repo);
    return status.length === 0
      ? success(true)
      : failure("GIT_DIRTY_ROOT", "canonical repository root is not clean");
  } catch (error: unknown) {
    return failure(
      "GIT_STATUS_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
}
