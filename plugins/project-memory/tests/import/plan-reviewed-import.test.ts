import { describe, expect, it, vi } from "vitest";

import { canonicalMutationPlanHash } from "../../src/contracts/canonical-mutation-plan.js";
import { failure, success } from "../../src/contracts/runtime-result.js";
import { sha256 } from "../../src/core/hash.js";
import { CommandRegistry } from "../../src/cli/command-registry.js";
import { createImportCommands } from "../../src/cli/commands/import.js";
import { executeCli } from "../../src/cli/main.js";
import { GENERATED_VIEW_PATHS } from "../../src/governance/views/generate-views.js";
import type { IntegrationCoordinator } from "../../src/governance/integration/integration-coordinator.js";
import {
  createLegacyImporter,
  planReviewedImport,
  type ReviewedImportPlanInput,
} from "../../src/import/index.js";

const ROOT = new URL("file:///fixture/");
const HEAD = "1".repeat(40);
const APPROVAL = "APR-01J00000000000000000000000";
const SOURCE = new TextEncoder().encode("# Product requirements\n\nPreserve agent context.\n");
const PATCH = new TextEncoder().encode("# Project\n\nPreserve agent context.\n");

function input(overrides: Partial<ReviewedImportPlanInput> = {}): ReviewedImportPlanInput {
  return {
    root_id: "ROOT-01J00000000000000000000000",
    target_ref: "refs/heads/main",
    expected_head: HEAD,
    profile_lock_hash: "2".repeat(64),
    proposal_hash: "3".repeat(64),
    created_by: "codex",
    created_at: "2026-07-16T10:00:00.000Z",
    expires_at: "2026-07-16T11:00:00.000Z",
    approval_ids: [APPROVAL],
    candidates: [{
      candidate_id: "candidate.prd",
      source_path: "PRD.md",
      source_bytes: new Uint8Array(SOURCE),
      expected_source_sha256: sha256(SOURCE),
      sensitivity_findings: [],
      redacted_bytes: null,
      decision: {
        candidate_id: "candidate.prd",
        disposition: "import",
        destination: {
          kind: "canonical_document_patch",
          document_path: "docs/project-memory/PROJECT.md",
          patch: {
            expected_existing_sha256: "4".repeat(64),
            replacement_bytes: PATCH,
          },
          approval_id: APPROVAL,
        },
        rationale: "Pitaji approved the reviewed product-direction patch.",
      },
    }],
    ...overrides,
  };
}

function firstCandidate(value: ReviewedImportPlanInput) {
  const candidate = value.candidates[0];
  if (candidate === undefined) throw new Error("fixture candidate missing");
  return candidate;
}

