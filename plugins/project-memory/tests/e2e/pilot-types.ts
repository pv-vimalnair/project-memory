import type { MutationReceipt } from "../../src/governance/integration/canonical-mutation-finalizer.js";
import type { IntegrationCoordinator } from "../../src/governance/integration/integration-coordinator.js";

export type PilotFixture = "lifeof" | "dino-escape" | "external-campaign";

export interface ProductRootPilotInput {
  readonly fixture: PilotFixture;
  readonly initiative_id: string;
  readonly workstream_id: string;
  readonly task_id: string;
  readonly packet_id: string;
  readonly claim_id: string;
  readonly goal: string;
  readonly scope_glob: string;
  readonly changed_path: string;
  readonly external_action: boolean;
}

export interface PilotProfile {
  readonly product: string;
  readonly root_kind: "product";
  readonly blueprint: string;
  readonly workstreams: readonly string[];
  readonly external_action: "forbidden" | "approval-required";
}

export interface CliBoundaryResult {
  readonly exit_code: number;
  readonly plan_calls: number;
  readonly finalize_calls: number;
  readonly used_cli_lease_argument: boolean;
  readonly subsystem_has_direct_writer: boolean;
}

export interface ImportBoundaryResult extends CliBoundaryResult {
  readonly commit_paths: readonly string[];
  readonly original_archive_path: string;
  readonly report_path: string;
  readonly audit_path: string;
}

export type ExternalActionResult =
  | {
      readonly allowed: false;
      readonly approval_ids: readonly string[];
      readonly executed: false;
    }
  | {
      readonly allowed: true;
      readonly approval_ids: readonly string[];
      readonly executed: false;
      readonly target: string;
      readonly environment: string;
      readonly scope: readonly string[];
      readonly timing: string;
    };

export interface ProductRootPilotResult {
  readonly profile: PilotProfile;
  readonly fixture_paths: readonly string[];
  readonly sensitive_findings: readonly string[];
  readonly bootstrap_calls: number;
  readonly root_document_paths: readonly string[];
  readonly workstream_became_root: boolean;
  readonly selection_disposition: string;
  readonly task_status: string;
  readonly claim_status: string;
  readonly completion_valid: boolean;
  readonly archive_valid: boolean;
  readonly views_valid: boolean;
  readonly history_is_append_only: boolean;
  readonly migration: CliBoundaryResult;
  readonly import_run: ImportBoundaryResult;
  readonly external_action: ExternalActionResult;
  readonly generated_view_paths: readonly string[];
}

export interface PilotCliDependencies {
  readonly root: URL;
  readonly root_id: string;
  readonly target_ref: string;
  readonly profile_lock_hash: string;
  readonly approval_id: string;
  readonly actor_id: string;
  readonly slug: PilotFixture;
  readonly now: Date;
  readonly coordinator: Pick<IntegrationCoordinator, "finalizeMutation">;
  readonly receipts: MutationReceipt[];
  readonly current_head: () => Promise<string>;
}
