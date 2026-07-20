import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { serialize } from "node:v8";

import { afterEach, describe, expect, it } from "vitest";

import {
  initPlanHash,
  type InitPlan,
} from "../../src/cli/init/build-init-plan.js";
import { canonicalMutationPlanHash } from "../../src/contracts/canonical-mutation-plan.js";
import { canonicalJson } from "../../src/core/canonical-json.js";
import { sha256 } from "../../src/core/hash.js";
import { GENERATED_VIEW_PATHS } from "../../src/governance/views/generate-views.js";
import type {
  GuidedLegacyImportInput,
  PendingLegacyReview,
  ReviewedImportPlan,
} from "../../src/import/contracts.js";
import {
  FileProposalStore,
  InMemoryProposalStore,
} from "../../src/host/proposal-store.js";
import type { RepositoryUpgradePlan } from "../../src/upgrades/contracts.js";

const ROOT = new URL("file:///C:/project/");
const PLAN_BODY = {
  expected_head: "1".repeat(40),
  replay: { expires_at: "2026-07-17T13:00:00.000Z" },
} as unknown as Omit<InitPlan, "plan_hash">;
const PLAN = {
  ...PLAN_BODY,
  plan_hash: initPlanHash(PLAN_BODY),
} as InitPlan;
const temporaryRoots: string[] = [];

