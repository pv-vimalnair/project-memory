import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalMutationPlanHash } from "../contracts/canonical-mutation-plan.js";
import {
  failure,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type { Clock } from "../core/clock.js";
import {
  applyFileTransaction,
  type FileTransactionDependencies,
} from "../core/file-transaction.js";
import { sha256 } from "../core/hash.js";
import { resolveInside } from "../core/path-safety.js";
import type { ProfileCanonicalMutationPlan } from "./contracts/index.js";
import type {
  ProfileVerificationReport,
  ProfileVerifier,
} from "./verify-profile.js";

export interface StagingWorktreeDescriptor {
  readonly root: string;
  readonly head: string;
  readonly linked_worktree: boolean;
  readonly detached: boolean;
  readonly coordinator_created: boolean;
  readonly clean: boolean;
  readonly dirty_paths: readonly string[];
}

export interface StagingGitInspector {
  inspectWorktree(
    root: URL,
  ): Promise<RuntimeResult<StagingWorktreeDescriptor>>;
}

export interface StagingCapability {
  readonly capability_id: string;
  readonly authority: string;
  readonly plan_id: string;
  readonly plan_hash: string;
  readonly staging_root: string;
  readonly expires_at: string;
  readonly proof: string;
}

export interface StagingCapabilityVerifier {
  verify(capability: StagingCapability): Promise<RuntimeResult<true>>;
}

export interface StagingMaterializationInput {
  readonly staging_root: URL;
  readonly expected_staging_head: string;
  readonly capability: StagingCapability;
  readonly plan: ProfileCanonicalMutationPlan;
}

export interface StagedProfileMutation {
  readonly plan_id: string;
  readonly plan_hash: string;
  readonly staging_root: URL;
  readonly staging_head: string;
  readonly writes: readonly {
    readonly relative_path: string;
    readonly previous_sha256: string | null;
    readonly next_sha256: string;
  }[];
  readonly verification: ProfileVerificationReport;
}

export interface ProfileMaterializer {
  materializeToIsolatedStaging(
    input: StagingMaterializationInput,
  ): Promise<RuntimeResult<StagedProfileMutation>>;
}

export interface StagingMaterializationDependencies {
  readonly git: StagingGitInspector;
  readonly capabilities: StagingCapabilityVerifier;
  readonly verifier: ProfileVerifier;
  readonly clock: Clock;
  readonly transaction?: FileTransactionDependencies;
}

function normalizedRoot(value: string | URL): RuntimeResult<string> {
  try {
    const url = typeof value === "string" ? new URL(value) : value;
    if (url.protocol !== "file:") {
      return failure("PATH_ROOT_INVALID", "staging root must be a file URL");
    }
    const resolved = path.resolve(fileURLToPath(url));
    return success(process.platform === "win32" ? resolved.toLowerCase() : resolved);
  } catch {
    return failure("PATH_ROOT_INVALID", "staging root must be a valid file URL");
  }
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString() === value ? parsed : null;
}

function validatePlan(
  plan: ProfileCanonicalMutationPlan,
  now: Date,
): RuntimeResult<ReadonlySet<string>> {
  const { plan_hash: planHash, ...withoutHash } = plan;
  try {
    if (canonicalMutationPlanHash(withoutHash) !== planHash) {
      return failure(
        "PROFILE_STAGING_PLAN_HASH_MISMATCH",
        "staging plan hash does not match its canonical mutation content",
        plan.plan_id,
      );
    }
  } catch (error: unknown) {
    return failure(
      "PROFILE_STAGING_PLAN_INVALID",
      error instanceof Error ? error.message : String(error),
      plan.plan_id,
    );
  }
  const expiresAt = timestamp(plan.expires_at);
  if (expiresAt === null || expiresAt <= now.getTime()) {
    return failure("PROFILE_PLAN_EXPIRED", "profile mutation plan has expired", plan.plan_id);
  }
  if (plan.writes.length === 0) {
    return failure("PROFILE_STAGING_PLAN_EMPTY", "staging plan has no writes", plan.plan_id);
  }
  const paths = new Set<string>();
  for (const write of plan.writes) {
    const normalized = write.relative_path.normalize("NFC").toLowerCase();
    if (normalized === ".git" || normalized.startsWith(".git/")) {
      return failure(
        "PROFILE_STAGING_GIT_PATH_FORBIDDEN",
        "profile staging plans cannot target the Git directory",
        write.relative_path,
      );
    }
    if (paths.has(normalized)) {
      return failure(
        "PROFILE_STAGING_PATH_DUPLICATE",
        "profile staging plan repeats a case-equivalent target path",
        write.relative_path,
      );
    }
    paths.add(normalized);
  }
  return success(paths);
}

async function validateCapability(
  input: StagingMaterializationInput,
  dependencies: StagingMaterializationDependencies,
): Promise<RuntimeResult<true>> {
  let authentic: RuntimeResult<true>;
  try {
    authentic = await dependencies.capabilities.verify(input.capability);
  } catch (error: unknown) {
    return failure(
      "PROFILE_STAGING_CAPABILITY_CHECK_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!authentic.ok) return authentic;
  const inputRoot = normalizedRoot(input.staging_root);
  if (!inputRoot.ok) return inputRoot;
  const capabilityRoot = normalizedRoot(input.capability.staging_root);
  if (!capabilityRoot.ok) return capabilityRoot;
  if (
    input.capability.authority !== "integration-coordinator" ||
    input.capability.capability_id.length === 0 ||
    input.capability.proof.length === 0 ||
    input.capability.plan_id !== input.plan.plan_id ||
    input.capability.plan_hash !== input.plan.plan_hash ||
    capabilityRoot.value !== inputRoot.value
  ) {
    return failure(
      "PROFILE_STAGING_CAPABILITY_MISMATCH",
      "staging capability is not bound to this plan and target root",
      input.capability.capability_id,
    );
  }
  const capabilityExpiry = timestamp(input.capability.expires_at);
  const planExpiry = timestamp(input.plan.expires_at);
  if (
    capabilityExpiry === null ||
    planExpiry === null ||
    capabilityExpiry > planExpiry ||
    capabilityExpiry <= dependencies.clock.now().getTime()
  ) {
    return failure(
      "PROFILE_STAGING_CAPABILITY_EXPIRED",
      "staging capability is expired or outlives its mutation plan",
      input.capability.capability_id,
    );
  }
  return success(true, authentic.warnings);
}

async function inspectWorktree(
  input: StagingMaterializationInput,
  dependencies: StagingMaterializationDependencies,
): Promise<RuntimeResult<StagingWorktreeDescriptor>> {
  let inspected: RuntimeResult<StagingWorktreeDescriptor>;
  try {
    inspected = await dependencies.git.inspectWorktree(input.staging_root);
  } catch (error: unknown) {
    return failure(
      "PROFILE_STAGING_INSPECTION_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!inspected.ok) return inspected;
  const expectedRoot = normalizedRoot(input.staging_root);
  if (!expectedRoot.ok) return expectedRoot;
  const actualRoot = normalizedRoot(inspected.value.root);
  if (
    !actualRoot.ok ||
    actualRoot.value !== expectedRoot.value ||
    !inspected.value.linked_worktree ||
    !inspected.value.detached ||
    !inspected.value.coordinator_created
  ) {
    return failure(
      "PROFILE_STAGING_WORKTREE_REQUIRED",
      "profile writes require a coordinator-created detached linked worktree",
    );
  }
  if (
    input.expected_staging_head !== input.plan.expected_head ||
    inspected.value.head !== input.expected_staging_head
  ) {
    return failure(
      "PROFILE_STAGING_HEAD_DRIFT",
      "staging worktree head does not match the planned base",
    );
  }
  return inspected;
}

async function exactPlanBytes(
  root: URL,
  plan: ProfileCanonicalMutationPlan,
): Promise<RuntimeResult<boolean>> {
  for (const write of plan.writes) {
    const resolved = await resolveInside(root, write.relative_path);
    if (!resolved.ok) return resolved;
    try {
      const stat = await lstat(resolved.value);
      if (stat.isSymbolicLink() || !stat.isFile()) return success(false);
      const bytes = new Uint8Array(await readFile(resolved.value));
      if (!Buffer.from(bytes).equals(Buffer.from(write.bytes))) return success(false);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return success(false);
      return failure(
        "PROFILE_STAGING_REREAD_FAILED",
        error instanceof Error ? error.message : String(error),
        write.relative_path,
      );
    }
  }
  return success(true);
}

function stagedWrites(plan: ProfileCanonicalMutationPlan) {
  return plan.writes.map((write) => ({
    relative_path: write.relative_path,
    previous_sha256: write.expected_existing_sha256,
    next_sha256: sha256(write.bytes),
  }));
}

function stagedResult(
  input: StagingMaterializationInput,
  writes: StagedProfileMutation["writes"],
  verification: ProfileVerificationReport,
): StagedProfileMutation {
  return {
    plan_id: input.plan.plan_id,
    plan_hash: input.plan.plan_hash,
    staging_root: input.staging_root,
    staging_head: input.expected_staging_head,
    writes,
    verification,
  };
}

async function verifyStagedProfile(
  input: StagingMaterializationInput,
  dependencies: StagingMaterializationDependencies,
): Promise<RuntimeResult<ProfileVerificationReport>> {
  const exact = await exactPlanBytes(input.staging_root, input.plan);
  if (!exact.ok) return exact;
  if (!exact.value) {
    return failure(
      "PROFILE_STAGING_BYTE_MISMATCH",
      "staged bytes do not exactly match every planned write",
    );
  }
  const verification = await dependencies.verifier.verify(input.staging_root);
  if (!verification.ok) return verification;
  return verification.value.valid
    ? verification
    : failure(
        "PROFILE_STAGING_VERIFICATION_FAILED",
        "staged profile verification reported an invalid target",
      );
}

async function materializeToIsolatedStaging(
  input: StagingMaterializationInput,
  dependencies: StagingMaterializationDependencies,
): Promise<RuntimeResult<StagedProfileMutation>> {
  const warnings: RuntimeIssue[] = [];
  const plan = validatePlan(input.plan, dependencies.clock.now());
  if (!plan.ok) return plan;
  const capability = await validateCapability(input, dependencies);
  if (!capability.ok) return capability;
  warnings.push(...capability.warnings);
  const inspected = await inspectWorktree(input, dependencies);
  if (!inspected.ok) return inspected;
  warnings.push(...inspected.warnings);

  const alreadyExact = await exactPlanBytes(input.staging_root, input.plan);
  if (!alreadyExact.ok) return alreadyExact;
  if (!inspected.value.clean) {
    const plannedPaths = plan.value;
    const dirtyPaths = inspected.value.dirty_paths.map((value) =>
      value.replaceAll("\\", "/").normalize("NFC").toLowerCase(),
    );
    if (
      dirtyPaths.length === 0 ||
      dirtyPaths.some((value) => !plannedPaths.has(value)) ||
      !alreadyExact.value
    ) {
      return failure(
        "PROFILE_STAGING_DIRTY",
        "staging worktree contains changes outside the exact planned bytes",
      );
    }
  }
  if (alreadyExact.value) {
    const verification = await verifyStagedProfile(input, dependencies);
    if (!verification.ok) return verification;
    return success(
      stagedResult(input, stagedWrites(input.plan), verification.value),
      [...warnings, ...verification.warnings],
    );
  }
  if (!inspected.value.clean) {
    return failure("PROFILE_STAGING_DIRTY", "staging worktree is not clean");
  }

  let verification: ProfileVerificationReport | undefined;
  const transaction = await applyFileTransaction(
    input.staging_root,
    input.plan.writes,
    dependencies.transaction,
    {
      validate: async () => {
        const verified = await verifyStagedProfile(input, dependencies);
        if (!verified.ok) return verified;
        verification = verified.value;
        return success(true, verified.warnings);
      },
    },
  );
  if (!transaction.ok) return transaction;
  if (verification === undefined) {
    return failure(
      "PROFILE_STAGING_VERIFICATION_MISSING",
      "transaction completed without a staged verification report",
    );
  }
  return success(
    stagedResult(input, transaction.value.writes, verification),
    [...warnings, ...transaction.warnings],
  );
}

export function createProfileMaterializer(
  dependencies: StagingMaterializationDependencies,
): ProfileMaterializer {
  return {
    materializeToIsolatedStaging: (input) =>
      materializeToIsolatedStaging(input, dependencies),
  };
}
