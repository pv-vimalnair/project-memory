import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  diffProfiles,
  type ProfileEvolutionDiff,
} from "../../src/profile/diff-profile.js";
import type {
  PortfolioChildReference,
  ResolvedProfile,
  RootAddress,
  SharedPlatformProviderReference,
} from "../../src/profile/contracts/index.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import { compileProductionProfilePlan } from "../helpers/production-profile-plan.js";

const OTHER_ROOT_ID = "ROOT-01J00000000000000000000001";
const APPROVAL_ID = "APR-01J00000000000000000000000";

let base: ResolvedProfile;

function value(result: ReturnType<typeof diffProfiles>): ProfileEvolutionDiff {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function localAddress(): RootAddress {
  return {
    namespace: base.root.namespace,
    root_id: base.root.id,
    canonical_repository: "github:pitaji/fixture-app",
    profile_lock_hash: "a".repeat(64),
  };
}

function otherAddress(namespace = "fixture.child"): RootAddress {
  return {
    namespace,
    root_id: OTHER_ROOT_ID,
    canonical_repository: "github:pitaji/fixture-child",
    profile_lock_hash: "b".repeat(64),
  };
}

function portfolioRelationship(): PortfolioChildReference {
  return {
    kind: "portfolio-child",
    relationship_id: "relationship.portfolio-child.fixture",
    revision: 1,
    portfolio: localAddress(),
    child: otherAddress(),
    relationship_owner_root_id: base.root.id,
    child_truth_owner_root_id: OTHER_ROOT_ID,
    relationship_status: "active",
    dependency_kinds: ["shared-capability"],
    approval_refs: [APPROVAL_ID],
  };
}

function providerRelationship(): SharedPlatformProviderReference {
  const provider = localAddress();
  return {
    kind: "shared-platform-provider",
    relationship_id: "relationship.shared-platform.fixture",
    revision: 1,
    provider,
    consumer: otherAddress("fixture.consumer"),
    owner_root_id: base.root.id,
    interface_refs: [
      {
        root: provider,
        relative_path: "docs/project-memory/interfaces/fixture.md",
        revision: 1,
        sha256: "c".repeat(64),
      },
    ],
    approval_refs: [APPROVAL_ID],
  };
}

beforeAll(async () => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
  base = (await compileProductionProfilePlan()).plan.metadata.profile;
});

afterAll(() => {
  resetSchemaRegistryForTests();
});

