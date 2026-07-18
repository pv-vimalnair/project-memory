import type { RuntimeIssue, RuntimeResult } from "../contracts/runtime-result.js";
import type { DoctorReport } from "../cli/commands/doctor.js";
import type { InitPlan } from "../cli/init/build-init-plan.js";
import type { InitialClarification } from "../cli/init/build-initial-source-proposal.js";
import type { ProfileVerificationReport } from "../profile/verify-profile.js";
import type { ViewDriftReport } from "../governance/views/view-drift.js";
import type { LegacyImportProposal } from "../import/contracts.js";

export interface AgentStartInput {
  readonly root: URL;
  readonly brief_path: string | null;
  readonly adapter_id: string;
}

export interface AgentDoctorInput {
  readonly root: URL;
}

export interface AgentInitializationInput {
  readonly root: URL;
  readonly brief_path: string | null;
  readonly adapter_id: string;
}

export interface AgentBootstrapProposal {
  readonly confirmation_required: true;
  readonly plan: InitPlan;
}

export type AgentStartDirective =
  | {
      readonly kind: "bootstrap_review_required";
      readonly proposal: AgentBootstrapProposal;
      readonly clarification: InitialClarification | null;
      readonly legacy_import_proposal?: LegacyImportProposal | null;
      readonly apply_command: readonly string[];
    }
  | {
      readonly kind: "resume";
      readonly root_id: string;
      readonly profile_lock_hash: string;
      readonly reading_order: readonly string[];
      readonly assigned_task_packets: readonly string[];
      readonly warnings: readonly RuntimeIssue[];
    }
  | {
      readonly kind: "blocked";
      readonly issues: readonly RuntimeIssue[];
    };

export interface AgentStartDependencies {
  readonly doctor: (
    input: AgentDoctorInput,
  ) => Promise<RuntimeResult<DoctorReport>>;
  readonly planInitialization: (
    input: AgentInitializationInput,
  ) => Promise<RuntimeResult<InitPlan>>;
  readonly verifyProfile: (
    root: URL,
  ) => Promise<RuntimeResult<ProfileVerificationReport>>;
  readonly verifyViews: (
    root: URL,
  ) => Promise<RuntimeResult<ViewDriftReport>>;
  readonly findAssignedTaskPackets: (
    root: URL,
  ) => Promise<RuntimeResult<readonly string[]>>;
  readonly proposeLegacyImport?: (input: {
    readonly root: URL;
    readonly root_id: string;
  }) => Promise<RuntimeResult<LegacyImportProposal | null>>;
}
