import { lstat, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  canonicalMutationPlanHash,
  failure,
  sha256,
  success,
  type CanonicalMutationPlan,
  type Clock,
  type IdFactory,
  type RuntimeResult,
} from "../../src/index.js";
import {
  createArchiveStore,
  createCanonicalMutationCoordinator,
  createCanonicalRecordStore,
  createClaimService,
  createGateRunner,
  createIntegrationCoordinator,
  createIntegrationLeaseStore,
  createMultiRepoFinalizer,
  createSingleRepoFinalizer,
  createStaleBaseReconciler,
  createViewGenerator,
  createWorkLifecycleService,
  leaseUrl,
  mutexUrl,
  taskDocumentPath,
  workstreamDocumentPath,
  type EvidenceRecordPayload,
  type GateEvidence,
  type NonceSource,
  type SingleRepoFinalizationInput,
} from "../../src/governance/index.js";
import {
  createAuditEvidenceBuilder,
  type IntegrationAuditManifest,
} from "../../src/governance/integration/audit-evidence.js";
import { IntegrationGitCliClient } from "../../src/governance/integration/integration-git-client.js";
import { createCanonicalSnapshotBuilder } from "../../src/governance/snapshot/canonical-snapshot-builder.js";
import { createRevisionTreeReader } from "../../src/governance/snapshot/revision-tree-reader.js";
import { createProfileVerifier } from "../../src/profile/verify-profile.js";
import {
  cleanupSingleRepoRoots,
  cloneSeed,
  git,
  singleRepoRunner,
  trackSingleRepoRoot,
} from "./single-repo-seed-fixture.js";

const NOW = new Date("2026-07-14T12:04:00.000Z");

class FixedClock implements Clock {
  now(): Date {
    return new Date(NOW.getTime());
  }
}

class FixedNonces implements NonceSource {
  #counter = 0;

  nextNonce(): string {
    this.#counter += 1;
    return this.#counter.toString(16).padStart(64, "0");
  }
}

class FixedIds implements IdFactory {
  next(prefix: Parameters<IdFactory["next"]>[0]): string {
    if (prefix !== "EVD") throw new Error(`unexpected ID prefix: ${prefix}`);
    return "EVD-01J00000000000000000000009";
  }
}

