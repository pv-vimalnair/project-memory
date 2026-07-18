import { failure } from "../../contracts/runtime-result.js";
import type { MultiRepoFinalizer } from "../../governance/integration/integration-recovery.js";
import type { PrepareSatelliteInput } from "../../governance/integration/satellite-preparer.js";
import type { CliCommand } from "../command-registry.js";
import {
  readJsonCommandInput,
  type CommandInputReader,
} from "./workflow-support.js";

export interface SatelliteCommandDependencies {
  readonly finalizer: Pick<MultiRepoFinalizer, "prepareSatellite">;
  readonly read_input?: CommandInputReader;
}

function defaults(): SatelliteCommandDependencies {
  return {
    finalizer: {
      prepareSatellite: () => Promise.resolve(failure(
        "CLI_RUNTIME_REQUIRED",
        "satellite prepare requires a multi-repository finalizer",
      )),
    },
  };
}

export function createSatelliteCommands(
  dependencies: SatelliteCommandDependencies = defaults(),
): readonly CliCommand[] {
  const readInput = dependencies.read_input ?? readJsonCommandInput;
  return [{
    path: ["satellite", "prepare"],
    mutates: true,
    async run(context, invocation) {
      const input = await readInput(context, invocation);
      return input.ok
        ? dependencies.finalizer.prepareSatellite(input.value as PrepareSatelliteInput)
        : input;
    },
  }];
}
