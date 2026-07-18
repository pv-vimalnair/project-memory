import { beforeEach, describe, expect, it } from "vitest";

import {
  FixedClock,
  PROJECT_SCHEMA_REGISTRARS,
  canonicalJson,
  registerProjectSchemas,
  sha256,
  validateWithSchema,
  type IdFactory,
} from "../../src/index.js";
import {
  auditManifestPath,
  createAuditEvidenceBuilder,
  type AuditEvidenceInput,
} from "../../src/governance/integration/audit-evidence.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const SUFFIX = "01J00000000000000000000042";
const ROOT_ID = `ROOT-${SUFFIX}`;
const INITIATIVE_ID = `INIT-${SUFFIX}`;
const WORKSTREAM_ID = `WS-${SUFFIX}`;
const TASK_ID = `TASK-${SUFFIX}`;
const PACKET_ID = `PKT-${SUFFIX}`;
const CLAIM_ID = `CLAIM-${SUFFIX}`;
const APPROVAL_ID = `APR-${SUFFIX}`;
const EVIDENCE_ID = `EVD-${SUFFIX}`;
const COMPONENT_A = `CMP-${SUFFIX}`;
const COMPONENT_B = "CMP-01J00000000000000000000043";
const ORIGINAL_BASE = "1".repeat(40);
const INTEGRATION_BASE = "2".repeat(40);
const WORKER_HEAD = "3".repeat(40);
const PREPARED_COMMIT = "4".repeat(40);
const FINAL_COMMIT = "5".repeat(40);
const PROFILE_HASH = "a".repeat(64);
const CATALOG_HASH = "b".repeat(64);
const SOURCE_HASH = "c".repeat(64);
const STORED_HASH = "d".repeat(64);
const ARCHIVE_HASH = "e".repeat(64);
const VIEW_A_HASH = "f".repeat(64);
const VIEW_B_HASH = "0".repeat(64);
const NOW = new Date("2026-07-15T09:00:00.000Z");
const LEASE_NONCE = "fixed-sensitive-lease-nonce-that-must-never-persist";

const fixedIds: IdFactory = {
  next(prefix) {
    if (prefix !== "EVD") throw new Error(`unexpected prefix: ${prefix}`);
    return EVIDENCE_ID;
  },
};

function commandEvidence() {
  return {
    schema_version: "1.0.0" as const,
    gate_id: "gate.unit",
    definition_ref: "adapter.node.test@1.0.0",
    evidence_type: "test-result",
    execution_kind: "command" as const,
    status: "passed" as const,
    required: true,
    conflict_sensitive: true,
    command: { executable: "node", args: ["--test"], cwd: "." },
    verifier_role: null,
    exit_code: 0,
    stdout_redacted: "24 tests passed",
    stderr_redacted: "",
    stdout_sha256: sha256("24 tests passed"),
    stderr_sha256: sha256(""),
    evidence_ids: [] as string[],
    approval_refs: [] as string[],
    occurred_at: NOW.toISOString(),
    duration_ms: 25,
    not_run_reason: null,
  };
}

function notRunEvidence() {
  return {
    schema_version: "1.0.0" as const,
    gate_id: "gate.device-review",
    definition_ref: "adapter.device.review@1.0.0",
    evidence_type: "human-verification",
    execution_kind: "check" as const,
    status: "not_run" as const,
    required: false,
    conflict_sensitive: false,
    command: null,
    verifier_role: "external",
    exit_code: null,
    stdout_redacted: "",
    stderr_redacted: "",
    stdout_sha256: sha256(""),
    stderr_sha256: sha256(""),
    evidence_ids: [] as string[],
    approval_refs: [APPROVAL_ID],
    occurred_at: NOW.toISOString(),
    duration_ms: 0,
    not_run_reason: "device lab was unavailable",
  };
}

