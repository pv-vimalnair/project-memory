import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type {
  InitiativePlan,
  OutcomeIntent,
} from "./types.js";

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function normalized(outcome: OutcomeIntent): OutcomeIntent {
  return {
    ...outcome,
    acceptanceCriteria: [...outcome.acceptanceCriteria].sort(compareUtf8),
    dependsOnOutcomeIds: [...outcome.dependsOnOutcomeIds].sort(compareUtf8),
  };
}

function validateOutcome(outcome: OutcomeIntent): RuntimeResult<true> {
  if (
    outcome.id.trim().length === 0 ||
    outcome.statement.trim().length === 0 ||
    outcome.acceptanceCriteria.length === 0 ||
    outcome.acceptanceCriteria.some((criterion) => criterion.trim().length === 0)
  ) {
    return failure(
      "outcome.invalid",
      "every outcome requires an ID, statement, and terminal acceptance criteria",
      outcome.id,
    );
  }
  if (new Set(outcome.dependsOnOutcomeIds).size !== outcome.dependsOnOutcomeIds.length) {
    return failure(
      "outcome.duplicate_dependency",
      "outcome dependencies must be unique",
      outcome.id,
    );
  }
  return success(true);
}

export function decomposeOutcomes(
  outcomes: readonly OutcomeIntent[],
): RuntimeResult<InitiativePlan> {
  if (outcomes.length === 0) {
    return failure(
      "outcome.required",
      "at least one bounded outcome is required",
    );
  }
  const byId = new Map<string, OutcomeIntent>();
  for (const outcome of outcomes) {
    const valid = validateOutcome(outcome);
    if (!valid.ok) return valid;
    if (byId.has(outcome.id)) {
      return failure(
        "outcome.duplicate_id",
        "outcome IDs must be unique",
        outcome.id,
      );
    }
    byId.set(outcome.id, normalized(outcome));
  }

  const outgoing = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  const edges: { readonly from: string; readonly to: string }[] = [];
  for (const id of byId.keys()) {
    outgoing.set(id, new Set());
    indegree.set(id, 0);
  }
  for (const outcome of byId.values()) {
    for (const dependency of outcome.dependsOnOutcomeIds) {
      if (!byId.has(dependency)) {
        return failure(
          "outcome.unknown_dependency",
          "outcome dependency is not part of this decomposition",
          outcome.id,
          [dependency],
        );
      }
      outgoing.get(dependency)?.add(outcome.id);
      indegree.set(outcome.id, (indegree.get(outcome.id) ?? 0) + 1);
      edges.push({ from: dependency, to: outcome.id });
    }
  }

  const ready = [...byId.keys()]
    .filter((id) => indegree.get(id) === 0)
    .sort(compareUtf8);
  const ordered: OutcomeIntent[] = [];
  while (ready.length > 0) {
    const id = ready.shift();
    if (id === undefined) break;
    const outcome = byId.get(id);
    if (outcome === undefined) continue;
    ordered.push(outcome);
    for (const dependent of [...(outgoing.get(id) ?? [])].sort(compareUtf8)) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort(compareUtf8);
      }
    }
  }
  if (ordered.length !== byId.size) {
    const cyclic = [...byId.keys()]
      .filter((id) => (indegree.get(id) ?? 0) > 0)
      .sort(compareUtf8);
    return failure(
      "outcome.dependency_cycle",
      "outcome dependencies must form an acyclic workstream graph",
      cyclic[0] ?? "outcomes",
      cyclic,
    );
  }
  edges.sort(
    (left, right) =>
      compareUtf8(left.from, right.from) || compareUtf8(left.to, right.to),
  );
  return success({ workstreams: ordered, dependencyEdges: edges });
}
