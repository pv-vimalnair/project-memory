import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildLogicalManifest,
  validatePackageContents,
} from "../../src/release/package-contents.js";

const REQUIRED_PACKAGE_PATHS = [
  "package/package.json",
  "package/README.md",
  "package/dist/cli.js",
  "package/dist/index.js",
  "package/schemas/project-memory/v1/schema-index.json",
  "package/catalog/project-memory/v1/manifest.yaml",
  "package/templates/project-memory/PROTOCOL.md",
] as const;

describe("release package contents", () => {
  it("accepts the required runtime surface and produces a canonical logical manifest", () => {
    const validated = validatePackageContents(REQUIRED_PACKAGE_PATHS);
    expect(validated).toEqual({
      ok: true,
      value: {
        file_count: REQUIRED_PACKAGE_PATHS.length,
        required_paths: REQUIRED_PACKAGE_PATHS,
      },
      warnings: [],
    });

    expect(buildLogicalManifest([
      { path: "z.json", length: 2, sha256: "b".repeat(64) },
      { path: "a.json", length: 1, sha256: "a".repeat(64) },
    ])).toEqual({
      schema_version: "1.0.0",
      entries: [
        { path: "a.json", length: 1, sha256: "a".repeat(64) },
        { path: "z.json", length: 2, sha256: "b".repeat(64) },
      ],
    });
  });

  it.each([
    "package/src/index.ts",
    "package/tests/fixtures/private.json",
    "package/node_modules/module/index.js",
    "package/.git/config",
    "package/.env.production",
    "package/credentials.json",
    "package/debug.log",
  ])("rejects forbidden source, fixture, secret, or transient content: %s", (forbidden) => {
    expect(validatePackageContents([...REQUIRED_PACKAGE_PATHS, forbidden])).toMatchObject({
      ok: false,
      issues: [{ code: "PACKAGE_CONTENT_FORBIDDEN", path: forbidden }],
    });
  });

  it("rejects a package missing any required runtime artifact", () => {
    expect(validatePackageContents(REQUIRED_PACKAGE_PATHS.slice(1))).toMatchObject({
      ok: false,
      issues: [{ code: "PACKAGE_CONTENT_REQUIRED_MISSING", path: "package/package.json" }],
    });
  });

  it("locks Windows and Ubuntu Node 24 CI and unsigned release commands", async () => {
    const ci = await readFile(new URL("../../../../.github/workflows/ci.yml", import.meta.url), "utf8");
    const release = await readFile(
      new URL("../../../../.github/workflows/release-candidate.yml", import.meta.url),
      "utf8",
    );
    for (const workflow of [ci, release]) {
      expect(workflow).toContain("windows-latest");
      expect(workflow).toContain("ubuntu-latest");
      expect(workflow).toContain("node-version: 24");
      expect(workflow).toContain("npm ci --ignore-scripts");
      expect(workflow).toContain("npm audit --omit=dev");
    }
    expect(ci).toContain("npm run check");
    expect(ci).toContain("node scripts/verify-generated.mjs");
    expect(ci).toContain("npm pack --dry-run");
    expect(release).toContain("node scripts/verify-package.mjs");
    expect(release).not.toMatch(/npm publish|deployment|production/i);
  });
});
