import type { PlannedWrite } from "./planned-write.js";
import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";

export type CanonicalMutationKind =
  | "profile.bootstrap"
  | "profile.evolution"
  | "record"
  | "claim"
  | "view"
  | "archive"
  | "work_lifecycle"
  | "administrative"
  | "migration"
  | "import";

export interface CanonicalMutationPlan<
  TMetadata = Readonly<Record<string, unknown>>,
> {
  readonly schema_version: "1.0.0";
  readonly plan_id: string;
  readonly plan_hash: string;
  readonly mutation_kind: CanonicalMutationKind;
  readonly root_id: string;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly profile_lock_hash: string;
  readonly writes: readonly PlannedWrite[];
  readonly record_ids: readonly string[];
  readonly event_ids: readonly string[];
  readonly approval_ids: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly created_by: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly metadata: TMetadata;
}

interface HashedWrite {
  readonly relative_path: string;
  readonly mode: PlannedWrite["mode"];
  readonly expected_existing_sha256: string | null;
  readonly bytes_sha256: string;
}

function compareUtf8Path(left: HashedWrite, right: HashedWrite): number {
  return Buffer.compare(
    Buffer.from(left.relative_path, "utf8"),
    Buffer.from(right.relative_path, "utf8"),
  );
}

export function canonicalMutationPlanHash<TMetadata>(
  plan: Omit<CanonicalMutationPlan<TMetadata>, "plan_hash">,
): string {
  const stableFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(plan)) {
    if (key !== "plan_hash" && key !== "writes") stableFields[key] = value;
  }
  const writes = plan.writes
    .map((write): HashedWrite => ({
      relative_path: write.relative_path,
      mode: write.mode,
      expected_existing_sha256: write.expected_existing_sha256,
      bytes_sha256: sha256(write.bytes),
    }))
    .sort(compareUtf8Path);
  return sha256(canonicalJson({ ...stableFields, writes }));
}
