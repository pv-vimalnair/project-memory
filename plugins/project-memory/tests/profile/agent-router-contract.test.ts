import { describe, expect, it } from "vitest";

import type { PlannedWrite } from "../../src/contracts/planned-write.js";
import {
  renderAdapters,
  type TargetByteSnapshot,
} from "../../src/materialize/render-adapters.js";
import type {
  ResolvedAdapter,
  ResolvedProfile,
} from "../../src/profile/contracts/index.js";

const EXPECTED_LINKS = [
  "PROJECT_CONTEXT.md",
  "docs/project-memory/PROTOCOL.md",
  "docs/project-memory/profile.lock.yaml",
] as const;

function adapter(
  id: "adapter.codex" | "adapter.claude-code",
): ResolvedAdapter {
  const slug = id === "adapter.codex" ? "codex" : "claude-code";
  return {
    kind: "agent",
    definition_id: id,
    definition_version: "1.0.0",
    definition_target_path:
      `docs/project-memory/catalog/selected/adapters/agent/${id}.yaml`,
    definition_target_sha256: slug.padEnd(64, "0"),
  };
}

function profile(adapters: readonly ResolvedAdapter[]): ResolvedProfile {
  return {
    root: { id: "application.consumer-mobile" },
    adapters,
    gates: [],
  } as unknown as ResolvedProfile;
}

function emptySnapshot(): TargetByteSnapshot {
  return { files: new Map() };
}

function text(write: PlannedWrite | undefined): string {
  expect(write).toBeDefined();
  return new TextDecoder().decode(write?.bytes ?? new Uint8Array());
}

function router(
  adapterId: "adapter.codex" | "adapter.claude-code",
  path: "AGENTS.md" | "CLAUDE.md",
): string {
  const rendered = renderAdapters(profile([adapter(adapterId)]), emptySnapshot());
  if (!rendered.ok) throw new Error(JSON.stringify(rendered.issues));
  return text(rendered.value.find((write) => write.relative_path === path));
}

function links(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)]+)\)/g)].map(
    (match) => match[1] ?? "",
  );
}

describe("tool-neutral generated agent routers", () => {
  it.each([
    ["adapter.codex", "AGENTS.md"],
    ["adapter.claude-code", "CLAUDE.md"],
  ] as const)("keeps %s thin, generic, and grounded", (adapterId, path) => {
    const markdown = router(adapterId, path);
    expect(links(markdown)).toEqual(EXPECTED_LINKS);
    expect(markdown).toContain("assigned task packet");
    expect(markdown).toContain("completion packet");
    expect(markdown).toMatch(/worker-only/i);
    expect(markdown).toMatch(/Workers never run apply or finalize/i);
    expect(markdown).toMatch(
      /Never write canonical records, locks, or generated views directly/i,
    );
    expect(markdown).not.toMatch(/LifeOf|Dino Escape|habit|campaign|security audit/i);
    expect(markdown.split(/\r?\n/).length).toBeLessThan(55);
  });

  it("routes Codex through the installed Project Memory skill when available", () => {
    const markdown = router("adapter.codex", "AGENTS.md");
    expect(markdown).toMatch(/If the Project Memory Plugin is available/i);
    expect(markdown).toContain("`project-memory` skill");
    expect(markdown).toContain("`agent start`");
    expect(markdown).toMatch(/If the Plugin or engine is unavailable/i);
  });

  it("routes Claude through a configured bundled CLI without claiming native Plugin support", () => {
    const markdown = router("adapter.claude-code", "CLAUDE.md");
    expect(markdown).toMatch(/No native Claude Code Plugin is assumed/i);
    expect(markdown).toMatch(/configured bundled CLI/i);
    expect(markdown).toContain("`agent start`");
    expect(markdown).not.toMatch(/install (?:the )?Claude (?:Code )?Plugin/i);
  });
});
