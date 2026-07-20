import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const VERIFIER = path.join(PACKAGE_ROOT, "scripts", "verify-plugin-contents.mjs");
const INSTALL_PARENT = path.join(PACKAGE_ROOT, ".tmp", "plugin-install");
const PLUGIN_ROOT = path.join(INSTALL_PARENT, "project-memory");

describe("Project Memory Plugin MCP package", () => {
  it("declares exactly one local stdio MCP server without secrets or URLs", async () => {
    const [manifestText, mcpText] = await Promise.all([
      readFile(path.join(PACKAGE_ROOT, ".codex-plugin", "plugin.json"), "utf8"),
      readFile(path.join(PACKAGE_ROOT, ".mcp.json"), "utf8"),
    ]);
    const manifest = JSON.parse(manifestText) as Record<string, unknown>;
    const mcp = JSON.parse(mcpText) as unknown;

    expect(manifest.mcpServers).toBe("./.mcp.json");
    expect(mcp).toEqual({
      mcpServers: {
        "project-memory": {
          command: "node",
          args: ["./dist/project-memory-mcp.mjs"],
          cwd: ".",
          tool_timeout_sec: 900,
        },
      },
    });
    expect(mcpText).not.toMatch(/https?:\/\/|"(?:env|url|token|secret|password)"/i);
  });

  it("copies and smoke-tests the MCP bundle in a clean offline Plugin", async () => {
    const verification = spawnSync(process.execPath, [VERIFIER], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 180_000,
      env: { ...process.env, PROJECT_MEMORY_NETWORK: "disabled" },
    });
    expect(verification.status, verification.stderr).toBe(0);
    expect(verification.error).toBeUndefined();

    const [manifestText, reportText] = await Promise.all([
      readFile(path.join(INSTALL_PARENT, "project-memory.logical-manifest.json"), "utf8"),
      readFile(path.join(INSTALL_PARENT, "project-memory.execution-report.json"), "utf8"),
    ]);
    const manifest = JSON.parse(manifestText) as {
      readonly entries: readonly { readonly path: string }[];
    };
    const report = JSON.parse(reportText) as Record<string, unknown>;
    expect(manifest.entries.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      ".mcp.json",
      "dist/project-memory-mcp.mjs",
      "dist/project-memory-mcp.mjs.sha256",
    ]));
    expect(report.mcp).toEqual({
      initialize: "passed",
      tools: [
        "project_memory_start",
        "project_memory_read",
        "project_memory_apply",
      ],
      upgrade_approval: "confirmed_only",
      ping: "passed",
      node_modules_present: false,
    });
    expect(await readFile(path.join(PLUGIN_ROOT, ".mcp.json"), "utf8"))
      .toBe(await readFile(path.join(PACKAGE_ROOT, ".mcp.json"), "utf8"));
  }, 190_000);
});
