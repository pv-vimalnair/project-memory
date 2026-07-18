import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { buildTaskCoverage } from "./build-task-coverage.js";
import type {
  PatternRef,
  TaskAssignment,
  TaskAssignmentInput,
  TaskCandidate,
  WorkstreamRequirement,
} from "./types.js";

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function unique(values: readonly string[]): string[] {
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
  if (scope === "**" || scope === candidate) return true;
  if (!scope.endsWith("/**")) return false;
  const base = scope.slice(0, -3);
  return candidate === base || candidate.startsWith(`${base}/`);
}

function pathsOverlap(left: string, right: string): boolean {
  return pathCovers(left, right) || pathCovers(right, left);
}

function patternMap(input: TaskAssignmentInput): Map<string, PatternRef> {
  return new Map(
    [input.patternSet.outcomePrimary, ...input.patternSet.companions].map(
      (pattern) => [pattern.id, pattern],
    ),
  );
}

function requirementMap(
  requirements: readonly WorkstreamRequirement[],
): RuntimeResult<ReadonlyMap<string, WorkstreamRequirement>> {
  const result = new Map<string, WorkstreamRequirement>();
  for (const requirement of requirements) {
    if (result.has(requirement.id)) {
      return failure(
        "coverage.duplicate_requirement",
        "workstream requirement IDs must be unique",
        requirement.id,
      );
    }
    result.set(requirement.id, requirement);
  }
  return success(result);
}

function validateCandidate(
  candidate: TaskCandidate,
  patterns: ReadonlyMap<string, PatternRef>,
  requirements: ReadonlyMap<string, WorkstreamRequirement>,
  authorizedPaths: readonly string[] | undefined,
): RuntimeResult<TaskAssignment> {
  const pattern = patterns.get(candidate.primaryPatternId);
  if (pattern === undefined) {
    return failure(
      "task.pattern_not_in_workstream",
      "task primary pattern is not locked by the workstream",
      candidate.taskId,
      [candidate.primaryPatternId],
    );
  }
  if (
    new Set(candidate.requestedRequirementIds).size !==
    candidate.requestedRequirementIds.length
  ) {
    return failure(
      "coverage.duplicate_requirement",
      "one task may request each requirement only once",
      candidate.taskId,
    );
  }
  for (const requirementId of candidate.requestedRequirementIds) {
    const requirement = requirements.get(requirementId);
    if (requirement === undefined) {
      return failure(
        "coverage.unknown_requirement",
        "task requests a requirement outside its workstream",
        candidate.taskId,
        [requirementId],
      );
    }
    if (!requirement.sourcePatternIds.includes(pattern.id)) {
      return failure(
        "coverage.pattern_mismatch",
        "task pattern does not own its requested requirement",
        candidate.taskId,
        [pattern.id, requirementId],
      );
    }
    if (
      requirement.coordinationRequired &&
      candidate.coordinationIds.length === 0
    ) {
      return failure(
        "coverage.overlap_without_coordination",
        "coordination-required work needs a non-empty coordination ID",
        candidate.taskId,
        [requirementId],
      );
    }
  }
  const claimedPaths = unique(candidate.claimedPaths);
  const invalid = claimedPaths.find((path) => !validPath(path));
  if (invalid !== undefined) {
    return failure(
      "coverage.unauthorized_path",
      "task claim path is not a safe repository-relative scope",
      candidate.taskId,
      [invalid],
    );
  }
  if (
    authorizedPaths !== undefined &&
    claimedPaths.some(
      (claimed) => !authorizedPaths.some((scope) => pathCovers(scope, claimed)),
    )
  ) {
    return failure(
      "coverage.unauthorized_path",
      "task claim path exceeds accepted workstream authorization",
      candidate.taskId,
      claimedPaths,
    );
  }
  return success({
    taskId: candidate.taskId,
    primaryPattern: pattern,
    coveredRequirementIds: unique(candidate.requestedRequirementIds),
    claimedPaths,
    coordinationIds: unique(candidate.coordinationIds),
  });
}

function validateOverlaps(
  assignments: readonly TaskAssignment[],
): RuntimeResult<true> {
  for (let leftIndex = 0; leftIndex < assignments.length; leftIndex += 1) {
    const left = assignments[leftIndex];
    if (left === undefined) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < assignments.length;
      rightIndex += 1
    ) {
      const right = assignments[rightIndex];
      if (right === undefined) continue;
      const overlap = left.claimedPaths.some((leftPath) =>
        right.claimedPaths.some((rightPath) => pathsOverlap(leftPath, rightPath)),
      );
      if (!overlap) continue;
      const coordinated = left.coordinationIds.some((id) =>
        right.coordinationIds.includes(id),
      );
      if (!coordinated) {
        return failure(
          "coverage.overlap_without_coordination",
          "overlapping task scopes require one shared coordination ID",
          left.taskId,
          [left.taskId, right.taskId],
        );
      }
    }
  }
  return success(true);
}

export function assignTaskPackets(
  input: TaskAssignmentInput,
): RuntimeResult<readonly TaskAssignment[]> {
  const patterns = patternMap(input);
  if (patterns.size !== input.patternSet.companions.length + 1) {
    return failure(
      "task.pattern_not_in_workstream",
      "workstream pattern IDs must be unique",
      input.patternSet.outcomePrimary.id,
    );
  }
  const requirements = requirementMap(input.requirements);
  if (!requirements.ok) return requirements;
  const taskIds = new Set<string>();
  const assignments: TaskAssignment[] = [];
  for (const candidate of [...input.taskCandidates].sort((left, right) =>
    compareUtf8(left.taskId, right.taskId),
  )) {
    if (taskIds.has(candidate.taskId)) {
      return failure(
        "task.duplicate_id",
        "task candidate IDs must be unique",
        candidate.taskId,
      );
    }
    taskIds.add(candidate.taskId);
    const assignment = validateCandidate(
      candidate,
      patterns,
      requirements.value,
      input.authorizedPaths,
    );
    if (!assignment.ok) return assignment;
    assignments.push(assignment.value);
  }
  const overlaps = validateOverlaps(assignments);
  if (!overlaps.ok) return overlaps;
  const coverage = buildTaskCoverage(
    input.patternSet,
    input.requirements,
    assignments,
  );
  if (!coverage.ok) return coverage;
  return success(assignments);
}
