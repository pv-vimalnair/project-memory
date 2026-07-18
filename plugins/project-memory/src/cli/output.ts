import type {
  RuntimeIssue,
  RuntimeResult,
} from "../contracts/runtime-result.js";

export type CliStatus = "success" | "review_required" | "failed";

export interface CliEnvelope<T> {
  readonly schema_version: "1.0.0";
  readonly command: string;
  readonly status: CliStatus;
  readonly data: T | null;
  readonly issues: readonly RuntimeIssue[];
}

export interface RenderedCliOutput {
  readonly stdout: string;
  readonly stderr: string;
}

export function envelopeFromResult<T>(
  command: string,
  result: RuntimeResult<T>,
): CliEnvelope<T> {
  if (!result.ok) {
    return {
      schema_version: "1.0.0",
      command,
      status: "failed",
      data: null,
      issues: result.issues,
    };
  }
  return {
    schema_version: "1.0.0",
    command,
    status: result.warnings.some((issue) => issue.severity === "review")
      ? "review_required"
      : "success",
    data: result.value,
    issues: result.warnings,
  };
}

function isHelpData(value: unknown): value is {
  readonly usage: string;
  readonly commands: readonly string[];
} {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly usage?: unknown; readonly commands?: unknown };
  return typeof candidate.usage === "string" && Array.isArray(candidate.commands);
}

function cliJson(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_key, item: unknown) => item instanceof Uint8Array
      ? { bytes_base64: Buffer.from(item).toString("base64") }
      : item,
    space,
  );
}

function humanData(data: unknown): string {
  if (data === null || data === undefined) return "";
  if (isHelpData(data)) {
    const commands = data.commands.length === 0
      ? ""
      : `\n\nCommands:\n${data.commands.map((command) => `  ${command}`).join("\n")}`;
    return `${data.usage}${commands}\n`;
  }
  if (typeof data === "string") return `${data}\n`;
  return `${cliJson(data, 2)}\n`;
}

function humanIssue(issue: RuntimeIssue): string {
  const path = issue.path.length === 0 ? "" : ` ${issue.path}`;
  return `${issue.severity.toUpperCase()} ${issue.code}${path}: ${issue.message}\n`;
}

export function renderCliOutput<T>(
  envelope: CliEnvelope<T>,
  json: boolean,
): RenderedCliOutput {
  if (json) {
    return { stdout: `${cliJson(envelope)}\n`, stderr: "" };
  }
  return {
    stdout: `project-memory ${envelope.command || "help"}: ${envelope.status}\n${humanData(envelope.data)}`,
    stderr: envelope.issues.map(humanIssue).join(""),
  };
}
