import { readFile } from "node:fs/promises";

import { emitGeneratedYaml } from "../../src/core/document-io.js";
import type {
  AcceptedProfileSourceSet,
  ApprovalRecordReference,
  ProfilePlanInput,
  ProjectSelection,
  RootAddress,
  RootRelationshipSourceData,
} from "../../src/profile/contracts/index.js";

export interface GoldenDocumentSpec {
  readonly id: string;
  readonly relative_path: string;
  readonly title: string;
  readonly purpose: string;
  readonly sections: readonly {
    readonly heading: string;
    readonly body: string;
  }[];
}

interface RemoteRootSpec {
  readonly case_number: number;
  readonly namespace: string;
  readonly canonical_repository: string;
  readonly profile_lock_hash: string;
}

interface PortfolioRelationshipSpec {
  readonly kind: "portfolio";
  readonly local_profile_lock_hash: string;
  readonly children: readonly RemoteRootSpec[];
}

interface ProviderRelationshipSpec {
  readonly kind: "shared-platform-provider";
  readonly local_profile_lock_hash: string;
  readonly consumer: RemoteRootSpec;
  readonly interface_relative_path: string;
  readonly interface_sha256: string;
}

interface ConsumerRelationshipSpec {
  readonly kind: "shared-platform-consumer";
  readonly local_profile_lock_hash: string;
  readonly provider: RemoteRootSpec;
  readonly interface_relative_path: string;
  readonly interface_sha256: string;
  readonly usage_component_definition_id: string;
  readonly migration_state: "current" | "migration-required" | "retiring";
}

export type GoldenRelationshipSpec =
  | PortfolioRelationshipSpec
  | ProviderRelationshipSpec
  | ConsumerRelationshipSpec;

export interface GoldenCaseSpec {
  readonly name: string;
  readonly case_number: number;
  readonly repository: string;
  readonly root: {
    readonly namespace: string;
    readonly kind: ProjectSelection["root"]["kind"];
    readonly primary_archetype: ProjectSelection["root"]["primary_archetype"];
    readonly blueprint_id: string;
    readonly lifecycle: ProjectSelection["root"]["lifecycle"];
    readonly display_name: string;
    readonly mission: string;
  };
  readonly overlays: readonly string[];
  readonly components: readonly string[];
  readonly domains: readonly string[];
  readonly adapters: ProjectSelection["adapters"];
  readonly documents: readonly GoldenDocumentSpec[];
  readonly relationship: GoldenRelationshipSpec | null;
}

export interface BuiltGoldenInput {
  readonly spec: GoldenCaseSpec;
  readonly selection: ProjectSelection;
  readonly sources: AcceptedProfileSourceSet;
  readonly input: ProfilePlanInput;
}

const ACCEPTED_AT = "2026-07-15T03:45:00.000Z";
const CREATED_AT = "2026-07-15T04:00:00.000Z";
const EXPIRES_AT = "2026-07-15T06:00:00.000Z";

function suffix(caseNumber: number, itemNumber: number): string {
  return `01J${String(caseNumber).padStart(2, "0")}${String(itemNumber).padStart(21, "0")}`;
}

export function goldenInstanceId(
  prefix: "ROOT" | "CMP" | "DOM" | "APR" | "PLAN" | "CAP",
  caseNumber: number,
  itemNumber: number,
): string {
  return `${prefix}-${suffix(caseNumber, itemNumber)}`;
}

function slug(definitionId: string): string {
  return definitionId.slice(definitionId.indexOf(".") + 1);
}

