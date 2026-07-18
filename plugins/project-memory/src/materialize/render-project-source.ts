import type { PlannedWrite } from "../contracts/planned-write.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import { compareUtf8 } from "../profile/catalog-selection-model.js";
import type { ProfileSourceRenderer } from "../profile/build-profile-mutation-plan.js";
import type {
  AcceptedProfileSourceSet,
  BlueprintSourceDocument,
  ConstraintData,
  PolicyData,
  ProjectSelection,
  ProjectSourceData,
  ResolvedProfile,
} from "../profile/contracts/index.js";
import { renderCanonicalMarkdown } from "./render-canonical-markdown.js";
import { renderComponentSource } from "./render-component.js";
import { renderDomainSource } from "./render-domain.js";
import { renderRootRelationships } from "./render-root-relationships.js";
import {
  acceptedListFrontMatter,
  acceptedMarkdownText,
  markdownBody,
  markdownList,
  sourceWrite,
} from "./source-markdown.js";

const RESERVED_SOURCE_PATHS = new Set([
  "docs/project-memory/source/PROJECT.md",
  "docs/project-memory/source/CONSTRAINTS.md",
  "docs/project-memory/source/POLICIES.md",
  "docs/project-memory/source/ROOT_RELATIONSHIPS.md",
]);

function renderProject(record: ProjectSourceData): RuntimeResult<PlannedWrite> {
  const body = markdownBody([
    `# Project — ${acceptedMarkdownText(record.name)}`,
    "",
    "## Mission",
    "",
    acceptedMarkdownText(record.mission),
    "",
    ...markdownList("Owners", record.owners, "No accepted owners."),
    ...markdownList(
      "Stakeholders",
      record.stakeholders,
      "No accepted stakeholders.",
    ),
    ...markdownList(
      "Success Criteria",
      record.success_criteria,
      "No accepted success criteria.",
    ),
    ...markdownList(
      "Included Scope",
      record.included_scope,
      "No accepted included scope.",
    ),
    ...markdownList(
      "Excluded Scope",
      record.excluded_scope,
      "No accepted excluded scope.",
    ),
  ]);
  try {
    return success(
      sourceWrite(
        "docs/project-memory/source/PROJECT.md",
        renderCanonicalMarkdown({
          envelope: {
            schema: "project-memory/canonical-markdown",
            type: "project",
            version: "1.0.0",
            id: record.id,
            revision: record.revision,
            root_id: record.id,
            approval_refs: [...record.approval_refs],
          },
          body,
        }),
      ),
    );
  } catch {
    return failure(
      "PROFILE_PROJECT_RENDER_FAILED",
      "accepted project source could not be rendered canonically",
      record.id,
    );
  }
}

function aggregateApprovalRefs(
  records: readonly { readonly approval_refs: readonly string[] }[],
  fallback: readonly string[],
): string[] {
  const values = records.flatMap((record) => record.approval_refs);
  return [...new Set(values.length === 0 ? fallback : values)].sort(compareUtf8);
}

function renderConstraints(
  rootId: string,
  records: readonly ConstraintData[],
  fallbackApprovals: readonly string[],
): PlannedWrite {
  const sections = [...records]
    .sort((left, right) => compareUtf8(left.id, right.id))
    .flatMap((record) => [
      `## ${record.id} — ${acceptedMarkdownText(record.title)}`,
      "",
      `- Revision: ${String(record.revision)}`,
      `- Statement: ${acceptedMarkdownText(record.statement)}`,
      `- Rationale: ${acceptedMarkdownText(record.rationale)}`,
      `- Applies to: ${record.applies_to.map(acceptedMarkdownText).join(", ") || "None accepted"}`,
      `- Approval refs: ${[...record.approval_refs].sort(compareUtf8).join(", ")}`,
      "",
    ]);
  const text = markdownBody([
    ...acceptedListFrontMatter(
      "constraints",
      rootId,
      aggregateApprovalRefs(records, fallbackApprovals),
    ),
    "# Constraints",
    "",
    ...(sections.length === 0 ? ["_No accepted constraints._", ""] : sections),
  ]);
  return sourceWrite(
    "docs/project-memory/source/CONSTRAINTS.md",
    new TextEncoder().encode(text),
  );
}

