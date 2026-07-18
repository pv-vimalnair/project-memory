import type { RuntimeIssue } from "../contracts/runtime-result.js";

export const CLI_EXIT_CODE = {
  success: 0,
  validation: 2,
  authority: 3,
  conflict: 4,
  operational: 5,
} as const;

export type CliExitCode = (typeof CLI_EXIT_CODE)[keyof typeof CLI_EXIT_CODE];

function normalizedCode(code: string): string {
  return code.toUpperCase().replaceAll(/[.-]/g, "_");
}

function includesAny(code: string, fragments: readonly string[]): boolean {
  return fragments.some((fragment) => code.includes(fragment));
}

export function exitCodeForIssue(issue: RuntimeIssue): Exclude<CliExitCode, 0> {
  const code = normalizedCode(issue.code);
  if (includesAny(code, ["APPROVAL", "AUTHORITY"])) {
    return CLI_EXIT_CODE.authority;
  }
  if (
    includesAny(code, [
      "CLAIM",
      "STALE",
      "HEAD_DRIFT",
      "CAS_LOST",
      "LEASE",
      "DIRTY",
      "PATH_ESCAPE",
      "PATH_SCOPE",
      "SCOPE_EXCEEDED",
      "UNAUTHORIZED_PATH",
      "PLAN_HASH_MISMATCH",
      "OVERLAP",
      "CONFLICT",
      "PRECONDITION_FAILED",
      "VIEWS_STALE",
      "VIEW_DRIFT",
    ])
  ) {
    return CLI_EXIT_CODE.conflict;
  }
  if (
    includesAny(code, [
      "FILESYSTEM",
      "COMMAND_RUNNER",
      "CHILD_PROCESS",
      "TIMEOUT",
      "UNEXPECTED",
      "INTERNAL",
      "GIT_",
      "RECOVERY_FAILED",
      "ROLLBACK_FAILED",
      "FINALIZATION_FAILED",
      "NODE_VERSION",
    ])
  ) {
    return CLI_EXIT_CODE.operational;
  }
  return CLI_EXIT_CODE.validation;
}

export function exitCodeForIssues(issues: readonly RuntimeIssue[]): CliExitCode {
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length === 0) return CLI_EXIT_CODE.success;
  return Math.max(...errors.map(exitCodeForIssue)) as Exclude<CliExitCode, 0>;
}
