import {
  canonicalMutationPlanHash,
  type CanonicalMutationPlan,
} from "../../contracts/canonical-mutation-plan.js";
import {
  failure,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import type { GitStatusEntry } from "../../contracts/git-client.js";
import {
  CanonicalRecordSchema,
  type CanonicalRecord,
} from "../../governance/contracts/index.js";
import type { BootstrapFinalization } from "../../governance/integration/bootstrap-finalizer.js";
import {
  bootstrapCanonicalApproval,
  validateBootstrapApproval,
} from "../../governance/integration/bootstrap-plan.js";
import type { IntegrationCoordinator } from "../../governance/integration/integration-coordinator.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../schema/project-registrars.js";
import { getSchemaValidator, registerProjectSchemas } from "../../schema/registry.js";
import {
  buildInitPlan,
  initPlanHash,
  type InitPlan,
  type InitReplayInput,
} from "./build-init-plan.js";

export interface InitApplyGit {
  head(root: URL): Promise<string>;
  statusPorcelain(root: URL): Promise<readonly GitStatusEntry[]>;
}

export interface InitApplyDependencies {
  readonly build_plan: (replay: InitReplayInput) => Promise<RuntimeResult<InitPlan>>;
  readonly git: InitApplyGit;
  readonly coordinator: IntegrationCoordinator;
  readonly now: () => Date;
}

export interface InitApplyInput {
  readonly saved_plan: InitPlan;
  readonly approval_record: CanonicalRecord;
}

function compilationHash(plan: CanonicalMutationPlan<unknown>): string {
  const { plan_hash: ignored, ...body } = plan;
  void ignored;
  return canonicalMutationPlanHash(body);
}

function catalogRelease(plan: CanonicalMutationPlan<unknown>): string | null {
  if (typeof plan.metadata !== "object" || plan.metadata === null) return null;
  const profile = (plan.metadata as Record<string, unknown>).profile;
  if (typeof profile !== "object" || profile === null) return null;
  const catalog = (profile as Record<string, unknown>).catalog;
  if (typeof catalog !== "object" || catalog === null) return null;
  const release = (catalog as Record<string, unknown>).release;
  return typeof release === "string" ? release : null;
}

export async function applyInitPlan(
  input: InitApplyInput,
  dependencies: InitApplyDependencies,
): Promise<RuntimeResult<BootstrapFinalization>> {
  if (initPlanHash(input.saved_plan) !== input.saved_plan.plan_hash) {
    return failure("INIT_PLAN_HASH_INVALID", "saved initialization plan content does not match its hash");
  }
  let root: URL;
  try {
    root = new URL(input.saved_plan.replay.root);
  } catch (error: unknown) {
    return failure("INIT_REPLAY_INVALID", error instanceof Error ? error.message : String(error));
  }
  try {
    const status = await dependencies.git.statusPorcelain(root);
    if (status.length > 0) {
      return failure("GIT_DIRTY_ROOT", "canonical repository root is not clean");
    }
  } catch (error: unknown) {
    return failure("GIT_STATUS_FAILED", error instanceof Error ? error.message : String(error));
  }
  let currentHead: string;
  try {
    currentHead = await dependencies.git.head(root);
  } catch (error: unknown) {
    return failure("GIT_HEAD_FAILED", error instanceof Error ? error.message : String(error));
  }
  if (currentHead !== input.saved_plan.expected_head) {
    return failure("INIT_HEAD_DRIFT", "repository HEAD changed after initialization planning");
  }
  const replanned = await dependencies.build_plan(input.saved_plan.replay);
  if (!replanned.ok) return replanned;
  if (replanned.value.plan_hash !== input.saved_plan.plan_hash) {
    return failure("INIT_PLAN_HASH_MISMATCH", "fresh initialization plan differs from the reviewed plan");
  }
  if (
    replanned.value.expected_head !== currentHead ||
    replanned.value.profile_compilation.expected_head !== currentHead
  ) {
    return failure("INIT_HEAD_DRIFT", "fresh initialization plan is not bound to current HEAD");
  }
  if (
    compilationHash(replanned.value.profile_compilation) !==
    replanned.value.profile_compilation.plan_hash
  ) {
    return failure("INIT_COMPILATION_PLAN_HASH_INVALID", "profile compilation content does not match its hash");
  }
  if (getSchemaValidator(CanonicalRecordSchema.$id) === undefined) {
    const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
    if (!registered.ok) return registered;
  }
  const approval = bootstrapCanonicalApproval(input.approval_record);
  if (!approval.ok) return approval;
  const release = catalogRelease(replanned.value.profile_compilation);
  if (release === null) {
    return failure("INIT_COMPILATION_METADATA_INVALID", "profile compilation lacks catalog release metadata");
  }
  const authorized = validateBootstrapApproval(
    approval.value,
    root,
    replanned.value.profile_compilation,
    replanned.value.source_proposal_hash,
    release,
    dependencies.now(),
  );
  if (!authorized.ok) return authorized;
  return dependencies.coordinator.bootstrap({
    root,
    target_ref: replanned.value.target_ref,
    expected_head: replanned.value.expected_head,
    root_id: replanned.value.target_root_id,
    accepted_sources: replanned.value.proposed_sources,
    compilation_plan: replanned.value.profile_compilation,
    expected_plan_hash: replanned.value.profile_compilation.plan_hash,
    source_proposal_hash: replanned.value.source_proposal_hash,
    approval_record: approval.value,
  });
}

export function defaultInitPlanBuilder(replay: InitReplayInput): Promise<RuntimeResult<InitPlan>> {
  return buildInitPlan(replay);
}
