import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import {
  loadCatalogInventory,
  type CatalogInventorySummary,
} from "../inventory/load-inventory.js";
import { prepareCatalogCommandSchemas } from "./prepare-schemas.js";
import type {
  CatalogCommandOptions,
  CatalogCommandReport,
} from "./types.js";

const PINNED_COUNTS = Object.freeze({
  blueprint_groups: 11,
  blueprints: 62,
  pattern_families: 16,
  patterns: 257,
  companion_rules: 13,
});

function summaryCounts(
  summary: CatalogInventorySummary,
): Readonly<Record<string, number>> {
  return {
    blueprint_groups: summary.blueprint_groups.length,
    blueprints: summary.blueprints.length,
    pattern_families: summary.pattern_families.length,
    patterns: summary.patterns.length,
    companion_rules: summary.companion_rules.length,
    components: summary.components.length,
    domains: summary.domains.length,
    overlays: summary.overlays.length,
    adapters: summary.adapters.length,
  };
}

export async function inventoryCommand(
  options: CatalogCommandOptions,
): Promise<RuntimeResult<CatalogCommandReport>> {
  const schemas = prepareCatalogCommandSchemas();
  if (!schemas.ok) return schemas;
  const inventory = await loadCatalogInventory(options.root);
  if (!inventory.ok) return inventory;
  const counts = summaryCounts(inventory.value);
  if (options.check ?? false) {
    for (const [key, expected] of Object.entries(PINNED_COUNTS)) {
      if (counts[key] !== expected) {
        return failure(
          "CATALOG_INVENTORY_TOTAL_MISMATCH",
          `${key}: expected ${String(expected)}, found ${String(counts[key])}`,
          key,
        );
      }
    }
  }
  return success({
    command: "inventory",
    valid: true,
    counts,
    checked_ids: [
      ...inventory.value.blueprint_groups,
      ...inventory.value.blueprints,
      ...inventory.value.patterns,
      ...inventory.value.companion_rules,
    ],
    details: { check: options.check ?? false },
  });
}
