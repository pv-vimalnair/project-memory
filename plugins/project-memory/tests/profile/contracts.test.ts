import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";

import type { CanonicalMutationPlan } from "../../src/contracts/canonical-mutation-plan.js";
import {
  AcceptedProfileSourceSetSchema,
  ApprovalRecordReferenceSchema,
  PROFILE_SCHEMA_IDS,
  ProjectSelectionSchema,
  registerProfileSchemas,
  validateProfileContractConsistency,
  type AcceptedProfileSourceSet,
  type ApprovalRecordReference,
  type ProfileCanonicalMutationPlan,
  type ProfileMutationMetadata,
  type ProfileMutationMetadataDocument,
  type ProjectSelection,
} from "../../src/profile/contracts/index.js";
import { parseYamlDocument } from "../../src/core/document-io.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import { validateWithSchema } from "../../src/schema/validate.js";

const ROOT_ID = "ROOT-01J00000000000000000000000";
const COMPONENT_ID = "CMP-01J00000000000000000000000";
const DOMAIN_ID = "DOM-01J00000000000000000000000";
const APPROVAL_ID = "APR-01J00000000000000000000000";
const CATALOG_HASH = "a".repeat(64);
const ARTIFACT_HASH = "b".repeat(64);
const ACCEPTED_AT = "2026-07-15T03:45:00.000Z";

const validSelection: ProjectSelection = {
  schema_version: "1.0.0",
  root: {
    id: ROOT_ID,
    namespace: "lifeof.app",
    kind: "product",
    primary_archetype: "application-service",
    blueprint: { id: "application.consumer-mobile", version: "1.0.0" },
    lifecycle: "production",
  },
  overlays: ["overlay.surface.mobile"],
  components: [
    {
      instance_id: COMPONENT_ID,
      definition: { id: "component.mobile-client", version: "1.0.0" },
      slug: "mobile-client",
      source_revision: 1,
    },
  ],
  domains: [
    {
      instance_id: DOMAIN_ID,
      definition: { id: "domain.product-strategy", version: "1.0.0" },
      slug: "product-strategy",
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
    approval_id: APPROVAL_ID,
    accepted_by: "Pitaji",
    accepted_at: ACCEPTED_AT,
  },
};

const validSources: AcceptedProfileSourceSet = {
  project: {
    id: ROOT_ID,
    revision: 1,
    name: "LifeOf",
    mission: "Help people sustain meaningful habits with clear motivation.",
    owners: ["Pitaji"],
    stakeholders: [],
    success_criteria: ["People can complete and review a daily habit cycle."],
    included_scope: ["Habit tracking and financial motivation."],
    excluded_scope: ["Unapproved financial advice."],
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
      definition: { id: "component.mobile-client", version: "1.0.0" },
      slug: "mobile-client",
      name: "Mobile client",
      purpose: "Deliver the accepted mobile product experience.",
      owners: ["Pitaji"],
      status: "active",
      inclusion_boundary: ["Flutter application UI and local interaction."],
      exclusion_boundary: ["Backend service implementation."],
      repositories: [{ repository: "lifeof", paths: ["lib"] }],
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
      definition: { id: "domain.product-strategy", version: "1.0.0" },
      slug: "product-strategy",
      name: "Product strategy",
      purpose: "Own product intent and accepted product boundaries.",
      owners: ["Pitaji"],
      status: "active",
      inclusion_boundary: ["Product direction and requirements."],
      exclusion_boundary: ["Implementation ownership."],
      repositories: [{ repository: "lifeof", paths: ["docs"] }],
      dependencies: [],
      risks: [],
      links: [],
      approval_refs: [APPROVAL_ID],
    },
  ],
  root_relationships: [],
};

const validApproval: ApprovalRecordReference = {
  id: APPROVAL_ID,
  root_id: ROOT_ID,
  revision: 1,
  decision: "approved",
  approved_by: "Pitaji",
  approved_at: ACCEPTED_AT,
  scope: "profile.bootstrap",
  artifact_sha256: ARTIFACT_HASH,
};

