import { readFile, writeFile } from "node:fs/promises";

import { afterAll, describe, expect, it } from "vitest";

import {
  createNodeProjectMemoryServices,
  createRepositoryUpgradeAuthorityValidator,
} from "../../src/cli/node-composition.js";
import { canonicalJson } from "../../src/core/canonical-json.js";
import { createNodeRepositoryUpgradePlanner } from "../../src/upgrades/index.js";
import {
  cleanupSingleRepoRoots,
  cloneSeed,
  git,
} from "../governance/single-repo-seed-fixture.js";

const CONFIG = "tools/project-memory/config.json";

async function makeLegacy(root: URL): Promise<void> {
  const target = new URL(CONFIG, root);
  const config = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
  delete config.repository_contract_version;
  await writeFile(target, canonicalJson(config), "utf8");
  await git(root, ["add", "--", CONFIG]);
  await git(root, ["commit", "-m", "prepare legacy repository contract"]);
}

afterAll(cleanupSingleRepoRoots);

describe("trusted node repository upgrade apply", () => {
  it("replans, integrates, synchronizes, and does not repropose the upgrade", async () => {
    const { repo } = await cloneSeed();
    await makeLegacy(repo);
    const planned = await createNodeRepositoryUpgradePlanner().plan(repo);
    if (!planned.ok || planned.value === null) throw new Error("legacy proposal fixture failed");
    const services = createNodeProjectMemoryServices(repo);

    const applied = await services.applyUpgrade(repo, planned.value);
    if (!applied.ok) {
      throw new Error(JSON.stringify(applied));
    }
    expect(applied).toMatchObject({
      ok: true,
      value: { status: "mutation_integrated", plan_hash: planned.value.plan_hash },
    });
    const config = JSON.parse(await readFile(new URL(CONFIG, repo), "utf8")) as Record<string, unknown>;
    expect(config.repository_contract_version).toBe("1.1.0");
    expect(await git(repo, ["status", "--porcelain"])).toBe("");
    expect(await createNodeRepositoryUpgradePlanner().plan(repo)).toEqual({
      ok: true,
      value: null,
      warnings: [],
    });
    const restarted = await services.start({
      root: repo,
      brief_path: null,
      adapter_id: "adapter.codex",
    });
    expect(restarted).toMatchObject({ ok: true });
    if (!restarted.ok) return;
    expect(restarted.value.kind).not.toBe("upgrade_review_required");
  }, 30_000);

  it("rejects a changed HEAD before coordinator finalization", async () => {
    const { repo } = await cloneSeed();
    await makeLegacy(repo);
    const planned = await createNodeRepositoryUpgradePlanner().plan(repo);
    if (!planned.ok || planned.value === null) throw new Error("legacy proposal fixture failed");
    await git(repo, ["commit", "--allow-empty", "-m", "advance head"]);

    expect(await createNodeProjectMemoryServices(repo).applyUpgrade(repo, planned.value))
      .toMatchObject({
        ok: false,
        issues: [{ code: "UPGRADE_PLAN_CHANGED" }],
      });
  });

  it("allows only the exact repository upgrade path set", async () => {
    const { repo } = await cloneSeed();
    await makeLegacy(repo);
    const planned = await createNodeRepositoryUpgradePlanner().plan(repo);
    if (!planned.ok || planned.value === null) throw new Error("legacy proposal fixture failed");
    const authority = createRepositoryUpgradeAuthorityValidator(repo);

    expect(await authority.verify(repo, planned.value)).toEqual({
      ok: true,
      value: true,
      warnings: [],
    });
    expect(await authority.verify(repo, {
      ...planned.value,
      metadata: {
        ...planned.value.metadata,
        changed_paths: [...planned.value.metadata.changed_paths, "README.md"],
      },
    })).toMatchObject({
      ok: false,
      issues: [{ code: "runtime.upgrade_authority_denied" }],
    });
  }, 30_000);
});
