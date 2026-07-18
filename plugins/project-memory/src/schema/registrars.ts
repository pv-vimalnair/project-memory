import { Type } from "@sinclair/typebox";

import { registerSchema, type SchemaId } from "./registry.js";

export const FOUNDATION_SCHEMA_IDS = [
  "project-memory/v1/planned-write",
  "project-memory/v1/root-reference",
  "project-memory/v1/runtime-issue",
] as const satisfies readonly SchemaId[];

export function registerFoundationSchemas(): readonly SchemaId[] {
  registerSchema(Type.Object({
    relative_path: Type.String({ format: "safe-relative-path" }),
    bytes: Type.String(),
    expected_existing_sha256: Type.Union([
      Type.String({ format: "sha256" }),
      Type.Null(),
    ]),
    mode: Type.Union([
      Type.Literal("create"),
      Type.Literal("replace"),
      Type.Literal("create_or_replace"),
    ]),
  }, {
    $id: FOUNDATION_SCHEMA_IDS[0],
    additionalProperties: false,
  }));
  registerSchema(Type.Object({
    id: Type.String({ format: "instance-id" }),
  }, {
    $id: FOUNDATION_SCHEMA_IDS[1],
    additionalProperties: false,
  }));
  registerSchema(Type.Object({
    code: Type.String({ minLength: 1 }),
    severity: Type.Union([
      Type.Literal("error"),
      Type.Literal("review"),
      Type.Literal("warning"),
    ]),
    path: Type.String(),
    message: Type.String({ minLength: 1 }),
    references: Type.Array(Type.String()),
  }, {
    $id: FOUNDATION_SCHEMA_IDS[2],
    additionalProperties: false,
  }));
  return FOUNDATION_SCHEMA_IDS;
}