beforeEach(() => {
  resetSchemaRegistryForTests();
  registerProfileSchemas();
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("profile contracts", () => {
  it("registers a sorted, unique profile schema surface", () => {
    expect(PROFILE_SCHEMA_IDS).toEqual([...PROFILE_SCHEMA_IDS].sort());
    expect(new Set(PROFILE_SCHEMA_IDS).size).toBe(PROFILE_SCHEMA_IDS.length);
    expect(PROFILE_SCHEMA_IDS).toContain(ProjectSelectionSchema.$id);
    expect(PROFILE_SCHEMA_IDS).toContain(AcceptedProfileSourceSetSchema.$id);
  });

  it("parses and validates the checked-in contract fixtures", async () => {
    const fixtures = [
      ["valid-project-selection.yaml", ProjectSelectionSchema.$id],
      ["valid-accepted-sources.yaml", AcceptedProfileSourceSetSchema.$id],
      ["valid-approval-reference.yaml", ApprovalRecordReferenceSchema.$id],
    ] as const;
    for (const [name, schemaId] of fixtures) {
      const text = await readFile(
        new URL(`../fixtures/profile/contracts/${name}`, import.meta.url),
        "utf8",
      );
      const parsed = parseYamlDocument(text, name);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(validateWithSchema(schemaId, parsed.value)).toMatchObject({
        ok: true,
      });
    }
  });

  it("requires accepted facts for every planned canonical artifact", () => {
    const result = validateWithSchema(
      AcceptedProfileSourceSetSchema.$id,
      {
        ...validSources,
        project: { ...validSources.project, mission: "" },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ path: "/project/mission" }),
      );
    }
  });

  it.each([
    ["invalid root kind", { ...validSelection, root: { ...validSelection.root, kind: "campaign" } }, "/root/kind"],
    ["invalid primary archetype", { ...validSelection, root: { ...validSelection.root, primary_archetype: "campaign" } }, "/root/primary_archetype"],
    ["malformed catalog hash", { ...validSelection, catalog: { ...validSelection.catalog, catalog_hash: "abc" } }, "/catalog/catalog_hash"],
    ["unknown key", { ...validSelection, invented: true }, "/invented"],
  ])("rejects %s", (_name, value, path) => {
    const result = validateWithSchema(ProjectSelectionSchema.$id, value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ path }));
    }
  });

  it("rejects local absolute repository paths from generated profile truth", () => {
    const component = validSources.components[0];
    if (component === undefined) throw new Error("component fixture missing");
    const result = validateWithSchema(AcceptedProfileSourceSetSchema.$id, {
      ...validSources,
      components: [
        {
          ...component,
          repositories: [
            { repository: "C:\\Users\\Pitaji\\lifeof", paths: ["lib"] },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          path: "/components/0/repositories/0/repository",
        }),
      );
    }
  });

  it("requires at least one accepted project owner", () => {
    const result = validateWithSchema(AcceptedProfileSourceSetSchema.$id, {
      ...validSources,
      project: { ...validSources.project, owners: [] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ path: "/project/owners" }),
      );
    }
  });

  it("rejects duplicate stable instance IDs", () => {
    const duplicate = {
      ...validSelection,
      components: [validSelection.components[0], validSelection.components[0]],
    } as ProjectSelection;
    const result = validateProfileContractConsistency(
      duplicate,
      validSources,
      [validApproval],
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_INSTANCE_ID_DUPLICATE" }],
    });
  });

  it("rejects accepted source records that do not match project selection", () => {
    const component = validSources.components[0];
    if (component === undefined) throw new Error("component fixture missing");
    const mismatched: AcceptedProfileSourceSet = {
      ...validSources,
      components: [
        {
          ...component,
          definition: { id: "component.web-client", version: "1.0.0" },
        },
      ],
    };
    const result = validateProfileContractConsistency(
      validSelection,
      mismatched,
      [validApproval],
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_SOURCE_SELECTION_MISMATCH" }],
    });
  });

  it("rejects a selection or source set without its linked Pitaji approval", () => {
    const result = validateProfileContractConsistency(
      validSelection,
      validSources,
      [],
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_APPROVAL_REQUIRED" }],
    });
  });

  it("accepts one internally consistent approved contract set", () => {
    expect(
      validateProfileContractConsistency(
        validSelection,
        validSources,
        [validApproval],
      ),
    ).toMatchObject({ ok: true });
  });

  it("narrows the shared mutation plan without changing its metadata slot", () => {
    expectTypeOf<ProfileMutationMetadataDocument>()
      .toEqualTypeOf<ProfileMutationMetadata>();
    expectTypeOf<ProfileCanonicalMutationPlan["metadata"]>()
      .toEqualTypeOf<ProfileMutationMetadata>();
    expectTypeOf<ProfileCanonicalMutationPlan["mutation_kind"]>()
      .toEqualTypeOf<"profile.bootstrap" | "profile.evolution">();
    expectTypeOf<ProfileCanonicalMutationPlan>()
      .toExtend<CanonicalMutationPlan<ProfileMutationMetadata>>();
  });
});