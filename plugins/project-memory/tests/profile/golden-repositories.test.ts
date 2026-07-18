import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sha256 } from "../../src/core/hash.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import {
  buildGoldenCatalogRelease,
  cleanupGoldenRoots,
  createGoldenRepositoryCopy,
  loadOrUpdateGoldenSnapshot,
  materializeGoldenCase,
  planGoldenCase,
  resolveGoldenCatalog,
  summarizeGoldenPlan,
  type GoldenCatalogRelease,
} from "../helpers/profile-golden-harness.js";
import {
  buildGoldenInput,
  loadGoldenCase,
} from "../helpers/profile-golden-fixture.js";

const GOLDEN_CASES = [
  "small-service",
  "lifeof",
  "dino-escape",
  "portfolio",
  "shared-platform-provider",
  "shared-platform-consumer",
] as const;

let release: GoldenCatalogRelease;

async function fixtureBytes(
  name: string,
  relativePath: string,
): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(
      new URL(
        `../fixtures/profile-golden/${name}/repository/${relativePath}`,
        import.meta.url,
      ),
    ),
  );
}

function assertMultiRootBoundaries(
  name: (typeof GOLDEN_CASES)[number],
  planned: Awaited<ReturnType<typeof planGoldenCase>>,
): void {
  const relationships = planned.sources.root_relationships;
  if (name === "portfolio") {
    expect(relationships).toHaveLength(2);
    expect(relationships.every((record) => record.kind === "portfolio-child"))
      .toBe(true);
    const serialized = JSON.stringify(relationships);
    for (const forbidden of ["child_prd", "child_decisions", "child_scope"]) {
      expect(serialized).not.toContain(forbidden);
    }
  }
  if (name === "shared-platform-provider") {
    expect(relationships).toMatchObject([
      { kind: "shared-platform-provider", interface_refs: [{}] },
    ]);
    expect(
      planned.sources.blueprint_documents.map((value) => value.relative_path),
    ).toContain("docs/project-memory/source/INTERFACES.md");
    const relationship = relationships[0];
    const interfaceWrite = planned.plan.writes.find(
      (write) =>
        write.relative_path === "docs/project-memory/source/INTERFACES.md",
    );
    expect(relationship?.kind).toBe("shared-platform-provider");
    expect(interfaceWrite).toBeDefined();
    if (
      relationship?.kind === "shared-platform-provider" &&
      interfaceWrite !== undefined
    ) {
      expect(relationship.interface_refs[0]?.sha256).toBe(
        sha256(interfaceWrite.bytes),
      );
    }
  }
  if (name === "shared-platform-consumer") {
    expect(relationships).toMatchObject([
      {
        kind: "shared-platform-consumer",
        migration_state: "migration-required",
        provider_interface_refs: [{}],
        usage_component_ids: [expect.stringMatching(/^CMP-/)],
      },
    ]);
    expect(
      planned.sources.blueprint_documents.map((value) => value.relative_path),
    ).not.toContain("docs/project-memory/source/INTERFACES.md");
    expect(JSON.stringify(relationships)).not.toContain('"interface_refs"');
  }
}

beforeAll(async () => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
  release = await buildGoldenCatalogRelease();
});

afterAll(async () => {
  resetSchemaRegistryForTests();
  await cleanupGoldenRoots();
});

describe("golden profile repositories", () => {
  it.each(GOLDEN_CASES)(
    "reproduces and stages %s target bytes without canonical mutation",
    async (name) => {
      const spec = await loadGoldenCase(name);
      const firstRoot = await createGoldenRepositoryCopy(spec);
      const secondRoot = await createGoldenRepositoryCopy(spec);
      const initial = buildGoldenInput(
        spec,
        firstRoot,
        release.release_root,
        release.release_hash,
      );
      const resolved = await resolveGoldenCatalog(initial);
      const first = await planGoldenCase(spec, firstRoot, release, resolved);
      const second = await planGoldenCase(spec, secondRoot, release, resolved);
      const firstSummary = summarizeGoldenPlan(first.plan);
      const secondSummary = summarizeGoldenPlan(second.plan);

      expect(secondSummary).toEqual(firstSummary);
      const expectedSnapshot = await loadOrUpdateGoldenSnapshot(
        name,
        firstSummary,
      );
      expect(expectedSnapshot.manifest).toEqual(firstSummary.manifest);
      expect(expectedSnapshot.exact_payload).toEqual(firstSummary.exact_payload);

      const previousContext = await fixtureBytes(name, "PROJECT_CONTEXT.md");
      expect(
        first.plan.writes.find(
          (write) => write.relative_path === "PROJECT_CONTEXT.md",
        )?.expected_existing_sha256,
      ).toBe(sha256(previousContext));

      const agents = spec.adapters.agent.map((adapter) => adapter.id);
      const paths = first.plan.writes.map((write) => write.relative_path);
      const hasExistingAgents = name === "small-service";
      expect(paths.includes("AGENTS.md")).toBe(
        agents.includes("adapter.codex") && !hasExistingAgents,
      );
      expect(paths.includes("CLAUDE.md")).toBe(
        agents.includes("adapter.claude-code"),
      );
      if (hasExistingAgents) {
        expect(first.warnings).toContain("ADAPTER_EXISTING_FILE_REVIEW");
        expect(
          paths.some((value) =>
            value.includes("adapter-existing-file-agents-"),
          ),
        ).toBe(true);
      }

      assertMultiRootBoundaries(name, first);
      const materialized = await materializeGoldenCase(first);
      expect(materialized).toEqual({
        canonical_ref_before: first.plan.expected_head,
        canonical_ref_after: first.plan.expected_head,
        external_reads: [],
      });
      if (hasExistingAgents) {
        expect(
          new Uint8Array(await readFile(new URL("AGENTS.md", firstRoot))),
        ).toEqual(await fixtureBytes(name, "AGENTS.md"));
      }
      expect(
        new Uint8Array(await readFile(new URL("PROJECT_CONTEXT.md", secondRoot))),
      ).toEqual(previousContext);
    },
    60_000,
  );

  it("pins the consumer to the exact provider-owned interface bytes", async () => {
    const provider = await loadGoldenCase("shared-platform-provider");
    const consumer = await loadGoldenCase("shared-platform-consumer");
    expect(provider.relationship?.kind).toBe("shared-platform-provider");
    expect(consumer.relationship?.kind).toBe("shared-platform-consumer");
    if (
      provider.relationship?.kind === "shared-platform-provider" &&
      consumer.relationship?.kind === "shared-platform-consumer"
    ) {
      expect(consumer.relationship.interface_sha256).toBe(
        provider.relationship.interface_sha256,
      );
    }
  });

  it("keeps canonical finalization outside the profile package", async () => {
    const exports = await import("../../src/profile/index.js");
    expect(Object.keys(exports)).not.toContain("applyFileTransaction");
    expect(Object.keys(exports)).not.toContain("finalizeMutation");
    expect(Object.keys(exports)).toEqual(
      expect.arrayContaining([
        "createProfileCompiler",
        "createProfileMaterializer",
        "createProfileVerifier",
        "parseCanonicalMarkdown",
        "renderCanonicalMarkdown",
      ]),
    );
  });
});
