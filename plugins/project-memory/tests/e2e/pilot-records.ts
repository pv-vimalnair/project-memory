import {
  success,
  type Clock,
  type RuntimeResult,
} from "../../src/index.js";
import type { CanonicalRecord } from "../../src/governance/contracts/index.js";
import { createCanonicalRecordStore } from "../../src/governance/records/immutable-record-store.js";
import type { IntegrationCoordinator } from "../../src/governance/integration/integration-coordinator.js";

export const PILOT_EVIDENCE_ID = "EVD-01J00000000000000000000001";
export const PILOT_EXTERNAL_APPROVAL_ID = "APR-01J00000000000000000000999";

interface PilotRecordDependencies {
  readonly root: URL;
  readonly root_id: string;
  readonly profile_lock_hash: string;
  readonly clock: Clock;
  readonly coordinator: Pick<IntegrationCoordinator, "finalizeMutation">;
  readonly current_head: () => Promise<string>;
  readonly external_action: boolean;
}

function must<T>(result: RuntimeResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

async function recordEnvelope(
  dependencies: PilotRecordDependencies,
): Promise<Pick<
  CanonicalRecord,
  | "root_id"
  | "component_ids"
  | "initiative_id"
  | "workstream_id"
  | "task_id"
  | "created_at"
  | "original_base_revision"
  | "integration_base_revision"
  | "catalog_versions"
  | "relationships"
>> {
  const head = await dependencies.current_head();
  return {
    root_id: dependencies.root_id,
    component_ids: [],
    initiative_id: null,
    workstream_id: null,
    task_id: null,
    created_at: dependencies.clock.now().toISOString(),
    original_base_revision: head,
    integration_base_revision: head,
    catalog_versions: ["1.0.0"],
    relationships: [],
  };
}

export async function seedPilotAuthorityRecords(
  dependencies: PilotRecordDependencies,
): Promise<void> {
  const records = createCanonicalRecordStore({
    clock: dependencies.clock,
    context: {
      async context() {
        return success({
          target_ref: "refs/heads/main",
          expected_head: await dependencies.current_head(),
          profile_lock_hash: dependencies.profile_lock_hash,
          created_by: "agent.integrator",
        });
      },
    },
  });
  const evidence: CanonicalRecord = {
    ...await recordEnvelope(dependencies),
    id: PILOT_EVIDENCE_ID,
    type: "evidence",
    title: "Sanitized pilot selection evidence",
    status: "accepted",
    actor_id: "agent.integrator",
    authority_class: "integrator",
    payload: {
      evidence_type: "pilot-selection",
      exact_result: "Profile and task selection passed in the sanitized scratch repository.",
      source_refs: ["pilot:selection"],
      hashes: {},
      not_run_reason: null,
    },
  };
  must(await dependencies.coordinator.finalizeMutation(
    must(await records.planCreate(dependencies.root, evidence)),
  ));
  if (!dependencies.external_action) return;
  const approval: CanonicalRecord = {
    ...await recordEnvelope(dependencies),
    id: PILOT_EXTERNAL_APPROVAL_ID,
    type: "approval",
    title: "Pitaji external campaign approval",
    status: "accepted",
    actor_id: "Pitaji",
    authority_class: "pitaji",
    payload: {
      approval_kind: "external_action",
      granted_by: "Pitaji",
      target: "production campaign",
      environment: "production",
      scope: ["campaign.launch"],
      timing: "once",
      expires_at: new Date(dependencies.clock.now().getTime() + 60 * 60_000).toISOString(),
      invalidation_conditions: ["target-change", "scope-change"],
    },
  };
  must(await dependencies.coordinator.finalizeMutation(
    must(await records.planCreate(dependencies.root, approval)),
  ));
}
