import {
  canonicalJson,
  failure,
  sha256,
  success,
  type Clock,
  type IdFactory,
  type PlannedWrite,
  type RuntimeResult,
} from "../../index.js";
import type { ArchiveRedactionReport } from "../archive/redactor.js";
import { redactArchiveBytes } from "../archive/redactor.js";
import type { CanonicalRecord, EvidenceRecordPayload, GateEvidence } from "../contracts/index.js";
import { recordWrite } from "../records/record-path.js";

const SHA256 = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const INSTANCE_SUFFIX = "[0-9A-HJKMNP-TV-Z]{26}";

type EvidenceRecord = Omit<CanonicalRecord, "type" | "payload"> & Readonly<{ type: "evidence"; payload: EvidenceRecordPayload }>;
export interface AuditArchiveReceipt {
  readonly source_ref: string;
  readonly object_kind: string;
  readonly source_hash: string;
  readonly stored_hash: string;
  readonly manifest_hash: string;
  readonly redaction_report: ArchiveRedactionReport;
}

export type AuditLeaseBinding = Readonly<{ holder_id: string; nonce: string }>;
export interface AuditEvidenceInput {
  readonly root_id: string;
  readonly component_ids: readonly string[];
  readonly initiative_id: string | null;
  readonly workstream_id: string;
  readonly task_id: string;
  readonly packet_id: string;
  readonly claim_id: string;
  readonly worker_id: string;
  readonly integrated_by: string;
  readonly original_base_revision: string;
  readonly integration_base_revision: string;
  readonly worker_head_revision: string;
  readonly changed_paths: readonly string[];
  readonly authorization_refs: readonly string[];
  readonly approval_ids: readonly string[];
  readonly lease: AuditLeaseBinding;
  readonly gates: readonly GateEvidence[];
  readonly profile_version: string;
  readonly profile_lock_hash: string;
  readonly catalog_version: string;
  readonly catalog_lock_hash: string;
  readonly generated_view_hashes: Readonly<Record<string, string>>;
  readonly completion_archive_manifest_hash: string;
  readonly archive_receipts: readonly AuditArchiveReceipt[];
  readonly prepared_commit_hash: string | null;
  readonly final_commit_hash: string | null;
  readonly remaining_risks: readonly string[];
}

export type AuditCheckNotRun = Readonly<{ gate_id: string; reason: string }>;

export interface IntegrationAuditManifestBody {
  readonly schema_version: "1.0.0";
  readonly evidence_id: string;
  readonly root_id: string;
  readonly component_ids: readonly string[];
  readonly initiative_id: string | null;
  readonly workstream_id: string;
  readonly task_id: string;
  readonly packet_id: string;
  readonly claim_id: string;
  readonly worker_id: string;
  readonly integrated_by: string;
  readonly original_base_revision: string;
  readonly integration_base_revision: string;
  readonly worker_head_revision: string;
  readonly changed_paths: readonly string[];
  readonly authorization_refs: readonly string[];
  readonly approval_ids: readonly string[];
  readonly lease_holder_id: string;
  readonly lease_nonce_sha256: string;
  readonly gates: readonly GateEvidence[];
  readonly profile_version: string;
  readonly profile_lock_hash: string;
  readonly catalog_version: string;
  readonly catalog_lock_hash: string;
  readonly generated_view_hashes: Readonly<Record<string, string>>;
  readonly completion_archive_manifest_hash: string;
  readonly archive_manifest_hashes: readonly string[];
  readonly archive_receipts: readonly AuditArchiveReceipt[];
  readonly prepared_commit_hash: string | null;
  readonly final_commit_hash: string | null;
  readonly checks_not_run: readonly AuditCheckNotRun[];
  readonly remaining_risks: readonly string[];
  readonly created_at: string;
  readonly created_by: string;
}

export interface IntegrationAuditManifest extends IntegrationAuditManifestBody {
  readonly audit_hash: string;
}

export interface AuditEvidenceBundle {
  readonly record: EvidenceRecord;
  readonly manifest_body: IntegrationAuditManifestBody;
  readonly manifest: IntegrationAuditManifest;
  readonly record_hash: string;
  readonly manifest_hash: string;
  readonly writes: readonly PlannedWrite[];
}

export type AuditEvidenceBuilder = Readonly<{ build(input: AuditEvidenceInput): RuntimeResult<AuditEvidenceBundle> }>;

export type AuditEvidenceBuilderDependencies = Readonly<{ clock: Clock; ids: IdFactory }>;

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function instance(prefix: string, value: string): boolean {
  return new RegExp(`^${prefix}-${INSTANCE_SUFFIX}$`).test(value);
}

