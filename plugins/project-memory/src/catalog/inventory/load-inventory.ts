import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import { PATTERN_FAMILY_IDS } from "../../contracts/vocabulary.js";
import { compareUtf8 } from "../issues.js";
import { loadCatalog, type CatalogSource } from "../load-catalog.js";

export interface CatalogInventorySummary {
  readonly blueprint_groups: readonly string[];
  readonly blueprints: readonly string[];
  readonly pattern_families: readonly string[];
  readonly patterns: readonly string[];
  readonly companion_rules: readonly string[];
  readonly components: readonly string[];
  readonly domains: readonly string[];
  readonly overlays: readonly string[];
  readonly adapters: readonly string[];
}

function inventoryIds(
  source: CatalogSource,
  id: string,
): RuntimeResult<readonly string[]> {
  const inventory = source.inventories.get(id);
  if (inventory === undefined) {
    return failure(
      "CATALOG_INVENTORY_MISSING",
      `missing normative inventory ${id}`,
      id,
    );
  }
  if (inventory.expected_count !== inventory.ids.length) {
    return failure(
      "CATALOG_INVENTORY_COUNT_MISMATCH",
      `${id} expected ${String(inventory.expected_count)} but lists ${String(inventory.ids.length)}`,
      id,
    );
  }
  return success(inventory.ids);
}

function combineInventories(
  source: CatalogSource,
  ids: readonly string[],
): RuntimeResult<readonly string[]> {
  const combined: string[] = [];
  for (const id of ids) {
    const loaded = inventoryIds(source, id);
    if (!loaded.ok) return loaded;
    combined.push(...loaded.value);
  }
  if (new Set(combined).size !== combined.length) {
    return failure(
      "CATALOG_INVENTORY_DUPLICATE_ID",
      "normative inventories contain duplicate definition IDs",
      ids.join(","),
    );
  }
  return success(combined);
}

function inventoryKeys(
  source: CatalogSource,
  prefix: string,
): readonly string[] {
  return [...source.inventories.keys()]
    .filter((id) => id.startsWith(prefix))
    .sort(compareUtf8);
}

export function summarizeCatalogInventories(
  source: CatalogSource,
): RuntimeResult<CatalogInventorySummary> {
  const blueprintGroups = inventoryIds(source, "inventory.blueprint-groups");
  if (!blueprintGroups.ok) return blueprintGroups;
  const blueprints = combineInventories(
    source,
    blueprintGroups.value.map(
      (id) => `inventory.blueprints.${id.slice("blueprint-group.".length)}`,
    ),
  );
  if (!blueprints.ok) return blueprints;
  const patternFamilies = inventoryIds(source, "inventory.pattern-families");
  if (!patternFamilies.ok) return patternFamilies;
  if (
    JSON.stringify(patternFamilies.value) !== JSON.stringify(PATTERN_FAMILY_IDS)
  ) {
    return failure(
      "CATALOG_PATTERN_FAMILY_INVENTORY_MISMATCH",
      "pattern family inventory differs from the frozen vocabulary",
      "inventory.pattern-families",
    );
  }
  const patterns = combineInventories(
    source,
    patternFamilies.value.map((family) => `inventory.patterns.${family}`),
  );
  if (!patterns.ok) return patterns;
  const companionRules = inventoryIds(source, "inventory.companion-rules");
  if (!companionRules.ok) return companionRules;
  const components = combineInventories(
    source,
    inventoryKeys(source, "inventory.components."),
  );
  if (!components.ok) return components;
  const domains = inventoryIds(source, "inventory.domains");
  if (!domains.ok) return domains;
  const overlays = combineInventories(
    source,
    inventoryKeys(source, "inventory.overlays."),
  );
  if (!overlays.ok) return overlays;
  const adapters = combineInventories(
    source,
    inventoryKeys(source, "inventory.adapters."),
  );
  if (!adapters.ok) return adapters;
  return success({
    blueprint_groups: blueprintGroups.value,
    blueprints: blueprints.value,
    pattern_families: patternFamilies.value,
    patterns: patterns.value,
    companion_rules: companionRules.value,
    components: components.value,
    domains: domains.value,
    overlays: overlays.value,
    adapters: adapters.value,
  });
}

export async function loadCatalogInventory(
  root: URL,
): Promise<RuntimeResult<CatalogInventorySummary>> {
  const loaded = await loadCatalog(root);
  return loaded.ok ? summarizeCatalogInventories(loaded.value) : loaded;
}
