import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  applyFileTransaction,
  parseCanonicalMarkdown,
  PROJECT_SCHEMA_REGISTRARS,
  registerProjectSchemas,
  success,
  type PlannedWrite,
  type RuntimeResult,
} from "../../src/index.js";
import {
  ALLOWED_WORK_TRANSITIONS,
  createWorkLifecycleService,
  initiativeDocumentPath,
  isWorkTransitionAllowed,
  taskDocumentPath,
  workstreamDocumentPath,
  type WorkLifecyclePlanningContext,
  type WorkLifecyclePlanningContextProvider,
  type WorkStatus,
} from "../../src/governance/work/work-lifecycle-service.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import { makeValidTaskPacket } from "../fixtures/selection/runtime-packet-fixtures.js";

const ROOT_ID = "ROOT-01J00000000000000000000001";
const INITIATIVE_ID = "INIT-01J00000000000000000000001";
const WORKSTREAM_ID = "WS-01J00000000000000000000001";
const APPROVAL_ID = "APR-01J00000000000000000000001";
const EVIDENCE_ID = "EVD-01J00000000000000000000001";
const BASE = "0123456789abcdef0123456789abcdef01234567";
const PROFILE = "a".repeat(64);
const roots: string[] = [];

class FixedClock {
  now(): Date {
    return new Date("2026-07-14T12:00:00.000Z");
  }
}

class ContextProvider implements WorkLifecyclePlanningContextProvider {
  value: WorkLifecyclePlanningContext = {
    root_id: ROOT_ID,
    target_ref: "refs/heads/main",
    expected_head: BASE,
    profile_lock_hash: PROFILE,
    actor_id: "Pitaji",
    authority_class: "pitaji",
    approval_ids: [APPROVAL_ID],
  };

  context(): Promise<RuntimeResult<WorkLifecyclePlanningContext>> {
    return Promise.resolve(success(this.value));
  }
}

async function root(): Promise<URL> {
  const directory = await mkdtemp(path.join(tmpdir(), "project-memory-work-"));
  roots.push(directory);
  return pathToFileURL(`${directory}${path.sep}`);
}

function creationInput(repository: URL) {
  return {
    root: repository,
    initiative_id: INITIATIVE_ID,
    title: "Ship trusted project memory",
    objective: "Preserve complete context across agent handoffs.",
    owners: ["Pitaji"],
    acceptance_criteria: ["Every canonical transition is auditable."],
  } as const;
}

