import type { TSchema } from "@sinclair/typebox";

import { canonicalJson } from "../../core/canonical-json.js";
import {
  registerSchema,
  type SchemaId,
} from "../../schema/registry.js";
import { AdapterDefinitionSchema } from "./adapter.js";
import {
  BlueprintDefinitionSchema,
  BlueprintGroupDefinitionSchema,
} from "./blueprint.js";
import { CompanionTaxonomyBindingSchema } from "./companion-rule.js";
import { ComponentDefinitionSchema } from "./component.js";
import { DomainDefinitionSchema } from "./domain.js";
import { BlueprintFixtureSchema } from "./fixture.js";
import {
  CatalogInventorySchema,
  CatalogManifestSchema,
  CatalogReleaseLockSchema,
} from "./manifest.js";
import { OverlayDefinitionSchema } from "./overlay.js";
import { PatternTaxonomyBindingSchema } from "./pattern.js";

export * from "./common.js";
export * from "./signals.js";
export * from "./blueprint.js";
export * from "./component.js";
export * from "./domain.js";
export * from "./overlay.js";
export * from "./adapter.js";
export * from "./pattern.js";
export * from "./companion-rule.js";
export * from "./fixture.js";
export * from "./manifest.js";

const CATALOG_SCHEMAS = Object.freeze([
  AdapterDefinitionSchema,
  BlueprintDefinitionSchema,
  BlueprintFixtureSchema,
  BlueprintGroupDefinitionSchema,
  CatalogInventorySchema,
  CatalogManifestSchema,
  CatalogReleaseLockSchema,
  CompanionTaxonomyBindingSchema,
  ComponentDefinitionSchema,
  DomainDefinitionSchema,
  OverlayDefinitionSchema,
  PatternTaxonomyBindingSchema,
] as const satisfies readonly TSchema[]);

export const CATALOG_SCHEMA_IDS = Object.freeze([
  "project-memory/v1/adapter-definition",
  "project-memory/v1/blueprint-definition",
  "project-memory/v1/blueprint-fixture",
  "project-memory/v1/blueprint-group-definition",
  "project-memory/v1/catalog-inventory",
  "project-memory/v1/catalog-manifest",
  "project-memory/v1/catalog-release-lock",
  "project-memory/v1/companion-taxonomy",
  "project-memory/v1/component-definition",
  "project-memory/v1/domain-definition",
  "project-memory/v1/overlay-definition",
  "project-memory/v1/pattern-taxonomy",
] as const satisfies readonly SchemaId[]);

export function registerCatalogSchemas(): readonly SchemaId[] {
  for (const schema of CATALOG_SCHEMAS) registerSchema(schema);
  return CATALOG_SCHEMA_IDS;
}

export function generateCatalogSchemaDocuments(): ReadonlyMap<string, string> {
  const documents = new Map<string, string>();
  for (const schema of CATALOG_SCHEMAS) {
    const plain = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
    const id = plain.$id;
    if (typeof id !== "string") {
      throw new TypeError("catalog schema is missing an identifier");
    }
    documents.set(
      id,
      canonicalJson({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        ...plain,
      }),
    );
  }
  return documents;
}
