import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import { bundleCommand } from "./bundle-command.js";
import { fixturesCommand } from "./fixtures-command.js";
import { inventoryCommand } from "./inventory-command.js";
import { lockCommand } from "./lock-command.js";
import type {
  CatalogCommandOptions,
  CatalogCommandReport,
} from "./types.js";
import { validateCatalogCommand } from "./validate-catalog-command.js";

export const BUILD_COMMANDS = {
  validate: validateCatalogCommand,
  inventory: inventoryCommand,
  fixtures: fixturesCommand,
  lock: lockCommand,
  bundle: bundleCommand,
} as const;

export type BuildCommandName = keyof typeof BUILD_COMMANDS;
type MutableOptions = {
  -readonly [Key in keyof CatalogCommandOptions]: CatalogCommandOptions[Key];
};

export interface ParsedBuildCommand {
  readonly command: BuildCommandName;
  readonly options: CatalogCommandOptions;
}

const BOOLEAN_FLAGS = {
  "--strict": "strict",
  "--check": "check",
  "--schema-only": "schema_only",
  "--taxonomy-only": "taxonomy_only",
  "--integrated": "integrated",
  "--check-clean": "check_clean",
} as const;

const VALUE_FLAGS = {
  "--scope": "scope",
  "--suite": "suite",
  "--release": "release",
} as const;

export function parseBuildToolArguments(
  arguments_: readonly string[],
  root: URL,
): RuntimeResult<ParsedBuildCommand> {
  const [rawCommand, ...flags] = arguments_;
  if (rawCommand === undefined || !(rawCommand in BUILD_COMMANDS)) {
    return failure(
      "CATALOG_COMMAND_UNKNOWN",
      "command must be validate, inventory, fixtures, lock, or bundle",
      rawCommand ?? "",
    );
  }
  const command = rawCommand as BuildCommandName;
  const options: MutableOptions = { root };
  const seen = new Set<string>();
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === undefined || seen.has(flag)) {
      return failure(
        "CATALOG_COMMAND_FLAG_DUPLICATE",
        `duplicate flag ${flag ?? "missing"}`,
        flag ?? "",
      );
    }
    seen.add(flag);
    if (flag in BOOLEAN_FLAGS) {
      const key = BOOLEAN_FLAGS[flag as keyof typeof BOOLEAN_FLAGS];
      options[key] = true;
      continue;
    }
    if (flag in VALUE_FLAGS) {
      const value = flags[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return failure(
          "CATALOG_COMMAND_FLAG_VALUE_MISSING",
          `flag ${flag} requires one value`,
          flag,
        );
      }
      const key = VALUE_FLAGS[flag as keyof typeof VALUE_FLAGS];
      options[key] = value;
      index += 1;
      continue;
    }
    return failure(
      "CATALOG_COMMAND_FLAG_UNKNOWN",
      `unknown flag ${flag}`,
      flag,
    );
  }
  return success({ command, options });
}

function outputResult(result: RuntimeResult<CatalogCommandReport>): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

async function main(): Promise<void> {
  const root = pathToFileURL(
    `${path.join(process.cwd(), "catalog", "project-memory", "v1")}${path.sep}`,
  );
  const parsed = parseBuildToolArguments(process.argv.slice(2), root);
  if (!parsed.ok) {
    outputResult(parsed);
    return;
  }
  try {
    const handler = BUILD_COMMANDS[parsed.value.command];
    outputResult(await handler(parsed.value.options));
  } catch (error: unknown) {
    outputResult(
      failure(
        "CATALOG_COMMAND_FAILED",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(entryPath)).href
) {
  await main();
}
