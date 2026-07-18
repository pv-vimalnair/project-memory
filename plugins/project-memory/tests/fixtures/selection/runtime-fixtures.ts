import type {
  BlueprintSelectableDefinition,
  NormalizedFeatureMap,
  PatternSelectableDefinition,
  SelectableDefinition,
  SelectionContext,
} from "../../../src/selection/types.js";

export const scoringFeatures: NormalizedFeatureMap = {
  schema_version: "1.0.0",
  features: {
    "action.mode": {
      id: "action.mode",
      value_type: "string",
      value: "implement",
      evidence: [
        {
          evidence_id: "EVD-01J00000000000000000000001",
          source_kind: "brief",
          source_ref: "brief:1",
          source_text: "Implement the referral flow",
          extractor_id: "fixture",
          extractor_version: "1.0.0",
        },
      ],
    },
  },
};

export const scoringContext: SelectionContext = {
  rootKind: "product",
  primaryArchetype: "application-service",
  profileId: "profile.lifeof",
  overlayIds: ["overlay.surface.mobile-first"],
  lockedDefinitionIds: [],
  migrationAllowed: false,
};

function candidate<K extends "blueprint" | "pattern">(
  id: string,
  matchedWeight: number,
  kind: K,
): SelectableDefinition<K> {
  return {
    id,
    version: "1.0.0",
    status: "active",
    kind,
    compatibility: {
      root_kinds: ["product"],
      primary_archetypes: ["application-service"],
      profile_ids: ["profile.lifeof"],
      required_overlays: ["overlay.surface.mobile-first"],
      forbidden_overlays: [],
    },
    selection: {
      required_signals: [],
      positive_signals: [
        {
          id: `${id}.matched`,
          feature: "action.mode",
          operator: "equals",
          expected: "implement",
          evidence_required: true,
          weight: matchedWeight,
        },
        {
          id: `${id}.unmatched`,
          feature: "action.mode",
          operator: "equals",
          expected: "assess",
          evidence_required: true,
          weight: 100 - matchedWeight,
        },
      ],
      negative_signals: [],
      exclusions: [],
      max_positive_weight: 100,
      specificity_rank: 50,
      precedence: 50,
    },
    authorization: {
      mutation: "task-scoped",
      external_action: "none",
    },
  };
}

export const patternScoringCandidates: readonly PatternSelectableDefinition[] = [
  candidate("engineering.feature.implement", 80, "pattern"),
  candidate("engineering.integration.implement", 65, "pattern"),
];

export const blueprintScoringCandidates: readonly BlueprintSelectableDefinition[] = [
  candidate("engineering.feature.implement", 80, "blueprint"),
  candidate("engineering.integration.implement", 65, "blueprint"),
];

export { makeValidCompletionPacket, makeValidTaskPacket } from "./runtime-packet-fixtures.js";
