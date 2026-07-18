import {
  Type,
  type Static,
  type TSchema,
} from "@sinclair/typebox";

import { PATTERN_ID_PATTERN } from "../../contracts/vocabulary.js";

export function ownedSchema<const TId extends string, T extends TSchema>(
  id: TId,
  schema: T,
): T & { readonly $id: TId } {
  return Object.assign(schema, { $id: id });
}

export const FeatureScalarSchema = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
]);
export const FeatureValueSchema = Type.Union([
  FeatureScalarSchema,
  Type.Array(Type.String(), { uniqueItems: true }),
]);

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

export const FeaturePredicateSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    feature: Type.String({
      minLength: 1,
      pattern: "^[a-z][a-z0-9-]*(?:[.][a-z][a-z0-9-]*)+$",
    }),
    operator: PredicateOperatorSchema,
    expected: FeatureValueSchema,
    evidence_required: Type.Boolean(),
    weight: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    penalty: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

const SignalSelectionSchema = Type.Object(
  {
    feature_schema_version: Type.String({ format: "semantic-version" }),
    required_signals: Type.Array(FeaturePredicateSchema),
    positive_signals: Type.Array(FeaturePredicateSchema),
    negative_signals: Type.Array(FeaturePredicateSchema),
    exclusions: Type.Array(FeaturePredicateSchema),
    max_positive_weight: Type.Integer({ minimum: 1 }),
    specificity_rank: Type.Integer({ minimum: 0 }),
    precedence: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const ControlledDutySchema = Type.Union([
  Type.Literal("inspect"),
  Type.Literal("propose"),
  Type.Literal("modify"),
  Type.Literal("validate"),
  Type.Literal("approve"),
  Type.Literal("release"),
  Type.Literal("notify"),
  Type.Literal("record"),
  Type.Literal("no-touch"),
]);

const AuthorizationSchema = Type.Object(
  {
    mutation: Type.Union([
      Type.Literal("none"),
      Type.Literal("task-scoped"),
      Type.Literal("approval-required"),
    ]),
    task_result_submission: Type.Literal("worker"),
    factual_integration: Type.Literal("integrator"),
    workstream_activation: Type.Union([
      Type.Literal("automatic-by-rule"),
      Type.Literal("integrator"),
      Type.Literal("Pitaji"),
    ]),
    directional_acceptance: Type.Literal("Pitaji"),
    external_action: Type.Union([
      Type.Literal("none"),
      Type.Literal("explicit-approval-required"),
    ]),
  },
  { additionalProperties: false },
);

const CompositionSchema = Type.Object(
  {
    allowed_primary_pattern_ids: Type.Array(
      Type.String({ format: "definition-id" }),
      { uniqueItems: true },
    ),
    mandatory_companion_rule_ids: Type.Array(
      Type.String({ format: "definition-id" }),
      { uniqueItems: true },
    ),
    incompatible_pattern_ids: Type.Array(
      Type.String({ format: "definition-id" }),
      { uniqueItems: true },
    ),
    triggers_companions: Type.Boolean(),
  },
  { additionalProperties: false },
);

const StringListSchema = Type.Array(Type.String({ minLength: 1 }), {
  uniqueItems: true,
});

export const PatternCoreDefinitionSchema = ownedSchema(
  "project-memory/v1/pattern-core",
  Type.Object(
    {
      id: Type.String({ pattern: PATTERN_ID_PATTERN }),
      version: Type.String({ format: "semantic-version" }),
      status: Type.Union([
        Type.Literal("active"),
        Type.Literal("deprecated"),
        Type.Literal("retired"),
      ]),
      purpose: Type.String({ minLength: 1 }),
      selection: SignalSelectionSchema,
      composition: CompositionSchema,
      duties: Type.Array(ControlledDutySchema, { uniqueItems: true }),
      write_scope: StringListSchema,
      authorization: AuthorizationSchema,
      inputs: StringListSchema,
      outputs: StringListSchema,
      evidence: StringListSchema,
      gates: StringListSchema,
      memory_updates: StringListSchema,
      completion_conditions: StringListSchema,
      fallback_and_escalation: StringListSchema,
    },
    { additionalProperties: false },
  ),
);

const CompanionWhenSchema = Type.Object(
  {
    all: Type.Array(FeaturePredicateSchema),
    any: Type.Array(FeaturePredicateSchema),
    none: Type.Array(FeaturePredicateSchema),
  },
  { additionalProperties: false },
);

const RequiredPatternSchema = Type.Object(
  {
    id: Type.String({ format: "definition-id" }),
    version_range: Type.String({ minLength: 1 }),
    condition: Type.Union([Type.Boolean(), Type.String({ minLength: 1 })]),
  },
  { additionalProperties: false },
);

export const CompanionRuleCoreSchema = ownedSchema(
  "project-memory/v1/companion-rule-core",
  Type.Object(
    {
      id: Type.String({
        pattern: "^companion[.][a-z][a-z0-9-]*$",
      }),
      version: Type.String({ format: "semantic-version" }),
      status: Type.Union([
        Type.Literal("active"),
        Type.Literal("deprecated"),
        Type.Literal("retired"),
      ]),
      purpose: Type.String({ minLength: 1 }),
      when: CompanionWhenSchema,
      require_patterns: Type.Array(RequiredPatternSchema),
      require_duties: Type.Array(ControlledDutySchema, { uniqueItems: true }),
      require_evidence: StringListSchema,
      authority_effect: Type.Literal("narrow-only"),
      conflict_policy: Type.Literal("fail_closed"),
    },
    { additionalProperties: false },
  ),
);

export type FeatureScalar = Static<typeof FeatureScalarSchema>;
export type FeaturePredicate = Static<typeof FeaturePredicateSchema>;
export type ControlledDuty = Static<typeof ControlledDutySchema>;
export type PatternCoreDefinition = Static<typeof PatternCoreDefinitionSchema>;
export type CompanionRuleCore = Static<typeof CompanionRuleCoreSchema>;
