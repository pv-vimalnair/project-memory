import { failure, success, type RuntimeResult } from "../../index.js";

import type { CanonicalRecord } from "../contracts/index.js";

export interface SupersessionIndex {
  readonly records_by_id: ReadonlyMap<string, CanonicalRecord>;
  readonly supersedes_by_id: ReadonlyMap<string, readonly string[]>;
  readonly superseded_by_id: ReadonlyMap<string, readonly string[]>;
  readonly superseded_ids: ReadonlySet<string>;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sortedMap(
  source: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, readonly string[]> {
  return new Map(
    [...source.entries()]
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([id, values]) => [id, Object.freeze([...values].sort(compareUtf8))]),
  );
}

function detectCycle(
  ids: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): RuntimeResult<true> {
  const state = new Map<string, "visiting" | "visited">();

  function visit(id: string): RuntimeResult<true> {
    const current = state.get(id);
    if (current === "visiting") {
      return failure(
        "record.supersession_cycle",
        "supersession relationships must form an acyclic history",
        id,
      );
    }
    if (current === "visited") return success(true);
    state.set(id, "visiting");
    for (const target of edges.get(id) ?? []) {
      const result = visit(target);
      if (!result.ok) return result;
    }
    state.set(id, "visited");
    return success(true);
  }

  for (const id of ids) {
    const result = visit(id);
    if (!result.ok) return result;
  }
  return success(true);
}

export function buildSupersessionIndex(
  records: readonly CanonicalRecord[],
): RuntimeResult<SupersessionIndex> {
  const recordsById = new Map<string, CanonicalRecord>();
  for (const record of records) {
    if (recordsById.has(record.id)) {
      return failure(
        "record.id_duplicate",
        "canonical record IDs must be unique across every record directory",
        record.id,
      );
    }
    recordsById.set(record.id, record);
  }

  const supersedesById = new Map<string, readonly string[]>();
  const supersededById = new Map<string, string[]>();
  for (const record of records) {
    const targets = record.relationships
      .filter((relationship) => relationship.type === "supersedes")
      .map((relationship) => relationship.target_id)
      .sort(compareUtf8);
    supersedesById.set(record.id, targets);
    for (const targetId of targets) {
      const target = recordsById.get(targetId);
      if (target === undefined) {
        return failure(
          "record.supersession_target_missing",
          "a supersession relationship must reference an existing immutable record",
          record.id,
          [targetId],
        );
      }
      if (target.root_id !== record.root_id) {
        return failure(
          "record.root_mismatch",
          "a supersession relationship cannot cross product roots",
          record.id,
          [targetId],
        );
      }
      if (target.type !== record.type) {
        return failure(
          "record.fact_class_mismatch",
          "a supersession relationship must preserve the canonical fact class",
          record.id,
          [targetId],
        );
      }
      const replacements = supersededById.get(targetId) ?? [];
      replacements.push(record.id);
      supersededById.set(targetId, replacements);
    }
  }

  const sortedIds = [...recordsById.keys()].sort(compareUtf8);
  const acyclic = detectCycle(sortedIds, supersedesById);
  if (!acyclic.ok) return acyclic;

  return success({
    records_by_id: new Map(
      [...recordsById.entries()].sort(([left], [right]) => compareUtf8(left, right)),
    ),
    supersedes_by_id: sortedMap(supersedesById),
    superseded_by_id: sortedMap(supersededById),
    superseded_ids: new Set([...supersededById.keys()].sort(compareUtf8)),
  });
}
