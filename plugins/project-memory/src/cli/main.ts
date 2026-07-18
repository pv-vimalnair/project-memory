import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type { CommandRegistry } from "./command-registry.js";
import { exitCodeForIssues, type CliExitCode } from "./exit-codes.js";
import {
  envelopeFromResult,
  renderCliOutput,
  type CliEnvelope,
} from "./output.js";
import { PACKAGE_VERSION } from "../version.js";
import { parseCliArguments } from "./parse-args.js";

export interface ExecuteCliOptions {
  readonly registry: CommandRegistry;
  readonly current_directory?: URL;
  readonly record_debug_evidence?: (evidence: string) => void;
}

export interface CliExecution {
  readonly exit_code: CliExitCode;
  readonly envelope: CliEnvelope<unknown>;
  readonly stdout: string;
  readonly stderr: string;
}

interface HelpData {
  readonly usage: string;
  readonly commands: readonly string[];
}

function helpResult(registry: CommandRegistry): RuntimeResult<HelpData> {
  return success({
    usage: "Usage: project-memory <command> [options]",
    commands: registry.paths().map((path) => path.join(" ")),
  });
}

function commandLabel(arguments_: readonly string[]): string {
  return arguments_.find((argument) => !argument.startsWith("--")) ?? "";
}

export async function executeCli(
  arguments_: readonly string[],
  options: ExecuteCliOptions,
): Promise<CliExecution> {
  const parsed = parseCliArguments(arguments_, options.registry.paths());
  let command = commandLabel(arguments_);
  let result: RuntimeResult<unknown>;
  let json = arguments_.includes("--json");

  if (!parsed.ok) {
    result = parsed;
  } else {
    command = parsed.value.command_path.join(" ");
    json = parsed.value.flags.json === true;
    if (parsed.value.flags.version === true) {
      command = "version";
      result = success(PACKAGE_VERSION);
    } else if (parsed.value.flags.help === true || parsed.value.command_path.length === 0) {
      command = command || "help";
      result = helpResult(options.registry);
    } else {
      const handler = options.registry.resolve(parsed.value.command_path);
      if (handler === undefined) {
        result = failure(
          "CLI_COMMAND_UNKNOWN",
          `unknown command ${parsed.value.command_path.join(" ")}`,
          parsed.value.command_path.join(" "),
        );
      } else {
        try {
          result = await handler.run(
            { current_directory: options.current_directory ?? new URL("file:///") },
            parsed.value,
          );
        } catch (error: unknown) {
          try {
            options.record_debug_evidence?.(
              error instanceof Error ? (error.stack ?? error.message) : String(error),
            );
          } catch {
            // Debug evidence must never change the stable CLI result.
          }
          result = failure("CLI_UNEXPECTED", "Unexpected internal error");
        }
      }
    }
  }

  const envelope = envelopeFromResult(command, result);
  const rendered = command === "version" && result.ok && result.value === PACKAGE_VERSION && !json
    ? { stdout: `${PACKAGE_VERSION}\n`, stderr: "" }
    : renderCliOutput(envelope, json);
  return {
    exit_code: result.ok ? 0 : exitCodeForIssues(result.issues),
    envelope,
    ...rendered,
  };
}
