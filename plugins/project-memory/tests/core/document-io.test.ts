import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  emitGeneratedYaml,
  parseJsonDocument,
  parseYamlDocument,
  readUtf8Document,
} from "../../src/core/document-io.js";

const fixtureRoot = new URL("../fixtures/documents/", import.meta.url);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("document IO", () => {
  it("preserves JSON-compatible YAML scalar types", async () => {
    const result = await readUtf8Document(fixtureRoot, "valid.yaml");

    expect(result).toEqual({
      ok: true,
      value: {
        active: true,
        count: 3,
        empty: null,
        items: ["alpha", 2.5],
        nested: { label: "yes" },
      },
      warnings: [],
    });
  });

  it("parses strict JSON and rejects duplicate decoded keys", async () => {
    expect((await readUtf8Document(fixtureRoot, "valid.json")).ok).toBe(true);
    expect(await readUtf8Document(fixtureRoot, "duplicate.json")).toMatchObject({
      ok: false,
      issues: [{ code: "JSON_DUPLICATE_KEY" }],
    });
    expect(parseJsonDocument('{"a":1,"\\u0061":2}', "inline.json")).toMatchObject({
      ok: false,
      issues: [{ code: "JSON_DUPLICATE_KEY" }],
    });
  });

  it.each([
    ["duplicate key", "name: first\nname: second\n", "YAML_PARSE_FAILED"],
    ["alias", "source: &x 1\ncopy: *x\n", "YAML_ALIAS_FORBIDDEN"],
    ["merge alias", "source: &x {a: 1}\ncopy: {<<: *x}\n", "YAML_ALIAS_FORBIDDEN"],
    ["custom tag", "value: !custom data\n", "YAML_TAG_FORBIDDEN"],
    ["timestamp tag", "value: !!timestamp 2026-07-14\n", "YAML_TAG_FORBIDDEN"],
    ["binary tag", "value: !!binary SGk=\n", "YAML_TAG_FORBIDDEN"],
    ["set tag", "value: !!set {x: null}\n", "YAML_TAG_FORBIDDEN"],
    ["non-string key", "1: value\n", "YAML_NON_STRING_KEY"],
    ["non-finite number", "value: .inf\n", "YAML_NON_JSON_VALUE"],
  ])("rejects unsafe YAML: %s", (_label, source, code) => {
    expect(parseYamlDocument(source, "inline.yaml")).toMatchObject({
      ok: false,
      issues: [{ code }],
    });
  });

  it("requires exactly one YAML document", () => {
    expect(parseYamlDocument("---\na: 1\n---\nb: 2\n", "multi.yaml")).toMatchObject({
      ok: false,
      issues: [{ code: "YAML_DOCUMENT_COUNT" }],
    });
  });

  it("rejects path escape, UTF-8 BOM, malformed UTF-8, and unknown extensions", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "project-memory-doc-"));
    temporaryRoots.push(temporaryRoot);
    await mkdir(path.join(temporaryRoot, "docs"));
    await writeFile(path.join(temporaryRoot, "docs", "bom.yaml"),
      Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x3a, 0x20, 0x31]));
    await writeFile(path.join(temporaryRoot, "docs", "invalid.yaml"),
      Buffer.from([0xc3, 0x28]));
    await writeFile(path.join(temporaryRoot, "docs", "unknown.txt"), "value");
    const root = pathToFileURL(`${temporaryRoot}${path.sep}`);

    expect(await readUtf8Document(root, "../outside.yaml")).toMatchObject({
      ok: false,
      issues: [{ code: "PATH_ESCAPE" }],
    });
    expect(await readUtf8Document(root, "docs/bom.yaml")).toMatchObject({
      ok: false,
      issues: [{ code: "UTF8_BOM_FORBIDDEN" }],
    });
    expect(await readUtf8Document(root, "docs/invalid.yaml")).toMatchObject({
      ok: false,
      issues: [{ code: "UTF8_INVALID" }],
    });
    expect(await readUtf8Document(root, "docs/unknown.txt")).toMatchObject({
      ok: false,
      issues: [{ code: "DOCUMENT_EXTENSION_UNSUPPORTED" }],
    });
  });

  it("emits sorted alias-free generated YAML with one LF", () => {
    const result = emitGeneratedYaml({ z: 1, nested: { b: true, a: "yes" } });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('nested:\n  a: "yes"\n  b: true\nz: 1\n');
      expect(result.value).not.toContain("&");
      expect(result.value).not.toContain("*");
      expect(parseYamlDocument(result.value, "generated.yaml").ok).toBe(true);
    }
  });

  it("reports fixture paths without absolute-path leakage", async () => {
    const result = await readUtf8Document(fixtureRoot, "duplicate.yaml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe("duplicate.yaml");
      expect(result.issues[0]?.message).not.toContain(fileURLToPath(fixtureRoot));
    }
  });
});
