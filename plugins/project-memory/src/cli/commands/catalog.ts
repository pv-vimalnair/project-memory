import { failure } from "../../contracts/runtime-result.js";
import type { CliCommand } from "../command-registry.js";
import {
  createPlanApplyCommands,
  createReadCommand,
  type CommandInputReader,
  type MutationPlanner,
  type ReadOperation,
} from "./workflow-support.js";
import type { IntegrationCoordinator } from "../../governance/integration/integration-coordinator.js";

export interface CatalogCommandDependencies {
  readonly release_plan: MutationPlanner;
  readonly release_verify: ReadOperation;
  readonly selected_verify: ReadOperation;
  readonly coordinator: Pick<IntegrationCoordinator, "finalizeMutation">;
  readonly read_input?: CommandInputReader;
}

function defaults(): CatalogCommandDependencies {
  const unavailable = () => Promise.resolve(failure("CLI_RUNTIME_REQUIRED", "catalog commands require a catalog service"));
  return {
    release_plan: unavailable,
    release_verify: unavailable,
    selected_verify: unavailable,
    coordinator: { finalizeMutation: unavailable },
  };
}

export function createCatalogCommands(
  dependencies: CatalogCommandDependencies = defaults(),
): readonly CliCommand[] {
  return [
    ...createPlanApplyCommands(
      ["catalog", "release"],
      dependencies.release_plan,
      dependencies,
    ),
    createReadCommand(
      ["catalog", "release", "verify"],
      dependencies.release_verify,
      dependencies.read_input,
    ),
    createReadCommand(
      ["catalog", "selected", "verify"],
      dependencies.selected_verify,
      dependencies.read_input,
    ),
  ];
}
