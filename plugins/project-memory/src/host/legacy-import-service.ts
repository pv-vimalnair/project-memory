import { canonicalMutationPlanHash } from "../contracts/canonical-mutation-plan.js";
import { failure, success, type RuntimeResult } from "../contracts/runtime-result.js";
import type { PlanAuthorityValidator, MutationReceipt } from "../governance/integration/canonical-mutation-finalizer.js";
import type {
  GuidedLegacyImportInput,
  LegacyFactCategory,
  LegacyImportMapping,
  LegacySourceReviewDraft,
  PendingLegacyReview,
  ReviewedImportPlan,
} from "../import/contracts.js";
import type { ProposalStore } from "./proposal-store.js";

const REVIEW_TTL_MILLISECONDS = 60 * 60 * 1000;
const MAX_COMPACT_PROPOSAL_BYTES = 60_000;

export interface LegacyImportContext {
  readonly root_id: string;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly profile_lock_hash: string;
  readonly catalog_version: string;
}

export interface LegacyImportServiceDependencies {
  readonly now: () => Date;
  readonly context: (root: URL) => Promise<RuntimeResult<LegacyImportContext>>;
  readonly plan: (
    root: URL,
    input: GuidedLegacyImportInput,
  ) => Promise<RuntimeResult<ReviewedImportPlan>>;
  readonly finalize: (
    root: URL,
    plan: ReviewedImportPlan,
    authority: PlanAuthorityValidator,
  ) => Promise<RuntimeResult<MutationReceipt>>;
}

export interface PlanLegacyImportInput {
  readonly review_handle: string;
  readonly created_by: string;
  readonly sources: readonly LegacySourceReviewDraft[];
}

export interface ApplyLegacyImportInput {
  readonly proposal_handle: string;
  readonly approval: {
    readonly confirmed: boolean;
    readonly granted_by: string;
  };
}

export type LegacyImportGroupKey =
  | "completed_work"
  | "current_facts"
  | "constraints"
  | "next_actions"
  | "ideas"
  | "risks_findings"
  | "removed_rejected_superseded"
  | "archive_unresolved";

export interface CompactLegacyImportItem {
  readonly source_path: string;
  readonly source_sha256: string;
  readonly classification: LegacyImportMapping["classification"];
  readonly disposition: LegacySourceReviewDraft["disposition"];
  readonly category: LegacyFactCategory | null;
  readonly title: string;
  readonly statement: string | null;
  readonly destination_record_type: "change" | "decision" | "idea" | "risk" | "finding" | "lesson" | null;
  readonly destination_status: "closed" | "accepted" | "proposed" | "withdrawn" | "rejected" | "superseded" | null;
  readonly rationale: string;
}

export interface CompactLegacyImportGroup {
  readonly key: LegacyImportGroupKey;
  readonly title: string;
  readonly items: readonly CompactLegacyImportItem[];
}

export interface CompactLegacyImportProposal {
  readonly operation: "legacy_import";
  readonly repository: string;
  readonly root_id: string;
  readonly confirmation_required: true;
  readonly proposal_handle: string;
  readonly plan_hash: string;
  readonly expected_head: string;
  readonly expires_at: string;
  readonly source_count: number;
  readonly fact_count: number;
  readonly sensitivity_finding_count: number;
  readonly assumptions: readonly string[];
  readonly conflicts: readonly string[];
  readonly groups: readonly CompactLegacyImportGroup[];
}

const GROUPS: readonly {
  readonly key: LegacyImportGroupKey;
  readonly title: string;
}[] = [
  { key: "completed_work", title: "Completed work" },
  { key: "current_facts", title: "Current accepted facts and decisions" },
  { key: "constraints", title: "Constraints and do-not-do rules" },
  { key: "next_actions", title: "Next actions" },
  { key: "ideas", title: "Ideas under consideration" },
  { key: "risks_findings", title: "Risks and findings" },
  { key: "removed_rejected_superseded", title: "Removed, rejected, or superseded items" },
  { key: "archive_unresolved", title: "Archive-only or unresolved material" },
];

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sameRoot(left: URL, right: URL): boolean {
  return left.protocol === "file:" && left.href === right.href;
}

function dependencyFailure(name: string): RuntimeResult<never> {
  return failure(
    "HOST_DEPENDENCY_REJECTED",
    `${name} dependency rejected`,
    name,
  );
}

async function callDependency<T>(
  name: string,
  operation: () => Promise<RuntimeResult<T>>,
): Promise<RuntimeResult<T>> {
  try {
    return await operation();
  } catch {
    return dependencyFailure(name);
  }
}

