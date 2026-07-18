import { beforeEach, describe, expect, it } from "vitest";

import {
  PROJECT_SCHEMA_REGISTRARS,
  getSchemaValidator,
  registerProjectSchemas,
  validateWithSchema,
} from "../../src/index.js";
import { GOVERNANCE_SCHEMA_IDS } from "../../src/governance/contracts/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const SUFFIX = "01J00000000000000000000000";
const ROOT_ID = `ROOT-${SUFFIX}`;
const TASK_ID = `TASK-${SUFFIX}`;
const WORKSTREAM_ID = `WS-${SUFFIX}`;
const PACKET_ID = `PKT-${SUFFIX}`;
const APPROVAL_ID = `APR-${SUFFIX}`;
const EVIDENCE_ID = `EVD-${SUFFIX}`;
const REVISION = "0123456789abcdef0123456789abcdef01234567";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const AT = "2026-07-14T12:00:00.000Z";

function decisionRecord() {
  return {
    id: `DEC-${SUFFIX}`,
    type: "decision",
    title: "Keep one canonical hub",
    status: "accepted",
    root_id: ROOT_ID,
    component_ids: [],
    initiative_id: null,
    workstream_id: WORKSTREAM_ID,
    task_id: TASK_ID,
    actor_id: "pitaji",
    authority_class: "pitaji",
    created_at: AT,
    original_base_revision: REVISION,
    integration_base_revision: REVISION,
    catalog_versions: ["1.0.0"],
    relationships: [],
    payload: {
      choice: "Use one memory-hub repository",
      rationale: "Serialized integration prevents competing truth",
      alternatives: ["Independent mutable handoffs"],
      consequences: ["Satellites reference the hub"],
    },
  };
}

const payloadCases = [
  [
    "idea",
    `IDEA-${SUFFIX}`,
    { proposal: "Add a verified view", disposition_reason: "Needs review" },
  ],
  [
    "change",
    `CHG-${SUFFIX}`,
    {
      summary: "Add governance contracts",
      files: ["src/governance/contracts/index.ts"],
      commits: [REVISION],
      artifacts: ["schemas/project-memory/v1/canonical-record.schema.json"],
      authorization_refs: [APPROVAL_ID],
    },
  ],
  [
    "finding",
    `FIND-${SUFFIX}`,
    {
      severity: "high",
      description: "A mutable history path was detected",
      evidence_ids: [EVIDENCE_ID],
      remediation_proposal_ids: [`IDEA-${SUFFIX}`],
    },
  ],
  [
    "risk",
    `RISK-${SUFFIX}`,
    { likelihood: "medium", impact: "high", mitigation: "Use CAS refs" },
  ],
  [
    "evidence",
    EVIDENCE_ID,
    {
      evidence_type: "test-result",
      exact_result: "153 tests passed",
      source_refs: ["tests/governance/contracts.test.ts"],
      hashes: { output: HASH },
      not_run_reason: null,
    },
  ],
  [
    "lesson",
    `LESSON-${SUFFIX}`,
    {
      observation: "Snapshots need compact manifests",
      evidence_ids: [EVIDENCE_ID],
      rule: "Keep exact bytes compressed and manifests reviewable",
    },
  ],
  [
    "approval",
    APPROVAL_ID,
    {
      approval_kind: "directional",
      granted_by: "Pitaji",
      target: "refs/heads/main",
      environment: "repository",
      scope: ["profile.bootstrap"],
      timing: "before integration",
      expires_at: null,
      invalidation_conditions: ["target ref changes"],
    },
  ],
] as const;

function recordFor(
  type: (typeof payloadCases)[number][0],
  id: string,
  payload: (typeof payloadCases)[number][2],
) {
  return { ...decisionRecord(), id, type, payload };
}

