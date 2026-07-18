import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  AdapterDefinition,
  BlueprintDefinition,
  ComponentDefinition,
  DomainDefinition,
  OverlayDefinition,
} from "../../catalog/contracts/index.js";
import type { CanonicalMutationPlan } from "../../contracts/canonical-mutation-plan.js";
import {
  failure,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import { canonicalJson } from "../../core/canonical-json.js";
import { NodeCommandRunner } from "../../core/command-runner.js";
import {
  decodeStrictUtf8,
  emitGeneratedYaml,
  parseJsonDocument,
} from "../../core/document-io.js";
import { GitCliClient } from "../../core/git-cli-client.js";
import { sha256 } from "../../core/hash.js";
import { resolveInside } from "../../core/path-safety.js";
import { createProfileArtifactRenderer } from "../../materialize/render-adapters.js";
import { acceptedProfileSourceRenderer } from "../../materialize/render-project-source.js";
import type { ProfileTargetReader } from "../../profile/build-profile-mutation-plan.js";
import { CatalogSelectionResolver } from "../../profile/catalog-selection-resolver.js";
import type {
  AcceptedProfileSourceSet,
  ApprovalRecordReference,
  ProfileCompiler,
  ProfilePlanInput,
  ProjectSelection,
} from "../../profile/contracts/index.js";
import { createProfileCompiler } from "../../profile/profile-compiler.js";
import type { ApprovalKind } from "../../profile/diff-profile.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../schema/project-registrars.js";
import { getSchemaValidator, registerProjectSchemas } from "../../schema/registry.js";
import {
  normalizeFeatureMap,
  selectBlueprint,
  type BlueprintSelectableDefinition,
  type FeatureObservation,
  type SelectionDecision,
} from "../../selection/index.js";
import {
  buildInitialSourceProposal,
  deterministicInstanceId,
  type InitialSourceProposal,
} from "./build-initial-source-proposal.js";

interface CatalogBundle {
  readonly schema_version: "1.0.0";
  readonly release: string;
  readonly definitions: {
    readonly blueprints: readonly BlueprintDefinition[];
    readonly components: readonly ComponentDefinition[];
    readonly domains: readonly DomainDefinition[];
    readonly overlays: readonly OverlayDefinition[];
    readonly adapters: readonly AdapterDefinition[];
  };
}

interface CatalogLockHeader {
  readonly release: string;
  readonly release_hash: string;
}

export interface InitReplayInput {
  readonly root: string;
  readonly brief_path: string;
  readonly catalog_bundle_path: string;
  readonly agent_adapter: string;
  readonly target_ref: string;
  readonly created_at: string;
  readonly expires_at: string;
}

export interface InitReviewPacket {
  readonly status: "review_required";
  readonly reason: string;
  readonly approval_id: string;
}

export interface InitPlan {
  readonly schema_version: "1.0.0";
  readonly target_root_id: string;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly normalized_feature_hash: string;
  readonly selection: SelectionDecision;
  readonly proposed_project_selection: ProjectSelection;
  readonly proposed_sources: AcceptedProfileSourceSet;
  readonly source_proposal: InitialSourceProposal;
  readonly source_proposal_hash: string;
  readonly unresolved_required_facts: readonly string[];
  readonly required_approval_kinds: readonly ApprovalKind[];
  readonly profile_compilation: CanonicalMutationPlan<unknown>;
  readonly replay: InitReplayInput;
  readonly review_packet: InitReviewPacket;
  readonly plan_hash: string;
}

export interface BuildInitPlanDependencies {
  readonly head: (root: URL) => Promise<RuntimeResult<string>>;
  readonly read_brief: (root: URL, relativePath: string) => Promise<RuntimeResult<string>>;
  readonly read_catalog: (
    bundle: URL,
  ) => Promise<RuntimeResult<{ readonly bundle: CatalogBundle; readonly lock: CatalogLockHeader }>>;
  readonly plan_profile: (
    input: ProfilePlanInput,
  ) => Promise<RuntimeResult<CanonicalMutationPlan<unknown>>>;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function initPlanDocumentValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { bytes_base64: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) return value.map((item) => initPlanDocumentValue(item));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, initPlanDocumentValue(item)]),
  );
}

