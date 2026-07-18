export type RuntimeIssueSeverity = "error" | "review" | "warning";

export interface RuntimeIssue {
  readonly code: string;
  readonly severity: RuntimeIssueSeverity;
  readonly path: string;
  readonly message: string;
  readonly references: readonly string[];
}

export type RuntimeResult<T> =
  | { readonly ok: true; readonly value: T; readonly warnings: readonly RuntimeIssue[] }
  | { readonly ok: false; readonly issues: readonly RuntimeIssue[] };

export function success<T>(
  value: T,
  warnings: readonly RuntimeIssue[] = [],
): RuntimeResult<T> {
  return { ok: true, value, warnings };
}

export function failure<T = never>(
  code: string,
  message: string,
  path = "",
  references: readonly string[] = [],
): RuntimeResult<T> {
  return {
    ok: false,
    issues: [{ code, severity: "error", path, message, references }],
  };
}

export function failureFromIssues<T = never>(
  issues: readonly RuntimeIssue[],
): RuntimeResult<T> {
  return { ok: false, issues };
}