const otherContracts = [
  [
    "project-memory/v1/bootstrap-audit",
    {
      schema_version: "1.0.0",
      root_id: ROOT_ID,
      target_ref: "refs/heads/main",
      parent_revision: REVISION,
      compilation_plan_hash: HASH,
      source_proposal_hash: HASH,
      profile_lock_hash: HASH,
      catalog_lock_hash: HASH,
      approval_record_id: APPROVAL_ID,
      evidence_record_id: EVIDENCE_ID,
      bootstrap_event_hash: HASH,
      planned_content_hashes: { "PROJECT_CONTEXT.md": HASH },
      generated_view_hashes: { "docs/project-memory/views/NOW.md": HASH },
      bootstrap_content_hash: HASH,
      checks: [{ id: "profile.verify", status: "passed", evidence_id: EVIDENCE_ID }],
      remaining_risks: [],
      created_at: AT,
      created_by: "integrator-a",
    },
  ],
  [
    "project-memory/v1/governance-event",
    {
      aggregate_id: TASK_ID,
      sequence: 1,
      event_type: "task_integrated",
      occurred_at: AT,
      actor_id: "integrator-a",
      authority_class: "integrator",
      previous_event_hash: null,
      payload_hash: HASH,
      evidence_ids: [EVIDENCE_ID],
      event_hash: OTHER_HASH,
      payload: { status: "integrated_verified" },
    },
  ],
  [
    "project-memory/v1/view-metadata",
    {
      schema_version: "1.0.0",
      view_id: "now",
      relative_path: "docs/project-memory/views/NOW.md",
      source_revision: REVISION,
      profile_version: "1.0.0",
      profile_lock_hash: HASH,
      catalog_version: "1.0.0",
      catalog_lock_hash: HASH,
      source_set_hash: HASH,
      generated_at: AT,
      content_hash: OTHER_HASH,
    },
  ],
  [
    "project-memory/v1/archive-manifest",
    {
      schema_version: "1.0.0",
      manifest_hash: HASH,
      source_hash: HASH,
      stored_hash: OTHER_HASH,
      object_kind: "completion-packet",
      object_path: `docs/project-memory/archive/objects/sha256/bb/${OTHER_HASH}`,
      media_type: "application/json",
      redaction_report: {
        redacted: true,
        rule_ids: ["credential-value"],
        replacement_count: 1,
        review_required: false,
      },
      actor_id: "worker-a",
      created_at: AT,
      source_refs: [PACKET_ID],
    },
  ],
  [
    "project-memory/v1/integration-lease",
    {
      schema_version: "1.0.0",
      holder_id: "integrator-a",
      authority_class: "integrator",
      base_revision: REVISION,
      target_ref: "refs/heads/main",
      acquired_at: AT,
      last_heartbeat_at: AT,
      expires_at: "2026-07-14T12:05:00.000Z",
      nonce: "fixed-test-nonce-with-at-least-32-bytes",
      takeover_approval_id: null,
    },
  ],
  [
    "project-memory/v1/gate-evidence",
    {
      schema_version: "1.0.0",
      gate_id: "gate.contracts",
      definition_ref: "project-memory/gates/contracts@1.0.0",
      evidence_type: "test-result",
      execution_kind: "command",
      status: "passed",
      required: true,
      conflict_sensitive: true,
      command: { executable: "node", args: ["--test"], cwd: "." },
      verifier_role: null,
      exit_code: 0,
      stdout_redacted: "passed",
      stderr_redacted: "",
      stdout_sha256: HASH,
      stderr_sha256: OTHER_HASH,
      evidence_ids: [EVIDENCE_ID],
      approval_refs: [],
      occurred_at: AT,
      duration_ms: 12,
      not_run_reason: null,
    },
  ],
  [
    "project-memory/v1/prepared-satellite",
    {
      schema_version: "1.0.0",
      root_id: ROOT_ID,
      repository_id: "satellite-a",
      task_id: TASK_ID,
      packet_id: PACKET_ID,
      state: "prepared",
      original_base_revision: REVISION,
      integration_base_revision: REVISION,
      commit_hash: REVISION,
      manifest_hash: HASH,
      manifest_ref: `refs/project-memory/prepared/${PACKET_ID}/${HASH}`,
      task_packet_hash: HASH,
      completion_packet_hash: HASH,
      profile_version: "1.0.0",
      profile_lock_hash: HASH,
      catalog_version: "1.0.0",
      catalog_lock_hash: HASH,
      approval_ids: [APPROVAL_ID],
      evidence_ids: [EVIDENCE_ID],
      gate_evidence_hashes: [HASH],
      changed_paths: ["src/index.ts"],
      artifact_hashes: { "dist/index.js": HASH },
      generated_view_hashes: { "docs/project-memory/views/NOW.md": HASH },
      archive_manifest_hashes: [HASH],
      audit_evidence_id: EVIDENCE_ID,
      prepared_at: AT,
      prepared_by: "integrator-a",
    },
  ],
  [
    "project-memory/v1/hub-finalization",
    {
      schema_version: "1.0.0",
      status: "hub_finalized",
      hub_root_id: ROOT_ID,
      packet_id: PACKET_ID,
      previous_revision: REVISION,
      commit_revision: REVISION,
      satellite_manifest_hashes: [HASH],
      satellite_commit_hashes: [REVISION],
      audit_evidence_id: EVIDENCE_ID,
      generated_view_hashes: { "docs/project-memory/views/NOW.md": HASH },
      finalized_at: AT,
      finalized_by: "integrator-a",
      receipt_hash: OTHER_HASH,
    },
  ],
] as const;

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

describe("governance contracts", () => {
  it("registers the complete governance schema surface", () => {
    expect(GOVERNANCE_SCHEMA_IDS).toHaveLength(9);
    for (const id of GOVERNANCE_SCHEMA_IDS) {
      expect(getSchemaValidator(id)).toBeDefined();
    }
  });

  it("accepts an immutable decision record with complete provenance", () => {
    expect(
      validateWithSchema("project-memory/v1/canonical-record", decisionRecord()),
    ).toMatchObject({ ok: true });
  });

  it.each(payloadCases)("requires the exact %s record payload", (type, id, payload) => {
    expect(
      validateWithSchema(
        "project-memory/v1/canonical-record",
        recordFor(type, id, payload),
      ),
    ).toMatchObject({ ok: true });
  });

  it("rejects generic base_revision and invalid authority", () => {
    expect(
      validateWithSchema("project-memory/v1/canonical-record", {
        ...decisionRecord(),
        base_revision: REVISION,
      }).ok,
    ).toBe(false);
    expect(
      validateWithSchema("project-memory/v1/canonical-record", {
        ...decisionRecord(),
        authority_class: "administrator",
      }).ok,
    ).toBe(false);
  });

  it("rejects a record payload with a missing required field", () => {
    expect(
      validateWithSchema("project-memory/v1/canonical-record", {
        ...decisionRecord(),
        id: `IDEA-${SUFFIX}`,
        type: "idea",
        payload: { proposal: "Unreviewed proposal" },
      }).ok,
    ).toBe(false);
  });

  it("rejects a lease without an expiry or nonce", () => {
    expect(
      validateWithSchema("project-memory/v1/integration-lease", {
        holder_id: "integrator-a",
        base_revision: REVISION,
      }).ok,
    ).toBe(false);
  });

  it.each(otherContracts)("accepts strict %s bytes", (schemaId, value) => {
    expect(validateWithSchema(schemaId, value)).toMatchObject({ ok: true });
  });
});