function validateCoverage(
  pending: PendingLegacyReview,
  sources: readonly LegacySourceReviewDraft[],
): RuntimeResult<true> {
  if (sources.length !== pending.scan.artifacts.length) {
    return failure(
      "HOST_LEGACY_SOURCE_COVERAGE_MISMATCH",
      "guided review must cover every pending legacy source exactly once",
      "sources",
    );
  }
  const drafts = new Map<string, LegacySourceReviewDraft>();
  for (const source of sources) {
    if (drafts.has(source.source_path)) {
      return failure(
        "HOST_LEGACY_SOURCE_COVERAGE_MISMATCH",
        "guided review contains a duplicate legacy source",
        source.source_path,
      );
    }
    drafts.set(source.source_path, source);
  }
  for (const artifact of pending.scan.artifacts) {
    const source = drafts.get(artifact.relative_path);
    if (
      source === undefined ||
      source.source_sha256 !== artifact.sha256 ||
      (source.source_git_revision ?? null) !== artifact.git_revision
    ) {
      return failure(
        "HOST_LEGACY_SOURCE_COVERAGE_MISMATCH",
        "guided review source identity does not match the pending scan",
        artifact.relative_path,
      );
    }
  }
  return success(true);
}

function validateContext(
  pending: PendingLegacyReview,
  expectedHead: string,
  expectedProfile: string,
  context: LegacyImportContext,
): RuntimeResult<true> {
  if (context.root_id !== pending.root_id) {
    return failure(
      "HOST_LEGACY_ROOT_DRIFT",
      "verified project root no longer matches the review handle",
      "root_id",
    );
  }
  if (context.expected_head !== expectedHead) {
    return failure(
      "HOST_LEGACY_HEAD_DRIFT",
      "repository HEAD changed after legacy review",
      "HEAD",
    );
  }
  if (context.profile_lock_hash !== expectedProfile) {
    return failure(
      "HOST_LEGACY_PROFILE_DRIFT",
      "profile lock changed after legacy review",
      "profile_lock_hash",
    );
  }
  return success(true);
}

function groupKey(
  source: LegacySourceReviewDraft,
  category: LegacyFactCategory | null,
): LegacyImportGroupKey {
  if (source.disposition === "archive" || source.disposition === "unresolved") {
    return "archive_unresolved";
  }
  if (source.disposition === "reject") return "removed_rejected_superseded";
  if (category === "completed_work") return "completed_work";
  if (category === "current_decision") return "current_facts";
  if (category === "constraint") return "constraints";
  if (category === "next_action") return "next_actions";
  if (category === "idea") return "ideas";
  if (category === "risk" || category === "finding") return "risks_findings";
  if (category === "removed" || category === "rejected" || category === "superseded") {
    return "removed_rejected_superseded";
  }
  return "current_facts";
}

function destination(category: LegacyFactCategory | null): Pick<
  CompactLegacyImportItem,
  "destination_record_type" | "destination_status"
> {
  if (category === null) {
    return { destination_record_type: null, destination_status: null };
  }
  if (category === "completed_work") {
    return { destination_record_type: "change", destination_status: "closed" };
  }
  if (category === "current_decision" || category === "constraint") {
    return { destination_record_type: "decision", destination_status: "accepted" };
  }
  if (category === "risk") {
    return { destination_record_type: "risk", destination_status: "proposed" };
  }
  if (category === "finding") {
    return { destination_record_type: "finding", destination_status: "accepted" };
  }
  if (category === "lesson") {
    return { destination_record_type: "lesson", destination_status: "accepted" };
  }
  return {
    destination_record_type: "idea",
    destination_status:
      category === "removed" ? "withdrawn" :
      category === "rejected" ? "rejected" :
      category === "superseded" ? "superseded" : "proposed",
  };
}

