import { Type, type Static } from "@sinclair/typebox";

import {
  FeatureValueSchema,
  ownedSchema,
} from "./core.js";

const SourceKindSchema = Type.Union([
  Type.Literal("brief"),
  Type.Literal("path"),
  Type.Literal("record"),
  Type.Literal("profile"),
  Type.Literal("classifier"),
]);

const FeatureEvidenceSchema = Type.Object(
  {
    evidence_id: Type.String({
      pattern: "^EVD-[0-9A-HJKMNP-TV-Z]{26}$",
    }),
    source_kind: SourceKindSchema,
    source_ref: Type.String({ minLength: 1 }),
    source_text: Type.Union([Type.String(), Type.Null()]),
    extractor_id: Type.String({ minLength: 1 }),
    extractor_version: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const NormalizedFeatureSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    value_type: Type.Union([
      Type.Literal("string"),
      Type.Literal("number"),
      Type.Literal("boolean"),
      Type.Literal("string-set"),
    ]),
    value: FeatureValueSchema,
    evidence: Type.Array(FeatureEvidenceSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const NormalizedFeatureMapSchema = ownedSchema(
  "project-memory/v1/normalized-feature-map",
  Type.Object(
    {
      schema_version: Type.Literal("1.0.0"),
      features: Type.Record(
        Type.String({ minLength: 1 }),
        NormalizedFeatureSchema,
      ),
    },
    { additionalProperties: false },
  ),
);

export const CandidateScoreSchema = Type.Object(
  {
    definition_id: Type.String({ format: "definition-id" }),
    version: Type.String({ format: "semantic-version" }),
    eligible: Type.Boolean(),
    score: Type.Number({ minimum: 0, maximum: 100 }),
    matched_positive_ids: Type.Array(Type.String({ minLength: 1 }), {
      uniqueItems: true,
    }),
    matched_negative_ids: Type.Array(Type.String({ minLength: 1 }), {
      uniqueItems: true,
    }),
    disqualification_codes: Type.Array(Type.String({ minLength: 1 }), {
      uniqueItems: true,
    }),
    specificity_rank: Type.Integer({ minimum: 0 }),
    precedence: Type.Integer({ minimum: 0 }),
    authority_rank: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const SelectionResultSchema = ownedSchema(
  "project-memory/v1/selection-result",
  Type.Object(
    {
      disposition: Type.Union([
        Type.Literal("automatic"),
        Type.Literal("integrator_review"),
        Type.Literal("clarification_required"),
      ]),
      winner: Type.Union([CandidateScoreSchema, Type.Null()]),
      runner_up: Type.Union([CandidateScoreSchema, Type.Null()]),
      margin: Type.Union([
        Type.Number({ minimum: 0, maximum: 100 }),
        Type.Null(),
      ]),
      ranked: Type.Array(CandidateScoreSchema),
    },
    { additionalProperties: false },
  ),
);

export type FeatureEvidence = Static<typeof FeatureEvidenceSchema>;
export type NormalizedFeature = Static<typeof NormalizedFeatureSchema>;
export type NormalizedFeatureMap = Static<typeof NormalizedFeatureMapSchema>;
export type CandidateScore = Static<typeof CandidateScoreSchema>;
export type SelectionDecision = Static<typeof SelectionResultSchema>;
