import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";

export interface ParsedInvocation {
  readonly command_path: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly positionals: readonly string[];
}

const VALUE_FLAGS = new Set([
  "root",
  "input",
  "output",
  "brief",
  "catalog",
  "agent-adapter",
  "adapter",
  "target-ref",
  "plan",
  "approval",
  "expected-plan-hash",
  "expected-head",
]);
const BOOLEAN_FLAGS = new Set(["json", "dry-run", "help", "version"]);

function splitFlag(argument: string): {
  readonly name: string;
  readonly inline_value: string | undefined;
} {
  const separator = argument.indexOf("=");
  if (separator === -1) {
    return { name: argument.slice(2), inline_value: undefined };
  }
  return {
    name: argument.slice(2, separator),
    inline_value: argument.slice(separator + 1),
  };
}

function matchingCommandPath(
  operands: readonly string[],
  commandPaths: readonly (readonly string[])[],
): readonly string[] | undefined {
  return commandPaths
    .filter((candidate) =>
      candidate.every((segment, index) => operands[index] === segment),
    )
    .toSorted((left, right) => right.length - left.length)[0];
}

export function parseCliArguments(
  arguments_: readonly string[],
  commandPaths: readonly (readonly string[])[] = [],
): RuntimeResult<ParsedInvocation> {
  const flags: Record<string, string | boolean> = {};
  const seen = new Set<string>();
  const operands: string[] = [];
  let positionalOnly = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) continue;
    if (positionalOnly) {
      operands.push(argument);
      continue;
    }
    if (argument === "--") {
      positionalOnly = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      operands.push(argument);
      continue;
    }

    const { name, inline_value: inlineValue } = splitFlag(argument);
    if (!VALUE_FLAGS.has(name) && !BOOLEAN_FLAGS.has(name)) {
      return failure("CLI_FLAG_UNKNOWN", `unknown flag --${name}`, argument);
    }
    if (seen.has(name)) {
      return failure("CLI_FLAG_DUPLICATE", `duplicate flag --${name}`, argument);
    }
    seen.add(name);

    if (BOOLEAN_FLAGS.has(name)) {
      if (inlineValue !== undefined) {
        return failure(
          "CLI_FLAG_VALUE_FORBIDDEN",
          `flag --${name} does not accept a value`,
          argument,
        );
      }
      flags[name] = true;
      continue;
    }

    const value = inlineValue ?? arguments_[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      return failure(
        "CLI_FLAG_VALUE_MISSING",
        `flag --${name} requires one value`,
        argument,
      );
    }
    flags[name] = value;
    if (inlineValue === undefined) index += 1;
  }

  const matched = matchingCommandPath(operands, commandPaths);
  const commandPath = matched ?? (operands.length === 0 ? [] : operands.slice(0, 1));
  return success({
    command_path: commandPath,
    flags,
    positionals: operands.slice(commandPath.length),
  });
}
