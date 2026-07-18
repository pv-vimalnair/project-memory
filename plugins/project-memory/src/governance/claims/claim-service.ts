import {
  canonicalJson,
  canonicalMutationPlanHash,
  failure,
  success,
  type CanonicalMutationPlan,
  type Clock,
  type PlannedWrite,
  type RuntimeResult,
} from "../../index.js";
import type {
  Approval,
  Claim,
} from "../../planning/types.js";
import type { GovernanceEvent } from "../contracts/index.js";
import {
  createAppendOnlyEventStore,
  type AppendOnlyEventStore,
} from "../events/append-only-event-store.js";
import { projectEffectiveState } from "../events/effective-state-projector.js";
import {
  findClaimConflicts,
  validateClaimCoordination,
  type ClaimConflictSubject,
} from "./claim-conflicts.js";
import {
  createClaimStore,
  type ClaimStore,
} from "./claim-store.js";

export { claimPath } from "./claim-store.js";

const PLAN_TTL_MS = 5 * 60 * 1000;
const REVISION = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export interface ClaimPlanningContext {
  readonly root_id: string;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly profile_lock_hash: string;
  readonly actor_id: string;
}

export interface ClaimPlanningContextProvider {
  context(root: URL): Promise<RuntimeResult<ClaimPlanningContext>>;
}

export interface IssueClaimInput {
  readonly root: URL;
  readonly claim: Claim;
  readonly requested_by: string;
  readonly coordination_id: string | null;
  readonly recorded_approvals: readonly Approval[];
}

export interface HeartbeatClaimInput {
  readonly root: URL;
  readonly claim_id: string;
  readonly requested_by: string;
}

export interface RenewClaimInput {
  readonly root: URL;
  readonly claim_id: string;
  readonly requested_by: string;
  readonly current_base_revision: string;
  readonly requested_expires_at: string;
  readonly coordination_id: string | null;
  readonly recorded_approvals: readonly Approval[];
}

export interface ExpireClaimInput {
  readonly root: URL;
  readonly claim_id: string;
  readonly requested_by: string;
}

export interface ClaimOperationMetadata {
  readonly governance_kind: "claim";
  readonly operation: "issue" | "heartbeat" | "renew" | "expire";
  readonly claim_id: string;
  readonly event_type:
    | "claim_issued"
    | "claim_heartbeat"
    | "claim_renewed"
    | "claim_expired";
  readonly event_hash: string;
  readonly coordination_id: string | null;
}

export type ClaimOperationPlan = CanonicalMutationPlan<ClaimOperationMetadata>;

export interface EffectiveClaim {
  readonly claim: Claim;
  readonly status: "active" | "expired";
  readonly expires_at: string;
  readonly last_heartbeat_at: string;
  readonly expiry_recorded: boolean;
  readonly event_hashes: readonly string[];
}

export interface ClaimService {
  planIssue(input: IssueClaimInput): Promise<RuntimeResult<ClaimOperationPlan>>;
  planHeartbeat(input: HeartbeatClaimInput): Promise<RuntimeResult<ClaimOperationPlan>>;
  planRenew(input: RenewClaimInput): Promise<RuntimeResult<ClaimOperationPlan>>;
  planExpire(input: ExpireClaimInput): Promise<RuntimeResult<ClaimOperationPlan>>;
  effectiveClaim(root: URL, claimId: string): Promise<RuntimeResult<EffectiveClaim>>;
}

export interface ClaimServiceDependencies {
  readonly clock: Clock;
  readonly context: ClaimPlanningContextProvider;
  readonly claims?: ClaimStore;
  readonly events?: AppendOnlyEventStore;
}

interface PlannedEvent {
  readonly write: PlannedWrite;
  readonly event: GovernanceEvent;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareUtf8);
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function validContext(context: ClaimPlanningContext): boolean {
  return (
    context.root_id.trim().length > 0 &&
    context.target_ref.trim().length > 0 &&
    REVISION.test(context.expected_head) &&
    SHA256.test(context.profile_lock_hash) &&
    context.actor_id.trim().length > 0
  );
}

