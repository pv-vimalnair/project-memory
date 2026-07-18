import {
  failure,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import type { IntegrationCoordinator } from "../../governance/integration/integration-coordinator.js";
import type {
  ReviewedImportPlan,
  ReviewedImportPlanInput,
} from "../../import/contracts.js";
import type { CliCommand } from "../command-registry.js";
import {
  createPlanApplyCommands,
  type CommandInputReader,
} from "./workflow-support.js";


export interface ImportCommandDependencies {
  readonly planner: {
    plan(input: ReviewedImportPlanInput):
      | RuntimeResult<ReviewedImportPlan>
      | Promise<RuntimeResult<ReviewedImportPlan>>;
  };
  readonly coordinator: Pick<IntegrationCoordinator, "finalizeMutation">;
  readonly read_input?: CommandInputReader;
}

function defaults(): ImportCommandDependencies {
  const unavailable = () => failure("CLI_RUNTIME_REQUIRED", "import commands require a reviewed import planner");
  return {
    planner: { plan: unavailable },
    coordinator: { finalizeMutation: () => Promise.resolve(unavailable()) },
  };
}

export function createImportCommands(
  dependencies: ImportCommandDependencies = defaults(),
): readonly CliCommand[] {
  return createPlanApplyCommands(
    ["import"],
    (input) => Promise.resolve(
      dependencies.planner.plan(input as ReviewedImportPlanInput),
    ),
    dependencies,
  );
}
