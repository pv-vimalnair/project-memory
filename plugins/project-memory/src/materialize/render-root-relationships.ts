import {
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import type { RootAddress } from "../profile/contracts/index.js";
import { validateRootRelationships } from "../profile/validate-root-ownership.js";

export const ROOT_RELATIONSHIPS_SOURCE_PATH =
  "docs/project-memory/source/ROOT_RELATIONSHIPS.md" as const;

function indentCanonicalJson(value: unknown): string {
  return canonicalJson(value)
    .trimEnd()
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

export function renderRootRelationships(
  localRoot: RootAddress,
  values: readonly unknown[],
): RuntimeResult<Uint8Array | null> {
  const validated = validateRootRelationships(localRoot, values);
  if (!validated.ok) return { ok: false, issues: validated.issues };
  if (validated.value.records.length === 0) return success(null);

  const approvalLines = validated.value.approval_refs.map(
    (reference) => `  - ${reference}`,
  );
  const sections = validated.value.records.flatMap((record, index) => [
    `## Relationship ${String(index + 1)}`,
    "",
    indentCanonicalJson(record),
    "",
  ]);
  const text = [
    "---",
    "schema: project-memory/root-relationships",
    "version: 1.0.0",
    `root_namespace: ${validated.value.local_root.namespace}`,
    `root_id: ${validated.value.local_root.root_id}`,
    "approval_refs:",
    ...approvalLines,
    "---",
    "# Root Relationships",
    "",
    "Accepted reference-only relationships. Canonical truth remains with each named owner.",
    "",
    ...sections,
  ].join("\n");
  return success(new TextEncoder().encode(text));
}
