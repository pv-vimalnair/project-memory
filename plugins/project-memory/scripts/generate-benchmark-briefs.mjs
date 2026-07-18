#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import { importCatalogGoldenCases } from "../dist/benchmark/run-benchmark.js";
import { loadCatalog } from "../dist/catalog/load-catalog.js";
import { emitGeneratedYaml } from "../dist/core/document-io.js";
import { registerProjectSchemas } from "../dist/schema/index.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../dist/schema/project-registrars.js";

/** @param {readonly string[]} args */
function outputArgument(args) {
  if (args.length === 0) {
    return fileURLToPath(new URL("../benchmarks/briefs/catalog-golden-cases.yaml", import.meta.url));
  }
  if (args.length !== 2 || args[0] !== "--output" || args[1].length === 0) {
    throw new TypeError("usage: generate-benchmark-briefs.mjs [--output <path>]");
  }
  return path.resolve(process.cwd(), args[1]);
}

const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
const catalog = await loadCatalog(new URL("../catalog/project-memory/v1/", import.meta.url));
if (!catalog.ok) throw new Error(JSON.stringify(catalog.issues));
const emitted = emitGeneratedYaml({
  schema_version: "1.0.0",
  cases: importCatalogGoldenCases(catalog.value),
});
if (!emitted.ok) throw new Error(JSON.stringify(emitted.issues));
const output = outputArgument(process.argv.slice(2));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, emitted.value, "utf8");
