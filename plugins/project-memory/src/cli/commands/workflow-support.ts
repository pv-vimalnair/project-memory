import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { CanonicalMutationPlan } from "../../contracts/canonical-mutation-plan.js";
import {
  failure,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import {
  decodeStrictUtf8,
  parseJsonDocument,
} from "../../core/document-io.js";
import type { MutationReceipt } from "../../governance/integration/canonical-mutation-finalizer.js";
import type { IntegrationCoordinator } from "../../governance/integration/integration-coordinator.js";
import type {
  CliCommand,
  CliContext,
} from "../command-registry.js";
import type { ParsedInvocation } from "../parse-args.js";

export type CommandInputReader = (
  context: CliContext,
  invocation: ParsedInvocation,
) => Promise<RuntimeResult<unknown>>;

export type ReadOperation = (input: unknown) => Promise<RuntimeResult<unknown>>;
export type MutationPlanner = (
  input: unknown,
) => Promise<RuntimeResult<CanonicalMutationPlan<unknown>>>;

export interface GovernedCommandDependencies {
  readonly coordinator: Pick<IntegrationCoordinator, "finalizeMutation">;
  readonly read_input?: CommandInputReader;
}

function inputUrl(value: string, currentDirectory: URL): RuntimeResult<URL> {
  if (currentDirectory.protocol !== "file:") {
    return failure("CLI_PATH_INVALID", "command inputs require a file URL base");
  }
  try {
    return value.startsWith("file:")
      ? { ok: true, value: new URL(value), warnings: [] }
      : {
          ok: true,
          value: pathToFileURL(path.resolve(fileURLToPath(currentDirectory), value)),
          warnings: [],
        };
  } catch (error: unknown) {
    return failure("CLI_PATH_INVALID", error instanceof Error ? error.message : String(error), value);
  }
}

function reviveUrls(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => reviveUrls(item));
  if (typeof value !== "object" || value === null) {
    if (
      typeof value === "string" && value.startsWith("file:") &&
      (key === "root" || key.endsWith("_root") || key === "repo")
    ) {
      return new URL(value);
    }
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [name, reviveUrls(item, name)]),
  );
}

export async function readJsonCommandInput(
  context: CliContext,
  invocation: ParsedInvocation,
): Promise<RuntimeResult<unknown>> {
  const input = invocation.flags.input;
  if (typeof input !== "string") {
    return failure("CLI_FLAG_REQUIRED", "--input is required", "input");
  }
  const target = inputUrl(input, context.current_directory);
  if (!target.ok) return target;
  try {
    const stat = await lstat(target.value);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure("CLI_INPUT_UNSAFE", "command input must be a regular file", input);
    }
    const decoded = decodeStrictUtf8(new Uint8Array(await readFile(target.value)), input);
    if (!decoded.ok) return decoded;
    const parsed = parseJsonDocument(decoded.value, input);
    return parsed.ok
      ? { ...parsed, value: reviveUrls(parsed.value) }
      : parsed;
  } catch (error: unknown) {
    return failure("CLI_INPUT_READ_FAILED", error instanceof Error ? error.message : String(error), input);
  }
}

function requiredExpectedFlag(
  invocation: ParsedInvocation,
  name: "expected-plan-hash" | "expected-head",
): RuntimeResult<string> {
  const value = invocation.flags[name];
  return typeof value === "string"
    ? { ok: true, value, warnings: [] }
    : failure("CLI_FLAG_REQUIRED", `--${name} is required`, name);
}

export function createPlanApplyCommands(
  path: readonly string[],
  planner: MutationPlanner,
  dependencies: GovernedCommandDependencies,
): readonly CliCommand[] {
  const readInput = dependencies.read_input ?? readJsonCommandInput;
  const plan: CliCommand<CanonicalMutationPlan<unknown>> = {
    path: [...path, "plan"],
    mutates: false,
    async run(context, invocation) {
      const input = await readInput(context, invocation);
      return input.ok ? planner(input.value) : input;
    },
  };
  const apply: CliCommand<MutationReceipt> = {
    path: [...path, "apply"],
    mutates: true,
    async run(context, invocation) {
      const expectedHash = requiredExpectedFlag(invocation, "expected-plan-hash");
      if (!expectedHash.ok) return expectedHash;
      const expectedHead = requiredExpectedFlag(invocation, "expected-head");
      if (!expectedHead.ok) return expectedHead;
      const input = await readInput(context, invocation);
      if (!input.ok) return input;
      const replanned = await planner(input.value);
      if (!replanned.ok) return replanned;
      if (replanned.value.plan_hash !== expectedHash.value) {
        return failure(
          "CLI_PLAN_HASH_MISMATCH",
          "fresh mutation plan differs from the reviewed plan",
          replanned.value.plan_id,
        );
      }
      if (replanned.value.expected_head !== expectedHead.value) {
        return failure(
          "CLI_HEAD_DRIFT",
          "fresh mutation plan is not bound to the expected repository HEAD",
          replanned.value.target_ref,
        );
      }
      return dependencies.coordinator.finalizeMutation(replanned.value);
    },
  };
  return [plan, apply];
}

export function createReadCommand(
  path: readonly string[],
  operation: ReadOperation,
  readInput: CommandInputReader = readJsonCommandInput,
): CliCommand {
  return {
    path,
    mutates: false,
    async run(context, invocation) {
      const input = await readInput(context, invocation);
      return input.ok ? operation(input.value) : input;
    },
  };
}

export function unavailableOperation(name: string): ReadOperation {
  return () => Promise.resolve(failure(
    "CLI_RUNTIME_REQUIRED",
    `${name} requires the host runtime to provide its project service`,
  ));
}
