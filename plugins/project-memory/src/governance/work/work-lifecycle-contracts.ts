import type {
  CanonicalMutationPlan,
  Clock,
  RuntimeResult,
} from "../../index.js";
import type { TaskPacket } from "../../planning/types.js";
import type { AppendOnlyEventStore } from "../events/append-only-event-store.js";

export const ALLOWED_WORK_TRANSITIONS = Object.freeze({
  initiative: Object.freeze({
    proposed: Object.freeze(["accepted", "cancelled"]),
    accepted: Object.freeze(["active", "cancelled"]),
    active: Object.freeze(["paused", "completed", "cancelled"]),
    paused: Object.freeze(["active", "cancelled"]),
    completed: Object.freeze([]),
    cancelled: Object.freeze([]),
  }),
  workstream: Object.freeze({
    planned: Object.freeze(["active", "cancelled"]),
    active: Object.freeze(["blocked", "completed", "cancelled"]),
    blocked: Object.freeze(["active", "cancelled"]),
    completed: Object.freeze([]),
    cancelled: Object.freeze([]),
  }),
  task_packet: Object.freeze({
    issued: Object.freeze(["claimed", "cancelled"]),
    claimed: Object.freeze(["in_progress", "returned", "cancelled"]),
    in_progress: Object.freeze(["submitted", "returned"]),
    submitted: Object.freeze(["validated", "returned"]),
    validated: Object.freeze(["integrated_verified", "returned"]),
    returned: Object.freeze(["claimed", "cancelled"]),
    integrated_verified: Object.freeze([]),
    cancelled: Object.freeze([]),
  }),
} as const);

export type WorkArtifactType = keyof typeof ALLOWED_WORK_TRANSITIONS;
export type InitiativeStatus = keyof typeof ALLOWED_WORK_TRANSITIONS.initiative;
export type WorkstreamStatus = keyof typeof ALLOWED_WORK_TRANSITIONS.workstream;
export type TaskPacketStatus = keyof typeof ALLOWED_WORK_TRANSITIONS.task_packet;
export type WorkStatus = InitiativeStatus | WorkstreamStatus | TaskPacketStatus;
export type WorkAuthorityClass = "worker" | "validator" | "integrator" | "pitaji";

export function isWorkTransitionAllowed(
  artifactType: WorkArtifactType,
  fromStatus: WorkStatus,
  toStatus: WorkStatus,
): boolean {
  const transitions = ALLOWED_WORK_TRANSITIONS[artifactType] as Readonly<
    Record<string, readonly string[]>
  >;
  return (transitions[fromStatus] ?? []).includes(toStatus);
}

export interface WorkLifecyclePlanningContext {
  readonly root_id: string;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly profile_lock_hash: string;
  readonly actor_id: string;
  readonly authority_class: WorkAuthorityClass;
  readonly approval_ids: readonly string[];
}

export interface WorkLifecyclePlanningContextProvider {
  context(root: URL): Promise<RuntimeResult<WorkLifecyclePlanningContext>>;
}

export interface CreateInitiativeInput {
  readonly created_at?: string;
  readonly root: URL;
  readonly initiative_id: string;
  readonly title: string;
  readonly objective: string;
  readonly owners: readonly string[];
  readonly acceptance_criteria: readonly string[];
}

export interface CreateWorkstreamInput {
  readonly created_at?: string;
  readonly root: URL;
  readonly workstream_id: string;
  readonly initiative_id: string | null;
  readonly title: string;
  readonly objective: string;
  readonly owners: readonly string[];
  readonly dependencies: readonly string[];
}

export interface CreateTaskPacketInput {
  readonly created_at?: string;
  readonly root: URL;
  readonly packet: TaskPacket;
}

export interface WorkTransitionInput {
  readonly created_at?: string;
  readonly root: URL;
  readonly artifact_type: WorkArtifactType;
  readonly artifact_id: string;
  readonly workstream_id: string | null;
  readonly expected_status: WorkStatus;
  readonly next_status: WorkStatus;
  readonly approval_ids: readonly string[];
  readonly evidence_ids: readonly string[];
}

export interface WorkLifecycleMetadata {
  readonly governance_kind: "work_lifecycle";
  readonly operation: "create" | "transition";
  readonly artifact_type: WorkArtifactType;
  readonly artifact_id: string;
  readonly document_path: string;
  readonly from_status: WorkStatus | null;
  readonly to_status: WorkStatus;
  readonly document_revision: number;
  readonly event_hash: string;
  readonly authority_class: WorkAuthorityClass;
}

export type WorkLifecyclePlan = CanonicalMutationPlan<WorkLifecycleMetadata>;

export interface WorkLifecycleService {
  planCreateInitiative(input: CreateInitiativeInput): Promise<RuntimeResult<WorkLifecyclePlan>>;
  planCreateWorkstream(input: CreateWorkstreamInput): Promise<RuntimeResult<WorkLifecyclePlan>>;
  planCreateTaskPacket(input: CreateTaskPacketInput): Promise<RuntimeResult<WorkLifecyclePlan>>;
  planTransition(input: WorkTransitionInput): Promise<RuntimeResult<WorkLifecyclePlan>>;
}

export interface WorkDocumentReader {
  read(root: URL, relativePath: string): Promise<RuntimeResult<Uint8Array | null>>;
}

export interface WorkLifecycleServiceDependencies {
  readonly clock: Clock;
  readonly context: WorkLifecyclePlanningContextProvider;
  readonly documents?: WorkDocumentReader;
  readonly events?: AppendOnlyEventStore;
}
