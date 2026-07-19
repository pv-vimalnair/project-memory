import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FixedClock } from "../../src/index.js";
import {
  GENERATED_VIEW_PATHS,
  createViewGenerator,
} from "../../src/governance/views/generate-views.js";
import {
  FilesystemViewTargetReader,
} from "../../src/governance/views/view-drift.js";
import {
  MutableSnapshotProvider,
  viewSnapshotFixture,
} from "./view-test-fixture.js";

let temporaryRoot = "";
let root: URL;

async function writeRelative(relativePath: string, bytes: Uint8Array): Promise<void> {
  const target = path.join(fileURLToPath(root), ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "project-memory-view-drift-"));
  root = pathToFileURL(`${temporaryRoot}${path.sep}`);
});

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

async function materializedViews(provider: MutableSnapshotProvider) {
  const generator = createViewGenerator({
    clock: new FixedClock(new Date("2026-07-14T14:00:00.000Z")),
    snapshots: provider,
    targets: new FilesystemViewTargetReader(),
  });
  const plan = generator.plan(provider.value);
  if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
  for (const write of plan.value.writes) await writeRelative(write.relative_path, write.bytes);
  return generator;
}

describe("generated view drift", () => {
  it("reports a manual edit and never repairs it", async () => {
    const provider = new MutableSnapshotProvider(viewSnapshotFixture());
    const generator = await materializedViews(provider);
    const nowPath = "docs/project-memory/views/NOW.md";
    const target = new URL(nowPath, root);
    const edited = (await readFile(target, "utf8")).replace("# Now", "# Edited by hand");
    await writeFile(target, edited, "utf8");
    const before = await readFile(target);
    const result = await generator.verify(root);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.drifted_paths).toEqual([nowPath]);
    expect(await readFile(target)).toEqual(before);
  });

  it("does not drift merely because wall-clock time advanced", async () => {
    const provider = new MutableSnapshotProvider(viewSnapshotFixture());
    const generator = await materializedViews(provider);
    const result = await generator.verify(root);
    expect(result).toMatchObject({ ok: true, value: { drifted_paths: [] } });
  });

  it("does not drift when Git materializes generated views with CRLF", async () => {
    const provider = new MutableSnapshotProvider(viewSnapshotFixture());
    const generator = await materializedViews(provider);
    for (const relativePath of GENERATED_VIEW_PATHS) {
      const target = new URL(relativePath, root);
      const content = await readFile(target, "utf8");
      await writeFile(target, content.replaceAll("\n", "\r\n"), "utf8");
    }
    const result = await generator.verify(root);
    expect(result).toMatchObject({ ok: true, value: { drifted_paths: [] } });
  });

  it("reports every stale view after canonical source changes", async () => {
    const provider = new MutableSnapshotProvider(viewSnapshotFixture());
    const generator = await materializedViews(provider);
    provider.value = {
      ...provider.value,
      source_revision: "2".repeat(40),
      source_hashes: {
        ...provider.value.source_hashes,
        "docs/project-memory/source/PROJECT.md": "e".repeat(64),
      },
    };
    const result = await generator.verify(root);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.drifted_paths).toEqual(GENERATED_VIEW_PATHS);
  });

  it("reports a missing generated view without creating it", async () => {
    const provider = new MutableSnapshotProvider(viewSnapshotFixture());
    const generator = await materializedViews(provider);
    const missingPath = "docs/project-memory/views/HANDOFF.md";
    const target = new URL(missingPath, root);
    await unlink(target);
    const result = await generator.verify(root);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.missing_paths).toEqual([missingPath]);
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
