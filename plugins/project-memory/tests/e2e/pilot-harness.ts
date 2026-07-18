import { readFile } from "node:fs/promises";

import {
  FixedClock,
  NodeCommandRunner,
  canonicalJson,
  canonicalMutationPlanHash,
  failure,
  success,
  type CanonicalMutationPlan,
  type RuntimeResult,
} from "../../src/index.js";
import {
  GENERATED_VIEW_PATHS,
  createArchiveStore,
  createCanonicalMutationCoordinator,
  createClaimService,
  createIntegrationLeaseStore,
  createViewGenerator,
  createWorkLifecycleService,
  type IntegrationCoordinator,
  type MutationReceipt,
  type NonceSource,
  type WorkAuthorityClass,
  type WorkTransitionInput,
} from "../../src/governance/index.js";
import { createAppendOnlyEventStore } from "../../src/governance/events/append-only-event-store.js";
import { parseWorkDocument, taskDocumentPath } from "../../src/governance/work/work-document.js";
import { createCanonicalSnapshotBuilder } from "../../src/governance/snapshot/canonical-snapshot-builder.js";
import { createRevisionTreeReader } from "../../src/governance/snapshot/revision-tree-reader.js";
import { validateCompletionPacket } from "../../src/planning/validate-completion-packet.js";
import { selectBlueprint } from "../../src/selection/score-candidates.js";
import {
  blueprintScoringCandidates,
  scoringContext,
  scoringFeatures,
} from "../fixtures/selection/runtime-fixtures.js";
import { makeValidCompletionPacket } from "../fixtures/selection/runtime-packet-fixtures.js";
import {
  bootstrapHarness,
  cleanupBootstrapHarnesses,
  git,
  replanBootstrapInput,
} from "../governance/bootstrap-test-fixture.js";
import { runImportBoundary, runMigrationBoundary } from "./pilot-cli-boundaries.js";
import {
  copyPilotFixture,
  createPilotTaskPacket,
  externalActionResult,
  inspectPilotFixture,
} from "./pilot-fixture-support.js";
import {
  PILOT_EXTERNAL_APPROVAL_ID,
  seedPilotAuthorityRecords,
} from "./pilot-records.js";
import type {
  ProductRootPilotInput,
  ProductRootPilotResult,
} from "./pilot-types.js";

const NOW = new Date("2026-07-15T04:31:00.000Z");
const TARGET_REF = "refs/heads/main";
const INTEGRATOR = "agent.integrator";
const VALIDATOR = "agent.validator";

