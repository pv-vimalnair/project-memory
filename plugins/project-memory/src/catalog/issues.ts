import type { RuntimeIssue } from "../contracts/runtime-result.js";

export function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function catalogIssue(
  code: string,
  path: string,
  message: string,
  references: readonly string[] = [],
): RuntimeIssue {
  return { code, severity: "error", path, message, references };
}

export function sortCatalogIssues(
  issues: readonly RuntimeIssue[],
): readonly RuntimeIssue[] {
  return [...issues].sort((left, right) => {
    const byPath = compareUtf8(left.path, right.path);
    if (byPath !== 0) return byPath;
    const byReference = compareUtf8(
      left.references[0] ?? "",
      right.references[0] ?? "",
    );
    if (byReference !== 0) return byReference;
    return compareUtf8(left.code, right.code);
  });
}
