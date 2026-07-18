import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import { PROJECT_SCHEMA_REGISTRARS } from "./project-registrars.js";
import {
  getRegisteredSchemas,
  registerProjectSchemas,
} from "./registry.js";

const SCHEMA_PREFIX = "project-memory/v1/";

export async function emitJsonSchemas(
  outputRoot: URL,
): Promise<RuntimeResult<readonly URL[]>> {
  if (outputRoot.protocol !== "file:") {
    return failure("SCHEMA_EMIT_ROOT_INVALID", "schema output root must be a file URL");
  }
  try {
    await mkdir(outputRoot, { recursive: true });
    const emitted: URL[] = [];
    const indexEntries: { id: string; path: string; sha256: string }[] = [];
    for (const schema of getRegisteredSchemas()) {
      const plainSchema = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
      const document = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        ...plainSchema,
      };
      const bytes = canonicalJson(document);
      const fileName = `${schema.$id.slice(SCHEMA_PREFIX.length)}.schema.json`;
      const file = pathToFileURL(path.join(fileURLToPath(outputRoot), fileName));
      await writeFile(file, bytes, "utf8");
      emitted.push(file);
      indexEntries.push({ id: schema.$id, path: fileName, sha256: sha256(bytes) });
    }
    await writeFile(
      pathToFileURL(path.join(fileURLToPath(outputRoot), "schema-index.json")),
      canonicalJson({ schema_version: "1.0.0", schemas: indexEntries }),
      "utf8",
    );
    return success(emitted);
  } catch (error: unknown) {
    return failure(
      "SCHEMA_EMIT_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function formatFailure(result: { readonly issues: readonly { readonly code: string; readonly message: string }[] }): string {
  return result.issues.map((entry) => `${entry.code}: ${entry.message}`).join("\n");
}

async function main(): Promise<void> {
  const registration = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registration.ok) throw new Error(formatFailure(registration));
  const output = pathToFileURL(
    `${path.join(process.cwd(), "schemas", "project-memory", "v1")}${path.sep}`,
  );
  const emitted = await emitJsonSchemas(output);
  if (!emitted.ok) throw new Error(formatFailure(emitted));
}

const entryPath = process.argv[1];
const modulePath = fileURLToPath(import.meta.url);
const isSchemaEmitterModule =
  path.basename(path.dirname(modulePath)) === "schema" &&
  /^emit[.](?:js|ts)$/.test(path.basename(modulePath));
if (
  entryPath !== undefined &&
  isSchemaEmitterModule &&
  import.meta.url === pathToFileURL(path.resolve(entryPath)).href
) {
  await main();
}
