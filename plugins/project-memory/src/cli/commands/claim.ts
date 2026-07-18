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

export interface ClaimCommandDependencies {
  readonly plan_issue: MutationPlanner;
  readonly plan_renew: MutationPlanner;
  readonly validate: ReadOperation;
  readonly coordinator: Pick<IntegrationCoordinator, "finalizeMutation">;
  readonly read_input?: CommandInputReader;
}

function defaults(): ClaimCommandDependencies {
  const unavailable = () => Promise.resolve(failure("CLI_RUNTIME_REQUIRED", "claim commands require a claim service"));
  return {
    plan_issue: unavailable,
    plan_renew: unavailable,
    validate: unavailable,
    coordinator: { finalizeMutation: unavailable },
  };
}

export function createClaimCommands(
  dependencies: ClaimCommandDependencies = defaults(),
): readonly CliCommand[] {
  return [
    ...createPlanApplyCommands(["claim", "issue"], dependencies.plan_issue, dependencies),
    ...createPlanApplyCommands(["claim", "renew"], dependencies.plan_renew, dependencies),
    createReadCommand(["claim", "validate"], dependencies.validate, dependencies.read_input),
  ];
}
