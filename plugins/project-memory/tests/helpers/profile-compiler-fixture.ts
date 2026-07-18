import { readFile } from "node:fs/promises";

import type { BlueprintDefinition } from "../../src/catalog/contracts/index.js";
import { emitGeneratedYaml, parseYamlDocument } from "../../src/core/document-io.js";
import { sha256 } from "../../src/core/hash.js";
import type {
  ResolvedCatalogSelection,
  ResolvedCatalogSourceFile,
} from "../../src/profile/catalog-selection-resolver.js";
import type {
  AcceptedProfileSourceSet,
  ApprovalRecordReference,
  LockedDefinition,
  ProfilePlanInput,
  ProjectSelection,
} from "../../src/profile/contracts/index.js";

interface SourceFixture {
  readonly source: string;
  readonly kind: ResolvedCatalogSourceFile["kind"];
  readonly definition_id: string;
  readonly locked_kind: LockedDefinition["kind"] | null;
}

const CATALOG_HASH = "a".repeat(64);
const ARTIFACT_HASH = "b".repeat(64);
const ROOT_ID = "ROOT-01J00000000000000000000000";
const COMPONENT_ID = "CMP-01J00000000000000000000000";
const DOMAIN_ID = "DOM-01J00000000000000000000000";
const APPROVAL_ID = "APR-01J00000000000000000000000";
const ACCEPTED_AT = "2026-07-15T03:45:00.000Z";
const FIXTURE_ROOT = new URL(
  "../fixtures/catalog-release/minimal-valid/catalog/project-memory/v1/",
  import.meta.url,
);
const SOURCES: readonly SourceFixture[] = [
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

async function resolvedCatalog(): Promise<ResolvedCatalogSelection> {
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
      const parsed = parseYamlDocument(
        new TextDecoder().decode(bytes),
        fixture.source,
      );
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      blueprint = (parsed.value as { blueprint: BlueprintDefinition }).blueprint;
    }
  }
  const schemaBytes = new Uint8Array(
    await readFile(
      new URL("../../schemas/project-memory/v1/adapter-definition.schema.json", import.meta.url),
    ),
  );
  files.push({
    kind: "generated-schema",
    definition_ids: ["adapter.codex"],
    source_relative_path: "schemas/project-memory/v1/adapter-definition.schema.json",
    target_relative_path: "schemas/project-memory/v1/adapter-definition.schema.json",
    bytes: schemaBytes,
    sha256: sha256(schemaBytes),
  });
  if (blueprint === null) throw new Error("blueprint fixture missing");
  return {
    release: "1.0.0",
    release_hash: CATALOG_HASH,
    files: files.reverse(),
    blueprint,
    definitions: definitions.reverse(),
    required_schema_ids: ["project-memory/v1/adapter-definition"],
  };
}

function projectSelection(): ProjectSelection {
  return {
    schema_version: "1.0.0",
    root: {
      id: ROOT_ID,
      namespace: "fixture.app",
      kind: "product",
      primary_archetype: "application-service",
      blueprint: { id: "application.test", version: "1.0.0" },
      lifecycle: "active",
    },
    overlays: ["overlay.surface.mobile"],
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
}

function acceptedSources(): AcceptedProfileSourceSet {
  return {
    project: {
      id: ROOT_ID,
      revision: 1,
      name: "Fixture App",
      mission: "Prove deterministic profile planning.",
      owners: ["Pitaji"],
      stakeholders: [],
      success_criteria: ["Repeated inputs produce identical plans."],
      included_scope: ["Accepted fixture profile truth."],
      excluded_scope: ["Unaccepted product facts."],
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
        purpose: "Own the accepted mobile fixture boundary.",
        owners: ["Pitaji"],
        status: "active",
        inclusion_boundary: ["Mobile fixture work."],
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
        purpose: "Own accepted fixture product intent.",
        owners: ["Pitaji"],
        status: "active",
        inclusion_boundary: ["Fixture product direction."],
        exclusion_boundary: [],
        repositories: [],
        dependencies: [],
        risks: [],
        links: [],
        approval_refs: [APPROVAL_ID],
      },
    ],
    root_relationships: [],
  };
}

export interface CompilerFixture {
  readonly input: ProfilePlanInput;
  readonly selection: ProjectSelection;
  readonly catalog: ResolvedCatalogSelection;
}

export async function createCompilerFixture(): Promise<CompilerFixture> {
  const selection = projectSelection();
  const yaml = emitGeneratedYaml(selection);
  if (!yaml.ok) throw new Error(JSON.stringify(yaml.issues));
  const approval: ApprovalRecordReference = {
    id: APPROVAL_ID,
    root_id: ROOT_ID,
    revision: 1,
    decision: "approved",
    approved_by: "Pitaji",
    approved_at: ACCEPTED_AT,
    scope: "profile.bootstrap",
    artifact_sha256: ARTIFACT_HASH,
  };
  return {
    selection,
    catalog: await resolvedCatalog(),
    input: {
      target_root: new URL("file:///fixture-target/"),
      target_ref: "refs/heads/main",
      expected_head: "1".repeat(40),
      plan_id: "PLAN-01J00000000000000000000000",
      created_by: "codex",
      created_at: "2026-07-15T04:00:00.000Z",
      expires_at: "2026-07-15T05:00:00.000Z",
      project_yaml: new TextEncoder().encode(yaml.value),
      accepted_sources: acceptedSources(),
      catalog_release_root: new URL("file:///verified-release/"),
      previous_profile_lock: null,
      approval_records: [approval],
    },
  };
}
