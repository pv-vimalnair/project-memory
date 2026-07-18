import type { PatternModeValue } from "../contracts/vocabulary.js";
import type {
  Approval,
  Claim,
  CompletionPacket,
  GateExecution,
  ResolvedGateExecution,
  TaskPacket,
} from "./contracts.js";
import type {
  FeatureObservation,
  FeaturePredicate,
  ResolvedPatternCatalog,
  SelectionContext,
} from "../selection/types.js";

export type {
  Approval,
  Claim,
  CompletionPacket,
  GateExecution,
  ResolvedGateExecution,
  TaskPacket,
};

export type PatternMode = PatternModeValue;

export interface OutcomeIntent {
  readonly id: string;
  readonly statement: string;
  readonly primaryMode: PatternMode;
  readonly acceptanceCriteria: readonly string[];
  readonly authorityClass: "automatic-by-rule" | "integrator" | "Pitaji";
  readonly releaseFate: "none" | "planned" | "production";
  readonly canCompleteIndependently: boolean;
  readonly dependsOnOutcomeIds: readonly string[];
}

export interface PatternRef {
  readonly id: string;
  readonly version: string;
  readonly provenanceRuleIds: readonly string[];
}

export interface WorkstreamPatternSet {
  readonly outcomePrimary: PatternRef;
  readonly companions: readonly PatternRef[];
}

export type RequirementKind =
  | "duty"
  | "gate"
  | "evidence"
  | "output"
  | "record_update"
  | "approval";

export interface WorkstreamRequirement {
  readonly id: string;
  readonly kind: RequirementKind;
  readonly exclusive: boolean;
  readonly coordinationRequired: boolean;
  readonly sourcePatternIds: readonly string[];
}

export interface TaskAssignment {
  readonly taskId: string;
  readonly primaryPattern: PatternRef;
  readonly coveredRequirementIds: readonly string[];
  readonly claimedPaths: readonly string[];
  readonly coordinationIds: readonly string[];
}

export interface CoverageMap {
  readonly requirementTaskIds: Readonly<Record<string, readonly string[]>>;
  readonly unassignedRequirementIds: readonly string[];
  readonly duplicateExclusiveRequirementIds: readonly string[];
}

export interface TaskCandidate {
  readonly taskId: string;
  readonly primaryPatternId: string;
  readonly requestedRequirementIds: readonly string[];
  readonly claimedPaths: readonly string[];
  readonly coordinationIds: readonly string[];
}

export interface TaskAssignmentInput {
  readonly patternSet: WorkstreamPatternSet;
  readonly requirements: readonly WorkstreamRequirement[];
  readonly taskCandidates: readonly TaskCandidate[];
  readonly authorizedPaths?: readonly string[];
}

export type ImpactRequirement =
  | "required"
  | "conditional"
  | "not_applicable";

export interface ImpactEntry {
  readonly sourceId: string;
  readonly targetKind: "component" | "domain";
  readonly targetId: string;
  readonly requirement: ImpactRequirement;
  readonly duties: readonly (
    | "inspect"
    | "propose"
    | "modify"
    | "validate"
    | "approve"
    | "release"
    | "notify"
    | "record"
    | "no-touch"
  )[];
  readonly readPaths: readonly string[];
  readonly writePaths: readonly string[];
  readonly requiredEvidenceIds: readonly string[];
  readonly requiredRecordTypes: readonly string[];
  readonly responsibleRole: "worker" | "validator" | "integrator" | "Pitaji";
}

export interface ImpactMergeInput {
  readonly immutableImpacts: readonly ImpactEntry[];
  readonly rootPolicyImpacts: readonly ImpactEntry[];
  readonly overlayImpacts: readonly ImpactEntry[];
  readonly patternImpacts: readonly ImpactEntry[];
  readonly ownedPathsByTarget: Readonly<Record<string, readonly string[]>>;
  readonly claimCandidatePaths: readonly string[];
  readonly acceptedDecisionScopes: readonly (readonly string[])[];
  readonly approvalScopes: readonly (readonly string[])[];
  readonly approvalRequired?: boolean;
  readonly coordinatedTargetIds?: readonly string[];
  readonly dependencyEdges: readonly {
    readonly from: string;
    readonly to: string;
  }[];
}