function eventFromWrite(write: PlannedWrite): RuntimeResult<GovernanceEvent> {
  try {
    return success(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(write.bytes)) as GovernanceEvent,
    );
  } catch (error: unknown) {
    return failure(
      "claim.event_invalid",
      error instanceof Error ? error.message : String(error),
      write.relative_path,
    );
  }
}

function actorAuthority(claim: Claim, actorId: string): "worker" | "integrator" {
  return actorId === claim.assignee_id ? "worker" : "integrator";
}

function buildPlan(
  operation: ClaimOperationMetadata["operation"],
  claim: Claim,
  context: ClaimPlanningContext,
  requestedBy: string,
  createdAt: string,
  event: PlannedEvent,
  claimWrite: PlannedWrite | null,
  approvalIds: readonly string[],
  coordinationId: string | null,
): ClaimOperationPlan {
  const metadata: ClaimOperationMetadata = {
    governance_kind: "claim",
    operation,
    claim_id: claim.id,
    event_type: event.event.event_type as ClaimOperationMetadata["event_type"],
    event_hash: event.event.event_hash,
    coordination_id: coordinationId,
  };
  const writes = [event.write, ...(claimWrite === null ? [] : [claimWrite])].sort(
    (left, right) => compareUtf8(left.relative_path, right.relative_path),
  );
  const withoutHash: Omit<ClaimOperationPlan, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: `claim:${operation}:${claim.id}:${event.event.event_hash.slice(0, 12)}`,
    mutation_kind: "claim",
    root_id: context.root_id,
    target_ref: context.target_ref,
    expected_head: context.expected_head,
    profile_lock_hash: context.profile_lock_hash,
    writes,
    record_ids: [],
    event_ids: [event.event.event_hash],
    approval_ids: unique(approvalIds),
    evidence_ids: [],
    created_by: requestedBy,
    created_at: createdAt,
    expires_at: new Date(Date.parse(createdAt) + PLAN_TTL_MS).toISOString(),
    metadata,
  };
  return { ...withoutHash, plan_hash: canonicalMutationPlanHash(withoutHash) };
}

