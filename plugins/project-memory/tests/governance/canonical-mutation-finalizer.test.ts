import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  canonicalMutationPlanHash,
  failure,
  PROJECT_SCHEMA_REGISTRARS,
  registerProjectSchemas,
  type CanonicalMutationPlan,
} from "../../src/index.js";
import {
  MUTATION_FAULT_POINTS,
  createCanonicalMutationCoordinator,
  type MutationFaultPoint,
} from "../../src/governance/integration/canonical-mutation-finalizer.js";
import { leaseUrl, mutexUrl } from "../../src/governance/integration/integration-lease-store.js";
import { GENERATED_VIEW_PATHS } from "../../src/governance/views/generate-views.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import {
  BASE,
  cleanupMutationHarnesses,
  mutationHarness,
  mutationPlan,
  pathMissing,
} from "./mutation-test-fixture.js";

beforeEach(() => {
  resetSchemaRegistryForTests();
  registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
});

afterAll(cleanupMutationHarnesses);

function rehash(
  plan: CanonicalMutationPlan,
  changes: Partial<CanonicalMutationPlan>,
): CanonicalMutationPlan {
  const candidate = { ...plan, ...changes };
  const { plan_hash: ignored, ...withoutHash } = candidate;
  void ignored;
  return { ...withoutHash, plan_hash: canonicalMutationPlanHash(withoutHash) };
}

