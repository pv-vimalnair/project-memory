import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  AcceptedProfileSourceSet,
  PortfolioChildReference,
  ProfileLock,
  ProjectSelection,
} from "../../src/profile/contracts/index.js";
import { reconcileInstanceBindings } from "../../src/profile/instance-bindings.js";
import { registerProfileSchemas } from "../../src/profile/contracts/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const ROOT_ID = "ROOT-01J00000000000000000000000";
const CHILD_ROOT_ID = "ROOT-01J00000000000000000000001";
const COMPONENT_ID = "CMP-01J00000000000000000000000";
const DOMAIN_ID = "DOM-01J00000000000000000000000";
const APPROVAL_ID = "APR-01J00000000000000000000000";
const MIGRATION_APPROVAL_ID = "APR-01J00000000000000000000009";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} fixture is missing`);
  return value;
}

function relationship(): PortfolioChildReference {
  return {
    kind: "portfolio-child",
    relationship_id: "relationship.portfolio.child",
    revision: 1,
    portfolio: {
      namespace: "acme.portfolio",
      root_id: ROOT_ID,
      canonical_repository: "https://github.com/acme/portfolio",
      profile_lock_hash: HASH_A,
    },
    child: {
      namespace: "child.app",
      root_id: CHILD_ROOT_ID,
      canonical_repository: "https://github.com/acme/child",
      profile_lock_hash: HASH_B,
    },
    relationship_owner_root_id: ROOT_ID,
    child_truth_owner_root_id: CHILD_ROOT_ID,
    relationship_status: "active",
    dependency_kinds: ["product-family"],
    approval_refs: [APPROVAL_ID],
  };
}

function selection(): ProjectSelection {
  return {
    schema_version: "1.0.0",
    root: {
      id: ROOT_ID,
      namespace: "acme.portfolio",
      kind: "portfolio",
      primary_archetype: "portfolio",
      blueprint: { id: "portfolio.test", version: "1.0.0" },
      lifecycle: "active",
    },
    overlays: [],
    components: [
      {
        instance_id: COMPONENT_ID,
        definition: { id: "component.mobile", version: "1.0.0" },
        slug: "mobile",
        source_revision: 1,
      },
    ],
    domains: [
      {
        instance_id: DOMAIN_ID,
        definition: { id: "domain.product", version: "1.0.0" },
        slug: "product",
        source_revision: 1,
      },
    ],
    adapters: { agent: [], runtime: [], workflow: [] },
    catalog: { release: "1.0.0", catalog_hash: HASH_C },
    acceptance: {
      approval_id: APPROVAL_ID,
      accepted_by: "Pitaji",
      accepted_at: "2026-07-15T03:45:00.000Z",
    },
  };
}

function sources(): AcceptedProfileSourceSet {
  return {
    project: {
      id: ROOT_ID,
      revision: 1,
      name: "Acme portfolio",
      mission: "Coordinate accepted product relationships.",
      owners: ["Pitaji"],
      stakeholders: [],
      success_criteria: ["Every child retains its own canonical truth."],
      included_scope: ["Reference-only portfolio coordination."],
      excluded_scope: ["Copied child product truth."],
      approval_refs: [APPROVAL_ID],
    },
    constraints: [],
    policies: [],
    blueprint_documents: [],
    components: [
      {
        id: COMPONENT_ID,
        root_id: ROOT_ID,
        revision: 1,
        definition: { id: "component.mobile", version: "1.0.0" },
        slug: "mobile",
        name: "Mobile",
        purpose: "Represent the accepted mobile boundary.",
        owners: ["Pitaji"],
        status: "active",
        inclusion_boundary: ["Mobile product surface."],
        exclusion_boundary: [],
        repositories: [],
        dependencies: [],
        risks: [],
        links: [],
        approval_refs: [APPROVAL_ID],
      },
    ],
    domains: [
      {
        id: DOMAIN_ID,
        root_id: ROOT_ID,
        revision: 1,
        definition: { id: "domain.product", version: "1.0.0" },
        slug: "product",
        name: "Product",
        purpose: "Own accepted product intent.",
        owners: ["Pitaji"],
        status: "active",
        inclusion_boundary: ["Product direction."],
        exclusion_boundary: [],
        repositories: [],
        dependencies: [],
        risks: [],
        links: [],
        approval_refs: [APPROVAL_ID],
      },
    ],
    root_relationships: [relationship()],
  };
}

function previousLock(): ProfileLock {
  return {
    schema_version: "1.0.0",
    profile_revision: 1,
    root_id: ROOT_ID,
    project_hash: HASH_A,
    selected_catalog_lock_hash: HASH_B,
    accepted_source_entries: [
      {
        kind: "project",
        source_id: ROOT_ID,
        revision: 1,
        target_path: "docs/project-memory/source/PROJECT.md",
        sha256: HASH_A,
        approval_refs: [APPROVAL_ID],
      },
      {
        kind: "component",
        source_id: COMPONENT_ID,
        revision: 1,
        target_path: `docs/project-memory/source/components/${COMPONENT_ID}/COMPONENT.md`,
        sha256: HASH_A,
        approval_refs: [APPROVAL_ID],
      },
      {
        kind: "domain",
        source_id: DOMAIN_ID,
        revision: 1,
        target_path: `docs/project-memory/source/domains/${DOMAIN_ID}/DOMAIN.md`,
        sha256: HASH_B,
        approval_refs: [APPROVAL_ID],
      },
      {
        kind: "root-relationship",
        source_id: relationship().relationship_id,
        revision: 1,
        target_path: "docs/project-memory/source/ROOT_RELATIONSHIPS.md",
        sha256: HASH_C,
        approval_refs: [APPROVAL_ID],
      },
    ],
    profile: {
      schema_version: "1.0.0",
      root: {
        id: ROOT_ID,
        namespace: "acme.portfolio",
        kind: "portfolio",
        primary_archetype: "portfolio",
        lifecycle: "active",
      },
      blueprint: {
        kind: "blueprint",
        id: "portfolio.test",
        version: "1.0.0",
        target_path: "docs/project-memory/catalog/selected/portfolio.test.yaml",
        target_sha256: HASH_A,
      },
      overlays: [],
      components: [
        {
          instance_id: COMPONENT_ID,
          definition_id: "component.mobile",
          definition_version: "1.0.0",
          definition_target_path:
            "docs/project-memory/catalog/selected/component.mobile.yaml",
          definition_target_sha256: HASH_A,
          slug: "mobile",
          required_domains: [DOMAIN_ID],
          rules: [],
          gates: [],
        },
      ],
      domains: [
        {
          instance_id: DOMAIN_ID,
          definition_id: "domain.product",
          definition_version: "1.0.0",
          definition_target_path:
            "docs/project-memory/catalog/selected/domain.product.yaml",
          definition_target_sha256: HASH_B,
          slug: "product",
          required_components: [COMPONENT_ID],
          rules: [],
          gates: [],
        },
      ],
      adapters: [],
      rules: [],
      gates: [],
      templates: [],
      root_relationships: [relationship()],
      catalog: { release: "1.0.0", release_hash: HASH_C },
    },
    lock_hash: HASH_C,
  };
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  registerProfileSchemas();
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("stable profile instance bindings", () => {
  it("preserves unchanged root, component, domain, and relationship IDs", () => {
    const result = reconcileInstanceBindings(previousLock(), selection(), sources());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.root.instance_id).toBe(ROOT_ID);
    expect(result.value.components.map((item) => item.instance_id)).toEqual([
      COMPONENT_ID,
    ]);
    expect(result.value.domains.map((item) => item.instance_id)).toEqual([
      DOMAIN_ID,
    ]);
    expect(result.value.relationships.map((item) => item.relationship_id)).toEqual([
      relationship().relationship_id,
    ]);
    expect(result.value.changes).toEqual([]);
  });

  it("permits a mutable slug change with an incremented source revision", () => {
    const nextSelection = selection();
    const nextSources = sources();
    nextSelection.components[0] = {
      ...required(nextSelection.components[0], "selection component"),
      slug: "mobile-app",
      source_revision: 2,
    };
    nextSources.components[0] = {
      ...required(nextSources.components[0], "component source"),
      slug: "mobile-app",
      revision: 2,
    };
    const result = reconcileInstanceBindings(previousLock(), nextSelection, nextSources);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.components[0]?.slug).toBe("mobile-app");
    expect(result.value.changes).toMatchObject([
      { kind: "slug-changed", instance_id: COMPONENT_ID },
    ]);
  });

  it("rejects duplicate stable IDs before matching by position", () => {
    const nextSelection = selection();
    const binding = required(nextSelection.components[0], "selection component");
    nextSelection.components = [binding, { ...binding, slug: "duplicate" }];
    expect(
      reconcileInstanceBindings(previousLock(), nextSelection, sources()),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_INSTANCE_ID_DUPLICATE" }],
    });
  });

  it("does not mint an ID for an unaccepted addition", () => {
    const nextSelection = selection();
    nextSelection.components = [
      ...nextSelection.components,
      {
        definition: { id: "component.web", version: "1.0.0" },
        slug: "web",
        source_revision: 1,
      },
    ] as ProjectSelection["components"];
    expect(
      reconcileInstanceBindings(previousLock(), nextSelection, sources()),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_INSTANCE_ID_REQUIRED" }],
    });
  });

  it("requires a new approval for a definition replacement", () => {
    const nextSelection = selection();
    const nextSources = sources();
    nextSelection.components[0] = {
      ...required(nextSelection.components[0], "selection component"),
      definition: { id: "component.web", version: "1.0.0" },
      source_revision: 2,
    };
    nextSources.components[0] = {
      ...required(nextSources.components[0], "component source"),
      definition: { id: "component.web", version: "1.0.0" },
      revision: 2,
    };
    expect(
      reconcileInstanceBindings(previousLock(), nextSelection, nextSources),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_MIGRATION_APPROVAL_REQUIRED" }],
    });
  });

  it("records an explicitly re-approved definition replacement", () => {
    const nextSelection = selection();
    const nextSources = sources();
    nextSelection.components[0] = {
      ...required(nextSelection.components[0], "selection component"),
      definition: { id: "component.web", version: "1.0.0" },
      source_revision: 2,
    };
    nextSources.components[0] = {
      ...required(nextSources.components[0], "component source"),
      definition: { id: "component.web", version: "1.0.0" },
      revision: 2,
      approval_refs: [APPROVAL_ID, MIGRATION_APPROVAL_ID],
    };
    const result = reconcileInstanceBindings(previousLock(), nextSelection, nextSources);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.changes).toContainEqual(
      expect.objectContaining({
        kind: "definition-replaced",
        instance_id: COMPONENT_ID,
        approval_refs: [MIGRATION_APPROVAL_ID],
      }),
    );
  });

  it("accepts an addition only when its stable ID and approval are explicit", () => {
    const nextSelection = selection();
    const nextSources = sources();
    const newId = "CMP-01J00000000000000000000001";
    nextSelection.components = [
      ...nextSelection.components,
      {
        instance_id: newId,
        definition: { id: "component.web", version: "1.0.0" },
        slug: "web",
        source_revision: 1,
      },
    ];
    nextSources.components = [
      ...nextSources.components,
      {
        ...required(nextSources.components[0], "component source"),
        id: newId,
        definition: { id: "component.web", version: "1.0.0" },
        slug: "web",
        approval_refs: [MIGRATION_APPROVAL_ID],
      },
    ];
    const result = reconcileInstanceBindings(previousLock(), nextSelection, nextSources);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.changes).toContainEqual(
      expect.objectContaining({
        kind: "added",
        instance_id: newId,
        approval_refs: [MIGRATION_APPROVAL_ID],
      }),
    );
  });
  it("requires a new project approval before removing an instance", () => {
    const nextSelection = { ...selection(), components: [] };
    const nextSources = { ...sources(), components: [] };
    expect(
      reconcileInstanceBindings(previousLock(), nextSelection, nextSources),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_MIGRATION_APPROVAL_REQUIRED" }],
    });
  });

  it("requires a new approval for a relationship address change", () => {
    const nextSources = sources();
    nextSources.root_relationships[0] = {
      ...relationship(),
      revision: 2,
      child: { ...relationship().child, namespace: "child.next" },
    };
    expect(
      reconcileInstanceBindings(previousLock(), selection(), nextSources),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_MIGRATION_APPROVAL_REQUIRED" }],
    });
  });

  it("rejects a lower accepted source revision", () => {
    const previous = previousLock();
    previous.accepted_source_entries = previous.accepted_source_entries.map(
      (entry) =>
        entry.source_id === COMPONENT_ID ? { ...entry, revision: 2 } : entry,
    );
    expect(
      reconcileInstanceBindings(previous, selection(), sources()),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_SOURCE_REVISION_ROLLBACK" }],
    });
  });

  it("rejects a relationship owned by the wrong local root", () => {
    const nextSources = sources();
    nextSources.root_relationships[0] = {
      ...relationship(),
      relationship_owner_root_id: CHILD_ROOT_ID,
    };
    expect(
      reconcileInstanceBindings(previousLock(), selection(), nextSources),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "ROOT_RELATIONSHIP_OWNER_MISMATCH" }],
    });
  });
});
