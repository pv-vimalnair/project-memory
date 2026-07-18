import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type {
  ImpactEntry,
  ImpactMergeInput,
  ResolvedImpact,
  ResolvedImpactPlan,
} from "./types.js";

const MUTATION_DUTIES = new Set(["modify", "release", "notify"]);
const ROLE_RANK = {
  worker: 1,
  validator: 2,
  integrator: 3,
  Pitaji: 4,
} as const;

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareUtf8);
}

function validPath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    !value.split("/").includes("..") &&
    (!value.includes("*") || value === "**" || value.endsWith("/**"))
  );
}

function pathCovers(scope: string, candidate: string): boolean {
  if (scope === "**") return true;
  if (scope === candidate) return true;
  if (!scope.endsWith("/**")) return false;
  const base = scope.slice(0, -3);
  return candidate === base || candidate.startsWith(`${base}/`);
}

function pathIntersection(left: string, right: string): string | null {
  if (pathCovers(left, right)) return right;
  if (pathCovers(right, left)) return left;
  return null;
}

function intersectScopes(scopes: readonly (readonly string[])[]): string[] {
  if (scopes.length === 0) return [];
  let current = unique(scopes[0] ?? []);
  for (const scope of scopes.slice(1)) {
    const intersections: string[] = [];
    for (const left of current) {
      for (const right of scope) {
        const intersected = pathIntersection(left, right);
        if (intersected !== null) intersections.push(intersected);
      }
    }
    current = unique(intersections);
    if (current.length === 0) return [];
  }
  return current;
}

function targetKey(entry: Pick<ImpactEntry, "targetKind" | "targetId">): string {
  return `${entry.targetKind}:${entry.targetId}`;
}

function requiresMutation(entries: readonly ImpactEntry[]): boolean {
  return entries.some((entry) =>
    entry.duties.some((duty) => MUTATION_DUTIES.has(duty)),
  );
}

function strictestRole(
  entries: readonly ImpactEntry[],
): ResolvedImpact["responsibleRole"] {
  return [...entries]
    .map((entry) => entry.responsibleRole)
    .sort((left, right) => ROLE_RANK[right] - ROLE_RANK[left])[0] ?? "worker";
}

function validateKnownTargets(input: ImpactMergeInput): RuntimeResult<true> {
  const known = new Set(Object.keys(input.ownedPathsByTarget));
  const entries = [
    ...input.immutableImpacts,
    ...input.rootPolicyImpacts,
    ...input.overlayImpacts,
    ...input.patternImpacts,
  ].sort((left, right) => compareUtf8(left.targetId, right.targetId));
  const unknown = entries.find((entry) => !known.has(entry.targetId));
  if (unknown !== undefined) {
    return failure(
      "impact.unknown_target",
      "impact target is not present in the locked profile",
      unknown.targetId,
      [unknown.sourceId],
    );
  }
  const unknownEdge = input.dependencyEdges.find(
    (edge) => !known.has(edge.from) || !known.has(edge.to),
  );
  if (unknownEdge !== undefined) {
    return failure(
      "impact.unknown_target",
      "dependency edge references a target outside the locked profile",
      `${unknownEdge.from}->${unknownEdge.to}`,
    );
  }
  return success(true);
}

function validatePaths(input: ImpactMergeInput): RuntimeResult<true> {
  const paths = [
    ...Object.values(input.ownedPathsByTarget).flat(),
    ...input.claimCandidatePaths,
    ...input.acceptedDecisionScopes.flat(),
    ...input.approvalScopes.flat(),
    ...input.immutableImpacts.flatMap((entry) => [
      ...entry.readPaths,
      ...entry.writePaths,
    ]),
    ...input.rootPolicyImpacts.flatMap((entry) => [
      ...entry.readPaths,
      ...entry.writePaths,
    ]),
    ...input.overlayImpacts.flatMap((entry) => [
      ...entry.readPaths,
      ...entry.writePaths,
    ]),
    ...input.patternImpacts.flatMap((entry) => [
      ...entry.readPaths,
      ...entry.writePaths,
    ]),
  ];
  const invalid = paths.find((entry) => !validPath(entry));
  return invalid === undefined
    ? success(true)
    : failure(
        "impact.path_invalid",
        "impact paths must be confined forward-slash paths or trailing glob scopes",
        invalid,
      );
}

