import { AGENT_READING_ORDER_PREFIX } from "../agent/start.js";
import type { PlannedWrite } from "../contracts/planned-write.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type {
  ProfileLock,
  ProjectSelection,
  ResolvedProfile,
} from "../profile/contracts/index.js";
import { sourceWrite } from "./source-markdown.js";

export const PROJECT_CONTEXT_PATH = "PROJECT_CONTEXT.md" as const;
export const PROTOCOL_PATH = "docs/project-memory/PROTOCOL.md" as const;

const GENERATED_MARKER = "<!-- PROJECT MEMORY: GENERATED — DO NOT EDIT -->";

export function renderStartupContext(
  selection: ProjectSelection,
  profile: ResolvedProfile,
  profileLock: ProfileLock,
): RuntimeResult<PlannedWrite> {
  if (
    selection.root.id !== profile.root.id ||
    selection.root.id !== profileLock.root_id ||
    profileLock.profile.root.id !== profile.root.id
  ) {
    return failure(
      "PROFILE_STARTUP_CONTEXT_ROOT_MISMATCH",
      "startup context inputs must reference the same root identity",
      selection.root.id,
    );
  }
  const text = [
    GENERATED_MARKER,
    "# Project Context",
    "",
    `- Root address: \`${selection.root.namespace}/${selection.root.id}\``,
    `- Profile lock hash: \`${profileLock.lock_hash}\``,
    `- Profile revision: ${String(profileLock.profile_revision)}`,
    "",
    "## Ownership Boundaries",
    "",
    "- `docs/project-memory/project.yaml` is the accepted profile-selection input.",
    "- `docs/project-memory/source/**`, component documents, and domain documents contain accepted canonical source facts.",
    "- `docs/project-memory/profile.lock.yaml`, vendored catalog files, protocol files, adapters, and tool configuration are compiler-owned generated artifacts.",
    "- `docs/project-memory/views/**` is governance-owned generated state.",
    "- `docs/project-memory/archive/**` is append-only history and never current truth.",
    "",
    "## Startup Order",
    "",
    ...AGENT_READING_ORDER_PREFIX.map(
      (relativePath, index) => `${String(index + 1)}. \`${relativePath}\``,
    ),
    ...[
      "The assigned task packet",
      "Named component and domain documents",
      "Linked canonical records",
      "Archive only for historical investigation",
    ].map(
      (instruction, index) =>
        `${String(AGENT_READING_ORDER_PREFIX.length + index + 1)}. ${instruction}`,
    ),
    "",
    "## Agent Rule",
    "",
    "Do not edit generated views, locks, vendored catalog bytes, adapters, or this startup doorway by hand. Submit isolated factual results; only the canonical integrator finalizes shared truth.",
    "",
  ].join("\n");
  return success(sourceWrite(PROJECT_CONTEXT_PATH, new TextEncoder().encode(text)));
}

export function renderProtocol(): PlannedWrite {
  const text = [
    GENERATED_MARKER,
    "# Project Memory Protocol",
    "",
    "1. Read the startup doorway and current profile lock before accepting work.",
    "2. Read the assigned task packet and only the named component, domain, and record context.",
    "3. Workers operate in isolated branches or worktrees and submit factual completion packets.",
    "4. Workers never overwrite canonical shared truth or accept directional decisions.",
    "5. The canonical integrator verifies claims, approvals, gates, hashes, and the current base before finalization.",
    "6. Historical archive entries are append-only; corrections use superseding records.",
    "7. Missing evidence, stale bases, ownership conflicts, and ambiguous direction fail closed.",
    "",
  ].join("\n");
  return sourceWrite(PROTOCOL_PATH, new TextEncoder().encode(text));
}
