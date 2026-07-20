import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanonicalMutationPlan } from "../../src/contracts/canonical-mutation-plan.js";
import type { InstancePrefix } from "../../src/contracts/ids.js";
import { failure, success } from "../../src/contracts/runtime-result.js";
import { canonicalJson } from "../../src/core/canonical-json.js";
import { sha256 } from "../../src/core/hash.js";
import type { IdFactory } from "../../src/core/id-factory.js";
import type {
  MutationReceipt,
  PlanAuthorityValidator,
} from "../../src/governance/integration/canonical-mutation-finalizer.js";
import type {
  GuidedLegacyImportInput,
  PendingLegacyReview,
  ReviewedImportPlan,
} from "../../src/import/contracts.js";
import { planGuidedLegacyImport } from "../../src/import/materialize-guided-import.js";
import {
  createLegacyImportAuthority,
  LegacyImportService,
  type LegacyImportServiceDependencies,
} from "../../src/host/legacy-import-service.js";
import { InMemoryProposalStore } from "../../src/host/proposal-store.js";
import {
  PROJECT_SCHEMA_REGISTRARS,
  registerProjectSchemas,
} from "../../src/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const ROOT = new URL("file:///C:/project/");
const OTHER_ROOT = new URL("file:///C:/other/");
const ROOT_ID = "ROOT-01J00000000000000000000000";
const HEAD = "1".repeat(40);
const PROFILE_HASH = "2".repeat(64);
const SOURCE_TEXT = "Completed the launch flow.\n";
const SOURCE_BYTES = new TextEncoder().encode(SOURCE_TEXT);
const SOURCE_HASH = sha256(SOURCE_BYTES);

const SCAN_BODY = {
  schema_version: "1.0.0" as const,
  root: ROOT.href,
  artifacts: [{
    relative_path: "HANDOFF.md",
    sha256: SOURCE_HASH,
    byte_length: SOURCE_BYTES.byteLength,
    git_revision: HEAD,
    detected_roles: ["handoff"] as const,
    sensitivity_findings: [],
  }],
};
const SCAN = { ...SCAN_BODY, scan_hash: sha256(canonicalJson(SCAN_BODY)) };
const PROPOSAL_BODY = {
  schema_version: "1.0.0" as const,
  root_id: ROOT_ID,
  status: "review_required" as const,
  scan_hash: SCAN.scan_hash,
  mappings: [{
    source_path: "HANDOFF.md",
    source_sha256: SOURCE_HASH,
    classification: "historical_status" as const,
    destination_kind: "view_candidate" as const,
    destination_path: null,
    accepted: false as const,
    rationale: "Review historical handoff evidence.",
  }],
};
const PENDING: PendingLegacyReview = {
  root_id: ROOT_ID,
  scan: SCAN,
  proposal: {
    ...PROPOSAL_BODY,
    proposal_hash: sha256(canonicalJson(PROPOSAL_BODY)),
  },
};
const SOURCE_REVIEW = {
  source_path: "HANDOFF.md",
  source_sha256: SOURCE_HASH,
  source_git_revision: HEAD,
  disposition: "import" as const,
  rationale: "Keep the completed launch work in project history.",
  facts: [{
    source_line_start: 1,
    source_line_end: 1,
    category: "completed_work" as const,
    title: "Launch flow completed",
    statement: "The launch flow was completed.",
    rationale: "The handoff explicitly records completion.",
    confidence: "high" as const,
  }],
};
const RECEIPT: MutationReceipt = {
  status: "mutation_integrated",
  plan_id: `import:${PENDING.proposal.proposal_hash.slice(0, 16)}`,
  plan_hash: "0".repeat(64),
  previous_revision: HEAD,
  commit_revision: "3".repeat(40),
  audit_evidence_id: "EVD-01J00000000000000000000099",
  derived_view_hashes: {},
  audit_artifact_hashes: {},
  integrated_at: "2026-07-20T04:30:00.000Z",
};

class FixedIds implements IdFactory {
  #counter = 0;

