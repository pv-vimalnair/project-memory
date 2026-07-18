import { randomBytes } from "node:crypto";

import {
  canonicalJson,
  failure,
  sha256,
  success,
  validateWithSchema,
  type Clock,
  type GitClient,
  type RuntimeResult,
} from "../../index.js";
import type {
  ApprovalRecordPayload,
  CanonicalRecord,
  IntegrationLease,
  UnsignedGovernanceEvent,
} from "../contracts/index.js";
import {
  deleteIntegrationLease,
  readIntegrationLease,
  withIntegrationMutex,
  writeIntegrationLease,
} from "./integration-lease-io.js";

export { leaseUrl, mutexUrl } from "./integration-lease-io.js";

const REVISION = /^[0-9a-f]{40}$/;
const TARGET_REF = /^refs\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

export interface NonceSource {
  nextNonce(): string;
}

export class CryptoNonceSource implements NonceSource {
  nextNonce(): string {
    return randomBytes(32).toString("hex");
  }
}

export interface AcquireLeaseInput {
  readonly repo: URL;
  readonly root_id: string;
  readonly holder_id: string;
  readonly authority_class: "integrator" | "pitaji";
  readonly base_revision: string;
  readonly target_ref: string;
  readonly ttl_ms: number;
}

export interface TakeoverLeaseInput extends AcquireLeaseInput {
  readonly approval: CanonicalRecord;
  readonly designated_integration_owner_id: string | null;
}

export interface LeaseTakeoverAuditEvidence {
  readonly evidence_type: "lease-takeover";
  readonly prior_holder_id: string;
  readonly prior_nonce_hash: string;
  readonly new_holder_id: string;
  readonly base_revision: string;
  readonly target_ref: string;
  readonly approval_id: string;
  readonly occurred_at: string;
  readonly evidence_hash: string;
}

export interface LeaseToken {
  readonly repo: URL;
  readonly common_git_dir: URL;
  readonly root_id: string;
  readonly holder_id: string;
  readonly authority_class: "integrator" | "pitaji";
  readonly base_revision: string;
  readonly target_ref: string;
  readonly acquired_at: string;
  readonly last_heartbeat_at: string;
  readonly expires_at: string;
  readonly nonce: string;
  readonly ttl_ms: number;
  readonly takeover_approval_id: string | null;
  readonly takeover_event: UnsignedGovernanceEvent | null;
  readonly audit_evidence: LeaseTakeoverAuditEvidence | null;
}

export interface IntegrationLeaseStore {
  acquire(input: AcquireLeaseInput): Promise<RuntimeResult<LeaseToken>>;
  heartbeat(token: LeaseToken): Promise<RuntimeResult<LeaseToken>>;
  release(token: LeaseToken): Promise<RuntimeResult<void>>;
  takeover(input: TakeoverLeaseInput): Promise<RuntimeResult<LeaseToken>>;
}

export interface IntegrationLeaseStoreDependencies {
  readonly clock: Clock;
  readonly git: GitClient;
  readonly nonces?: NonceSource;
}

function validInput(input: AcquireLeaseInput): RuntimeResult<true> {
  if (
    input.repo.protocol !== "file:" ||
    input.root_id.trim().length === 0 ||
    input.holder_id.trim().length === 0 ||
    !REVISION.test(input.base_revision) ||
    !TARGET_REF.test(input.target_ref) ||
    input.target_ref.includes("..") ||
    !Number.isInteger(input.ttl_ms) ||
    input.ttl_ms <= 0 ||
    input.ttl_ms > MAX_TTL_MS
  ) {
    return failure(
      "lease.input_invalid",
      "lease input must bind a file repository, root, holder, revision, ref, and bounded TTL",
      input.holder_id,
    );
  }
  return success(true);
}

function currentTime(clock: Clock): RuntimeResult<Date> {
  const now = clock.now();
  return Number.isFinite(now.getTime())
    ? success(now)
    : failure("lease.clock_invalid", "integration lease clock must be valid");
}

function validNonce(value: string): RuntimeResult<string> {
  return value.length >= 32 && !/\s/.test(value)
    ? success(value)
    : failure(
        "lease.nonce_invalid",
        "governance nonce source must produce at least 32 non-whitespace characters",
      );
}

