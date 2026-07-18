#!/usr/bin/env node
// @ts-check
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import { build } from "esbuild";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

/** @param {readonly string[]} args */
function outputArgument(args) {
  if (args.length === 0) return null;
  const value = args.length === 2 && args[0] === "--output" ? args[1] : null;
  if (
    value === null || value === undefined || value.includes(path.win32.sep) ||
    path.isAbsolute(value) || !value.endsWith(".mjs") ||
    !(value.startsWith("dist/") || value.startsWith(".tmp/"))
  ) {
    throw new TypeError("usage: build-plugin-bundle.mjs [--output <dist|.tmp>/<name>.mjs]");
  }
  const output = path.resolve(packageRoot, value);
  const relative = path.relative(packageRoot, output);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new TypeError("bundle output must remain inside the package root");
  }
  return output;
}

/** @param {string} output */
function relativeOutput(output) {
  return path.relative(packageRoot, output).replaceAll(path.sep, "/");
}

/** @param {string} entrypoint @param {string} outfile */
async function buildTarget(entrypoint, outfile) {
  await mkdir(path.dirname(outfile), { recursive: true });
  await build({
    absWorkingDir: packageRoot,
    entryPoints: [entrypoint],
    outfile,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    banner: {
      js: 'import { createRequire as __projectMemoryCreateRequire } from "node:module"; const require = __projectMemoryCreateRequire(import.meta.url);',
    },
    sourcemap: false,
    legalComments: "none",
    charset: "utf8",
    logLevel: "warning",
    treeShaking: true,
  });

  const bytes = await readFile(outfile);
  const digest = createHash("sha256").update(bytes).digest("hex");
  await writeFile(outfile + ".sha256", digest + "\n", "utf8");
  return {
    output: relativeOutput(outfile),
    bytes: bytes.length,
    sha256: digest,
  };
}

const explicitOutput = outputArgument(process.argv.slice(2));
const targets = explicitOutput === null
  ? [
      {
        entrypoint: "src/mcp.ts",
        outfile: path.resolve(packageRoot, "dist/project-memory-mcp.mjs"),
      },
      {
        entrypoint: "src/cli.ts",
        outfile: path.resolve(packageRoot, "dist/project-memory.mjs"),
      },
    ]
  : [{ entrypoint: "src/cli.ts", outfile: explicitOutput }];

const reports = [];
for (const target of targets.toSorted((left, right) =>
  Buffer.compare(
    Buffer.from(relativeOutput(left.outfile), "utf8"),
    Buffer.from(relativeOutput(right.outfile), "utf8"),
  ))) {
  reports.push(await buildTarget(target.entrypoint, target.outfile));
}
for (const report of reports) {
  process.stdout.write(JSON.stringify(report) + "\n");
}