  next(prefix: InstancePrefix): string {
    this.#counter += 1;
    return `${prefix}-${String(this.#counter).padStart(26, "0")}`;
  }
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

function harness() {
  let now = new Date("2026-07-20T04:00:00.000Z");
  let sourceBytes: Uint8Array = SOURCE_BYTES;
  let context = {
    root_id: ROOT_ID,
    target_ref: "refs/heads/main",
    expected_head: HEAD,
    profile_lock_hash: PROFILE_HASH,
    catalog_version: "1.0.0",
  };
  let nextHandle = 0;
  const proposals = new InMemoryProposalStore({
    now: () => now,
    handle: () => `pm-proposal-${String(nextHandle += 1).padStart(32, "0")}`,
  });
  const dependencies: LegacyImportServiceDependencies = {
    now: () => now,
    context: vi.fn(() => Promise.resolve(success(context))),
    plan: vi.fn((_root: URL, input: GuidedLegacyImportInput) => planGuidedLegacyImport(input, {
      ids: new FixedIds(),
      read_source: () => Promise.resolve(success(new Uint8Array(sourceBytes))),
    })),
    finalize: vi.fn(async (
      root: URL,
      plan: ReviewedImportPlan,
      authority: PlanAuthorityValidator,
    ) => {
      const authorized = await authority.verify(root, plan);
      return authorized.ok
        ? success({ ...RECEIPT, plan_hash: plan.plan_hash })
        : authorized;
    }),
  };
  const service = new LegacyImportService(proposals, dependencies);
  function reviewHandle(): Promise<string> {
    const issued = proposals.issue({
      kind: "legacy_review",
      root: ROOT,
      pending: PENDING,
      expected_head: HEAD,
      profile_lock_hash: PROFILE_HASH,
    });
    if (!issued.ok) throw new Error(JSON.stringify(issued.issues));
    return Promise.resolve(issued.value.handle);
  }
  return {
    service,
    proposals,
    dependencies,
    reviewHandle,
    setNow(value: Date) { now = value; },
    setSource(value: Uint8Array) { sourceBytes = value; },
    setContext(value: typeof context) { context = value; },
    getContext() { return context; },
  };
}

async function planned(h: ReturnType<typeof harness>) {
  const result = await h.service.planLegacyImport({
    review_handle: await h.reviewHandle(),
    created_by: "codex",
    sources: [SOURCE_REVIEW],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

describe("LegacyImportService", () => {
  it("returns one bounded grouped proposal after complete exact source coverage", async () => {
    const h = harness();
    const result = await h.service.planLegacyImport({
      review_handle: await h.reviewHandle(),
      created_by: "codex",
      sources: [SOURCE_REVIEW],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        operation: "legacy_import",
        confirmation_required: true,
        root_id: ROOT_ID,
        expected_head: HEAD,
        source_count: 1,
        fact_count: 1,
        sensitivity_finding_count: 0,
        assumptions: [],
        conflicts: [],
        groups: [{
          key: "completed_work",
          items: [{
            source_path: "HANDOFF.md",
            classification: "historical_status",
            destination_record_type: "change",
            destination_status: "closed",
          }],
        }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("writes");
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(65_536);
    expect(h.dependencies.plan).toHaveBeenCalledTimes(1);

    const missing = await h.service.planLegacyImport({
      review_handle: await h.reviewHandle(),
      created_by: "codex",
      sources: [],
    });
    expect(missing).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_LEGACY_SOURCE_COVERAGE_MISMATCH" }],
    });
    const changed = await h.service.planLegacyImport({
      review_handle: await h.reviewHandle(),
      created_by: "codex",
      sources: [{ ...SOURCE_REVIEW, source_sha256: "9".repeat(64) }],
    });
    expect(changed).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_LEGACY_SOURCE_COVERAGE_MISMATCH" }],
    });
  });

  it("requires Pitaji confirmation, replans, finalizes once, and consumes only success", async () => {
    const h = harness();
    const proposal = await planned(h);

    expect(await h.service.applyLegacyImport({
      proposal_handle: proposal.proposal_handle,
      approval: { confirmed: false, granted_by: "Pitaji" },
    })).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_APPROVAL_REQUIRED" }],
    });
    expect(h.dependencies.finalize).not.toHaveBeenCalled();

    const applied = await h.service.applyLegacyImport({
      proposal_handle: proposal.proposal_handle,
      approval: { confirmed: true, granted_by: "Pitaji" },
    });
    expect(applied).toMatchObject({ ok: true, value: { status: "mutation_integrated" } });
    expect(h.dependencies.plan).toHaveBeenCalledTimes(2);
    expect(h.dependencies.finalize).toHaveBeenCalledTimes(1);
    expect(await h.service.applyLegacyImport({
      proposal_handle: proposal.proposal_handle,
      approval: { confirmed: true, granted_by: "Pitaji" },
    })).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_NOT_FOUND" }],
    });
  });

