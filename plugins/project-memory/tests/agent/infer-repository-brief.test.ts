import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { inferRepositoryBrief } from "../../src/agent/infer-repository-brief.js";
import { buildInitialSourceProposal } from "../../src/cli/init/build-initial-source-proposal.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<{ readonly path: string; readonly url: URL }> {
  const value = await mkdtemp(path.join(tmpdir(), "project-memory-repository-brief-"));
  roots.push(value);
  return { path: value, url: pathToFileURL(`${value}${path.sep}`) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository initialization inference", () => {
  it("derives a complete LifeOf-shaped brief without writing a YAML file", async () => {
    const repository = await temporaryRoot();
    await Promise.all([
      writeFile(path.join(repository.path, "AGENTS.md"), [
        "## Master: Pv Vimal Nair (Pitaji)",
        "",
        "- His mission: **LifeOf** \u00e2\u20ac\u201d a habit tracking + financial motivation app",
        "- His stack: Flutter, Firebase, Figma, Notion, Maestro",
        "",
      ].join("\n"), "utf8"),
      writeFile(path.join(repository.path, "pubspec.yaml"), [
        "name: lifeof",
        "description: A new Flutter project.",
        "dependencies:",
        "  flutter:",
        "    sdk: flutter",
        "  firebase_core: ^4.6.0",
        "",
      ].join("\n"), "utf8"),
      writeFile(path.join(repository.path, "firebase.json"), "{}\n", "utf8"),
      mkdir(path.join(repository.path, "android")),
      mkdir(path.join(repository.path, "ios")),
    ]);

    const result = await inferRepositoryBrief(repository.url);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.brief_path).toMatch(/^inferred:\/\/repository\//);
    expect(result.value.source_paths).toEqual([
      "AGENTS.md",
      "android",
      "firebase.json",
      "ios",
      "pubspec.yaml",
    ]);
    expect(parse(result.value.brief_text)).toMatchObject({
      name: "LifeOf",
      mission: "a habit tracking + financial motivation app",
      namespace: "lifeof",
      lifecycle: "active",
      owners: ["Pv Vimal Nair (Pitaji)"],
      runtime_adapters: [
        "adapter.android",
        "adapter.firebase",
        "adapter.flutter",
        "adapter.ios",
      ],
      workflow_adapters: [
        "adapter.figma",
        "adapter.maestro",
        "adapter.notion",
      ],
      included_scope: [expect.stringContaining("application consumer mobile")],
    });
  });

  it("uses a nested Markdown project profile as initialization evidence", async () => {
    const repository = await temporaryRoot();
    const profileDirectory = path.join(repository.path, "docs", "marketing");
    await mkdir(profileDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(profileDirectory, "PROJECT_PROFILE.md"), [
        "# LifeOf Marketing Project Profile",
        "",
        "## Ownership and verification",
        "",
        "- Project: LifeOf",
        "- Owner: Pv Vimal Nair (Pitaji)",
        "",
        "## Product and business model",
        "",
        "LifeOf is a Flutter habit-tracking and financial-motivation product. Current source connects habit completion to game-like progression.",
        "",
      ].join("\n"), "utf8"),
      writeFile(path.join(repository.path, "pubspec.yaml"), [
        "name: lifeof",
        "description: A new Flutter project.",
        "dependencies:",
        "  flutter:",
        "    sdk: flutter",
        "",
      ].join("\n"), "utf8"),
    ]);

    const result = await inferRepositoryBrief(repository.url);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source_paths).toEqual([
      "docs/marketing/PROJECT_PROFILE.md",
      "pubspec.yaml",
    ]);
    expect(parse(result.value.brief_text)).toMatchObject({
      name: "LifeOf",
      mission: "a Flutter habit-tracking and financial-motivation product",
      owners: ["Pv Vimal Nair (Pitaji)"],
      runtime_adapters: ["adapter.flutter"],
    });
  });


  it("records an empty workflow adapter set as repository evidence", async () => {
    const repository = await temporaryRoot();
    await Promise.all([
      writeFile(path.join(repository.path, "AGENTS.md"), [
        "## Master: Product Owner",
        "",
        "- His mission: **Pocket Practice** \u2014 a daily learning habit app",
        "- His stack: Flutter",
        "",
      ].join("\n"), "utf8"),
      writeFile(path.join(repository.path, "pubspec.yaml"), [
        "name: pocket_practice",
        "description: A new Flutter project.",
        "dependencies:",
        "  flutter:",
        "    sdk: flutter",
        "",
      ].join("\n"), "utf8"),
    ]);

    const inferred = await inferRepositoryBrief(repository.url);
    expect(inferred.ok).toBe(true);
    if (!inferred.ok) return;
    const proposal = buildInitialSourceProposal({
      root: repository.url,
      brief_path: inferred.value.brief_path,
      brief_text: inferred.value.brief_text,
    });

    expect(proposal).toMatchObject({
      ok: true,
      value: {
        unresolved_required_facts: [],
        facts: {
          workflow_adapters: { status: "evidenced", value: [] },
          mission: { evidence: { source_kind: "classifier" } },
        },
      },
    });
  });

  it("returns one grouped clarification when repository evidence is insufficient", async () => {
    const repository = await temporaryRoot();

    expect(await inferRepositoryBrief(repository.url)).toMatchObject({
      ok: false,
      issues: [{
        code: "AGENT_REPOSITORY_CONTEXT_REQUIRED",
        references: ["mission", "owners", "product_shape", "runtime_adapters"],
      }],
    });
  });
});
