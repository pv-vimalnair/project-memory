import { failure } from "../../contracts/runtime-result.js";
import type { IntegrationCoordinator } from "../../governance/integration/integration-coordinator.js";
import type {
  MigrationPlanInput,
  MigrationService,
} from "../../migrations/contracts.js";
import type { CliCommand } from "../command-registry.js";
import {
  createPlanApplyCommands,
  type CommandInputReader,
} from "./workflow-support.js";

export interface MigrateCommandDependencies {
  readonly service: MigrationService;
  readonly coordinator: Pick<IntegrationCoordinator, "finalizeMutation">;
  readonly read_input?: CommandInputReader;
}

function defaults(): MigrateCommandDependencies {
  const unavailable = () => Promise.resolve(failure("CLI_RUNTIME_REQUIRED", "migration commands require a migration service"));
  return {
    service: { list: () => [], plan: unavailable },
    coordinator: { finalizeMutation: unavailable },
  };
}

export function createMigrateCommands(
  dependencies: MigrateCommandDependencies = defaults(),
): readonly CliCommand[] {
  return createPlanApplyCommands(
    ["migrate"],
    (input) => dependencies.service.plan(input as MigrationPlanInput),
    dependencies,
  );
}