export interface ResolvedImpact extends Omit<ImpactEntry, "sourceId"> {
  readonly sourceIds: readonly string[];
}

export interface ResolvedImpactPlan {
  readonly impacts: readonly ResolvedImpact[];
  readonly mutationPaths: readonly string[];
  readonly sourceIds: readonly string[];
}

export interface InitiativePlan {
  readonly workstreams: readonly OutcomeIntent[];
  readonly dependencyEdges: readonly {
    readonly from: string;
    readonly to: string;
  }[];
}

export interface TaskPacketInput {
  readonly packet: Omit<TaskPacket, "packet_id" | "claim">;
  readonly claim: Omit<
    Claim,
    "id" | "issued_at" | "expires_at" | "last_heartbeat_at"
  >;
  readonly claim_ttl_ms: number;
}

export interface CompletionValidationContext {
  readonly currentBaseRevision: string;
  readonly availableEvidenceIds: readonly string[];
  readonly approvedExceptionIds: readonly string[];
}

export interface ValidatedCompletion {
  readonly completion: CompletionPacket;
  readonly checkedGateIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface AuthorityValidationContext {
  readonly now: string;
  readonly expectedIssuer: string;
  readonly currentBaseRevision: string;
  readonly conflictingClaims: readonly Claim[];
  readonly recordedApprovals: readonly Approval[];
}

export interface AuthorityValidation {
  readonly valid: boolean;
  readonly claimId: string;
  readonly approvalIds: readonly string[];
}

export interface CompileComponentBinding {
  readonly instanceId: string;
  readonly definitionId: string | null;
  readonly type:
    | "surface"
    | "service"
    | "data"
    | "platform"
    | "workflow"
    | "content"
    | "shared-system";
  readonly tags: readonly string[];
  readonly dependencyRules: readonly string[];
  readonly paths: readonly string[];
}

export interface CompileDomainBinding {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly tags: readonly string[];
  readonly paths: readonly string[];
}

export interface CompileWorkstreamInput {
  readonly outcomes: readonly OutcomeIntent[];
  readonly observationsByOutcome: Readonly<
    Record<string, readonly FeatureObservation[]>
  >;
  readonly outcomeConditionsByOutcome: Readonly<
    Record<string, readonly FeaturePredicate[]>
  >;
  readonly catalog: ResolvedPatternCatalog;
  readonly selectionContext: SelectionContext;
  readonly applicability: {
    readonly rootKind: SelectionContext["rootKind"];
    readonly primaryArchetype: SelectionContext["primaryArchetype"];
    readonly overlayIds: readonly string[];
    readonly artifactTypes: readonly string[];
  };
  readonly root: TaskPacket["root"];
  readonly initiativeId: string | null;
  readonly repository: string;
  readonly originalBaseRevision: string;
  readonly integratorId: string;
  readonly workerId: string;
  readonly components: readonly CompileComponentBinding[];
  readonly domains: readonly CompileDomainBinding[];
  readonly authorizedPathsByOutcome: Readonly<
    Record<string, readonly string[]>
  >;
  readonly exclusionsByOutcome: Readonly<Record<string, readonly string[]>>;
  readonly approvals: readonly Approval[];
  readonly externalAuthorizationByOutcome: Readonly<
    Record<string, TaskPacket["authorization"]["external_action"]>
  >;
  readonly acceptedDecisionIds: readonly string[];
  readonly proposedDecisionIds: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly claimTtlMs: number;
  readonly heartbeatInterval: string;
  readonly renewalPolicy: string;
}

export interface CompileWorkstreamResult {
  readonly initiative: InitiativePlan;
  readonly workstreams: readonly OutcomeIntent[];
  readonly patternSets: readonly WorkstreamPatternSet[];
  readonly assignments: readonly TaskAssignment[];
  readonly taskPackets: readonly TaskPacket[];
  readonly coverage: CoverageMap;
}

export interface ResolvedGateDefinition {
  readonly gate: ResolvedGateExecution;
  readonly sourceDefinitionId: string;
}