function compactGroups(
  pending: PendingLegacyReview,
  sources: readonly LegacySourceReviewDraft[],
): readonly CompactLegacyImportGroup[] {
  const mappings = new Map(pending.proposal.mappings.map((mapping) => [
    mapping.source_path,
    mapping,
  ]));
  const grouped = new Map<LegacyImportGroupKey, CompactLegacyImportItem[]>();
  for (const source of sources.toSorted((left, right) =>
    compareUtf8(left.source_path, right.source_path)
  )) {
    const mapping = mappings.get(source.source_path);
    if (mapping === undefined) continue;
    const facts = source.disposition === "import" ? source.facts : [];
    if (facts.length === 0) {
      const key = groupKey(source, null);
      const items = grouped.get(key) ?? [];
      items.push({
        source_path: source.source_path,
        source_sha256: source.source_sha256,
        classification: mapping.classification,
        disposition: source.disposition,
        category: null,
        title: source.source_path,
        statement: null,
        ...destination(null),
        rationale: source.rationale,
      });
      grouped.set(key, items);
      continue;
    }
    for (const fact of facts) {
      const key = groupKey(source, fact.category);
      const items = grouped.get(key) ?? [];
      items.push({
        source_path: source.source_path,
        source_sha256: source.source_sha256,
        classification: mapping.classification,
        disposition: source.disposition,
        category: fact.category,
        title: fact.title,
        statement: fact.statement,
        ...destination(fact.category),
        rationale: fact.rationale,
      });
      grouped.set(key, items);
    }
  }
  return GROUPS.flatMap((definition) => {
    const items = grouped.get(definition.key);
    return items === undefined
      ? []
      : [{ ...definition, items }];
  });
}

function exactPlan(plan: ReviewedImportPlan): boolean {
  try {
    const { plan_hash: planHash, ...body } = plan;
    return plan.mutation_kind === "import" &&
      canonicalMutationPlanHash(body) === planHash;
  } catch {
    return false;
  }
}

function planMatchesInput(
  plan: ReviewedImportPlan,
  input: GuidedLegacyImportInput,
): boolean {
  return exactPlan(plan) &&
    plan.root_id === input.root_id &&
    plan.target_ref === input.target_ref &&
    plan.expected_head === input.expected_head &&
    plan.profile_lock_hash === input.profile_lock_hash &&
    plan.created_by === input.created_by &&
    plan.created_at === input.created_at &&
    plan.expires_at === input.expires_at &&
    plan.metadata.proposal_hash === input.proposal_hash;
}

export function createLegacyImportAuthority(
  expectedRoot: URL,
  expectedPlan: ReviewedImportPlan,
): PlanAuthorityValidator {
  return {
    verify(root, plan) {
      const exact = plan as ReviewedImportPlan;
      const accepted = sameRoot(root, expectedRoot) &&
        exact.mutation_kind === "import" &&
        exact.root_id === expectedPlan.root_id &&
        exact.target_ref === expectedPlan.target_ref &&
        exact.expected_head === expectedPlan.expected_head &&
        exact.profile_lock_hash === expectedPlan.profile_lock_hash &&
        exact.plan_hash === expectedPlan.plan_hash &&
        exactPlan(exact);
      return Promise.resolve(accepted
        ? success(true)
        : failure(
            "HOST_LEGACY_AUTHORITY_DENIED",
            "guided import authority accepts only the exact confirmed local import plan",
            plan.plan_id,
          ));
    },
  };
}

export class LegacyImportService {
  constructor(
    private readonly proposals: ProposalStore,
    private readonly dependencies: LegacyImportServiceDependencies,
  ) {}

