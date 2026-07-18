import type { RuntimeIssue } from "../../contracts/runtime-result.js";
import type { CatalogSource } from "../load-catalog.js";
import { validateCatalogFixtures } from "../validation/validate-fixtures.js";

export function validateGoldenFixtures(
  source: CatalogSource,
): readonly RuntimeIssue[] {
  return validateCatalogFixtures(source);
}
