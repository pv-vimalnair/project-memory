import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { AGENT_READING_ORDER_PREFIX } from "../../src/agent/index.js";
import { createDefaultCommandRegistry } from "../../src/cli/command-registry.js";

const SKILL = new URL("../../skills/project-memory/SKILL.md", import.meta.url);
const PROTOCOL = new URL(
  "../../skills/project-memory/references/agent-protocol.md",
  import.meta.url,
);

function commandBlock(document: string): readonly string[] {
  const match = /<!-- commands:start -->\s*([\s\S]*?)\s*<!-- commands:end -->/.exec(document);
  if (match?.[1] === undefined) return [];
  return [...match[1].matchAll(/^- `([^`]+)`$/gm)].map((item) => item[1] ?? "");
}

describe("Project Memory skill command contract", () => {
  it("references only implemented command paths and includes the complete agent lifecycle", async () => {
    const [skill, protocol] = await Promise.all([
      readFile(SKILL, "utf8"),
      readFile(PROTOCOL, "utf8"),
    ]);
    const documented = commandBlock(protocol);
    const implemented = new Set(
      createDefaultCommandRegistry().paths().map((value) => value.join(" ")),
    );
    expect(documented.length).toBeGreaterThan(0);
    expect(new Set(documented).size).toBe(documented.length);
    expect(documented.filter((command) => !implemented.has(command))).toEqual([]);
    for (const required of [
      "agent start",
      "init apply",
      "claim issue plan",
      "claim issue apply",
      "claim validate",
      "completion validate",
      "integrate validate",
      "integrate finalize",
      "import plan",
      "import apply",
      "migrate plan",
      "migrate apply",
      "satellite prepare",
      "hub finalize",
    ]) {
      expect(documented).toContain(required);
    }
    expect(skill).toContain("`project_memory_start`");
    expect(skill).toContain("`project_memory_read`");
    expect(skill).toContain("`project_memory_apply`");
    expect(skill).toContain("Use the bundled MCP tools first.");
    expect(skill).toContain(
      "Use `scripts/project-memory.mjs` only when the bundled MCP server is unavailable.",
    );
    expect(skill).not.toContain("scripts/project-memory.mjs agent start");
  });

  it("locks one bootstrap confirmation and the exact startup reading prefix", async () => {
    const skill = await readFile(SKILL, "utf8");
    expect(skill).toContain("one confirmation of the complete bootstrap proposal");
    let previous = -1;
    for (const relativePath of AGENT_READING_ORDER_PREFIX) {
      const current = skill.indexOf(`\`${relativePath}\``);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
    expect(skill).toMatch(/never ask (?:Pitaji|the user) to choose (?:a )?profile/i);
    expect(skill).not.toMatch(/profile menu|choose from (?:these |a )?profiles/i);
  });

  it("keeps task inputs out of the repository initialization brief slot", async () => {
    const skill = await readFile(SKILL, "utf8");
    expect(skill).toContain("Invoke `project_memory_start` with the repository root only first.");
    expect(skill).toContain("`BRIEF.md`");
    expect(skill).toMatch(
      /Never pass a task dataset, prompt, schema, output file, or other work artifact as `brief_path`/,
    );
  });

  it("exposes lower-reasoning repository-continuity trigger vocabulary", async () => {
    const skill = await readFile(SKILL, "utf8");
    const description = /^description:\s*(.+)$/m.exec(skill)?.[1] ?? "";
    expect(description).toContain("substantive repository work");
    expect(description).toContain("repository-continuity instructions");
    expect(skill).toMatch(
      /invoke the Project Memory startup tool; never paraphrase or simulate its proposal/i,
    );
  });

  it("requires claims, completion packets, and coordinator-only finalization", async () => {
    const skill = await readFile(SKILL, "utf8");
    expect(skill).toContain("`claim issue plan`");
    expect(skill).toContain("`claim validate`");
    expect(skill).toContain("`completion validate`");
    expect(skill).toContain("`integrate validate`");
    expect(skill).toContain("`integrate finalize`");
    expect(skill).toMatch(/worker[s]? never run apply or finalize/i);
    expect(skill).toMatch(/coordinator-only/i);
    expect(skill).toMatch(/never write canonical records, locks, generated views, or history directly/i);
  });

  it("keeps discovery metadata concise and detailed fallbacks one level deep", async () => {
    const [skill, protocol] = await Promise.all([
      readFile(SKILL, "utf8"),
      readFile(PROTOCOL, "utf8"),
    ]);
    const lines = skill.split(/\r?\n/);
    expect(lines.length).toBeLessThan(500);
    const description = /^description:\s*(.+)$/m.exec(skill)?.[1] ?? "";
    expect(description).toMatch(/^Use when\b/);
    expect(skill).toContain("references/agent-protocol.md");
    expect(protocol).toContain("## Missing Plugin or engine");
    expect(protocol).toContain("## Legacy import");
    expect(protocol).toContain("## Migrations");
    expect(protocol).toContain("## Multi-repository work");
    expect(protocol).not.toMatch(/references\//);
  });
});
