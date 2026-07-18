import type { ErrorObject } from "ajv/dist/2020.js";

import {
  failure,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { getSchemaValidator, type SchemaId } from "./registry.js";

function issueCode(error: ErrorObject): string {
  if (error.keyword === "additionalProperties") {
    return "SCHEMA_ADDITIONAL_PROPERTY";
  }
  if (error.keyword === "format") return "SCHEMA_FORMAT";
  if (error.keyword === "required") return "SCHEMA_REQUIRED";
  return `SCHEMA_${error.keyword.replaceAll(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
}

function issuePath(error: ErrorObject): string {
  const parameters = error.params as unknown;
  const parameterRecord =
    typeof parameters === "object" && parameters !== null
      ? (parameters as Record<string, unknown>)
      : {};
  if (error.keyword === "additionalProperties") {
    const property = parameterRecord.additionalProperty;
    if (typeof property === "string") return `${error.instancePath}/${property}`;
  }
  if (error.keyword === "required") {
    const property = parameterRecord.missingProperty;
    if (typeof property === "string") return `${error.instancePath}/${property}`;
  }
  return error.instancePath.length > 0 ? error.instancePath : "/";
}

function toIssue(error: ErrorObject): RuntimeIssue {
  return {
    code: issueCode(error),
    severity: "error",
    path: issuePath(error),
    message: error.message ?? "schema validation failed",
    references: [error.schemaPath],
  };
}

export function validateWithSchema<T = unknown>(
  id: SchemaId,
  value: unknown,
): RuntimeResult<T> {
  const validator = getSchemaValidator(id);
  if (validator === undefined) {
    return failure("SCHEMA_UNKNOWN", `schema is not registered: ${id}`, id);
  }
  if (!validator(value)) {
    return {
      ok: false,
      issues: (validator.errors ?? []).map(toIssue),
    };
  }
  return success(value as T);
}