function withoutPlanHash(plan: InitPlan): Omit<InitPlan, "plan_hash"> {
  const { plan_hash: ignored, ...body } = plan;
  void ignored;
  return body;
}

export function initPlanHash(plan: Omit<InitPlan, "plan_hash"> | InitPlan): string {
  const body = "plan_hash" in plan ? withoutPlanHash(plan) : plan;
  return sha256(canonicalJson(initPlanDocumentValue(body)));
}

export function serializeInitPlan(plan: InitPlan): string {
  return canonicalJson(initPlanDocumentValue(plan));
}

function stringFact(proposal: InitialSourceProposal, name: string): RuntimeResult<string> {
  const fact = proposal.facts[name];
  return fact?.status === "evidenced" && typeof fact.value === "string"
    ? success(fact.value)
    : failure("INIT_FACT_REQUIRED", `initialization requires string fact ${name}`, name);
}

function stringListFact(
  proposal: InitialSourceProposal,
  name: string,
  allowEmpty = false,
): RuntimeResult<string[]> {
  const fact = proposal.facts[name];
  if (fact?.status === "evidenced" && typeof fact.value !== "string") {
    return success(fact.value.map((item) => item));
  }
  if (allowEmpty && fact?.status === "unresolved") return success([]);
  return failure("INIT_FACT_REQUIRED", `initialization requires list fact ${name}`, name);
}

export interface InferredBlueprint {
  readonly blueprint: BlueprintDefinition;
  readonly root_kind: ProjectSelection["root"]["kind"];
  readonly observations: readonly FeatureObservation[];
  readonly decision: SelectionDecision;
}

