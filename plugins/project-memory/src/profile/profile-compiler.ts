import type { ProfileCompiler } from "./contracts/index.js";
import {
  profileCompilerFromDependencies,
  type ProfilePlanningDependencies,
} from "./build-profile-mutation-plan.js";

export function createProfileCompiler(
  dependencies: ProfilePlanningDependencies,
): ProfileCompiler {
  return profileCompilerFromDependencies(dependencies);
}
