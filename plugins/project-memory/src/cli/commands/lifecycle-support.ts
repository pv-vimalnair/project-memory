import { failure } from "../../contracts/runtime-result.js";
import type { IntegrationCoordinator } from "../../governance/integration/integration-coordinator.js";
import type {
  CreateInitiativeInput,
  CreateTaskPacketInput,
  CreateWorkstreamInput,
  WorkLifecycleService,
  WorkTransitionInput,
} from "../../governance/work/work-lifecycle-contracts.js";
import type { CliCommand } from "../command-registry.js";
import {
  createPlanApplyCommands,
  type CommandInputReader,
  type MutationPlanner,
} from "./workflow-support.js";

export interface LifecycleCommandDependencies {
  readonly service: WorkLifecycleService;
  readonly coordinator: Pick<IntegrationCoordinator, "finalizeMutation">;
  readonly read_input?: CommandInputReader;
}

type LifecycleArtifact = "initiative" | "workstream" | "task";

function defaults(): LifecycleCommandDependencies {
  const unavailable = () => Promise.resolve(failure("CLI_RUNTIME_REQUIRED", "work commands require a lifecycle service"));
  return {
    service: {
      planCreateInitiative: unavailable,
      planCreateWorkstream: unavailable,
      planCreateTaskPacket: unavailable,
      planTransition: unavailable,
    },
    coordinator: { finalizeMutation: unavailable },
  };
}

function createPlanner(
  artifact: LifecycleArtifact,
  service: WorkLifecycleService,
): MutationPlanner {
  switch (artifact) {
    case "initiative":
      return (input) => service.planCreateInitiative(input as CreateInitiativeInput);
    case "workstream":
      return (input) => service.planCreateWorkstream(input as CreateWorkstreamInput);
    case "task":
      return (input) => service.planCreateTaskPacket(input as CreateTaskPacketInput);
  }
}

export function createLifecycleCommands(
  artifact: LifecycleArtifact,
  dependencies: LifecycleCommandDependencies = defaults(),
): readonly CliCommand[] {
  const transition: MutationPlanner = (input) =>
    dependencies.service.planTransition(input as WorkTransitionInput);
  return [
    ...createPlanApplyCommands(
      [artifact, "create"],
      createPlanner(artifact, dependencies.service),
      dependencies,
    ),
    ...createPlanApplyCommands(
      [artifact, "transition"],
      transition,
      dependencies,
    ),
  ];
}
