import { Type, type Static } from "@sinclair/typebox";

import {
  NonEmptyStringSchema,
  SemVerSchema,
} from "./common.js";

export const PredicateOperatorSchema = Type.Union([
  Type.Literal("equals"),
  Type.Literal("in"),
  Type.Literal("contains_token"),
  Type.Literal("path_exists"),
  Type.Literal("record_exists"),
  Type.Literal("tag_present"),
  Type.Literal("relationship_exists"),
  Type.Literal("regex"),
]);

export const FeatureExpectedSchema = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Array(Type.String(), { uniqueItems: true }),
]);

const PredicateFields = {
  id: NonEmptyStringSchema,
  feature: Type.String({
    minLength: 1,
    pattern: "^[a-z][a-z0-9-]*(?:[.][a-z][a-z0-9-]*)+$",
  }),
  operator: PredicateOperatorSchema,
  expected: FeatureExpectedSchema,
  evidence_required: Type.Boolean(),
} as const;

export const BooleanSignalSchema = Type.Object(PredicateFields, {
  additionalProperties: false,
});

export const PositiveSignalSchema = Type.Object(
  {
    ...PredicateFields,
    weight: Type.Integer({ minimum: 1, maximum: 100 }),
  },
  { additionalProperties: false },
);

export const NegativeSignalSchema = Type.Object(
  {
    ...PredicateFields,
    penalty: Type.Integer({ minimum: 1, maximum: 100 }),
  },
  { additionalProperties: false },
);

export const SignalSelectionSchema = Type.Object(
  {
    feature_schema_version: SemVerSchema,
    required_signals: Type.Array(BooleanSignalSchema),
    positive_signals: Type.Array(PositiveSignalSchema),
    negative_signals: Type.Array(NegativeSignalSchema),
    exclusions: Type.Array(BooleanSignalSchema),
    max_positive_weight: Type.Integer({ minimum: 1 }),
    specificity_rank: Type.Integer({ minimum: 0 }),
    precedence: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type BooleanSignal = Static<typeof BooleanSignalSchema>;
export type PositiveSignal = Static<typeof PositiveSignalSchema>;
export type NegativeSignal = Static<typeof NegativeSignalSchema>;
export type SignalSelection = Static<typeof SignalSelectionSchema>;