async function commonGitDir(
  git: GitClient,
  repo: URL,
): Promise<RuntimeResult<URL>> {
  try {
    const common = await git.commonGitDir(repo);
    return common.protocol === "file:"
      ? success(common)
      : failure("lease.common_git_dir_invalid", "common Git directory must be a file URL");
  } catch (error: unknown) {
    return failure(
      "lease.common_git_dir_failed",
      error instanceof Error ? error.message : String(error),
      repo.href,
    );
  }
}

async function repositoryHead(
  git: GitClient,
  repo: URL,
): Promise<RuntimeResult<string>> {
  try {
    const head = await git.head(repo);
    return REVISION.test(head)
      ? success(head)
      : failure("lease.head_invalid", "repository HEAD is not a full revision", repo.href);
  } catch (error: unknown) {
    return failure(
      "lease.head_failed",
      error instanceof Error ? error.message : String(error),
      repo.href,
    );
  }
}

export function holderMatches(lease: IntegrationLease, token: LeaseToken): boolean {
  return lease.holder_id === token.holder_id && lease.nonce === token.nonce;
}

function tokenFromLease(
  input: AcquireLeaseInput,
  common: URL,
  lease: IntegrationLease,
  takeoverEvent: UnsignedGovernanceEvent | null,
  evidence: LeaseTakeoverAuditEvidence | null,
): LeaseToken {
  return {
    repo: input.repo,
    common_git_dir: common,
    root_id: input.root_id,
    holder_id: lease.holder_id,
    authority_class: lease.authority_class,
    base_revision: lease.base_revision,
    target_ref: lease.target_ref,
    acquired_at: lease.acquired_at,
    last_heartbeat_at: lease.last_heartbeat_at,
    expires_at: lease.expires_at,
    nonce: lease.nonce,
    ttl_ms: input.ttl_ms,
    takeover_approval_id: lease.takeover_approval_id,
    takeover_event: takeoverEvent,
    audit_evidence: evidence,
  };
}

function tokenInput(token: LeaseToken): AcquireLeaseInput {
  return {
    repo: token.repo,
    root_id: token.root_id,
    holder_id: token.holder_id,
    authority_class: token.authority_class,
    base_revision: token.base_revision,
    target_ref: token.target_ref,
    ttl_ms: token.ttl_ms,
  };
}

function approvalPayload(record: CanonicalRecord): ApprovalRecordPayload | null {
  return record.type === "approval"
    ? (record.payload as ApprovalRecordPayload)
    : null;
}

function takeoverApproval(
  input: TakeoverLeaseInput,
  prior: IntegrationLease,
  now: Date,
): RuntimeResult<string> {
  const validated = validateWithSchema<CanonicalRecord>(
    "project-memory/v1/canonical-record",
    input.approval,
  );
  if (!validated.ok) {
    return failure(
      "lease.takeover_not_approved",
      "takeover approval is not a valid canonical record",
      input.approval.id,
    );
  }
  const record = validated.value;
  const payload = approvalPayload(record);
  const expiresAt = payload?.expires_at === null ? null : Date.parse(payload?.expires_at ?? "");
  const designated = input.designated_integration_owner_id;
  const actor = payload?.granted_by ?? "";
  const allowedActor =
    actor.trim().toLowerCase() === "pitaji" ||
    (designated !== null && actor === designated);
  if (
    payload === null ||
    record.status !== "accepted" ||
    record.root_id !== input.root_id ||
    record.actor_id !== actor ||
    payload.approval_kind !== "lease_takeover" ||
    !allowedActor ||
    payload.target !== prior.holder_id ||
    payload.environment !== input.target_ref ||
    payload.scope.length !== 1 ||
    payload.scope[0] !== input.base_revision ||
    payload.timing !== "stale-lease-takeover" ||
    (payload.expires_at !== null && (!Number.isFinite(expiresAt) || (expiresAt as number) <= now.getTime()))
  ) {
    return failure(
      "lease.takeover_not_approved",
      "stale lease takeover requires exact Pitaji or designated-owner approval",
      input.approval.id,
    );
  }
  return success(record.id);
}

