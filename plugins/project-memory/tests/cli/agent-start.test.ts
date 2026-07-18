import { describe, expect, it, vi } from "vitest";

import type { AgentStartDirective } from "../../src/agent/contracts.js";
import type { InitPlan } from "../../src/cli/init/build-init-plan.js";
import { success } from "../../src/contracts/runtime-result.js";
import { CommandRegistry, createDefaultCommandRegistry } from "../../src/cli/command-registry.js";
import { createAgentCommands } from "../../src/cli/commands/agent.js";
import { executeCli } from "../../src/cli/main.js";
import { parseCliArguments } from "../../src/cli/parse-args.js";

const ROOT = new URL("file:///C:/target-project/");

function bootstrapDirective(): AgentStartDirective {
  return {
    kind: "bootstrap_review_required",
    proposal: {
      confirmation_required: true,
      plan: {
        plan_hash: "1".repeat(64),
        expected_head: "2".repeat(40),
      } as InitPlan,
    },
    clarification: null,
    apply_command: ["init", "apply"],
  };
}

function harness(directive: AgentStartDirective = bootstrapDirective()) {
  const start = vi.fn(() => Promise.resolve(success(directive)));
  const commands = createAgentCommands({ start });
  const registry = new CommandRegistry(commands);
  return {
    start,
    commands,
    run: (arguments_: readonly string[]) => executeCli(arguments_, {
      registry,
      current_directory: ROOT,
    }),
  };
}

describe("agent start CLI", () => {
  it("emits exactly one JSON envelope containing the startup directive", async () => {
    const cli = harness();
    const result = await cli.run([
      "agent",
      "start",
      "--root",
      ".",
      "--brief",
      "brief.md",
      "--json",
    ]);

    expect(result.exit_code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: "1.0.0",
      command: "agent start",
      status: "success",
      data: { kind: "bootstrap_review_required" },
      issues: [],
    });
    expect(cli.start).toHaveBeenCalledTimes(1);
    expect(cli.start).toHaveBeenCalledWith({
      root: ROOT,
      brief_path: "brief.md",
      adapter_id: "adapter.codex",
    });
  });

  it("passes an explicit adapter and remains a read-only command", async () => {
    const cli = harness({
      kind: "blocked",
      issues: [],
    });
    const result = await cli.run([
      "agent",
      "start",
      "--root",
      ROOT.href,
      "--adapter",
      "adapter.claude-code",
    ]);

    expect(result.exit_code).toBe(0);
    expect(cli.commands).toMatchObject([{ path: ["agent", "start"], mutates: false }]);
    expect(cli.start).toHaveBeenCalledWith({
      root: ROOT,
      brief_path: null,
      adapter_id: "adapter.claude-code",
    });
  });

  it.each(["--apply", "--lease-id", "--profile", "--pattern"])(
    "rejects mutation or manual-selection flag %s",
    async (flag) => {
      const cli = harness();
      const result = await cli.run(["agent", "start", flag]);
      expect(result.exit_code).toBe(2);
      expect(result.envelope).toMatchObject({
        status: "failed",
        issues: [{ code: "CLI_FLAG_UNKNOWN" }],
      });
      expect(cli.start).not.toHaveBeenCalled();
    },
  );

  it("parses --adapter as a scalar and rejects duplicates", () => {
    expect(parseCliArguments([
      "agent", "start", "--root", ".", "--adapter", "adapter.codex",
    ], [["agent", "start"]])).toMatchObject({
      ok: true,
      value: { flags: { root: ".", adapter: "adapter.codex" } },
    });
    expect(parseCliArguments([
      "agent", "start", "--adapter", "adapter.codex", "--adapter", "adapter.claude-code",
    ], [["agent", "start"]])).toMatchObject({
      ok: false,
      issues: [{ code: "CLI_FLAG_DUPLICATE" }],
    });
  });

  it("appears in default help without invoking startup", async () => {
    const result = await executeCli(["--help"], {
      registry: createDefaultCommandRegistry(),
      current_directory: ROOT,
    });
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("agent start");
  });
});
