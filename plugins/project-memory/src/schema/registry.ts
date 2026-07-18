import { Type, type TSchema } from "@sinclair/typebox";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { registerProjectFormats } from "./formats.js";

export type SchemaId = `project-memory/v1/${string}`;
export type VersionedSchema = TSchema & { readonly $id: SchemaId };
export type SchemaRegistrar = () => readonly SchemaId[];

function createAjv(): Ajv2020 {
  const instance = new Ajv2020({
    allErrors: true,
    strict: true,
    removeAdditional: false,
    coerceTypes: false,
    useDefaults: false,
  });
  registerProjectFormats(instance);
  return instance;
}

let ajv = createAjv();
const schemas = new Map<SchemaId, VersionedSchema>();

function isSchemaId(value: string): value is SchemaId {
  return /^project-memory\/v1\/[a-z][a-z0-9-]*$/.test(value);
}

export function registerSchema<T extends TSchema>(schema: T): T {
  const rawId = schema.$id;
  if (typeof rawId !== "string" || !isSchemaId(rawId)) {
    throw new Error(`invalid schema id: ${String(rawId)}`);
  }
  const id = rawId;
  if (schemas.has(id)) {
    throw new Error(`duplicate schema id: ${id}`);
  }
  ajv.addSchema(schema, id);
  schemas.set(id, schema as T & { readonly $id: SchemaId });
  return schema;
}

export function getSchemaValidator(id: SchemaId): ValidateFunction | undefined {
  return ajv.getSchema(id);
}

export function getRegisteredSchemas(): readonly VersionedSchema[] {
  return [...schemas.values()].sort((left, right) =>
    left.$id < right.$id ? -1 : left.$id > right.$id ? 1 : 0,
  );
}

export function registerProjectSchemas(
  registrars: readonly SchemaRegistrar[],
): RuntimeResult<readonly SchemaId[]> {
  const ids = new Set<SchemaId>();
  const ordered = [...registrars].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  try {
    for (const registrar of ordered) {
      const registered = registrar();
      for (const id of registered) {
        if (ids.has(id)) {
          return failure(
            "SCHEMA_REGISTRAR_DUPLICATE_ID",
            `multiple registrars returned schema id ${id}`,
            id,
          );
        }
        if (!schemas.has(id)) {
          return failure(
            "SCHEMA_REGISTRAR_MISSING_SCHEMA",
            `registrar returned an unregistered schema id ${id}`,
            id,
          );
        }
        ids.add(id);
      }
    }
    return success([...ids].sort());
  } catch (error: unknown) {
    return failure(
      "SCHEMA_REGISTRATION_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function resetSchemaRegistryForTests(): void {
  schemas.clear();
  ajv = createAjv();
}

export const SCHEMA_ID_SCHEMA = Type.String({
  pattern: "^project-memory/v1/[a-z][a-z0-9-]*$",
});
