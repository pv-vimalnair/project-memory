import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BlueprintDefinition } from "../../src/catalog/contracts/index.js";
import { canonicalJson } from "../../src/core/canonical-json.js";
import { sha256 } from "../../src/core/hash.js";
import { buildSelectedCatalogLock } from "../../src/profile/build-selected-catalog-lock.js";
import type {
  ResolvedCatalogSelection,
  ResolvedCatalogSourceFile,
} from "../../src/profile/catalog-selection-resolver.js";
import type { SelectedCatalogLock } from "../../src/profile/contracts/index.js";
import { buildSelectedCatalogVendoring } from "../../src/profile/vendor-selected-catalog.js";
import { verifySelectedCatalogLock } from "../../src/profile/verify-selected-catalog-lock.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const LOCK_PATH = "docs/project-memory/catalog.lock.json";
const RELEASE_HASH = "a".repeat(64);
const temporaryRoots: string[] = [];

const blueprint: BlueprintDefinition = {
  id: "application.test",
  version: "1.0.0",
  status: "active",
  group_id: "blueprint-group.test",
  allowed_root_kinds: ["product"],
  primary_archetype: "application-service",
  purpose: "Test selected catalog vendoring.",
  selection: {
    feature_schema_version: "1.0.0",
    required_signals: [],
    positive_signals: [],
    negative_signals: [],
    exclusions: [],
    max_positive_weight: 1,
    specificity_rank: 1,
    precedence: 1,
  },
  overlays: { baked: [], defaults: [], forbidden: [] },
  default_components: [],
  default_domains: [],
  adapter_slots: ["agent"],
  required_documents: ["PROJECT.md"],
  validation_gates: ["references valid"],
  positive_examples: ["A selected catalog fixture."],
  negative_examples: ["An unrelated fixture."],
};

function sourceFile(
  kind: ResolvedCatalogSourceFile["kind"],
  id: string,
  sourcePath: string,
  targetPath: string,
  text: string,
): ResolvedCatalogSourceFile {
  const bytes = new Uint8Array(Buffer.from(text, "utf8"));
  return {
    kind,
    definition_ids: [id],
    source_relative_path: sourcePath,
    target_relative_path: targetPath,
    bytes,
    sha256: sha256(bytes),
  };
}

function resolvedSelection(): ResolvedCatalogSelection {
  const files = [
    sourceFile(
      "definition-source",
      "blueprint-group.test",
      "blueprint-groups/blueprint-group.test.yaml",
      "docs/project-memory/catalog/selected/blueprint-groups/blueprint-group.test.yaml",
      "blueprint_group:\n  id: blueprint-group.test\n",
    ),
    sourceFile(
      "companion-core",
      "companion.mutation",
      "companion-rules/companion.mutation.core.yaml",
      "docs/project-memory/catalog/selected/companion-rules/companion.mutation.core.yaml",
      "id: companion.mutation\n",
    ),
    sourceFile(
      "companion-taxonomy",
      "companion.mutation",
      "companion-rules/companion.mutation.taxonomy.yaml",
      "docs/project-memory/catalog/selected/companion-rules/companion.mutation.taxonomy.yaml",
      "companion_taxonomy:\n  rule_id: companion.mutation\n",
    ),
    sourceFile(
      "generated-schema",
      "engineering.feature.implement",
      "schemas/project-memory/v1/pattern-core.schema.json",
      "schemas/project-memory/v1/pattern-core.schema.json",
      "{\"$id\":\"project-memory/v1/pattern-core\"}\n",
    ),
    sourceFile(
      "pattern-taxonomy",
      "engineering.feature.implement",
      "patterns/engineering/engineering.feature.implement.taxonomy.yaml",
      "docs/project-memory/catalog/selected/patterns/engineering/engineering.feature.implement.taxonomy.yaml",
      "pattern_taxonomy:\n  pattern_id: engineering.feature.implement\n",
    ),
    sourceFile(
      "blueprint",
      "application.test",
      "blueprints/application-service/application.test.yaml",
      "docs/project-memory/catalog/selected/blueprints/application-service/application.test.yaml",
      "blueprint:\n  id: application.test\n",
    ),
    sourceFile(
      "pattern-core",
      "engineering.feature.implement",
      "patterns/engineering/engineering.feature.implement.core.yaml",
      "docs/project-memory/catalog/selected/patterns/engineering/engineering.feature.implement.core.yaml",
      "id: engineering.feature.implement\n",
    ),
  ];
  return {
    release: "1.0.0",
    release_hash: RELEASE_HASH,
    files,
    blueprint,
    definitions: [],
    required_schema_ids: ["project-memory/v1/pattern-core"],
  };
}