const REVIEW_SCAN_BODY = {
  schema_version: "1.0.0" as const,
  root: ROOT.href,
  artifacts: [{
    relative_path: "HANDOFF.md",
    sha256: "4".repeat(64),
    byte_length: 12,
    git_revision: "1".repeat(40),
    detected_roles: ["handoff"] as const,
    sensitivity_findings: [],
  }],
};
const REVIEW_SCAN = {
  ...REVIEW_SCAN_BODY,
  scan_hash: sha256(canonicalJson(REVIEW_SCAN_BODY)),
};
const REVIEW_PROPOSAL_BODY = {
  schema_version: "1.0.0" as const,
  root_id: "ROOT-01J00000000000000000000000",
  status: "review_required" as const,
  scan_hash: REVIEW_SCAN.scan_hash,
  mappings: [{
    source_path: "HANDOFF.md",
    source_sha256: "4".repeat(64),
    classification: "historical_status" as const,
    destination_kind: "view_candidate" as const,
    destination_path: null,
    accepted: false as const,
    rationale: "Review historical handoff evidence.",
  }],
};
const PENDING: PendingLegacyReview = {
  root_id: REVIEW_PROPOSAL_BODY.root_id,
  scan: REVIEW_SCAN,
  proposal: {
    ...REVIEW_PROPOSAL_BODY,
    proposal_hash: sha256(canonicalJson(REVIEW_PROPOSAL_BODY)),
  },
};
const GUIDED_INPUT: GuidedLegacyImportInput = {
  root_id: PENDING.root_id,
  target_ref: "refs/heads/main",
  expected_head: "1".repeat(40),
  profile_lock_hash: "2".repeat(64),
  catalog_version: "1.0.0",
  proposal_hash: PENDING.proposal.proposal_hash,
  created_by: "codex",
  created_at: "2026-07-17T12:00:00.000Z",
  expires_at: "2026-07-17T13:00:00.000Z",
  sources: [{
    source_path: "HANDOFF.md",
    source_sha256: "4".repeat(64),
    source_git_revision: "1".repeat(40),
    disposition: "unresolved",
    rationale: "Needs clarification.",
    facts: [],
  }],
};
const IMPORT_PLAN_BODY: Omit<ReviewedImportPlan, "plan_hash"> = {
  schema_version: "1.0.0",
  plan_id: `import:${PENDING.proposal.proposal_hash.slice(0, 16)}`,
  mutation_kind: "import",
  root_id: GUIDED_INPUT.root_id,
  target_ref: GUIDED_INPUT.target_ref,
  expected_head: GUIDED_INPUT.expected_head,
  profile_lock_hash: GUIDED_INPUT.profile_lock_hash,
  writes: [],
  record_ids: [],
  event_ids: [],
  approval_ids: [],
  evidence_ids: [],
  created_by: GUIDED_INPUT.created_by,
  created_at: GUIDED_INPUT.created_at,
  expires_at: GUIDED_INPUT.expires_at,
  metadata: {
    governance_kind: "import",
    proposal_hash: GUIDED_INPUT.proposal_hash,
    imported_candidate_ids: [],
    rejected_candidate_ids: [],
    original_archive_paths: [],
    redacted_archive_paths: [],
    destination_paths: [],
    import_report_path:
      `docs/project-memory/governance/imports/${GUIDED_INPUT.proposal_hash}.json`,
    import_report_hash: "5".repeat(64),
    required_view_paths: [],
    resolved_source_paths: [],
    unresolved_source_paths: ["HANDOFF.md"],
    imported_fact_record_ids: [],
    guided_input_hash: sha256(canonicalJson(GUIDED_INPUT)),
  },
};
const IMPORT_PLAN: ReviewedImportPlan = {
  ...IMPORT_PLAN_BODY,
  plan_hash: canonicalMutationPlanHash(IMPORT_PLAN_BODY),
};
const UPGRADE_CHANGED_PATHS = [
  "PROJECT_CONTEXT.md",
  "docs/project-memory/governance/migrations/repository-contract-1.0.0-to-1.1.0.json",
  "tools/project-memory/config.json",
] as const;
const UPGRADE_PLAN_BODY: Omit<RepositoryUpgradePlan, "plan_hash"> = {
  schema_version: "1.0.0",
  plan_id: "repository-upgrade:ROOT-01J00000000000000000000000:aaaaaaaaaaaa",
  mutation_kind: "migration",
  root_id: "ROOT-01J00000000000000000000000",
  target_ref: "refs/heads/main",
  expected_head: "1".repeat(40),
  profile_lock_hash: "2".repeat(64),
  writes: UPGRADE_CHANGED_PATHS.map((relativePath, index) => ({
    relative_path: relativePath,
    bytes: new TextEncoder().encode(`upgrade-${String(index)}\n`),
    expected_existing_sha256: index === 1 ? null : "3".repeat(64),
    mode: index === 1 ? "create" as const : "replace" as const,
  })),
  record_ids: [], event_ids: [], approval_ids: [], evidence_ids: [],
  created_by: "project-memory-upgrader",
  created_at: "2026-07-17T12:00:00.000Z",
  expires_at: "2026-07-17T13:00:00.000Z",
  metadata: {
    governance_kind: "repository_upgrade",
    migration_id: "project-memory-v1-1",
    from_version: "1.0.0",
    to_version: "1.1.0",
    authority_impact: "none",
    canonical_source_set_hash: "4".repeat(64),
    canonical_source_path_count: 12,
    catalog_lock_hash: "5".repeat(64),
    config_input_sha256: "6".repeat(64),
    config_output_sha256: "7".repeat(64),
    doorway_input_sha256: "8".repeat(64),
    doorway_output_sha256: "9".repeat(64),
    changed_paths: UPGRADE_CHANGED_PATHS,
    derived_paths: [...GENERATED_VIEW_PATHS],
    migration_record_path: UPGRADE_CHANGED_PATHS[1],
    steps: [{
      migration_id: "project-memory-v1-1",
      from_version: "1.0.0",
      to_version: "1.1.0",
      input_sha256: "6".repeat(64),
      output_sha256: "7".repeat(64),
      semantic_diff: [{
        path: "/repository_contract_version",
        before: null,
        after: "1.1.0",
      }],
    }],
  },
};
const UPGRADE_PLAN: RepositoryUpgradePlan = {
  ...UPGRADE_PLAN_BODY,
  plan_hash: canonicalMutationPlanHash(UPGRADE_PLAN_BODY),
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("proposal stores", () => {
  it("binds an unguessable handle to one exact bootstrap plan", () => {
    const store = new InMemoryProposalStore({
      now: () => new Date("2026-07-17T12:00:00.000Z"),
      handle: () => "pm-proposal-00000000000000000000000000000001",
    });

    const issued = store.issue(ROOT, PLAN);

    expect(issued).toMatchObject({
      ok: true,
      value: {
        handle: "pm-proposal-00000000000000000000000000000001",
        plan_hash: PLAN.plan_hash,
        expected_head: PLAN.expected_head,
        expires_at: PLAN.replay.expires_at,
      },
    });
    expect(store.resolve(issued.ok ? issued.value.handle : "")).toMatchObject({
      ok: true,
      value: { root: ROOT, plan: PLAN },
    });
  });

  it("rejects unknown, expired, or already-consumed handles", () => {
    let now = new Date("2026-07-17T12:00:00.000Z");
    const store = new InMemoryProposalStore({
      now: () => now,
      handle: () => "pm-proposal-00000000000000000000000000000002",
    });

    expect(store.resolve("pm-proposal-missing")).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_NOT_FOUND" }],
    });

    const issued = store.issue(ROOT, PLAN);
    if (!issued.ok) throw new Error("fixture failed");
    now = new Date("2026-07-17T13:00:00.000Z");
    expect(store.resolve(issued.value.handle)).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_EXPIRED" }],
    });

    now = new Date("2026-07-17T12:00:00.000Z");
    const consumedStore = new InMemoryProposalStore({
      now: () => now,
      handle: () => "pm-proposal-00000000000000000000000000000003",
    });
    const consumable = consumedStore.issue(ROOT, PLAN);
    if (!consumable.ok) throw new Error("fixture failed");
    expect(consumedStore.consume(consumable.value.handle).ok).toBe(true);
    expect(consumedStore.resolve(consumable.value.handle)).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_NOT_FOUND" }],
    });
  });

  it("fails closed instead of evicting an active proposal", () => {
    let next = 0;
    const store = new InMemoryProposalStore({
      now: () => new Date("2026-07-17T12:00:00.000Z"),
      handle: () => `pm-proposal-${String(next += 1).padStart(32, "0")}`,
    });

    for (let index = 0; index < 8; index += 1) {
      expect(store.issue(ROOT, PLAN).ok).toBe(true);
    }
    expect(store.issue(ROOT, PLAN)).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_CACHE_FULL" }],
    });
  });

  it("round-trips review and import envelopes with exact kind checks", () => {
    let now = new Date("2026-07-17T12:00:00.000Z");
    let next = 10;
    const store = new InMemoryProposalStore({
      now: () => now,
      handle: () => `pm-proposal-${String(next += 1).padStart(32, "0")}`,
    });
    const review = store.issue({
      kind: "legacy_review",
      root: ROOT,
      pending: PENDING,
      expected_head: GUIDED_INPUT.expected_head,
      profile_lock_hash: GUIDED_INPUT.profile_lock_hash,
    });
    expect(review).toMatchObject({
      ok: true,
      value: {
        plan_hash: PENDING.proposal.proposal_hash,
        expected_head: GUIDED_INPUT.expected_head,
        expires_at: "2026-07-17T13:00:00.000Z",
      },
    });
    if (!review.ok) return;
    expect(store.resolve(review.value.handle, "legacy_review")).toMatchObject({
      ok: true,
      value: {
        kind: "legacy_review",
        root: ROOT,
        pending: PENDING,
      },
    });
    expect(store.resolve(review.value.handle, "bootstrap")).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_KIND_MISMATCH" }],
    });

    const imported = store.issue({
      kind: "legacy_import",
      root: ROOT,
      input: GUIDED_INPUT,
      plan: IMPORT_PLAN,
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(store.consume(imported.value.handle, "legacy_import")).toMatchObject({
      ok: true,
      value: { kind: "legacy_import", plan: IMPORT_PLAN },
    });
    expect(store.resolve(imported.value.handle)).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_NOT_FOUND" }],
    });
    now = new Date("2026-07-17T13:00:00.000Z");
    expect(store.resolve(review.value.handle, "legacy_review")).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_EXPIRED" }],
    });
  });

  it("rejects invalid review and import bindings before issuing handles", () => {
    const store = new InMemoryProposalStore({
      now: () => new Date("2026-07-17T12:00:00.000Z"),
      handle: () => "pm-proposal-00000000000000000000000000000020",
    });
    expect(store.issue({
      kind: "legacy_review",
      root: ROOT,
      pending: PENDING,
      expected_head: "bad",
      profile_lock_hash: GUIDED_INPUT.profile_lock_hash,
    })).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_INVALID" }],
    });
    expect(store.issue({
      kind: "legacy_import",
      root: ROOT,
      input: GUIDED_INPUT,
      plan: { ...IMPORT_PLAN, expected_head: "6".repeat(40) },
    })).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_INVALID" }],
    });
  });

  it("recovers typed review and import handles in a second file-store process", async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), "project-memory-typed-proposals-"));
    temporaryRoots.push(cacheRoot);
    let next = 30;
    const first = new FileProposalStore({
      cache_root: cacheRoot,
      now: () => new Date("2026-07-17T12:00:00.000Z"),
      handle: () => `pm-proposal-${String(next += 1).padStart(32, "0")}`,
    });
    const review = await first.issue({
      kind: "legacy_review",
      root: ROOT,
      pending: PENDING,
      expected_head: GUIDED_INPUT.expected_head,
      profile_lock_hash: GUIDED_INPUT.profile_lock_hash,
    });
    const imported = await first.issue({
      kind: "legacy_import",
      root: ROOT,
      input: GUIDED_INPUT,
      plan: IMPORT_PLAN,
    });
    if (!review.ok || !imported.ok) throw new Error("typed fixture failed");

    const second = new FileProposalStore({
      cache_root: cacheRoot,
      now: () => new Date("2026-07-17T12:05:00.000Z"),
      handle: () => "pm-proposal-unused00000000000000000000000",
    });
    expect(await second.resolve(review.value.handle, "legacy_review")).toMatchObject({
      ok: true, value: { kind: "legacy_review", pending: PENDING },
    });
    expect(await second.resolve(imported.value.handle, "legacy_import")).toMatchObject({
      ok: true, value: { kind: "legacy_import", plan: IMPORT_PLAN },
    });
  });

  it("round-trips an exact upgrade envelope with kind checks", () => {
    const store = new InMemoryProposalStore({
      now: () => new Date("2026-07-17T12:05:00.000Z"),
      handle: () => "pm-proposal-00000000000000000000000000000035",
    });
    const issued = store.issue({
      kind: "upgrade", root: ROOT, adapter_id: "adapter.codex", plan: UPGRADE_PLAN,
    });
    expect(issued).toMatchObject({
      ok: true, value: { kind: "upgrade", plan_hash: UPGRADE_PLAN.plan_hash },
    });
    if (!issued.ok) return;
    expect(store.resolve(issued.value.handle, "upgrade")).toMatchObject({
      ok: true,
      value: { kind: "upgrade", adapter_id: "adapter.codex", plan: UPGRADE_PLAN },
    });
    expect(store.resolve(issued.value.handle, "bootstrap")).toMatchObject({
      ok: false, issues: [{ code: "HOST_PROPOSAL_KIND_MISMATCH" }],
    });
  });

  it("recovers an upgrade handle in a second file-store process", async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), "project-memory-upgrade-proposals-"));
    temporaryRoots.push(cacheRoot);
    const first = new FileProposalStore({
      cache_root: cacheRoot,
      now: () => new Date("2026-07-17T12:05:00.000Z"),
      handle: () => "pm-proposal-00000000000000000000000000000036",
    });
    const issued = await first.issue({
      kind: "upgrade", root: ROOT, adapter_id: "adapter.codex", plan: UPGRADE_PLAN,
    });
    if (!issued.ok) throw new Error("upgrade proposal fixture failed");
    const second = new FileProposalStore({
      cache_root: cacheRoot,
      now: () => new Date("2026-07-17T12:06:00.000Z"),
      handle: () => "pm-proposal-unused00000000000000000000000",
    });
    expect(await second.resolve(issued.value.handle, "upgrade")).toMatchObject({
      ok: true,
      value: { kind: "upgrade", plan: { plan_hash: UPGRADE_PLAN.plan_hash } },
    });
  });

  it("fails closed on corrupt typed cache bytes", async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), "project-memory-corrupt-proposals-"));
    temporaryRoots.push(cacheRoot);
    const handle = "pm-proposal-00000000000000000000000000000040";
    const store = new FileProposalStore({
      cache_root: cacheRoot,
      now: () => new Date("2026-07-17T12:00:00.000Z"),
      handle: () => handle,
    });
    const issued = await store.issue({
      kind: "legacy_import",
      root: ROOT,
      input: GUIDED_INPUT,
      plan: IMPORT_PLAN,
    });
    if (!issued.ok) throw new Error("corrupt fixture failed");
    await writeFile(path.join(cacheRoot, `${handle}.bin`), new Uint8Array([1, 2, 3]));
    expect(await store.resolve(handle)).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_CORRUPT" }],
    });
  });

  it("retains the exact proposal across MCP host processes", async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), "project-memory-proposals-"));
    temporaryRoots.push(cacheRoot);
    const issuedByFirstProcess = new FileProposalStore({
      cache_root: cacheRoot,
      now: () => new Date("2026-07-17T12:00:00.000Z"),
      handle: () => "pm-proposal-00000000000000000000000000000004",
    });

    const issued = await issuedByFirstProcess.issue(ROOT, PLAN);
    if (!issued.ok) throw new Error("fixture failed");

    const readBySecondProcess = new FileProposalStore({
      cache_root: cacheRoot,
      now: () => new Date("2026-07-17T12:05:00.000Z"),
      handle: () => "pm-proposal-unused00000000000000000000000",
    });
    expect(await readBySecondProcess.resolve(issued.value.handle)).toMatchObject({
      ok: true,
      value: { root: ROOT, plan: PLAN },
    });
    expect((await readBySecondProcess.consume(issued.value.handle)).ok).toBe(true);

    const readByThirdProcess = new FileProposalStore({
      cache_root: cacheRoot,
      now: () => new Date("2026-07-17T12:06:00.000Z"),
      handle: () => "pm-proposal-unused00000000000000000000000",
    });
    expect(await readByThirdProcess.resolve(issued.value.handle)).toMatchObject({
      ok: false,
      issues: [{ code: "HOST_PROPOSAL_NOT_FOUND" }],
    });
  });

  it("reads the prior versioned bootstrap envelope", async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), "project-memory-v1-proposals-"));
    temporaryRoots.push(cacheRoot);
    const handle = "pm-proposal-00000000000000000000000000000050";
    await writeFile(path.join(cacheRoot, `${handle}.bin`), serialize({
      schema_version: "1.0.0",
      root: ROOT.href,
      plan: PLAN,
    }));
    const store = new FileProposalStore({
      cache_root: cacheRoot,
      now: () => new Date("2026-07-17T12:05:00.000Z"),
      handle: () => "pm-proposal-unused00000000000000000000000",
    });
    expect(await store.resolve(handle, "bootstrap")).toMatchObject({
      ok: true,
      value: { kind: "bootstrap", root: ROOT, plan: PLAN },
    });
  });
});
