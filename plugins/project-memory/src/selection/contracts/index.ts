import type { TSchema } from "@sinclair/typebox";

import {
  registerSchema,
  type SchemaId,
} from "../../schema/registry.js";
import {
  CompanionRuleCoreSchema,
  PatternCoreDefinitionSchema,
} from "./core.js";
import {
  ResolvedCompanionRuleSchema,
  ResolvedPatternSchema,
} from "./resolved.js";
import {
  NormalizedFeatureMapSchema,
  SelectionResultSchema,
} from "./selection.js";

export * from "./core.js";
export * from "./selection.js";
export * from "./resolved.js";

const SELECTION_SCHEMAS = Object.freeze([
  CompanionRuleCoreSchema,
  NormalizedFeatureMapSchema,
  PatternCoreDefinitionSchema,
  ResolvedCompanionRuleSchema,
  ResolvedPatternSchema,
  SelectionResultSchema,
] as const satisfies readonly TSchema[]);

export const SELECTION_SCHEMA_IDS = Object.freeze([
  "project-memory/v1/companion-rule-core",
  "project-memory/v1/normalized-feature-map",
  "project-memory/v1/pattern-core",
  "project-memory/v1/resolved-companion-rule",
  "project-memory/v1/resolved-pattern",
  "project-memory/v1/selection-result",
] as const satisfies readonly SchemaId[]);

export function registerSelectionSchemas(): readonly SchemaId[] {
  for (const schema of SELECTION_SCHEMAS) registerSchema(schema);
  return SELECTION_SCHEMA_IDS;
}
