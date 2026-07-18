import type { Clock } from "../../src/index.js";
import type {
  CanonicalRecord,
  GovernanceEvent,
  UnsignedGovernanceEvent,
} from "../../src/governance/contracts/index.js";
import { signEvent } from "../../src/governance/events/event-chain-verifier.js";
import type { CanonicalSnapshot } from "../../src/governance/snapshot/snapshot-contracts.js";
import type { ViewSnapshotProvider } from "../../src/governance/views/view-drift.js";
import { success, type RuntimeResult } from "../../src/index.js";

const ROOT_ID = "ROOT-01J00000000000000000000020";
const COMPONENT_ID = "CMP-01J00000000000000000000020";
const WORKSTREAM_ID = "WS-01J00000000000000000000020";
const TASK_ID = "TASK-01J00000000000000000000020";
const EVIDENCE_ID = "EVD-01J00000000000000000000020";
const APPROVAL_ID = "APR-01J00000000000000000000020";

function record(
  id: string,
  type: CanonicalRecord["type"],
  title: string,
  status: CanonicalRecord["status"],
  createdAt: string,
  payload: Readonly<Record<string, unknown>>,
  relationships: CanonicalRecord["relationships"] = [],
): CanonicalRecord {
  return {
    id,
    type,
    title,
    status,
    root_id: ROOT_ID,
    component_ids: [COMPONENT_ID],
    initiative_id: null,
    workstream_id: WORKSTREAM_ID,
    task_id: TASK_ID,
    actor_id: type === "idea" ? "worker-a" : "pitaji",
    authority_class: type === "idea" ? "worker" : "pitaji",
    created_at: createdAt,
    original_base_revision: "1".repeat(40),
    integration_base_revision: "1".repeat(40),
    catalog_versions: ["1.0.0"],
    relationships,
    payload,
  };
}

function fixtureRecords(): readonly CanonicalRecord[] {
  const evidence = record(
    EVIDENCE_ID,
    "evidence",
    "Governance tests passed",
    "closed",
    "2026-07-14T12:30:00.000Z",
    {
      evidence_type: "test",
      exact_result: "46 governance tests passed",
      source_refs: ["npm test -- tests/governance"],
      hashes: {},
      not_run_reason: null,
    },
  );
  const approval = record(
    APPROVAL_ID,
    "approval",
    "Approve snapshot integration",
    "accepted",
    "2026-07-14T11:45:00.000Z",
    {
      approval_kind: "directional",
      granted_by: "Pitaji",
      target: TASK_ID,
      environment: "repository",
      scope: ["view generation"],
      timing: "before integration",
      expires_at: null,
      invalidation_conditions: ["source revision changes"],
    },
  );
  return [
    record(
      "IDEA-01J00000000000000000000020",
      "idea",
      "Add a visual dependency map",
      "proposed",
      "2026-07-14T12:10:00.000Z",
      { proposal: "Add graph view", disposition_reason: "Awaiting design review" },
    ),
    record(
      "DEC-01J00000000000000000000021",
      "decision",
      "Retire mutable handoff files",
      "superseded",
      "2026-07-14T11:00:00.000Z",
      {
        choice: "Use mutable handoffs",
        rationale: "Historical decision retained",
        alternatives: ["Generated views"],
        consequences: ["Superseded by canonical projections"],
      },
    ),
    record(
      "RISK-01J00000000000000000000020",
      "risk",
      "Manual view edits can mislead agents",
      "accepted",
      "2026-07-14T12:20:00.000Z",
      { likelihood: "high", impact: "high", mitigation: "Verify drift" },
    ),
    approval,
    record(
      "FIND-01J00000000000000000000020",
      "finding",
      "Current view was edited manually",
      "accepted",
      "2026-07-14T12:15:00.000Z",
      {
        severity: "high",
        description: "Generated heading differs from canonical projection",
        evidence_ids: [EVIDENCE_ID],
        remediation_proposal_ids: [],
      },
      [{ type: "evidences", target_id: EVIDENCE_ID, note: "Verified drift" }],
    ),
    record(
      "DEC-01J00000000000000000000020",
      "decision",
      "Use revision-pinned snapshots",
      "accepted",
      "2026-07-14T12:00:00.000Z",
      {
        choice: "Read exact Git objects",
        rationale: "Mutable files cannot change historical truth",
        alternatives: ["Working-tree reads"],
        consequences: ["Views are reproducible"],
      },
    ),
    record(
      "CHG-01J00000000000000000000020",
      "change",
      "Add snapshot and view governance",
      "closed",
      "2026-07-14T13:00:00.000Z",
      {
        summary: "Added immutable history and deterministic views",
        files: ["src/governance"],
        commits: ["98410eb"],
        artifacts: ["canonical snapshot"],
        authorization_refs: [APPROVAL_ID],
      },
      [{ type: "evidences", target_id: EVIDENCE_ID, note: "Tests passed" }],
    ),
    evidence,
    record(
      "CHG-01J00000000000000000000021",
      "change",
      "Unvalidated proposed change",
      "proposed",
      "2026-07-14T13:05:00.000Z",
      {
        summary: "Must not enter changelog",
        files: [],
        commits: [],
        artifacts: [],
        authorization_refs: [],
      },
    ),
  ];
}

