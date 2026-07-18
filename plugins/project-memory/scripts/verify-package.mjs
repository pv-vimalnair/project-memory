#!/usr/bin/env node
// @ts-check
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

import { loadBenchmarkCases, runCatalogBenchmark } from "../dist/benchmark/run-benchmark.js";
import { buildPluginAgentReport, renderBenchmarkReport } from "../dist/benchmark/report.js";
import { loadCatalog } from "../dist/catalog/load-catalog.js";
import { buildCatalogRelease } from "../dist/catalog/manifest/build-catalog-bundle.js";
import { canonicalJson } from "../dist/core/canonical-json.js";
import { sha256 } from "../dist/core/hash.js";
import { buildLogicalManifest, validatePackageContents } from "../dist/release/package-contents.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../dist/schema/project-registrars.js";
import { registerProjectSchemas } from "../dist/schema/registry.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = path.resolve(packageRoot, "..", "..");

/** @param {readonly string[]} args */
function outputArgument(args) {
  const value = args.length === 0
    ? ".tmp/release-candidate"
    : args.length === 2 && args[0] === "--output"
      ? args[1]
      : null;
  if (value === null || value === undefined || !/^\.tmp\/[a-zA-Z0-9._/-]+$/.test(value)) {
    throw new TypeError("usage: verify-package.mjs [--output .tmp/<directory>]");
  }
  const resolved = path.resolve(packageRoot, value);
  const relative = path.relative(path.join(packageRoot, ".tmp"), resolved);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError("release output must be a child of the package .tmp directory");
  }
  return resolved;
}

/** @returns {Promise<string>} */
async function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((value) => value !== undefined);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next deterministic npm installation location.
    }
  }
  throw new Error("npm JavaScript entrypoint was not found");
}

/** @param {unknown} value */
function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/** @param {string} text */
function parsePackResult(text) {
  const parsed = /** @type {unknown} */ (JSON.parse(text));
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error("npm pack returned an invalid result");
  const item = object(parsed[0]);
  if (item === null || typeof item.filename !== "string" || !Array.isArray(item.files)) {
    throw new Error("npm pack result is missing filename or files");
  }
  /** @type {string[]} */
  const files = [];
  for (const value of item.files) {
    const entry = object(value);
    if (entry === null || typeof entry.path !== "string") throw new Error("npm pack file entry is invalid");
    files.push(`package/${entry.path}`);
  }
  return { filename: item.filename, files };
}

/** @param {string} root */
async function fileInventory(root) {
  /** @type {string[]} */
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`release output contains symlink: ${target}`);
      if (entry.isDirectory()) pending.push(target);
      if (entry.isFile()) files.push(path.relative(root, target).replaceAll(path.sep, "/"));
    }
  }
  return files.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

const outputRoot = outputArgument(process.argv.slice(2));
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const npmCli = await npmCliPath();
const packed = spawnSync(process.execPath, [
  npmCli,
  "pack",
  "--json",
  "--ignore-scripts",
  "--pack-destination",
  outputRoot,
], {
  cwd: packageRoot,
  encoding: "utf8",
  shell: false,
  env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
  maxBuffer: 32 * 1024 * 1024,
});
if (packed.error !== undefined) throw packed.error;
if (packed.status !== 0) throw new Error(packed.stderr || `npm pack exited with ${String(packed.status)}`);
const packResult = parsePackResult(packed.stdout);
const packageContents = validatePackageContents(packResult.files);
if (!packageContents.ok) throw new Error(JSON.stringify(packageContents.issues));

const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
const catalogRoot = new URL("../catalog/project-memory/v1/", import.meta.url);
const releaseRoot = path.join(outputRoot, "release-artifacts");
await mkdir(releaseRoot, { recursive: true });
const catalogRelease = await buildCatalogRelease({
  sourceRoot: catalogRoot,
  outputRoot: pathToFileURL(`${releaseRoot}${path.sep}`),
  release: "1.0.0",
});
if (!catalogRelease.ok) throw new Error(JSON.stringify(catalogRelease.issues));

