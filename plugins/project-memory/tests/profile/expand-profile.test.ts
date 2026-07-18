import { readFile } from "node:fs/promises";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { BlueprintDefinition } from "../../src/catalog/contracts/index.js";
import { parseYamlDocument } from "../../src/core/document-io.js";
import { sha256 } from "../../src/core/hash.js";
import type {
  ResolvedCatalogSelection,
  ResolvedCatalogSourceFile,
} from "../../src/profile/catalog-selection-resolver.js";
import type {
  LockedDefinition,
  ProjectSelection,
} from "../../src/profile/contracts/index.js";
import { expandResolvedProfile } from "../../src/profile/expand-profile.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

interface FixtureSource {
  readonly source: string;
  readonly kind: ResolvedCatalogSourceFile["kind"];
  readonly definition_id: string;
  readonly locked_kind: LockedDefinition["kind"] | null;
}

const CATALOG_HASH = "a".repeat(64);
const FIXTURE_ROOT = new URL(
  "../fixtures/catalog-release/minimal-valid/catalog/project-memory/v1/",
  import.meta.url,
);
const SOURCES: readonly FixtureSource[] = [
  {
    source: "blueprints/application-service/application.test.yaml",
    kind: "blueprint",
    definition_id: "application.test",
    locked_kind: "blueprint",
  },
  {
    source: "overlays/overlay.surface.mobile.yaml",
    kind: "definition-source",
    definition_id: "overlay.surface.mobile",
    locked_kind: "overlay",
  },
  {
    source: "components/component.mobile.yaml",
    kind: "definition-source",
    definition_id: "component.mobile",
    locked_kind: "component",
  },
  {
    source: "domains/domain.product.yaml",
    kind: "definition-source",
    definition_id: "domain.product",
    locked_kind: "domain",
  },
  {
    source: "adapters/adapter.codex.yaml",
    kind: "definition-source",
    definition_id: "adapter.codex",
    locked_kind: "adapter",
  },
  {
    source: "patterns/engineering/engineering.feature.implement.core.yaml",
    kind: "pattern-core",
    definition_id: "engineering.feature.implement",
    locked_kind: "pattern",
  },
  {
    source: "patterns/engineering/engineering.feature.implement.taxonomy.yaml",
    kind: "pattern-taxonomy",
    definition_id: "engineering.feature.implement",
    locked_kind: null,
  },
  {
    source: "companion-rules/companion.mutation.core.yaml",
    kind: "companion-core",
    definition_id: "companion.mutation",
    locked_kind: "companion",
  },
  {
    source: "companion-rules/companion.mutation.taxonomy.yaml",
    kind: "companion-taxonomy",
    definition_id: "companion.mutation",
    locked_kind: null,
  },
];

let fixedCatalog: ResolvedCatalogSelection;

async function loadFixtureCatalog(): Promise<ResolvedCatalogSelection> {
  const files: ResolvedCatalogSourceFile[] = [];
  const definitions: LockedDefinition[] = [];
  let blueprint: BlueprintDefinition | null = null;
  for (const fixture of SOURCES) {
    const bytes = new Uint8Array(await readFile(new URL(fixture.source, FIXTURE_ROOT)));
    const digest = sha256(bytes);
    const target = `docs/project-memory/catalog/selected/${fixture.source}`;
    files.push({
      kind: fixture.kind,
      definition_ids: [fixture.definition_id],
      source_relative_path: fixture.source,
      target_relative_path: target,
      bytes,
      sha256: digest,
    });
    if (fixture.locked_kind !== null) {
      definitions.push({
        kind: fixture.locked_kind,
        id: fixture.definition_id,
        version: "1.0.0",
        target_path: target,
        target_sha256: digest,
      });
    }
    if (fixture.kind === "blueprint") {
      const parsed = parseYamlDocument(Buffer.from(bytes).toString("utf8"), fixture.source);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      const wrapper = parsed.value as { blueprint: BlueprintDefinition };
      blueprint = wrapper.blueprint;
    }
  }
  if (blueprint === null) throw new Error("blueprint fixture missing");
  return {
    release: "1.0.0",
    release_hash: CATALOG_HASH,
    files: files.reverse(),
    blueprint,
    definitions: definitions.reverse(),
    required_schema_ids: [],
  };
}

function projectSelection(): ProjectSelection {
  return {
    schema_version: "1.0.0",
    root: {
      id: "ROOT-01J00000000000000000000000",
      namespace: "fixture.app",
      kind: "product",
      primary_archetype: "application-service",
      blueprint: { id: "application.test", version: "1.0.0" },
      lifecycle: "active",
    },
    overlays: ["overlay.surface.mobile"],
    components: [
      {
        instance_id: "CMP-01J00000000000000000000000",
        definition: { id: "component.mobile", version: "1.0.0" },
        slug: "mobile",
        source_revision: 1,
      },
    ],
    domains: [
      {
        instance_id: "DOM-01J00000000000000000000000",
        definition: { id: "domain.product", version: "1.0.0" },
        slug: "product",
        source_revision: 1,
      },
    ],
    adapters: {
      agent: [{ id: "adapter.codex", version: "1.0.0" }],
      runtime: [],
      workflow: [],
    },
    catalog: { release: "1.0.0", catalog_hash: CATALOG_HASH },
    acceptance: {
      approval_id: "APR-01J00000000000000000000000",
      accepted_by: "Pitaji",
      accepted_at: "2026-07-15T03:45:00.000Z",
    },
  };
}

