import {
  Type,
  type Static,
  type TSchema,
} from "@sinclair/typebox";

import { PATTERN_ID_PATTERN } from "../../contracts/vocabulary.js";

import type { SchemaId } from "../../schema/registry.js";

export function catalogSchema<const TId extends SchemaId, T extends TSchema>(
  id: TId,
  schema: T,
): T & { readonly $id: TId } {
  return Object.assign(schema, { $id: id });
}

export const DefinitionIdSchema = Type.String({ format: "definition-id" });
export const SemVerSchema = Type.String({ format: "semantic-version" });
export const NonEmptyStringSchema = Type.String({ minLength: 1 });
export const NonEmptyStringListSchema = Type.Array(NonEmptyStringSchema, {
  uniqueItems: true,
});

export const RootKindSchema = Type.Union([
  Type.Literal("product"),
  Type.Literal("shared-system"),
  Type.Literal("program"),
  Type.Literal("portfolio"),
  Type.Literal("engagement"),
]);
export type RootKind = Static<typeof RootKindSchema>;

export const PrimaryArchetypeSchema = Type.Union([
  Type.Literal("application-service"),
  Type.Literal("developer-platform"),
  Type.Literal("game-interactive"),
  Type.Literal("ai-data"),
  Type.Literal("commerce-network"),
  Type.Literal("content-learning"),
  Type.Literal("brand-design"),
  Type.Literal("research-knowledge"),
  Type.Literal("operations-automation"),
  Type.Literal("portfolio"),
  Type.Literal("engagement"),
]);
export type PrimaryArchetype = Static<typeof PrimaryArchetypeSchema>;

export const PatternModeSchema = Type.Union([
  Type.Literal("assess"),
  Type.Literal("plan"),
  Type.Literal("design"),
  Type.Literal("implement"),
  Type.Literal("change"),
  Type.Literal("validate"),
  Type.Literal("release"),
  Type.Literal("operate"),
  Type.Literal("retire"),
]);
export type PatternMode = Static<typeof PatternModeSchema>;

export const DefinitionStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("deprecated"),
  Type.Literal("retired"),
]);

export const PatternIdSchema = Type.String({ pattern: PATTERN_ID_PATTERN });
export const CompanionIdSchema = Type.String({
  pattern: "^companion[.][a-z][a-z0-9-]*$",
});

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
export type ControlledDuty = Static<typeof ControlledDutySchema>;

export const RequirementSchema = Type.Union([
  Type.Literal("required"),
  Type.Literal("conditional"),
  Type.Literal("not_applicable"),
]);

export const ResponsibleRoleSchema = Type.Union([
  Type.Literal("worker"),
  Type.Literal("validator"),
  Type.Literal("integrator"),
  Type.Literal("Pitaji"),
]);

export const ComponentTypeSchema = Type.Union([
  Type.Literal("surface"),
  Type.Literal("service"),
  Type.Literal("data"),
  Type.Literal("platform"),
  Type.Literal("workflow"),
  Type.Literal("content"),
  Type.Literal("shared-system"),
]);

export const CompatibilitySchema = Type.Object(
  {
    root_kinds: Type.Array(RootKindSchema, { uniqueItems: true }),
    primary_archetypes: Type.Array(PrimaryArchetypeSchema, {
      uniqueItems: true,
    }),
    required_overlays: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    forbidden_overlays: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type Compatibility = Static<typeof CompatibilitySchema>;

export const OverlayApplicabilitySchema = Type.Object(
  {
    baked: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    allowed: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
    forbidden: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type OverlayApplicability = Static<typeof OverlayApplicabilitySchema>;

const ComponentSelectorSchema = Type.Union([
  Type.Object({ id: DefinitionIdSchema }, { additionalProperties: false }),
  Type.Object({ type: ComponentTypeSchema }, { additionalProperties: false }),
  Type.Object({ tag: NonEmptyStringSchema }, { additionalProperties: false }),
  Type.Object(
    { dependency_rule: NonEmptyStringSchema },
    { additionalProperties: false },
  ),
]);

const DomainSelectorSchema = Type.Union([
  Type.Object({ id: DefinitionIdSchema }, { additionalProperties: false }),
  Type.Object({ tag: NonEmptyStringSchema }, { additionalProperties: false }),
]);

const ImpactConditionSchema = Type.Union([
  Type.Boolean(),
  NonEmptyStringSchema,
  Type.Null(),
]);

export const ComponentImpactSchema = Type.Object(
  {
    selector: ComponentSelectorSchema,
    duties: Type.Array(ControlledDutySchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    requirement: RequirementSchema,
    condition: ImpactConditionSchema,
    reason: NonEmptyStringSchema,
    write_scope: NonEmptyStringListSchema,
    responsible_role: ResponsibleRoleSchema,
  },
  { additionalProperties: false },
);
export type ComponentImpact = Static<typeof ComponentImpactSchema>;

export const DomainImpactSchema = Type.Object(
  {
    selector: DomainSelectorSchema,
    duties: Type.Array(ControlledDutySchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    requirement: RequirementSchema,
    condition: ImpactConditionSchema,
    reason: NonEmptyStringSchema,
    write_scope: NonEmptyStringListSchema,
    required_records: NonEmptyStringListSchema,
    responsible_role: ResponsibleRoleSchema,
  },
  { additionalProperties: false },
);
export type DomainImpact = Static<typeof DomainImpactSchema>;