async function exists(repository: URL, relativePath: string): Promise<boolean> {
  try {
    await lstat(new URL(relativePath, repository));
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function documentWrite(plan: { readonly writes: readonly PlannedWrite[] }): PlannedWrite {
  const write = plan.writes.find((candidate) => candidate.relative_path.endsWith(".md"));
  if (write === undefined) throw new Error("document write missing");
  return write;
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
});

afterAll(async () => {
  await Promise.all(roots.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("work lifecycle planning", () => {
  it("defines every legal transition and rejects every unlisted transition", () => {
    for (const artifactType of ["initiative", "workstream", "task_packet"] as const) {
      const states = ALLOWED_WORK_TRANSITIONS[artifactType] as Readonly<Record<string, readonly string[]>>;
      const knownStatuses = Object.keys(states);
      for (const [fromStatus, allowed] of Object.entries(states)) {
        for (const toStatus of knownStatuses) {
          expect(
            isWorkTransitionAllowed(
              artifactType,
              fromStatus as WorkStatus,
              toStatus as WorkStatus,
            ),
          ).toBe(allowed.includes(toStatus));
        }
      }
    }
  });
  it("replays one exact lifecycle timestamp across different process clocks", async () => {
    const repository = await root();
    const contexts = new ContextProvider();
    const input = {
      ...creationInput(repository),
      created_at: "2026-07-14T12:01:00.000Z",
    };
    const first = createWorkLifecycleService({
      clock: { now: () => new Date("2026-07-14T12:01:01.000Z") },
      context: contexts,
    });
    const second = createWorkLifecycleService({
      clock: { now: () => new Date("2026-07-14T12:04:59.000Z") },
      context: contexts,
    });

    const firstPlan = await first.planCreateInitiative(input);
    const secondPlan = await second.planCreateInitiative(input);

    expect(firstPlan).toEqual(secondPlan);
    expect(firstPlan).toMatchObject({
      ok: true,
      value: {
        created_at: input.created_at,
        expires_at: "2026-07-14T12:06:00.000Z",
      },
    });
    expect(await first.planCreateInitiative({
      ...input,
      created_at: "2026-07-14T12:01:00Z",
    })).toMatchObject({
      ok: false,
      issues: [{ code: "work.clock_invalid" }],
    });
    expect(await first.planCreateInitiative({
      ...input,
      created_at: "2026-07-14T13:01:00.000Z",
    })).toMatchObject({
      ok: false,
      issues: [{ code: "work.clock_out_of_window" }],
    });
  });
  it("plans an initiative without mutating canonical state", async () => {
    const repository = await root();
    const contexts = new ContextProvider();
    const service = createWorkLifecycleService({ clock: new FixedClock(), context: contexts });

    const result = await service.planCreateInitiative(creationInput(repository));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mutation_kind).toBe("work_lifecycle");
    expect(result.value.metadata).toMatchObject({
      governance_kind: "work_lifecycle",
      operation: "create",
      artifact_type: "initiative",
      from_status: null,
      to_status: "proposed",
    });
    expect(await exists(repository, initiativeDocumentPath(INITIATIVE_ID))).toBe(false);
    const parsed = parseCanonicalMarkdown(documentWrite(result.value).bytes);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.envelope.revision).toBe(1);
      expect(parsed.value.body).toContain("Status: proposed");
    }
    expect(result.value.writes).toHaveLength(2);
    contexts.value = {
      ...contexts.value,
      actor_id: "agent.integrator",
      authority_class: "integrator",
    };
    expect(await service.planCreateInitiative(creationInput(repository))).toMatchObject({ ok: true });
  });

  it("plans an event-backed canonical transition with an exact pre-image", async () => {
    const repository = await root();
    const contexts = new ContextProvider();
    const service = createWorkLifecycleService({ clock: new FixedClock(), context: contexts });
    const created = await service.planCreateInitiative(creationInput(repository));
    if (!created.ok) throw new Error(JSON.stringify(created.issues));
    expect((await applyFileTransaction(repository, created.value.writes)).ok).toBe(true);

    const transitioned = await service.planTransition({
      root: repository,
      artifact_type: "initiative",
      artifact_id: INITIATIVE_ID,
      workstream_id: null,
      expected_status: "proposed",
      next_status: "accepted",
      approval_ids: [APPROVAL_ID],
      evidence_ids: [],
    });

    expect(transitioned.ok).toBe(true);
    if (!transitioned.ok) return;
    expect(await exists(repository, initiativeDocumentPath(INITIATIVE_ID))).toBe(true);
    const replacement = documentWrite(transitioned.value);
    expect(replacement.mode).toBe("replace");
    expect(replacement.expected_existing_sha256).toMatch(/^[0-9a-f]{64}$/);
    const parsed = parseCanonicalMarkdown(replacement.bytes);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.envelope.revision).toBe(2);
      expect(parsed.value.body).toContain("Status: accepted");
    }
    expect(transitioned.value.event_ids).toHaveLength(1);
  });

  it("rejects unauthorized, illegal, and terminal transitions", async () => {
    const repository = await root();
    const contexts = new ContextProvider();
    const service = createWorkLifecycleService({ clock: new FixedClock(), context: contexts });
    const created = await service.planCreateInitiative(creationInput(repository));
    if (!created.ok) throw new Error(JSON.stringify(created.issues));
    expect((await applyFileTransaction(repository, created.value.writes)).ok).toBe(true);

    contexts.value = { ...contexts.value, actor_id: "agent.integrator", authority_class: "integrator" };
    const denied = await service.planTransition({
      root: repository,
      artifact_type: "initiative",
      artifact_id: INITIATIVE_ID,
      workstream_id: null,
      expected_status: "proposed",
      next_status: "accepted",
      approval_ids: [APPROVAL_ID],
      evidence_ids: [],
    });
    expect(denied).toMatchObject({ ok: false, issues: [{ code: "work.authority_denied" }] });

    contexts.value = { ...contexts.value, actor_id: "Pitaji", authority_class: "pitaji" };
    const illegal = await service.planTransition({
      root: repository,
      artifact_type: "initiative",
      artifact_id: INITIATIVE_ID,
      workstream_id: null,
      expected_status: "proposed",
      next_status: "completed",
      approval_ids: [APPROVAL_ID],
      evidence_ids: [EVIDENCE_ID],
    });
    expect(illegal).toMatchObject({ ok: false, issues: [{ code: "work.transition_illegal" }] });
    expect(ALLOWED_WORK_TRANSITIONS.initiative.completed).toEqual([]);
    expect(ALLOWED_WORK_TRANSITIONS.workstream.cancelled).toEqual([]);
    expect(ALLOWED_WORK_TRANSITIONS.task_packet.integrated_verified).toEqual([]);
  });

  it("consumes the exact planning-owned task packet and requires an active workstream", async () => {
    const repository = await root();
    const contexts = new ContextProvider();
    contexts.value = {
      ...contexts.value,
      actor_id: "agent.integrator",
      authority_class: "integrator",
    };
    const service = createWorkLifecycleService({ clock: new FixedClock(), context: contexts });
    const workstream = await service.planCreateWorkstream({
      root: repository,
      workstream_id: WORKSTREAM_ID,
      initiative_id: null,
      title: "Govern integration",
      objective: "Serialize canonical writes.",
      owners: ["agent.integrator"],
      dependencies: [],
    });
    if (!workstream.ok) throw new Error(JSON.stringify(workstream.issues));
    expect((await applyFileTransaction(repository, workstream.value.writes)).ok).toBe(true);
    const activated = await service.planTransition({
      root: repository,
      artifact_type: "workstream",
      artifact_id: WORKSTREAM_ID,
      workstream_id: null,
      expected_status: "planned",
      next_status: "active",
      approval_ids: [],
      evidence_ids: [],
    });
    if (!activated.ok) throw new Error(JSON.stringify(activated.issues));
    expect((await applyFileTransaction(repository, activated.value.writes)).ok).toBe(true);

    const packet = makeValidTaskPacket();
    const planned = await service.planCreateTaskPacket({ root: repository, packet });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.metadata).toMatchObject({ artifact_type: "task_packet", to_status: "issued" });
    expect(documentWrite(planned.value).relative_path).toBe(
      taskDocumentPath(packet.workstream_id, packet.task_id),
    );
    expect(await exists(repository, taskDocumentPath(packet.workstream_id, packet.task_id))).toBe(false);

    const drifted = structuredClone(packet);
    drifted.root.profile_lock_hash = "b".repeat(64);
    expect(await service.planCreateTaskPacket({ root: repository, packet: drifted })).toMatchObject({
      ok: false,
      issues: [{ code: "work.task_packet_binding_drift" }],
    });

    expect((await applyFileTransaction(repository, planned.value.writes)).ok).toBe(true);
    const claimed = await service.planTransition({
      root: repository,
      artifact_type: "task_packet",
      artifact_id: packet.task_id,
      workstream_id: packet.workstream_id,
      expected_status: "issued",
      next_status: "claimed",
      approval_ids: [],
      evidence_ids: [],
    });
    if (!claimed.ok) throw new Error(JSON.stringify(claimed.issues));
    expect((await applyFileTransaction(repository, claimed.value.writes)).ok).toBe(true);
    const progressing = await service.planTransition({
      root: repository,
      artifact_type: "task_packet",
      artifact_id: packet.task_id,
      workstream_id: packet.workstream_id,
      expected_status: "claimed",
      next_status: "in_progress",
      approval_ids: [],
      evidence_ids: [],
    });
    if (!progressing.ok) throw new Error(JSON.stringify(progressing.issues));
    expect((await applyFileTransaction(repository, progressing.value.writes)).ok).toBe(true);
    const submission = {
      root: repository,
      artifact_type: "task_packet" as const,
      artifact_id: packet.task_id,
      workstream_id: packet.workstream_id,
      expected_status: "in_progress" as const,
      next_status: "submitted" as const,
      approval_ids: [],
    };
    expect(await service.planTransition({ ...submission, evidence_ids: [] })).toMatchObject({
      ok: false,
      issues: [{ code: "work.evidence_required" }],
    });
    expect(await service.planTransition({ ...submission, evidence_ids: [EVIDENCE_ID] })).toMatchObject({
      ok: true,
    });
    expect(await exists(repository, workstreamDocumentPath(WORKSTREAM_ID))).toBe(true);
  });
});