function input(overrides: Partial<AuditEvidenceInput> = {}): AuditEvidenceInput {
  return {
    root_id: ROOT_ID,
    component_ids: [COMPONENT_B, COMPONENT_A],
    initiative_id: INITIATIVE_ID,
    workstream_id: WORKSTREAM_ID,
    task_id: TASK_ID,
    packet_id: PACKET_ID,
    claim_id: CLAIM_ID,
    worker_id: "worker-a",
    integrated_by: "integrator-a",
    original_base_revision: ORIGINAL_BASE,
    integration_base_revision: INTEGRATION_BASE,
    worker_head_revision: WORKER_HEAD,
    changed_paths: ["src/z.ts", "src/a.ts"],
    authorization_refs: [APPROVAL_ID],
    approval_ids: [APPROVAL_ID],
    lease: { holder_id: "integrator-a", nonce: LEASE_NONCE },
    gates: [notRunEvidence(), commandEvidence()],
    profile_version: "1.2.0",
    profile_lock_hash: PROFILE_HASH,
    catalog_version: "1.4.0",
    catalog_lock_hash: CATALOG_HASH,
    generated_view_hashes: {
      "docs/project-memory/views/WORKSTREAMS.md": VIEW_B_HASH,
      "docs/project-memory/views/NOW.md": VIEW_A_HASH,
    },
    completion_archive_manifest_hash: ARCHIVE_HASH,
    archive_receipts: [{
      source_ref: PACKET_ID,
      object_kind: "completion-packet",
      source_hash: SOURCE_HASH,
      stored_hash: STORED_HASH,
      manifest_hash: ARCHIVE_HASH,
      redaction_report: {
        redacted: true,
        rule_ids: ["credential-value"],
        replacement_count: 1,
        review_required: false,
      },
    }],
    prepared_commit_hash: PREPARED_COMMIT,
    final_commit_hash: FINAL_COMMIT,
    remaining_risks: ["Device review remains pending"],
    ...overrides,
  };
}