function blueprintTokens(id: string): readonly string[] {
  return [...new Set(id.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((token) => token.length > 2);
}

function briefMentions(
  briefText: string,
  blueprints: readonly BlueprintDefinition[],
): {
  readonly positive: readonly BlueprintDefinition[];
  readonly negative: readonly BlueprintDefinition[];
} {
  const positive = new Map<string, BlueprintDefinition>();
  const negative = new Map<string, BlueprintDefinition>();
  const negation = new Set(["avoid", "dont", "exclude", "never", "no", "not", "without"]);
  const clauses = briefText.toLowerCase().replaceAll(String.fromCharCode(39), "").split(/\.(?=\s|$)|[;!?\n]+/u);
  for (const clause of clauses) {
    const tokens = new Set(clause.match(/[a-z0-9]+/g) ?? []);
    if (tokens.size === 0) continue;
    const target = [...negation].some((token) => tokens.has(token))
      ? negative
      : positive;
    for (const blueprint of blueprints.filter((item) => item.status === "active")) {
      const required = blueprintTokens(blueprint.id);
      if (required.length >= 2 && required.every((token) => tokens.has(token))) {
        target.set(blueprint.id, blueprint);
      }
    }
  }
  const ordered = (values: ReadonlyMap<string, BlueprintDefinition>) =>
    [...values.values()].sort((left, right) => compareUtf8(left.id, right.id));
  return { positive: ordered(positive), negative: ordered(negative) };
}

export function inferBlueprintFromBrief(
  root: URL,
  briefPath: string,
  briefText: string,
  blueprints: readonly BlueprintDefinition[],
): RuntimeResult<InferredBlueprint> {
  const mentions = briefMentions(briefText, blueprints);
  const contradictory = mentions.positive.filter((candidate) =>
    mentions.negative.some((item) => item.id === candidate.id));
  if (mentions.positive.length !== 1 || contradictory.length > 0) {
    const references = contradictory.length > 0
      ? contradictory.map((candidate) => candidate.id)
      : mentions.positive.length > 0
        ? mentions.positive.map((candidate) => candidate.id)
        : blueprints.map((candidate) => candidate.id).sort(compareUtf8);
    return failure(
      "INIT_BLUEPRINT_CLARIFICATION_REQUIRED",
      "the natural brief must provide one non-contradictory positive catalog shape",
      briefPath,
      references,
    );
  }
  const evidenced = mentions.positive[0];
  if (evidenced === undefined) {
    return failure("INIT_BLUEPRINT_CLARIFICATION_REQUIRED", "catalog shape evidence is missing", briefPath);
  }
  const rootKinds = [...new Set(evidenced.allowed_root_kinds)];
  const rootKind = rootKinds.length === 1 ? rootKinds[0] : undefined;
  if (rootKind === undefined) {
    return failure(
      "INIT_ROOT_KIND_CLARIFICATION_REQUIRED",
      "the evidenced catalog blueprint does not imply one root kind",
      evidenced.id,
      rootKinds,
    );
  }
  const digest = sha256(new TextEncoder().encode(briefText));
  const evidenceId = deterministicInstanceId(
    "EVD",
    root.href + "\u0000" + briefPath + "\u0000catalog-observations\u0000" + digest,
  );
  const observation = (
    id: string,
    valueType: FeatureObservation["valueType"],
    value: FeatureObservation["value"],
  ): FeatureObservation => ({
    id,
    valueType,
    value,
    evidenceId,
    sourceKind: "brief",
    sourceRef: briefPath,
    sourceText: briefText,
    extractorId: "project-memory.catalog-brief-observations",
    extractorVersion: "1.0.0",
  });
  const negativeIds = mentions.negative.map((candidate) => candidate.id);
  const observations: FeatureObservation[] = [
    observation("root.kind", "string", rootKind),
    observation("product.shape", "string", evidenced.id),
    ...(negativeIds.length === 0 ? [] : [
      observation("product.anti-shapes", "string-set", negativeIds),
      observation("product.exclusions", "string-set", negativeIds),
    ]),
  ];
  const normalized = normalizeFeatureMap(observations);
  if (!normalized.ok) return normalized;
  const decision = selectBlueprint(
    selectableBlueprints(blueprints),
    normalized.value,
    {
      rootKind,
      primaryArchetype: evidenced.primary_archetype,
      profileId: "natural-brief",
      overlayIds: [],
      lockedDefinitionIds: [],
      migrationAllowed: false,
    },
  );
  if (!decision.ok) return decision;
  const winnerId = decision.value.winner?.definition_id;
  const blueprint = blueprints.find((candidate) => candidate.id === winnerId);
  if (blueprint === undefined) {
    return failure(
      "INIT_BLUEPRINT_CLARIFICATION_REQUIRED",
      "catalog scoring produced no unique eligible blueprint",
      briefPath,
      decision.value.ranked.slice(0, 3).map((candidate) => candidate.definition_id),
    );
  }
  return success({ blueprint, root_kind: rootKind, observations, decision: decision.value });
}

function selectableBlueprints(
  blueprints: readonly BlueprintDefinition[],
): readonly BlueprintSelectableDefinition[] {
  return [...blueprints].sort((left, right) => compareUtf8(left.id, right.id)).map((blueprint) => ({
    id: blueprint.id,
    version: blueprint.version,
    status: blueprint.status,
    kind: "blueprint" as const,
    compatibility: {
      root_kinds: blueprint.allowed_root_kinds,
      primary_archetypes: [blueprint.primary_archetype],
      profile_ids: [],
      required_overlays: [],
      forbidden_overlays: blueprint.overlays.forbidden,
    },
    selection: blueprint.selection,
    authorization: { mutation: "none", external_action: "none" },
  }));
}

function byId<T extends { readonly id: string }>(values: readonly T[], id: string): T | null {
  return values.find((value) => value.id === id) ?? null;
}

function slug(id: string): string {
  return id.includes(".") ? id.slice(id.indexOf(".") + 1) : id;
}

interface ProfileDefinitionClosure {
  readonly overlays: readonly string[];
  readonly components: readonly ComponentDefinition[];
  readonly domains: readonly DomainDefinition[];
}

function profileDefinitionClosure(
  blueprint: BlueprintDefinition,
  bundle: CatalogBundle,
  adapterIds: readonly string[],
): RuntimeResult<ProfileDefinitionClosure> {
  const overlayIds = new Set([...blueprint.overlays.baked, ...blueprint.overlays.defaults]);
  const overlayQueue = [...overlayIds].sort(compareUtf8);
  for (let cursor = 0; cursor < overlayQueue.length; cursor += 1) {
    const id = overlayQueue[cursor];
    if (id === undefined) continue;
    const overlay = byId(bundle.definitions.overlays, id);
    if (overlay === null) {
      return failure("INIT_CATALOG_REFERENCE_MISSING", "selected overlay is missing from the catalog", id);
    }
    for (const required of [...overlay.requires_overlays].sort(compareUtf8)) {
      if (!overlayIds.has(required)) {
        overlayIds.add(required);
        overlayQueue.push(required);
      }
    }
  }
  const componentIds = new Set(blueprint.default_components);
  const domainIds = new Set(blueprint.default_domains);
  for (const id of overlayIds) {
    const overlay = byId(bundle.definitions.overlays, id);
    if (overlay === null) continue;
    for (const component of overlay.default_components) componentIds.add(component);
    for (const domain of overlay.default_domains) domainIds.add(domain);
  }
  for (const id of adapterIds) {
    const adapter = byId(bundle.definitions.adapters, id);
    if (adapter === null) {
      return failure("INIT_CATALOG_REFERENCE_MISSING", "selected adapter is missing from the catalog", id);
    }
    for (const component of adapter.default_components) componentIds.add(component);
    for (const domain of adapter.default_domains) domainIds.add(domain);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...componentIds].sort(compareUtf8)) {
      const component = byId(bundle.definitions.components, id);
      if (component === null) {
        return failure("INIT_CATALOG_REFERENCE_MISSING", "selected component is missing from the catalog", id);
      }
      for (const domain of component.default_domains) {
        if (!domainIds.has(domain)) {
          domainIds.add(domain);
          changed = true;
        }
      }
    }
    for (const id of [...domainIds].sort(compareUtf8)) {
      const domain = byId(bundle.definitions.domains, id);
      if (domain === null) {
        return failure("INIT_CATALOG_REFERENCE_MISSING", "selected domain is missing from the catalog", id);
      }
      for (const component of domain.default_components) {
        if (!componentIds.has(component)) {
          componentIds.add(component);
          changed = true;
        }
      }
    }
  }
  return success({
    overlays: [...overlayIds].sort(compareUtf8),
    components: [...componentIds]
      .sort(compareUtf8)
      .map((id) => byId(bundle.definitions.components, id) as ComponentDefinition),
    domains: [...domainIds]
      .sort(compareUtf8)
      .map((id) => byId(bundle.definitions.domains, id) as DomainDefinition),
  });
}