function canonicalTimestamp(value: Date): string | null {
  return Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function safePath(value: string): boolean {
  if (
    !nonBlank(value) ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value)
  ) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function normalizedHashMap(
  value: Readonly<Record<string, string>>,
): RuntimeResult<Readonly<Record<string, string>>> {
  const entries = Object.entries(value).sort(([left], [right]) => compareUtf8(left, right));
  if (entries.some(([path, hash]) => !safePath(path) || !SHA256.test(hash))) {
    return failure(
      "audit.view_hash_invalid",
      "generated view hashes require safe paths and lowercase SHA-256 values",
    );
  }
  return success(Object.fromEntries(entries));
}

function redactionStable(value: string): boolean {
  const checked = redactArchiveBytes(new TextEncoder().encode(value));
  if (!checked.ok) return false;
  return new TextDecoder().decode(checked.value.bytes) === value;
}

function validGate(gate: GateEvidence): RuntimeResult<GateEvidence> {
  const raw = gate as unknown as Record<string, unknown>;
  if (
    raw.schema_version !== "1.0.0" ||
    !nonBlank(gate.gate_id) ||
    !nonBlank(gate.definition_ref) ||
    !nonBlank(gate.evidence_type) ||
    !["command", "check"].includes(gate.execution_kind) ||
    !["passed", "failed", "not_run"].includes(gate.status) ||
    typeof gate.required !== "boolean" ||
    typeof gate.conflict_sensitive !== "boolean" ||
    !SHA256.test(gate.stdout_sha256) ||
    !SHA256.test(gate.stderr_sha256) ||
    !Number.isInteger(gate.duration_ms) ||
    gate.duration_ms < 0 ||
    !Number.isFinite(Date.parse(gate.occurred_at)) ||
    new Date(gate.occurred_at).toISOString() !== gate.occurred_at ||
    gate.evidence_ids.some((id) => !instance("EVD", id)) ||
    gate.approval_refs.some((id) => !instance("APR", id))
  ) {
    return failure(
      "audit.gate_invalid",
      "gate evidence must retain its complete canonical execution result",
      gate.gate_id,
    );
  }
  if (
    (gate.execution_kind === "command" &&
      (gate.command === null || gate.verifier_role !== null)) ||
    (gate.execution_kind === "check" &&
      (gate.command !== null || !nonBlank(gate.verifier_role))) ||
    (gate.status === "not_run" && !nonBlank(gate.not_run_reason))
  ) {
    return failure(
      "audit.gate_invalid",
      "gate execution identity and not-run reason must match its result kind",
      gate.gate_id,
    );
  }
  if (!redactionStable(gate.stdout_redacted) || !redactionStable(gate.stderr_redacted)) {
    return failure(
      "audit.gate_output_not_redacted",
      "gate output must be redacted before audit evidence is built",
      gate.gate_id,
    );
  }
  return success({
    ...gate,
    command: gate.command === null
      ? null
      : { ...gate.command, args: [...gate.command.args] },
    evidence_ids: unique(gate.evidence_ids),
    approval_refs: unique(gate.approval_refs),
  });
}

function normalizedGates(
  gates: readonly GateEvidence[],
): RuntimeResult<readonly GateEvidence[]> {
  const ids = gates.map((gate) => gate.gate_id);
  if (new Set(ids).size !== ids.length) {
    return failure(
      "audit.gate_duplicate",
      "audit evidence requires one result per exact gate ID",
    );
  }
  const normalized: GateEvidence[] = [];
  for (const gate of gates) {
    const valid = validGate(gate);
    if (!valid.ok) return valid;
    normalized.push(valid.value);
  }
  return success(normalized.sort((left, right) => compareUtf8(left.gate_id, right.gate_id)));
}

function validReport(report: ArchiveRedactionReport): boolean {
  const raw = report as unknown as Record<string, unknown>;
  return (
    typeof raw.redacted === "boolean" &&
    raw.review_required === false &&
    typeof raw.replacement_count === "number" &&
    Number.isInteger(raw.replacement_count) &&
    raw.replacement_count >= 0 &&
    Array.isArray(raw.rule_ids) &&
    raw.rule_ids.every(nonBlank)
  );
}

function normalizedArchives(
  receipts: readonly AuditArchiveReceipt[],
): RuntimeResult<readonly AuditArchiveReceipt[]> {
  if (receipts.length === 0) {
    return failure("audit.archive_missing", "integration audit requires archive receipts");
  }
  const hashes = receipts.map((receipt) => receipt.manifest_hash);
  if (new Set(hashes).size !== hashes.length) {
    return failure(
      "audit.archive_duplicate",
      "archive manifest hashes must be unique",
    );
  }
  const normalized: AuditArchiveReceipt[] = [];
  for (const receipt of receipts) {
    if (
      !nonBlank(receipt.source_ref) ||
      !nonBlank(receipt.object_kind) ||
      !SHA256.test(receipt.source_hash) ||
      !SHA256.test(receipt.stored_hash) ||
      !SHA256.test(receipt.manifest_hash) ||
      !validReport(receipt.redaction_report)
    ) {
      return failure(
        "audit.archive_invalid",
        "archive receipts require source, stored, manifest hashes, and a safe redaction report",
        receipt.source_ref,
      );
    }
    normalized.push({
      ...receipt,
      redaction_report: {
        ...receipt.redaction_report,
        rule_ids: unique(receipt.redaction_report.rule_ids),
      },
    });
  }
  return success(normalized.sort((left, right) => compareUtf8(left.manifest_hash, right.manifest_hash)));
}

function validateInput(input: AuditEvidenceInput): RuntimeResult<true> {
  const identifiers = [
    ["ROOT", input.root_id],
    ["WS", input.workstream_id],
    ["TASK", input.task_id],
    ["PKT", input.packet_id],
    ["CLAIM", input.claim_id],
    ...input.component_ids.map((id) => ["CMP", id]),
  ] as const;
  if (
    identifiers.some(([prefix, value]) => !instance(prefix, value)) ||
    (input.initiative_id !== null && !instance("INIT", input.initiative_id)) ||
    !nonBlank(input.worker_id) ||
    !nonBlank(input.integrated_by) ||
    !nonBlank(input.lease.holder_id) ||
    !nonBlank(input.lease.nonce) ||
    !REVISION.test(input.original_base_revision) ||
    !REVISION.test(input.integration_base_revision) ||
    !REVISION.test(input.worker_head_revision) ||
    (input.prepared_commit_hash !== null && !REVISION.test(input.prepared_commit_hash)) ||
    (input.final_commit_hash !== null && !REVISION.test(input.final_commit_hash)) ||
    !SEMVER.test(input.profile_version) ||
    !SEMVER.test(input.catalog_version) ||
    !SHA256.test(input.profile_lock_hash) ||
    !SHA256.test(input.catalog_lock_hash) ||
    !SHA256.test(input.completion_archive_manifest_hash) ||
    input.changed_paths.some((path) => !safePath(path)) ||
    input.authorization_refs.some((id) => !instance("APR", id)) ||
    input.approval_ids.some((id) => !instance("APR", id)) ||
    input.remaining_risks.some((risk) => !nonBlank(risk))
  ) {
    return failure(
      "audit.input_invalid",
      "audit input must bind canonical IDs, revisions, paths, locks, actors, and commits",
      input.packet_id,
    );
  }
  return success(true);
}

function manifestWrite(packetId: string, manifest: IntegrationAuditManifest): PlannedWrite {
  return {
    relative_path: auditManifestPath(packetId),
    bytes: new TextEncoder().encode(canonicalJson(manifest)),
    expected_existing_sha256: null,
    mode: "create",
  };
}

function buildBundle(
  input: AuditEvidenceInput,
  dependencies: AuditEvidenceBuilderDependencies,
): RuntimeResult<AuditEvidenceBundle> {
  const valid = validateInput(input);
  if (!valid.ok) return valid;
  const gates = normalizedGates(input.gates);
  if (!gates.ok) return gates;
  const archives = normalizedArchives(input.archive_receipts);
  if (!archives.ok) return archives;
  if (!archives.value.some((receipt) =>
    receipt.manifest_hash === input.completion_archive_manifest_hash
  )) {
    return failure(
      "audit.completion_archive_missing",
      "completion archive hash must identify one exact supplied archive receipt",
      input.packet_id,
    );
  }
  const views = normalizedHashMap(input.generated_view_hashes);
  if (!views.ok) return views;
  const createdAt = canonicalTimestamp(dependencies.clock.now());
  if (createdAt === null) {
    return failure("audit.clock_invalid", "audit evidence requires a valid clock");
  }
  const evidenceId = dependencies.ids.next("EVD");
  if (!instance("EVD", evidenceId)) {
    return failure(
      "audit.evidence_id_invalid",
      "audit evidence factory must issue an EVD identifier",
      evidenceId,
    );
  }
  const checksNotRun = gates.value
    .filter((gate) => gate.status === "not_run")
    .map((gate) => ({
      gate_id: gate.gate_id,
      reason: gate.not_run_reason ?? "reason was not supplied",
    }));
  const archiveHashes = archives.value.map((receipt) => receipt.manifest_hash);
  const body: IntegrationAuditManifestBody = {
    schema_version: "1.0.0",
    evidence_id: evidenceId,
    root_id: input.root_id,
    component_ids: unique(input.component_ids),
    initiative_id: input.initiative_id,
    workstream_id: input.workstream_id,
    task_id: input.task_id,
    packet_id: input.packet_id,
    claim_id: input.claim_id,
    worker_id: input.worker_id,
    integrated_by: input.integrated_by,
    original_base_revision: input.original_base_revision,
    integration_base_revision: input.integration_base_revision,
    worker_head_revision: input.worker_head_revision,
    changed_paths: unique(input.changed_paths),
    authorization_refs: unique(input.authorization_refs),
    approval_ids: unique(input.approval_ids),
    lease_holder_id: input.lease.holder_id,
    lease_nonce_sha256: sha256(input.lease.nonce),
    gates: gates.value,
    profile_version: input.profile_version,
    profile_lock_hash: input.profile_lock_hash,
    catalog_version: input.catalog_version,
    catalog_lock_hash: input.catalog_lock_hash,
    generated_view_hashes: views.value,
    completion_archive_manifest_hash: input.completion_archive_manifest_hash,
    archive_manifest_hashes: archiveHashes,
    archive_receipts: archives.value,
    prepared_commit_hash: input.prepared_commit_hash,
    final_commit_hash: input.final_commit_hash,
    checks_not_run: checksNotRun,
    remaining_risks: unique(input.remaining_risks),
    created_at: createdAt,
    created_by: input.integrated_by,
  };
  const manifest: IntegrationAuditManifest = {
    ...body,
    audit_hash: sha256(canonicalJson(body)),
  };
  const serializedManifest = canonicalJson(manifest);
  if (!redactionStable(serializedManifest)) {
    return failure(
      "audit.secret_detected",
      "integration audit contains secret-bearing text that was not pre-redacted",
      input.packet_id,
    );
  }
  const manifestHash = sha256(serializedManifest);
  const notRunReason = checksNotRun.length === 0
    ? null
    : checksNotRun.map((check) => `${check.gate_id}: ${check.reason}`).join("; ");
  const record: EvidenceRecord = {
    id: evidenceId,
    type: "evidence",
    title: `Integration audit for ${input.packet_id}`,
    status: "accepted",
    root_id: input.root_id,
    component_ids: unique(input.component_ids),
    initiative_id: input.initiative_id,
    workstream_id: input.workstream_id,
    task_id: input.task_id,
    actor_id: input.integrated_by,
    authority_class: "integrator",
    created_at: createdAt,
    original_base_revision: input.original_base_revision,
    integration_base_revision: input.integration_base_revision,
    catalog_versions: [input.catalog_version],
    relationships: [],
    payload: {
      evidence_type: "integration-audit",
      exact_result: serializedManifest,
      source_refs: unique([
        input.packet_id,
        input.claim_id,
        input.task_id,
        ...archives.value.map((receipt) => receipt.source_ref),
      ]),
      hashes: {
        audit_body: manifest.audit_hash,
        audit_manifest: manifestHash,
        archive_manifest_set: sha256(canonicalJson(archiveHashes)),
        gate_evidence_set: sha256(canonicalJson(gates.value)),
        profile_lock: input.profile_lock_hash,
        catalog_lock: input.catalog_lock_hash,
        lease_nonce: manifest.lease_nonce_sha256,
      },
      not_run_reason: notRunReason,
    },
  };
  const writes = [manifestWrite(input.packet_id, manifest), recordWrite(record)]
    .sort((left, right) => compareUtf8(left.relative_path, right.relative_path));
  return success({
    record,
    manifest_body: body,
    manifest,
    record_hash: sha256(canonicalJson(record)),
    manifest_hash: manifestHash,
    writes,
  });
}

export function auditManifestPath(packetId: string): string {
  if (!instance("PKT", packetId)) {
    throw new RangeError("audit manifest path requires a canonical PKT identifier");
  }
  return `docs/project-memory/governance/integration/audit/${packetId}.json`;
}

export function createAuditEvidenceBuilder(
  dependencies: AuditEvidenceBuilderDependencies,
): AuditEvidenceBuilder {
  return { build: (input) => buildBundle(input, dependencies) };
}
