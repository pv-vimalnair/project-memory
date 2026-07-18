import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import {
  decodeStrictUtf8,
  parseYamlDocument,
} from "../core/document-io.js";
import type {
  CanonicalMarkdownDocument,
  CanonicalMarkdownEnvelope,
} from "../profile/contracts/canonical-markdown.js";
import { validateWithSchema } from "../schema/validate.js";
import {
  hasCanonicalArtifactId,
  isCanonicalMarkdownBody,
  renderCanonicalMarkdown,
} from "./render-canonical-markdown.js";

interface CanonicalMarkdownSections {
  readonly front_matter: string;
  readonly body: string;
}

function splitFrontMatter(
  text: string,
): RuntimeResult<CanonicalMarkdownSections> {
  if (!text.startsWith("---\n")) {
    return failure(
      "CANONICAL_MARKDOWN_OPENING_DELIMITER",
      "canonical Markdown must begin with an opening delimiter at byte zero",
      "/",
    );
  }
  const marker = "\n---\n";
  const terminator = text.indexOf(marker, 4);
  if (terminator < 0) {
    return failure(
      "CANONICAL_MARKDOWN_CLOSING_DELIMITER",
      "canonical Markdown front matter has no closing delimiter line",
      "/",
    );
  }
  return success({
    front_matter: text.slice(4, terminator + 1),
    body: text.slice(terminator + marker.length),
  });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function parseCanonicalMarkdown(
  bytes: Uint8Array,
): RuntimeResult<CanonicalMarkdownDocument> {
  const decoded = decodeStrictUtf8(bytes, "canonical-markdown");
  if (!decoded.ok) return decoded;
  if (decoded.value.includes("\r")) {
    return failure(
      "CANONICAL_MARKDOWN_LF_REQUIRED",
      "canonical Markdown permits LF line endings only",
      "/",
    );
  }
  const sections = splitFrontMatter(decoded.value);
  if (!sections.ok) return sections;
  const parsedYaml = parseYamlDocument(
    sections.value.front_matter,
    "canonical-markdown-front-matter",
  );
  if (!parsedYaml.ok) return parsedYaml;
  const envelope = validateWithSchema<CanonicalMarkdownEnvelope>(
    "project-memory/v1/canonical-markdown-envelope",
    parsedYaml.value,
  );
  if (!envelope.ok) return envelope;
  if (!hasCanonicalArtifactId(envelope.value)) {
    return failure(
      "CANONICAL_MARKDOWN_ID_PREFIX",
      "canonical artifact ID prefix does not match its artifact type",
      "/id",
    );
  }
  if (!isCanonicalMarkdownBody(sections.value.body)) {
    return failure(
      "CANONICAL_MARKDOWN_BODY_INVALID",
      "canonical Markdown requires a non-empty body and exactly one final newline",
      "/body",
    );
  }
  const document: CanonicalMarkdownDocument = {
    envelope: envelope.value,
    body: sections.value.body,
  };
  let rendered: Uint8Array;
  try {
    rendered = renderCanonicalMarkdown(document);
  } catch {
    return failure(
      "CANONICAL_MARKDOWN_NON_CANONICAL",
      "canonical Markdown could not be rendered deterministically",
      "/",
    );
  }
  return bytesEqual(rendered, bytes)
    ? success(document)
    : failure(
        "CANONICAL_MARKDOWN_NON_CANONICAL",
        "canonical Markdown bytes do not match deterministic rendering",
        "/",
      );
}