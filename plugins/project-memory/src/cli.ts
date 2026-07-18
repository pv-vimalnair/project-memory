#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createNodeCommandRegistry } from "./cli/node-composition.js";
import { executeCli } from "./cli/main.js";
import { exitCodeForIssues } from "./cli/exit-codes.js";
import { envelopeFromResult, renderCliOutput } from "./cli/output.js";
import { PROJECT_SCHEMA_REGISTRARS } from "./schema/project-registrars.js";
import { registerProjectSchemas } from "./schema/registry.js";

const currentDirectory = pathToFileURL(`${path.resolve(process.cwd())}${path.sep}`);
const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
const execution = registered.ok
  ? await executeCli(process.argv.slice(2), {
      registry: createNodeCommandRegistry(currentDirectory),
      current_directory: currentDirectory,
    })
  : (() => {
      const envelope = envelopeFromResult("startup", registered);
      const rendered = renderCliOutput(envelope, process.argv.includes("--json"));
      return {
        exit_code: exitCodeForIssues(registered.issues),
        envelope,
        ...rendered,
      };
    })();

process.stdout.write(execution.stdout);
process.stderr.write(execution.stderr);
process.exitCode = execution.exit_code;