function renderPolicies(
  rootId: string,
  records: readonly PolicyData[],
  fallbackApprovals: readonly string[],
): PlannedWrite {
  const sections = [...records]
    .sort((left, right) => compareUtf8(left.id, right.id))
    .flatMap((record) => [
      `## ${record.id} — ${acceptedMarkdownText(record.title)}`,
      "",
      `- Revision: ${String(record.revision)}`,
      `- Enforcement: ${record.enforcement}`,
      `- Statement: ${acceptedMarkdownText(record.statement)}`,
      `- Applies to: ${record.applies_to.map(acceptedMarkdownText).join(", ") || "None accepted"}`,
      `- Approval refs: ${[...record.approval_refs].sort(compareUtf8).join(", ")}`,
      "",
    ]);
  const text = markdownBody([
    ...acceptedListFrontMatter(
      "policies",
      rootId,
      aggregateApprovalRefs(records, fallbackApprovals),
    ),
    "# Policies",
    "",
    ...(sections.length === 0 ? ["_No accepted policies._", ""] : sections),
  ]);
  return sourceWrite(
    "docs/project-memory/source/POLICIES.md",
    new TextEncoder().encode(text),
  );
}

function renderBlueprintDocument(
  rootId: string,
  record: BlueprintSourceDocument,
): RuntimeResult<PlannedWrite> {
  if (
    !record.relative_path.startsWith("docs/project-memory/source/") ||
    RESERVED_SOURCE_PATHS.has(record.relative_path)
  ) {
    return failure(
      "PROFILE_BLUEPRINT_DOCUMENT_PATH_INVALID",
      "blueprint documents require an unreserved accepted source path",
      record.relative_path,
    );
  }
  const sections = record.sections.flatMap((section) => [
    `## ${acceptedMarkdownText(section.heading)}`,
    "",
    acceptedMarkdownText(section.body),
    "",
  ]);
  const text = markdownBody([
    ...acceptedListFrontMatter(
      "blueprint-document",
      rootId,
      record.approval_refs,
      [`id: ${record.id}`, `revision: ${String(record.revision)}`],
    ),
    `# ${acceptedMarkdownText(record.title)}`,
    "",
    `Purpose: ${acceptedMarkdownText(record.purpose)}`,
    "",
    ...sections,
  ]);
  return success(
    sourceWrite(record.relative_path, new TextEncoder().encode(text)),
  );
}

function relationshipsMatch(
  sources: AcceptedProfileSourceSet,
  profile: ResolvedProfile,
): boolean {
  const sorted = (values: ResolvedProfile["root_relationships"]) =>
    [...values].sort((left, right) =>
      compareUtf8(left.relationship_id, right.relationship_id),
    );
  return (
    canonicalJson(sorted(sources.root_relationships)) ===
    canonicalJson(sorted(profile.root_relationships))
  );
}

function relationshipLocalRootsMatch(
  selection: ProjectSelection,
  sources: AcceptedProfileSourceSet,
): boolean {
  return sources.root_relationships.every((record) => {
    const local =
      record.kind === "portfolio-child"
        ? record.portfolio
        : record.kind === "shared-platform-provider"
          ? record.provider
          : record.consumer;
    return (
      local.root_id === selection.root.id &&
      local.namespace === selection.root.namespace
    );
  });
}
function pushResult(
  writes: PlannedWrite[],
  result: RuntimeResult<PlannedWrite>,
): RuntimeResult<true> {
  if (!result.ok) return { ok: false, issues: result.issues };
  writes.push(result.value);
  return success(true);
}