function mergeTarget(
  entries: readonly ImpactEntry[],
  input: ImpactMergeInput,
): RuntimeResult<ResolvedImpact> {
  const first = entries[0];
  if (first === undefined) {
    return failure("impact.empty_target", "impact target has no entries");
  }
  const hasRequired = entries.some((entry) => entry.requirement === "required");
  const hasNotApplicable = entries.some(
    (entry) => entry.requirement === "not_applicable",
  );
  if (hasRequired && hasNotApplicable) {
    return failure(
      "impact.required_not_applicable",
      "required impact conflicts with immutable not-applicable state",
      first.targetId,
      entries.map((entry) => entry.sourceId).sort(compareUtf8),
    );
  }
  const duties = unique(entries.flatMap((entry) => entry.duties));
  if (
    duties.includes("no-touch") &&
    duties.some((duty) => MUTATION_DUTIES.has(duty))
  ) {
    return failure(
      "impact.no_touch_conflict",
      "no-touch policy conflicts with mutation duties",
      first.targetId,
    );
  }

  const mutation = requiresMutation(entries);
  let writePaths: string[] = [];
  if (mutation) {
    const approvalRequired =
      input.approvalRequired === true ||
      duties.includes("release") ||
      entries.some((entry) => entry.responsibleRole === "Pitaji");
    if (approvalRequired && input.approvalScopes.length === 0) {
      return failure(
        "impact.missing_required_approval",
        "mutation requires an explicit applicable approval scope",
        first.targetId,
      );
    }
    const scopes: (readonly string[])[] = [
      unique(entries.flatMap((entry) => entry.writePaths)),
      input.ownedPathsByTarget[first.targetId] ?? [],
      input.claimCandidatePaths,
      ...input.acceptedDecisionScopes,
      ...input.approvalScopes,
    ];
    writePaths = intersectScopes(scopes);
    if (writePaths.length === 0) {
      return failure(
        "impact.empty_write_scope",
        "resolved mutation scope is empty after authority intersection",
        first.targetId,
      );
    }
  }

  const requirement = hasRequired
    ? "required"
    : entries.some((entry) => entry.requirement === "conditional")
      ? "conditional"
      : "not_applicable";
  return success({
    targetKind: first.targetKind,
    targetId: first.targetId,
    requirement,
    duties,
    readPaths: unique(entries.flatMap((entry) => entry.readPaths)),
    writePaths,
    requiredEvidenceIds: unique(
      entries.flatMap((entry) => entry.requiredEvidenceIds),
    ),
    requiredRecordTypes: unique(
      entries.flatMap((entry) => entry.requiredRecordTypes),
    ),
    responsibleRole: strictestRole(entries),
    sourceIds: unique(entries.map((entry) => entry.sourceId)),
  });
}

function cyclicTargets(
  targetIds: readonly string[],
  edges: ImpactMergeInput["dependencyEdges"],
): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const id of targetIds) outgoing.set(id, []);
  for (const edge of edges) outgoing.get(edge.from)?.push(edge.to);
  const cyclic = new Set<string>();
  for (const start of targetIds) {
    const pending = [...(outgoing.get(start) ?? [])];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || visited.has(current)) continue;
      if (current === start) {
        cyclic.add(start);
        break;
      }
      visited.add(current);
      pending.push(...(outgoing.get(current) ?? []));
    }
  }
  return cyclic;
}

export function mergeImpacts(
  input: ImpactMergeInput,
): RuntimeResult<ResolvedImpactPlan> {
  const known = validateKnownTargets(input);
  if (!known.ok) return known;
  const paths = validatePaths(input);
  if (!paths.ok) return paths;
  const orderedEntries = [
    ...input.immutableImpacts,
    ...input.rootPolicyImpacts,
    ...input.overlayImpacts,
    ...input.patternImpacts,
  ];
  const groups = new Map<string, ImpactEntry[]>();
  for (const entry of orderedEntries) {
    const key = targetKey(entry);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const impacts: ResolvedImpact[] = [];
  for (const key of [...groups.keys()].sort(compareUtf8)) {
    const merged = mergeTarget(groups.get(key) ?? [], input);
    if (!merged.ok) return merged;
    impacts.push(merged.value);
  }

  const cycle = cyclicTargets(
    Object.keys(input.ownedPathsByTarget).sort(compareUtf8),
    input.dependencyEdges,
  );
  const coordinated = new Set(input.coordinatedTargetIds ?? []);
  const uncoordinated = impacts.find(
    (impact) =>
      impact.writePaths.length > 0 &&
      cycle.has(impact.targetId) &&
      !coordinated.has(impact.targetId),
  );
  if (uncoordinated !== undefined) {
    return failure(
      "impact.dependency_cycle_uncoordinated",
      "mutation across a dependency cycle requires explicit coordinated claims",
      uncoordinated.targetId,
      [...cycle].sort(compareUtf8),
    );
  }

  return success({
    impacts,
    mutationPaths: unique(impacts.flatMap((impact) => impact.writePaths)),
    sourceIds: unique(impacts.flatMap((impact) => impact.sourceIds)),
  });
}
