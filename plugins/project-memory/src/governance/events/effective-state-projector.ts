import { failure, success, type RuntimeResult } from "../../index.js";

import type { GovernanceEvent } from "../contracts/index.js";
import { verifyEventChain } from "./event-chain-verifier.js";

export const SUPPORTED_EVENT_TRANSITIONS = Object.freeze([
  "bootstrap_initialized",
  "record_created",
  "record_superseded",
  "status_changed",
  "claim_issued",
  "claim_heartbeat",
  "claim_renewed",
  "claim_expired",
  "integration_validated",
  "integrated_verified",
  "lease_taken_over",
  "satellite_prepared",
  "hub_finalized",
] as const);

type SupportedEventTransition = (typeof SUPPORTED_EVENT_TRANSITIONS)[number];
type EffectivePayload = Readonly<Record<string, unknown>>;

export interface EffectiveAggregateState {
  readonly bootstrap: EffectivePayload | null;
  readonly record_ids: readonly string[];
  readonly superseded_record_ids: readonly string[];
  readonly status: string | null;
  readonly claim: EffectivePayload | null;
  readonly integration: EffectivePayload | null;
  readonly lease: EffectivePayload | null;
  readonly prepared_satellites: readonly EffectivePayload[];
  readonly hub_finalization: EffectivePayload | null;
}

export interface EffectiveStateProjection {
  readonly aggregate_id: string;
  readonly history: readonly GovernanceEvent[];
  readonly applied_event_hashes: readonly string[];
  readonly unknown_event_hashes: readonly string[];
  readonly state: EffectiveAggregateState;
}

interface MutableState {
  bootstrap: EffectivePayload | null;
  record_ids: string[];
  superseded_record_ids: string[];
  status: string | null;
  claim: EffectivePayload | null;
  integration: EffectivePayload | null;
  lease: EffectivePayload | null;
  prepared_satellites: EffectivePayload[];
  hub_finalization: EffectivePayload | null;
}

function isSupported(value: string): value is SupportedEventTransition {
  return (SUPPORTED_EVENT_TRANSITIONS as readonly string[]).includes(value);
}

function payloadOf(event: GovernanceEvent): EffectivePayload {
  return event.payload;
}

function payloadText(payload: EffectivePayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function invalidTransition(
  event: GovernanceEvent,
  message: string,
): RuntimeResult<never> {
  return failure("event.transition_invalid", message, event.event_hash, [event.event_type]);
}

function applyTransition(
  state: MutableState,
  event: GovernanceEvent,
): RuntimeResult<true> {
  const payload = payloadOf(event);
  switch (event.event_type as SupportedEventTransition) {
    case "bootstrap_initialized":
      if (state.bootstrap !== null) {
        return invalidTransition(event, "bootstrap can be initialized only once");
      }
      state.bootstrap = payload;
      return success(true);
    case "record_created":
      appendUnique(state.record_ids, payloadText(payload, "record_id") ?? event.aggregate_id);
      return success(true);
    case "record_superseded":
      appendUnique(
        state.superseded_record_ids,
        payloadText(payload, "previous_record_id") ?? event.aggregate_id,
      );
      if (payloadText(payload, "replacement_record_id") !== null) {
        appendUnique(
          state.record_ids,
          payloadText(payload, "replacement_record_id") as string,
        );
      }
      return success(true);
    case "status_changed": {
      const status = payloadText(payload, "status");
      if (status === null) {
        return invalidTransition(event, "status_changed requires a non-empty status");
      }
      state.status = status;
      return success(true);
    }
    case "claim_issued":
      if (state.claim !== null) {
        return invalidTransition(event, "claim_issued cannot repeat for one aggregate");
      }
      state.claim = { ...payload, status: payloadText(payload, "status") ?? "active" };
      return success(true);
    case "claim_heartbeat":
      if (state.claim === null) {
        return invalidTransition(event, "claim_heartbeat requires claim_issued");
      }
      state.claim = { ...state.claim, ...payload };
      return success(true);
    case "claim_renewed":
      if (state.claim === null || state.claim.status === "expired") {
        return invalidTransition(event, "claim_renewed requires a non-expired claim");
      }
      state.claim = { ...state.claim, ...payload, status: "active" };
      return success(true);
    case "claim_expired":
      if (state.claim === null) {
        return invalidTransition(event, "claim_expired requires claim_issued");
      }
      state.claim = { ...state.claim, ...payload, status: "expired" };
      return success(true);
    case "integration_validated":
      state.integration = { ...payload, status: "validated" };
      return success(true);
    case "integrated_verified":
      if (state.integration === null) {
        return invalidTransition(event, "integrated_verified requires validation");
      }
      state.integration = { ...state.integration, ...payload, status: "integrated_verified" };
      return success(true);
    case "lease_taken_over":
      state.lease = payload;
      return success(true);
    case "satellite_prepared":
      state.prepared_satellites.push(payload);
      return success(true);
    case "hub_finalized":
      state.hub_finalization = payload;
      return success(true);
  }
}

export function projectEffectiveState(
  events: readonly GovernanceEvent[],
): RuntimeResult<EffectiveStateProjection> {
  const verified = verifyEventChain(events);
  if (!verified.ok) return verified;
  const aggregateId = verified.value.aggregate_id;
  if (aggregateId === null) {
    return failure("event.chain_empty", "effective state requires a non-empty event chain");
  }

  const state: MutableState = {
    bootstrap: null,
    record_ids: [],
    superseded_record_ids: [],
    status: null,
    claim: null,
    integration: null,
    lease: null,
    prepared_satellites: [],
    hub_finalization: null,
  };
  const appliedEventHashes: string[] = [];
  const unknownEventHashes: string[] = [];
  for (const event of events) {
    if (!isSupported(event.event_type)) {
      unknownEventHashes.push(event.event_hash);
      continue;
    }
    const applied = applyTransition(state, event);
    if (!applied.ok) return applied;
    appliedEventHashes.push(event.event_hash);
  }

  return success({
    aggregate_id: aggregateId,
    history: Object.freeze([...events]),
    applied_event_hashes: Object.freeze(appliedEventHashes),
    unknown_event_hashes: Object.freeze(unknownEventHashes),
    state: {
      ...state,
      record_ids: Object.freeze([...state.record_ids]),
      superseded_record_ids: Object.freeze([...state.superseded_record_ids]),
      prepared_satellites: Object.freeze([...state.prepared_satellites]),
    },
  });
}