function must<T>(result: RuntimeResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function first<T>(values: readonly T[], label: string): T {
  const value = values[0];
  if (value === undefined) throw new Error(`${label} missing`);
  return value;
}

class FixedNonces implements NonceSource {
  #counter = 0;

  nextNonce(): string {
    this.#counter += 1;
    return this.#counter.toString(16).padStart(64, "0");
  }
}

async function syncCheckout(root: URL): Promise<void> {
  await git(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", "."]);
}

function dispatchPlan(
  task: CanonicalMutationPlan<unknown>,
  claim: CanonicalMutationPlan<unknown>,
): CanonicalMutationPlan<unknown> {
  if (task.expected_head !== claim.expected_head || task.root_id !== claim.root_id) {
    throw new Error("task and claim plans do not share one dispatch base");
  }
  const unique = (values: readonly string[]) => [...new Set(values)].sort();
  const body: Omit<CanonicalMutationPlan<unknown>, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: `pilot.dispatch:${task.plan_id.split(":").at(-1) ?? "task"}`,
    mutation_kind: "work_lifecycle",
    root_id: task.root_id,
    target_ref: task.target_ref,
    expected_head: task.expected_head,
    profile_lock_hash: task.profile_lock_hash,
    writes: [...task.writes, ...claim.writes].sort((left, right) =>
      Buffer.compare(Buffer.from(left.relative_path), Buffer.from(right.relative_path)),
    ),
    record_ids: unique([...task.record_ids, ...claim.record_ids]),
    event_ids: unique([...task.event_ids, ...claim.event_ids]),
    approval_ids: unique([...task.approval_ids, ...claim.approval_ids]),
    evidence_ids: unique([...task.evidence_ids, ...claim.evidence_ids]),
    created_by: INTEGRATOR,
    created_at: task.created_at,
    expires_at: task.expires_at,
    metadata: {
      governance_kind: "work_lifecycle",
      operation: "pilot_dispatch",
      task_plan_hash: task.plan_hash,
      claim_plan_hash: claim.plan_hash,
    },
  };
  return { ...body, plan_hash: canonicalMutationPlanHash(body) };
}

export async function runProductRootPilot(
  input: ProductRootPilotInput,
): Promise<ProductRootPilotResult> {
  const fixtureRoot = new URL(`../fixtures/pilots/${input.fixture}/`, import.meta.url);
  const inspected = await inspectPilotFixture(fixtureRoot);
  const { paths, profile, sensitive_findings: findings } = inspected;
  const harness = await bootstrapHarness();
  await git(harness.repo, ["config", "core.autocrlf", "false"]);
  await copyPilotFixture(fixtureRoot, harness.repo);
  await git(harness.repo, ["add", "--all", "--", "."]);
  await git(harness.repo, ["commit", "-m", `test fixture: ${input.fixture}`]);
  const fixtureHead = await git(harness.repo, ["rev-parse", "HEAD"]);
  const bootstrapInput = replanBootstrapInput(harness.input, { expected_head: fixtureHead });
  must(await harness.finalizer.bootstrap(bootstrapInput));
  await syncCheckout(harness.repo);

  const clock = new FixedClock(NOW);
  const runner = new NodeCommandRunner();
  const snapshots = createCanonicalSnapshotBuilder(createRevisionTreeReader(runner));
  const leases = createIntegrationLeaseStore({
    clock,
    git: harness.git_client,
    nonces: new FixedNonces(),
  });
  const mutationCoordinator = createCanonicalMutationCoordinator({
    repo: harness.repo,
    temporary_root: harness.temporary_root,
    clock,
    git: harness.git_client,
    leases,
    snapshots,
    views: createViewGenerator({
      clock,
      target_ref: TARGET_REF,
      created_by: INTEGRATOR,
      snapshots: { current: () => Promise.resolve(failure("pilot.unused", "not used")) },
    }),
    bindings: { verify: () => Promise.resolve(success(true)) },
    authority: { verify: () => Promise.resolve(success(true)) },
    repository: { validate: () => Promise.resolve(success(true)) },
    integrator_id: INTEGRATOR,
  });
  const receipts: MutationReceipt[] = [];
  const coordinator: Pick<IntegrationCoordinator, "finalizeMutation"> = {
    async finalizeMutation(plan) {
      const result = await mutationCoordinator.finalizeMutation(plan);
      if (result.ok) {
        receipts.push(result.value);
        await syncCheckout(harness.repo);
      }
      return result;
    },
  };
  const currentHead = () => harness.git_client.resolveRef(harness.repo, TARGET_REF);
  let actorId = INTEGRATOR;
  let authorityClass: WorkAuthorityClass = "integrator";
  const approvalId = bootstrapInput.approval_record.id;
  const profileLockHash = bootstrapInput.compilation_plan.profile_lock_hash;
  const context = {
    async context(root: URL) {
      if (root.href !== harness.repo.href) return failure("pilot.root_mismatch", "unexpected root");
      return success({
        root_id: bootstrapInput.root_id,
        target_ref: TARGET_REF,
        expected_head: await currentHead(),
        profile_lock_hash: profileLockHash,
        actor_id: actorId,
        authority_class: authorityClass,
        approval_ids: [approvalId],
      });
    },
  };
  const work = createWorkLifecycleService({ clock, context });
  const finalize = async (plan: CanonicalMutationPlan<unknown>) =>
    must(await coordinator.finalizeMutation(plan));
  const transition = async (
    transitionInput: Omit<WorkTransitionInput, "root">,
    actor: string,
    authority: WorkAuthorityClass,
  ) => {
    actorId = actor;
    authorityClass = authority;
    await finalize(must(await work.planTransition({ root: harness.repo, ...transitionInput })));
  };

  const selection = must(selectBlueprint(
    blueprintScoringCandidates,
    scoringFeatures,
    scoringContext,
  ));
  actorId = INTEGRATOR;
  authorityClass = "integrator";
  await finalize(must(await work.planCreateInitiative({
    root: harness.repo,
    initiative_id: input.initiative_id,
    title: `${profile.product} pilot`,
    objective: input.goal,
    owners: [INTEGRATOR],
    acceptance_criteria: ["One product root remains authoritative"],
  })));
  await transition({
    artifact_type: "initiative", artifact_id: input.initiative_id, workstream_id: null,
    expected_status: "proposed", next_status: "accepted", approval_ids: [approvalId], evidence_ids: [],
  }, "Pitaji", "pitaji");
  await transition({
    artifact_type: "initiative", artifact_id: input.initiative_id, workstream_id: null,
    expected_status: "accepted", next_status: "active", approval_ids: [], evidence_ids: [],
  }, INTEGRATOR, "integrator");
  actorId = INTEGRATOR;
  authorityClass = "integrator";
  await finalize(must(await work.planCreateWorkstream({
    root: harness.repo,
    workstream_id: input.workstream_id,
    initiative_id: input.initiative_id,
    title: first(profile.workstreams, "profile workstream"),
    objective: input.goal,
    owners: [INTEGRATOR],
    dependencies: [],
  })));
  await transition({
    artifact_type: "workstream", artifact_id: input.workstream_id, workstream_id: null,
    expected_status: "planned", next_status: "active", approval_ids: [], evidence_ids: [],
  }, INTEGRATOR, "integrator");

  await seedPilotAuthorityRecords({
    root: harness.repo,
    root_id: bootstrapInput.root_id,
    profile_lock_hash: profileLockHash,
    clock,
    coordinator,
    current_head: currentHead,
    external_action: input.external_action,
  });
  const dispatchBase = await currentHead();
  const packet = createPilotTaskPacket(input, {
    root_id: bootstrapInput.root_id,
    profile_lock_hash: profileLockHash,
    base_revision: dispatchBase,
    now: NOW,
    issued_by: INTEGRATOR,
  });
  const claims = createClaimService({
    clock,
    context: {
      async context() {
        return success({
          root_id: bootstrapInput.root_id,
          target_ref: TARGET_REF,
          expected_head: await currentHead(),
          profile_lock_hash: profileLockHash,
          actor_id: INTEGRATOR,
        });
      },
    },
  });
  actorId = INTEGRATOR;
  authorityClass = "integrator";
  const claimPlan = must(await claims.planIssue({
    root: harness.repo,
    claim: packet.claim,
    requested_by: INTEGRATOR,
    coordination_id: null,
    recorded_approvals: [],
  }));
  const taskPlan = must(await work.planCreateTaskPacket({ root: harness.repo, packet }));
  await finalize(dispatchPlan(taskPlan, claimPlan));
  const claim = must(await claims.effectiveClaim(harness.repo, packet.claim.id));

  const evidenceId = first(packet.selector.evidence_ids, "selector evidence");
  await transition({
    artifact_type: "task_packet", artifact_id: input.task_id, workstream_id: input.workstream_id,
    expected_status: "issued", next_status: "claimed", approval_ids: [], evidence_ids: [],
  }, packet.assignment.assignee_id, "worker");
  await transition({
    artifact_type: "task_packet", artifact_id: input.task_id, workstream_id: input.workstream_id,
    expected_status: "claimed", next_status: "in_progress", approval_ids: [], evidence_ids: [],
  }, packet.assignment.assignee_id, "worker");

  const completion = makeValidCompletionPacket(packet);
  completion.submitted_at = new Date(NOW.getTime() + 2 * 60_000).toISOString();
  completion.scope_performed = [input.changed_path];
  const change = first(completion.changes, "completion change");
  change.files = [input.changed_path];
  change.authorization_refs = input.external_action ? [PILOT_EXTERNAL_APPROVAL_ID] : [];
  const taskGate = first(packet.gates, "task gate");
  const check = first(completion.checks, "completion check");
  check.command_or_check = taskGate.command_or_check;
  const validatedCompletion = validateCompletionPacket(completion, packet, {
    currentBaseRevision: dispatchBase,
    availableEvidenceIds: [evidenceId],
    approvedExceptionIds: [],
  });
  must(validatedCompletion);
  await transition({
    artifact_type: "task_packet", artifact_id: input.task_id, workstream_id: input.workstream_id,
    expected_status: "in_progress", next_status: "submitted", approval_ids: [], evidence_ids: [evidenceId],
  }, packet.assignment.assignee_id, "worker");
  await transition({
    artifact_type: "task_packet", artifact_id: input.task_id, workstream_id: input.workstream_id,
    expected_status: "submitted", next_status: "validated", approval_ids: [], evidence_ids: [evidenceId],
  }, VALIDATOR, "validator");

  const archives = createArchiveStore({ clock });
  const archivePlan = must(archives.planIngest({
    root_id: bootstrapInput.root_id,
    target_ref: TARGET_REF,
    expected_head: await currentHead(),
    profile_lock_hash: profileLockHash,
    actor_id: INTEGRATOR,
    object_kind: "completion-packet",
    media_type: "application/json",
    source_refs: [`task:${input.task_id}`],
    bytes: new TextEncoder().encode(canonicalJson(completion)),
  }));
  await finalize(archivePlan);
  const archiveVerification = must(await archives.verify(
    harness.repo,
    archivePlan.metadata.manifest_hash,
  ));
  await transition({
    artifact_type: "task_packet", artifact_id: input.task_id, workstream_id: input.workstream_id,
    expected_status: "validated", next_status: "integrated_verified", approval_ids: [], evidence_ids: [evidenceId],
  }, INTEGRATOR, "integrator");
  await transition({
    artifact_type: "workstream", artifact_id: input.workstream_id, workstream_id: null,
    expected_status: "active", next_status: "completed", approval_ids: [], evidence_ids: [evidenceId],
  }, INTEGRATOR, "integrator");
  await transition({
    artifact_type: "initiative", artifact_id: input.initiative_id, workstream_id: null,
    expected_status: "active", next_status: "completed", approval_ids: [], evidence_ids: [evidenceId],
  }, INTEGRATOR, "integrator");

  const cliDependencies = {
    root: harness.repo,
    root_id: bootstrapInput.root_id,
    target_ref: TARGET_REF,
    profile_lock_hash: profileLockHash,
    approval_id: approvalId,
    actor_id: INTEGRATOR,
    slug: input.fixture,
    now: NOW,
    coordinator,
    receipts,
    current_head: currentHead,
  };
  const migration = await runMigrationBoundary(cliDependencies);
  const importRun = await runImportBoundary(cliDependencies);
  const importReceipt = first(receipts.toReversed(), "import receipt");
  const audit = JSON.parse(
    await readFile(new URL(importRun.audit_path, harness.repo), "utf8"),
  ) as { readonly source_tree?: unknown };
  if (typeof audit.source_tree !== "string") throw new Error("import audit source tree missing");
  const verifyingViews = createViewGenerator({
    clock,
    target_ref: TARGET_REF,
    created_by: INTEGRATOR,
    snapshots: {
      current: () => snapshots.build(harness.repo, { kind: "tree", object_id: audit.source_tree as string }),
    },
  });
  const viewDrift = must(await verifyingViews.verify(harness.repo));
  const treePaths = (await git(harness.repo, ["ls-tree", "-r", "--name-only", "HEAD"]))
    .split(/\r?\n/u).filter((value) => value.length > 0);
  const rootPaths = treePaths.filter((value) =>
    value.toLowerCase().endsWith("/project.yaml"),
  );
  const taskBytes = new Uint8Array(await readFile(
    new URL(taskDocumentPath(input.workstream_id, input.task_id), harness.repo),
  ));
  const taskDocument = must(parseWorkDocument(
    taskBytes,
    "task_packet",
    input.task_id,
    bootstrapInput.root_id,
  ));
  const events = createAppendOnlyEventStore();
  const chains = await Promise.all([
    input.initiative_id,
    input.workstream_id,
    input.task_id,
    input.claim_id,
  ].map((aggregateId) => events.verifyChain(harness.repo, aggregateId)));
  const eventPaths = treePaths.filter((value) =>
    value.startsWith("docs/project-memory/governance/events/") && value.endsWith(".json"),
  );
  if (importReceipt.commit_revision !== await currentHead()) {
    throw new Error("import was not the final coordinator-owned commit");
  }

  return {
    profile,
    fixture_paths: paths,
    sensitive_findings: findings,
    bootstrap_calls: harness.coordinator_calls.value,
    root_document_paths: rootPaths,
    workstream_became_root: rootPaths.some((value) => value.includes(input.workstream_id)),
    selection_disposition: selection.disposition,
    task_status: taskDocument.status,
    claim_status: claim.status,
    completion_valid: validatedCompletion.ok,
    archive_valid: archiveVerification.manifest_hash === archivePlan.metadata.manifest_hash,
    views_valid: viewDrift.valid && viewDrift.drifted_paths.length === 0,
    history_is_append_only:
      chains.every((result) => result.ok) &&
      new Set(eventPaths).size === eventPaths.length,
    migration,
    import_run: importRun,
    external_action: externalActionResult(packet),
    generated_view_paths: [...GENERATED_VIEW_PATHS],
  };
}

export function cleanupPilotRoots(): Promise<void> {
  return cleanupBootstrapHarnesses();
}
