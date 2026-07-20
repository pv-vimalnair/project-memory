import type {
  AgentStartDirective,
  AgentStartInput,
} from "../agent/contracts.js";
import type { InitApplyInput } from "../cli/init/apply-init-plan.js";
import type { InitPlan } from "../cli/init/build-init-plan.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type { CanonicalRecord } from "../governance/contracts/index.js";
import type { BootstrapFinalization } from "../governance/integration/bootstrap-finalizer.js";
import { bootstrapApprovalBinding } from "../governance/integration/bootstrap-plan.js";
import {
  FileProposalStore,
  type ProposalStore,
} from "./proposal-store.js";

export interface ProjectMemoryHostDependencies {
  readonly start: (
    input: AgentStartInput,
  ) => Promise<RuntimeResult<AgentStartDirective>>;
  readonly applyBootstrap: (
    input: InitApplyInput,
  ) => Promise<RuntimeResult<BootstrapFinalization>>;
}

export interface BootstrapApprovalConfirmation {
  readonly confirmed: boolean;
  readonly granted_by: string;
}

export interface ApplyBootstrapProposalInput {
  readonly proposal_handle: string;
  readonly approval: BootstrapApprovalConfirmation;
}

export interface CompactBootstrapSummary {
  readonly operation: "bootstrap";
  readonly repository: string;
  readonly root_id: string;
  readonly root_kind: string;
  readonly lifecycle: string;
  readonly profile_lock_hash: string;
  readonly plan_hash: string;
  readonly expected_head: string;
  readonly selection_disposition: string;
  readonly selected_blueprint: string | null;
  readonly selected_overlays: readonly string[];
  readonly selected_components: readonly string[];
  readonly selected_domains: readonly string[];
  readonly selected_adapters: {
    readonly agent: readonly string[];
    readonly runtime: readonly string[];
    readonly workflow: readonly string[];
  };
  readonly source_mapping: Readonly<Record<string, {
    readonly status: "evidenced" | "unresolved";
    readonly source_ref: string | null;
    readonly pointer: string | null;
  }>>;
  readonly assumptions: readonly string[];
  readonly risks: readonly string[];
}

export type CompactAgentStartDirective =
  | Exclude<AgentStartDirective, { readonly kind: "bootstrap_review_required" }>
  | {
      readonly kind: "bootstrap_review_required";
      readonly proposal_handle: string;
      readonly confirmation_required: true;
      readonly expires_at: string;
      readonly summary: CompactBootstrapSummary;
      readonly clarification: Extract<
        AgentStartDirective,
        { readonly kind: "bootstrap_review_required" }
      >["clarification"];
      readonly legacy_import_proposal: Extract<
        AgentStartDirective,
        { readonly kind: "bootstrap_review_required" }
      >["legacy_import_proposal"];
    };

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function definitionIds(
  values: readonly { readonly definition: { readonly id: string } }[],
): readonly string[] {
  return values.map((item) => item.definition.id).toSorted(compareUtf8);
}

function adapterIds(
  values: readonly { readonly id: string }[],
): readonly string[] {
  return values.map((item) => item.id).toSorted(compareUtf8);
}

function sourceMapping(
  plan: InitPlan,
): CompactBootstrapSummary["source_mapping"] {
  return Object.fromEntries(
    Object.entries(plan.source_proposal.facts)
      .toSorted(([left], [right]) => compareUtf8(left, right))
      .map(([name, fact]) => [
        name,
        fact.status === "evidenced"
          ? {
              status: fact.status,
              source_ref: fact.evidence.source_ref,
              pointer: fact.evidence.pointer,
            }
          : { status: fact.status, source_ref: null, pointer: null },
      ]),
  );
}

