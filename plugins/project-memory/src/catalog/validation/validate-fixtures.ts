import type { RuntimeIssue } from "../../contracts/runtime-result.js";
import { catalogIssue } from "../issues.js";
import type { CatalogSource } from "../load-catalog.js";

export function validateCatalogFixtures(
  source: CatalogSource,
): readonly RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];
  for (const fixture of source.fixtures.values()) {
    if (
      fixture.expected.decision === "selected" &&
      fixture.expected.blueprint_id === undefined
    ) {
      issues.push(
        catalogIssue(
          "CATALOG_FIXTURE_EXPECTATION_INCOMPLETE",
          `fixtures/${fixture.id}/expected/blueprint_id`,
          "selected fixture outcomes require a blueprint ID",
        ),
      );
    }
    if (
      fixture.expected.decision === "rejected" &&
      (fixture.expected.prohibited_blueprint_ids?.length ?? 0) === 0
    ) {
      issues.push(
        catalogIssue(
          "CATALOG_FIXTURE_EXPECTATION_INCOMPLETE",
          `fixtures/${fixture.id}/expected/prohibited_blueprint_ids`,
          "rejected fixture outcomes require prohibited blueprint IDs",
        ),
      );
    }
  }
  return issues;
}
