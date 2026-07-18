import type { PlannedWrite } from "../contracts/planned-write.js";
import {
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { compareUtf8 } from "../profile/catalog-selection-model.js";
import type {
  ProfileArtifactRenderer,
  ProfileArtifactRenderInput,
} from "../profile/build-profile-mutation-plan.js";
import {
  renderProtocol,
  renderStartupContext,
} from "./render-startup-context.js";
import { sourceWrite } from "./source-markdown.js";

const EMPTY_CONTRACT_PATHS = [
  "docs/project-memory/initiatives/.gitkeep",
  "docs/project-memory/workstreams/.gitkeep",
  "docs/project-memory/records/decisions/.gitkeep",
  "docs/project-memory/records/ideas/.gitkeep",
  "docs/project-memory/records/changes/.gitkeep",
  "docs/project-memory/records/findings/.gitkeep",
  "docs/project-memory/records/risks/.gitkeep",
  "docs/project-memory/records/evidence/.gitkeep",
  "docs/project-memory/records/lessons/.gitkeep",
  "docs/project-memory/records/approvals/.gitkeep",
  "docs/project-memory/governance/claims/.gitkeep",
  "docs/project-memory/governance/integration/.gitkeep",
  "docs/project-memory/governance/migrations/.gitkeep",
  "docs/project-memory/catalog/proposals/.gitkeep",
  "docs/project-memory/archive/sessions/.gitkeep",
  "docs/project-memory/archive/transcripts/.gitkeep",
  "docs/project-memory/archive/snapshots/.gitkeep",
  "docs/project-memory/archive/retired/.gitkeep",
] as const;

export function renderCompilerOwnedProjectTree(
  input: ProfileArtifactRenderInput,
): RuntimeResult<readonly PlannedWrite[]> {
  const startup = renderStartupContext(
    input.selection,
    input.profile,
    input.profile_lock,
  );
  if (!startup.ok) return { ok: false, issues: startup.issues };
  const writes = [
    startup.value,
    renderProtocol(),
    ...EMPTY_CONTRACT_PATHS.map((path) =>
      sourceWrite(path, new Uint8Array()),
    ),
  ].sort((left, right) =>
    compareUtf8(left.relative_path, right.relative_path),
  );
  return success(writes);
}

export function createProjectTreeArtifactRenderer(): ProfileArtifactRenderer {
  return { render: renderCompilerOwnedProjectTree };
}
