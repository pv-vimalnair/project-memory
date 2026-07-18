import type { PlannedWrite } from "../contracts/planned-write.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type {
  ComponentInstanceData,
  ResolvedComponentInstance,
} from "../profile/contracts/index.js";
import { renderCanonicalMarkdown } from "./render-canonical-markdown.js";
import {
  acceptedMarkdownText,
  markdownBody,
  markdownList,
  sourceWrite,
} from "./source-markdown.js";

export function componentSourcePath(instanceId: string): string {
  return `docs/project-memory/components/${instanceId}/COMPONENT.md`;
}

function repositories(record: ComponentInstanceData): string[] {
  return record.repositories.map(
    (binding) =>
      `${binding.repository} — paths: ${binding.paths.join(", ")}`,
  );
}

function links(record: ComponentInstanceData): string[] {
  return record.links.map((link) => `${link.label} — ${link.href}`);
}

export function renderComponentSource(
  rootId: string,
  record: ComponentInstanceData,
  resolved: ResolvedComponentInstance,
): RuntimeResult<PlannedWrite> {
  if (
    record.root_id !== rootId ||
    record.id !== resolved.instance_id ||
    record.definition.id !== resolved.definition_id ||
    record.definition.version !== resolved.definition_version ||
    record.slug !== resolved.slug
  ) {
    return failure(
      "PROFILE_COMPONENT_SOURCE_MISMATCH",
      "accepted component facts do not match the resolved stable binding",
      record.id,
    );
  }
  const body = markdownBody([
    `# Component — ${acceptedMarkdownText(record.name)}`,
    "",
    "## Identity",
    "",
    `- Stable ID: ${record.id}`,
    `- Definition: ${record.definition.id}@${record.definition.version}`,
    `- Slug: ${acceptedMarkdownText(record.slug)}`,
    `- Status: ${record.status}`,
    "",
    "## Purpose",
    "",
    acceptedMarkdownText(record.purpose),
    "",
    ...markdownList("Owners", record.owners, "No accepted owners."),
    ...markdownList(
      "Inclusion Boundary",
      record.inclusion_boundary,
      "No accepted inclusion boundary.",
    ),
    ...markdownList(
      "Exclusion Boundary",
      record.exclusion_boundary,
      "No accepted exclusion boundary.",
    ),
    ...markdownList("Repositories", repositories(record), "No accepted repositories."),
    ...markdownList("Dependencies", record.dependencies, "No accepted dependencies."),
    ...markdownList("Risks", record.risks, "No accepted risks."),
    ...markdownList("Links", links(record), "No accepted links."),
  ]);
  try {
    return success(
      sourceWrite(
        componentSourcePath(record.id),
        renderCanonicalMarkdown({
          envelope: {
            schema: "project-memory/canonical-markdown",
            type: "component",
            version: "1.0.0",
            id: record.id,
            revision: record.revision,
            root_id: rootId,
            approval_refs: [...record.approval_refs],
          },
          body,
        }),
      ),
    );
  } catch {
    return failure(
      "PROFILE_COMPONENT_RENDER_FAILED",
      "accepted component source could not be rendered canonically",
      record.id,
    );
  }
}
