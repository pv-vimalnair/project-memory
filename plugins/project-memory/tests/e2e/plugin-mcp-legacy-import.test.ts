import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { normalizeGitTextBytes } from "../../src/core/document-io.js";
import { sha256 } from "../../src/core/hash.js";
import type { MutationReceipt } from "../../src/governance/integration/canonical-mutation-finalizer.js";
import { GENERATED_VIEW_PATHS } from "../../src/governance/views/generate-views.js";
import type { LegacySourceReviewDraft } from "../../src/import/contracts.js";
import {
  addGuidedLegacyDocuments,
  callPluginMcpOnce,
  cleanupPluginWorkflow,
  GUIDED_LEGACY_SOURCE_PATHS,
  preparePluginWorkflow,
  projectSnapshot,
  type PluginWorkflow,
} from "./plugin-workflow-harness.js";

const workflows: PluginWorkflow[] = [];

afterEach(async () => {
  await Promise.all(workflows.splice(0).map(cleanupPluginWorkflow));
});

interface ReviewSource {
  readonly source_path: string;
  readonly source_sha256: string;
  readonly source_git_revision: string | null;
}

interface LegacyReviewDirective {
  readonly kind: "legacy_import_review_required";
  readonly review_handle: string;
  readonly sources: readonly ReviewSource[];
}

interface LegacyPlanProposal {
  readonly operation: "legacy_import";
  readonly proposal_handle: string;
  readonly plan_hash: string;
  readonly expected_head: string;
  readonly groups: readonly {
    readonly key: string;
    readonly items: readonly unknown[];
  }[];
}

interface VerifiedLegacyImport {
  readonly status: "legacy_imported_verified";
  readonly receipt: MutationReceipt;
}

function factDrafts(sourcePath: string): LegacySourceReviewDraft["facts"] {
  if (sourcePath === "PRD.md") {
    return [{
      source_line_start: 4,
      source_line_end: 4,
      category: "current_decision",
      title: "Daily lesson mission",
      statement: "The product mission is one short daily lesson.",
      rationale: "The PRD records the accepted product mission.",
      confidence: "high",
    }];
  }
  if (sourcePath === "HANDOFF.md") {
    return [{
      source_line_start: 3,
      source_line_end: 3,
      category: "completed_work",
      title: "Product brief reviewed",
      statement: "The product brief was reviewed.",
      rationale: "The handoff explicitly records the completed review.",
      confidence: "high",
    }];
  }
  if (sourcePath === "CHANGELOG.md") {
    return [{
      source_line_start: 3,
      source_line_end: 3,
      category: "completed_work",
      title: "Offline reminder completed",
      statement: "The offline lesson reminder was completed.",
      rationale: "The changelog records the completed reminder.",
      confidence: "high",
    }];
  }
  if (sourcePath === "DECISIONS.md") {
    return [{
      source_line_start: 3,
      source_line_end: 3,
      category: "current_decision",
      title: "Repository-local memory",
      statement: "Project memory remains repository-local and offline.",
      rationale: "The decision log states the accepted storage direction.",
      confidence: "high",
    }, {
      source_line_start: 4,
      source_line_end: 4,
      category: "constraint",
      title: "No hosted-service dependency",
      statement: "The product must not require a hosted memory service.",
      rationale: "The decision log records this do-not-do constraint.",
      confidence: "high",
    }];
  }
  return [{
    source_line_start: 3,
    source_line_end: 3,
    category: "next_action",
    title: "Verify reminder experience",
    statement: "Verify the daily lesson reminder experience next.",
    rationale: "The task note records this next action.",
    confidence: "high",
  }];
}

function reviewedSources(
  sources: readonly ReviewSource[],
): readonly LegacySourceReviewDraft[] {
  return sources.map((source) => ({
    source_path: source.source_path,
    source_sha256: source.source_sha256,
    source_git_revision: source.source_git_revision,
    disposition: "import",
    rationale: "Import the useful evidence-bound project history.",
    facts: factDrafts(source.source_path),
  }));
}

async function expectSourceBytes(
  workflow: PluginWorkflow,
  expected: Readonly<Record<string, Uint8Array>>,
): Promise<void> {
  for (const relativePath of GUIDED_LEGACY_SOURCE_PATHS) {
    expect(new Uint8Array(await readFile(path.join(workflow.project_root, relativePath))))
      .toEqual(expected[relativePath]);
  }
}