function fixtureEvents(): readonly GovernanceEvent[] {
  const validated: UnsignedGovernanceEvent = {
    aggregate_id: TASK_ID,
    event_type: "integration_validated",
    occurred_at: "2026-07-14T13:10:00.000Z",
    actor_id: "integrator-a",
    authority_class: "integrator",
    evidence_ids: [EVIDENCE_ID],
    payload: { status: "validated" },
  };
  const first = signEvent(validated, null);
  return [
    first,
    signEvent(
      {
        ...validated,
        event_type: "integrated_verified",
        occurred_at: "2026-07-14T13:15:00.000Z",
        payload: { status: "integrated_verified", commit_revision: "9".repeat(40) },
      },
      first,
    ),
  ];
}

export function viewSnapshotFixture(): CanonicalSnapshot {
  const records = fixtureRecords();
  const markdown = (
    type: "component" | "domain" | "workstream" | "task",
    id: string,
    title: string,
    status: string,
  ) => ({
    envelope: {
      schema: "project-memory/canonical-markdown" as const,
      type,
      version: "1.0.0" as const,
      id,
      revision: 1,
      root_id: ROOT_ID,
      approval_refs: [APPROVAL_ID],
    },
    body: `# ${title}\n\nStatus: ${status}\n`,
  });
  return {
    source_revision: "1".repeat(40),
    source_kind: "commit",
    root_id: ROOT_ID,
    profile_revision: 1,
    profile_lock_hash: "a".repeat(64),
    selected_catalog_lock_hash: "c".repeat(64),
    catalog_versions: ["1.0.0"],
    source_paths: [
      "docs/project-memory/profile.lock.yaml",
      "docs/project-memory/project.yaml",
      "docs/project-memory/source/PROJECT.md",
    ],
    source_hashes: {
      "docs/project-memory/profile.lock.yaml": "a".repeat(64),
      "docs/project-memory/project.yaml": "b".repeat(64),
      "docs/project-memory/source/PROJECT.md": "d".repeat(64),
    },
    blob_object_ids: {
      "docs/project-memory/profile.lock.yaml": "1".repeat(40),
      "docs/project-memory/project.yaml": "2".repeat(40),
      "docs/project-memory/source/PROJECT.md": "3".repeat(40),
    },
    project: { root: { id: ROOT_ID } },
    profile_lock: { schema_version: "1.0.0", lock_hash: "a".repeat(64) },
    source_documents: [
      { relative_path: "docs/project-memory/source/PROJECT.md", text: "# Project\n" },
    ],
    components: [markdown("component", COMPONENT_ID, "Governance", "active")],
    domains: [
      markdown(
        "domain",
        "DOM-01J00000000000000000000020",
        "Governance Coordination",
        "active",
      ),
    ],
    initiatives: [],
    workstreams: [
      markdown("workstream", WORKSTREAM_ID, "Governance Runtime", "active"),
      markdown(
        "workstream",
        "WS-01J00000000000000000000021",
        "Legacy Migration",
        "completed",
      ),
    ],
    tasks: [markdown("task", TASK_ID, "Generate deterministic views", "active")],
    records,
    effective_records: records.filter((item) => item.status !== "superseded"),
    evidence: records.filter((item) => item.type === "evidence"),
    risks: records.filter((item) => item.type === "risk"),
    approvals: records.filter((item) => item.type === "approval"),
    claims: [
      {
        relative_path: `docs/project-memory/governance/claims/CLAIM-01J00000000000000000000020.json`,
        value: { id: "CLAIM-01J00000000000000000000020", status: "active" },
      },
    ],
    events: fixtureEvents(),
  } as unknown as CanonicalSnapshot;
}

export class CountingClock implements Clock {
  calls = 0;

  constructor(private readonly value: Date) {}

  now(): Date {
    this.calls += 1;
    return new Date(this.value.getTime());
  }
}

export class MutableSnapshotProvider implements ViewSnapshotProvider {
  constructor(public value: CanonicalSnapshot) {}

  current(): Promise<RuntimeResult<CanonicalSnapshot>> {
    return Promise.resolve(success(this.value));
  }
}
