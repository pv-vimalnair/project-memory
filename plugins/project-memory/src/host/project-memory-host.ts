import { AGENT_READING_ORDER_PREFIX } from "../agent/start.js";
import type {
  AgentStartDirective,
  AgentStartInput,
} from "../agent/contracts.js";
import type { InitApplyInput } from "../cli/init/apply-init-plan.js";
import type { InitPlan } from "../cli/init/build-init-plan.js";
import {
  failure,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type { CanonicalRecord } from "../governance/contracts/index.js";
import type { BootstrapFinalization } from "../governance/integration/bootstrap-finalizer.js";
import type { MutationReceipt } from "../governance/integration/canonical-mutation-finalizer.js";
import { bootstrapApprovalBinding } from "../governance/integration/bootstrap-plan.js";
import {
  LegacyImportService,
  type ApplyLegacyImportInput,
  type CompactLegacyImportProposal,
  type LegacyImportServiceDependencies,
  type PlanLegacyImportInput,
} from "./legacy-import-service.js";
import type { RepositoryUpgradePlan } from "../upgrades/contracts.js";
import { REPOSITORY_CONTRACT_VERSION } from "../version.js";
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
  readonly applyUpgrade: (
    root: URL,
    savedPlan: RepositoryUpgradePlan,
  ) => Promise<RuntimeResult<MutationReceipt>>;
  readonly legacyImport?: LegacyImportServiceDependencies;
}

export interface BootstrapApprovalConfirmation {
  readonly confirmed: boolean;
  readonly granted_by: string;
}

export interface ApplyBootstrapProposalInput {
  readonly proposal_handle: string;
  readonly approval: BootstrapApprovalConfirmation;
}

export interface ApplyRepositoryUpgradeProposalInput {
  readonly proposal_handle: string;
  readonly approval: { readonly confirmed: boolean };
}

export interface VerifiedRepositoryUpgrade {
  readonly status: "upgraded_verified";
  readonly receipt: MutationReceipt;
  readonly repository_contract_version: typeof REPOSITORY_CONTRACT_VERSION;
  readonly root_id: string;
  readonly reading_order: readonly string[];
  readonly post_upgrade_state: "resume" | "legacy_import_review_required";
}

