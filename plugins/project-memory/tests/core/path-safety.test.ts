import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { resolveInside } from "../../src/core/path-safety.js";

const fixtureRoot = new URL("../fixtures/path-safety/root/", import.meta.url);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("resolveInside", () => {
  it("resolves a valid nested repository path", async () => {
    const result = await resolveInside(fixtureRoot, "nested/inside.txt");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(fileURLToPath(result.value)).toBe(
        fileURLToPath(new URL("nested/inside.txt", fixtureRoot)),
      );
    }
  });

  it.each([
    "../outside",
    "C:\\outside",
    "/outside",
    "nested/../../outside",
    "nested\\..\\..\\outside",
  ])("rejects escape path %s", async (candidate) => {
    const result = await resolveInside(fixtureRoot, candidate);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["PATH_INVALID", "PATH_ESCAPE"]).toContain(result.issues[0]?.code);
    }
  });

  it("rejects an empty path and NUL bytes", async () => {
    for (const candidate of ["", "nested/inside\0.txt"]) {
      const result = await resolveInside(fixtureRoot, candidate);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0]?.code).toBe("PATH_INVALID");
    }
  });

  it("rejects an existing symlink ancestor that resolves outside", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "project-memory-path-"));
    temporaryRoots.push(temporaryRoot);
    const root = path.join(temporaryRoot, "root");
    const outside = path.join(temporaryRoot, "outside");
    await mkdir(root);
    await mkdir(outside);
    await symlink(outside, path.join(root, "escape"),
      process.platform === "win32" ? "junction" : "dir");

    const result = await resolveInside(
      pathToFileURL(`${root}${path.sep}`),
      "escape/new.txt",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("PATH_ESCAPE");
  });
});
