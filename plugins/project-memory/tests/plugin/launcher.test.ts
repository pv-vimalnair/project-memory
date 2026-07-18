import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const LAUNCHER_SOURCE = fileURLToPath(
  new URL("../../scripts/project-memory.mjs", import.meta.url),
);
const FAKE_CLI = fileURLToPath(
  new URL("../fixtures/plugin/fake-cli.mjs", import.meta.url),
);
const roots: string[] = [];

interface LauncherFixture {
  readonly root: string;
  readonly launcher: string;
  readonly repository: string;
}

async function fixture(): Promise<LauncherFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "project-memory-launcher-"));
  roots.push(root);
  const scripts = path.join(root, "scripts");
  const repository = path.join(root, "repository");
  await mkdir(path.join(root, "dist"), { recursive: true });
  await mkdir(scripts, { recursive: true });
  await mkdir(repository, { recursive: true });
  await writeFile(path.join(root, "package.json"), '{"type":"module"}' + "\n", "utf8");
  const launcher = path.join(scripts, "project-memory.mjs");
  await cp(LAUNCHER_SOURCE, launcher);
  return { root, launcher, repository };
}

async function installEntry(
  value: LauncherFixture,
  name: "project-memory.mjs" | "cli.js",
): Promise<void> {
  await cp(FAKE_CLI, path.join(value.root, "dist", name));
}

function runLauncher(value: LauncherFixture, args: readonly string[] = []) {
  return spawnSync(process.execPath, [value.launcher, ...args], {
    cwd: value.repository,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("shell-free plugin launcher", () => {
  it("prefers the release bundle when both entries exist", async () => {
    const value = await fixture();
    await installEntry(value, "project-memory.mjs");
    await installEntry(value, "cli.js");
    const result = runLauncher(value, ["agent", "start"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      entry: "project-memory.mjs",
      args: ["agent", "start"],
    });
  });

  it("falls back to the development CLI", async () => {
    const value = await fixture();
    await installEntry(value, "cli.js");
    const result = runLauncher(value, ["--help"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ entry: "cli.js", args: ["--help"] });
  });

  it("reports a stable reinstall error when no entry exists", async () => {
    const value = await fixture();
    const result = runLauncher(value);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Project Memory engine bundle is missing. Reinstall the Plugin.\n");
  });

  it("passes metacharacters as literal arguments", async () => {
    const value = await fixture();
    await installEntry(value, "project-memory.mjs");
    const result = runLauncher(value, ["agent", "start", "a;b", "$HOME", "x&y", "$(whoami)"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      entry: "project-memory.mjs",
      cwd: value.repository,
      args: ["agent", "start", "a;b", "$HOME", "x&y", "$(whoami)"],
    });
  });

  it("inherits the repository working directory", async () => {
    const value = await fixture();
    await installEntry(value, "project-memory.mjs");
    const result = runLauncher(value);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as { readonly cwd: string };
    expect(path.resolve(output.cwd)).toBe(path.resolve(value.repository));
  });

  it("propagates the engine exit code", async () => {
    const value = await fixture();
    await installEntry(value, "project-memory.mjs");
    const result = runLauncher(value, ["--exit", "7"]);
    expect(result.status).toBe(7);
  });
});
