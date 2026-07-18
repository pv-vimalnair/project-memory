import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CanonicalMarkdownEnvelopeSchema,
  registerProfileSchemas,
} from "../../src/profile/contracts/index.js";
import { parseCanonicalMarkdown } from "../../src/materialize/parse-canonical-markdown.js";
import { renderCanonicalMarkdown } from "../../src/materialize/render-canonical-markdown.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const VALID_FIXTURES = [
  ["project.md", "project"],
  ["component.md", "component"],
  ["domain.md", "domain"],
  ["initiative.md", "initiative"],
  ["workstream.md", "workstream"],
  ["task.md", "task"],
] as const;

const INVALID_FIXTURES = [
  "missing-opening-delimiter.md",
  "unknown-envelope-key.md",
  "wrong-id-prefix.md",
  "zero-revision.md",
  "crlf.bin",
  "bom.md",
  "body-without-trailing-newline.md",
  "duplicate-envelope-key.md",
  "alias.md",
  "tag.md",
  "reordered-envelope-keys.md",
  "unsorted-approval-refs.md",
  "empty-body.md",
] as const;

async function fixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(
      new URL(`../fixtures/materialize/canonical-markdown/${name}`, import.meta.url),
    ),
  );
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  registerProfileSchemas();
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("canonical markdown", () => {
  it.each(VALID_FIXTURES)("round trips %s bytes exactly", async (path, type) => {
    const bytes = await fixtureBytes(path);
    const parsed = parseCanonicalMarkdown(bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.envelope.type).toBe(type);
    expect(renderCanonicalMarkdown(parsed.value)).toEqual(bytes);
  });

  it.each(INVALID_FIXTURES)(
    "rejects non-canonical document %s",
    async (fixture) => {
      expect(parseCanonicalMarkdown(await fixtureBytes(fixture)).ok).toBe(false);
    },
  );

  it("keeps later delimiter lines as ordinary body bytes", async () => {
    const parsed = parseCanonicalMarkdown(await fixtureBytes("project.md"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.body).toContain("\n---\n");
  });

  it("registers the strict envelope schema with the profile surface", () => {
    expect(CanonicalMarkdownEnvelopeSchema.$id).toBe(
      "project-memory/v1/canonical-markdown-envelope",
    );
  });
});