function adapterSelections(
  bundle: CatalogBundle,
  ids: readonly string[],
  kind: AdapterDefinition["kind"],
): RuntimeResult<ProjectSelection["adapters"][typeof kind]> {
  const selected = ids.map((id) => byId(bundle.definitions.adapters, id));
  const invalid = selected.find((adapter) => adapter === null || adapter.kind !== kind);
  if (invalid === undefined) {
    return success((selected as AdapterDefinition[]).map((adapter) => ({
      id: adapter.id,
      version: adapter.version,
    })));
  }
  return failure(
    "INIT_ADAPTER_NOT_FOUND",
    `requested ${kind} adapter is absent or has the wrong kind`,
    ids[selected.indexOf(invalid)] ?? kind,
  );
}

function reviewWarning(): RuntimeIssue {
  return {
    code: "INIT_PITAJI_APPROVAL_REQUIRED",
    severity: "review",
    path: "approval",
    message: "Pitaji must approve the exact root, profile selection, and source proposal before initialization",
    references: [],
  };
}

async function readText(root: URL, relativePath: string): Promise<RuntimeResult<string>> {
  const target = await resolveInside(root, relativePath);
  if (!target.ok) return target;
  try {
    const stat = await lstat(target.value);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure("INIT_INPUT_UNSAFE", "initialization input must be a regular file", relativePath);
    }
    return decodeStrictUtf8(new Uint8Array(await readFile(target.value)), relativePath);
  } catch (error: unknown) {
    return failure(
      "INIT_INPUT_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
}

async function jsonFile(url: URL): Promise<RuntimeResult<unknown>> {
  try {
    const stat = await lstat(url);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure("INIT_CATALOG_UNSAFE", "catalog document must be a regular file", url.href);
    }
    const decoded = decodeStrictUtf8(new Uint8Array(await readFile(url)), url.href);
    return decoded.ok ? parseJsonDocument(decoded.value, url.href) : decoded;
  } catch (error: unknown) {
    return failure("INIT_CATALOG_READ_FAILED", error instanceof Error ? error.message : String(error), url.href);
  }
}