beforeAll(async () => {
  fixedCatalog = await loadFixtureCatalog();
});

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("resolved profile expansion", () => {
  it("fails root kind compatibility before later checks", () => {
    const selection = projectSelection();
    const result = expandResolvedProfile(
      { ...selection, root: { ...selection.root, kind: "shared-system" } },
      fixedCatalog,
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_ROOT_KIND_INCOMPATIBLE" }],
    });
  });

  it("fails primary archetype compatibility before definition expansion", () => {
    const selection = projectSelection();
    const result = expandResolvedProfile(
      {
        ...selection,
        root: { ...selection.root, primary_archetype: "developer-platform" },
      },
      fixedCatalog,
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_ARCHETYPE_INCOMPATIBLE" }],
    });
  });

  it("rejects an explicitly selected overlay forbidden by the blueprint", () => {
    const catalog: ResolvedCatalogSelection = {
      ...fixedCatalog,
      blueprint: {
        ...fixedCatalog.blueprint,
        overlays: {
          ...fixedCatalog.blueprint.overlays,
          forbidden: ["overlay.surface.mobile"],
        },
      },
    };
    expect(expandResolvedProfile(projectSelection(), catalog)).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_OVERLAY_FORBIDDEN" }],
    });
  });

  it("requires accepted bindings for default domains", () => {
    const selection = projectSelection();
    expect(
      expandResolvedProfile({ ...selection, domains: [] }, fixedCatalog),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_DOMAIN_REQUIRED" }],
    });
  });

  it("requires every blueprint adapter slot", () => {
    const selection = projectSelection();
    expect(
      expandResolvedProfile(
        {
          ...selection,
          adapters: { agent: [], runtime: [], workflow: [] },
        },
        fixedCatalog,
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_ADAPTER_REQUIRED" }],
    });
  });

  it("rejects selected definition version conflicts", () => {
    const selection = projectSelection();
    const component = selection.components[0];
    if (component === undefined) throw new Error("component fixture missing");
    expect(
      expandResolvedProfile(
        {
          ...selection,
          components: [
            {
              ...component,
              definition: { ...component.definition, version: "2.0.0" },
            },
          ],
        },
        fixedCatalog,
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_DEFINITION_VERSION_CONFLICT" }],
    });
  });

  it("rejects duplicate adapter references instead of choosing one", () => {
    const selection = projectSelection();
    const adapter = selection.adapters.agent[0];
    if (adapter === undefined) throw new Error("adapter fixture missing");
    expect(
      expandResolvedProfile(
        {
          ...selection,
          adapters: { ...selection.adapters, agent: [adapter, adapter] },
        },
        fixedCatalog,
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_REFERENCE_DUPLICATE" }],
    });
  });

  it("rejects an incomplete pattern and companion closure", () => {
    const catalog: ResolvedCatalogSelection = {
      ...fixedCatalog,
      files: fixedCatalog.files.filter(
        (file) => !file.definition_ids.includes("companion.mutation"),
      ),
      definitions: fixedCatalog.definitions.filter(
        (definition) => definition.id !== "companion.mutation",
      ),
    };
    expect(expandResolvedProfile(projectSelection(), catalog)).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_RULE_CLOSURE_INCOMPLETE" }],
    });
  });

  it("preserves accepted instance IDs and sorts every resolved set", () => {
    const first = expandResolvedProfile(projectSelection(), fixedCatalog);
    const second = expandResolvedProfile(projectSelection(), {
      ...fixedCatalog,
      files: [...fixedCatalog.files].reverse(),
      definitions: [...fixedCatalog.definitions].reverse(),
    });
    if (!first.ok) throw new Error(JSON.stringify(first.issues, null, 2));
    if (!second.ok) throw new Error(JSON.stringify(second.issues, null, 2));
    expect(first.value).toEqual(second.value);
    expect(first.value.components[0]?.instance_id).toBe(
      "CMP-01J00000000000000000000000",
    );
    expect(first.value.domains[0]?.instance_id).toBe(
      "DOM-01J00000000000000000000000",
    );
    expect(first.value.rules.map((rule) => rule.id)).toEqual([
      "companion.mutation",
      "engineering.feature.implement",
    ]);
    expect(first.value.overlays.map((overlay) => overlay.id)).toEqual([
      "overlay.surface.mobile",
    ]);
    expect(first.value.gates[0]).toMatchObject({
      id: "gate.profile.application.test",
      commands: ["project-memory verify"],
    });
  });
});