function takeoverAudit(
  input: TakeoverLeaseInput,
  prior: IntegrationLease,
  approvalId: string,
  occurredAt: string,
): {
  readonly event: UnsignedGovernanceEvent;
  readonly evidence: LeaseTakeoverAuditEvidence;
} {
  const body = {
    evidence_type: "lease-takeover" as const,
    prior_holder_id: prior.holder_id,
    prior_nonce_hash: sha256(prior.nonce),
    new_holder_id: input.holder_id,
    base_revision: input.base_revision,
    target_ref: input.target_ref,
    approval_id: approvalId,
    occurred_at: occurredAt,
  };
  const evidence: LeaseTakeoverAuditEvidence = {
    ...body,
    evidence_hash: sha256(canonicalJson(body)),
  };
  return {
    event: {
      aggregate_id: "integration-lease",
      event_type: "lease_taken_over",
      occurred_at: occurredAt,
      actor_id: input.holder_id,
      authority_class: input.authority_class,
      evidence_ids: [],
      payload: {
        prior_holder_id: prior.holder_id,
        new_holder_id: input.holder_id,
        base_revision: input.base_revision,
        target_ref: input.target_ref,
        approval_id: approvalId,
        evidence_hash: evidence.evidence_hash,
      },
    },
    evidence,
  };
}