function catalogDocument(value: unknown): value is CatalogBundle {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const definitions = candidate.definitions;
  if (typeof definitions !== "object" || definitions === null) return false;
  const indexed = definitions as Record<string, unknown>;
  return candidate.schema_version === "1.0.0" &&
    typeof candidate.release === "string" &&
    Array.isArray(indexed.blueprints) &&
    Array.isArray(indexed.components) &&
    Array.isArray(indexed.domains) &&
    Array.isArray(indexed.overlays) &&
    Array.isArray(indexed.adapters);
}

async function defaultReadCatalog(
  bundleUrl: URL,
): Promise<RuntimeResult<{ readonly bundle: CatalogBundle; readonly lock: CatalogLockHeader }>> {
  const bundle = await jsonFile(bundleUrl);
  if (!bundle.ok) return bundle;
  if (!catalogDocument(bundle.value)) {
    return failure("INIT_CATALOG_INVALID", "catalog bundle has an incompatible shape", bundleUrl.href);
  }
  const lockUrl = new URL("catalog.lock.json", new URL("./", bundleUrl));
  const lock = await jsonFile(lockUrl);
  if (!lock.ok) return lock;
  if (
    typeof lock.value !== "object" || lock.value === null ||
    typeof (lock.value as Record<string, unknown>).release !== "string" ||
    typeof (lock.value as Record<string, unknown>).release_hash !== "string"
  ) {
    return failure("INIT_CATALOG_LOCK_INVALID", "catalog release lock header is invalid", lockUrl.href);
  }
  return success({
    bundle: bundle.value,
    lock: {
      release: (lock.value as Record<string, string>).release ?? "",
      release_hash: (lock.value as Record<string, string>).release_hash ?? "",
    },
  });
}

class NodeProfileTargetReader implements ProfileTargetReader {
  async read(root: URL, relativePath: string): Promise<RuntimeResult<Uint8Array | null>> {
    const target = await resolveInside(root, relativePath);
    if (!target.ok) return target;
    try {
      const stat = await lstat(target.value);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        return failure("PROFILE_TARGET_UNSAFE", "profile target must be a regular file", relativePath);
      }
      return success(new Uint8Array(await readFile(target.value)));
    } catch (error: unknown) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? success(null)
        : failure("PROFILE_TARGET_READ_FAILED", error instanceof Error ? error.message : String(error), relativePath);
    }
  }
}

async function targetSnapshot(root: URL): Promise<ReadonlyMap<string, Uint8Array>> {
  const reader = new NodeProfileTargetReader();
  const files = new Map<string, Uint8Array>();
  for (const relativePath of ["AGENTS.md", "CLAUDE.md"]) {
    const current = await reader.read(root, relativePath);
    if (current.ok && current.value !== null) files.set(relativePath, current.value);
  }
  return files;
}

