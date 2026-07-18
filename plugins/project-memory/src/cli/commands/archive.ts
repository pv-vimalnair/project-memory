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

export interface ArchiveCommandDependencies {
  readonly plan_ingest: MutationPlanner;
  readonly verify: ReadOperation;
  readonly coordinator: Pick<IntegrationCoordinator, "finalizeMutation">;
  readonly read_input?: CommandInputReader;
}

function defaults(): ArchiveCommandDependencies {
  const unavailable = () => Promise.resolve(failure("CLI_RUNTIME_REQUIRED", "archive commands require an archive service"));
  return {
    plan_ingest: unavailable,
    verify: unavailable,
    coordinator: { finalizeMutation: unavailable },
  };
}

export function createArchiveCommands(
  dependencies: ArchiveCommandDependencies = defaults(),
): readonly CliCommand[] {
  return [
    ...createPlanApplyCommands(["archive", "ingest"], dependencies.plan_ingest, dependencies),
    createReadCommand(["archive", "verify"], dependencies.verify, dependencies.read_input),
  ];
}
