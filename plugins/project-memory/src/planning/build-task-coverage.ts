import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type {
  CoverageMap,
  TaskAssignment,
  WorkstreamPatternSet,
  WorkstreamRequirement,
} from "./types.js";

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function workstreamPatterns(patternSet: WorkstreamPatternSet) {
  return new Map(
    [patternSet.outcomePrimary, ...patternSet.companions].map((pattern) => [
      pattern.id,
      pattern,
    ]),
  );
}

export function buildTaskCoverage(
  patternSet: WorkstreamPatternSet,
  requirements: readonly WorkstreamRequirement[],
  assignments: readonly TaskAssignment[],
): RuntimeResult<CoverageMap> {
  const patterns = workstreamPatterns(patternSet);
  if (patterns.size !== patternSet.companions.length + 1) {
    return failure(
      "task.pattern_not_in_workstream",
      "workstream pattern IDs must be unique",
      patternSet.outcomePrimary.id,
    );
  }
  const requirementMap = new Map<string, WorkstreamRequirement>();
  for (const requirement of requirements) {
    if (requirementMap.has(requirement.id)) {
      return failure(
        "coverage.duplicate_requirement",
        "workstream requirement IDs must be unique",
        requirement.id,
      );
    }
    if (
      requirement.sourcePatternIds.length === 0 ||
      requirement.sourcePatternIds.some((id) => !patterns.has(id))
    ) {
      return failure(
        "coverage.pattern_mismatch",
        "requirement provenance must reference workstream patterns",
        requirement.id,
        requirement.sourcePatternIds,
      );
    }
    requirementMap.set(requirement.id, requirement);
  }

  const taskIds = new Set<string>();
  const owners = new Map<string, string[]>();
  for (const id of [...requirementMap.keys()].sort(compareUtf8)) owners.set(id, []);
  for (const assignment of [...assignments].sort((left, right) =>
    compareUtf8(left.taskId, right.taskId),
  )) {
    if (taskIds.has(assignment.taskId)) {
      return failure(
        "task.duplicate_id",
        "task assignment IDs must be unique",
        assignment.taskId,
      );
    }
    taskIds.add(assignment.taskId);
    const pattern = patterns.get(assignment.primaryPattern.id);
    if (
      pattern === undefined ||
      pattern.version !== assignment.primaryPattern.version
    ) {
      return failure(
        "task.pattern_not_in_workstream",
        "task primary pattern must be locked by its workstream",
        assignment.taskId,
        [assignment.primaryPattern.id],
      );
    }
    for (const requirementId of assignment.coveredRequirementIds) {
      const requirement = requirementMap.get(requirementId);
      if (requirement === undefined) {
        return failure(
          "coverage.unknown_requirement",
          "task references a requirement outside its workstream",
          assignment.taskId,
          [requirementId],
        );
      }
      if (!requirement.sourcePatternIds.includes(pattern.id)) {
        return failure(
          "coverage.pattern_mismatch",
          "task pattern does not own the requested requirement",
          assignment.taskId,
          [pattern.id, requirementId],
        );
      }
      owners.get(requirementId)?.push(assignment.taskId);
    }
  }

  const unassigned = [...requirementMap.keys()]
    .filter((id) => (owners.get(id) ?? []).length === 0)
    .sort(compareUtf8);
  if (unassigned.length > 0) {
    return failure(
      "coverage.unassigned_requirement",
      "every workstream requirement must have an execution owner",
      unassigned[0],
      unassigned,
    );
  }
  const duplicates = [...requirementMap.values()]
    .filter(
      (requirement) =>
        requirement.exclusive && (owners.get(requirement.id) ?? []).length > 1,
    )
    .map((requirement) => requirement.id)
    .sort(compareUtf8);
  if (duplicates.length > 0) {
    return failure(
      "coverage.duplicate_exclusive_owner",
      "exclusive mutation and external-action requirements need exactly one owner",
      duplicates[0],
      duplicates,
    );
  }

  const requirementTaskIds: Record<string, readonly string[]> = {};
  for (const id of [...requirementMap.keys()].sort(compareUtf8)) {
    requirementTaskIds[id] = [...(owners.get(id) ?? [])].sort(compareUtf8);
  }
  return success({
    requirementTaskIds,
    unassignedRequirementIds: [],
    duplicateExclusiveRequirementIds: [],
  });
}