async function defaultPlanProfile(
  input: ProfilePlanInput,
): Promise<RuntimeResult<CanonicalMutationPlan<unknown>>> {
  if (getSchemaValidator("project-memory/v1/project-selection") === undefined) {
    const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
    if (!registered.ok) return registered;
  }
  const compiler: ProfileCompiler = createProfileCompiler({
    catalog: new CatalogSelectionResolver(),
    source_renderer: acceptedProfileSourceRenderer,
    artifact_renderer: createProfileArtifactRenderer({ files: await targetSnapshot(input.target_root) }),
    target_reader: new NodeProfileTargetReader(),
  });
  return compiler.plan(input);
}

export function createDefaultBuildInitPlanDependencies(): BuildInitPlanDependencies {
  const git = new GitCliClient(new NodeCommandRunner());
  return {
    head: async (root) => {
      try {
        return success(await git.head(root));
      } catch (error: unknown) {
        return failure("GIT_HEAD_FAILED", error instanceof Error ? error.message : String(error));
      }
    },
    read_brief: readText,
    read_catalog: defaultReadCatalog,
    plan_profile: defaultPlanProfile,
  };
}

function projectSources(input: {
  readonly rootId: string;
  readonly approvalId: string;
  readonly proposal: InitialSourceProposal;
  readonly blueprint: BlueprintDefinition;
  readonly bundle: CatalogBundle;
  readonly adapterIds: readonly string[];
}): RuntimeResult<{
  readonly selectionParts: Pick<ProjectSelection, "overlays" | "components" | "domains">;
  readonly sources: AcceptedProfileSourceSet;
}> {
  const name = stringFact(input.proposal, "name");
  if (!name.ok) return name;
  const mission = stringFact(input.proposal, "mission");
  if (!mission.ok) return mission;
  const owners = stringListFact(input.proposal, "owners");
  if (!owners.ok) return owners;
  const successCriteria = stringListFact(input.proposal, "success_criteria");
  if (!successCriteria.ok) return successCriteria;
  const includedScope = stringListFact(input.proposal, "included_scope");
  if (!includedScope.ok) return includedScope;
  const excludedScope = stringListFact(input.proposal, "excluded_scope", true);
  if (!excludedScope.ok) return excludedScope;

  const closure = profileDefinitionClosure(input.blueprint, input.bundle, input.adapterIds);
  if (!closure.ok) return closure;
  const componentDefinitions = closure.value.components;
  const domainDefinitions = closure.value.domains;
  const componentBindings = componentDefinitions.map((definition) => ({
    instance_id: deterministicInstanceId("CMP", `${input.rootId}\u0000component\u0000${definition.id}`),
    definition: { id: definition.id, version: definition.version },
    slug: slug(definition.id),
    source_revision: 1,
  }));
  const domainBindings = domainDefinitions.map((definition) => ({
    instance_id: deterministicInstanceId("DOM", `${input.rootId}\u0000domain\u0000${definition.id}`),
    definition: { id: definition.id, version: definition.version },
    slug: slug(definition.id),
    source_revision: 1,
  }));
  return success({
    selectionParts: {
      overlays: [...closure.value.overlays],
      components: componentBindings,
      domains: domainBindings,
    },
    sources: {
      project: {
        id: input.rootId,
        revision: 1,
        name: name.value,
        mission: mission.value,
        owners: owners.value,
        stakeholders: [],
        success_criteria: successCriteria.value,
        included_scope: includedScope.value,
        excluded_scope: excludedScope.value,
        approval_refs: [input.approvalId],
      },
      constraints: [],
      policies: [],
      blueprint_documents: [],
      components: componentDefinitions.map((definition, index) => ({
        id: componentBindings[index]?.instance_id ?? "",
        root_id: input.rootId,
        revision: 1,
        definition: { id: definition.id, version: definition.version },
        slug: slug(definition.id),
        name: definition.name,
        purpose: definition.purpose,
        owners: owners.value,
        status: "active",
        inclusion_boundary: [definition.purpose],
        exclusion_boundary: [],
        repositories: [],
        dependencies: [],
        risks: [],
        links: [],
        approval_refs: [input.approvalId],
      })),
      domains: domainDefinitions.map((definition, index) => ({
        id: domainBindings[index]?.instance_id ?? "",
        root_id: input.rootId,
        revision: 1,
        definition: { id: definition.id, version: definition.version },
        slug: slug(definition.id),
        name: definition.name,
        purpose: definition.purpose,
        owners: owners.value,
        status: "active",
        inclusion_boundary: [definition.purpose],
        exclusion_boundary: [],
        repositories: [],
        dependencies: [],
        risks: [],
        links: [],
        approval_refs: [input.approvalId],
      })),
      root_relationships: [],
    },
  });
}

