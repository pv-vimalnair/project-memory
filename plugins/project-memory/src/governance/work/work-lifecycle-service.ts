import {
  canonicalMutationPlanHash,
  failure,
  sha256,
  success,
  validateWithSchema,
  type PlannedWrite,
  type RuntimeResult,
} from "../../index.js";
import type { TaskPacket } from "../../planning/types.js";
import type { GovernanceEvent } from "../contracts/index.js";
import { createAppendOnlyEventStore } from "../events/append-only-event-store.js";
import {
  createDocumentWrite,
  FilesystemWorkDocumentReader,
  initiativeDocumentPath,
  lifecycleDocumentPath,
  parseWorkDocument,
  renderInitiative,
  renderTaskPacket,
  renderWorkstream,
  taskDocumentPath,
  transitionWorkDocument,
  workstreamDocumentPath,
  type ParsedWorkDocument,
} from "./work-document.js";
import {
  isWorkTransitionAllowed,
  type CreateInitiativeInput,
  type CreateTaskPacketInput,
  type CreateWorkstreamInput,
  type WorkArtifactType,
  type WorkAuthorityClass,
  type WorkLifecycleMetadata,
  type WorkLifecyclePlan,
  type WorkLifecyclePlanningContext,
  type WorkLifecycleService,
  type WorkLifecycleServiceDependencies,
  type WorkStatus,
  type WorkTransitionInput,
} from "./work-lifecycle-contracts.js";

export * from "./work-lifecycle-contracts.js";
export {
  initiativeDocumentPath,
  taskDocumentPath,
  workstreamDocumentPath,
} from "./work-document.js";

const PLAN_TTL_MS = 5 * 60 * 1000;
const REVISION = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const INSTANCE = /^(ROOT|INIT|WS|TASK|APR|EVD)-[0-9A-HJKMNP-TV-Z]{26}$/;

interface PlannedEvent {
  readonly write: PlannedWrite;
  readonly event: GovernanceEvent;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function validStrings(values: readonly string[]): boolean {
  return values.length > 0 && values.every((value) => value.trim().length > 0) && new Set(values).size === values.length;
}

function validContext(value: WorkLifecyclePlanningContext): RuntimeResult<true> {
  if (
    !INSTANCE.test(value.root_id) ||
    !value.root_id.startsWith("ROOT-") ||
    !REVISION.test(value.expected_head) ||
    !SHA256.test(value.profile_lock_hash) ||
    !/^refs\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value.target_ref) ||
    value.target_ref.includes("..") ||
    value.actor_id.trim().length === 0 ||
    !validStrings(value.approval_ids) ||
    value.approval_ids.some((id) => !id.startsWith("APR-") || !INSTANCE.test(id))
  ) {
    return failure("work.context_invalid", "work planning context is incomplete or malformed", value.root_id);
  }
  return success(true);
}

function validId(id: string, prefix: "INIT" | "WS" | "TASK"): boolean {
  return id.startsWith(`${prefix}-`) && INSTANCE.test(id);
}

function authorityAllowed(
  artifactType: WorkArtifactType,
  fromStatus: WorkStatus | null,
  toStatus: WorkStatus,
  authority: WorkAuthorityClass,
): boolean {
  if (artifactType === "initiative") {
    if (fromStatus === null && toStatus === "proposed") {
      return authority === "integrator" || authority === "pitaji";
    }
    if (toStatus === "accepted" || toStatus === "cancelled") {
      return authority === "pitaji";
    }
    return authority === "integrator" || authority === "pitaji";
  }
  if (artifactType === "workstream") {
    if (toStatus === "cancelled") return authority === "pitaji";
    return authority === "integrator" || authority === "pitaji";
  }
  if (fromStatus === null) return authority === "integrator" || authority === "pitaji";
  if (["claimed", "in_progress", "submitted"].includes(toStatus)) {
    return authority === "worker" || authority === "integrator" || authority === "pitaji";
  }
  if (toStatus === "validated") {
    return authority === "validator" || authority === "integrator" || authority === "pitaji";
  }
  return authority === "integrator" || authority === "pitaji";
}

function requiresEvidence(
  artifactType: WorkArtifactType,
  nextStatus: WorkStatus,
): boolean {
  return (
    nextStatus === "completed" ||
    (artifactType === "task_packet" && ["submitted", "validated", "integrated_verified"].includes(nextStatus))
  );
}

function eventFromWrite(write: PlannedWrite): RuntimeResult<GovernanceEvent> {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(write.bytes)) as unknown;
    return validateWithSchema<GovernanceEvent>("project-memory/v1/governance-event", value);
  } catch (error: unknown) {
    return failure("work.event_invalid", error instanceof Error ? error.message : String(error), write.relative_path);
  }
}

