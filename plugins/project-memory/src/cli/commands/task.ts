import type { CliCommand } from "../command-registry.js";
import {
  createLifecycleCommands,
  type LifecycleCommandDependencies,
} from "./lifecycle-support.js";

export function createTaskCommands(
  dependencies?: LifecycleCommandDependencies,
): readonly CliCommand[] {
  return createLifecycleCommands("task", dependencies);
}
