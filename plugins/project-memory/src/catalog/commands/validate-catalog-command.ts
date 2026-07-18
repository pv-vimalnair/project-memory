import type { RuntimeResult } from "../../contracts/runtime-result.js";
import { loadCatalog } from "../load-catalog.js";
import { validateCatalog } from "../validation/validate-catalog.js";
import { prepareCatalogCommandSchemas } from "./prepare-schemas.js";
import type {
  CatalogCommandOptions,
  CatalogCommandReport,
} from "./types.js";

export async function validateCatalogCommand(
  options: CatalogCommandOptions,
): Promise<RuntimeResult<CatalogCommandReport>> {
  const schemas = prepareCatalogCommandSchemas();
  if (!schemas.ok) return schemas;
  const loaded = await loadCatalog(options.root);
  if (!loaded.ok) return loaded;
  const strict = options.strict ?? false;
  const validated = validateCatalog(loaded.value, { strict });
  if (!validated.ok) return validated;
  return {
    ok: true,
    value: {
      command: "validate",
      valid: true,
      counts: {
        blueprint_groups: loaded.value.blueprint_groups.size,
        blueprints: loaded.value.blueprints.size,
        components: loaded.value.components.size,
        domains: loaded.value.domains.size,
        overlays: loaded.value.overlays.size,
        adapters: loaded.value.adapters.size,
        patterns: loaded.value.pattern_cores.size,
        companion_rules: loaded.value.companion_cores.size,
        fixtures: loaded.value.fixtures.size,
      },
      checked_ids: validated.value.checked_ids,
      details: {
        strict,
        scope: options.scope ?? null,
      },
    },
    warnings: [],
  };
}
