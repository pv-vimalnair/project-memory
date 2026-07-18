import { failure } from "../../contracts/runtime-result.js";
import type { IntegrationCoordinator } from "../../governance/integration/integration-coordinator.js";
import type { CliCommand } from "../command-registry.js";
import {
  createPlanApplyCommands,
  createReadCommand,
  type CommandInputReader,
  type MutationPlanner,
  type ReadOperation,
} from "./workflow-support.js";

export interface ProfileCommandDependencies {
  readonly profile_compiler: { readonly plan: MutationPlanner };
  readonly verify: ReadOperation;
  readonly diff: ReadOperation;
  readonly coordinator: Pick<IntegrationCoordinator, "finalizeMutation">;
  readonly read_input?: CommandInputReader;
}

function defaults(): ProfileCommandDependencies {
  const unavailable = () => Promise.resolve(failure("CLI_RUNTIME_REQUIRED", "profile commands require a profile service"));
  return {
    profile_compiler: { plan: unavailable },
    verify: unavailable,
    diff: unavailable,
    coordinator: { finalizeMutation: unavailable },
  };
}

export function createProfileCommands(
  dependencies: ProfileCommandDependencies = defaults(),
): readonly CliCommand[] {
  return [
    ...createPlanApplyCommands(
      ["profile"],
      dependencies.profile_compiler.plan,
      dependencies,
    ),
    createReadCommand(["profile", "verify"], dependencies.verify, dependencies.read_input),
    createReadCommand(["profile", "diff"], dependencies.diff, dependencies.read_input),
  ];
}
