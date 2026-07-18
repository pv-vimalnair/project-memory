import type { CliCommand } from "../command-registry.js";
import {
  createLifecycleCommands,
  type LifecycleCommandDependencies,
} from "./lifecycle-support.js";

export function createInitiativeCommands(
  dependencies?: LifecycleCommandDependencies,
): readonly CliCommand[] {
  return createLifecycleCommands("initiative", dependencies);
}