  it("retains the handle while head, profile, source, or coordinator validation fails", async () => {
    const h = harness();
    const proposal = await planned(h);
    const original = h.getContext();
    const apply = () => h.service.applyLegacyImport({
      proposal_handle: proposal.proposal_handle,
      approval: { confirmed: true, granted_by: "Pitaji" },
    });

    h.setContext({ ...original, expected_head: "4".repeat(40) });
    expect(await apply()).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_LEGACY_HEAD_DRIFT" }],
    });
    h.setContext({ ...original, profile_lock_hash: "5".repeat(64) });
    expect(await apply()).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_LEGACY_PROFILE_DRIFT" }],
    });
    h.setContext(original);
    h.setSource(new TextEncoder().encode("Changed source.\n"));
    expect(await apply()).toMatchObject({
      ok: false,
      issues: [{ code: "GUIDED_IMPORT_SOURCE_HASH_MISMATCH" }],
    });
    h.setSource(SOURCE_BYTES);
    vi.mocked(h.dependencies.finalize).mockResolvedValueOnce(failure(
      "COORDINATOR_REJECTED",
      "integration rejected",
    ));
    expect(await apply()).toMatchObject({
      ok: false,
      issues: [{ code: "COORDINATOR_REJECTED" }],
    });
    expect(await apply()).toMatchObject({ ok: true });
  });

  it("fails closed when replanning changes the exact plan", async () => {
    const h = harness();
    const proposal = await planned(h);
    vi.mocked(h.dependencies.plan).mockImplementationOnce(async (root, input) => {
      const exact = await planGuidedLegacyImport(input, {
        ids: new FixedIds(),
        read_source: () => Promise.resolve(success(SOURCE_BYTES)),
      });
      if (!exact.ok) return exact;
      return success({ ...exact.value, plan_hash: "6".repeat(64) });
    });

    expect(await h.service.applyLegacyImport({
      proposal_handle: proposal.proposal_handle,
      approval: { confirmed: true, granted_by: "Pitaji" },
    })).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_LEGACY_PLAN_DRIFT" }],
    });
    expect(h.dependencies.finalize).not.toHaveBeenCalled();
  });
});

describe("guided import authority", () => {
  it("accepts only one import plan hash for one exact root, ref, and head", async () => {
    const h = harness();
    const proposal = await planned(h);
    const stored = h.proposals.resolve(proposal.proposal_handle, "legacy_import");
    if (!stored.ok) throw new Error(JSON.stringify(stored.issues));
    const plan = stored.value.plan;
    const authority = createLegacyImportAuthority(ROOT, plan);

    expect((await authority.verify(ROOT, plan)).ok).toBe(true);
    const rejected: readonly [URL, CanonicalMutationPlan<unknown>][] = [
      [OTHER_ROOT, plan],
      [ROOT, { ...plan, plan_hash: "7".repeat(64) }],
      [ROOT, { ...plan, target_ref: "refs/heads/other" }],
      [ROOT, { ...plan, expected_head: "8".repeat(40) }],
      [ROOT, { ...plan, mutation_kind: "record" }],
    ];
    for (const [root, candidate] of rejected) {
      expect(await authority.verify(root, candidate)).toMatchObject({
        ok: false,
        issues: [{ code: "HOST_LEGACY_AUTHORITY_DENIED" }],
      });
    }
  });
});
