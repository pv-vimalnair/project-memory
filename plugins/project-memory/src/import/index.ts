import { createLegacyScanner, type LegacyScannerDependencies } from "./scanner.js";
import { planLegacyImport, proposeLegacyImport } from "./planner.js";
import { planReviewedImport } from "./plan-reviewed-import.js";
import type {
  LegacyImporter,
  LegacyImportPlan,
  ReviewedImportPlan,
  ReviewedImportPlanInput,
  ReviewedLegacyImportInput,
} from "./contracts.js";
import type { RuntimeResult } from "../contracts/runtime-result.js";

function planImport(
  input: ReviewedLegacyImportInput,
): RuntimeResult<LegacyImportPlan>;
function planImport(
  input: ReviewedImportPlanInput,
): RuntimeResult<ReviewedImportPlan>;
function planImport(
  input: ReviewedLegacyImportInput | ReviewedImportPlanInput,
): RuntimeResult<LegacyImportPlan | ReviewedImportPlan> {
  return "candidates" in input
    ? planReviewedImport(input)
    : planLegacyImport(input);
}

export function createLegacyImporter(
  dependencies: LegacyScannerDependencies = {},
): LegacyImporter {
  const scanner = createLegacyScanner(dependencies);
  return {
    scan: (root, options) => scanner.scan(root, options),
    propose: proposeLegacyImport,
    plan: planImport,
  };
}

export * from "./contracts.js";
export * from "./classifiers.js";
export * from "./scanner.js";
export * from "./planner.js";
export * from "./plan-reviewed-import.js";
export * from "./render-import-report.js";
export * from "./pending-review.js";
