import { failure } from "../../contracts/runtime-result.js";
import type { CliCommand } from "../command-registry.js";
import {
  createReadCommand,
  type CommandInputReader,
  type ReadOperation,
} from "./workflow-support.js";

export interface SelectCommandDependencies {
  readonly select_root: ReadOperation;
  readonly select_work: ReadOperation;
  readonly compile_workstream: ReadOperation;
  readonly materialize_task: ReadOperation;
  readonly validate_completion: ReadOperation;
  readonly read_input?: CommandInputReader;
}

function defaults(): SelectCommandDependencies {
  const unavailable = () => Promise.resolve(failure("CLI_RUNTIME_REQUIRED", "selection commands require a planning service"));
  return {
    select_root: unavailable,
    select_work: unavailable,
    compile_workstream: unavailable,
    materialize_task: unavailable,
    validate_completion: unavailable,
  };
}

export function createSelectCommands(
  dependencies: SelectCommandDependencies = defaults(),
): readonly CliCommand[] {
  const read = dependencies.read_input;
  return [
    createReadCommand(["select", "root"], dependencies.select_root, read),
    createReadCommand(["select", "work"], dependencies.select_work, read),
    createReadCommand(["workstream", "compile"], dependencies.compile_workstream, read),
    createReadCommand(["task", "materialize"], dependencies.materialize_task, read),
    createReadCommand(["completion", "validate"], dependencies.validate_completion, read),
  ];
}