describe("read-only profile evolution classification", () => {
  it("classifies wording-only compatible catalog bytes as patch", () => {
    const after: ResolvedProfile = {
      ...base,
      adapters: base.adapters.map((adapter, index) =>
        index === 0
          ? { ...adapter, definition_target_sha256: "e".repeat(64) }
          : adapter,
      ),
      catalog: { ...base.catalog, release_hash: "f".repeat(64) },
    };
    const diff = value(diffProfiles(base, after));
    expect(diff.impact).toBe("patch");
    expect(diff.required_approval_kinds).toEqual(["catalog-maintainer"]);
    expect(diff.migration_required).toBe(false);
    expect(diff.writes).toEqual([]);
  });


  it("keeps propagated rule-byte changes at patch impact", () => {
    const rule = base.rules[0];
    expect(rule).toBeDefined();
    if (rule === undefined) return;
    const updateRule = <T extends typeof rule>(value: T): T =>
      value.id === rule.id
        ? { ...value, target_sha256: "e".repeat(64) }
        : value;
    const after: ResolvedProfile = {
      ...base,
      rules: base.rules.map(updateRule),
      components: base.components.map((component) => ({
        ...component,
        rules: component.rules.map(updateRule),
      })),
      domains: base.domains.map((domain) => ({
        ...domain,
        rules: domain.rules.map(updateRule),
      })),
      catalog: { ...base.catalog, release_hash: "f".repeat(64) },
    };
    const diff = value(diffProfiles(base, after));
    expect(diff.impact).toBe("patch");
    expect(diff.migration_required).toBe(false);
    expect(diff.required_approval_kinds).toEqual(["catalog-maintainer"]);
    expect(diff.changes.every((item) => item.impact === "patch")).toBe(true);
  });
  it("classifies an optional rule addition as minor directional evolution", () => {
    const source = base.rules[0];
    expect(source).toBeDefined();
    if (source === undefined) return;
    const after: ResolvedProfile = {
      ...base,
      rules: [
        ...base.rules,
        {
          ...source,
          id: "engineering.feature.review",
          target_path:
            "docs/project-memory/catalog/selected/patterns/engineering/engineering.feature.review.core.yaml",
          target_sha256: "e".repeat(64),
        },
      ],
    };
    const diff = value(diffProfiles(base, after));
    expect(diff).toMatchObject({
      impact: "minor",
      migration_required: false,
      required_approval_kinds: ["directional"],
      writes: [],
    });
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "rule",
          operation: "added",
          impact: "minor",
        }),
      ]),
    );
  });

  it("classifies component and domain additions as minor and removals as major", () => {
    const component = base.components[0];
    const domain = base.domains[0];
    expect(component).toBeDefined();
    expect(domain).toBeDefined();
    if (component === undefined || domain === undefined) return;
    const additions: ResolvedProfile = {
      ...base,
      components: [
        ...base.components,
        {
          ...component,
          instance_id: "CMP-01J00000000000000000000001",
          slug: "secondary-mobile",
        },
      ],
      domains: [
        ...base.domains,
        {
          ...domain,
          instance_id: "DOM-01J00000000000000000000001",
          slug: "secondary-product",
        },
      ],
    };
    expect(value(diffProfiles(base, additions))).toMatchObject({
      impact: "minor",
      migration_required: false,
      required_approval_kinds: ["directional"],
    });

    const removals = value(diffProfiles(additions, base));
    expect(removals).toMatchObject({
      impact: "major",
      migration_required: true,
      required_approval_kinds: ["directional", "migration"],
    });
  });

  it("classifies adapter addition separately from removal or replacement", () => {
    const added: ResolvedProfile = {
      ...base,
      adapters: [
        ...base.adapters,
        {
          kind: "agent",
          definition_id: "adapter.claude-code",
          definition_version: "1.0.0",
          definition_target_path:
            "docs/project-memory/catalog/selected/adapters/agent/adapter.claude-code.yaml",
          definition_target_sha256: "d".repeat(64),
        },
      ],
    };
    expect(value(diffProfiles(base, added)).impact).toBe("minor");
    expect(value(diffProfiles(added, base))).toMatchObject({
      impact: "major",
      migration_required: true,
    });
  });

  it("treats root namespace changes as major migrations", () => {
    const after: ResolvedProfile = {
      ...base,
      root: { ...base.root, namespace: "fixture.renamed" },
    };
    const diff = value(diffProfiles(base, after));
    expect(diff).toMatchObject({
      impact: "major",
      migration_required: true,
      required_approval_kinds: ["directional", "migration"],
    });
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/root/namespace" }),
      ]),
    );
  });

  it("requires directional and relationship approval for an owner change", () => {
    const relationship = portfolioRelationship();
    const before: ResolvedProfile = {
      ...base,
      root_relationships: [relationship],
    };
    const after: ResolvedProfile = {
      ...before,
      root_relationships: [
        { ...relationship, relationship_owner_root_id: OTHER_ROOT_ID },
      ],
    };
    const diff = value(diffProfiles(before, after));
    expect(diff.impact).toBe("major");
    expect(diff.required_approval_kinds).toEqual([
      "directional",
      "relationship",
    ]);
    expect(diff.changes[0]).toMatchObject({
      category: "relationship",
      operation: "authority-changed",
    });
  });

  it("treats portfolio-child and platform-interface changes as boundary changes", () => {
    const child = portfolioRelationship();
    const addedChild = value(
      diffProfiles(base, { ...base, root_relationships: [child] }),
    );
    expect(addedChild).toMatchObject({
      impact: "major",
      required_approval_kinds: ["directional", "relationship"],
    });

    const provider = providerRelationship();
    const before: ResolvedProfile = {
      ...base,
      root_relationships: [provider],
    };
    const after: ResolvedProfile = {
      ...before,
      root_relationships: [
        {
          ...provider,
          interface_refs: provider.interface_refs.map((reference) => ({
            ...reference,
            sha256: "d".repeat(64),
          })),
        },
      ],
    };
    const interfaceDiff = value(diffProfiles(before, after));
    expect(interfaceDiff).toMatchObject({
      impact: "major",
      migration_required: true,
      required_approval_kinds: [
        "directional",
        "relationship",
        "migration",
      ],
    });
  });


  it("fails closed on duplicate stable identities", () => {
    const adapter = base.adapters[0];
    expect(adapter).toBeDefined();
    if (adapter === undefined) return;
    const after: ResolvedProfile = {
      ...base,
      adapters: [
        ...base.adapters,
        { ...adapter, definition_target_sha256: "e".repeat(64) },
      ],
    };
    expect(diffProfiles(base, after)).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_DIFF_IDENTITY_DUPLICATE" }],
    });
  });
  it("is byte-order deterministic and never emits mutations", () => {
    const after: ResolvedProfile = {
      ...base,
      rules: [...base.rules].reverse(),
      adapters: [...base.adapters].reverse(),
      gates: [...base.gates].reverse(),
    };
    expect(value(diffProfiles(base, after))).toEqual({
      impact: "patch",
      changes: [],
      required_approval_kinds: [],
      migration_required: false,
      writes: [],
    });
  });
});
