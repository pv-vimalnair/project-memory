import type { PlannedWrite } from "../contracts/planned-write.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import { validateWithSchema } from "../schema/validate.js";
import {
  buildSelectedCatalogLock,
  compareSelectedCatalogPath,
} from "./build-selected-catalog-lock.js";
import type { ResolvedCatalogSelection } from "./catalog-selection-resolver.js";
import {
  SelectedCatalogLockSchema,
  type SelectedCatalogLock,
} from "./contracts/index.js";

export function buildSelectedCatalogVendoring(
  selection: ResolvedCatalogSelection,
  lock: SelectedCatalogLock,
): RuntimeResult<readonly PlannedWrite[]> {
  const validatedLock = validateWithSchema<SelectedCatalogLock>(
    SelectedCatalogLockSchema.$id,
    lock,
  );
  if (!validatedLock.ok) return validatedLock;
  const expected = buildSelectedCatalogLock(selection);
  if (!expected.ok) return expected;
  let suppliedBytes: string;
  try {
    suppliedBytes = canonicalJson(validatedLock.value);
  } catch {
    return failure(
      "SELECTED_CATALOG_LOCK_INVALID",
      "selected catalog lock cannot be represented as canonical JSON",
    );
  }
  if (suppliedBytes !== canonicalJson(expected.value)) {
    return failure(
      "SELECTED_CATALOG_LOCK_MISMATCH",
      "supplied lock does not match the resolved exact target bytes",
    );
  }

  const byTarget = new Map(
    selection.files.map((file) => [file.target_relative_path, file] as const),
  );
  const writes: PlannedWrite[] = [];
  for (const entry of expected.value.entries) {
    const file = byTarget.get(entry.target_path);
    if (file === undefined) {
      return failure(
        "SELECTED_CATALOG_TARGET_MISSING",
        "lock target has no resolved source bytes",
        entry.target_path,
      );
    }
    writes.push({
      relative_path: entry.target_path,
      bytes: file.bytes,
      expected_existing_sha256: null,
      mode: "create_or_replace",
    });
  }
  return success(
    writes.sort((left, right) =>
      compareSelectedCatalogPath(left.relative_path, right.relative_path),
    ),
  );
}
