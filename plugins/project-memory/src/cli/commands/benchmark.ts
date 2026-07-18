import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCatalog } from "../../catalog/load-catalog.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import { decodeStrictUtf8, parseJsonDocument } from "../../core/document-io.js";
import { resolveInside } from "../../core/path-safety.js";
import {
  loadBenchmarkCases,
  renderBenchmarkReport,
  runCatalogBenchmark,
  type BenchmarkReport,
} from "../../benchmark/index.js";
import type { CliCommand } from "../command-registry.js";

function stringFlag(
  flags: Readonly<Record<string, string | boolean>>,
  name: string,
  fallback: string,
): RuntimeResult<string> {
  const value = flags[name] ?? fallback;
  return typeof value === "string"
    ? success(value)
    : failure("CLI_FLAG_VALUE_INVALID", `flag --${name} requires one value`, name);
}

async function readReport(root: URL, relativePath: string): Promise<RuntimeResult<unknown>> {
  const target = await resolveInside(root, relativePath);
  if (!target.ok) return target;
  try {
    const decoded = decodeStrictUtf8(new Uint8Array(await readFile(target.value)), relativePath);
    if (!decoded.ok) return decoded;
    return parseJsonDocument(decoded.value, relativePath);
  } catch (error: unknown) {
    return failure(
      "BENCHMARK_REPORT_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
}

export function createBenchmarkCommands(): readonly CliCommand[] {
  const run: CliCommand<BenchmarkReport> = {
    path: ["benchmark", "run"],
    mutates: false,
    async run(context, invocation) {
      const input = stringFlag(invocation.flags, "input", "benchmarks/briefs");
      if (!input.ok) return input;
      const catalogPath = stringFlag(invocation.flags, "catalog", "catalog/project-memory/v1");
      if (!catalogPath.ok) return catalogPath;
      const inputRoot = await resolveInside(context.current_directory, input.value);
      if (!inputRoot.ok) return inputRoot;
      const catalogRoot = await resolveInside(context.current_directory, catalogPath.value);
      if (!catalogRoot.ok) return catalogRoot;
      const [catalog, cases] = await Promise.all([
        loadCatalog(catalogRoot.value),
        loadBenchmarkCases(inputRoot.value),
      ]);
      if (!catalog.ok) return catalog;
      if (!cases.ok) return cases;
      const report = runCatalogBenchmark(catalog.value, cases.value);
      if (!report.ok) return report;
      const output = invocation.flags.output;
      if (output !== undefined) {
        if (typeof output !== "string") {
          return failure("CLI_FLAG_VALUE_INVALID", "flag --output requires one value", "output");
        }
        const target = await resolveInside(context.current_directory, output);
        if (!target.ok) return target;
        try {
          const targetPath = fileURLToPath(target.value);
          await mkdir(path.dirname(targetPath), { recursive: true });
          await writeFile(targetPath, renderBenchmarkReport(report.value), { encoding: "utf8", flag: "w" });
        } catch (error: unknown) {
          return failure(
            "BENCHMARK_REPORT_WRITE_FAILED",
            error instanceof Error ? error.message : String(error),
            output,
          );
        }
      }
      return report;
    },
  };
  const report: CliCommand = {
    path: ["benchmark", "report"],
    mutates: false,
    async run(context, invocation) {
      const input = stringFlag(invocation.flags, "input", ".tmp/benchmark-report.json");
      return input.ok ? readReport(context.current_directory, input.value) : input;
    },
  };
  return [run, report];
}
