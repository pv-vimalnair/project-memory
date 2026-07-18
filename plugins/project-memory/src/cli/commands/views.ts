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

export interface ViewsCommandDependencies {
  readonly plan_generate: MutationPlanner;
  readonly check: ReadOperation;
  readonly coordinator: Pick<IntegrationCoordinator, "finalizeMutation">;
  readonly read_input?: CommandInputReader;
}

function defaults(): ViewsCommandDependencies {
  const unavailable = () => Promise.resolve(failure("CLI_RUNTIME_REQUIRED", "view commands require a view generator"));
  return {
    plan_generate: unavailable,
    check: unavailable,
    coordinator: { finalizeMutation: unavailable },
  };
}

export function createViewsCommands(
  dependencies: ViewsCommandDependencies = defaults(),
): readonly CliCommand[] {
  return [
    ...createPlanApplyCommands(["views", "generate"], dependencies.plan_generate, dependencies),
    createReadCommand(["views", "check"], dependencies.check, dependencies.read_input),
  ];
}
