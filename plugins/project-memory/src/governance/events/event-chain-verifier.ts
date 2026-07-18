import {
  canonicalJson,
  failure,
  sha256,
  success,
  type RuntimeResult,
} from "../../index.js";

import type {
  GovernanceEvent,
  UnsignedGovernanceEvent,
} from "../contracts/index.js";

export interface EventChainVerification {
  readonly valid: true;
  readonly aggregate_id: string | null;
  readonly event_count: number;
  readonly last_sequence: number;
  readonly head_event_hash: string | null;
}

export function unsignedEvent(event: GovernanceEvent): UnsignedGovernanceEvent {
  return {
    aggregate_id: event.aggregate_id,
    event_type: event.event_type,
    occurred_at: event.occurred_at,
    actor_id: event.actor_id,
    authority_class: event.authority_class,
    evidence_ids: event.evidence_ids,
    payload: event.payload,
  };
}

export function signEvent(
  unsigned: UnsignedGovernanceEvent,
  previous: GovernanceEvent | null,
): GovernanceEvent {
  const payloadHash = sha256(canonicalJson(unsigned.payload));
  const body: Omit<GovernanceEvent, "event_hash"> = {
    ...unsigned,
    sequence: previous === null ? 1 : previous.sequence + 1,
    previous_event_hash: previous?.event_hash ?? null,
    payload_hash: payloadHash,
  };
  return { ...body, event_hash: sha256(canonicalJson(body)) };
}

export function verifyEventChain(
  events: readonly GovernanceEvent[],
): RuntimeResult<EventChainVerification> {
  if (events.length === 0) {
    return success({
      valid: true,
      aggregate_id: null,
      event_count: 0,
      last_sequence: 0,
      head_event_hash: null,
    });
  }

  const aggregateId = events[0]?.aggregate_id ?? null;
  let previous: GovernanceEvent | null = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) continue;
    const expectedPayloadHash = sha256(canonicalJson(event.payload));
    const { event_hash: eventHash, ...body } = event;
    const expectedEventHash = sha256(canonicalJson(body));
    if (event.payload_hash !== expectedPayloadHash || eventHash !== expectedEventHash) {
      return failure(
        "event.hash_mismatch",
        "event payload or body hash does not match its canonical content",
        eventHash,
      );
    }
    if (event.aggregate_id !== aggregateId) {
      return failure(
        "event.aggregate_mismatch",
        "every event in a chain must use the same aggregate ID",
        eventHash,
        [aggregateId ?? ""],
      );
    }
    const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) {
      return failure(
        "event.sequence_gap",
        "event sequences must be contiguous and begin at one",
        eventHash,
        [String(expectedSequence), String(event.sequence)],
      );
    }
    const expectedPreviousHash = previous?.event_hash ?? null;
    if (event.previous_event_hash !== expectedPreviousHash) {
      return failure(
        "event.previous_hash_mismatch",
        "event does not reference the immediately preceding event hash",
        eventHash,
        expectedPreviousHash === null ? [] : [expectedPreviousHash],
      );
    }
    previous = event;
  }

  const head = events.at(-1);
  return success({
    valid: true,
    aggregate_id: aggregateId,
    event_count: events.length,
    last_sequence: head?.sequence ?? 0,
    head_event_hash: head?.event_hash ?? null,
  });
}
