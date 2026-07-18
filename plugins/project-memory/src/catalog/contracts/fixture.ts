import { Type, type Static } from "@sinclair/typebox";

import {
  catalogSchema,
  DefinitionIdSchema,
  NonEmptyStringListSchema,
  NonEmptyStringSchema,
} from "./common.js";
import { FeatureExpectedSchema } from "./signals.js";

const ExpectedBlueprintOutcomeSchema = Type.Object(
  {
    decision: Type.Union([
      Type.Literal("selected"),
      Type.Literal("rejected"),
      Type.Literal("review_required"),
    ]),
    blueprint_id: Type.Optional(DefinitionIdSchema),
    prohibited_blueprint_ids: Type.Optional(
      Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    ),
    reason_codes: NonEmptyStringListSchema,
  },
  { additionalProperties: false },
);

export const BlueprintFixtureSchema = catalogSchema("project-memory/v1/blueprint-fixture", Type.Object(
  {
    id: DefinitionIdSchema,
    kind: Type.Union([
      Type.Literal("blueprint-positive"),
      Type.Literal("blueprint-anti"),
      Type.Literal("blueprint-boundary"),
    ]),
    description: Type.Optional(NonEmptyStringSchema),
    normalized_features: Type.Record(
      Type.String({ minLength: 1 }),
      FeatureExpectedSchema,
    ),
    expected: ExpectedBlueprintOutcomeSchema,
  },
  { additionalProperties: false },
));

export type BlueprintFixture = Static<typeof BlueprintFixtureSchema>;