describe("guided legacy history through the packaged MCP plugin", () => {
  it("bootstraps read-only, imports in separate processes, resumes, and reopens only changes", async () => {
    const workflow = await preparePluginWorkflow("legacy");
    workflows.push(workflow);
    const originalBytes = await addGuidedLegacyDocuments(workflow);
    const beforeBootstrap = await projectSnapshot(workflow.project_root);
    const processIds = new Set<number>();

    const bootstrapStart = await callPluginMcpOnce(
      workflow,
      "project_memory_start",
      { root: workflow.project_url.href, brief_path: "PRD.md" },
    );
    processIds.add(bootstrapStart.process_id);
    const bootstrapDirective = bootstrapStart.tool_result.structuredContent as {
      readonly kind: "bootstrap_review_required";
      readonly proposal_handle: string;
    };
    expect(bootstrapDirective.kind).toBe("bootstrap_review_required");
    expect(await projectSnapshot(workflow.project_root)).toEqual(beforeBootstrap);
    await expectSourceBytes(workflow, originalBytes);

    const bootstrapApply = await callPluginMcpOnce(
      workflow,
      "project_memory_apply",
      {
        mode: "bootstrap",
        proposal_handle: bootstrapDirective.proposal_handle,
        approval: { confirmed: true, granted_by: "Pitaji" },
      },
    );
    processIds.add(bootstrapApply.process_id);
    expect(bootstrapApply.tool_result.structuredContent).toMatchObject({
      status: "initialized_verified",
    });
    await expectSourceBytes(workflow, originalBytes);

    const reviewStart = await callPluginMcpOnce(
      workflow,
      "project_memory_start",
      { root: workflow.project_url.href },
    );
    processIds.add(reviewStart.process_id);
    const review = reviewStart.tool_result.structuredContent as LegacyReviewDirective;
    expect(review.kind).toBe("legacy_import_review_required");
    expect(review.sources.map((source) => source.source_path).sort()).toEqual(
      [...GUIDED_LEGACY_SOURCE_PATHS].sort(),
    );

    const planned = await callPluginMcpOnce(
      workflow,
      "project_memory_read",
      {
        mode: "legacy_import",
        review_handle: review.review_handle,
        created_by: "codex-e2e",
        sources: reviewedSources(review.sources),
      },
    );
    processIds.add(planned.process_id);
    const proposal = planned.tool_result.structuredContent as LegacyPlanProposal;
    expect(proposal.operation).toBe("legacy_import");
    expect(proposal.plan_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(proposal.expected_head).toMatch(/^[0-9a-f]{40}$/u);
    expect(proposal.groups.map((group) => group.key)).toEqual([
      "completed_work",
      "current_facts",
      "constraints",
      "next_actions",
    ]);
    expect(proposal.groups.reduce((total, group) => total + group.items.length, 0)).toBe(6);
    expect(Buffer.byteLength(JSON.stringify(planned.tool_result), "utf8"))
      .toBeLessThanOrEqual(65_536);

    const applied = await callPluginMcpOnce(
      workflow,
      "project_memory_apply",
      {
        mode: "legacy_import",
        proposal_handle: proposal.proposal_handle,
        approval: { confirmed: true, granted_by: "Pitaji" },
      },
    );
    processIds.add(applied.process_id);
    const verified = applied.tool_result.structuredContent as VerifiedLegacyImport;
    expect(verified.status).toBe("legacy_imported_verified");
    expect(verified.receipt).toMatchObject({
      status: "mutation_integrated",
      plan_hash: proposal.plan_hash,
    });
    expect(processIds.size).toBe(5);
    await expectSourceBytes(workflow, originalBytes);

    expect(Object.keys(verified.receipt.derived_view_hashes).sort()).toEqual(
      [...GENERATED_VIEW_PATHS].sort(),
    );
    for (const relativePath of GENERATED_VIEW_PATHS) {
      const bytes = normalizeGitTextBytes(new Uint8Array(await readFile(
        path.join(workflow.project_root, ...relativePath.split("/")),
      )));
      expect(sha256(bytes)).toBe(verified.receipt.derived_view_hashes[relativePath]);
    }
    expect(await readFile(
      path.join(workflow.project_root, "docs", "project-memory", "views", "CHANGELOG.md"),
      "utf8",
    )).toContain("Offline reminder completed");
    const now = await readFile(
      path.join(workflow.project_root, "docs", "project-memory", "views", "NOW.md"),
      "utf8",
    );
    expect(now).toContain("Repository-local memory");
    expect(now).toContain("Verify reminder experience");

    const reports = await readdir(path.join(
      workflow.project_root,
      "docs", "project-memory", "governance", "imports",
    ));
    expect(reports).toHaveLength(1);
    const report = JSON.parse(await readFile(path.join(
      workflow.project_root,
      "docs", "project-memory", "governance", "imports", reports[0] ?? "",
    ), "utf8")) as {
      readonly candidates: readonly { readonly disposition: string }[];
      readonly effects: { readonly imported_fact_record_ids: readonly string[] };
    };
    expect(report.candidates).toHaveLength(5);
    expect(report.candidates.every((candidate) => candidate.disposition === "import")).toBe(true);
    expect(report.effects.imported_fact_record_ids).toHaveLength(6);

    const resumed = await callPluginMcpOnce(
      workflow,
      "project_memory_start",
      { root: workflow.project_url.href },
    );
    processIds.add(resumed.process_id);
    expect(resumed.tool_result.structuredContent).toMatchObject({ kind: "resume" });
    expect(processIds.size).toBe(6);

    await writeFile(
      path.join(workflow.project_root, "TASKS.md"),
      "# Tasks\n\n- Next: verify the daily lesson reminder experience on Android.\n",
      "utf8",
    );
    const reopened = await callPluginMcpOnce(
      workflow,
      "project_memory_start",
      { root: workflow.project_url.href },
    );
    const changed = reopened.tool_result.structuredContent as LegacyReviewDirective;
    expect(changed.kind).toBe("legacy_import_review_required");
    expect(changed.sources.map((source) => source.source_path)).toEqual(["TASKS.md"]);
    expect(changed.sources[0]?.source_sha256).not.toBe(
      sha256(originalBytes["TASKS.md"] ?? new Uint8Array()),
    );
  }, 180_000);
});
