import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BUILDER = path.join(PACKAGE_ROOT, "scripts", "build-plugin-bundle.mjs");
const LAUNCHER = path.join(PACKAGE_ROOT, "scripts", "project-memory.mjs");
const roots: string[] = [];

async function exists(value: string): Promise<boolean> {
  try {
    await stat(value);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function cleanPluginCopy(label: string): Promise<string> {
  await mkdir(path.join(PACKAGE_ROOT, ".tmp"), { recursive: true });
  const root = await mkdtemp(path.join(PACKAGE_ROOT, ".tmp", `plugin-bundle-${label}-`));
  roots.push(root);
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await mkdir(path.join(root, "dist"), { recursive: true });
  await cp(LAUNCHER, path.join(root, "scripts", "project-memory.mjs"));
  await writeFile(path.join(root, "package.json"), '{"type":"module"}\n', "utf8");
  return root;
}

function buildInto(root: string) {
  const output = path.join(root, "dist", "project-memory.mjs");
  const relative = path.relative(PACKAGE_ROOT, output).replaceAll(path.sep, "/");
  return spawnSync(process.execPath, [BUILDER, "--output", relative], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
}

function runLauncher(pluginRoot: string, repository: string, args: readonly string[]) {
  return spawnSync(
    process.execPath,
    [path.join(pluginRoot, "scripts", "project-memory.mjs"), ...args],
    {
      cwd: repository,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    },
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("self-contained plugin bundle", () => {
  it("builds both default entrypoints with sorted deterministic reports", async () => {
    const built = spawnSync(process.execPath, [BUILDER], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
    expect(built.status, built.stderr).toBe(0);

    const reports = built.stdout
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as {
        readonly output: string;
        readonly bytes: number;
        readonly sha256: string;
      });
    expect(reports.map((report) => report.output)).toEqual([
      "dist/project-memory-mcp.mjs",
      "dist/project-memory.mjs",
    ]);

    for (const report of reports) {
      const bundle = path.join(PACKAGE_ROOT, ...report.output.split("/"));
      const [bytes, hashFile] = await Promise.all([
        readFile(bundle),
        readFile(bundle + ".sha256", "utf8"),
      ]);
      const digest = createHash("sha256").update(bytes).digest("hex");
      expect(report.bytes).toBe(bytes.length);
      expect(report.sha256).toBe(digest);
      expect(hashFile).toBe(digest + "\n");
    }
  }, 30_000);
  it("builds deterministic bytes and runs without node_modules", async () => {
    const firstRoot = await cleanPluginCopy("a");
    const secondRoot = await cleanPluginCopy("b");
    const firstBuild = buildInto(firstRoot);
    const secondBuild = buildInto(secondRoot);
    expect(firstBuild.status, firstBuild.stderr).toBe(0);
    expect(secondBuild.status, secondBuild.stderr).toBe(0);

    const firstBundle = path.join(firstRoot, "dist", "project-memory.mjs");
    const secondBundle = path.join(secondRoot, "dist", "project-memory.mjs");
    const [firstBytes, secondBytes, firstHashFile, secondHashFile] = await Promise.all([
      readFile(firstBundle),
      readFile(secondBundle),
      readFile(`${firstBundle}.sha256`, "utf8"),
      readFile(`${secondBundle}.sha256`, "utf8"),
    ]);
    const digest = createHash("sha256").update(firstBytes).digest("hex");
    expect(firstBytes.equals(secondBytes)).toBe(true);
    expect(firstHashFile).toBe(`${digest}\n`);
    expect(secondHashFile).toBe(firstHashFile);
    expect(await exists(path.join(firstRoot, "node_modules"))).toBe(false);

    const repository = path.join(firstRoot, "repository");
    await mkdir(repository, { recursive: true });
    const version = runLauncher(firstRoot, repository, ["--version"]);
    expect(version.status, version.stderr).toBe(0);
    expect(version.stdout).toBe("0.1.0\n");

    const start = runLauncher(firstRoot, repository, [
      "agent", "start", "--root", repository, "--json",
    ]);
    expect(start.status, start.stderr).toBe(0);
    expect(JSON.parse(start.stdout)).toMatchObject({
      schema_version: "1.0.0",
      command: "agent start",
      data: { kind: "blocked" },
    });
    expect(await readdir(repository)).toEqual([]);
  }, 30_000);

  it("pins the reviewed builder and dependency contract", async () => {
    const packageDocument = JSON.parse(
      await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
    ) as {
      readonly scripts: Readonly<Record<string, string>>;
      readonly devDependencies: Readonly<Record<string, string>>;
    };
    expect(packageDocument.scripts["bundle:plugin"])
      .toBe("node scripts/build-plugin-bundle.mjs");
    expect(packageDocument.devDependencies.esbuild).toBe("0.28.1");
  });
});
