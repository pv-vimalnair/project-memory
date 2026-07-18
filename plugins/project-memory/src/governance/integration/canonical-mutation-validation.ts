import path from "node:path";

import {
  canonicalMutationPlanHash,
  failure,
  success,
  type CanonicalMutationPlan,
  type PlannedWrite,
  type RuntimeResult,
} from "../../index.js";

const REVISION = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TARGET_REF = /^refs\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const PLAN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const ROOT_ID = /^ROOT-[0-9A-HJKMNP-TV-Z]{26}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MUTATION_KINDS = new Set([
  "profile.bootstrap", "profile.evolution", "record", "claim", "view",
  "archive", "work_lifecycle", "administrative", "migration", "import",
]);
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:[.]|$)/i;
const IMMUTABLE_PREFIXES = Object.freeze([
  "docs/project-memory/records/",
  "docs/project-memory/governance/events/",
  "docs/project-memory/governance/claims/",
  "docs/project-memory/governance/integration/mutations/",
  "docs/project-memory/archive/objects/",
  "docs/project-memory/archive/manifests/",
]);

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) return true;
  }
  return false;
}

function safePath(relativePath: string): boolean {
  const folded = relativePath.toLowerCase();
  if (
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.isAbsolute(relativePath) ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.normalize("NFC") !== relativePath ||
    folded === ".git" ||
    folded.startsWith(".git/")
  ) {
    return false;
  }
  const segments = relativePath.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      segment.toLowerCase() !== ".git" &&
      !hasControlCharacter(segment) &&
      !/[<>:"|?*]/.test(segment) &&
      !/[. ]$/.test(segment) &&
      !WINDOWS_RESERVED.test(segment),
  );
}

function validateWrite(
  write: PlannedWrite,
  mutationKind: CanonicalMutationPlan<unknown>["mutation_kind"],
): RuntimeResult<true> {
  if (
    !safePath(write.relative_path) ||
    !(write.bytes instanceof Uint8Array) ||
    write.bytes.byteLength > 67_108_864 ||
    !["create", "replace", "create_or_replace"].includes(write.mode) ||
    (write.expected_existing_sha256 !== null && !SHA256.test(write.expected_existing_sha256)) ||
    (write.mode === "create" && write.expected_existing_sha256 !== null) ||
    (write.mode === "replace" && write.expected_existing_sha256 === null)
  ) {
    return failure(
      "mutation.write_invalid",
      "planned writes require a safe path, bounded bytes, valid mode, and exact precondition",
      write.relative_path,
    );
  }
  const bootstrapPlaceholder =
    mutationKind === "profile.bootstrap" &&
    write.mode === "create_or_replace" &&
    write.expected_existing_sha256 === null &&
    write.relative_path.toLowerCase().endsWith("/.gitkeep");
  if (
    write.mode !== "create" &&
    !bootstrapPlaceholder &&
    IMMUTABLE_PREFIXES.some((prefix) => write.relative_path.toLowerCase().startsWith(prefix))
  ) {
    return failure(
      "mutation.immutable_history_edit",
      "immutable records, events, claims, audits, and archives are create-only",
      write.relative_path,
    );
  }
  return success(true);
}

function validateWriteSet(
  writes: readonly PlannedWrite[],
  mutationKind: CanonicalMutationPlan<unknown>["mutation_kind"],
): RuntimeResult<true> {
  if (writes.length === 0) {
    return failure("mutation.writes_empty", "canonical mutation plans require at least one write");
  }
  const sorted = [...writes].sort((left, right) =>
    left.relative_path.toLowerCase().localeCompare(right.relative_path.toLowerCase()),
  );
  for (const write of sorted) {
    const valid = validateWrite(write, mutationKind);
    if (!valid.ok) return valid;
  }
  for (let index = 0; index < sorted.length; index += 1) {
    const left = sorted[index];
    if (left === undefined) continue;
    const leftPath = left.relative_path.toLowerCase();
    for (let rightIndex = index + 1; rightIndex < sorted.length; rightIndex += 1) {
      const right = sorted[rightIndex];
      if (right === undefined) continue;
      const rightPath = right.relative_path.toLowerCase();
      if (leftPath === rightPath || rightPath.startsWith(`${leftPath}/`)) {
        return failure(
          "mutation.write_overlap",
          "canonical mutation writes may not duplicate or contain one another",
          right.relative_path,
          [left.relative_path],
        );
      }
      if (!rightPath.startsWith(leftPath)) break;
    }
  }
  return success(true);
}

