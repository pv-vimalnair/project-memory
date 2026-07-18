import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "../../src/core/hash.js";
import { findSensitivity } from "../../src/import/classifiers.js";
import { createLegacyScanner } from "../../src/import/index.js";

const FIXTURE = new URL("../fixtures/legacy-repositories/minimal/", import.meta.url);
const roots: string[] = [];

async function temporaryRoot(): Promise<{ readonly path: string; readonly url: URL }> {
  const value = await mkdtemp(path.join(tmpdir(), "project-memory-legacy-"));
  roots.push(value);
  return { path: value, url: pathToFileURL(`${value}${path.sep}`) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("legacy scanner", () => {
  it("returns exact hashes, roles, sensitivity findings, provenance, and ordering", async () => {
    const scanner = createLegacyScanner({
      git_revision: () => Promise.resolve("1".repeat(40)),
    });
    const result = await scanner.scan(FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.artifacts.map((artifact) => artifact.relative_path)).toEqual([
      "PRD.md",
      "README.md",
    ]);
    const prd = result.value.artifacts[0];
    const prdBytes = new Uint8Array(await readFile(new URL("PRD.md", FIXTURE)));
    expect(prd).toMatchObject({
      sha256: sha256(prdBytes),
      byte_length: prdBytes.byteLength,
      git_revision: "1".repeat(40),
      detected_roles: ["prd"],
      sensitivity_findings: [{ kind: "personal-data" }],
    });
  });

  it("detects provider-shaped credentials without storing one in a fixture", () => {
    const providerPrefix = ["AK", "IA"].join("");
    const syntheticCredential = providerPrefix + "X".repeat(16);

    expect(findSensitivity(syntheticCredential)).toMatchObject([
      { kind: "credential-pattern" },
    ]);
  });

  it("rejects invalid UTF-8 and symlink escape without following either", async () => {
    const invalid = await temporaryRoot();
    await writeFile(path.join(invalid.path, "README.md"), new Uint8Array([0xc3, 0x28]));
    expect(await createLegacyScanner().scan(invalid.url)).toMatchObject({
      ok: false,
      issues: [{ code: "LEGACY_ENCODING_INVALID" }],
    });

    const linked = await temporaryRoot();
    const outside = await temporaryRoot();
    await mkdir(path.join(linked.path, "docs"), { recursive: true });
    const target = path.join(outside.path, "outside.md");
    await writeFile(target, "outside", "utf8");
    await symlink(target, path.join(linked.path, "docs", "escape.md"));
    expect(await createLegacyScanner().scan(linked.url)).toMatchObject({
      ok: false,
      issues: [{ code: "LEGACY_SYMLINK_ESCAPE" }],
    });
  });

  it("ignores nested Claude worktrees while retaining symlink safety elsewhere", async () => {
    const repository = await temporaryRoot();
    const outside = await temporaryRoot();
    await writeFile(path.join(repository.path, "README.md"), "# Product\n", "utf8");
    await writeFile(path.join(outside.path, "README.md"), "# Generated dependency\n", "utf8");
    const pluginDirectory = path.join(
      repository.path,
      ".claude",
      "worktrees",
      "parallel-agent",
      "linux",
      "flutter",
      "ephemeral",
      ".plugin_symlinks",
    );
    await mkdir(pluginDirectory, { recursive: true });
    await symlink(
      outside.path,
      path.join(pluginDirectory, "path_provider_linux"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const rootPluginDirectory = path.join(
      repository.path,
      "linux",
      "flutter",
      "ephemeral",
      ".plugin_symlinks",
    );
    await mkdir(rootPluginDirectory, { recursive: true });
    await symlink(
      outside.path,
      path.join(rootPluginDirectory, "app_links_linux"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = await createLegacyScanner({
      git_revision: () => Promise.resolve(null),
    }).scan(repository.url);

    expect(result).toMatchObject({
      ok: true,
      value: {
        artifacts: [{ relative_path: "README.md" }],
      },
    });
  });
});
