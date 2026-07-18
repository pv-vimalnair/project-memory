import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { CommandRunner, CommandSpec } from "../../src/contracts/command-runner.js";
import {
  NodeCommandRunner,
  runCommand,
} from "../../src/core/command-runner.js";

const fixtureRoot = new URL("../fixtures/commands/", import.meta.url);
const fixtureScript = fileURLToPath(new URL("echo-args.mjs", fixtureRoot));

function spec(args: readonly string[]): CommandSpec {
  return {
    executable: process.execPath,
    args,
    cwd: fixtureRoot,
    timeout_ms: 5_000,
    env_allowlist: {},
  };
}

describe("NodeCommandRunner", () => {
  it("does not interpret gate arguments through a shell", async () => {
    const result = await new NodeCommandRunner().run(
      spec([fixtureScript, "a;b", "$HOME", "x&y", "space value"]),
    );

    expect(result.exit_code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      "a;b",
      "$HOME",
      "x&y",
      "space value",
    ]);
    expect(result.stderr).toBe("");
  });

  it("terminates commands that exceed their timeout", async () => {
    const result = await new NodeCommandRunner().run({
      ...spec(["-e", "setTimeout(() => {}, 10_000)"]),
      timeout_ms: 50,
    });

    expect(result.timed_out).toBe(true);
    expect(result.exit_code).toBeNull();
  });

  it("converts an injected port rejection into a stable issue", async () => {
    const rejecting: CommandRunner = {
      run: async () => Promise.reject(new Error("spawn rejected")),
    };

    expect(await runCommand(spec([fixtureScript]), rejecting)).toMatchObject({
      ok: false,
      issues: [{ code: "COMMAND_RUNNER_FAILURE" }],
    });
  });

  it("rejects invalid specs before invoking the port", async () => {
    let invoked = false;
    const runner: CommandRunner = {
      run: () => {
        invoked = true;
        return Promise.reject(new Error("must not run"));
      },
    };

    expect(await runCommand({ ...spec([]), timeout_ms: 0 }, runner)).toMatchObject({
      ok: false,
      issues: [{ code: "COMMAND_SPEC_INVALID" }],
    });
    expect(invoked).toBe(false);
  });
});
