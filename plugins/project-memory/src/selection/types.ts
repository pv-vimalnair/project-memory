import type {
  CandidateScore,
  FeatureEvidence,
  FeaturePredicate,
  FeatureScalar,
  NormalizedFeature,
  NormalizedFeatureMap,
  ResolvedCompanionRule,
  ResolvedPattern,
  SelectionDecision,
} from "./contracts/index.js";

import type {
  PrimaryArchetypeValue,
  RootKindValue,
} from "../contracts/vocabulary.js";

export type {
  CandidateScore,
  FeatureEvidence,
  FeaturePredicate,
  FeatureScalar,
  NormalizedFeature,
  NormalizedFeatureMap,
  ResolvedCompanionRule,
  ResolvedPattern,
  SelectionDecision,
};

export interface FeatureObservation {
  readonly id: string;
  readonly valueType: "string" | "number" | "boolean" | "string-set";
  readonly value: FeatureScalar | readonly string[];
  readonly evidenceId: string;
  readonly sourceKind?:
    | "brief"
    | "path"
    | "record"
    | "profile"
    | "classifier";
  readonly sourceRef: string;
  readonly sourceText?: string | null;
  readonly extractorId?: string;
  readonly extractorVersion?: string;
}

export interface PredicateEvaluation {
  readonly predicate_id: string;
  readonly matched: boolean;
  readonly code:
    | "predicate.matched"
    | "predicate.not_matched"
    | "predicate.feature_missing"
    | "predicate.evidence_missing"
    | "predicate.type_mismatch"
    | "predicate.regex_unanchored"
    | "predicate.regex_invalid";
  readonly evidence_ids: readonly string[];
}

export interface SelectableDefinition<
  K extends "blueprint" | "pattern" = "blueprint" | "pattern",
> {
  readonly id: string;
  readonly version: string;
  readonly status: "active" | "deprecated" | "retired";
  readonly kind: K;
  readonly compatibility: {
    readonly root_kinds: readonly RootKindValue[];
    readonly primary_archetypes: readonly PrimaryArchetypeValue[];
    readonly profile_ids: readonly string[];
    readonly required_overlays: readonly string[];
    readonly forbidden_overlays: readonly string[];
  };
  readonly selection: {
    readonly required_signals: readonly FeaturePredicate[];
    readonly positive_signals: readonly FeaturePredicate[];
    readonly negative_signals: readonly FeaturePredicate[];
    readonly exclusions: readonly FeaturePredicate[];
    readonly max_positive_weight: number;
    readonly specificity_rank: number;
    readonly precedence: number;
  };
  readonly authorization: {
    readonly mutation: "none" | "task-scoped" | "approval-required";
    readonly external_action: "none" | "explicit-approval-required";
  };
}

export type BlueprintSelectableDefinition =
  SelectableDefinition<"blueprint">;
export type PatternSelectableDefinition = SelectableDefinition<"pattern">;

export interface SelectionContext {
  readonly rootKind: RootKindValue;
  readonly primaryArchetype: PrimaryArchetypeValue;
  readonly profileId: string;
  readonly overlayIds: readonly string[];
  readonly lockedDefinitionIds: readonly string[];
  readonly migrationAllowed: boolean;
}

export interface ResolvedPatternCatalog {
  readonly patterns: ReadonlyMap<string, ResolvedPattern>;
  readonly companionRules: ReadonlyMap<string, ResolvedCompanionRule>;
}

export interface CompanionExpansionInput {
  readonly primaryPatternIds: readonly string[];
  readonly features: NormalizedFeatureMap;
  readonly catalog: ResolvedPatternCatalog;
  readonly applicability: {
    readonly rootKind: RootKindValue;
    readonly primaryArchetype: PrimaryArchetypeValue;
    readonly overlayIds: readonly string[];
    readonly artifactTypes: readonly string[];
  };
}

export interface ExpandedPatternReference {
  readonly id: string;
  readonly version: string;
  readonly provenanceRuleIds: readonly string[];
  readonly sourcePatternIds: readonly string[];
}

export interface CompanionClosure {
  readonly patterns: readonly ExpandedPatternReference[];
  readonly primaryPatternIds: readonly string[];
  readonly companionPatternIds: readonly string[];
  readonly appliedRuleIds: readonly string[];
  readonly iterations: number;
}