async function temporaryTarget(): Promise<{ path: string; url: URL }> {
  const target = await mkdtemp(path.join(tmpdir(), "project-memory-selected-catalog-"));
  temporaryRoots.push(target);
  return { path: target, url: pathToFileURL(`${target}${path.sep}`) };
}

async function writeRelative(
  root: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function materializeTarget(
  root: string,
  lock: SelectedCatalogLock,
  writes: readonly { readonly relative_path: string; readonly bytes: Uint8Array }[],
): Promise<void> {
  for (const write of writes) {
    await writeRelative(root, write.relative_path, write.bytes);
  }
  await writeRelative(
    root,
    LOCK_PATH,
    new Uint8Array(Buffer.from(canonicalJson(lock), "utf8")),
  );
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("selected catalog vendoring", () => {
  it("locks exact bytes at sorted final target paths", () => {
    const selection = resolvedSelection();
    const lock = buildSelectedCatalogLock(selection);
    if (!lock.ok) throw new Error(JSON.stringify(lock.issues, null, 2));
    const writes = buildSelectedCatalogVendoring(selection, lock.value);
    if (!writes.ok) throw new Error(JSON.stringify(writes.issues, null, 2));

    expect(lock.value.entries.map((entry) => entry.target_path)).toEqual(
      [...lock.value.entries]
        .map((entry) => entry.target_path)
        .sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
    );
    for (const entry of lock.value.entries) {
      const write = writes.value.find(
        (candidate) => candidate.relative_path === entry.target_path,
      );
      expect(write).toBeDefined();
      if (write === undefined) continue;
      expect(entry.sha256).toBe(sha256(write.bytes));
      expect(entry.byte_length).toBe(write.bytes.byteLength);
      expect(write.bytes).toBe(
        selection.files.find(
          (file) => file.target_relative_path === entry.target_path,
        )?.bytes,
      );
    }
  });

  it("verifies from target bytes with no source release argument", async () => {
    const target = await temporaryTarget();
    const selection = resolvedSelection();
    const lock = buildSelectedCatalogLock(selection);
    if (!lock.ok) throw new Error(JSON.stringify(lock.issues, null, 2));
    const writes = buildSelectedCatalogVendoring(selection, lock.value);
    if (!writes.ok) throw new Error(JSON.stringify(writes.issues, null, 2));
    await materializeTarget(target.path, lock.value, writes.value);
    resetSchemaRegistryForTests();

    await expect(verifySelectedCatalogLock(target.url)).resolves.toMatchObject({
      ok: true,
      value: { valid: true, lock_hash: lock.value.lock_hash, external_reads: [] },
    });
  });

  it("rejects one changed target byte", async () => {
    const target = await temporaryTarget();
    const selection = resolvedSelection();
    const lock = buildSelectedCatalogLock(selection);
    if (!lock.ok) throw new Error(JSON.stringify(lock.issues, null, 2));
    const writes = buildSelectedCatalogVendoring(selection, lock.value);
    if (!writes.ok) throw new Error(JSON.stringify(writes.issues, null, 2));
    await materializeTarget(target.path, lock.value, writes.value);
    const changed = lock.value.entries[0];
    if (changed === undefined) throw new Error("lock fixture is empty");
    const original = writes.value.find(
      (write) => write.relative_path === changed.target_path,
    );
    if (original === undefined) throw new Error("write fixture is missing");
    const tampered = Uint8Array.from(original.bytes);
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    await writeRelative(target.path, changed.target_path, tampered);

    await expect(verifySelectedCatalogLock(target.url)).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "SELECTED_CATALOG_TARGET_HASH_MISMATCH" }],
    });
  });

  it("rejects a missing locked target", async () => {
    const target = await temporaryTarget();
    const selection = resolvedSelection();
    const lock = buildSelectedCatalogLock(selection);
    if (!lock.ok) throw new Error(JSON.stringify(lock.issues, null, 2));
    const writes = buildSelectedCatalogVendoring(selection, lock.value);
    if (!writes.ok) throw new Error(JSON.stringify(writes.issues, null, 2));
    await materializeTarget(target.path, lock.value, writes.value);
    const missing = lock.value.entries[0];
    if (missing === undefined) throw new Error("lock fixture is empty");
    await unlink(path.join(target.path, ...missing.target_path.split("/")));

    await expect(verifySelectedCatalogLock(target.url)).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "SELECTED_CATALOG_TARGET_MISSING" }],
    });
  });

  it("rejects an unlisted target under a compiler-owned namespace", async () => {
    const target = await temporaryTarget();
    const selection = resolvedSelection();
    const lock = buildSelectedCatalogLock(selection);
    if (!lock.ok) throw new Error(JSON.stringify(lock.issues, null, 2));
    const writes = buildSelectedCatalogVendoring(selection, lock.value);
    if (!writes.ok) throw new Error(JSON.stringify(writes.issues, null, 2));
    await materializeTarget(target.path, lock.value, writes.value);
    const unlisted = await readFile(
      new URL("../fixtures/profile/selected-catalog/unlisted-target.yaml", import.meta.url),
    );
    await writeRelative(
      target.path,
      "docs/project-memory/catalog/selected/unlisted.yaml",
      unlisted,
    );

    await expect(verifySelectedCatalogLock(target.url)).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "SELECTED_CATALOG_UNLISTED_TARGET" }],
    });
  });

  it("rejects a generated schema mapped outside its owned namespace", () => {
    const selection = resolvedSelection();
    const schema = selection.files.find((file) => file.kind === "generated-schema");
    if (schema === undefined) throw new Error("schema fixture missing");
    const result = buildSelectedCatalogLock({
      ...selection,
      files: [
        ...selection.files.filter((file) => file !== schema),
        { ...schema, target_relative_path: "docs/project-memory/schema.json" },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "SELECTED_CATALOG_TARGET_NAMESPACE_INVALID" }],
    });
  });

  it("rejects duplicate final target paths", () => {
    const selection = resolvedSelection();
    const [first, second] = selection.files.filter(
      (file) => file.kind !== "generated-schema",
    );
    if (first === undefined || second === undefined) throw new Error("file fixture missing");
    const result = buildSelectedCatalogLock({
      ...selection,
      files: [first, { ...second, target_relative_path: first.target_relative_path }],
    });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "SELECTED_CATALOG_TARGET_DUPLICATE" }],
    });
  });

  it("rejects an incomplete core and taxonomy pair", () => {
    const selection = resolvedSelection();
    const result = buildSelectedCatalogLock({
      ...selection,
      files: selection.files.filter((file) => file.kind !== "pattern-taxonomy"),
    });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "SELECTED_CATALOG_HALF_MISSING" }],
    });
  });

  it("rejects unknown lock keys without a runtime registry", async () => {
    const target = await temporaryTarget();
    const selection = resolvedSelection();
    const lock = buildSelectedCatalogLock(selection);
    if (!lock.ok) throw new Error(JSON.stringify(lock.issues, null, 2));
    const writes = buildSelectedCatalogVendoring(selection, lock.value);
    if (!writes.ok) throw new Error(JSON.stringify(writes.issues, null, 2));
    await materializeTarget(target.path, lock.value, writes.value);
    await writeRelative(
      target.path,
      LOCK_PATH,
      new Uint8Array(
        Buffer.from(canonicalJson({ ...lock.value, invented: true }), "utf8"),
      ),
    );
    resetSchemaRegistryForTests();

    await expect(verifySelectedCatalogLock(target.url)).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "SELECTED_CATALOG_LOCK_INVALID" }],
    });
  });

  it("rejects a reordered lock even when its hash is recomputed", async () => {
    const target = await temporaryTarget();
    const selection = resolvedSelection();
    const lock = buildSelectedCatalogLock(selection);
    if (!lock.ok) throw new Error(JSON.stringify(lock.issues, null, 2));
    const writes = buildSelectedCatalogVendoring(selection, lock.value);
    if (!writes.ok) throw new Error(JSON.stringify(writes.issues, null, 2));
    const withoutHash = {
      schema_version: lock.value.schema_version,
      catalog_release: lock.value.catalog_release,
      source_release_hash: lock.value.source_release_hash,
      entries: [...lock.value.entries].reverse(),
    };
    const reordered: SelectedCatalogLock = {
      ...withoutHash,
      lock_hash: sha256(canonicalJson(withoutHash)),
    };
    await materializeTarget(target.path, reordered, writes.value);

    await expect(verifySelectedCatalogLock(target.url)).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "SELECTED_CATALOG_LOCK_ORDER_INVALID" }],
    });
  });
});