function buildPlan(
  context: WorkLifecyclePlanningContext,
  createdAt: string,
  metadata: Omit<WorkLifecycleMetadata, "event_hash" | "authority_class">,
  documentWrite: PlannedWrite,
  event: PlannedEvent,
  approvalIds: readonly string[],
  evidenceIds: readonly string[],
): WorkLifecyclePlan {
  const completeMetadata: WorkLifecycleMetadata = {
    ...metadata,
    event_hash: event.event.event_hash,
    authority_class: context.authority_class,
  };
  const writes = [documentWrite, event.write].sort((left, right) =>
    compareUtf8(left.relative_path, right.relative_path),
  );
  const withoutHash: Omit<WorkLifecyclePlan, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: `work:${metadata.operation}:${metadata.artifact_id}:${event.event.event_hash.slice(0, 12)}`,
    mutation_kind: "work_lifecycle",
    root_id: context.root_id,
    target_ref: context.target_ref,
    expected_head: context.expected_head,
    profile_lock_hash: context.profile_lock_hash,
    writes,
    record_ids: [],
    event_ids: [event.event.event_hash],
    approval_ids: unique(approvalIds),
    evidence_ids: unique(evidenceIds),
    created_by: context.actor_id,
    created_at: createdAt,
    expires_at: new Date(Date.parse(createdAt) + PLAN_TTL_MS).toISOString(),
    metadata: completeMetadata,
  };
  return { ...withoutHash, plan_hash: canonicalMutationPlanHash(withoutHash) };
}

