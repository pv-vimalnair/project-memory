import { lstat, readFile, readdir } from "node:fs/promises";

import {
  canonicalJson,
  decodeStrictUtf8,
  failure,
  parseJsonDocument,
  resolveInside,
  success,
  validateWithSchema,
  type PlannedWrite,
  type RuntimeIssue,
  type RuntimeResult,
} from "../../index.js";

import type {
  GovernanceEvent,
  UnsignedGovernanceEvent,
} from "../contracts/index.js";
import {
  signEvent,
  unsignedEvent,
  verifyEventChain,
  type EventChainVerification,
} from "./event-chain-verifier.js";

const EVENT_SCHEMA_ID = "project-memory/v1/governance-event" as const;
const SAFE_AGGREGATE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface AppendOnlyEventStore {
  planAppend(
    root: URL,
    event: UnsignedGovernanceEvent,
  ): Promise<RuntimeResult<PlannedWrite>>;
  readChain(
    root: URL,
    aggregateId: string,
  ): Promise<RuntimeResult<readonly GovernanceEvent[]>>;
  verifyChain(
    root: URL,
    aggregateId: string,
  ): Promise<RuntimeResult<EventChainVerification>>;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function translatedFailure<T>(
  code: string,
  message: string,
  path: string,
  issues: readonly RuntimeIssue[],
): RuntimeResult<T> {
  return failure(
    code,
    message,
    path,
    issues.map((issue) => `${issue.code}:${issue.path}`),
  );
}

function validateAggregateId(aggregateId: string): RuntimeResult<true> {
  return SAFE_AGGREGATE_ID.test(aggregateId)
    ? success(true)
    : failure(
        "event.aggregate_id_unsafe",
        "event aggregate IDs must be portable single path segments",
        aggregateId,
      );
}

export function filenameSafeUtc(value: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}\.\d{3})Z$/.exec(value);
  if (match === null) {
    throw new TypeError("event.occurred_at must be RFC3339 UTC with milliseconds");
  }
  const [, year = "", month = "", day = "", hour = "", minute = "", second = ""] =
    match;
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

export function eventPath(event: GovernanceEvent): string {
  const timestamp = filenameSafeUtc(event.occurred_at);
  return `docs/project-memory/governance/events/${event.aggregate_id}/${timestamp}-${event.event_hash}.json`;
}

function eventWrite(event: GovernanceEvent): PlannedWrite {
  return {
    relative_path: eventPath(event),
    bytes: new TextEncoder().encode(canonicalJson(event)),
    expected_existing_sha256: null,
    mode: "create",
  };
}

function validateEvent(value: unknown, source: string): RuntimeResult<GovernanceEvent> {
  const result = validateWithSchema<GovernanceEvent>(EVENT_SCHEMA_ID, value);
  return result.ok
    ? result
    : translatedFailure(
        "event.schema_invalid",
        "governance event does not satisfy its registered schema",
        source,
        result.issues,
      );
}

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