function builder() {
  return createAuditEvidenceBuilder({
    clock: new FixedClock(NOW),
    ids: fixedIds,
  });
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

describe("immutable integration audit evidence", () => {
  it("binds complete integration provenance into one EVD record and manifest", () => {
    const result = builder().build(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.manifest).toMatchObject({
      schema_version: "1.0.0",
      evidence_id: EVIDENCE_ID,
      root_id: ROOT_ID,
      initiative_id: INITIATIVE_ID,
      workstream_id: WORKSTREAM_ID,
      task_id: TASK_ID,
      packet_id: PACKET_ID,
      claim_id: CLAIM_ID,
      original_base_revision: ORIGINAL_BASE,
      integration_base_revision: INTEGRATION_BASE,
      worker_head_revision: WORKER_HEAD,
      changed_paths: ["src/a.ts", "src/z.ts"],
      authorization_refs: [APPROVAL_ID],
      approval_ids: [APPROVAL_ID],
      lease_holder_id: "integrator-a",
      lease_nonce_sha256: sha256(LEASE_NONCE),
      profile_version: "1.2.0",
      profile_lock_hash: PROFILE_HASH,
      catalog_version: "1.4.0",
      catalog_lock_hash: CATALOG_HASH,
      completion_archive_manifest_hash: ARCHIVE_HASH,
      archive_manifest_hashes: [ARCHIVE_HASH],
      prepared_commit_hash: PREPARED_COMMIT,
      final_commit_hash: FINAL_COMMIT,
      checks_not_run: [{
        gate_id: "gate.device-review",
        reason: "device lab was unavailable",
      }],
      remaining_risks: ["Device review remains pending"],
      created_at: NOW.toISOString(),
      created_by: "integrator-a",
    });
    expect(result.value.manifest.gates.map((gate) => gate.gate_id)).toEqual([
      "gate.device-review",
      "gate.unit",
    ]);
    expect(result.value.manifest.generated_view_hashes).toEqual({
      "docs/project-memory/views/NOW.md": VIEW_A_HASH,
      "docs/project-memory/views/WORKSTREAMS.md": VIEW_B_HASH,
    });
    expect(result.value.manifest.archive_receipts[0]).toMatchObject({
      source_hash: SOURCE_HASH,
      stored_hash: STORED_HASH,
      manifest_hash: ARCHIVE_HASH,
      redaction_report: { replacement_count: 1 },
    });
    expect(result.value.record).toMatchObject({
      id: EVIDENCE_ID,
      type: "evidence",
      status: "accepted",
      root_id: ROOT_ID,
      workstream_id: WORKSTREAM_ID,
      task_id: TASK_ID,
      authority_class: "integrator",
    });
    expect(
      validateWithSchema(
        "project-memory/v1/canonical-record",
        result.value.record,
      ),
    ).toMatchObject({ ok: true });
    expect(result.value.record.payload.exact_result).toBe(
      canonicalJson(result.value.manifest),
    );
    expect(result.value.writes.map((write) => write.relative_path)).toEqual([
      auditManifestPath(PACKET_ID),
      `docs/project-memory/records/evidence/${EVIDENCE_ID}.json`,
    ]);
    expect(result.value.writes.every((write) => write.mode === "create")).toBe(true);
  });

  it("never persists the raw lease nonce and self-verifies every output hash", () => {
    const result = builder().build(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const persisted = result.value.writes
      .map((write) => new TextDecoder().decode(write.bytes))
      .join("\n");

    expect(persisted).not.toContain(LEASE_NONCE);
    expect(result.value.manifest.audit_hash).toBe(
      sha256(canonicalJson(result.value.manifest_body)),
    );
    expect(result.value.manifest_hash).toBe(
      sha256(canonicalJson(result.value.manifest)),
    );
    expect(result.value.record_hash).toBe(
      sha256(canonicalJson(result.value.record)),
    );
    expect(result.value.record.payload.hashes.lease_nonce).toBe(
      sha256(LEASE_NONCE),
    );
  });

  it("produces byte-stable evidence for semantically identical unordered input", () => {
    const first = builder().build(input());
    const second = builder().build(input({
      component_ids: [COMPONENT_A, COMPONENT_B],
      changed_paths: ["src/a.ts", "src/z.ts"],
      gates: [commandEvidence(), notRunEvidence()],
      generated_view_hashes: {
        "docs/project-memory/views/NOW.md": VIEW_A_HASH,
        "docs/project-memory/views/WORKSTREAMS.md": VIEW_B_HASH,
      },
    }));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.manifest).toEqual(first.value.manifest);
      expect(second.value.record).toEqual(first.value.record);
      expect(second.value.writes).toEqual(first.value.writes);
    }
  });

  it("rejects duplicate gate identities and missing completion archives", () => {
    const duplicate = builder().build(input({
      gates: [commandEvidence(), commandEvidence()],
    }));
    expect(duplicate).toMatchObject({
      ok: false,
      issues: [{ code: "audit.gate_duplicate" }],
    });

    const missing = builder().build(input({
      completion_archive_manifest_hash: "9".repeat(64),
    }));
    expect(missing).toMatchObject({
      ok: false,
      issues: [{ code: "audit.completion_archive_missing" }],
    });
  });

  it("rejects gate output that has not already been redacted", () => {
    const unsafe = {
      ...commandEvidence(),
      stdout_redacted: "api_key=synthetic-test-unredacted",
      stdout_sha256: sha256("api_key=synthetic-test-unredacted"),
    };
    const result = builder().build(input({ gates: [unsafe] }));

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "audit.gate_output_not_redacted" }],
    });
  });
  it("accepts standardized quoted redaction markers without rewriting them", () => {
    const marker = "[REDACTED:credential-value:" + "a".repeat(12) + "]";
    const safe = {
      ...commandEvidence(),
      stdout_redacted: JSON.stringify({ api_key: marker }),
      stdout_sha256: sha256('{"api_key":"original"}'),
    };
    const result = builder().build(input({ gates: [safe] }));

    expect(result).toMatchObject({ ok: true });
  });
});
