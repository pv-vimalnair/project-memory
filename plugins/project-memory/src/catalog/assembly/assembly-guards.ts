import { failure, type RuntimeResult } from "../../contracts/runtime-result.js";

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function guardHalfFields(
  core: object,
  taxonomy: object,
  allowedCore: ReadonlySet<string>,
  allowedTaxonomy: ReadonlySet<string>,
  path: string,
): RuntimeResult<true> | undefined {
  const invalid = [
    ...Object.keys(core).filter((key) => !allowedCore.has(key)),
    ...Object.keys(taxonomy).filter((key) => !allowedTaxonomy.has(key)),
    ...Object.keys(core).filter((key) => Object.hasOwn(taxonomy, key)),
  ];
  const unique = [...new Set(invalid)].sort(compareUtf8);
  if (unique.length === 0) return undefined;
  return failure(
    "CATALOG_HALF_FIELD_OVERLAP",
    `core and taxonomy ownership is violated by: ${unique.join(",")}`,
    path,
    unique,
  );
}
