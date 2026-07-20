import { readFile, writeFile } from "node:fs/promises";

import { afterAll, describe, expect, it } from "vitest";

import { canonicalJson } from "../../src/core/canonical-json.js";
import { createCanonicalSnapshotBuilder } from "../../src/governance/snapshot/canonical-snapshot-builder.js";
import { createRevisionTreeReader } from "../../src/governance/snapshot/revision-tree-reader.js";
import { createNodeRepositoryUpgradePlanner } from "../../src/upgrades/index.js";
import {
  cleanupSingleRepoRoots,
  cloneSeed,
  git,
  singleRepoRunner,
} from "../governance/single-repo-seed-fixture.js";

const CONFIG = "tools/project-memory/config.json";

async function setContract(
  root: URL,
  version: string | null,
): Promise<void> {
  const target = new URL(CONFIG, root);
  const config = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
  if (version === null) delete config.repository_contract_version;
  else config.repository_contract_version = version;
  await writeFile(target, canonicalJson(config), "utf8");
  await git(root, ["add", "--", CONFIG]);
  await git(root, ["commit", "-m", `set repository contract ${version ?? "legacy"}`]);
}

afterAll(cleanupSingleRepoRoots);

describe("node repository upgrade inspection", () => {
  it("returns null for the current marker", async () => {
    const { repo } = await cloneSeed();
    const planner = createNodeRepositoryUpgradePlanner(
      () => new Date("2026-07-20T12:00:00.000Z"),
    );
    expect(await planner.plan(repo)).toEqual({ ok: true, value: null, warnings: [] });
  });

  it("plans a clean pre-marker repository and replays without reading the clock", async () => {
    const { repo } = await cloneSeed();
    await setContract(repo, null);
    const planner = createNodeRepositoryUpgradePlanner(
      () => new Date("2026-07-20T12:00:00.000Z"),
    );
    const first = await planner.plan(repo);
    expect(first).toMatchObject({
      ok: true,
      value: {
        created_at: "2026-07-20T12:00:00.000Z",
        expires_at: "2026-07-20T13:00:00.000Z",
        metadata: { from_version: "1.0.0", to_version: "1.1.0" },
      },
    });
    if (!first.ok || first.value === null) return;

    const replayed = await createNodeRepositoryUpgradePlanner(() => {
      throw new Error("replay must not read the live clock");
    }).plan(repo, {
      created_at: first.value.created_at,
      expires_at: first.value.expires_at,
    });
    expect(replayed).toEqual(first);
  });

  it("rejects a dirty pre-marker repository without writing", async () => {
    const { repo } = await cloneSeed();
    await setContract(repo, null);
    await writeFile(new URL("README.md", repo), "dirty local edit\n", "utf8");
    const planner = createNodeRepositoryUpgradePlanner();
    expect(await planner.plan(repo)).toMatchObject({
      ok: false,
      issues: [{ code: "GIT_DIRTY_ROOT" }],
    });
  });

  it("rejects a future repository contract before treating it as legacy", async () => {
    const { repo } = await cloneSeed();
    await setContract(repo, "2.0.0");
    const planner = createNodeRepositoryUpgradePlanner();
    expect(await planner.plan(repo)).toMatchObject({
      ok: false,
      issues: [{
        code: "REPOSITORY_CONTRACT_UNSUPPORTED",
        references: ["1.1.0"],
      }],
    });
  });

  it("preserves canonical snapshot failures exactly", async () => {
    const { repo } = await cloneSeed();
    await setContract(repo, null);
    await git(repo, ["rm", "--", "docs/project-memory/catalog.lock.json"]);
    await git(repo, ["commit", "-m", "remove catalog lock for invalid fixture"]);
    const head = await git(repo, ["rev-parse", "HEAD"]);
    const expected = await createCanonicalSnapshotBuilder(
      createRevisionTreeReader(singleRepoRunner),
    ).build(repo, { kind: "commit", object_id: head });
    expect(expected.ok).toBe(false);

    const actual = await createNodeRepositoryUpgradePlanner().plan(repo);
    expect(actual).toEqual(expected);
  });
});