export function createClaimService(
  dependencies: ClaimServiceDependencies,
): ClaimService {
  const claims = dependencies.claims ?? createClaimStore();
  const events = dependencies.events ?? createAppendOnlyEventStore();

  async function planningContext(root: URL): Promise<RuntimeResult<ClaimPlanningContext>> {
    const context = await dependencies.context.context(root);
    return context.ok && validContext(context.value)
      ? context
      : context.ok
        ? failure("claim.context_invalid", "claim context must bind root, ref, head, profile, and actor")
        : context;
  }

  function currentTime(): RuntimeResult<Date> {
    const now = dependencies.clock.now();
    return Number.isFinite(now.getTime())
      ? success(now)
      : failure("claim.clock_invalid", "claim service clock must be valid");
  }

  async function plannedEvent(
    root: URL,
    claim: Claim,
    eventType: ClaimOperationMetadata["event_type"],
    actorId: string,
    occurredAt: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<RuntimeResult<PlannedEvent>> {
    const planned = await events.planAppend(root, {
      aggregate_id: claim.id,
      event_type: eventType,
      occurred_at: occurredAt,
      actor_id: actorId,
      authority_class: actorAuthority(claim, actorId),
      evidence_ids: [],
      payload,
    });
    if (!planned.ok) return planned;
    const event = eventFromWrite(planned.value);
    return event.ok ? success({ write: planned.value, event: event.value }) : event;
  }

  async function effectiveClaim(
    root: URL,
    claimId: string,
  ): Promise<RuntimeResult<EffectiveClaim>> {
    const claim = await claims.get(root, claimId);
    if (!claim.ok) return claim;
    const chain = await events.readChain(root, claimId);
    if (!chain.ok) return chain;
    const first = chain.value[0];
    if (
      first === undefined ||
      first.event_type !== "claim_issued" ||
      canonicalJson(first.payload) !== canonicalJson(claim.value)
    ) {
      return failure(
        "claim.issuance_event_mismatch",
        "immutable claim must exactly match its first issued event",
        claimId,
      );
    }
    const projected = projectEffectiveState(chain.value);
    if (!projected.ok) return projected;
    const state = projected.value.state.claim;
    if (state === null) {
      return failure("claim.state_missing", "claim event chain has no effective state", claimId);
    }
    const expiresAt = text(state, "expires_at") ?? claim.value.expires_at;
    const heartbeatAt =
      text(state, "last_heartbeat_at") ?? claim.value.last_heartbeat_at;
    const expires = timestamp(expiresAt);
    const heartbeat = timestamp(heartbeatAt);
    const now = currentTime();
    if (!now.ok) return now;
    if (expires === null || heartbeat === null) {
      return failure("claim.state_invalid", "effective claim timestamps are invalid", claimId);
    }
    const expiryRecorded = chain.value.some((event) => event.event_type === "claim_expired");
    const eventStatus = text(state, "status");
    return success({
      claim: claim.value,
      status:
        expiryRecorded || eventStatus === "expired" || expires <= now.value.getTime()
          ? "expired"
          : "active",
      expires_at: expiresAt,
      last_heartbeat_at: heartbeatAt,
      expiry_recorded: expiryRecorded,
      event_hashes: chain.value.map((event) => event.event_hash),
    });
  }

  async function activeSubjects(
    root: URL,
    excludeId: string,
  ): Promise<RuntimeResult<readonly ClaimConflictSubject[]>> {
    const immutable = await claims.list(root);
    if (!immutable.ok) return immutable;
    const subjects: ClaimConflictSubject[] = [];
    for (const claim of immutable.value) {
      if (claim.id === excludeId) continue;
      const effective = await effectiveClaim(root, claim.id);
      if (!effective.ok) return effective;
      subjects.push({
        claim,
        status: effective.value.status,
        expires_at: effective.value.expires_at,
      });
    }
    return success(subjects);
  }

  async function planIssue(
    input: IssueClaimInput,
  ): Promise<RuntimeResult<ClaimOperationPlan>> {
    const now = currentTime();
    if (!now.ok) return now;
    const context = await planningContext(input.root);
    if (!context.ok) return context;
    if (
      input.requested_by !== input.claim.issuer ||
      context.value.actor_id !== input.claim.issuer
    ) {
      return failure("claim.issuer_required", "only the authoritative issuer may issue a claim", input.claim.id);
    }
    const issuedAt = timestamp(input.claim.issued_at);
    const expiresAt = timestamp(input.claim.expires_at);
    const heartbeatAt = timestamp(input.claim.last_heartbeat_at);
    if (
      input.claim.base_revision !== context.value.expected_head ||
      issuedAt === null ||
      expiresAt === null ||
      heartbeatAt === null ||
      issuedAt > now.value.getTime() ||
      heartbeatAt < issuedAt ||
      heartbeatAt > now.value.getTime() ||
      expiresAt <= now.value.getTime()
    ) {
      return failure("claim.issue_invalid", "issued claim must bind the current base and a live time window", input.claim.id);
    }
    const claimWrite = await claims.planCreate(input.root, input.claim);
    if (!claimWrite.ok) return claimWrite;
    const subjects = await activeSubjects(input.root, input.claim.id);
    if (!subjects.ok) return subjects;
    const conflicts = findClaimConflicts(input.claim, subjects.value, now.value);
    if (!conflicts.ok) return conflicts;
    const approvalIds = validateClaimCoordination(
      input.claim,
      conflicts.value,
      input.coordination_id,
      input.recorded_approvals,
      now.value,
    );
    if (!approvalIds.ok) return approvalIds;
    const event = await plannedEvent(
      input.root,
      input.claim,
      "claim_issued",
      input.requested_by,
      now.value.toISOString(),
      { ...input.claim },
    );
    return event.ok
      ? success(buildPlan("issue", input.claim, context.value, input.requested_by, now.value.toISOString(), event.value, claimWrite.value, approvalIds.value, input.coordination_id))
      : event;
  }

  async function planHeartbeat(
    input: HeartbeatClaimInput,
  ): Promise<RuntimeResult<ClaimOperationPlan>> {
    const now = currentTime();
    if (!now.ok) return now;
    const effective = await effectiveClaim(input.root, input.claim_id);
    if (!effective.ok) return effective;
    if (effective.value.status !== "active") {
      return failure("claim.expired", "expired claim cannot heartbeat", input.claim_id);
    }
    const claim = effective.value.claim;
    if (input.requested_by !== claim.assignee_id && input.requested_by !== claim.issuer) {
      return failure("claim.heartbeat_actor_invalid", "heartbeat actor must be claim issuer or assignee", input.claim_id);
    }
    const context = await planningContext(input.root);
    if (!context.ok) return context;
    if (context.value.expected_head !== claim.base_revision) {
      return failure("claim.base_changed", "claim base changed before heartbeat", input.claim_id);
    }
    const event = await plannedEvent(
      input.root,
      claim,
      "claim_heartbeat",
      input.requested_by,
      now.value.toISOString(),
      { last_heartbeat_at: now.value.toISOString() },
    );
    return event.ok
      ? success(buildPlan("heartbeat", claim, context.value, input.requested_by, now.value.toISOString(), event.value, null, [], null))
      : event;
  }

  async function planRenew(
    input: RenewClaimInput,
  ): Promise<RuntimeResult<ClaimOperationPlan>> {
    const now = currentTime();
    if (!now.ok) return now;
    const effective = await effectiveClaim(input.root, input.claim_id);
    if (!effective.ok) return effective;
    const claim = effective.value.claim;
    if (input.requested_by !== claim.issuer) {
      return failure("claim.issuer_required", "only the original issuer may renew a claim", input.claim_id);
    }
    const context = await planningContext(input.root);
    if (!context.ok) return context;
    if (
      input.current_base_revision !== claim.base_revision ||
      context.value.expected_head !== claim.base_revision
    ) {
      return failure("claim.base_changed", "claim base changed; issue a new claim", input.claim_id);
    }
    const requestedExpiry = timestamp(input.requested_expires_at);
    if (effective.value.status !== "active" || requestedExpiry === null || requestedExpiry <= now.value.getTime()) {
      return failure("claim.renewal_invalid", "renewal requires an active claim and future expiry", input.claim_id);
    }
    const subjects = await activeSubjects(input.root, claim.id);
    if (!subjects.ok) return subjects;
    const conflicts = findClaimConflicts(claim, subjects.value, now.value);
    if (!conflicts.ok) return conflicts;
    const approvals = validateClaimCoordination(
      claim,
      conflicts.value,
      input.coordination_id,
      input.recorded_approvals,
      now.value,
    );
    if (!approvals.ok) return approvals;
    const event = await plannedEvent(
      input.root,
      claim,
      "claim_renewed",
      input.requested_by,
      now.value.toISOString(),
      { expires_at: input.requested_expires_at },
    );
    return event.ok
      ? success(buildPlan("renew", claim, context.value, input.requested_by, now.value.toISOString(), event.value, null, approvals.value, input.coordination_id))
      : event;
  }

  async function planExpire(
    input: ExpireClaimInput,
  ): Promise<RuntimeResult<ClaimOperationPlan>> {
    const now = currentTime();
    if (!now.ok) return now;
    const effective = await effectiveClaim(input.root, input.claim_id);
    if (!effective.ok) return effective;
    const claim = effective.value.claim;
    if (input.requested_by !== claim.issuer) {
      return failure("claim.issuer_required", "only the original issuer may record expiry", input.claim_id);
    }
    if (effective.value.expiry_recorded) {
      return failure("claim.expiry_recorded", "claim expiry is already recorded", input.claim_id);
    }
    const context = await planningContext(input.root);
    if (!context.ok) return context;
    const event = await plannedEvent(
      input.root,
      claim,
      "claim_expired",
      input.requested_by,
      now.value.toISOString(),
      { expired_at: now.value.toISOString() },
    );
    return event.ok
      ? success(buildPlan("expire", claim, context.value, input.requested_by, now.value.toISOString(), event.value, null, [], null))
      : event;
  }

  return { planIssue, planHeartbeat, planRenew, planExpire, effectiveClaim };
}
