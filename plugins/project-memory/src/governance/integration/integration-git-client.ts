import { fileURLToPath } from "node:url";

import {
  GitCliClient,
  type CommandResult,
  type CommandRunner,
  type GitClient,
} from "../../index.js";

const OBJECT_ID = /^[0-9a-f]{40}$/;
const FORBIDDEN_REF_CHARACTERS = new Set(["~", "^", ":", "?", "*", "[", "\\"]);

export interface IntegrationGitClient extends GitClient {
  resolveRef(repo: URL, ref: string): Promise<string>;
  commitParents(repo: URL, revision: string): Promise<readonly string[]>;
  listTree(repo: URL, revision: string, pathspec: string): Promise<readonly string[]>;
  readBlob(repo: URL, revision: string, relativePath: string): Promise<Uint8Array | null>;
  listCommits(repo: URL, base: string, head: string): Promise<readonly string[]>;
  cherryPickNoCommit(worktree: URL, commit: string): Promise<CommandResult>;
  stageAll(worktree: URL): Promise<void>;
  writeTree(worktree: URL): Promise<string>;
  commitTree(repo: URL, tree: string, parent: string, message: string): Promise<string>;
  updateRef(repo: URL, ref: string, next: string, expected: string): Promise<boolean>;
}

function gitEnvironment(): Readonly<Record<string, string>> {
  const result: Record<string, string> = {
    GIT_MERGE_AUTOEDIT: "no",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
  for (const name of ["PATH", "SystemRoot", "HOME", "USERPROFILE"]) {
    const value = process.env[name];
    if (value !== undefined) result[name] = value;
  }
  return result;
}

function assertObjectId(value: string): void {
  if (!OBJECT_ID.test(value)) throw new TypeError(`unsafe Git object ID: ${value}`);
}

function assertRef(value: string): void {
  let unsafeCharacter = false;
  for (const character of value) {
    if (
      character.charCodeAt(0) <= 0x20 ||
      FORBIDDEN_REF_CHARACTERS.has(character)
    ) {
      unsafeCharacter = true;
      break;
    }
  }
  if (
    !value.startsWith("refs/") ||
    value.length > 512 ||
    unsafeCharacter ||
    value.includes("..") ||
    value.includes("@{") ||
    value.includes("//") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.endsWith(".lock")
  ) {
    throw new TypeError(`unsafe Git ref: ${value}`);
  }
}

function assertPathspec(value: string): void {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.startsWith(":") ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").some((part) => part === "..")
  ) {
    throw new TypeError(`unsafe Git pathspec: ${value}`);
  }
}

function assertMessage(value: string): void {
  if (value.trim().length === 0 || value.includes("\0")) {
    throw new TypeError("Git commit message must be non-empty and NUL-free");
  }
}

function records(value: string): readonly string[] {
  const parts = value.split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

export class IntegrationGitCliClient extends GitCliClient implements IntegrationGitClient {
  constructor(private readonly integrationRunner: CommandRunner) {
    super(integrationRunner);
  }

  async #execute(
    cwd: URL,
    args: readonly string[],
    maxOutputBytes = 4_194_304,
  ): Promise<CommandResult> {
    const result = await this.integrationRunner.run({
      executable: "git",
      args: ["-c", "core.longpaths=true", ...args],
      cwd,
      timeout_ms: 120_000,
      env_allowlist: gitEnvironment(),
      max_output_bytes: maxOutputBytes,
    });
    if (result.timed_out) throw new Error("Git command timed out");
    if (result.output_truncated) throw new Error("Git command output exceeded its bound");
    return result;
  }

  async #checked(cwd: URL, args: readonly string[]): Promise<string> {
    const result = await this.#execute(cwd, args);
    if (result.exit_code !== 0) {
      throw new Error(
        `Git command failed with exit ${String(result.exit_code)}: ${result.stderr.trim()}`,
      );
    }
    return result.stdout;
  }

  async resolveRef(repo: URL, ref: string): Promise<string> {
    assertRef(ref);
    const revision = (await this.#checked(repo, [
      "rev-parse",
      "--verify",
      `${ref}^{commit}`,
    ])).trim();
    assertObjectId(revision);
    return revision;
  }

  async commitParents(repo: URL, revision: string): Promise<readonly string[]> {
    assertObjectId(revision);
    const values = (await this.#checked(repo, [
      "rev-list",
      "--parents",
      "-n",
      "1",
      revision,
    ])).trim().split(/\s+/u);
    const commit = values.shift();
    if (commit !== revision) throw new Error("Git returned the wrong commit ancestry");
    values.forEach(assertObjectId);
    return values;
  }

  async listTree(
    repo: URL,
    revision: string,
    pathspec: string,
  ): Promise<readonly string[]> {
    assertObjectId(revision);
    assertPathspec(pathspec);
    return records(await this.#checked(repo, [
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      revision,
      "--",
      pathspec,
    ]));
  }

  async readBlob(
    repo: URL,
    revision: string,
    relativePath: string,
  ): Promise<Uint8Array | null> {
    assertObjectId(revision);
    assertPathspec(relativePath);
    const entries = await this.listTree(repo, revision, relativePath);
    if (!entries.includes(relativePath)) return null;
    const result = await this.#execute(
      repo,
      ["show", `${revision}:${relativePath}`],
      67_108_864,
    );
    if (result.exit_code !== 0) {
      throw new Error(
        `Git blob read failed with exit ${String(result.exit_code)}: ${result.stderr.trim()}`,
      );
    }
    return new TextEncoder().encode(result.stdout);
  }

  async listCommits(
    repo: URL,
    base: string,
    head: string,
  ): Promise<readonly string[]> {
    assertObjectId(base);
    assertObjectId(head);
    const output = await this.#checked(repo, ["rev-list", "--reverse", `${base}..${head}`]);
    const commits = output.split(/\r?\n/u).filter((value) => value.length > 0);
    commits.forEach(assertObjectId);
    return commits;
  }

  async cherryPickNoCommit(worktree: URL, commit: string): Promise<CommandResult> {
    assertObjectId(commit);
    return this.#execute(worktree, ["cherry-pick", "--no-commit", commit]);
  }

  async stageAll(worktree: URL): Promise<void> {
    await this.#checked(worktree, ["add", "--all", "--", "."]);
  }

  async writeTree(worktree: URL): Promise<string> {
    const tree = (await this.#checked(worktree, ["write-tree"])).trim();
    assertObjectId(tree);
    return tree;
  }

  async commitTree(
    repo: URL,
    tree: string,
    parent: string,
    message: string,
  ): Promise<string> {
    assertObjectId(tree);
    assertObjectId(parent);
    assertMessage(message);
    const commit = (await this.#checked(repo, [
      "commit-tree",
      tree,
      "-p",
      parent,
      "-m",
      message,
    ])).trim();
    assertObjectId(commit);
    return commit;
  }

  async updateRef(
    repo: URL,
    ref: string,
    next: string,
    expected: string,
  ): Promise<boolean> {
    assertRef(ref);
    assertObjectId(next);
    assertObjectId(expected);
    const result = await this.#execute(repo, ["update-ref", ref, next, expected]);
    if (result.exit_code === 0) return true;
    if (
      result.stderr.includes("cannot lock ref") ||
      result.stderr.includes("but expected")
    ) return false;
    throw new Error(
      `Git update-ref failed with exit ${String(result.exit_code)}: ${result.stderr.trim()}`,
    );
  }

  override async removeWorktree(repo: URL, destination: URL): Promise<void> {
    await this.#checked(repo, [
      "worktree",
      "remove",
      "--force",
      fileURLToPath(destination),
    ]);
  }
}
