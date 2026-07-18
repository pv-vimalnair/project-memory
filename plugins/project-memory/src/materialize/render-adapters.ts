import type { PlannedWrite } from "../contracts/planned-write.js";
import {
  failure,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import { compareUtf8 } from "../profile/catalog-selection-model.js";
import type {
  ProfileArtifactRenderer,
  ProfileArtifactRenderInput,
} from "../profile/build-profile-mutation-plan.js";
import type {
  ResolvedAdapter,
  ResolvedGateExecution,
  ResolvedProfile,
} from "../profile/contracts/index.js";
import { renderCompilerOwnedProjectTree } from "./render-project-tree.js";

const CONFIG_PATH = "tools/project-memory/config.json";
const ROUTER_LINKS = [
  ["Project context", "PROJECT_CONTEXT.md"],
  ["Project Memory protocol", "docs/project-memory/PROTOCOL.md"],
  ["Accepted profile lock", "docs/project-memory/profile.lock.yaml"],
] as const;

interface RouterDefinition {
  readonly adapter_id: string;
  readonly target_path: "AGENTS.md" | "CLAUDE.md";
  readonly proposal_slug: "agents" | "claude";
  readonly title: string;
  readonly runtime_guidance: readonly string[];
}

const ROUTERS: ReadonlyMap<string, RouterDefinition> = new Map([
  [
    "adapter.codex",
    {
      adapter_id: "adapter.codex",
      target_path: "AGENTS.md",
      proposal_slug: "agents",
      title: "Codex",
      runtime_guidance: [
        "If the Project Memory Plugin is available, invoke its `project-memory` skill and run `agent start` before substantive work.",
        "If the Plugin or engine is unavailable, follow the worker-only fallback below.",
      ],
    },
  ],
  [
    "adapter.claude-code",
    {
      adapter_id: "adapter.claude-code",
      target_path: "CLAUDE.md",
      proposal_slug: "claude",
      title: "Claude Code",
      runtime_guidance: [
        "No native Claude Code Plugin is assumed.",
        "If the configured bundled CLI is available, run its `agent start` command before substantive work.",
        "If the Plugin or engine is unavailable, follow the worker-only fallback below.",
      ],
    },
  ],
]);

export interface TargetByteSnapshot {
  readonly files: ReadonlyMap<string, Uint8Array>;
}

function normalizedPath(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function snapshotIndex(
  snapshot: TargetByteSnapshot,
): RuntimeResult<ReadonlyMap<string, Uint8Array>> {
  const indexed = new Map<string, Uint8Array>();
  for (const [path, bytes] of snapshot.files) {
    const normalized = normalizedPath(path);
    if (indexed.has(normalized)) {
      return failure(
        "ADAPTER_SNAPSHOT_PATH_COLLISION",
        "target snapshot repeats a path under case-insensitive NFC comparison",
        path,
      );
    }
    indexed.set(normalized, bytes);
  }
  return success(indexed);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function sortedAdapters(
  adapters: readonly ResolvedAdapter[],
): ResolvedAdapter[] {
  return [...adapters].sort((left, right) =>
    compareUtf8(
      `${left.definition_id}:${left.kind}:${left.definition_version}`,
      `${right.definition_id}:${right.kind}:${right.definition_version}`,
    ),
  );
}

function normalizedGate(gate: ResolvedGateExecution) {
  return {
    id: gate.id,
    source_definition_ids: sortedUnique(gate.source_definition_ids),
    commands: sortedUnique(gate.commands),
    required_evidence: sortedUnique(gate.required_evidence),
  };
}

function renderConfig(profile: ResolvedProfile): PlannedWrite {
  const gates = profile.gates
    .map(normalizedGate)
    .sort((left, right) => compareUtf8(left.id, right.id));
  const config = {
    schema_version: "1.0.0",
    root_id: profile.root.id,
    memory_root: "docs/project-memory",
    profile_lock: "docs/project-memory/profile.lock.yaml",
    catalog_lock: "docs/project-memory/catalog.lock.json",
    hub: { kind: "local", repository: "." },
    policy: {
      require_clean_canonical_tree: true,
      generated_view_check: true,
      archive_secret_scan: true,
    },
    adapters: sortedAdapters(profile.adapters).map((adapter) => ({
      kind: adapter.kind,
      definition_id: adapter.definition_id,
      definition_version: adapter.definition_version,
      target_path: adapter.definition_target_path,
      target_sha256: adapter.definition_target_sha256,
    })),
    commands: sortedUnique(gates.flatMap((gate) => gate.commands)),
    gates,
  };
  return {
    relative_path: CONFIG_PATH,
    bytes: new TextEncoder().encode(canonicalJson(config)),
    expected_existing_sha256: null,
    mode: "create_or_replace",
  };
}

function routerBytes(definition: RouterDefinition): Uint8Array {
  const links = ROUTER_LINKS.map(
    ([label, path], index) => `${String(index + 1)}. [${label}](${path})`,
  );
  const markdown = [
    "<!-- PROJECT MEMORY GENERATED ROUTER - DO NOT EDIT -->",
    `# ${definition.title} Project Memory Router`,
    "",
    "This file is a thin tool router. Canonical project truth remains in Project Memory.",
    "",
    "Read these files in order before doing project work:",
    "",
    ...links,
    "",
    "## Runtime",
    "",
    ...definition.runtime_guidance,
    "",
    "## Work and handoff",
    "",
    "After startup, read only the assigned task packet and its direct references.",
    "Work only inside a valid claim and return a completion packet with changed paths, checks, evidence, risks, and omissions.",
    "Without the Plugin or engine, remain worker-only and request integrator or coordinator help for canonical updates.",
    "Workers never run apply or finalize.",
    "Never write canonical records, locks, or generated views directly.",
    "",
    `Adapter: \`${definition.adapter_id}\``,
    "Runtime configuration: `tools/project-memory/config.json`",
    "",
  ].join("\n");
  return new TextEncoder().encode(markdown);
}

function proposalWrite(
  definition: RouterDefinition,
  current: Uint8Array,
  proposed: Uint8Array,
): PlannedWrite {
  const currentHash = sha256(current);
  const proposedHash = sha256(proposed);
  const proposalId = sha256(
    `${definition.adapter_id}\u0000${definition.target_path}\u0000${currentHash}\u0000${proposedHash}`,
  ).slice(0, 16);
  const relativePath =
    `docs/project-memory/catalog/proposals/adapter-existing-file-` +
    `${definition.proposal_slug}-${proposalId}.md`;
  const markdown = [
    "<!-- PROJECT MEMORY GENERATED REVIEW PROPOSAL -->",
    "# Existing adapter instruction file review",
    "",
    `- Adapter: \`${definition.adapter_id}\``,
    `- Existing path: \`${definition.target_path}\``,
    `- Existing SHA-256: \`${currentHash}\``,
    `- Proposed router SHA-256: \`${proposedHash}\``,
    "",
    "The existing file is user-owned and was not replaced.",
    "Review its instructions, preserve repository-specific rules, and explicitly approve any merge or replacement.",
    "",
  ].join("\n");
  return {
    relative_path: relativePath,
    bytes: new TextEncoder().encode(markdown),
    expected_existing_sha256: null,
    mode: "create_or_replace",
  };
}

function existingFileReview(
  definition: RouterDefinition,
  proposal: PlannedWrite,
  current: Uint8Array,
  proposed: Uint8Array,
): RuntimeIssue {
  return {
    code: "ADAPTER_EXISTING_FILE_REVIEW",
    severity: "review",
    path: definition.target_path,
    message:
      "existing tool instructions were preserved and require explicit review",
    references: [
      proposal.relative_path,
      `existing_sha256:${sha256(current)}`,
      `proposed_sha256:${sha256(proposed)}`,
    ],
  };
}

export function renderAdapters(
  profile: ResolvedProfile,
  targetSnapshot: TargetByteSnapshot,
): RuntimeResult<readonly PlannedWrite[]> {
  const indexed = snapshotIndex(targetSnapshot);
  if (!indexed.ok) return { ok: false, issues: indexed.issues };
  const writes: PlannedWrite[] = [renderConfig(profile)];
  const warnings: RuntimeIssue[] = [];

  for (const adapter of sortedAdapters(profile.adapters)) {
    const definition = ROUTERS.get(adapter.definition_id);
    if (definition === undefined || adapter.kind !== "agent") continue;
    const proposed = routerBytes(definition);
    const current = indexed.value.get(normalizedPath(definition.target_path));
    if (current === undefined) {
      writes.push({
        relative_path: definition.target_path,
        bytes: proposed,
        expected_existing_sha256: null,
        mode: "create",
      });
      continue;
    }
    if (sha256(current) === sha256(proposed)) continue;
    const proposal = proposalWrite(definition, current, proposed);
    writes.push(proposal);
    warnings.push(existingFileReview(definition, proposal, current, proposed));
  }

  return success(
    writes.sort((left, right) =>
      compareUtf8(left.relative_path, right.relative_path),
    ),
    warnings.sort((left, right) => compareUtf8(left.path, right.path)),
  );
}

function renderProfileArtifacts(
  input: ProfileArtifactRenderInput,
  targetSnapshot: TargetByteSnapshot,
): RuntimeResult<readonly PlannedWrite[]> {
  const projectTree = renderCompilerOwnedProjectTree(input);
  if (!projectTree.ok) return { ok: false, issues: projectTree.issues };
  const adapters = renderAdapters(input.profile, targetSnapshot);
  if (!adapters.ok) return { ok: false, issues: adapters.issues };
  return success(
    [...projectTree.value, ...adapters.value].sort((left, right) =>
      compareUtf8(left.relative_path, right.relative_path),
    ),
    [...projectTree.warnings, ...adapters.warnings],
  );
}

export function createProfileArtifactRenderer(
  targetSnapshot: TargetByteSnapshot,
): ProfileArtifactRenderer {
  return {
    render: (input) => renderProfileArtifacts(input, targetSnapshot),
  };
}
