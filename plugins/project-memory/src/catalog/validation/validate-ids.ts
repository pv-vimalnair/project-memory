import type { RuntimeIssue } from "../../contracts/runtime-result.js";
import type { CatalogSource } from "../load-catalog.js";
import { catalogIssue } from "../issues.js";

interface Identified {
  readonly id: string;
}

interface LifecycleDefinition extends Identified {
  readonly status: "active" | "deprecated" | "retired";
  readonly replacement_id?: string;
  readonly migration_notes?: string;
}

function validateMapIds<T extends Identified>(
  map: ReadonlyMap<string, T>,
  path: string,
): readonly RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];
  for (const [key, value] of map) {
    if (key !== value.id) {
      issues.push(
        catalogIssue(
          "CATALOG_MAP_ID_MISMATCH",
          `${path}/${key}`,
          `map key ${key} does not match definition ID ${value.id}`,
          [value.id],
        ),
      );
    }
  }
  return issues;
}

function validateBindingIds(
  map: ReadonlyMap<string, { readonly pattern_id?: string; readonly rule_id?: string }>,
  path: string,
): readonly RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];
  for (const [key, value] of map) {
    const id = value.pattern_id ?? value.rule_id;
    if (id !== key) {
      issues.push(
        catalogIssue(
          "CATALOG_MAP_ID_MISMATCH",
          `${path}/${key}`,
          `map key ${key} does not match binding ID ${id ?? "missing"}`,
          id === undefined ? [] : [id],
        ),
      );
    }
  }
  return issues;
}

function validateLifecycle(
  definitions: Iterable<LifecycleDefinition>,
  path: string,
): readonly RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];
  for (const definition of definitions) {
    if (
      definition.status !== "active" &&
      (definition.replacement_id === undefined ||
        definition.migration_notes === undefined)
    ) {
      issues.push(
        catalogIssue(
          "CATALOG_LIFECYCLE_METADATA_REQUIRED",
          `${path}/${definition.id}`,
          `${definition.status} definitions require replacement and migration metadata`,
        ),
      );
    }
  }
  return issues;
}

export function validateCatalogIds(
  source: CatalogSource,
): readonly RuntimeIssue[] {
  return [
    ...validateMapIds(source.blueprint_groups, "blueprint-groups"),
    ...validateMapIds(source.blueprints, "blueprints"),
    ...validateMapIds(source.components, "components"),
    ...validateMapIds(source.domains, "domains"),
    ...validateMapIds(source.overlays, "overlays"),
    ...validateMapIds(source.adapters, "adapters"),
    ...validateMapIds(source.pattern_cores, "pattern-cores"),
    ...validateBindingIds(source.pattern_taxonomy, "pattern-taxonomy"),
    ...validateMapIds(source.companion_cores, "companion-cores"),
    ...validateBindingIds(source.companion_taxonomy, "companion-taxonomy"),
    ...validateMapIds(source.fixtures, "fixtures"),
    ...validateMapIds(source.inventories, "inventories"),
    ...validateLifecycle(source.blueprints.values(), "blueprints"),
    ...validateLifecycle(source.components.values(), "components"),
    ...validateLifecycle(source.domains.values(), "domains"),
    ...validateLifecycle(source.overlays.values(), "overlays"),
    ...validateLifecycle(source.adapters.values(), "adapters"),
  ];
}
