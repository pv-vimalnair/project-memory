import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { canonicalMutationPlanHash } from "../../src/contracts/canonical-mutation-plan.js";
import type { PlannedWrite } from "../../src/contracts/planned-write.js";
import {
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../../src/contracts/runtime-result.js";
import { sha256 } from "../../src/core/hash.js";
import { profileLockHash } from "../../src/profile/build-profile-lock.js";
import {
  selectedCatalogLockHash,
} from "../../src/profile/build-selected-catalog-lock.js";
import type {
  ProfilePlanningDependencies,
  ProfileTargetReader,
} from "../../src/profile/build-profile-mutation-plan.js";
import { createProfileCompiler } from "../../src/profile/profile-compiler.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import {
  createCompilerFixture,
  type CompilerFixture,
} from "../helpers/profile-compiler-fixture.js";

const PROJECT_SOURCE_PATH = "docs/project-memory/source/PROJECT.md";
const COMPONENT_SOURCE_PATH =
  "docs/project-memory/components/CMP-01J00000000000000000000000/COMPONENT.md";
const DOMAIN_SOURCE_PATH =
  "docs/project-memory/domains/DOM-01J00000000000000000000000/DOMAIN.md";

class MemoryTargetReader implements ProfileTargetReader {
  readonly reads: string[] = [];
  readonly writeCalls: string[] = [];
  readonly gitMutationCalls: string[] = [];

  constructor(private readonly existing = new Map<string, Uint8Array>()) {}

  read(
    _root: URL,
    relativePath: string,
  ): Promise<RuntimeResult<Uint8Array | null>> {
    this.reads.push(relativePath);
    return Promise.resolve(success(this.existing.get(relativePath) ?? null));
  }
}

function draft(relativePath: string, text: string, mode: PlannedWrite["mode"] = "create_or_replace"): PlannedWrite {
  return {
    relative_path: relativePath,
    bytes: new TextEncoder().encode(text),
    expected_existing_sha256: null,
    mode,
  };
}

function sourceWrites(): readonly PlannedWrite[] {
  return [
    draft(PROJECT_SOURCE_PATH, "accepted project source\n"),
    draft(COMPONENT_SOURCE_PATH, "accepted component source\n"),
    draft(DOMAIN_SOURCE_PATH, "accepted domain source\n"),
  ];
}

function dependencies(
  fixture: CompilerFixture,
  reader: ProfileTargetReader,
  options: {
    readonly sources?: readonly PlannedWrite[];
    readonly artifacts?: readonly PlannedWrite[];
    readonly sourceWarnings?: readonly RuntimeIssue[];
    readonly artifactWarnings?: readonly RuntimeIssue[];
  } = {},
): ProfilePlanningDependencies {
  return {
    catalog: {
      resolve: () => Promise.resolve(success(fixture.catalog)),
    },
    source_renderer: {
      render: () => success(options.sources ?? sourceWrites(), options.sourceWarnings),
    },
    artifact_renderer: {
      render: () =>
        success(
          options.artifacts ?? [draft("PROJECT_CONTEXT.md", "startup doorway\n")],
          options.artifactWarnings,
        ),
    },
    target_reader: reader,
  };
}

function planSummary(plan: Awaited<ReturnType<ReturnType<typeof createProfileCompiler>["plan"]>>) {
  if (!plan.ok) return plan;
  return {
    ...plan.value,
    writes: plan.value.writes.map((write) => ({
      relative_path: write.relative_path,
      mode: write.mode,
      expected_existing_sha256: write.expected_existing_sha256,
      bytes_sha256: sha256(write.bytes),
    })),
  };
}

let fixture: CompilerFixture;

