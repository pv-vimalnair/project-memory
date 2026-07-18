import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type {
  CommandResult,
  CommandRunner,
  CommandSpec,
} from "../contracts/command-runner.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";

const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;

function commandSpecIssue(spec: CommandSpec): string | undefined {
  if (spec.executable.trim().length === 0) return "executable must not be empty";
  if (!Number.isInteger(spec.timeout_ms) || spec.timeout_ms <= 0) {
    return "timeout_ms must be a positive integer";
  }
  if (spec.cwd.protocol !== "file:") return "cwd must be a file URL";
  if (
    spec.max_output_bytes !== undefined &&
    (!Number.isInteger(spec.max_output_bytes) || spec.max_output_bytes <= 0)
  ) {
    return "max_output_bytes must be a positive integer";
  }
  return undefined;
}

class BoundedOutput {
  readonly #chunks: Buffer[] = [];
  #length = 0;
  #truncated = false;

  constructor(private readonly maximumBytes: number) {}

  append(value: Buffer | string): void {
    const bytes = typeof value === "string" ? Buffer.from(value) : value;
    const remaining = this.maximumBytes - this.#length;
    if (remaining <= 0) {
      this.#truncated = true;
      return;
    }
    const accepted = bytes.length <= remaining ? bytes : bytes.subarray(0, remaining);
    this.#chunks.push(accepted);
    this.#length += accepted.length;
    if (accepted.length !== bytes.length) this.#truncated = true;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  text(): string {
    return Buffer.concat(this.#chunks, this.#length).toString("utf8");
  }
}

export class NodeCommandRunner implements CommandRunner {
  async run(spec: CommandSpec): Promise<CommandResult> {
    const invalid = commandSpecIssue(spec);
    if (invalid !== undefined) throw new TypeError(invalid);
    const maximum = spec.max_output_bytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    return new Promise<CommandResult>((resolve, reject) => {
      const stdout = new BoundedOutput(maximum);
      const stderr = new BoundedOutput(maximum);
      let timedOut = false;
      let settled = false;
      const child = spawn(spec.executable, [...spec.args], {
        cwd: fileURLToPath(spec.cwd),
        env: { ...spec.env_allowlist },
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout.append(chunk);
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr.append(chunk);
      });
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, spec.timeout_ms);
      timeout.unref();
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({
          exit_code: code,
          signal,
          stdout: stdout.text(),
          stderr: stderr.text(),
          timed_out: timedOut,
          output_truncated: stdout.truncated || stderr.truncated,
        });
      });
    });
  }
}

export async function runCommand(
  spec: CommandSpec,
  runner: CommandRunner = new NodeCommandRunner(),
): Promise<RuntimeResult<CommandResult>> {
  const invalid = commandSpecIssue(spec);
  if (invalid !== undefined) return failure("COMMAND_SPEC_INVALID", invalid);
  try {
    return success(await runner.run(spec));
  } catch (error: unknown) {
    return failure(
      "COMMAND_RUNNER_FAILURE",
      error instanceof Error ? error.message : String(error),
    );
  }
}