export interface CompactRepositoryUpgradeSummary {
  readonly operation: "upgrade";
  readonly repository: string;
  readonly from_version: string;
  readonly to_version: string;
  readonly plan_hash: string;
  readonly expected_head: string;
  readonly changed_paths: readonly string[];
  readonly derived_paths: readonly string[];
  readonly canonical_source_path_count: number;
  readonly canonical_source_set_hash: string;
  readonly profile_lock_hash: string;
  readonly catalog_lock_hash: string;
  readonly authority_impact: "none";
  readonly preserves_existing_canonical_history: true;
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

export interface CompactLegacyReviewSource {
  readonly source_path: string;
  readonly source_sha256: string;
  readonly detected_roles: readonly string[];
  readonly source_git_revision: string | null;
  readonly sensitivity_finding_count: number;
}

export type CompactAgentStartDirective =
  | Exclude<AgentStartDirective,
      { readonly kind:
        "bootstrap_review_required" | "legacy_import_review_required" | "upgrade_review_required"
      }
    >
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
    }
  | {
      readonly kind: "upgrade_review_required";
      readonly proposal_handle: string;
      readonly confirmation_required: true;
      readonly expires_at: string;
      readonly summary: CompactRepositoryUpgradeSummary;
      readonly warnings: readonly RuntimeIssue[];
    }
  | {
      readonly kind: "legacy_import_review_required";
      readonly repository: string;
      readonly review_handle: string;
      readonly confirmation_required: false;
      readonly expires_at: string;
      readonly root_id: string;
      readonly profile_lock_hash: string;
      readonly expected_head: string;
      readonly sources: readonly CompactLegacyReviewSource[];
      readonly warnings: readonly RuntimeIssue[];
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

function compactUpgradeSummary(
  root: URL,
  plan: RepositoryUpgradePlan,
): CompactRepositoryUpgradeSummary {
  return {
    operation: "upgrade",
    repository: root.href,
    from_version: plan.metadata.from_version,
    to_version: plan.metadata.to_version,
    plan_hash: plan.plan_hash,
    expected_head: plan.expected_head,
    changed_paths: [...plan.metadata.changed_paths],
    derived_paths: [...plan.metadata.derived_paths],
    canonical_source_path_count: plan.metadata.canonical_source_path_count,
    canonical_source_set_hash: plan.metadata.canonical_source_set_hash,
    profile_lock_hash: plan.profile_lock_hash,
    catalog_lock_hash: plan.metadata.catalog_lock_hash,
    authority_impact: plan.metadata.authority_impact,
    preserves_existing_canonical_history: true,
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
  readonly #legacyImports: LegacyImportService | null;

  constructor(
    readonly dependencies: ProjectMemoryHostDependencies,
    private readonly proposals: ProposalStore = new FileProposalStore(),
  ) {
    this.#legacyImports = dependencies.legacyImport === undefined
      ? null
      : new LegacyImportService(proposals, dependencies.legacyImport);
  }

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
    if (started.value.kind === "upgrade_review_required") {
      const plan = started.value.proposal.plan;
      const issued = await this.proposals.issue({
        kind: "upgrade",
        root: input.root,
        adapter_id: input.adapter_id,
        plan,
      });
      if (!issued.ok) return issued;
      return success({
        kind: "upgrade_review_required",
        proposal_handle: issued.value.handle,
        confirmation_required: true,
        expires_at: issued.value.expires_at,
        summary: compactUpgradeSummary(input.root, plan),
        warnings: started.value.warnings,
      }, started.warnings);
    }
    if (started.value.kind === "legacy_import_review_required") {
      const issued = await this.proposals.issue({
        kind: "legacy_review",
        root: input.root,
        pending: started.value.pending,
        expected_head: started.value.expected_head,
        profile_lock_hash: started.value.profile_lock_hash,
      });
      if (!issued.ok) return issued;
      return success({
        kind: "legacy_import_review_required",
        repository: input.root.href,
        review_handle: issued.value.handle,
        confirmation_required: false,
        expires_at: issued.value.expires_at,
        root_id: started.value.root_id,
        profile_lock_hash: started.value.profile_lock_hash,
        expected_head: started.value.expected_head,
        sources: started.value.pending.scan.artifacts.map((artifact) => ({
          source_path: artifact.relative_path,
          source_sha256: artifact.sha256,
          detected_roles: [...artifact.detected_roles],
          source_git_revision: artifact.git_revision,
          sensitivity_finding_count: artifact.sensitivity_findings.length,
        })),
        warnings: started.value.warnings,
      }, started.warnings);
    }
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

  planLegacyImport(
    input: PlanLegacyImportInput,
  ): Promise<RuntimeResult<CompactLegacyImportProposal>> {
    return this.#legacyImports === null
      ? Promise.resolve(failure(
          "HOST_LEGACY_IMPORT_UNAVAILABLE",
          "guided legacy import is unavailable in this host",
        ))
      : this.#legacyImports.planLegacyImport(input);
  }

  applyLegacyImport(
    input: ApplyLegacyImportInput,
  ): Promise<RuntimeResult<MutationReceipt>> {
    return this.#legacyImports === null
      ? Promise.resolve(failure(
          "HOST_LEGACY_IMPORT_UNAVAILABLE",
          "guided legacy import is unavailable in this host",
        ))
      : this.#legacyImports.applyLegacyImport(input);
  }

  async applyUpgrade(
    input: ApplyRepositoryUpgradeProposalInput,
  ): Promise<RuntimeResult<VerifiedRepositoryUpgrade>> {
    if (!input.approval.confirmed) {
      return failure(
        "HOST_APPROVAL_REQUIRED",
        "repository upgrade requires explicit confirmation",
        "approval",
      );
    }
    const proposal = await this.proposals.resolve(
      input.proposal_handle,
      "upgrade",
    );
    if (!proposal.ok) return proposal;

    let applied: RuntimeResult<MutationReceipt>;
    try {
      applied = await this.dependencies.applyUpgrade(
        proposal.value.root,
        proposal.value.plan,
      );
    } catch {
      return dependencyFailure("applyUpgrade");
    }
    if (!applied.ok) return applied;
    const consumed = await this.proposals.consume(
      input.proposal_handle,
      "upgrade",
    );
    if (!consumed.ok) return consumed;

    let verified: RuntimeResult<AgentStartDirective>;
    try {
      verified = await this.dependencies.start({
        root: proposal.value.root,
        brief_path: null,
        adapter_id: proposal.value.adapter_id,
      });
    } catch {
      return dependencyFailure("start");
    }
    if (!verified.ok) return verified;
    const directive = verified.value;
    const verifiedResume = directive.kind === "resume" &&
      directive.root_id === proposal.value.plan.root_id &&
      directive.profile_lock_hash === proposal.value.plan.profile_lock_hash &&
      AGENT_READING_ORDER_PREFIX.every(
        (relativePath, index) => directive.reading_order[index] === relativePath,
      );
    const verifiedLegacyReview =
      directive.kind === "legacy_import_review_required" &&
      directive.root_id === proposal.value.plan.root_id &&
      directive.profile_lock_hash === proposal.value.plan.profile_lock_hash;
    if (!verifiedResume && !verifiedLegacyReview) {
      return failure(
        "HOST_UPGRADE_VERIFICATION_FAILED",
        "fresh startup did not verify an initialized upgraded repository",
        proposal.value.root.href,
      );
    }
    const postUpgradeState = directive.kind;
    const readingOrder = directive.kind === "resume"
      ? [...directive.reading_order]
      : [...AGENT_READING_ORDER_PREFIX];
    return success({
      status: "upgraded_verified",
      receipt: applied.value,
      repository_contract_version: REPOSITORY_CONTRACT_VERSION,
      root_id: directive.root_id,
      reading_order: readingOrder,
      post_upgrade_state: postUpgradeState,
    }, [...applied.warnings, ...verified.warnings]);
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