function metadataRecord<TMetadata>(
  plan: CanonicalMutationPlan<TMetadata>,
): RuntimeResult<Readonly<Record<string, unknown>>> {
  return typeof plan.metadata === "object" && plan.metadata !== null && !Array.isArray(plan.metadata)
    ? success(plan.metadata as Readonly<Record<string, unknown>>)
    : failure("mutation.metadata_invalid", "canonical mutation metadata must be an object", plan.plan_id);
}

function requiredReferences(
  metadata: Readonly<Record<string, unknown>>,
  key: "required_approval_ids" | "required_evidence_ids",
): RuntimeResult<readonly string[]> {
  const value = metadata[key];
  if (value === undefined) return success([]);
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string") && unique(value)
    ? success(value)
    : failure("mutation.metadata_invalid", `${key} must be a unique string array`, key);
}

export function validateCanonicalMutationPlan<TMetadata>(
  plan: CanonicalMutationPlan<TMetadata>,
  now: Date,
): RuntimeResult<true> {
  const { plan_hash: ignored, ...withoutHash } = plan;
  void ignored;
  let computedHash: string;
  try {
    computedHash = canonicalMutationPlanHash(withoutHash);
  } catch {
    return failure("mutation.plan_invalid", "canonical mutation plan cannot be hashed", plan.plan_id);
  }
  if (!SHA256.test(plan.plan_hash) || computedHash !== plan.plan_hash) {
    return failure("mutation.plan_hash_mismatch", "canonical mutation plan hash does not bind the supplied envelope", plan.plan_id);
  }
  const schemaVersion = (plan as unknown as { readonly schema_version: unknown }).schema_version;
  if (
    schemaVersion !== "1.0.0" ||
    !PLAN_ID.test(plan.plan_id) ||
    !ROOT_ID.test(plan.root_id) ||
    !MUTATION_KINDS.has(plan.mutation_kind) ||
    !TARGET_REF.test(plan.target_ref) ||
    plan.target_ref.includes("..") ||
    !REVISION.test(plan.expected_head) ||
    !SHA256.test(plan.profile_lock_hash) ||
    plan.created_by.trim().length === 0 ||
    /[\0\r\n]/.test(plan.created_by)
  ) {
    return failure("mutation.plan_invalid", "canonical mutation plan bindings are malformed", plan.plan_id);
  }
  const createdAt = Date.parse(plan.created_at);
  const expiresAt = Date.parse(plan.expires_at);
  if (
    !UTC_TIMESTAMP.test(plan.created_at) ||
    !UTC_TIMESTAMP.test(plan.expires_at) ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= createdAt
  ) {
    return failure("mutation.plan_time_invalid", "canonical mutation plan time window is invalid", plan.plan_id);
  }
  if (!Number.isFinite(now.getTime())) {
    return failure("mutation.clock_invalid", "canonical mutation clock must be valid", plan.plan_id);
  }
  if (expiresAt <= now.getTime()) {
    return failure("mutation.plan_expired", "canonical mutation plan has expired", plan.plan_id);
  }
  for (const values of [plan.record_ids, plan.event_ids, plan.approval_ids, plan.evidence_ids]) {
    if (!unique(values) || values.some((value) => value.trim().length === 0)) {
      return failure("mutation.references_invalid", "canonical mutation references must be nonblank and unique", plan.plan_id);
    }
  }
  const metadata = metadataRecord(plan);
  if (!metadata.ok) return metadata;
  const requiredApprovals = requiredReferences(metadata.value, "required_approval_ids");
  if (!requiredApprovals.ok) return requiredApprovals;
  const requiredEvidence = requiredReferences(metadata.value, "required_evidence_ids");
  if (!requiredEvidence.ok) return requiredEvidence;
  if (
    requiredApprovals.value.some((id) => !plan.approval_ids.includes(id)) ||
    requiredEvidence.value.some((id) => !plan.evidence_ids.includes(id))
  ) {
    return failure("mutation.references_missing", "plan omits metadata-required approval or evidence references", plan.plan_id);
  }
  if (
    !["profile.bootstrap", "profile.evolution"].includes(plan.mutation_kind) &&
    plan.writes.some(
      (write) => write.relative_path.toLowerCase() === "docs/project-memory/profile.lock.yaml",
    )
  ) {
    return failure("mutation.profile_write_forbidden", "only profile mutations may write the profile lock", plan.plan_id);
  }
  return validateWriteSet(plan.writes, plan.mutation_kind);
}
