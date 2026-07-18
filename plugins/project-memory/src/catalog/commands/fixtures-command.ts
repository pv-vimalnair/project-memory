import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import { selectBlueprint } from "../../selection/index.js";
import { runIntegratedBlueprintFixtures } from "../fixtures/run-integrated-blueprint-fixtures.js";
import { compareUtf8 } from "../issues.js";
import { loadCatalog } from "../load-catalog.js";
import { validateCatalogFixtures } from "../validation/validate-fixtures.js";
import { prepareCatalogCommandSchemas } from "./prepare-schemas.js";
import type {
  CatalogCommandOptions,
  CatalogCommandReport,
} from "./types.js";

export async function fixturesCommand(
  options: CatalogCommandOptions,
): Promise<RuntimeResult<CatalogCommandReport>> {
  const schemas = prepareCatalogCommandSchemas();
  if (!schemas.ok) return schemas;
  const loaded = await loadCatalog(options.root);
  if (!loaded.ok) return loaded;
  const issues = validateCatalogFixtures(loaded.value);
  if (issues.length > 0) return { ok: false, issues };
  const fixtures = [...loaded.value.fixtures.values()];
  const counts = {
    positive: fixtures.filter((item) => item.kind === "blueprint-positive").length,
    anti: fixtures.filter((item) => item.kind === "blueprint-anti").length,
    boundary: fixtures.filter((item) => item.kind === "blueprint-boundary").length,
    total: fixtures.length,
  };
  if (
    (options.check ?? false) &&
    (counts.positive !== 62 ||
      counts.anti !== 62 ||
      counts.boundary !== 26 ||
      counts.total !== 150)
  ) {
    return failure(
      "CATALOG_FIXTURE_TOTAL_MISMATCH",
      "blueprint fixture counts must be 62 positive, 62 anti, and 26 boundary",
    );
  }
  const integrated = options.integrated
    ? runIntegratedBlueprintFixtures({
        selectBlueprint,
        catalog: loaded.value,
        fixtures,
      })
    : null;
  if (integrated !== null && !integrated.ok) return integrated;
  if (integrated?.ok && integrated.value.failed > 0) {
    return failure(
      "CATALOG_INTEGRATED_FIXTURE_FAILURE",
      `${String(integrated.value.failed)} integrated blueprint fixtures failed`,
      "fixtures",
      integrated.value.failures.map((item) => item.fixture_id),
    );
  }
  const integratedReport = integrated?.ok ? integrated.value : null;
  return success({
    command: "fixtures",
    valid: true,
    counts:
      integratedReport === null
        ? counts
        : {
            ...counts,
            passed: integratedReport.passed,
            failed: integratedReport.failed,
          },
    checked_ids: fixtures.map((item) => item.id).sort(compareUtf8),
    details: {
      suite: options.suite ?? null,
      scope: options.scope ?? null,
      schema_only: options.schema_only ?? false,
      integrated: options.integrated ?? false,
      integrated_report: integratedReport,
    },
  });
}
