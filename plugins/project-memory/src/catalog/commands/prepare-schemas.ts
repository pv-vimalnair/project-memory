import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import {
  PROJECT_SCHEMA_IDS,
  PROJECT_SCHEMA_REGISTRARS,
} from "../../schema/project-registrars.js";
import {
  getRegisteredSchemas,
  registerProjectSchemas,
} from "../../schema/registry.js";

export function prepareCatalogCommandSchemas(): RuntimeResult<true> {
  const current = getRegisteredSchemas().map((schema) => schema.$id);
  if (current.length === 0) {
    const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
    return registered.ok ? success(true) : registered;
  }
  const currentSet = new Set(current);
  const missing = PROJECT_SCHEMA_IDS.filter((id) => !currentSet.has(id));
  if (missing.length > 0) {
    return failure(
      "CATALOG_SCHEMA_REGISTRY_PARTIAL",
      `schema registry is missing: ${missing.join(",")}`,
    );
  }
  return success(true);
}