  async planLegacyImport(
    request: PlanLegacyImportInput,
  ): Promise<RuntimeResult<CompactLegacyImportProposal>> {
    if (request.created_by.trim().length === 0 || request.created_by.length > 128) {
      return failure(
        "HOST_LEGACY_ACTOR_INVALID",
        "guided import requires one bounded agent actor identifier",
        "created_by",
      );
    }
    const reviewed = await this.proposals.resolve(request.review_handle, "legacy_review");
    if (!reviewed.ok) return reviewed;
    const coverage = validateCoverage(reviewed.value.pending, request.sources);
    if (!coverage.ok) return coverage;
    const context = await callDependency("legacyImportContext", () =>
      this.dependencies.context(reviewed.value.root));
    if (!context.ok) return context;
    const current = validateContext(
      reviewed.value.pending,
      reviewed.value.expected_head,
      reviewed.value.profile_lock_hash,
      context.value,
    );
    if (!current.ok) return current;
    const created = this.dependencies.now();
    if (!Number.isFinite(created.getTime())) {
      return failure("HOST_CLOCK_INVALID", "guided import clock must be valid");
    }
    const input: GuidedLegacyImportInput = {
      root_id: context.value.root_id,
      target_ref: context.value.target_ref,
      expected_head: context.value.expected_head,
      profile_lock_hash: context.value.profile_lock_hash,
      catalog_version: context.value.catalog_version,
      proposal_hash: reviewed.value.pending.proposal.proposal_hash,
      created_by: request.created_by,
      created_at: created.toISOString(),
      expires_at: new Date(created.getTime() + REVIEW_TTL_MILLISECONDS).toISOString(),
      sources: request.sources,
    };
    const planned = await callDependency("planGuidedLegacyImport", () =>
      this.dependencies.plan(reviewed.value.root, input));
    if (!planned.ok) return planned;
    if (!planMatchesInput(planned.value, input)) {
      return failure(
        "HOST_LEGACY_PLAN_INVALID",
        "guided import planner returned a plan outside the reviewed bindings",
        planned.value.plan_id,
      );
    }
    const groups = compactGroups(reviewed.value.pending, request.sources);
    const base = {
      operation: "legacy_import" as const,
      repository: reviewed.value.root.href,
      root_id: input.root_id,
      confirmation_required: true as const,
      plan_hash: planned.value.plan_hash,
      expected_head: planned.value.expected_head,
      expires_at: planned.value.expires_at,
      source_count: request.sources.length,
      fact_count: request.sources.reduce((total, source) => total + source.facts.length, 0),
      sensitivity_finding_count: reviewed.value.pending.scan.artifacts.reduce(
        (total, artifact) => total + artifact.sensitivity_findings.length,
        0,
      ),
      assumptions: [] as readonly string[],
      conflicts: [] as readonly string[],
      groups,
    };
    if (Buffer.byteLength(JSON.stringify(base), "utf8") > MAX_COMPACT_PROPOSAL_BYTES) {
      return failure(
        "HOST_LEGACY_SUMMARY_TOO_LARGE",
        "guided import summary exceeds the safe tool-response bound",
        "sources",
      );
    }
    const issued = await this.proposals.issue({
      kind: "legacy_import",
      root: reviewed.value.root,
      input,
      plan: planned.value,
    });
    if (!issued.ok) return issued;
    const consumed = await this.proposals.consume(request.review_handle, "legacy_review");
    if (!consumed.ok) {
      await this.proposals.consume(issued.value.handle, "legacy_import");
      return consumed;
    }
    return success({
      ...base,
      proposal_handle: issued.value.handle,
    }, planned.warnings);
  }

  async applyLegacyImport(
    request: ApplyLegacyImportInput,
  ): Promise<RuntimeResult<MutationReceipt>> {
    if (!request.approval.confirmed || request.approval.granted_by !== "Pitaji") {
      return failure(
        "HOST_APPROVAL_REQUIRED",
        "legacy import requires explicit confirmation granted by Pitaji",
        "approval",
      );
    }
    const stored = await this.proposals.resolve(request.proposal_handle, "legacy_import");
    if (!stored.ok) return stored;
    const context = await callDependency("legacyImportContext", () =>
      this.dependencies.context(stored.value.root));
    if (!context.ok) return context;
    const input = stored.value.input;
    if (context.value.root_id !== input.root_id) {
      return failure("HOST_LEGACY_ROOT_DRIFT", "verified project root changed", "root_id");
    }
    if (
      context.value.expected_head !== input.expected_head ||
      context.value.target_ref !== input.target_ref
    ) {
      return failure("HOST_LEGACY_HEAD_DRIFT", "repository ref or HEAD changed", "HEAD");
    }
    if (
      context.value.profile_lock_hash !== input.profile_lock_hash ||
      context.value.catalog_version !== input.catalog_version
    ) {
      return failure(
        "HOST_LEGACY_PROFILE_DRIFT",
        "profile or catalog binding changed",
        "profile_lock_hash",
      );
    }
    const replanned = await callDependency("planGuidedLegacyImport", () =>
      this.dependencies.plan(stored.value.root, input));
    if (!replanned.ok) return replanned;
    if (
      !planMatchesInput(replanned.value, input) ||
      replanned.value.plan_hash !== stored.value.plan.plan_hash
    ) {
      return failure(
        "HOST_LEGACY_PLAN_DRIFT",
        "guided import no longer reproduces the exact confirmed plan",
        stored.value.plan.plan_id,
      );
    }
    const authority = createLegacyImportAuthority(stored.value.root, stored.value.plan);
    const finalized = await callDependency("finalizeLegacyImport", () =>
      this.dependencies.finalize(stored.value.root, replanned.value, authority));
    if (!finalized.ok) return finalized;
    const consumed = await this.proposals.consume(request.proposal_handle, "legacy_import");
    if (!consumed.ok) {
      return success(finalized.value, [{
        code: "HOST_PROPOSAL_CONSUME_FAILED_AFTER_APPLY",
        severity: "warning",
        path: request.proposal_handle,
        message: "import succeeded but its local proposal handle could not be removed",
        references: consumed.issues.map((issue) => issue.code),
      }]);
    }
    return finalized;
  }
}
