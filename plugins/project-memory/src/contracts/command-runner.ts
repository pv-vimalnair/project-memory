export interface CommandSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: URL;
  readonly timeout_ms: number;
  readonly env_allowlist: Readonly<Record<string, string>>;
  readonly max_output_bytes?: number;
}

export interface CommandResult {
  readonly exit_code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timed_out: boolean;
  readonly output_truncated: boolean;
}

export interface CommandRunner {
  run(spec: CommandSpec): Promise<CommandResult>;
}
