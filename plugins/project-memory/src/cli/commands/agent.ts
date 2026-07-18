import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createNodeAgentStartDependencies,
  startAgentSession,
  type AgentStartDirective,
  type AgentStartInput,
} from "../../agent/index.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import type { CliCommand } from "../command-registry.js";

export interface AgentCommandDependencies {
  readonly start: (
    input: AgentStartInput,
  ) => Promise<RuntimeResult<AgentStartDirective>>;
}

const ALLOWED_FLAGS = new Set(["root", "brief", "adapter", "json", "help"]);

function defaultDependencies(): AgentCommandDependencies {
  const dependencies = createNodeAgentStartDependencies();
  return { start: (input) => startAgentSession(input, dependencies) };
}

function rootUrl(value: string, currentDirectory: URL): RuntimeResult<URL> {
  if (currentDirectory.protocol !== "file:") {
    return failure("CLI_ROOT_INVALID", "current directory must be a file URL");
  }
  try {
    const target = value.startsWith("file:")
      ? fileURLToPath(new URL(value))
      : path.resolve(fileURLToPath(currentDirectory), value);
    return success(pathToFileURL(`${target}${path.sep}`));
  } catch (error: unknown) {
    return failure("CLI_ROOT_INVALID", error instanceof Error ? error.message : String(error), value);
  }
}

export function createAgentCommands(
  dependencies: AgentCommandDependencies = defaultDependencies(),
): readonly CliCommand[] {
  return [{
    path: ["agent", "start"],
    mutates: false,
    async run(context, invocation) {
      const forbiddenFlag = Object.keys(invocation.flags).find((name) => !ALLOWED_FLAGS.has(name));
      if (forbiddenFlag !== undefined) {
        return failure(
          "CLI_FLAG_FORBIDDEN",
          `flag --${forbiddenFlag} is not available for agent start`,
          forbiddenFlag,
        );
      }
      if (invocation.positionals.length > 0) {
        return failure(
          "CLI_POSITIONAL_FORBIDDEN",
          "agent start accepts no positional arguments",
          invocation.positionals[0] ?? "",
        );
      }
      const rawRoot = invocation.flags.root;
      if (typeof rawRoot !== "string") {
        return failure("CLI_FLAG_REQUIRED", "--root is required", "root");
      }
      const root = rootUrl(rawRoot, context.current_directory);
      if (!root.ok) return root;
      const brief = invocation.flags.brief;
      if (brief !== undefined && typeof brief !== "string") {
        return failure("CLI_FLAG_VALUE_INVALID", "--brief requires one value", "brief");
      }
      const adapter = invocation.flags.adapter ?? "adapter.codex";
      if (typeof adapter !== "string") {
        return failure("CLI_FLAG_VALUE_INVALID", "--adapter requires one value", "adapter");
      }
      return dependencies.start({
        root: root.value,
        brief_path: brief ?? null,
        adapter_id: adapter,
      });
    },
  }];
}