export function createIntegrationLeaseStore(
  dependencies: IntegrationLeaseStoreDependencies,
): IntegrationLeaseStore {
  const nonces = dependencies.nonces ?? new CryptoNonceSource();

  async function acquire(input: AcquireLeaseInput): Promise<RuntimeResult<LeaseToken>> {
    const valid = validInput(input);
    if (!valid.ok) return valid;
    const common = await commonGitDir(dependencies.git, input.repo);
    if (!common.ok) return common;
    return withIntegrationMutex(
      common.value,
      input.holder_id,
      dependencies.clock,
      nonces,
      async () => {
        const now = currentTime(dependencies.clock);
        if (!now.ok) return now;
        const existing = await readIntegrationLease(common.value);
        if (!existing.ok) return existing;
        if (existing.value !== null) {
          return Date.parse(existing.value.expires_at) <= now.value.getTime()
            ? failure("lease.takeover_required", "stale integration lease requires approved takeover", existing.value.holder_id)
            : failure("lease.already_held", "integration lease is already held", existing.value.holder_id);
        }
        const head = await repositoryHead(dependencies.git, input.repo);
        if (!head.ok) return head;
        if (head.value !== input.base_revision) {
          return failure("lease.base_drift", "acquire base differs from repository HEAD", input.holder_id);
        }
        const nonce = validNonce(nonces.nextNonce());
        if (!nonce.ok) return nonce;
        const acquiredAt = now.value.toISOString();
        const lease: IntegrationLease = {
          schema_version: "1.0.0",
          holder_id: input.holder_id,
          authority_class: input.authority_class,
          base_revision: input.base_revision,
          target_ref: input.target_ref,
          acquired_at: acquiredAt,
          last_heartbeat_at: acquiredAt,
          expires_at: new Date(now.value.getTime() + input.ttl_ms).toISOString(),
          nonce: nonce.value,
          takeover_approval_id: null,
        };
        const written = await writeIntegrationLease(common.value, lease, nonce.value);
        return written.ok
          ? success(tokenFromLease(input, common.value, lease, null, null))
          : written;
      },
    );
  }

  async function heartbeat(token: LeaseToken): Promise<RuntimeResult<LeaseToken>> {
    const common = await commonGitDir(dependencies.git, token.repo);
    if (!common.ok) return common;
    if (common.value.href !== token.common_git_dir.href) {
      return failure("lease.common_git_dir_drift", "token no longer resolves to the same common Git directory");
    }
    return withIntegrationMutex(
      common.value,
      token.holder_id,
      dependencies.clock,
      nonces,
      async () => {
        const now = currentTime(dependencies.clock);
        if (!now.ok) return now;
        const current = await readIntegrationLease(common.value);
        if (!current.ok) return current;
        if (current.value === null) return failure("lease.not_found", "integration lease does not exist");
        if (!holderMatches(current.value, token)) {
          return failure("lease.holder_mismatch", "lease holder or nonce does not match token");
        }
        if (Date.parse(current.value.expires_at) <= now.value.getTime()) {
          return failure("lease.expired", "expired integration lease cannot heartbeat");
        }
        if (
          current.value.base_revision !== token.base_revision ||
          current.value.target_ref !== token.target_ref
        ) {
          return failure("lease.binding_drift", "lease base or target ref differs from token");
        }
        const head = await repositoryHead(dependencies.git, token.repo);
        if (!head.ok) return head;
        if (head.value !== token.base_revision) {
          return failure("lease.base_drift", "repository HEAD changed while lease was active");
        }
        const updated: IntegrationLease = {
          ...current.value,
          last_heartbeat_at: now.value.toISOString(),
          expires_at: new Date(now.value.getTime() + token.ttl_ms).toISOString(),
        };
        const written = await writeIntegrationLease(common.value, updated, nonces.nextNonce());
        return written.ok
          ? success(tokenFromLease(tokenInput(token), common.value, updated, token.takeover_event, token.audit_evidence))
          : written;
      },
    );
  }

  async function release(token: LeaseToken): Promise<RuntimeResult<void>> {
    const common = await commonGitDir(dependencies.git, token.repo);
    if (!common.ok) return common;
    if (common.value.href !== token.common_git_dir.href) {
      return failure("lease.common_git_dir_drift", "token no longer resolves to the same common Git directory");
    }
    return withIntegrationMutex(
      common.value,
      token.holder_id,
      dependencies.clock,
      nonces,
      async () => {
        const current = await readIntegrationLease(common.value);
        if (!current.ok) return current;
        if (current.value === null) return failure("lease.not_found", "integration lease does not exist");
        return holderMatches(current.value, token)
          ? deleteIntegrationLease(common.value)
          : failure("lease.holder_mismatch", "lease holder or nonce does not match token");
      },
    );
  }

  async function takeover(input: TakeoverLeaseInput): Promise<RuntimeResult<LeaseToken>> {
    const valid = validInput(input);
    if (!valid.ok) return valid;
    const common = await commonGitDir(dependencies.git, input.repo);
    if (!common.ok) return common;
    return withIntegrationMutex(
      common.value,
      input.holder_id,
      dependencies.clock,
      nonces,
      async () => {
        const now = currentTime(dependencies.clock);
        if (!now.ok) return now;
        const current = await readIntegrationLease(common.value);
        if (!current.ok) return current;
        if (current.value === null) return failure("lease.not_found", "integration lease does not exist");
        if (Date.parse(current.value.expires_at) > now.value.getTime()) {
          return failure("lease.not_stale", "active integration lease cannot be taken over", current.value.holder_id);
        }
        const approval = takeoverApproval(input, current.value, now.value);
        if (!approval.ok) return approval;
        const head = await repositoryHead(dependencies.git, input.repo);
        if (!head.ok) return head;
        if (head.value !== input.base_revision) {
          return failure("lease.base_drift", "takeover base differs from repository HEAD", input.holder_id);
        }
        const nonce = validNonce(nonces.nextNonce());
        if (!nonce.ok) return nonce;
        const acquiredAt = now.value.toISOString();
        const lease: IntegrationLease = {
          schema_version: "1.0.0",
          holder_id: input.holder_id,
          authority_class: input.authority_class,
          base_revision: input.base_revision,
          target_ref: input.target_ref,
          acquired_at: acquiredAt,
          last_heartbeat_at: acquiredAt,
          expires_at: new Date(now.value.getTime() + input.ttl_ms).toISOString(),
          nonce: nonce.value,
          takeover_approval_id: approval.value,
        };
        const audit = takeoverAudit(input, current.value, approval.value, acquiredAt);
        const written = await writeIntegrationLease(common.value, lease, nonce.value);
        return written.ok
          ? success(tokenFromLease(input, common.value, lease, audit.event, audit.evidence))
          : written;
      },
    );
  }

  return { acquire, heartbeat, release, takeover };
}