const catalog = await loadCatalog(catalogRoot);
if (!catalog.ok) throw new Error(JSON.stringify(catalog.issues));
const cases = await loadBenchmarkCases(new URL("../benchmarks/briefs/", import.meta.url));
if (!cases.ok) throw new Error(JSON.stringify(cases.issues));
const benchmark = runCatalogBenchmark(catalog.value, cases.value);
if (!benchmark.ok) throw new Error(JSON.stringify(benchmark.issues));
if (!benchmark.value.deterministic_gate_passed) throw new Error("deterministic benchmark gate failed");
const trialEvidenceValue = /** @type {unknown} */ (JSON.parse(await readFile(
  path.join(repositoryRoot, "docs", "publication", "LOWER_REASONING_TRIAL_EVIDENCE.json"),
  "utf8",
)));
const trialEvidence = object(trialEvidenceValue);
if (trialEvidence?.schema_version !== "1.0.0" || !Array.isArray(trialEvidence.trials)) {
  throw new Error("lower-reasoning trial evidence is invalid");
}
const pluginAgentReport = buildPluginAgentReport(trialEvidence.trials);
if (!pluginAgentReport.accepted || !isDeepStrictEqual(trialEvidence.report, pluginAgentReport)) {
  throw new Error("lower-reasoning trial report is not accepted or reproducible");
}
const benchmarkReport = {
  ...benchmark.value,
  lower_reasoning_trials: {
    required_runs: 2,
    required_supported_briefs_per_run: 30,
    recorded_runs: pluginAgentReport.recorded_runs,
    qualifying_runs: pluginAgentReport.qualifying_runs,
    accepted: pluginAgentReport.accepted,
    issues: pluginAgentReport.issues,
  },
  v1_accepted: true,
};
await writeFile(
  path.join(outputRoot, "benchmark-report.json"),
  renderBenchmarkReport(benchmarkReport),
  "utf8",
);

const schemaRoot = path.join(packageRoot, "schemas", "project-memory", "v1");
const schemaFiles = (await fileInventory(schemaRoot)).filter((value) => value.endsWith(".json"));
const schemaDocuments = [];
for (const relative of schemaFiles) {
  schemaDocuments.push({
    path: relative,
    document: /** @type {unknown} */ (JSON.parse(await readFile(path.join(schemaRoot, relative), "utf8"))),
  });
}
await writeFile(
  path.join(outputRoot, "schemas.bundle.json"),
  canonicalJson({ schema_version: "1.0.0", schemas: schemaDocuments }),
  "utf8",
);
await copyFile(
  path.join(schemaRoot, "schema-index.json"),
  path.join(outputRoot, "schema-index.json"),
);

const tarballPath = path.join(outputRoot, packResult.filename);
const tarballBytes = await readFile(tarballPath);
const tarballHash = sha256(tarballBytes);
await writeFile(
  path.join(outputRoot, `${packResult.filename}.sha256`),
  `${tarballHash}  ${packResult.filename}\n`,
  "utf8",
);
await writeFile(
  path.join(outputRoot, "test-evidence.json"),
  canonicalJson({
    schema_version: "1.0.0",
    unsigned: true,
    checks: [
      { id: "package-content", status: "passed", file_count: packageContents.value.file_count },
      { id: "catalog-bundle", status: "passed", release: "1.0.0" },
      { id: "schema-bundle", status: "passed", schema_count: schemaFiles.length },
      { id: "deterministic-benchmark", status: "passed", supported_case_count: cases.value.length },
      {
        id: "lower-reasoning-trials",
        status: "passed",
        recorded_runs: pluginAgentReport.recorded_runs,
        qualifying_runs: pluginAgentReport.qualifying_runs,
      },
    ],
  }),
  "utf8",
);

const manifestEntries = [];
for (const relative of await fileInventory(outputRoot)) {
  if (relative === "logical-manifest.json") continue;
  const bytes = await readFile(path.join(outputRoot, relative));
  manifestEntries.push({ path: relative, length: bytes.length, sha256: sha256(bytes) });
}
const logicalManifest = buildLogicalManifest(manifestEntries);
const logicalManifestBytes = canonicalJson(logicalManifest);
await writeFile(path.join(outputRoot, "logical-manifest.json"), logicalManifestBytes, "utf8");

process.stdout.write(canonicalJson({
  schema_version: "1.0.0",
  valid: true,
  unsigned: true,
  package_file: packResult.filename,
  package_sha256: tarballHash,
  logical_manifest_sha256: sha256(logicalManifestBytes),
  artifact_count: logicalManifest.entries.length + 1,
  v1_accepted: benchmarkReport.v1_accepted,
}));
