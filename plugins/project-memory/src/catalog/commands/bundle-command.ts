import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import { buildCatalogRelease } from "../manifest/build-catalog-bundle.js";
import { prepareCatalogCommandSchemas } from "./prepare-schemas.js";
import type {
  CatalogCommandOptions,
  CatalogCommandReport,
} from "./types.js";

function packageOutputRoot(options: CatalogCommandOptions): URL {
  return options.output_root ?? new URL("../../../", options.root);
}

export async function bundleCommand(
  options: CatalogCommandOptions,
): Promise<RuntimeResult<CatalogCommandReport>> {
  const schemas = prepareCatalogCommandSchemas();
  if (!schemas.ok) return schemas;
  if (options.release === undefined) {
    return failure(
      "CATALOG_RELEASE_REQUIRED",
      "catalog bundle requires --release",
      "--release",
    );
  }
  const built = await buildCatalogRelease({
    sourceRoot: options.root,
    outputRoot: packageOutputRoot(options),
    release: options.release,
    checkClean: options.check_clean ?? false,
  });
  if (!built.ok) return built;
  return success({
    command: "bundle",
    valid: true,
    counts: {
      source_entries: built.value.lock.source_entries.length,
      generated_entries: built.value.lock.generated_entries.length,
      generated_artifacts: 3,
    },
    checked_ids: [built.value.lock.release_hash],
    details: {
      release: built.value.lock.release,
      release_hash: built.value.lock.release_hash,
      written: built.value.written,
      bundle_path: built.value.artifacts.bundle_path,
      lock_path: built.value.artifacts.lock_path,
      checksums_path: built.value.artifacts.checksums_path,
    },
  });
}