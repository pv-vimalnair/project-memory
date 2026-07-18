import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import * as foundation from "../../src/index.js";
import type {
  CommandResult,
  CommandRunner,
  FileTransactionReport,
  GitClient,
  RuntimeResult,
  SchemaId,
  TransactionFileSystem,
} from "../../src/index.js";

describe("RuntimeResult public boundary", () => {
  it("types exported fallible helpers as RuntimeResult", () => {
    expectTypeOf<
      ReturnType<typeof foundation.resolveInside>
    >().toEqualTypeOf<Promise<RuntimeResult<URL>>>();
    expectTypeOf<
      ReturnType<typeof foundation.readUtf8Document>
    >().toEqualTypeOf<Promise<RuntimeResult<unknown>>>();
    expectTypeOf<
      ReturnType<typeof foundation.parseJsonDocument>
    >().toEqualTypeOf<RuntimeResult<unknown>>();
    expectTypeOf<
      ReturnType<typeof foundation.parseYamlDocument>
    >().toEqualTypeOf<RuntimeResult<unknown>>();
    expectTypeOf<
      ReturnType<typeof foundation.emitGeneratedYaml>
    >().toEqualTypeOf<RuntimeResult<string>>();
    expectTypeOf<
      ReturnType<typeof foundation.emitJsonSchemas>
    >().toEqualTypeOf<Promise<RuntimeResult<readonly URL[]>>>();
    expectTypeOf<
      ReturnType<typeof foundation.runCommand>
    >().toEqualTypeOf<Promise<RuntimeResult<CommandResult>>>();
    expectTypeOf<
      ReturnType<typeof foundation.writeFileAtomic>
    >().toEqualTypeOf<Promise<RuntimeResult<FileTransactionReport>>>();
    expectTypeOf<
      ReturnType<typeof foundation.applyFileTransaction>
    >().toEqualTypeOf<Promise<RuntimeResult<FileTransactionReport>>>();
    expectTypeOf<
      ReturnType<typeof foundation.ensureCleanGitRoot>
    >().toEqualTypeOf<Promise<RuntimeResult<true>>>();

    const validation = foundation.validateWithSchema<string>(
      "project-memory/v1/not-registered",
      "value",
    );
    expectTypeOf(validation).toEqualTypeOf<RuntimeResult<string>>();
    expectTypeOf(
      foundation.registerProjectSchemas([]),
    ).toEqualTypeOf<RuntimeResult<readonly SchemaId[]>>();
  });

  it("converts injected port rejection before returning", async () => {
    const runner: CommandRunner = {
      run: () => Promise.reject(new Error("command port rejected")),
    };
    const command = await foundation.runCommand(
      {
        executable: "test",
        args: [],
        cwd: new URL("file:///virtual/"),
        timeout_ms: 100,
        env_allowlist: {},
      },
      runner,
    );
    expect(command).toMatchObject({
      ok: false,
      issues: [{ code: "COMMAND_RUNNER_FAILURE" }],
    });

    const git: GitClient = {
      head: () => Promise.reject(new Error("unused")),
      statusPorcelain: () => Promise.reject(new Error("Git port rejected")),
      commonGitDir: () => Promise.reject(new Error("unused")),
      mergeBase: () => Promise.reject(new Error("unused")),
      changedPaths: () => Promise.reject(new Error("unused")),
      objectExists: () => Promise.reject(new Error("unused")),
      createDetachedWorktree: () => Promise.reject(new Error("unused")),
      removeWorktree: () => Promise.reject(new Error("unused")),
    };
    const clean = await foundation.ensureCleanGitRoot(
      git,
      new URL("file:///virtual/"),
    );
    expect(clean).toMatchObject({
      ok: false,
      issues: [{ code: "GIT_STATUS_FAILED" }],
    });

    const rejectingFileSystem: TransactionFileSystem = {
      readFile: () => Promise.reject(new Error("unused")),
      writeFile: () => Promise.reject(new Error("unused")),
      mkdir: () => Promise.reject(new Error("unused")),
      rename: () => Promise.reject(new Error("unused")),
      remove: () => Promise.reject(new Error("unused")),
      exists: () => Promise.reject(new Error("file port rejected")),
      list: () => Promise.reject(new Error("unused")),
      syncFile: () => Promise.reject(new Error("unused")),
    };
    const transaction = await foundation.applyFileTransaction(
      new URL("file:///virtual/"),
      [],
      {
        fs: rejectingFileSystem,
        clock: { now: () => new Date("2026-07-14T12:00:00.000Z") },
        ids: { next: (prefix) => prefix + "-01J00000000000000000000000" },
      },
    );
    expect(transaction).toMatchObject({
      ok: false,
      issues: [{ code: "TRANSACTION_RECOVERY_FAILED" }],
    });
  });

  it("keeps explicit process exits out of subsystem modules", async () => {
    const sourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));
    const files = await typescriptFiles(sourceRoot);

    for (const file of files) {
      const relativePath = path.relative(sourceRoot, file).split(path.sep).join("/");
      const source = await readFile(file, "utf8");
      const ownsExplicitExit =
        relativePath === "cli.ts" ||
        relativePath === "mcp.ts" ||
        relativePath === "catalog/commands/build-tool.ts";
      if (/process\.exit(?:Code)?/.test(source)) {
        expect(ownsExplicitExit, relativePath).toBe(true);
      }
      if (relativePath === "schema/emit.ts") {
        expect(source).not.toMatch(/process\.exit(?:Code)?/);
      }
    }
  });
});

async function typescriptFiles(directory: string): Promise<readonly string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await typescriptFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      result.push(entryPath);
    }
  }
  return result;
}