function compactSummary(root: URL, plan: InitPlan): CompactBootstrapSummary {
  const selection = plan.proposed_project_selection;
  return {
    operation: "bootstrap",
    repository: root.href,
    root_id: plan.target_root_id,
    root_kind: selection.root.kind,
    lifecycle: selection.root.lifecycle,
    profile_lock_hash: plan.profile_compilation.profile_lock_hash,
    plan_hash: plan.plan_hash,
    expected_head: plan.expected_head,
    selection_disposition: plan.selection.disposition,
    selected_blueprint: plan.selection.winner?.definition_id ?? null,
    selected_overlays: [...selection.overlays].toSorted(compareUtf8),
    selected_components: definitionIds(selection.components),
    selected_domains: definitionIds(selection.domains),
    selected_adapters: {
      agent: adapterIds(selection.adapters.agent),
      runtime: adapterIds(selection.adapters.runtime),
      workflow: adapterIds(selection.adapters.workflow),
    },
    source_mapping: sourceMapping(plan),
    assumptions: [],
    risks: [...plan.unresolved_required_facts].toSorted(compareUtf8),
  };
}

function approvalRecord(
  root: URL,
  plan: InitPlan,
): CanonicalRecord {
  const compilation = plan.profile_compilation;
  const binding = bootstrapApprovalBinding({
    root,
    target_ref: plan.target_ref,
    root_id: plan.target_root_id,
    profile_lock_hash: compilation.profile_lock_hash,
    source_proposal_hash: plan.source_proposal_hash,
    compilation_plan_hash: compilation.plan_hash,
    created_at: compilation.created_at,
    expires_at: compilation.expires_at,
  });
  return {
    id: plan.review_packet.approval_id,
    type: "approval",
    title: "Approve exact Project Memory bootstrap",
    status: "accepted",
    root_id: plan.target_root_id,
    component_ids: [],
    initiative_id: null,
    workstream_id: null,
    task_id: null,
    actor_id: "Pitaji",
    authority_class: "pitaji",
    created_at: compilation.created_at,
    original_base_revision: plan.expected_head,
    integration_base_revision: plan.expected_head,
    catalog_versions: [plan.proposed_project_selection.catalog.release],
    relationships: [],
    payload: {
      approval_kind: "directional",
      granted_by: "Pitaji",
      ...binding,
      expires_at: compilation.expires_at,
      invalidation_conditions: ["Any bound bootstrap input changes."],
    },
  };
}

function dependencyFailure(name: string): RuntimeResult<never> {
  return failure(
    "HOST_DEPENDENCY_REJECTED",
    `${name} dependency rejected`,
    name,
  );
}

export class ProjectMemoryHost {
  constructor(
    readonly dependencies: ProjectMemoryHostDependencies,
    private readonly proposals: ProposalStore = new FileProposalStore(),
  ) {}

  async start(
    input: AgentStartInput,
  ): Promise<RuntimeResult<CompactAgentStartDirective>> {
    let started: RuntimeResult<AgentStartDirective>;
    try {
      started = await this.dependencies.start(input);
    } catch {
      return dependencyFailure("start");
    }
    if (!started.ok) return started;
    if (started.value.kind !== "bootstrap_review_required") {
      return success(started.value, started.warnings);
    }
    const plan = started.value.proposal.plan;
    const issued = await this.proposals.issue({
      kind: "bootstrap",
      root: input.root,
      plan,
    });
    if (!issued.ok) return issued;
    return success({
      kind: "bootstrap_review_required",
      proposal_handle: issued.value.handle,
      confirmation_required: true,
      expires_at: issued.value.expires_at,
      summary: compactSummary(input.root, plan),
      clarification: started.value.clarification,
      legacy_import_proposal: started.value.legacy_import_proposal ?? null,
    }, started.warnings);
  }

  async applyBootstrap(
    input: ApplyBootstrapProposalInput,
  ): Promise<RuntimeResult<BootstrapFinalization>> {
    if (!input.approval.confirmed || input.approval.granted_by !== "Pitaji") {
      return failure(
        "HOST_APPROVAL_REQUIRED",
        "bootstrap requires explicit confirmation granted by Pitaji",
        "approval",
      );
    }
    const proposal = await this.proposals.resolve(
      input.proposal_handle,
      "bootstrap",
    );
    if (!proposal.ok) return proposal;
    let applied: RuntimeResult<BootstrapFinalization>;
    try {
      applied = await this.dependencies.applyBootstrap({
        saved_plan: proposal.value.plan,
        approval_record: approvalRecord(proposal.value.root, proposal.value.plan),
      });
    } catch {
      return dependencyFailure("applyBootstrap");
    }
    if (!applied.ok) return applied;
    await this.proposals.consume(input.proposal_handle, "bootstrap");
    return applied;
  }
}
