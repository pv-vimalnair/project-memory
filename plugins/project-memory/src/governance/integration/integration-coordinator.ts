import type {
  CanonicalMutationPlan,
  RuntimeResult,
} from "../../index.js";
import type {
  BootstrapFinalization,
  BootstrapFinalizer,
  BootstrapInput,
} from "./bootstrap-finalizer.js";
import type {
  CanonicalMutationCoordinator,
  MutationReceipt,
} from "./canonical-mutation-finalizer.js";
import type {
  IntegrationReceipt,
  SingleRepoFinalizationInput,
  SingleRepoFinalizer,
  ValidatedIntegration,
} from "./single-repo-finalizer.js";

export interface IntegrationCoordinator {
  bootstrap(input: BootstrapInput): Promise<RuntimeResult<BootstrapFinalization>>;
  finalizeMutation(
    plan: CanonicalMutationPlan<unknown>,
  ): Promise<RuntimeResult<MutationReceipt>>;
  validate(
    input: SingleRepoFinalizationInput,
  ): Promise<RuntimeResult<ValidatedIntegration>>;
  finalize(
    token: ValidatedIntegration,
  ): Promise<RuntimeResult<IntegrationReceipt>>;
}

export interface IntegrationCoordinatorDependencies {
  readonly bootstrap: BootstrapFinalizer;
  readonly mutations: CanonicalMutationCoordinator;
  readonly single_repo: SingleRepoFinalizer;
}

export function createIntegrationCoordinator(
  dependencies: IntegrationCoordinatorDependencies,
): IntegrationCoordinator {
  return {
    bootstrap: (input) => dependencies.bootstrap.bootstrap(input),
    finalizeMutation: (plan) => dependencies.mutations.finalizeMutation(plan),
    validate: (input) => dependencies.single_repo.validate(input),
    finalize: (token) => dependencies.single_repo.finalize(token),
  };
}
