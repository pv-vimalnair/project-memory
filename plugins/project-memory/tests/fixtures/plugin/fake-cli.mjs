#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
process.stdout.write(`${JSON.stringify({
  entry: path.basename(fileURLToPath(import.meta.url)),
  cwd: process.cwd(),
  args,
})}\n`);
if (args[0] === "--exit") {
  const code = Number.parseInt(args[1] ?? "1", 10);
  process.exitCode = Number.isSafeInteger(code) && code >= 0 && code <= 255 ? code : 1;
}
