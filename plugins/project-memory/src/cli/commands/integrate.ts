import { failure } from "../../contracts/runtime-result.js";
import type { IntegrationCoordinator } from "../../governance/integration/integration-coordinator.js";
import type { SingleRepoFinalizationInput } from "../../governance/integration/single-repo-contracts.js";
import type { CliCommand } from "../command-registry.js";
import {
  readJsonCommandInput,
  type CommandInputReader,
} from "./workflow-support.js";

export interface IntegrateCommandDependencies {
  readonly coordinator: Pick<IntegrationCoordinator, "validate" | "finalize">;
  readonly read_input?: CommandInputReader;
}

function defaults(): IntegrateCommandDependencies {
  const unavailable = () => Promise.resolve(failure("CLI_RUNTIME_REQUIRED", "integration commands require an integration coordinator"));
  return { coordinator: { validate: unavailable, finalize: unavailable } };
}

export function createIntegrateCommands(
  dependencies: IntegrateCommandDependencies = defaults(),
): readonly CliCommand[] {
  const readInput = dependencies.read_input ?? readJsonCommandInput;
  const validate: CliCommand = {
    path: ["integrate", "validate"],
    mutates: false,
    async run(context, invocation) {
      const input = await readInput(context, invocation);
      return input.ok
        ? dependencies.coordinator.validate(input.value as SingleRepoFinalizationInput)
        : input;
    },
  };
  const finalize: CliCommand = {
    path: ["integrate", "finalize"],
    mutates: true,
    async run(context, invocation) {
      const input = await readInput(context, invocation);
      if (!input.ok) return input;
      const validated = await dependencies.coordinator.validate(
        input.value as SingleRepoFinalizationInput,
      );
      return validated.ok
        ? dependencies.coordinator.finalize(validated.value)
        : validated;
    },
  };
  return [validate, finalize];
}