function mustValue<T>(result: RuntimeResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function gateEvidence(): GateEvidence {
  const stdout = "12 tests passed";
  return {
    schema_version: "1.0.0",
    gate_id: "gate.regression",
    definition_ref: "adapter.flutter.test@1.0.0",
    evidence_type: "test-result",
    execution_kind: "command",
    status: "passed",
    required: true,
    conflict_sensitive: true,
    command: {
      executable: process.execPath,
      args: ["--version"],
      cwd: ".",
    },
    verifier_role: null,
    exit_code: 0,
    stdout_redacted: stdout,
    stderr_redacted: "",
    stdout_sha256: sha256(stdout),
    stderr_sha256: sha256(""),
    evidence_ids: [],
    approval_refs: [],
    occurred_at: NOW.toISOString(),
    duration_ms: 5,
    not_run_reason: null,
  };
}

async function missing(target: URL): Promise<boolean> {
  try {
    await lstat(target);
    return false;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

afterAll(cleanupSingleRepoRoots);

describe("governance end-to-end integration", () => {
  it("preserves complete audit context across one finalized task", async () => {
    expect([
      createCanonicalRecordStore,
      createViewGenerator,
      createArchiveStore,
      createClaimService,
      createWorkLifecycleService,
      createIntegrationLeaseStore,
      createGateRunner,
      createStaleBaseReconciler,
      createCanonicalMutationCoordinator,
      createIntegrationCoordinator,
      createSingleRepoFinalizer,
      createMultiRepoFinalizer,
    ].every((factory) => typeof factory === "function")).toBe(true);

    const cloned = await cloneSeed();
    const { repo, seed } = cloned;
    await git(repo, ["switch", "--detach", seed.original_base]);
    await git(repo, ["branch", "-f", "main", seed.original_base]);
    await git(repo, ["switch", "main"]);

    const fixtureReadme = await readFile(new URL(
      "../fixtures/governance/repositories/e2e-root/README.md",
      import.meta.url,
    ), "utf8");
    expect(await git(repo, ["show", `${seed.original_base}:README.md`]))
      .toBe(fixtureReadme.trim());

    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "project-memory-e2e-tmp-"));
    trackSingleRepoRoot(temporaryDirectory);
    const temporaryRoot = pathToFileURL(`${temporaryDirectory}${path.sep}`);
    const clock = new FixedClock();
    const gitClient = new IntegrationGitCliClient(singleRepoRunner);
    const snapshots = createCanonicalSnapshotBuilder(
      createRevisionTreeReader(singleRepoRunner),
    );
    const leases = createIntegrationLeaseStore({
      clock,
      git: gitClient,
      nonces: new FixedNonces(),
    });
    const views = createViewGenerator({
      clock,
      target_ref: "refs/heads/main",
      created_by: "agent.integrator",
      snapshots: {
        async current(root) {
          const head = await gitClient.head(root);
          return snapshots.build(root, { kind: "commit", object_id: head });
        },
      },
    });
    const reconciler = createStaleBaseReconciler({
      git: gitClient,
      gates: { run: () => Promise.resolve(success(gateEvidence())) },
      applicability: {
        assess: () => Promise.resolve(success({ applicable: true, reason_code: null })),
      },
      temporary_root: temporaryRoot,
    });
    const archives = createArchiveStore({ clock });
    const finalizer = createSingleRepoFinalizer({
      clock,
      git: gitClient,
      leases,
      reconciler,
      snapshots,
      views,
      archives,
      audit: createAuditEvidenceBuilder({ clock, ids: new FixedIds() }),
      verifier: createProfileVerifier(),
      temporary_root: temporaryRoot,
      integrator_id: "agent.integrator",
    });
    const mutations = createCanonicalMutationCoordinator({
      repo,
      temporary_root: temporaryRoot,
      clock,
      git: gitClient,
      leases,
      snapshots,
      views,
      bindings: { verify: () => Promise.resolve(success(true)) },
      authority: { verify: () => Promise.resolve(success(true)) },
      repository: { validate: () => Promise.resolve(success(true)) },
      integrator_id: "agent.integrator",
    });
    const coordinator = createIntegrationCoordinator({
      bootstrap: {
        bootstrap: () => Promise.resolve(failure("test.unused", "bootstrap is not used")),
      },
      mutations,
      single_repo: finalizer,
    });
    const claims = createClaimService({
      clock,
      context: {
        async context(root) {
          const head = await gitClient.resolveRef(root, "refs/heads/main");
          const snapshot = await snapshots.build(root, {
            kind: "commit",
            object_id: head,
          });
          if (!snapshot.ok) return { ok: false as const, issues: snapshot.issues };
          return success({
            root_id: snapshot.value.root_id,
            target_ref: "refs/heads/main",
            expected_head: head,
            profile_lock_hash: snapshot.value.profile_lock_hash,
            actor_id: seed.task.claim.issuer,
          });
        },
      },
    });

    const issueInput = {
      root: repo,
      claim: seed.task.claim,
      requested_by: seed.task.claim.issuer,
      coordination_id: null,
      recorded_approvals: [],
    };
    const claimPlan = mustValue(await claims.planIssue(issueInput));
    const claimReceipt = mustValue(await coordinator.finalizeMutation(claimPlan));

    const claimSnapshot = mustValue(await snapshots.build(repo, {
      kind: "commit",
      object_id: claimReceipt.commit_revision,
    }));
    const workstreamPath = workstreamDocumentPath(seed.task.workstream_id);
    const taskPath = taskDocumentPath(seed.task.workstream_id, seed.task.task_id);
    const workstreamBytes = await gitClient.readBlob(repo, seed.main_head, workstreamPath);
    const taskBytes = await gitClient.readBlob(repo, seed.main_head, taskPath);
    if (workstreamBytes === null || taskBytes === null) {
      throw new Error("submitted task fixture is incomplete");
    }
    const taskPlanBody: Omit<CanonicalMutationPlan, "plan_hash"> = {
      schema_version: "1.0.0",
      plan_id: `e2e:submitted-task:${seed.task.task_id}`,
      mutation_kind: "work_lifecycle",
      root_id: claimSnapshot.root_id,
      target_ref: "refs/heads/main",
      expected_head: claimReceipt.commit_revision,
      profile_lock_hash: claimSnapshot.profile_lock_hash,
      writes: [
        {
          relative_path: workstreamPath,
          bytes: workstreamBytes,
          expected_existing_sha256: null,
          mode: "create" as const,
        },
        {
          relative_path: taskPath,
          bytes: taskBytes,
          expected_existing_sha256: null,
          mode: "create" as const,
        },
      ].sort((left, right) => Buffer.compare(
        Buffer.from(left.relative_path, "utf8"),
        Buffer.from(right.relative_path, "utf8"),
      )),
      record_ids: [],
      event_ids: [],
      approval_ids: claimSnapshot.approvals.map((record) => record.id).sort(),
      evidence_ids: [],
      created_by: "agent.integrator",
      created_at: NOW.toISOString(),
      expires_at: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
      metadata: {
        governance_kind: "work_lifecycle",
        operation: "e2e_submitted_task_fixture",
        task_id: seed.task.task_id,
      },
    };
    const taskPlan: CanonicalMutationPlan = {
      ...taskPlanBody,
      plan_hash: canonicalMutationPlanHash(taskPlanBody),
    };
    const taskReceipt = mustValue(await coordinator.finalizeMutation(taskPlan));

    const finalizationInput: SingleRepoFinalizationInput = {
      root: repo,
      target_ref: "refs/heads/main",
      expected_head: taskReceipt.commit_revision,
      task_packet: seed.task,
      completion_packet: seed.completion,
      expected_issuer: "agent.integrator",
      recorded_task_approvals: [],
      prior_gate_evidence: [],
      submitted_checks: {},
      directional_acceptance: null,
      external_action: null,
    };
    const validated = mustValue(await coordinator.validate(finalizationInput));
    const receipt = mustValue(await coordinator.finalize(validated));

    const checkoutDirectory = await mkdtemp(path.join(tmpdir(), "project-memory-e2e-checkout-"));
    trackSingleRepoRoot(checkoutDirectory);
    const checkoutParent = pathToFileURL(`${checkoutDirectory}${path.sep}`);
    const checkout = new URL("repo/", checkoutParent);
    await git(checkoutParent, [
      "-c",
      "core.autocrlf=false",
      "clone",
      "--no-hardlinks",
      fileURLToPath(repo),
      fileURLToPath(checkout),
    ]);

    const snapshot = mustValue(await snapshots.build(checkout, {
      kind: "commit",
      object_id: receipt.commit_revision,
    }));
    const transactionAuditBytes = new Uint8Array(await readFile(
      new URL(receipt.transaction_audit_path, checkout),
    ));
    const transactionAudit = JSON.parse(
      new TextDecoder().decode(transactionAuditBytes),
    ) as {
      readonly source_tree: string;
      readonly evidence_id: string;
      readonly claim_id: string;
    };
    const verificationViews = createViewGenerator({
      clock,
      target_ref: "refs/heads/main",
      created_by: "agent.integrator",
      snapshots: {
        current: (root) => snapshots.build(root, {
          kind: "tree",
          object_id: transactionAudit.source_tree,
        }),
      },
    });
    const drift = mustValue(await verificationViews.verify(checkout));
    const evidence = snapshot.records.find((record) => record.id === receipt.evidence_id);
    if (evidence?.type !== "evidence") throw new Error("integration evidence is absent");
    const audit = JSON.parse(
      (evidence.payload as EvidenceRecordPayload).exact_result,
    ) as IntegrationAuditManifest;
    const archive = mustValue(await archives.verify(
      checkout,
      receipt.completion_archive_manifest_hash,
    ));
    const records = createCanonicalRecordStore({
      clock,
      context: {
        context: () => Promise.resolve(success({
          target_ref: "refs/heads/main",
          expected_head: receipt.commit_revision,
          profile_lock_hash: snapshot.profile_lock_hash,
          created_by: "agent.integrator",
        })),
      },
    });
    const auditRecords = mustValue(await records.list(checkout, {
      types: ["evidence"],
      task_id: seed.task.task_id,
    }));

    expect(receipt).toMatchObject({
      status: "integrated_verified",
      claim_id: issueInput.claim.id,
      original_base_revision: seed.completion.original_base_revision,
      integration_base_revision: taskReceipt.commit_revision,
    });
    expect(await git(checkout, ["rev-parse", "HEAD"]))
      .toBe(receipt.commit_revision);
    expect(sha256(transactionAuditBytes)).toBe(receipt.transaction_audit_hash);
    expect(transactionAudit).toMatchObject({
      evidence_id: receipt.evidence_id,
      claim_id: issueInput.claim.id,
    });
    expect(drift).toMatchObject({ valid: true, drifted_paths: [] });
    expect(audit).toMatchObject({
      evidence_id: receipt.evidence_id,
      claim_id: issueInput.claim.id,
      original_base_revision: seed.completion.original_base_revision,
      integration_base_revision: receipt.integration_base_revision,
      completion_archive_manifest_hash: receipt.completion_archive_manifest_hash,
    });
    expect(archive.manifest_hash).toBe(receipt.completion_archive_manifest_hash);
    expect(auditRecords.map((record) => record.id)).toContain(receipt.evidence_id);
    expect(snapshot.records.map((record) => record.type)).toContain("change");
    expect(snapshot.events
      .filter((event) => event.aggregate_id === seed.task.task_id)
      .map((event) => event.event_type))
      .toEqual(expect.arrayContaining(["integration_validated", "integrated_verified"]));
    expect(snapshot.events
      .filter((event) => event.aggregate_id === issueInput.claim.id)
      .map((event) => event.event_type))
      .toContain("claim_issued");
    expect(Object.keys(receipt.gate_evidence_hashes)).toContain("gate.regression");
    expect(receipt.original_base_revision).not.toBe(receipt.integration_base_revision);
    expect(Number(await git(repo, [
      "rev-list",
      "--count",
      `${seed.original_base}..${receipt.commit_revision}`,
    ]))).toBeGreaterThanOrEqual(3);

    const commonGitDir = await gitClient.commonGitDir(repo);
    expect(await missing(leaseUrl(commonGitDir))).toBe(true);
    expect(await missing(mutexUrl(commonGitDir))).toBe(true);
    expect(await readdir(temporaryRoot)).toEqual([]);
    const worktrees = (await git(repo, ["worktree", "list", "--porcelain"]))
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("worktree "));
    expect(worktrees).toHaveLength(1);
  }, 90_000);
});
