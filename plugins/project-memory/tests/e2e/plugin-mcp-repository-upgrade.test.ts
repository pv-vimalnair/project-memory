import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AGENT_READING_ORDER_PREFIX } from "../../src/agent/index.js";
import { normalizeGitTextBytes } from "../../src/core/document-io.js";
import { sha256 } from "../../src/core/hash.js";
import { GENERATED_VIEW_PATHS } from "../../src/governance/views/generate-views.js";
import { REPOSITORY_UPGRADE_RECORD_PATH } from "../../src/upgrades/index.js";
import { convertWorkflowToRepositoryContractV1 } from "../upgrades/v1-repository-fixture.js";
import {
  bootstrapPluginWorkflow,
  callPluginMcpOnce,
  cleanupPluginWorkflow,
  preparePluginWorkflow,
  projectSnapshot,
  runGit,
  type PluginWorkflow,
} from "./plugin-workflow-harness.js";

interface UpgradeDirective {
  readonly kind: "upgrade_review_required";
  readonly proposal_handle: string;
  readonly summary: {
    readonly plan_hash: string;
    readonly expected_head: string;
  };
}

interface VerifiedUpgrade {
  readonly status: "upgraded_verified";
  readonly repository_contract_version: "1.1.0";
  readonly post_upgrade_state: "resume" | "legacy_import_review_required";
  readonly receipt: {
    readonly status: "mutation_integrated";
    readonly plan_hash: string;
    readonly derived_view_hashes: Readonly<Record<string, string>>;
    readonly audit_artifact_hashes: Readonly<Record<string, string>>;
  };
}

const workflows: PluginWorkflow[] = [];

afterEach(async () => {
  await Promise.all(workflows.splice(0).map(cleanupPluginWorkflow));
}, 120_000);

async function expectInventory(
  root: string,
  inventory: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [relativePath, expected] of Object.entries(inventory)) {
    expect(sha256(new Uint8Array(await readFile(
      path.join(root, ...relativePath.split("/")),
    ))), relativePath).toBe(expected);
  }
}

function changedPaths(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): readonly string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((relativePath) => before[relativePath] !== after[relativePath])
    .sort();
}

async function expectUpgradeRoundTrip(newline: "\n" | "\r\n"): Promise<void> {
  const workflow = await preparePluginWorkflow("new");
  workflows.push(workflow);
  await bootstrapPluginWorkflow(workflow);
  const legacy = await convertWorkflowToRepositoryContractV1(workflow, newline);
  const before = await projectSnapshot(workflow.project_root);

  const started = await callPluginMcpOnce(workflow, "project_memory_start", {
    root: workflow.project_url.href,
  });
  const proposal = started.tool_result.structuredContent as UpgradeDirective;
  expect(proposal.kind).toBe("upgrade_review_required");
  expect(proposal.summary.expected_head).toBe(legacy.head);
  expect(await projectSnapshot(workflow.project_root)).toEqual(before);

  const applied = await callPluginMcpOnce(workflow, "project_memory_apply", {
    mode: "upgrade",
    proposal_handle: proposal.proposal_handle,
    approval: { confirmed: true },
  });
  const verified = applied.tool_result.structuredContent as VerifiedUpgrade;
  expect(verified).toMatchObject({
    status: "upgraded_verified",
    repository_contract_version: "1.1.0",
    receipt: {
      status: "mutation_integrated",
      plan_hash: proposal.summary.plan_hash,
    },
  });
  expect(new Set([started.process_id, applied.process_id]).size).toBe(2);

  const after = await projectSnapshot(workflow.project_root);
  const changed = changedPaths(before, after);
  const auditPaths = Object.keys(verified.receipt.audit_artifact_hashes);
  expect(auditPaths).toHaveLength(1);
  expect(auditPaths[0]).toMatch(
    /^docs\/project-memory\/governance\/integration\/mutations\/.+[.]json$/u,
  );
  expect(changed).toEqual([
    "PROJECT_CONTEXT.md",
    ...GENERATED_VIEW_PATHS,
    ...auditPaths,
    REPOSITORY_UPGRADE_RECORD_PATH,
    "tools/project-memory/config.json",
  ].sort());
  await expectInventory(workflow.project_root, legacy.canonical_hashes);
  await expectInventory(workflow.project_root, legacy.archive_hashes);

  const config = JSON.parse(await readFile(path.join(
    workflow.project_root,
    "tools", "project-memory", "config.json",
  ), "utf8")) as Readonly<Record<string, unknown>>;
  expect(config.repository_contract_version).toBe("1.1.0");
  expect((await readdir(path.join(
    workflow.project_root,
    "docs", "project-memory", "governance", "migrations",
  ))).filter((name) => name.endsWith(".json")))
    .toEqual([path.basename(REPOSITORY_UPGRADE_RECORD_PATH)]);
  for (const relativePath of GENERATED_VIEW_PATHS) {
    const bytes = normalizeGitTextBytes(new Uint8Array(await readFile(
      path.join(workflow.project_root, ...relativePath.split("/")),
    )));
    expect(sha256(bytes)).toBe(verified.receipt.derived_view_hashes[relativePath]);
  }
  expect(runGit(workflow.project_root, ["status", "--porcelain"])).toBe("");

  const resumed = await callPluginMcpOnce(workflow, "project_memory_start", {
    root: workflow.project_url.href,
  });
  expect(resumed.process_id).not.toBe(applied.process_id);
  expect(resumed.tool_result.structuredContent).toMatchObject({
    kind: "resume",
    reading_order: AGENT_READING_ORDER_PREFIX,
  });
}

describe("offline packaged repository contract upgrade", () => {
  it("preserves v1 repository truth across LF and CRLF checkouts", async () => {
    for (const newline of ["\n", "\r\n"] as const) {
      await expectUpgradeRoundTrip(newline);
    }
  }, 420_000);

  it("fails closed for dirty and unsupported repositories without partial writes", async () => {
    const workflow = await preparePluginWorkflow("new");
    workflows.push(workflow);
    await bootstrapPluginWorkflow(workflow);
    await convertWorkflowToRepositoryContractV1(workflow, "\n");
    await writeFile(path.join(workflow.project_root, "uncommitted.txt"), "dirty\n", "utf8");
    const dirtyBefore = await projectSnapshot(workflow.project_root);
    const dirty = await callPluginMcpOnce(workflow, "project_memory_start", {
      root: workflow.project_url.href,
    });
    expect(dirty.tool_result.structuredContent).toMatchObject({
      kind: "blocked",
      issues: [{ code: "GIT_DIRTY_ROOT" }],
    });
    expect(await projectSnapshot(workflow.project_root)).toEqual(dirtyBefore);

    await rm(path.join(workflow.project_root, "uncommitted.txt"));
    const configPath = path.join(
      workflow.project_root,
      "tools", "project-memory", "config.json",
    );
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    config.repository_contract_version = "9.9.9";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    runGit(workflow.project_root, [
      "add", "--", "tools/project-memory/config.json",
    ]);
    runGit(workflow.project_root, [
      "commit", "--quiet", "-m", "test: unsupported repository contract",
    ]);
    const unsupportedBefore = await projectSnapshot(workflow.project_root);
    const unsupported = await callPluginMcpOnce(workflow, "project_memory_start", {
      root: workflow.project_url.href,
    });
    expect(unsupported.tool_result.structuredContent).toMatchObject({
      kind: "blocked",
      issues: [{ code: "REPOSITORY_CONTRACT_UNSUPPORTED" }],
    });
    expect(await projectSnapshot(workflow.project_root))
      .toEqual(unsupportedBefore);
  }, 300_000);
});