export function renderAcceptedProfileSources(
  selection: ProjectSelection,
  sources: AcceptedProfileSourceSet,
  profile: ResolvedProfile,
): RuntimeResult<readonly PlannedWrite[]> {
  if (
    selection.root.id !== sources.project.id ||
    selection.root.id !== profile.root.id ||
    sources.components.length !== profile.components.length ||
    sources.domains.length !== profile.domains.length ||
    !relationshipsMatch(sources, profile) ||
    !relationshipLocalRootsMatch(selection, sources)
  ) {
    return failure(
      "PROFILE_SOURCE_RENDER_INPUT_MISMATCH",
      "accepted source set does not match the resolved profile identity surface",
      selection.root.id,
    );
  }
  const writes: PlannedWrite[] = [];
  const project = pushResult(writes, renderProject(sources.project));
  if (!project.ok) return project;
  writes.push(
    renderConstraints(
      selection.root.id,
      sources.constraints,
      sources.project.approval_refs,
    ),
    renderPolicies(
      selection.root.id,
      sources.policies,
      sources.project.approval_refs,
    ),
  );
  const resolvedComponents = new Map(
    profile.components.map((component) => [component.instance_id, component]),
  );
  for (const record of sources.components) {
    const resolved = resolvedComponents.get(record.id);
    if (resolved === undefined) {
      return failure(
        "PROFILE_COMPONENT_SOURCE_MISMATCH",
        "accepted component has no resolved stable binding",
        record.id,
      );
    }
    const rendered = pushResult(
      writes,
      renderComponentSource(selection.root.id, record, resolved),
    );
    if (!rendered.ok) return rendered;
  }
  const resolvedDomains = new Map(
    profile.domains.map((domain) => [domain.instance_id, domain]),
  );
  for (const record of sources.domains) {
    const resolved = resolvedDomains.get(record.id);
    if (resolved === undefined) {
      return failure(
        "PROFILE_DOMAIN_SOURCE_MISMATCH",
        "accepted domain has no resolved stable binding",
        record.id,
      );
    }
    const rendered = pushResult(
      writes,
      renderDomainSource(selection.root.id, record, resolved),
    );
    if (!rendered.ok) return rendered;
  }
  for (const record of sources.blueprint_documents) {
    const rendered = pushResult(
      writes,
      renderBlueprintDocument(selection.root.id, record),
    );
    if (!rendered.ok) return rendered;
  }
  const relationships = renderRootRelationships(
    sources.root_relationships.length === 0
      ? {
          namespace: selection.root.namespace,
          root_id: selection.root.id,
          canonical_repository: "repository-not-required-without-relationships",
          profile_lock_hash: "0".repeat(64),
        }
      : sources.root_relationships[0]?.kind === "portfolio-child"
        ? sources.root_relationships[0].portfolio
        : sources.root_relationships[0]?.kind === "shared-platform-provider"
          ? sources.root_relationships[0].provider
          : sources.root_relationships[0]?.consumer ?? {
              namespace: selection.root.namespace,
              root_id: selection.root.id,
              canonical_repository: "repository-missing",
              profile_lock_hash: "0".repeat(64),
            },
    sources.root_relationships,
  );
  if (!relationships.ok) return { ok: false, issues: relationships.issues };
  if (relationships.value !== null) {
    writes.push(
      sourceWrite(
        "docs/project-memory/source/ROOT_RELATIONSHIPS.md",
        relationships.value,
      ),
    );
  }
  const seen = new Set<string>();
  for (const write of writes) {
    const key = write.relative_path.normalize("NFC").toLowerCase();
    if (seen.has(key)) {
      return failure(
        "PROFILE_SOURCE_WRITE_DUPLICATE",
        `accepted source path is repeated: ${write.relative_path}`,
        write.relative_path,
      );
    }
    seen.add(key);
  }
  return success(
    writes.sort((left, right) =>
      compareUtf8(left.relative_path, right.relative_path),
    ),
  );
}

export const acceptedProfileSourceRenderer: ProfileSourceRenderer = {
  render: renderAcceptedProfileSources,
};
