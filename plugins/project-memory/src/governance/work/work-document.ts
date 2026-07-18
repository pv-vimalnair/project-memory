import { lstat, readFile } from "node:fs/promises";

import {
  canonicalJson,
  failure,
  parseCanonicalMarkdown,
  renderCanonicalMarkdown,
  resolveInside,
  sha256,
  success,
  type CanonicalMarkdownDocument,
  type PlannedWrite,
  type RuntimeResult,
} from "../../index.js";
import type { TaskPacket } from "../../planning/types.js";
import type {
  CreateInitiativeInput,
  CreateWorkstreamInput,
  WorkArtifactType,
  WorkDocumentReader,
  WorkStatus,
} from "./work-lifecycle-contracts.js";

const STATUS_LINE = /^Status: ([a-z_]+)$/gm;

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

export function initiativeDocumentPath(initiativeId: string): string {
  return `docs/project-memory/initiatives/${initiativeId}/INITIATIVE.md`;
}

export function workstreamDocumentPath(workstreamId: string): string {
  return `docs/project-memory/workstreams/${workstreamId}/WORKSTREAM.md`;
}

export function taskDocumentPath(workstreamId: string, taskId: string): string {
  return `docs/project-memory/workstreams/${workstreamId}/tasks/${taskId}/TASK.md`;
}

export function lifecycleDocumentPath(
  artifactType: WorkArtifactType,
  artifactId: string,
  workstreamId: string | null,
): RuntimeResult<string> {
  if (artifactType === "initiative") return success(initiativeDocumentPath(artifactId));
  if (artifactType === "workstream") return success(workstreamDocumentPath(artifactId));
  return workstreamId === null
    ? failure("work.workstream_required", "task packet transitions require their workstream ID", artifactId)
    : success(taskDocumentPath(workstreamId, artifactId));
}

function bullets(values: readonly string[]): string[] {
  return values.length === 0 ? ["- _None._"] : unique(values).map((value) => `- ${value}`);
}

function envelope(
  type: CanonicalMarkdownDocument["envelope"]["type"],
  id: string,
  rootId: string,
  approvalRefs: readonly string[],
): CanonicalMarkdownDocument["envelope"] {
  return {
    schema: "project-memory/canonical-markdown",
    type,
    version: "1.0.0",
    id,
    revision: 1,
    root_id: rootId,
    approval_refs: unique(approvalRefs),
  };
}

export function renderInitiative(
  input: CreateInitiativeInput,
  rootId: string,
  approvals: readonly string[],
): Uint8Array {
  return renderCanonicalMarkdown({
    envelope: envelope("initiative", input.initiative_id, rootId, approvals),
    body: [
      `# ${input.title.trim()}`,
      "",
      "Status: proposed",
      `Owners: ${unique(input.owners).join(", ")}`,
      "",
      "## Objective",
      "",
      input.objective.trim(),
      "",
      "## Acceptance Criteria",
      "",
      ...bullets(input.acceptance_criteria),
      "",
    ].join("\n"),
  });
}

export function renderWorkstream(
  input: CreateWorkstreamInput,
  rootId: string,
  approvals: readonly string[],
): Uint8Array {
  return renderCanonicalMarkdown({
    envelope: envelope("workstream", input.workstream_id, rootId, approvals),
    body: [
      `# ${input.title.trim()}`,
      "",
      "Status: planned",
      `Owners: ${unique(input.owners).join(", ")}`,
      `Initiative: ${input.initiative_id ?? "none"}`,
      "",
      "## Objective",
      "",
      input.objective.trim(),
      "",
      "## Dependencies",
      "",
      ...bullets(input.dependencies),
      "",
    ].join("\n"),
  });
}

export function renderTaskPacket(
  packet: TaskPacket,
  rootId: string,
  approvals: readonly string[],
): Uint8Array {
  const packetJson = canonicalJson(packet);
  return renderCanonicalMarkdown({
    envelope: envelope("task", packet.task_id, rootId, approvals),
    body: [
      `# Task ${packet.task_id}`,
      "",
      "Status: issued",
      `Assignee: ${packet.assignment.assignee_id}`,
      `Packet: ${packet.packet_id}`,
      `Initiative: ${packet.initiative_id ?? "none"}`,
      `Workstream: ${packet.workstream_id}`,
      `Task packet SHA-256: ${sha256(packetJson)}`,
      "",
      "## Goal",
      "",
      packet.goal.trim(),
      "",
      "## Canonical Task Packet",
      "",
      "```json",
      packetJson,
      "```",
      "",
    ].join("\n"),
  });
}

export interface ParsedWorkDocument {
  readonly document: CanonicalMarkdownDocument;
  readonly status: WorkStatus;
}

export function parseWorkDocument(
  bytes: Uint8Array,
  artifactType: WorkArtifactType,
  artifactId: string,
  rootId: string,
): RuntimeResult<ParsedWorkDocument> {
  const parsed = parseCanonicalMarkdown(bytes);
  if (!parsed.ok) return parsed;
  const expectedType = artifactType === "task_packet" ? "task" : artifactType;
  if (
    parsed.value.envelope.type !== expectedType ||
    parsed.value.envelope.id !== artifactId ||
    parsed.value.envelope.root_id !== rootId
  ) {
    return failure("work.document_binding_drift", "work document type, ID, or root changed", artifactId);
  }
  const statuses = [...parsed.value.body.matchAll(STATUS_LINE)].map((match) => match[1]);
  if (statuses.length !== 1 || statuses[0] === undefined) {
    return failure("work.status_invalid", "work document must contain exactly one canonical status line", artifactId);
  }
  return success({ document: parsed.value, status: statuses[0] as WorkStatus });
}

export function transitionWorkDocument(
  current: ParsedWorkDocument,
  nextStatus: WorkStatus,
  approvalIds: readonly string[],
): Uint8Array {
  return renderCanonicalMarkdown({
    envelope: {
      ...current.document.envelope,
      revision: current.document.envelope.revision + 1,
      approval_refs: unique([...current.document.envelope.approval_refs, ...approvalIds]),
    },
    body: current.document.body.replace(STATUS_LINE, `Status: ${nextStatus}`),
  });
}

export function createDocumentWrite(relativePath: string, bytes: Uint8Array): PlannedWrite {
  return { relative_path: relativePath, bytes, expected_existing_sha256: null, mode: "create" };
}

export class FilesystemWorkDocumentReader implements WorkDocumentReader {
  async read(root: URL, relativePath: string): Promise<RuntimeResult<Uint8Array | null>> {
    const target = await resolveInside(root, relativePath);
    if (!target.ok) return target;
    try {
      const info = await lstat(target.value);
      if (info.isSymbolicLink() || !info.isFile()) {
        return failure("work.document_path_unsafe", "work documents must be regular files", relativePath);
      }
      return success(new Uint8Array(await readFile(target.value)));
    } catch (error: unknown) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? success(null)
        : failure("work.document_read_failed", error instanceof Error ? error.message : String(error), relativePath);
    }
  }
}
