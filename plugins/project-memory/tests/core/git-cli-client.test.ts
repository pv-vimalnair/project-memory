import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NodeCommandRunner } from "../../src/core/command-runner.js";
import {
  ensureCleanGitRoot,
  GitCliClient,
} from "../../src/core/git-cli-client.js";

const execFile = promisify(execFileCallback);
let temporaryRoot = "";
let repositoryPath = "";
let repository: URL;
let firstHead = "";

async function git(args: readonly string[], cwd = repositoryPath): Promise<string> {
  const result = await execFile("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "project-memory-git-"));
  repositoryPath = path.join(temporaryRoot, "repo");
  repository = pathToFileURL(`${repositoryPath}${path.sep}`);
  await git(["init", "-b", "main", repositoryPath], temporaryRoot);
  await git(["config", "user.name", "Project Memory Test"]);
  await git(["config", "user.email", "project-memory@example.invalid"]);
  await writeFile(path.join(repositoryPath, "initial.txt"), "initial\n");
  await git(["add", "initial.txt"]);
  await git(["commit", "-m", "initial"]);
  firstHead = await git(["rev-parse", "HEAD"]);
});

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("GitCliClient", () => {
  it("reads head, status, common directory, merge base, and object existence", async () => {
    const client = new GitCliClient(new NodeCommandRunner());

    expect(await client.head(repository)).toBe(firstHead);
    expect(await client.statusPorcelain(repository)).toEqual([]);
    expect(path.resolve(fileURLToPath(await client.commonGitDir(repository)))).toBe(
      path.resolve(repositoryPath, ".git"),
    );
    expect(await client.mergeBase(repository, firstHead, firstHead)).toBe(firstHead);
    expect(await client.objectExists(repository, firstHead)).toBe(true);
    expect(await client.objectExists(repository, "f".repeat(40))).toBe(false);
  });

  it("returns literal changed and dirty paths containing shell metacharacters", async () => {
    const client = new GitCliClient(new NodeCommandRunner());
    const literalPath = "literal;a&$b.txt";
    await writeFile(path.join(repositoryPath, literalPath), "literal\n");

    const dirty = await client.statusPorcelain(repository);
    expect(dirty).toMatchObject([{ path: literalPath }]);
    expect((await ensureCleanGitRoot(client, repository)).ok).toBe(false);

    await git(["add", literalPath]);
    await git(["commit", "-m", "literal path"]);
    const secondHead = await git(["rev-parse", "HEAD"]);
    expect(await client.changedPaths(repository, firstHead, secondHead)).toEqual([
      literalPath,
    ]);
  });

  it("creates and removes a detached worktree without a shell", async () => {
    const client = new GitCliClient(new NodeCommandRunner());
    const worktreePath = path.join(temporaryRoot, "detached worktree");
    const worktree = pathToFileURL(`${worktreePath}${path.sep}`);
    await git(["config", "core.autocrlf", "true"]);

    await client.createDetachedWorktree(repository, firstHead, worktree);
    expect(await client.head(worktree)).toBe(firstHead);
    expect(await readFile(path.join(worktreePath, "initial.txt"), "utf8"))
      .toBe("initial\n");
    await client.removeWorktree(repository, worktree);
    await expect(client.head(worktree)).rejects.toThrow();
  });
});
