import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { InitPlan } from "../../src/cli/init/build-init-plan.js";
import { sha256 } from "../../src/core/hash.js";
import type { LegacyImportProposal } from "../../src/import/contracts.js";
import {
  cleanupPluginWorkflow,
  preparePluginWorkflow,
  projectSnapshot,
  runLauncher,
  type PluginWorkflow,
} from "./plugin-workflow-harness.js";

const workflows: PluginWorkflow[] = [];

afterEach(async () => {
  await Promise.all(workflows.splice(0).map(cleanupPluginWorkflow));
});

describe("automatic Plugin workflow for a legacy project", () => {
  it("returns default-scanner exact hashes and performs no writes", async () => {
    const workflow = await preparePluginWorkflow("legacy");
    workflows.push(workflow);
    const before = await projectSnapshot(workflow.project_root);
    const prd = new Uint8Array(await readFile(path.join(workflow.project_root, "PRD.md")));
    const handoff = new Uint8Array(await readFile(path.join(workflow.project_root, "HANDOFF.md")));

    const started = runLauncher(workflow, [
      "agent", "start", "--root", ".", "--brief", "PRD.md", "--json",
    ]);

    expect(started.status, started.stderr || started.stdout).toBe(0);
    expect(started.envelope).toMatchObject({
      status: "review_required",
      data: {
        kind: "bootstrap_review_required",
        proposal: {
          confirmation_required: true,
          plan: {
            selection: {
              winner: { definition_id: "application.consumer-mobile" },
            },
          },
        },
        legacy_import_proposal: {
          status: "review_required",
          mappings: [
            {
              source_path: "HANDOFF.md",
              source_sha256: sha256(handoff),
              accepted: false,
              destination_kind: "view_candidate",
            },
            {
              source_path: "PRD.md",
              source_sha256: sha256(prd),
              accepted: false,
              destination_kind: "canonical_document_patch",
              destination_path: "docs/project-memory/source/PROJECT.md",
            },
          ],
        },
      },
    });
    const data = started.envelope?.data as {
      readonly proposal: { readonly plan: InitPlan };
      readonly legacy_import_proposal: LegacyImportProposal;
    };
    expect(data.legacy_import_proposal.root_id).toBe(data.proposal.plan.target_root_id);
    expect(data.legacy_import_proposal.scan_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.legacy_import_proposal.proposal_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await projectSnapshot(workflow.project_root)).toEqual(before);

    const replayed = runLauncher(workflow, [
      "agent", "start", "--root", ".", "--brief", "PRD.md", "--json",
    ]);
    expect(replayed.status, replayed.stderr || replayed.stdout).toBe(0);
    const replayedProposal = (replayed.envelope?.data as {
      readonly legacy_import_proposal: LegacyImportProposal;
    }).legacy_import_proposal;
    expect(replayedProposal).toEqual(data.legacy_import_proposal);
    expect(await projectSnapshot(workflow.project_root)).toEqual(before);
  }, 120_000);
});
