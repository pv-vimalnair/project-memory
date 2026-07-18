import type { PlannedWrite } from "../contracts/planned-write.js";

const MARKDOWN_META = new Set([
  "\\",
  "`",
  "*",
  "_",
  "{",
  "}",
  "[",
  "]",
  "<",
  ">",
  "#",
  "+",
  "-",
  "!",
  "|",
]);

export function acceptedMarkdownText(value: string): string {
  let result = "";
  for (const character of value) {
    if (character === "\r") result += "\\r";
    else if (character === "\n") result += "\\n";
    else if (character === "\t") result += "\\t";
    else if (MARKDOWN_META.has(character)) result += `\\${character}`;
    else result += character;
  }
  return result;
}

export function markdownBody(lines: readonly string[]): string {
  return `${lines.join("\n").trimEnd()}\n`;
}

export function markdownList(
  heading: string,
  values: readonly string[],
  emptyLabel: string,
): string[] {
  return [
    `## ${heading}`,
    "",
    ...(values.length === 0
      ? [`_${acceptedMarkdownText(emptyLabel)}_`]
      : values.map((value) => `- ${acceptedMarkdownText(value)}`)),
    "",
  ];
}

export function sourceWrite(
  relativePath: string,
  bytes: Uint8Array,
): PlannedWrite {
  return {
    relative_path: relativePath,
    bytes,
    expected_existing_sha256: null,
    mode: "create_or_replace",
  };
}

export function acceptedListFrontMatter(
  type: "constraints" | "policies" | "blueprint-document",
  rootId: string,
  approvalRefs: readonly string[],
  fields: readonly string[] = [],
): string[] {
  return [
    "---",
    "schema: project-memory/accepted-source-list",
    `type: ${type}`,
    "version: 1.0.0",
    ...fields,
    `root_id: ${rootId}`,
    "approval_refs:",
    ...[...approvalRefs].sort().map((reference) => `  - ${reference}`),
    "---",
  ];
}