async function readEvent(
  root: URL,
  relativePath: string,
  aggregateId: string,
): Promise<RuntimeResult<GovernanceEvent>> {
  const resolved = await resolveInside(root, relativePath);
  if (!resolved.ok) return resolved;
  let bytes: Uint8Array;
  try {
    const stat = await lstat(resolved.value);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure(
        "event.path_unsafe",
        "governance events must be regular files",
        relativePath,
      );
    }
    bytes = new Uint8Array(await readFile(resolved.value));
  } catch (error: unknown) {
    return failure(
      "event.read_failed",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }

  const decoded = decodeStrictUtf8(bytes, relativePath);
  if (!decoded.ok) {
    return translatedFailure(
      "event.document_invalid",
      "governance event must use strict UTF-8",
      relativePath,
      decoded.issues,
    );
  }
  const parsed = parseJsonDocument(decoded.value, relativePath);
  if (!parsed.ok) {
    return translatedFailure(
      "event.document_invalid",
      "governance event must be strict JSON",
      relativePath,
      parsed.issues,
    );
  }
  const validated = validateEvent(parsed.value, relativePath);
  if (!validated.ok) return validated;
  if (validated.value.aggregate_id !== aggregateId) {
    return failure(
      "event.aggregate_mismatch",
      "event aggregate does not match its canonical directory",
      relativePath,
      [aggregateId],
    );
  }
  let expectedPath: string;
  try {
    expectedPath = eventPath(validated.value);
  } catch (error: unknown) {
    return failure(
      "event.timestamp_invalid",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
  if (expectedPath !== relativePath) {
    return failure(
      "event.path_mismatch",
      "event timestamp and hash must match its canonical filename",
      relativePath,
      [expectedPath],
    );
  }
  const expectedBytes = new TextEncoder().encode(canonicalJson(validated.value));
  if (!byteEqual(bytes, expectedBytes)) {
    return failure(
      "event.noncanonical",
      "event bytes must match deterministic canonical JSON",
      relativePath,
    );
  }
  return success(validated.value);
}

async function loadChain(
  root: URL,
  aggregateId: string,
): Promise<RuntimeResult<readonly GovernanceEvent[]>> {
  const safeAggregate = validateAggregateId(aggregateId);
  if (!safeAggregate.ok) return safeAggregate;
  const relativeDirectory = `docs/project-memory/governance/events/${aggregateId}`;
  const resolved = await resolveInside(root, relativeDirectory);
  if (!resolved.ok) return resolved;

  let entries;
  try {
    const stat = await lstat(resolved.value);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return failure(
        "event.directory_unsafe",
        "event-chain paths must be real directories",
        relativeDirectory,
      );
    }
    entries = await readdir(resolved.value, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return success([]);
    return failure(
      "event.directory_read_failed",
      error instanceof Error ? error.message : String(error),
      relativeDirectory,
    );
  }

  const events: GovernanceEvent[] = [];
  for (const entry of entries.sort((left, right) => compareUtf8(left.name, right.name))) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
      return failure(
        "event.directory_entry_unsafe",
        "event directories may contain canonical JSON files only",
        relativePath,
      );
    }
    const event = await readEvent(root, relativePath, aggregateId);
    if (!event.ok) return event;
    events.push(event.value);
  }
  events.sort(
    (left, right) =>
      left.sequence - right.sequence || compareUtf8(left.event_hash, right.event_hash),
  );
  return success(events);
}

function sameUnsigned(
  event: GovernanceEvent,
  unsigned: UnsignedGovernanceEvent,
): boolean {
  return canonicalJson(unsignedEvent(event)) === canonicalJson(unsigned);
}

export function createAppendOnlyEventStore(): AppendOnlyEventStore {
  async function readChain(
    root: URL,
    aggregateId: string,
  ): Promise<RuntimeResult<readonly GovernanceEvent[]>> {
    const events = await loadChain(root, aggregateId);
    if (!events.ok) return events;
    const verified = verifyEventChain(events.value);
    return verified.ok ? success(events.value) : verified;
  }

  async function verifyChain(
    root: URL,
    aggregateId: string,
  ): Promise<RuntimeResult<EventChainVerification>> {
    const events = await loadChain(root, aggregateId);
    if (!events.ok) return events;
    const verified = verifyEventChain(events.value);
    if (!verified.ok) return verified;
    return success({
      ...verified.value,
      aggregate_id: verified.value.aggregate_id ?? aggregateId,
    });
  }

  async function planAppend(
    root: URL,
    unsigned: UnsignedGovernanceEvent,
  ): Promise<RuntimeResult<PlannedWrite>> {
    const safeAggregate = validateAggregateId(unsigned.aggregate_id);
    if (!safeAggregate.ok) return safeAggregate;
    const existing = await readChain(root, unsigned.aggregate_id);
    if (!existing.ok) return existing;
    try {
      const identical = existing.value.find((event) => sameUnsigned(event, unsigned));
      if (identical !== undefined) {
        return success(eventWrite(identical), [
          {
            code: "event.already_appended",
            severity: "warning",
            path: eventPath(identical),
            message: "the identical immutable event is already present",
            references: [identical.event_hash],
          },
        ]);
      }
      const signed = signEvent(unsigned, existing.value.at(-1) ?? null);
      const validated = validateEvent(signed, unsigned.aggregate_id);
      if (!validated.ok) return validated;
      const write = eventWrite(validated.value);
      const confined = await resolveInside(root, write.relative_path);
      return confined.ok ? success(write) : confined;
    } catch (error: unknown) {
      return failure(
        "event.payload_invalid",
        error instanceof Error ? error.message : String(error),
        unsigned.aggregate_id,
      );
    }
  }

  return { planAppend, readChain, verifyChain };
}
