import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { failure, success } from "../../src/contracts/runtime-result.js";
import { CommandRegistry } from "../../src/cli/command-registry.js";
import {
  CONFIG_RELATIVE_PATH,
  discoverProjectRoot,
  loadToolConfig,
} from "../../src/cli/config.js";
import {
  createDoctorCommand,
  inspectRepository,
  type DoctorDependencies,
  type DoctorViewState,
} from "../../src/cli/commands/doctor.js";
import { executeCli } from "../../src/cli/main.js";

const FIXTURE = new URL("../fixtures/e2e/configured-root/", import.meta.url);
const HEAD = "1".repeat(40);
const roots: string[] = [];
let rootPath = "";
let root: URL;

async function copyFixture(): Promise<void> {
  rootPath = await mkdtemp(path.join(tmpdir(), "project-memory-doctor-"));
  roots.push(rootPath);
  await cp(fileURLToPath(FIXTURE), rootPath, { recursive: true });
  root = pathToFileURL(`${rootPath}${path.sep}`);
}

function target(relativePath: string): string {
  return path.join(rootPath, ...relativePath.split("/"));
}

async function updateConfig(
  update: (config: Record<string, unknown>) => void,
): Promise<void> {
  const configPath = target(CONFIG_RELATIVE_PATH);
  const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  update(config);
  await writeFile(configPath, `${JSON.stringify(config)}\n`, "utf8");
}

function dependencies(
  overrides: Partial<DoctorDependencies> = {},
): DoctorDependencies {
  return {
    node_version: () => "24.14.1",
    git: () => Promise.resolve(success({ head: HEAD, repository_root: root })),
    hub: () => Promise.resolve(success(true)),
    views: () =>
      Promise.resolve(success<DoctorViewState>({ valid: true, drifted_paths: [] })),
    staging: () => Promise.resolve(success(true)),
    ...overrides,
  };
}

async function fileSnapshot(directory: string): Promise<Readonly<Record<string, string>>> {
  const snapshot: Record<string, string> = {};
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else {
        snapshot[path.relative(directory, absolute)] = (await readFile(absolute)).toString("base64");
      }
    }
  }
  await visit(directory);
  return snapshot;
}

beforeEach(copyFixture);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("repository configuration", () => {
  it("loads the strict generated tool configuration", async () => {
    const loaded = await loadToolConfig(root);
    expect(loaded).toMatchObject({
      ok: true,
      value: {
        schema_version: "1.0.0",
        root_id: "ROOT-01J01000000000000000000000",
        memory_root: "docs/project-memory",
      },
    });
  });

  it("discovers upward but never crosses a nested Git worktree boundary", async () => {
    const nested = path.join(rootPath, "one", "two");
    await mkdir(nested, { recursive: true });
    const discovered = await discoverProjectRoot(pathToFileURL(`${nested}${path.sep}`));
    expect(discovered.ok && path.resolve(fileURLToPath(discovered.value))).toBe(
      path.resolve(await realpath(rootPath)),
    );

    const isolated = path.join(rootPath, "isolated");
    const child = path.join(isolated, "child");
    await mkdir(path.join(isolated, ".git"), { recursive: true });
    await mkdir(child, { recursive: true });
    expect(await discoverProjectRoot(pathToFileURL(`${child}${path.sep}`))).toMatchObject({
      ok: false,
      issues: [{ code: "CONFIG_NOT_FOUND" }],
    });
  });
});

describe("doctor diagnostics", () => {
  it("reports every required check as passed without changing the repository", async () => {
    const before = await fileSnapshot(rootPath);
    const report = await inspectRepository(root, dependencies());

    expect(report.valid).toBe(true);
    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ["runtime", "passed"],
      ["git", "passed"],
      ["config", "passed"],
      ["schema", "passed"],
      ["project", "passed"],
      ["profile_lock", "passed"],
      ["catalog_lock", "passed"],
      ["hub", "passed"],
      ["views", "passed"],
      ["staging", "passed"],
    ]);
    expect(await fileSnapshot(rootPath)).toEqual(before);
  });

  it("reports a missing configuration", async () => {
    await unlink(target(CONFIG_RELATIVE_PATH));
    const report = await inspectRepository(root, dependencies());
    expect(report.valid).toBe(false);
    expect(report.checks.find((check) => check.id === "config")).toMatchObject({
      status: "failed",
      issue: { code: "CONFIG_MISSING" },
    });
  });

  it("rejects a project bound to a different root ID", async () => {
    await writeFile(
      target("docs/project-memory/project.yaml"),
      'schema_version: "1.0.0"\nroot:\n  id: "ROOT-01J01000000000000000000001"\n',
      "utf8",
    );
    const report = await inspectRepository(root, dependencies());
    expect(report.checks.find((check) => check.id === "project")).toMatchObject({
      status: "failed",
      issue: { code: "DOCTOR_ROOT_ID_MISMATCH" },
    });
  });

  it("reports absent Git and an unsupported Node major", async () => {
    const report = await inspectRepository(root, dependencies({
      node_version: () => "23.9.0",
      git: () => Promise.resolve(failure("GIT_NOT_FOUND", "git is unavailable")),
    }));
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "runtime", status: "failed" }),
      expect.objectContaining({ id: "git", status: "failed" }),
    ]));
  });

  it("reports a missing profile lock", async () => {
    await unlink(target("docs/project-memory/profile.lock.yaml"));
    const report = await inspectRepository(root, dependencies());
    expect(report.checks.find((check) => check.id === "profile_lock")).toMatchObject({
      status: "failed",
      issue: { code: "PROFILE_LOCK_MISSING" },
    });
  });

  it("reports stale generated views when the policy enables checking", async () => {
    await updateConfig((config) => {
      const policy = config.policy as Record<string, unknown>;
      policy.generated_view_check = true;
    });
    const report = await inspectRepository(root, dependencies({
      views: () => Promise.resolve(success({
        valid: false,
        drifted_paths: ["docs/project-memory/views/NOW.md"],
      })),
    }));
    expect(report.checks.find((check) => check.id === "views")).toMatchObject({
      status: "failed",
      issue: { code: "DOCTOR_VIEWS_STALE" },
    });
  });

  it("reports an unreachable satellite hub", async () => {
    await updateConfig((config) => {
      config.hub = { kind: "satellite", repository: "../hub" };
    });
    const report = await inspectRepository(root, dependencies({
      hub: () => Promise.resolve(failure("HUB_UNREACHABLE", "hub is unreachable")),
    }));
    expect(report.checks.find((check) => check.id === "hub")).toMatchObject({
      status: "failed",
      issue: { code: "HUB_UNREACHABLE" },
    });
  });

  it("maps failed diagnostics through the stable CLI envelope", async () => {
    const registry = new CommandRegistry([
      createDoctorCommand(dependencies({ node_version: () => "23.9.0" })),
    ]);
    const execution = await executeCli(
      ["doctor", "--root", rootPath, "--json"],
      { registry, current_directory: root },
    );

    expect(execution.exit_code).toBe(5);
    expect(execution.envelope).toMatchObject({
      command: "doctor",
      status: "failed",
      issues: [{ code: "NODE_VERSION_UNSUPPORTED" }],
    });
  });
});
