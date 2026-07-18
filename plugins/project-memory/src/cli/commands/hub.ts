import { failure } from "../../contracts/runtime-result.js";
import type { FinalizeHubInput } from "../../governance/integration/hub-finalizer.js";
import type { MultiRepoFinalizer } from "../../governance/integration/integration-recovery.js";
import type { CliCommand } from "../command-registry.js";
import {
  readJsonCommandInput,
  type CommandInputReader,
} from "./workflow-support.js";

export interface HubCommandDependencies {
  readonly finalizer: Pick<MultiRepoFinalizer, "finalizeHub">;
  readonly read_input?: CommandInputReader;
}

function defaults(): HubCommandDependencies {
  return {
    finalizer: {
      finalizeHub: () => Promise.resolve(failure(
        "CLI_RUNTIME_REQUIRED",
        "hub finalize requires a multi-repository finalizer",
      )),
    },
  };
}

export function createHubCommands(
  dependencies: HubCommandDependencies = defaults(),
): readonly CliCommand[] {
  const readInput = dependencies.read_input ?? readJsonCommandInput;
  return [{
    path: ["hub", "finalize"],
    mutates: true,
    async run(context, invocation) {
      const input = await readInput(context, invocation);
      return input.ok
        ? dependencies.finalizer.finalizeHub(input.value as FinalizeHubInput)
        : input;
    },
  }];
}