export function createWorkLifecycleService(
  dependencies: WorkLifecycleServiceDependencies,
): WorkLifecycleService {
  const documents = dependencies.documents ?? new FilesystemWorkDocumentReader();
  const events = dependencies.events ?? createAppendOnlyEventStore();

  async function context(root: URL): Promise<RuntimeResult<WorkLifecyclePlanningContext>> {
    const result = await dependencies.context.context(root);
    if (!result.ok) return result;
    const valid = validContext(result.value);
    return valid.ok ? result : valid;
  }

  function planningTime(requested: string | undefined): RuntimeResult<Date> {
    const observed = dependencies.clock.now();
    const value = requested === undefined ? observed : new Date(requested);
    if (
      !Number.isFinite(observed.getTime()) ||
      !Number.isFinite(value.getTime()) ||
      (requested !== undefined && value.toISOString() !== requested)
    ) {
      return failure(
        "work.clock_invalid",
        "work planning time must be an exact UTC timestamp",
        requested ?? "clock",
      );
    }
    if (
      requested !== undefined &&
      (value.getTime() > observed.getTime() + 30_000 ||
        value.getTime() + PLAN_TTL_MS <= observed.getTime())
    ) {
      return failure(
        "work.clock_out_of_window",
        "work planning time must remain inside the short replay window",
        requested,
      );
    }
    return success(value);
  }
  async function requireAbsent(root: URL, relativePath: string): Promise<RuntimeResult<true>> {
    const current = await documents.read(root, relativePath);
    if (!current.ok) return current;
    return current.value === null
      ? success(true)
      : failure("work.document_exists", "work documents are create-only at initial planning", relativePath);
  }

  async function plannedEvent(
    root: URL,
    aggregateId: string,
    eventType: string,
    current: WorkLifecyclePlanningContext,
    occurredAt: string,
    evidenceIds: readonly string[],
    payload: Readonly<Record<string, unknown>>,
  ): Promise<RuntimeResult<PlannedEvent>> {
    const write = await events.planAppend(root, {
      aggregate_id: aggregateId,
      event_type: eventType,
      occurred_at: occurredAt,
      actor_id: current.actor_id,
      authority_class: current.authority_class,
      evidence_ids: unique(evidenceIds),
      payload,
    });
    if (!write.ok) return write;
    const parsed = eventFromWrite(write.value);
    return parsed.ok ? success({ write: write.value, event: parsed.value }) : parsed;
  }

  function validCreateFields(
    id: string,
    prefix: "INIT" | "WS",
    title: string,
    objective: string,
    owners: readonly string[],
    details: readonly string[],
  ): RuntimeResult<true> {
    return validId(id, prefix) && title.trim().length > 0 && objective.trim().length > 0 && validStrings(owners) && (details.length === 0 || validStrings(details))
      ? success(true)
      : failure("work.input_invalid", "work creation input is incomplete or malformed", id);
  }

  async function createPlan(
    current: WorkLifecyclePlanningContext,
    root: URL,
    artifactType: WorkArtifactType,
    artifactId: string,
    relativePath: string,
    toStatus: WorkStatus,
    bytes: Uint8Array,
    requestedAt: string | undefined,
    evidenceIds: readonly string[] = [],
  ): Promise<RuntimeResult<WorkLifecyclePlan>> {
    if (!authorityAllowed(artifactType, null, toStatus, current.authority_class)) {
      return failure("work.authority_denied", "actor authority cannot create this work artifact", artifactId);
    }
    const absent = await requireAbsent(root, relativePath);
    if (!absent.ok) return absent;
    const plannedAt = planningTime(requestedAt);
    if (!plannedAt.ok) return plannedAt;
    const now = plannedAt.value;
    const event = await plannedEvent(
      root,
      artifactId,
      `${artifactType}_created`,
      current,
      now.toISOString(),
      evidenceIds,
      { status: toStatus, document_path: relativePath, document_revision: 1 },
    );
    return event.ok
      ? success(buildPlan(
          current,
          now.toISOString(),
          { governance_kind: "work_lifecycle", operation: "create", artifact_type: artifactType, artifact_id: artifactId, document_path: relativePath, from_status: null, to_status: toStatus, document_revision: 1 },
          createDocumentWrite(relativePath, bytes),
          event.value,
          current.approval_ids,
          evidenceIds,
        ))
      : event;
  }

  async function planCreateInitiative(input: CreateInitiativeInput): Promise<RuntimeResult<WorkLifecyclePlan>> {
    const valid = validCreateFields(input.initiative_id, "INIT", input.title, input.objective, input.owners, input.acceptance_criteria);
    if (!valid.ok) return valid;
    const current = await context(input.root);
    if (!current.ok) return current;
    let bytes: Uint8Array;
    try {
      bytes = renderInitiative(input, current.value.root_id, current.value.approval_ids);
    } catch (error: unknown) {
      return failure("work.document_invalid", error instanceof Error ? error.message : String(error), input.initiative_id);
    }
    return createPlan(current.value, input.root, "initiative", input.initiative_id, initiativeDocumentPath(input.initiative_id), "proposed", bytes, input.created_at);
  }

  async function planCreateWorkstream(input: CreateWorkstreamInput): Promise<RuntimeResult<WorkLifecyclePlan>> {
    const valid = validCreateFields(input.workstream_id, "WS", input.title, input.objective, input.owners, input.dependencies);
    if (!valid.ok || (input.initiative_id !== null && !validId(input.initiative_id, "INIT"))) {
      return valid.ok ? failure("work.input_invalid", "workstream initiative ID is malformed", input.workstream_id) : valid;
    }
    const current = await context(input.root);
    if (!current.ok) return current;
    if (input.initiative_id !== null) {
      const parentBytes = await documents.read(input.root, initiativeDocumentPath(input.initiative_id));
      if (!parentBytes.ok) return parentBytes;
      if (parentBytes.value === null) return failure("work.initiative_missing", "workstream initiative does not exist", input.initiative_id);
      const parent = parseWorkDocument(parentBytes.value, "initiative", input.initiative_id, current.value.root_id);
      if (!parent.ok) return parent;
      if (!["accepted", "active", "paused"].includes(parent.value.status)) {
        return failure("work.initiative_not_ready", "initiative must be accepted before workstream creation", input.initiative_id);
      }
    }
    let bytes: Uint8Array;
    try {
      bytes = renderWorkstream(input, current.value.root_id, current.value.approval_ids);
    } catch (error: unknown) {
      return failure("work.document_invalid", error instanceof Error ? error.message : String(error), input.workstream_id);
    }
    return createPlan(current.value, input.root, "workstream", input.workstream_id, workstreamDocumentPath(input.workstream_id), "planned", bytes, input.created_at);
  }

  async function activeWorkstream(
    root: URL,
    workstreamId: string,
    rootId: string,
  ): Promise<RuntimeResult<ParsedWorkDocument>> {
    const bytes = await documents.read(root, workstreamDocumentPath(workstreamId));
    if (!bytes.ok) return bytes;
    if (bytes.value === null) return failure("work.workstream_missing", "task packet workstream does not exist", workstreamId);
    const parsed = parseWorkDocument(bytes.value, "workstream", workstreamId, rootId);
    if (!parsed.ok) return parsed;
    return parsed.value.status === "active"
      ? parsed
      : failure("work.workstream_not_active", "task packets require an active workstream", workstreamId);
  }

  async function planCreateTaskPacket(input: CreateTaskPacketInput): Promise<RuntimeResult<WorkLifecyclePlan>> {
    const packet = validateWithSchema<TaskPacket>("project-memory/v1/task-packet", input.packet);
    if (!packet.ok) return failure("work.task_packet_invalid", "task packet does not satisfy the planning-owned schema", input.packet.task_id);
    const current = await context(input.root);
    if (!current.ok) return current;
    if (
      packet.value.root.id !== current.value.root_id ||
      packet.value.root.profile_lock_hash !== current.value.profile_lock_hash ||
      packet.value.resolved_inputs.original_base_revision !== current.value.expected_head ||
      packet.value.assignment.issued_by !== current.value.actor_id
    ) {
      return failure("work.task_packet_binding_drift", "task packet root, profile, base, or issuer changed", packet.value.task_id);
    }
    const parent = await activeWorkstream(input.root, packet.value.workstream_id, current.value.root_id);
    if (!parent.ok) return parent;
    const approvals = unique([...current.value.approval_ids, ...packet.value.approvals.map((approval) => approval.id)]);
    let bytes: Uint8Array;
    try {
      bytes = renderTaskPacket(packet.value, current.value.root_id, approvals);
    } catch (error: unknown) {
      return failure("work.document_invalid", error instanceof Error ? error.message : String(error), packet.value.task_id);
    }
    const result = await createPlan(
      current.value,
      input.root,
      "task_packet",
      packet.value.task_id,
      taskDocumentPath(packet.value.workstream_id, packet.value.task_id),
      "issued",
      bytes,
      input.created_at,
      packet.value.selector.evidence_ids,
    );
    if (!result.ok) return result;
    const metadata = result.value.metadata;
    const body = { ...result.value, approval_ids: approvals, metadata };
    const { plan_hash: ignored, ...withoutHash } = body;
    void ignored;
    return success({ ...withoutHash, plan_hash: canonicalMutationPlanHash(withoutHash) });
  }

  async function planTransition(input: WorkTransitionInput): Promise<RuntimeResult<WorkLifecyclePlan>> {
    const current = await context(input.root);
    if (!current.ok) return current;
    if (input.approval_ids.some((id) => !current.value.approval_ids.includes(id)) || input.evidence_ids.some((id) => !id.startsWith("EVD-") || !INSTANCE.test(id))) {
      return failure("work.references_invalid", "transition approvals or evidence are not canonical", input.artifact_id);
    }
    const relativePath = lifecycleDocumentPath(input.artifact_type, input.artifact_id, input.workstream_id);
    if (!relativePath.ok) return relativePath;
    const bytes = await documents.read(input.root, relativePath.value);
    if (!bytes.ok) return bytes;
    if (bytes.value === null) return failure("work.document_missing", "work document does not exist", relativePath.value);
    const parsed = parseWorkDocument(bytes.value, input.artifact_type, input.artifact_id, current.value.root_id);
    if (!parsed.ok) return parsed;
    if (parsed.value.status !== input.expected_status) {
      return failure("work.status_drift", "work status differs from the transition precondition", input.artifact_id);
    }
    if (!isWorkTransitionAllowed(input.artifact_type, input.expected_status, input.next_status)) {
      return failure("work.transition_illegal", "requested work lifecycle transition is not allowed", input.artifact_id);
    }
    if (!authorityAllowed(input.artifact_type, input.expected_status, input.next_status, current.value.authority_class)) {
      return failure("work.authority_denied", "actor authority cannot perform this transition", input.artifact_id);
    }
    if (requiresEvidence(input.artifact_type, input.next_status) && input.evidence_ids.length === 0) {
      return failure("work.evidence_required", "transition requires prerequisite evidence", input.artifact_id);
    }
    const plannedAt = planningTime(input.created_at);
    if (!plannedAt.ok) return plannedAt;
    const now = plannedAt.value;
    const nextBytes = transitionWorkDocument(parsed.value, input.next_status, input.approval_ids);
    const event = await plannedEvent(
      input.root,
      input.artifact_id,
      `${input.artifact_type}_${input.next_status}`,
      current.value,
      now.toISOString(),
      input.evidence_ids,
      { from_status: input.expected_status, status: input.next_status, document_path: relativePath.value, document_revision: parsed.value.document.envelope.revision + 1 },
    );
    if (!event.ok) return event;
    const replacement: PlannedWrite = {
      relative_path: relativePath.value,
      bytes: nextBytes,
      expected_existing_sha256: sha256(bytes.value),
      mode: "replace",
    };
    return success(buildPlan(
      current.value,
      now.toISOString(),
      { governance_kind: "work_lifecycle", operation: "transition", artifact_type: input.artifact_type, artifact_id: input.artifact_id, document_path: relativePath.value, from_status: input.expected_status, to_status: input.next_status, document_revision: parsed.value.document.envelope.revision + 1 },
      replacement,
      event.value,
      unique([...parsed.value.document.envelope.approval_refs, ...input.approval_ids]),
      input.evidence_ids,
    ));
  }

  return { planCreateInitiative, planCreateWorkstream, planCreateTaskPacket, planTransition };
}