beforeAll(async () => {
  fixture = await createCompilerFixture();
});

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("pure profile mutation planning", () => {
  it("returns byte-identical shared plans without a mutation capability", async () => {
    const reader = new MemoryTargetReader();
    const compiler = createProfileCompiler(dependencies(fixture, reader));
    const first = await compiler.plan(fixture.input);
    const second = await compiler.plan(fixture.input);
    expect(planSummary(first)).toEqual(planSummary(second));
    if (!first.ok) throw new Error(JSON.stringify(first.issues));
    expect(first.value.mutation_kind).toBe("profile.bootstrap");
    expect(first.value.metadata.profile_lock.lock_hash).toBe(
      first.value.profile_lock_hash,
    );
    expect(first.value.record_ids).toEqual([]);
    expect(first.value.event_ids).toEqual([]);
    expect(first.value.evidence_ids).toEqual([]);
    expect(reader.writeCalls).toEqual([]);
    expect(reader.gitMutationCalls).toEqual([]);
    expect(Object.keys(compiler)).toEqual(["plan"]);
  });

  it("plans accepted sources, exact catalog bytes, schemas, and no dynamic views", async () => {
    const compiler = createProfileCompiler(
      dependencies(fixture, new MemoryTargetReader()),
    );
    const result = await compiler.plan(fixture.input);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const paths = result.value.writes.map((write) => write.relative_path);
    expect(paths).toContain("docs/project-memory/project.yaml");
    expect(paths).toContain(PROJECT_SOURCE_PATH);
    expect(paths).toContain(COMPONENT_SOURCE_PATH);
    expect(paths).toContain(DOMAIN_SOURCE_PATH);
    expect(paths).toContain("docs/project-memory/catalog.lock.json");
    expect(paths).toContain("docs/project-memory/profile.lock.yaml");
    expect(paths).toContain("schemas/project-memory/v1/adapter-definition.schema.json");
    expect(
      paths.some(
        (path) =>
          path.startsWith("docs/project-memory/views/") ||
          path.includes("/initiatives/") ||
          path.includes("/workstreams/"),
      ),
    ).toBe(false);
    expect(
      result.value.writes.some((write) =>
        new TextDecoder().decode(write.bytes).includes("UNACCEPTED_SECRET_FACT"),
      ),
    ).toBe(false);
    const projectWrite = result.value.writes.find(
      (write) => write.relative_path === "docs/project-memory/project.yaml",
    );
    expect(projectWrite?.bytes).toEqual(fixture.input.project_yaml);
  });

  it("reads target bytes only to pin exact pre-image hashes", async () => {
    const previous = new TextEncoder().encode("previous accepted project\n");
    const reader = new MemoryTargetReader(
      new Map([[PROJECT_SOURCE_PATH, previous]]),
    );
    const result = await createProfileCompiler(
      dependencies(fixture, reader),
    ).plan(fixture.input);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const write = result.value.writes.find(
      (candidate) => candidate.relative_path === PROJECT_SOURCE_PATH,
    );
    expect(write?.expected_existing_sha256).toBe(sha256(previous));
    expect(new Set(reader.reads).size).toBe(result.value.writes.length);
    expect(reader.writeCalls).toEqual([]);
  });

  it("uses the foundation plan hash and stable lock hash functions", async () => {
    const result = await createProfileCompiler(
      dependencies(fixture, new MemoryTargetReader()),
    ).plan(fixture.input);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const { plan_hash: planHash, ...withoutPlanHash } = result.value;
    const { lock_hash: lockHash, ...withoutLockHash } =
      result.value.metadata.profile_lock;
    const { lock_hash: catalogHash, ...withoutCatalogHash } =
      result.value.metadata.selected_catalog_lock;
    expect(planHash).toBe(canonicalMutationPlanHash(withoutPlanHash));
    expect(lockHash).toBe(profileLockHash(withoutLockHash));
    expect(catalogHash).toBe(selectedCatalogLockHash(withoutCatalogHash));
  });

  it("sorts writes and exact approval IDs", async () => {
    const result = await createProfileCompiler(
      dependencies(fixture, new MemoryTargetReader()),
    ).plan(fixture.input);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const paths = result.value.writes.map((write) => write.relative_path);
    expect(paths).toEqual(
      [...paths].sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
    );
    expect(result.value.approval_ids).toEqual([
      "APR-01J00000000000000000000000",
    ]);
  });

  it("rejects duplicate target paths before reading any target bytes", async () => {
    const reader = new MemoryTargetReader();
    const duplicate = [
      draft(PROJECT_SOURCE_PATH, "first\n"),
      draft(PROJECT_SOURCE_PATH, "second\n"),
    ];
    const result = await createProfileCompiler(
      dependencies(fixture, reader, { sources: duplicate }),
    ).plan(fixture.input);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_WRITE_DUPLICATE" }],
    });
    expect(reader.reads).toEqual([]);
  });

  it("rejects a create-only collision with an existing user-owned path", async () => {
    const reader = new MemoryTargetReader(
      new Map([["AGENTS.md", new TextEncoder().encode("user instructions\n")]]),
    );
    const result = await createProfileCompiler(
      dependencies(fixture, reader, {
        artifacts: [draft("AGENTS.md", "generated adapter\n", "create")],
      }),
    ).plan(fixture.input);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_WRITE_COLLISION" }],
    });
  });

  it("requires the exact approval scope for an evolution plan", async () => {
    const compiler = createProfileCompiler(
      dependencies(fixture, new MemoryTargetReader()),
    );
    const bootstrap = await compiler.plan(fixture.input);
    if (!bootstrap.ok) throw new Error(JSON.stringify(bootstrap.issues));
    const wrongScope = await compiler.plan({
      ...fixture.input,
      previous_profile_lock: bootstrap.value.metadata.profile_lock,
    });
    expect(wrongScope).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_APPROVAL_SCOPE_MISMATCH" }],
    });
    const evolution = await compiler.plan({
      ...fixture.input,
      previous_profile_lock: bootstrap.value.metadata.profile_lock,
      approval_records: fixture.input.approval_records.map((record) => ({
        ...record,
        scope: "profile.evolution" as const,
      })),
    });
    if (!evolution.ok) throw new Error(JSON.stringify(evolution.issues));
    expect(evolution.value.mutation_kind).toBe("profile.evolution");
    expect(evolution.value.metadata.profile_lock.profile_revision).toBe(2);
  });
  it("returns planning diagnostics only as sorted warnings", async () => {
    const issue = (code: string, path: string): RuntimeIssue => ({
      code,
      severity: "warning",
      path,
      message: code,
      references: [],
    });
    const result = await createProfileCompiler(
      dependencies(fixture, new MemoryTargetReader(), {
        sourceWarnings: [issue("WARN_Z", "/z"), issue("WARN_A", "/a")],
        artifactWarnings: [issue("WARN_M", "/m")],
      }),
    ).plan(fixture.input);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "WARN_A",
      "WARN_M",
      "WARN_Z",
    ]);
    expect("warnings" in result.value.metadata).toBe(false);
  });
});
