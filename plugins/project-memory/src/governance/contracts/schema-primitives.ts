import { Type, type TSchema } from "@sinclair/typebox";

import { INSTANCE_PREFIXES } from "../../contracts/ids.js";
import type { SchemaId } from "../../schema/registry.js";

export const TextSchema = Type.String({ minLength: 1, pattern: "\\S" });
export const TextListSchema = Type.Array(TextSchema, { uniqueItems: true });
export const TimestampSchema = Type.String({ format: "utc-timestamp" });
export const SemVerSchema = Type.String({ format: "semantic-version" });
export const Sha256Schema = Type.String({ format: "sha256" });
export const RevisionSchema = Type.String({ pattern: "^[0-9a-f]{40}$" });
export const SafeRelativePathSchema = Type.String({
  format: "safe-relative-path",
  minLength: 1,
});
export const AuthorityClassSchema = Type.Union([
  Type.Literal("worker"),
  Type.Literal("validator"),
  Type.Literal("integrator"),
  Type.Literal("pitaji"),
]);
export const HashMapSchema = Type.Record(TextSchema, Sha256Schema);

export function instanceId(...prefixes: readonly string[]) {
  const values = prefixes.length === 0 ? INSTANCE_PREFIXES : prefixes;
  return Type.String({
    pattern: `^(?:${values.join("|")})-[0-9A-HJKMNP-TV-Z]{26}$`,
  });
}

export function governanceSchema<
  const TId extends SchemaId,
  T extends TSchema,
>(id: TId, schema: T): T & { readonly $id: TId } {
  return Object.assign(schema, { $id: id });
}