describe("reviewed import planning", () => {
  it("rejects changed source bytes and malformed rejected mappings", () => {
    const changed = input();
    firstCandidate(changed).source_bytes[0] = 0x58;
    expect(planReviewedImport(changed)).toMatchObject({
      ok: false, issues: [{ code: "IMPORT_SOURCE_HASH_MISMATCH" }],
    });

    const rejectedBase = input();
    const rejectedCandidate = firstCandidate(rejectedBase);
    const rejected = input({
      candidates: [{
        ...rejectedCandidate,
        decision: {
          ...rejectedCandidate.decision,
          disposition: "reject",
        },
      }],
    });
    expect(planReviewedImport(rejected)).toMatchObject({
      ok: false, issues: [{ code: "IMPORT_REJECTED_DESTINATION_FORBIDDEN" }],
    });
  });

  it("rejects directional changes without exact approval and duplicate destinations", () => {
    expect(planReviewedImport(input({ approval_ids: [] }))).toMatchObject({
      ok: false, issues: [{ code: "IMPORT_APPROVAL_REQUIRED" }],
    });

    const duplicateBase = input();
    const duplicateCandidate = firstCandidate(duplicateBase);
    const duplicate = input({
      candidates: [duplicateCandidate, {
        ...duplicateCandidate,
        candidate_id: "candidate.requirements",
        source_path: "REQUIREMENTS.md",
        decision: {
          ...duplicateCandidate.decision,
          candidate_id: "candidate.requirements",
        },
      }],
    });
    expect(planReviewedImport(duplicate)).toMatchObject({
      ok: false, issues: [{ code: "IMPORT_DESTINATION_DUPLICATE" }],
    });
  });

  it("requires redaction for secret findings and surfaces archive planning failure", () => {
    const secretBase = input();
    const secretCandidate = firstCandidate(secretBase);
    const secret = input({
      candidates: [{
        ...secretCandidate,
        sensitivity_findings: [{
          kind: "credential-pattern", line: 1, message: "credential",
        }],
      }],
    });
    expect(planReviewedImport(secret)).toMatchObject({
      ok: false, issues: [{ code: "IMPORT_SECRET_REDACTION_REQUIRED" }],
    });

    expect(planReviewedImport(input(), {
      plan_archive: () => failure("archive.planning_failed", "archive unavailable"),
    })).toMatchObject({
      ok: false, issues: [{ code: "archive.planning_failed" }],
    });
  });

  it("plans originals, destination, immutable report, and six-view regeneration together", () => {
    const planned = planReviewedImport(input());
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const { plan_hash: ignored, ...body } = planned.value;
    expect(ignored).toBe(canonicalMutationPlanHash(body));
    expect(planned.value.writes.map((write) => write.relative_path)).toEqual([
      `docs/project-memory/archive/imports/original/${sha256(SOURCE)}.bin`,
      "docs/project-memory/PROJECT.md",
      `docs/project-memory/governance/imports/${"3".repeat(64)}.json`,
    ]);
    expect(planned.value.metadata.required_view_paths).toEqual(GENERATED_VIEW_PATHS);
    expect(planned.value.metadata.import_report_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(createLegacyImporter().plan(input())).toMatchObject({
      ok: true,
      value: { plan_hash: planned.value.plan_hash },
    });
  });

  it("recomputes import apply and calls finalizeMutation exactly once", async () => {
    const reviewed = input();
    const planned = planReviewedImport(reviewed);
    if (!planned.ok) throw new Error("fixture plan failed");
    const integration = {
      bootstrap: vi.fn(),
      finalizeMutation: vi.fn(() => Promise.resolve(success({ status: "mutation_integrated" } as never))),
      validate: vi.fn(),
      finalize: vi.fn(),
    } satisfies IntegrationCoordinator;
    const planner = { plan: vi.fn((value: ReviewedImportPlanInput) => planReviewedImport(value)) };
    const execution = await executeCli([
      "import", "apply", "--input", "reviewed.json",
      "--expected-plan-hash", planned.value.plan_hash,
      "--expected-head", HEAD,
    ], {
      registry: new CommandRegistry(createImportCommands({
        planner,
        coordinator: integration,
        read_input: () => Promise.resolve(success(reviewed)),
      })),
      current_directory: ROOT,
    });
    expect(execution.exit_code).toBe(0);
    expect(planner.plan).toHaveBeenCalledTimes(1);
    expect(integration.finalizeMutation).toHaveBeenCalledTimes(1);
    expect("apply" in planner).toBe(false);
  });

  it("forbids the incomplete generic canonical-record writer", () => {
    const base = input();
    const candidate = firstCandidate(base);
    expect(planReviewedImport(input({
      candidates: [{
        ...candidate,
        decision: {
          ...candidate.decision,
          destination: {
            kind: "canonical_record",
            record_type: "decision",
            record_id: "DEC-01J00000000000000000000001",
            status: "accepted",
            approval_id: APPROVAL,
          },
        },
      }],
    }))).toMatchObject({
      ok: false,
      issues: [{ code: "IMPORT_GENERIC_RECORD_FORBIDDEN" }],
    });
  });
});
