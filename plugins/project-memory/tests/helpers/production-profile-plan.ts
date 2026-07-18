import { success, type RuntimeResult } from "../../src/contracts/runtime-result.js";
import {
  createProfileArtifactRenderer,
  type TargetByteSnapshot,
} from "../../src/materialize/render-adapters.js";
import { acceptedProfileSourceRenderer } from "../../src/materialize/render-project-source.js";
import type { ProfileTargetReader } from "../../src/profile/build-profile-mutation-plan.js";
import type { ProfileCanonicalMutationPlan } from "../../src/profile/contracts/index.js";
import { createProfileCompiler } from "../../src/profile/profile-compiler.js";
import {
  createCompilerFixture,
  type CompilerFixture,
} from "./profile-compiler-fixture.js";

class EmptyTargetReader implements ProfileTargetReader {
  read(): Promise<RuntimeResult<Uint8Array | null>> {
    return Promise.resolve(success(null));
  }
}

export interface ProductionProfilePlanFixture {
  readonly fixture: CompilerFixture;
  readonly plan: ProfileCanonicalMutationPlan;
}

export async function compileProductionProfilePlan(): Promise<ProductionProfilePlanFixture> {
  const fixture = await createCompilerFixture();
  const targetSnapshot: TargetByteSnapshot = { files: new Map() };
  const compiler = createProfileCompiler({
    catalog: {
      resolve: () => Promise.resolve(success(fixture.catalog)),
    },
    source_renderer: acceptedProfileSourceRenderer,
    artifact_renderer: createProfileArtifactRenderer(targetSnapshot),
    target_reader: new EmptyTargetReader(),
  });
  const result = await compiler.plan(fixture.input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return { fixture, plan: result.value };
}