export async function buildInitPlan(
  replay: InitReplayInput,
  dependencies: BuildInitPlanDependencies = createDefaultBuildInitPlanDependencies(),
): Promise<RuntimeResult<InitPlan>> {
  let root: URL;
  let catalogUrl: URL;
  try {
    root = new URL(replay.root);
    catalogUrl = new URL(replay.catalog_bundle_path);
  } catch (error: unknown) {
    return failure("INIT_REPLAY_INVALID", error instanceof Error ? error.message : String(error));
  }
  const brief = await dependencies.read_brief(root, replay.brief_path);
  if (!brief.ok) return brief;
  const proposal = buildInitialSourceProposal({ root, brief_path: replay.brief_path, brief_text: brief.value });
  if (!proposal.ok) return proposal;
  if (proposal.value.unresolved_required_facts.length > 0) {
    return failure(
      "INIT_CLARIFICATION_REQUIRED",
      proposal.value.clarification?.question ?? "initialization brief is incomplete",
      replay.brief_path,
      proposal.value.unresolved_required_facts,
    );
  }
  const catalog = await dependencies.read_catalog(catalogUrl);
  if (!catalog.ok) return catalog;
  if (catalog.value.bundle.release !== catalog.value.lock.release) {
    return failure("INIT_CATALOG_VERSION_MISMATCH", "catalog bundle and lock releases differ", catalogUrl.href);
  }
  const head = await dependencies.head(root);
  if (!head.ok) return head;
  if (!/^[0-9a-f]{40}$/.test(head.value)) {
    return failure("GIT_HEAD_INVALID", "initialization requires an exact SHA-1 HEAD", head.value);
  }

  const inferred = inferBlueprintFromBrief(
    root,
    replay.brief_path,
    brief.value,
    catalog.value.bundle.definitions.blueprints,
  );
  if (!inferred.ok) return inferred;
  const rootKind = inferred.value.root_kind;
  const archetype = inferred.value.blueprint.primary_archetype;
  const normalized = normalizeFeatureMap(inferred.value.observations);
  if (!normalized.ok) return normalized;
  const decision = inferred.value.decision;
  const blueprint = inferred.value.blueprint;
  const proposalEvidenceHash = sha256(canonicalJson(proposal.value));
  const namespace = stringFact(proposal.value, "namespace");
  if (!namespace.ok) return namespace;
  const lifecycle = stringFact(proposal.value, "lifecycle");
  if (!lifecycle.ok) return lifecycle;
  const rootId = deterministicInstanceId("ROOT", `${root.href}\u0000${namespace.value}`);
  const approvalId = deterministicInstanceId("APR", `${rootId}\u0000${proposalEvidenceHash}`);
  const agentAdapters = adapterSelections(catalog.value.bundle, [replay.agent_adapter], "agent");
  if (!agentAdapters.ok) return agentAdapters;
  const runtimeIds = stringListFact(proposal.value, "runtime_adapters");
  if (!runtimeIds.ok) return runtimeIds;
  const runtimeAdapters = adapterSelections(catalog.value.bundle, runtimeIds.value, "runtime");
  if (!runtimeAdapters.ok) return runtimeAdapters;
  const workflowIds = stringListFact(proposal.value, "workflow_adapters");
  if (!workflowIds.ok) return workflowIds;
  const workflowAdapters = adapterSelections(catalog.value.bundle, workflowIds.value, "workflow");
  if (!workflowAdapters.ok) return workflowAdapters;
  const sourceModel = projectSources({
    rootId,
    approvalId,
    proposal: proposal.value,
    blueprint,
    bundle: catalog.value.bundle,
    adapterIds: [replay.agent_adapter, ...runtimeIds.value, ...workflowIds.value],
  });
  if (!sourceModel.ok) return sourceModel;
  const sourceProposalHash = sha256(canonicalJson(sourceModel.value.sources));
  const selection: ProjectSelection = {
    schema_version: "1.0.0",
    root: {
      id: rootId,
      namespace: namespace.value,
      kind: rootKind,
      primary_archetype: archetype,
      blueprint: { id: blueprint.id, version: blueprint.version },
      lifecycle: lifecycle.value as ProjectSelection["root"]["lifecycle"],
    },
    ...sourceModel.value.selectionParts,
    adapters: {
      agent: agentAdapters.value,
      runtime: runtimeAdapters.value,
      workflow: workflowAdapters.value,
    },
    catalog: { release: catalog.value.lock.release, catalog_hash: catalog.value.lock.release_hash },
    acceptance: { approval_id: approvalId, accepted_by: "Pitaji", accepted_at: replay.created_at },
  };
  const yaml = emitGeneratedYaml(selection);
  if (!yaml.ok) return yaml;
  const approval: ApprovalRecordReference = {
    id: approvalId,
    root_id: rootId,
    revision: 1,
    decision: "approved",
    approved_by: "Pitaji",
    approved_at: replay.created_at,
    scope: "profile.bootstrap",
    artifact_sha256: sourceProposalHash,
  };
  const compilation = await dependencies.plan_profile({
    target_root: root,
    target_ref: replay.target_ref,
    expected_head: head.value,
    plan_id: deterministicInstanceId("PLAN", `${rootId}\u0000${head.value}\u0000${sourceProposalHash}`),
    created_by: "codex",
    created_at: replay.created_at,
    expires_at: replay.expires_at,
    project_yaml: new TextEncoder().encode(yaml.value),
    accepted_sources: sourceModel.value.sources,
    catalog_release_root: new URL("./", catalogUrl),
    previous_profile_lock: null,
    approval_records: [approval],
  });
  if (!compilation.ok) return compilation;
  const body: Omit<InitPlan, "plan_hash"> = {
    schema_version: "1.0.0",
    target_root_id: rootId,
    target_ref: replay.target_ref,
    expected_head: head.value,
    normalized_feature_hash: sha256(canonicalJson(normalized.value)),
    selection: decision,
    proposed_project_selection: selection,
    proposed_sources: sourceModel.value.sources,
    source_proposal: proposal.value,
    source_proposal_hash: sourceProposalHash,
    unresolved_required_facts: [],
    required_approval_kinds: ["directional"],
    profile_compilation: compilation.value,
    replay,
    review_packet: {
      status: "review_required",
      reason: "Pitaji must approve the exact selection and source proposal.",
      approval_id: approvalId,
    },
  };
  return success({ ...body, plan_hash: initPlanHash(body) }, [...compilation.warnings, reviewWarning()]);
}

export function pathToInitUrl(value: string, base: URL): RuntimeResult<URL> {
  if (base.protocol !== "file:") return failure("CLI_PATH_INVALID", "CLI paths require a file URL base");
  try {
    const target = value.startsWith("file:")
      ? fileURLToPath(new URL(value))
      : path.resolve(fileURLToPath(base), value);
    return success(pathToFileURL(target));
  } catch (error: unknown) {
    return failure("CLI_PATH_INVALID", error instanceof Error ? error.message : String(error), value);
  }
}
