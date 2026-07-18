#!/usr/bin/env node
// @ts-check
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const releaseEntry = fileURLToPath(new URL("../dist/project-memory.mjs", import.meta.url));
const developmentEntry = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const entry = existsSync(releaseEntry)
  ? releaseEntry
  : existsSync(developmentEntry)
    ? developmentEntry
    : null;

if (entry === null) {
  process.stderr.write("Project Memory engine bundle is missing. Reinstall the Plugin.\n");
  process.exitCode = 1;
} else {
  const child = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  if (child.error !== undefined) {
    process.stderr.write("Project Memory engine failed to start. Reinstall the Plugin.\n");
  }
  process.exitCode = child.error === undefined ? (child.status ?? 1) : 1;
}
