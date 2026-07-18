import {
  failure,
  success,
  type RuntimeResult,
} from "../../index.js";
import type { Approval, Claim } from "../../planning/types.js";

const WRITE_DUTIES = new Set(["modify", "release", "notify"]);

export interface ClaimConflictSubject {
  readonly claim: Claim;
  readonly status: "active" | "expired";
  readonly expires_at: string;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function normalizeClaimPath(value: string): RuntimeResult<string> {
  const candidate = value.endsWith("/") ? value.slice(0, -1) : value;
  const segments = candidate.split("/");
  if (
    candidate.length === 0 ||
    candidate.includes("\\") ||
    candidate.startsWith("/") ||
    /^[A-Za-z]:/.test(candidate) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    (candidate.includes("*") && candidate !== "**" && !candidate.endsWith("/**"))
  ) {
    return failure(
      "claim.path_invalid",
      "claim paths must be normalized safe repository-relative scopes",
      value,
    );
  }
  return success(candidate);
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

export function validateClaimCoordination(
  claim: Claim,
  conflicts: readonly Claim[],
  coordinationId: string | null,
  approvals: readonly Approval[],
  now: Date,
): RuntimeResult<readonly string[]> {
  if (conflicts.length === 0) return success([]);
  const approvalId = claim.coordination_exception_approval_id;
  if (approvalId === null || coordinationId === null || coordinationId.trim().length === 0) {
    return failure(
      "claim.write_conflict",
      "overlapping active write claims require linked approval and coordination",
      claim.id,
      conflicts.map((conflict) => conflict.id),
    );
  }
  const matches = approvals.filter((approval) => approval.id === approvalId);
  if (matches.length !== 1) {
    return failure(
      "claim.coordination_approval_invalid",
      "coordination approval must exist exactly once",
      approvalId,
    );
  }
  const approval = matches[0] as Approval;
  const issuedAt = Date.parse(approval.issued_at);
  const expiresAt = approval.expires_at === null ? null : Date.parse(approval.expires_at);
  if (
    approval.kind !== "coordination" ||
    approval.granted_by.trim().toLowerCase() !== "pitaji" ||
    approval.target !== coordinationId ||
    !Number.isFinite(issuedAt) ||
    issuedAt > now.getTime() ||
    (approval.expires_at !== null && !Number.isFinite(expiresAt)) ||
    (expiresAt !== null && expiresAt <= now.getTime()) ||
    !claim.paths.every((path) =>
      approval.scope.some((scope) => pathCovers(scope, path)),
    )
  ) {
    return failure(
      "claim.coordination_approval_invalid",
      "coordination approval must cover identity, timing, and every overlapping path",
      approvalId,
    );
  }
  return success([approvalId]);
}

function mutates(claim: Claim): boolean {
  return claim.duties.some((duty) => WRITE_DUTIES.has(duty));
}

function active(subject: ClaimConflictSubject, now: number): boolean {
  const expiresAt = Date.parse(subject.expires_at);
  return (
    subject.status === "active" &&
    Number.isFinite(expiresAt) &&
    expiresAt > now
  );
}

function normalizedPaths(claim: Claim): RuntimeResult<readonly string[]> {
  const paths: string[] = [];
  for (const value of claim.paths) {
    const normalized = normalizeClaimPath(value);
    if (!normalized.ok) return normalized;
    paths.push(normalized.value);
  }
  return success([...new Set(paths)].sort(compareUtf8));
}

export function findClaimConflicts(
  candidate: Claim,
  existing: readonly ClaimConflictSubject[],
  now: Date,
): RuntimeResult<readonly Claim[]> {
  if (!Number.isFinite(now.getTime())) {
    return failure("claim.now_invalid", "claim conflict time must be valid");
  }
  const candidatePaths = normalizedPaths(candidate);
  if (!candidatePaths.ok) return candidatePaths;
  if (!mutates(candidate)) return success([]);
  const conflicts: Claim[] = [];
  for (const subject of existing) {
    if (
      subject.claim.id === candidate.id ||
      !active(subject, now.getTime()) ||
      !mutates(subject.claim) ||
      !candidate.repositories.some((repository) =>
        subject.claim.repositories.includes(repository),
      )
    ) {
      continue;
    }
    const paths = normalizedPaths(subject.claim);
    if (!paths.ok) return paths;
    if (
      candidatePaths.value.some((left) =>
        paths.value.some((right) => pathsOverlap(left, right)),
      )
    ) {
      conflicts.push(subject.claim);
    }
  }
  return success(conflicts.sort((left, right) => compareUtf8(left.id, right.id)));
}
