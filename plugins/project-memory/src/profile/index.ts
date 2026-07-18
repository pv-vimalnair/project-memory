export * from "./contracts/index.js";
export { createProfileCompiler } from "./profile-compiler.js";
export type {
  ProfileArtifactRenderer,
  ProfileArtifactRenderInput,
  ProfileCatalogResolver,
  ProfilePlanningDependencies,
  ProfileSourceRenderer,
  ProfileTargetReader,
} from "./build-profile-mutation-plan.js";
export { createProfileMaterializer } from "./materialize-to-isolated-staging.js";
export type {
  ProfileMaterializer,
  StagedProfileMutation,
  StagingCapability,
  StagingCapabilityVerifier,
  StagingGitInspector,
  StagingMaterializationDependencies,
  StagingMaterializationInput,
  StagingWorktreeDescriptor,
} from "./materialize-to-isolated-staging.js";
export { createProfileVerifier } from "./verify-profile.js";
export type {
  ProfileVerificationReport,
  ProfileVerifier,
} from "./verify-profile.js";
export { diffProfiles } from "./diff-profile.js";
export type {
  ApprovalKind,
  ProfileChange,
  ProfileChangeCategory,
  ProfileChangeOperation,
  ProfileEvolutionDiff,
  ProfileImpact,
} from "./diff-profile.js";
export { inspectProfileDrift } from "./profile-drift.js";
export type {
  AcceptedProfileObservation,
  ObservedProfileEvidence,
  ProfileDriftProposal,
  ProfileDriftReport,
  ProfileObservationKind,
} from "./profile-drift.js";
export { parseCanonicalMarkdown } from "../materialize/parse-canonical-markdown.js";
export {
  hasCanonicalArtifactId,
  isCanonicalMarkdownBody,
  renderCanonicalMarkdown,
} from "../materialize/render-canonical-markdown.js";
export {
  acceptedProfileSourceRenderer,
  renderAcceptedProfileSources,
} from "../materialize/render-project-source.js";
export {
  createProfileArtifactRenderer,
  renderAdapters,
} from "../materialize/render-adapters.js";
export type { TargetByteSnapshot } from "../materialize/render-adapters.js";