function displayName(definitionId: string): string {
  return slug(definitionId)
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function address(
  caseNumber: number,
  namespace: string,
  canonicalRepository: string,
  profileLockHash: string,
): RootAddress {
  return {
    namespace,
    root_id: goldenInstanceId("ROOT", caseNumber, 0),
    canonical_repository: canonicalRepository,
    profile_lock_hash: profileLockHash,
  };
}

function remoteAddress(spec: RemoteRootSpec): RootAddress {
  return address(
    spec.case_number,
    spec.namespace,
    spec.canonical_repository,
    spec.profile_lock_hash,
  );
}

function relationships(
  spec: GoldenCaseSpec,
  approvalId: string,
  componentIds: ReadonlyMap<string, string>,
): RootRelationshipSourceData[] {
  const relationship = spec.relationship;
  if (relationship === null) return [];
  const local = address(
    spec.case_number,
    spec.root.namespace,
    spec.repository,
    relationship.local_profile_lock_hash,
  );
  if (relationship.kind === "portfolio") {
    return relationship.children.map((child, index) => ({
      kind: "portfolio-child",
      relationship_id: `portfolio-child-${String(index + 1)}`,
      revision: 1,
      portfolio: local,
      child: remoteAddress(child),
      relationship_owner_root_id: local.root_id,
      child_truth_owner_root_id: goldenInstanceId(
        "ROOT",
        child.case_number,
        0,
      ),
      relationship_status: "active",
      dependency_kinds: ["governance", "shared-platform"],
      approval_refs: [approvalId],
    }));
  }
  const remote = remoteAddress(
    relationship.kind === "shared-platform-provider"
      ? relationship.consumer
      : relationship.provider,
  );
  const interfaceReference = {
    root:
      relationship.kind === "shared-platform-provider" ? local : remote,
    relative_path: relationship.interface_relative_path,
    revision: 1,
    sha256: relationship.interface_sha256,
  };
  if (relationship.kind === "shared-platform-provider") {
    return [
      {
        kind: "shared-platform-provider",
        relationship_id: "shared-platform-api",
        revision: 1,
        provider: local,
        consumer: remote,
        owner_root_id: local.root_id,
        interface_refs: [interfaceReference],
        approval_refs: [approvalId],
      },
    ];
  }
  const usageComponentId = componentIds.get(
    relationship.usage_component_definition_id,
  );
  if (usageComponentId === undefined) {
    throw new Error(
      `golden consumer usage component is missing: ${relationship.usage_component_definition_id}`,
    );
  }
  return [
    {
      kind: "shared-platform-consumer",
      relationship_id: "shared-platform-api",
      revision: 1,
      consumer: local,
      provider: remote,
      owner_root_id: local.root_id,
      provider_interface_refs: [interfaceReference],
      usage_component_ids: [usageComponentId],
      migration_state: relationship.migration_state,
      approval_refs: [approvalId],
    },
  ];
}

export async function loadGoldenCase(name: string): Promise<GoldenCaseSpec> {
  const bytes = await readFile(
    new URL(`../fixtures/profile-golden/${name}/case.json`, import.meta.url),
    "utf8",
  );
  return JSON.parse(bytes) as GoldenCaseSpec;
}

export function buildGoldenInput(
  spec: GoldenCaseSpec,
  targetRoot: URL,
  releaseRoot: URL,
  catalogHash: string,
): BuiltGoldenInput {
  const rootId = goldenInstanceId("ROOT", spec.case_number, 0);
  const approvalId = goldenInstanceId("APR", spec.case_number, 0);
  const componentIds = new Map(
    spec.components.map((definitionId, index) => [
      definitionId,
      goldenInstanceId("CMP", spec.case_number, index + 1),
    ]),
  );
  const selection: ProjectSelection = {
    schema_version: "1.0.0",
    root: {
      id: rootId,
      namespace: spec.root.namespace,
      kind: spec.root.kind,
      primary_archetype: spec.root.primary_archetype,
      blueprint: { id: spec.root.blueprint_id, version: "1.0.0" },
      lifecycle: spec.root.lifecycle,
    },
    overlays: [...spec.overlays],
    components: spec.components.map((definitionId, index) => ({
      instance_id: goldenInstanceId("CMP", spec.case_number, index + 1),
      definition: { id: definitionId, version: "1.0.0" },
      slug: slug(definitionId),
      source_revision: 1,
    })),
    domains: spec.domains.map((definitionId, index) => ({
      instance_id: goldenInstanceId("DOM", spec.case_number, index + 1),
      definition: { id: definitionId, version: "1.0.0" },
      slug: slug(definitionId),
      source_revision: 1,
    })),
    adapters: spec.adapters,
    catalog: { release: "1.0.0", catalog_hash: catalogHash },
    acceptance: {
      approval_id: approvalId,
      accepted_by: "Pitaji",
      accepted_at: ACCEPTED_AT,
    },
  };
  const rootRelationships = relationships(spec, approvalId, componentIds);
  const sources: AcceptedProfileSourceSet = {
    project: {
      id: rootId,
      revision: 1,
      name: spec.root.display_name,
      mission: spec.root.mission,
      owners: ["Pitaji"],
      stakeholders: ["Project agents"],
      success_criteria: ["Every accepted profile byte is reproducible."],
      included_scope: [`Accepted ${spec.name} root truth.`],
      excluded_scope: ["Temporary workstreams remain separately governed."],
      approval_refs: [approvalId],
    },
    constraints: [],
    policies: [],
    blueprint_documents: spec.documents.map((document) => ({
      ...document,
      revision: 1,
      sections: [...document.sections],
      approval_refs: [approvalId],
    })),
    components: selection.components.map((component) => ({
      id: component.instance_id,
      root_id: rootId,
      revision: 1,
      definition: component.definition,
      slug: component.slug,
      name: displayName(component.definition.id),
      purpose: `Own the accepted ${component.slug} capability boundary.`,
      owners: ["Pitaji"],
      status: "active",
      inclusion_boundary: [`Accepted ${component.slug} responsibilities.`],
      exclusion_boundary: [],
      repositories: [
        { repository: spec.repository, paths: [`src/${component.slug}`] },
      ],
      dependencies: [],
      risks: [],
      links: [],
      approval_refs: [approvalId],
    })),
    domains: selection.domains.map((domain) => ({
      id: domain.instance_id,
      root_id: rootId,
      revision: 1,
      definition: domain.definition,
      slug: domain.slug,
      name: displayName(domain.definition.id),
      purpose: `Own accepted ${domain.slug} decisions.`,
      owners: ["Pitaji"],
      status: "active",
      inclusion_boundary: [`Accepted ${domain.slug} direction.`],
      exclusion_boundary: [],
      repositories: [
        { repository: spec.repository, paths: [`docs/${domain.slug}`] },
      ],
      dependencies: [],
      risks: [],
      links: [],
      approval_refs: [approvalId],
    })),
    root_relationships: rootRelationships,
  };
  const yaml = emitGeneratedYaml(selection);
  if (!yaml.ok) throw new Error(JSON.stringify(yaml.issues));
  const approval: ApprovalRecordReference = {
    id: approvalId,
    root_id: rootId,
    revision: 1,
    decision: "approved",
    approved_by: "Pitaji",
    approved_at: ACCEPTED_AT,
    scope: "profile.bootstrap",
    artifact_sha256: String(spec.case_number).repeat(64),
  };
  return {
    spec,
    selection,
    sources,
    input: {
      target_root: targetRoot,
      target_ref: "refs/heads/main",
      expected_head: String(spec.case_number).repeat(40),
      plan_id: goldenInstanceId("PLAN", spec.case_number, 0),
      created_by: "codex",
      created_at: CREATED_AT,
      expires_at: EXPIRES_AT,
      project_yaml: new TextEncoder().encode(yaml.value),
      accepted_sources: sources,
      catalog_release_root: releaseRoot,
      previous_profile_lock: null,
      approval_records: [approval],
    },
  };
}
