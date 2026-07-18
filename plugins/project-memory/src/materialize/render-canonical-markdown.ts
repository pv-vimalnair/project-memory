import { INSTANCE_ID_PATTERN } from "../contracts/ids.js";
import type {
  CanonicalArtifactType,
  CanonicalMarkdownDocument,
  CanonicalMarkdownEnvelope,
} from "../profile/contracts/canonical-markdown.js";

const ARTIFACT_PREFIX: Readonly<Record<CanonicalArtifactType, string>> = {
  project: "ROOT",
  component: "CMP",
  domain: "DOM",
  initiative: "INIT",
  workstream: "WS",
  task: "TASK",
};

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function hasCanonicalArtifactId(
  envelope: Pick<CanonicalMarkdownEnvelope, "type" | "id">,
): boolean {
  const prefix = ARTIFACT_PREFIX[envelope.type];
  return new RegExp(`^${prefix}-[0-9A-HJKMNP-TV-Z]{26}$`).test(envelope.id);
}

export function isCanonicalMarkdownBody(body: string): boolean {
  return (
    body.length > 1 &&
    !body.includes("\r") &&
    !body.includes("\uFEFF") &&
    body.trim().length > 0 &&
    body.endsWith("\n") &&
    !body.endsWith("\n\n")
  );
}

function assertEnvelope(envelope: CanonicalMarkdownEnvelope): void {
  if (
    !hasCanonicalArtifactId(envelope) ||
    !Number.isInteger(envelope.revision) ||
    envelope.revision < 1 ||
    !INSTANCE_ID_PATTERN.test(envelope.root_id) ||
    !envelope.root_id.startsWith("ROOT-") ||
    envelope.approval_refs.length === 0 ||
    envelope.approval_refs.some(
      (id) => !INSTANCE_ID_PATTERN.test(id) || !id.startsWith("APR-"),
    ) ||
    new Set(envelope.approval_refs).size !== envelope.approval_refs.length
  ) {
    throw new TypeError("canonical Markdown envelope is invalid");
  }
}

export function renderCanonicalMarkdown(
  document: CanonicalMarkdownDocument,
): Uint8Array {
  assertEnvelope(document.envelope);
  if (!isCanonicalMarkdownBody(document.body)) {
    throw new TypeError("canonical Markdown body is invalid");
  }
  const approvalLines = [...document.envelope.approval_refs]
    .sort(compareUtf8)
    .map((id) => `  - ${id}`)
    .join("\n");
  const text = [
    "---",
    `schema: ${document.envelope.schema}`,
    `type: ${document.envelope.type}`,
    `version: ${document.envelope.version}`,
    `id: ${document.envelope.id}`,
    `revision: ${String(document.envelope.revision)}`,
    `root_id: ${document.envelope.root_id}`,
    "approval_refs:",
    approvalLines,
    "---",
    document.body,
  ].join("\n");
  return new TextEncoder().encode(text);
}