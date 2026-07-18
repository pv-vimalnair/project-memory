import { describe, expect, it } from "vitest";

import type { RuntimeIssue, RuntimeResult } from "../../src/contracts/runtime-result.js";
import { failure, success } from "../../src/contracts/runtime-result.js";
import type { CliCommand, CliContext } from "../../src/cli/command-registry.js";
import { CommandRegistry } from "../../src/cli/command-registry.js";
import { exitCodeForIssues } from "../../src/cli/exit-codes.js";
import { executeCli } from "../../src/cli/main.js";
import { parseCliArguments } from "../../src/cli/parse-args.js";

const BASE_ISSUE: RuntimeIssue = {
  code: "SCHEMA_INVALID",
  severity: "error",
  path: "input.json",
  message: "invalid",
  references: [],
};

function command<T>(
  path: readonly string[],
  run: CliCommand<T>["run"],
): CliCommand<T> {
  return { path, mutates: false, run };
}

function registryWith(
  run: (context: CliContext) => RuntimeResult<unknown> | Promise<RuntimeResult<unknown>>,
): CommandRegistry {
  return new CommandRegistry([
    command(["sample", "show"], async (context) => run(context)),
  ]);
}

describe("CLI argument parsing", () => {
  it("parses subcommands, supported flags, and trailing positionals", () => {
    const parsed = parseCliArguments(
      [
        "sample",
        "show",
        "record-1",
        "--root",
        "C:/repo",
        "--input=input.json",
        "--output",
        "report.json",
        "--json",
        "--dry-run",
      ],
      [["sample", "show"]],
    );

    expect(parsed).toEqual({
      ok: true,
      value: {
        command_path: ["sample", "show"],
        flags: {
          root: "C:/repo",
          input: "input.json",
          output: "report.json",
          json: true,
          "dry-run": true,
        },
        positionals: ["record-1"],
      },
      warnings: [],
    });
  });

  it.each([
    [["sample", "show", "--root", "one", "--root", "two"], "CLI_FLAG_DUPLICATE"],
    [["sample", "show", "--root"], "CLI_FLAG_VALUE_MISSING"],
    [["sample", "show", "--unknown"], "CLI_FLAG_UNKNOWN"],
  ] as const)("rejects invalid scalar flags %#", (arguments_, code) => {
    expect(parseCliArguments(arguments_, [["sample", "show"]])).toMatchObject({
      ok: false,
      issues: [{ code }],
    });
  });
});

describe("CLI version contract", () => {
  it("renders plain text by default and one envelope with --json", async () => {
    const registry = registryWith(() => failure("MUST_NOT_RUN", "handler ran"));
    const human = await executeCli(["--version"], { registry });
    expect(human.exit_code).toBe(0);
    expect(human.stdout).toBe("0.1.0\n");
    expect(human.stderr).toBe("");

    const json = await executeCli(["--version", "--json"], { registry });
    expect(JSON.parse(json.stdout)).toEqual({
      schema_version: "1.0.0",
      command: "version",
      status: "success",
      data: "0.1.0",
      issues: [],
    });
  });
});
describe("CLI result contract", () => {
  it("renders help without invoking a handler", async () => {
    const execution = await executeCli(["--help"], {
      registry: registryWith(() => failure("MUST_NOT_RUN", "handler ran")),
    });

    expect(execution.exit_code).toBe(0);
    expect(execution.stdout).toContain("Usage: project-memory");
    expect(execution.stdout).toContain("sample show");
    expect(execution.stderr).toBe("");
    expect(execution.envelope.status).toBe("success");
  });

  it("rejects an unknown command as input failure", async () => {
    const execution = await executeCli(["missing"], {
      registry: registryWith(() => success(null)),
    });

    expect(execution.exit_code).toBe(2);
    expect(execution.envelope).toMatchObject({
      schema_version: "1.0.0",
      command: "missing",
      status: "failed",
      data: null,
      issues: [{ code: "CLI_COMMAND_UNKNOWN" }],
    });
    expect(execution.stderr).toContain("CLI_COMMAND_UNKNOWN");
  });

  it("emits exactly one JSON envelope with no diagnostic spill", async () => {
    const execution = await executeCli(["sample", "show", "--json"], {
      registry: registryWith(() => success({ answer: 42 })),
    });

    expect(execution.exit_code).toBe(0);
    expect(execution.stderr).toBe("");
    expect(execution.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(execution.stdout)).toEqual({
      schema_version: "1.0.0",
      command: "sample show",
      status: "success",
      data: { answer: 42 },
      issues: [],
    });
  });

  it("keeps human data on stdout and diagnostics on stderr", async () => {
    const execution = await executeCli(["sample", "show"], {
      registry: registryWith(() =>
        failure("SCHEMA_INVALID", "input did not match", "input.json"),
      ),
    });

    expect(execution.stdout).toBe("project-memory sample show: failed\n");
    expect(execution.stderr).toContain("ERROR SCHEMA_INVALID input.json: input did not match");
  });

  it("returns review-required decisions as successful exit code zero", async () => {
    const execution = await executeCli(["sample", "show", "--json"], {
      registry: registryWith(() =>
        success(
          { decision: "needs-review" },
          [{ ...BASE_ISSUE, code: "SELECTION_REVIEW", severity: "review" }],
        ),
      ),
    });

    expect(execution.exit_code).toBe(0);
    expect(execution.envelope.status).toBe("review_required");
  });

  it("redacts unexpected exception details while retaining opt-in debug evidence", async () => {
    const debug: unknown[] = [];
    const execution = await executeCli(["sample", "show"], {
      registry: registryWith(() => {
        throw new Error("secret stack detail");
      }),
      record_debug_evidence: (evidence) => debug.push(evidence),
    });

    expect(execution.exit_code).toBe(5);
    expect(execution.envelope).toMatchObject({
      status: "failed",
      issues: [{ code: "CLI_UNEXPECTED", message: "Unexpected internal error" }],
    });
    expect(`${execution.stdout}${execution.stderr}`).not.toContain("secret stack detail");
    expect(debug).toHaveLength(1);
    expect(String(debug[0])).toContain("secret stack detail");
  });

  it.each([
    ["SCHEMA_INVALID", 2],
    ["APPROVAL_REQUIRED", 3],
    ["CLAIM_EXPIRED", 4],
    ["FILESYSTEM_ERROR", 5],
  ])("maps %s to exit code %i", (code, expected) => {
    expect(exitCodeForIssues([{ ...BASE_ISSUE, code }])).toBe(expected);
  });
});
