import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Type } from "@sinclair/typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emitJsonSchemas } from "../../src/schema/emit.js";
import { registerFoundationSchemas } from "../../src/schema/registrars.js";
import {
  registerProjectSchemas,
  registerSchema,
  resetSchemaRegistryForTests,
} from "../../src/schema/registry.js";
import { validateWithSchema } from "../../src/schema/validate.js";

const temporaryRoots: string[] = [];

beforeEach(() => {
  resetSchemaRegistryForTests();
  registerFoundationSchemas();
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("schema registry", () => {
  it("rejects duplicate schema IDs", () => {
    expect(() =>
      registerSchema(Type.Object({}, {
        $id: "project-memory/v1/root-reference",
        additionalProperties: false,
      })),
    ).toThrow(/duplicate schema id/i);
  });

  it("rejects unknown keys with a stable issue path", () => {
    const result = validateWithSchema("project-memory/v1/root-reference", {
      id: "ROOT-01J00000000000000000000000",
      unexpected: true,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [{
        code: "SCHEMA_ADDITIONAL_PROPERTY",
        path: "/unexpected",
      }],
    });
  });

  it("validates every custom format without coercion", () => {
    registerSchema(Type.Object({
      definition: Type.String({ format: "definition-id" }),
      instance: Type.String({ format: "instance-id" }),
      timestamp: Type.String({ format: "utc-timestamp" }),
      digest: Type.String({ format: "sha256" }),
      version: Type.String({ format: "semantic-version" }),
      revision: Type.String({ format: "git-revision" }),
      relative_path: Type.String({ format: "safe-relative-path" }),
    }, {
      $id: "project-memory/v1/format-fixture",
      additionalProperties: false,
    }));

    const valid = validateWithSchema("project-memory/v1/format-fixture", {
      definition: "product.mobile-app",
      instance: "TASK-01J00000000000000000000000",
      timestamp: "2026-07-14T12:00:00.000Z",
      digest: "a".repeat(64),
      version: "1.2.3",
      revision: "b".repeat(40),
      relative_path: "docs/project-memory/NOW.md",
    });
    expect(valid.ok).toBe(true);

    const invalid = validateWithSchema("project-memory/v1/format-fixture", {
      definition: "Mobile App",
      instance: "TASK-invalid",
      timestamp: "2026-07-14 12:00:00",
      digest: "no",
      version: "latest",
      revision: "main",
      relative_path: "../outside",
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.issues).toHaveLength(7);
      expect(invalid.issues.every((entry) => entry.code === "SCHEMA_FORMAT")).toBe(true);
    }
  });

  it("runs supplied registrars in stable name order", () => {
    resetSchemaRegistryForTests();
    const calls: string[] = [];
    function zRegistrar(): readonly ["project-memory/v1/z"] {
      calls.push("z");
      registerSchema(Type.Object({}, {
        $id: "project-memory/v1/z",
        additionalProperties: false,
      }));
      return ["project-memory/v1/z"];
    }
    function aRegistrar(): readonly ["project-memory/v1/a"] {
      calls.push("a");
      registerSchema(Type.Object({}, {
        $id: "project-memory/v1/a",
        additionalProperties: false,
      }));
      return ["project-memory/v1/a"];
    }

    const result = registerProjectSchemas([zRegistrar, aRegistrar]);

    expect(result).toMatchObject({
      ok: true,
      value: ["project-memory/v1/a", "project-memory/v1/z"],
    });
    expect(calls).toEqual(["a", "z"]);
  });

  it("converts registrar defects into stable issues", () => {
    resetSchemaRegistryForTests();
    function brokenRegistrar(): readonly never[] {
      throw new Error("broken registrar");
    }

    expect(registerProjectSchemas([brokenRegistrar])).toMatchObject({
      ok: false,
      issues: [{ code: "SCHEMA_REGISTRATION_FAILED" }],
    });
  });

  it("emits every explicitly registered schema deterministically", async () => {
    const output = await mkdtemp(path.join(tmpdir(), "project-memory-schema-"));
    temporaryRoots.push(output);
    const registration = registerProjectSchemas([]);
    expect(registration.ok).toBe(true);

    const first = await emitJsonSchemas(pathToFileURL(`${output}${path.sep}`));
    const firstIndex = await readFile(path.join(output, "schema-index.json"), "utf8");
    const second = await emitJsonSchemas(pathToFileURL(`${output}${path.sep}`));
    const secondIndex = await readFile(path.join(output, "schema-index.json"), "utf8");

    expect(first.ok && first.value.length).toBe(3);
    expect(second.ok).toBe(true);
    expect(secondIndex).toBe(firstIndex);
    expect(JSON.parse(firstIndex)).toMatchObject({
      schemas: [
        { id: "project-memory/v1/planned-write" },
        { id: "project-memory/v1/root-reference" },
        { id: "project-memory/v1/runtime-issue" },
      ],
    });
  });
});