describe("canonical mutation finalizer", () => {
  it("applies source, views, audit, commit, and CAS only through the coordinator", async () => {
    const harness = await mutationHarness();
    await mkdir(new URL("docs/project-memory/views/", harness.repo), { recursive: true });
    for (const viewPath of GENERATED_VIEW_PATHS) {
      await writeFile(new URL(viewPath, harness.repo), `stale:${viewPath}\n`, "utf8");
    }
    const plan = await mutationPlan(harness);
    const original = await readFile(new URL(plan.writes[0]?.relative_path ?? "", harness.repo), "utf8");
    const coordinator = createCanonicalMutationCoordinator(harness.dependencies);

    const receipt = await coordinator.finalizeMutation(plan);

    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    expect(receipt.value).toMatchObject({
      status: "mutation_integrated",
      plan_id: plan.plan_id,
      plan_hash: plan.plan_hash,
      previous_revision: BASE,
    });
    expect(await harness.git.resolveRef(harness.repo, plan.target_ref)).toBe(receipt.value.commit_revision);
    expect(Object.keys(receipt.value.derived_view_hashes).sort()).toEqual([...GENERATED_VIEW_PATHS].sort());
    expect(Object.keys(receipt.value.audit_artifact_hashes)).toHaveLength(1);
    expect(harness.git.committedFile(receipt.value.commit_revision, plan.writes[0]?.relative_path ?? "")).toEqual(
      plan.writes[0]?.bytes,
    );
    for (const viewPath of GENERATED_VIEW_PATHS) {
      expect(harness.git.committedFile(receipt.value.commit_revision, viewPath)).toBeDefined();
    }
    const auditPath = Object.keys(receipt.value.audit_artifact_hashes)[0];
    if (auditPath === undefined) throw new Error("audit path missing");
    const auditBytes = harness.git.committedFile(receipt.value.commit_revision, auditPath);
    if (auditBytes === undefined) throw new Error("audit bytes missing");
    const audit = JSON.parse(new TextDecoder().decode(auditBytes)) as { readonly source_tree?: unknown };
    if (typeof audit.source_tree !== "string") throw new Error("audit source tree missing");
    const preViewTree = harness.git.trees.get(audit.source_tree);
    if (preViewTree === undefined) throw new Error("pre-view tree missing");
    for (const viewPath of GENERATED_VIEW_PATHS) expect(preViewTree.has(viewPath)).toBe(false);
    expect(await readFile(new URL(plan.writes[0]?.relative_path ?? "", harness.repo), "utf8")).toBe(original);
    expect(await pathMissing(leaseUrl(harness.common))).toBe(true);
    expect(await pathMissing(mutexUrl(harness.common))).toBe(true);
    expect(await readdir(harness.temp)).toEqual([]);
    expect(harness.git.create_calls).toBe(1);
  });

  it.each(["claim", "view", "archive", "administrative"] as const)(
    "keeps %s writes unapplied until finalizeMutation",
    async (mutationKind) => {
      const harness = await mutationHarness();
      const plan = await mutationPlan(harness, mutationKind);
      const source = plan.writes[0];
      if (source === undefined) throw new Error("source write missing");
      expect(await readFile(new URL(source.relative_path, harness.repo), "utf8")).not.toBe(
        new TextDecoder().decode(source.bytes),
      );
      const result = await createCanonicalMutationCoordinator(harness.dependencies).finalizeMutation(plan);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(harness.git.committedFile(result.value.commit_revision, source.relative_path)).toEqual(source.bytes);
      }
    },
  );

  it("rejects malformed, stale, overlapping, and immutable-history plans before mutation", async () => {
    const harness = await mutationHarness();
    const coordinator = createCanonicalMutationCoordinator(harness.dependencies);
    const plan = await mutationPlan(harness);

    expect(await coordinator.finalizeMutation({ ...plan, plan_hash: "0".repeat(64) })).toMatchObject({
      ok: false,
      issues: [{ code: "mutation.plan_hash_mismatch" }],
    });
    expect(
      await coordinator.finalizeMutation({
        ...plan,
        expires_at: "2026-07-14T11:59:59.000Z",
        plan_hash: "0".repeat(64),
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "mutation.plan_hash_mismatch" }] });

    const first = plan.writes[0];
    if (first === undefined) throw new Error("source write missing");
    const overlapping = rehash(plan, {
      writes: [first, { ...first, relative_path: `${first.relative_path}/child` }],
    });
    expect(await coordinator.finalizeMutation(overlapping)).toMatchObject({
      ok: false,
      issues: [{ code: "mutation.write_overlap" }],
    });

    const immutable = rehash(plan, {
      writes: [{ ...first, relative_path: "docs/project-memory/records/changes/CHG-01J00000000000000000000001.json" }],
    });
    expect(await coordinator.finalizeMutation(immutable)).toMatchObject({
      ok: false,
      issues: [{ code: "mutation.immutable_history_edit" }],
    });
    const caseAliasedImmutable = rehash(plan, {
      writes: [{ ...first, relative_path: "Docs/Project-Memory/Records/changes/history.json" }],
    });
    expect(await coordinator.finalizeMutation(caseAliasedImmutable)).toMatchObject({
      ok: false,
      issues: [{ code: "mutation.immutable_history_edit" }],
    });
    const nonBootstrapPlaceholder = rehash(plan, {
      writes: [{
        ...first,
        relative_path: "docs/project-memory/records/changes/.gitkeep",
        expected_existing_sha256: null,
        mode: "create_or_replace",
      }],
    });
    expect(await coordinator.finalizeMutation(nonBootstrapPlaceholder)).toMatchObject({
      ok: false,
      issues: [{ code: "mutation.immutable_history_edit" }],
    });
    const gitAlias = rehash(plan, {
      writes: [{ ...first, relative_path: "nested/.GIT/config" }],
    });
    expect(await coordinator.finalizeMutation(gitAlias)).toMatchObject({
      ok: false,
      issues: [{ code: "mutation.write_invalid" }],
    });
    const escaped = rehash(plan, {
      writes: [{ ...first, relative_path: "../outside.json" }],
    });
    expect(await coordinator.finalizeMutation(escaped)).toMatchObject({
      ok: false,
      issues: [{ code: "mutation.write_invalid" }],
    });
    const missingApproval = rehash(plan, {
      metadata: {
        ...plan.metadata,
        required_approval_ids: ["APR-01J00000000000000000000002"],
      },
    });
    expect(await coordinator.finalizeMutation(missingApproval)).toMatchObject({
      ok: false,
      issues: [{ code: "mutation.references_missing" }],
    });
    expect(harness.git.create_calls).toBe(0);
    expect(await harness.git.resolveRef(harness.repo, plan.target_ref)).toBe(BASE);
  });

  it("rejects write pre-image drift and still cleans the isolated transaction", async () => {
    const harness = await mutationHarness();
    const plan = await mutationPlan(harness);
    const first = plan.writes[0];
    if (first === undefined) throw new Error("source write missing");
    const drifted = rehash(plan, {
      writes: [{ ...first, expected_existing_sha256: "f".repeat(64) }],
    });
    const result = await createCanonicalMutationCoordinator(harness.dependencies).finalizeMutation(drifted);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "TRANSACTION_PRECONDITION_FAILED" }],
    });
    expect(await harness.git.resolveRef(harness.repo, plan.target_ref)).toBe(BASE);
    expect(await pathMissing(leaseUrl(harness.common))).toBe(true);
    expect(await pathMissing(mutexUrl(harness.common))).toBe(true);
    expect(await readdir(harness.temp)).toEqual([]);
  });

  it("rejects expired, head-drifted, profile-drifted, and unauthorized plans", async () => {
    const expiredHarness = await mutationHarness();
    const expiredPlan = await mutationPlan(expiredHarness);
    expiredHarness.clock.value = new Date("2026-07-14T12:06:00.000Z");
    expect(
      await createCanonicalMutationCoordinator(expiredHarness.dependencies).finalizeMutation(expiredPlan),
    ).toMatchObject({ ok: false, issues: [{ code: "mutation.plan_expired" }] });

    const headHarness = await mutationHarness();
    const headPlan = await mutationPlan(headHarness);
    headHarness.git.refs.set(headPlan.target_ref, "f".repeat(40));
    expect(
      await createCanonicalMutationCoordinator(headHarness.dependencies).finalizeMutation(headPlan),
    ).toMatchObject({ ok: false, issues: [{ code: "mutation.head_drift" }] });

    const bindingHarness = await mutationHarness();
    const bindingPlan = await mutationPlan(bindingHarness);
    bindingHarness.dependencies.bindings.verify = () => Promise.resolve(
      failure("mutation.profile_lock_drift", "profile lock changed"),
    );
    expect(
      await createCanonicalMutationCoordinator(bindingHarness.dependencies).finalizeMutation(bindingPlan),
    ).toMatchObject({ ok: false, issues: [{ code: "mutation.profile_lock_drift" }] });

    const authorityHarness = await mutationHarness();
    const authorityPlan = await mutationPlan(authorityHarness);
    authorityHarness.dependencies.authority.verify = () => Promise.resolve(
      failure("mutation.authority_denied", "approval or evidence missing"),
    );
    expect(
      await createCanonicalMutationCoordinator(authorityHarness.dependencies).finalizeMutation(authorityPlan),
    ).toMatchObject({ ok: false, issues: [{ code: "mutation.authority_denied" }] });
  });

  it.each(MUTATION_FAULT_POINTS)(
    "preserves the ref and cleans lease, mutex, and worktree after %s",
    async (faultPoint: MutationFaultPoint) => {
      const harness = await mutationHarness({
        hit(point) {
          if (point === faultPoint) throw new Error(`injected:${point}`);
        },
      });
      const plan = await mutationPlan(harness);
      const result = await createCanonicalMutationCoordinator(harness.dependencies).finalizeMutation(plan);

      expect(result).toMatchObject({ ok: false, issues: [{ code: "mutation.finalization_failed" }] });
      expect(await harness.git.resolveRef(harness.repo, plan.target_ref)).toBe(BASE);
      expect(await pathMissing(leaseUrl(harness.common))).toBe(true);
      expect(await pathMissing(mutexUrl(harness.common))).toBe(true);
      expect(await readdir(harness.temp)).toEqual([]);
    },
  );

  it("stops when its lease expires during finalization", async () => {
    const harness = await mutationHarness();
    const plan = await mutationPlan(harness);
    const coordinator = createCanonicalMutationCoordinator({
      ...harness.dependencies,
      lease_ttl_ms: 1_000,
      faults: {
        hit(point) {
          if (point === "after_worktree_creation") {
            harness.clock.value = new Date("2026-07-14T12:00:02.000Z");
          }
        },
      },
    });
    expect(await coordinator.finalizeMutation(plan)).toMatchObject({
      ok: false,
      issues: [{ code: "lease.expired" }],
    });
    expect(await harness.git.resolveRef(harness.repo, plan.target_ref)).toBe(BASE);
    expect(await pathMissing(leaseUrl(harness.common))).toBe(true);
    expect(await pathMissing(mutexUrl(harness.common))).toBe(true);
    expect(await readdir(harness.temp)).toEqual([]);
  });

  it("fails closed when compare-and-swap loses without leaking coordination state", async () => {
    const harness = await mutationHarness();
    harness.git.cas_allowed = false;
    const plan = await mutationPlan(harness);
    const result = await createCanonicalMutationCoordinator(harness.dependencies).finalizeMutation(plan);

    expect(result).toMatchObject({ ok: false, issues: [{ code: "mutation.cas_lost" }] });
    expect(await harness.git.resolveRef(harness.repo, plan.target_ref)).toBe(BASE);
    expect(await pathMissing(leaseUrl(harness.common))).toBe(true);
    expect(await pathMissing(mutexUrl(harness.common))).toBe(true);
    expect(await readdir(harness.temp)).toEqual([]);
  });
});
