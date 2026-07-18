import type { RuntimeResult } from "../contracts/runtime-result.js";
import type { ParsedInvocation } from "./parse-args.js";
import { createDoctorCommand } from "./commands/doctor.js";
import {
  createInitCommands,
  type InitCommandDependencies,
} from "./commands/init.js";
import { createCatalogCommands } from "./commands/catalog.js";
import { createProfileCommands } from "./commands/profile.js";
import { createSelectCommands } from "./commands/select.js";
import { createInitiativeCommands } from "./commands/initiative.js";
import { createWorkstreamCommands } from "./commands/workstream.js";
import { createTaskCommands } from "./commands/task.js";
import type { LifecycleCommandDependencies } from "./commands/lifecycle-support.js";
import { createClaimCommands } from "./commands/claim.js";
import { createViewsCommands } from "./commands/views.js";
import { createArchiveCommands } from "./commands/archive.js";
import { createIntegrateCommands } from "./commands/integrate.js";
import { createSatelliteCommands } from "./commands/satellite.js";
import { createHubCommands } from "./commands/hub.js";
import { createMigrateCommands } from "./commands/migrate.js";
import {
  createImportCommands,
  type ImportCommandDependencies,
} from "./commands/import.js";
import { createBenchmarkCommands } from "./commands/benchmark.js";
import {
  createAgentCommands,
  type AgentCommandDependencies,
} from "./commands/agent.js";

export interface CliContext {
  readonly current_directory: URL;
}

export interface CliCommand<T = unknown> {
  readonly path: readonly string[];
  readonly mutates: boolean;
  run(
    context: CliContext,
    invocation: ParsedInvocation,
  ): Promise<RuntimeResult<T>>;
}

function commandKey(path: readonly string[]): string {
  return path.join("\u0000");
}

export class CommandRegistry {
  readonly #commands = new Map<string, CliCommand>();

  constructor(commands: readonly CliCommand[] = []) {
    for (const command of commands) {
      if (command.path.length === 0 || command.path.some((segment) => segment.length === 0)) {
        throw new Error("CLI command paths must contain non-empty segments");
      }
      const key = commandKey(command.path);
      if (this.#commands.has(key)) {
        throw new Error(`Duplicate CLI command path: ${command.path.join(" ")}`);
      }
      this.#commands.set(key, command);
    }
  }

  paths(): readonly (readonly string[])[] {
    return [...this.#commands.values()]
      .map((command) => command.path)
      .toSorted((left, right) => left.join(" ").localeCompare(right.join(" ")));
  }

  resolve(path: readonly string[]): CliCommand | undefined {
    return this.#commands.get(commandKey(path));
  }
}

export interface DefaultCommandRegistryDependencies {
  readonly agent?: AgentCommandDependencies;
  readonly import?: ImportCommandDependencies;
  readonly init?: InitCommandDependencies;
  readonly work_lifecycle?: LifecycleCommandDependencies;
}

export function createDefaultCommandRegistry(
  dependencies: DefaultCommandRegistryDependencies = {},
): CommandRegistry {
  return new CommandRegistry([
    createDoctorCommand(),
    ...createInitCommands(dependencies.init),
    ...createCatalogCommands(),
    ...createProfileCommands(),
    ...createSelectCommands(),
    ...createInitiativeCommands(dependencies.work_lifecycle),
    ...createWorkstreamCommands(dependencies.work_lifecycle),
    ...createTaskCommands(dependencies.work_lifecycle),
    ...createClaimCommands(),
    ...createViewsCommands(),
    ...createArchiveCommands(),
    ...createIntegrateCommands(),
    ...createSatelliteCommands(),
    ...createHubCommands(),
    ...createMigrateCommands(),
    ...createImportCommands(dependencies.import),
    ...createBenchmarkCommands(),
    ...createAgentCommands(dependencies.agent),
  ]);
}
