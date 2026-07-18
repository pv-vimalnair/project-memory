import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import { buildCatalogRelease } from "../manifest/build-catalog-bundle.js";
import { verifyCatalogRelease } from "../manifest/verify-catalog-release.js";
import { prepareCatalogCommandSchemas } from "./prepare-schemas.js";
import type {
  CatalogCommandOptions,
  CatalogCommandReport,
} from "./types.js";

function packageOutputRoot(options: CatalogCommandOptions): URL {
  return options.output_root ?? new URL("../../../", options.root);
}

export async function lockCommand(
  options: CatalogCommandOptions,
): Promise<RuntimeResult<CatalogCommandReport>> {
  const schemas = prepareCatalogCommandSchemas();
  if (!schemas.ok) return schemas;
  if (options.release === undefined) {
    return failure(
      "CATALOG_RELEASE_REQUIRED",
      "catalog lock verification requires --release",
      "--release",
    );
  }
  const built = await buildCatalogRelease({
    sourceRoot: options.root,
    outputRoot: packageOutputRoot(options),
    release: options.release,
    checkClean: true,
  });
  if (!built.ok) return built;
  const verified = await verifyCatalogRelease(
    built.value.artifacts.root,
    built.value.lock,
    options.root,
  );
  if (!verified.ok) return verified;
  return success({
    command: "lock",
    valid: verified.value.valid,
    counts: {
      source_entries: built.value.lock.source_entries.length,
      generated_entries: built.value.lock.generated_entries.length,
      checked_paths: verified.value.checked_paths.length,
      invalid: 0,
    },
    checked_ids: verified.value.checked_paths,
    details: {
      release: verified.value.release,
      release_hash: verified.value.release_hash,
      check: options.check ?? false,
    },
  });
}