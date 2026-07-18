import type { RuntimeIssue } from "../../contracts/runtime-result.js";
import { assembleCompanionRule } from "../assembly/assemble-companion-rule.js";
import { assemblePatternDefinition } from "../assembly/assemble-pattern.js";
import { catalogIssue, compareUtf8 } from "../issues.js";
import type { CatalogSource } from "../load-catalog.js";

export interface BijectionValidationOptions {
  readonly strict?: boolean;
}

function allIds(
  left: ReadonlyMap<string, unknown>,
  right: ReadonlyMap<string, unknown>,
): readonly string[] {
  return [...new Set([...left.keys(), ...right.keys()])].sort(compareUtf8);
}

export function validatePatternBijection(
  source: CatalogSource,
  options: BijectionValidationOptions = {},
): readonly RuntimeIssue[] {
  const strict = options.strict ?? true;
  const issues: RuntimeIssue[] = [];
  for (const id of allIds(source.pattern_cores, source.pattern_taxonomy)) {
    const core = source.pattern_cores.get(id);
    const taxonomy = source.pattern_taxonomy.get(id);
    if (core === undefined || taxonomy === undefined) {
      if (strict) {
        issues.push(
          catalogIssue(
            "CATALOG_HALF_MISSING",
            `patterns/${id}`,
            `pattern ${id} must have exactly one core and one taxonomy half`,
          ),
        );
      }
      continue;
    }
    const assembled = assemblePatternDefinition(core, taxonomy);
    if (!assembled.ok) issues.push(...assembled.issues);
  }
  for (const id of allIds(source.companion_cores, source.companion_taxonomy)) {
    const core = source.companion_cores.get(id);
    const taxonomy = source.companion_taxonomy.get(id);
    if (core === undefined || taxonomy === undefined) {
      if (strict) {
        issues.push(
          catalogIssue(
            "CATALOG_HALF_MISSING",
            `companion-rules/${id}`,
            `companion ${id} must have exactly one core and one taxonomy half`,
          ),
        );
      }
      continue;
    }
    const assembled = assembleCompanionRule(core, taxonomy);
    if (!assembled.ok) issues.push(...assembled.issues);
  }
  return issues;
}
