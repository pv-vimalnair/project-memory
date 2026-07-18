# Project Memory Profile Compiler and Materializer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile one accepted root selection into a deterministic canonical mutation plan containing accepted source documents, an exact vendored catalog closure, stable instance references, locks, adapters, and a fixed startup doorway, without giving the compiler authority to update canonical Git state.

**Architecture:** `project.yaml` is the only human-edited profile-selection input. `ProfileCompiler.plan` validates accepted inputs against a locked catalog release and returns a side-effect-free `ProfileCanonicalMutationPlan` narrowing of the foundation-owned generic contract; `ProfileMaterializer.materializeToIsolatedStaging` may write those planned bytes only into a verified isolated staging worktree. `ProfileVerifier` reparses only target-repository bytes, while `IntegrationCoordinator.finalizeMutation` is the sole API permitted to create a canonical commit or advance a canonical ref.

**Tech Stack:** The foundation TypeScript/ESM package, TypeBox/Ajv schemas, strict YAML, canonical JSON/SHA-256, Git, and Vitest.

## Global Constraints

- Repository root is `<repository-root>` (or its isolated worktree). Execute from `plugins/project-memory/`; every implementation path below is relative to that package root.
- Prerequisites: the foundation completion gate and a validated catalog release from the catalog-content plan.
- This plan owns `src/profile/**`, `src/materialize/**`, `templates/project-memory/**`, profile schemas, and profile compiler tests.
- Foundation exclusively owns `src/contracts/canonical-mutation-plan.ts`, `CanonicalMutationPlan<TMetadata>`, `CanonicalMutationKind`, and `canonicalMutationPlanHash`; profile code imports them from the package root.
- It consumes accepted selection decisions; it does not classify roots, accept product direction, or infer missing facts.
- Initial and changed profile selections require linked Pitaji approval records before a mutation plan is valid.
- `ProfileCompiler` has no canonical write or Git-ref API.
- `ProfileMaterializer.materializeToIsolatedStaging` rejects normal working trees and never commits, updates refs, or writes into the shared Git directory.
- Raw `applyFileTransaction` use is confined to the staging materializer and its tests. CLI, workers, and profile services never call it directly.
- `IntegrationCoordinator.bootstrap` may assemble one-time initialization evidence, but it must delegate the canonical compare-and-swap to `IntegrationCoordinator.finalizeMutation`; that method is the only canonical commit/ref writer.
- Never mutate `profile.lock.yaml`, `catalog.lock.json`, `catalog/selected/**`, generated schemas, generated views, or tool adapters by hand.
- This plan never renders `NOW.md`, `HANDOFF.md`, `WORKSTREAMS.md`, `CHANGELOG.md`, `HISTORY.md`, or `INDEX.json`; governance `ViewGenerator` owns those bytes.
- Existing root, component, domain, and cross-root relationship IDs are preserved. Recompilation never silently replaces an ID.
- Every canonical Markdown artifact has a strict YAML front-matter envelope and a separately parsed Markdown body.
- No generated file may contain a local absolute path, secret, credential, or transcript body.
- Every task follows five TDD steps and ends in one logical commit.

---

## Target Repository Contract

The compiler plans only accepted source truth and compiler-owned generated artifacts. Governance adds the six generated views during finalization.

```text
PROJECT_CONTEXT.md
AGENTS.md                                      optional Codex adapter
CLAUDE.md                                      optional Claude Code adapter
docs/project-memory/PROTOCOL.md
docs/project-memory/project.yaml
docs/project-memory/profile.lock.yaml
docs/project-memory/catalog.lock.json
docs/project-memory/source/PROJECT.md
docs/project-memory/source/CONSTRAINTS.md
docs/project-memory/source/POLICIES.md
docs/project-memory/source/ROOT_RELATIONSHIPS.md       only when accepted relationships exist
docs/project-memory/components/<component-id>/COMPONENT.md
docs/project-memory/domains/<domain-id>/DOMAIN.md
docs/project-memory/initiatives/<initiative-id>/INITIATIVE.md
docs/project-memory/workstreams/<workstream-id>/WORKSTREAM.md
docs/project-memory/workstreams/<workstream-id>/tasks/<task-id>.md
docs/project-memory/records/{decisions,ideas,changes,findings,risks,evidence,lessons,approvals}/
docs/project-memory/governance/{claims,integration,migrations}/
docs/project-memory/catalog/selected/**
docs/project-memory/catalog/proposals/
docs/project-memory/views/{NOW.md,HANDOFF.md,WORKSTREAMS.md,CHANGELOG.md,HISTORY.md,INDEX.json}    governance-owned
docs/project-memory/archive/{sessions,transcripts,snapshots,retired}/
schemas/project-memory/v1/**
tools/project-memory/config.json
```

The fixed startup order in `PROJECT_CONTEXT.md` is:

1. `PROJECT_CONTEXT.md`
2. `docs/project-memory/profile.lock.yaml`
3. `docs/project-memory/views/NOW.md`
4. The assigned task packet
5. Named component/domain documents
6. Linked canonical records
7. Archive only for historical investigation

## Stable Profile Interfaces

```ts
export interface ProfilePlanInput {
  target_root: URL;
  target_ref: string;
  expected_head: string;
  plan_id: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  project_yaml: Uint8Array;
  accepted_sources: AcceptedProfileSourceSet;
  catalog_release_root: URL;
  previous_profile_lock: ProfileLock | null;
  approval_records: readonly ApprovalRecordReference[];
}

export interface AcceptedProfileSourceSet {
  project: ProjectSourceData;
  constraints: readonly ConstraintData[];
  policies: readonly PolicyData[];
  blueprint_documents: readonly BlueprintSourceDocument[];
  components: readonly ComponentInstanceData[];
  domains: readonly DomainInstanceData[];
  root_relationships: readonly RootRelationshipSourceData[];
}

export interface ProfileMutationMetadata {
  project_hash: string;
  profile: ResolvedProfile;
  selected_catalog_lock: SelectedCatalogLock;
  profile_lock: ProfileLock;
}

export type ProfileMutationKind = "profile.bootstrap" | "profile.evolution";

export type ProfileCanonicalMutationPlan = Omit<
  CanonicalMutationPlan<ProfileMutationMetadata>,
  "mutation_kind"
> & { readonly mutation_kind: ProfileMutationKind };

export interface ProfileCompiler {
  plan(input: ProfilePlanInput): Promise<RuntimeResult<ProfileCanonicalMutationPlan>>;
}

export interface StagingMaterializationInput {
  staging_root: URL;
  expected_staging_head: string;
  plan: ProfileCanonicalMutationPlan;
}

export interface ProfileMaterializer {
  materializeToIsolatedStaging(
    input: StagingMaterializationInput,
  ): Promise<RuntimeResult<StagedProfileMutation>>;
}

export interface ProfileVerifier {
  verify(root: URL): Promise<RuntimeResult<ProfileVerificationReport>>;
}
```

`CanonicalMutationPlan<TMetadata>` and `canonicalMutationPlanHash` are imported from the foundation package root. Profile code defines only `ProfileMutationMetadata` and the two-kind `ProfileCanonicalMutationPlan` narrowing. The central hash omits `plan_hash`, projects each write to `relative_path`, `mode`, `expected_existing_sha256`, and `bytes_sha256`, and sorts projections by UTF-8 path bytes. Planning and staging never create a commit. Governance may build an augmented shared plan with authority, evidence, event, and view writes, then calls the shared `IntegrationCoordinator.finalizeMutation` compare-and-swap engine; bootstrap delegates to that engine and is not a second writer.

### Task 1: Define Selection, Accepted Source, Lock, and Profile Metadata Contracts

**Files:**

- Create: `src/profile/contracts/project-selection.ts`
- Create: `src/profile/contracts/source-documents.ts`
- Create: `src/profile/contracts/root-relationships.ts`
- Create: `src/profile/contracts/selected-catalog-lock.ts`
- Create: `src/profile/contracts/profile-lock.ts`
- Create: `src/profile/contracts/resolved-profile.ts`
- Create: `src/profile/contracts/profile-mutation-metadata.ts`
- Create: `src/profile/contracts/index.ts`
- Create: `tests/profile/contracts.test.ts`
- Create: `tests/fixtures/profile/contracts/**`

**Interfaces:** Consumes foundation `RuntimeResult`, IDs, timestamps, semantic versions, SHA-256, `PlannedWrite`, shared `CanonicalMutationPlan<TMetadata>`, and `canonicalMutationPlanHash`. Produces `ProfilePlanInput`, `AcceptedProfileSourceSet`, `ResolvedProfile`, `SelectedCatalogLock`, `ProfileLock`, `ProfileMutationMetadata`, and the two-kind `ProfileCanonicalMutationPlan` narrowing; it never redeclares the shared plan or hash.

- [ ] **Step 1: Write failing schema and authority-boundary tests**

```ts
it("requires accepted facts for every planned canonical artifact", () => {
  const result = validateWithSchema("project-memory/v1/accepted-profile-source-set", {
    ...validAcceptedSources,
    project: { ...validAcceptedSources.project, mission: "" },
  });
  expect(result).toMatchObject({
    ok: false,
    issues: [{ path: "/project/mission" }],
  });
});

it("narrows the shared plan without changing its metadata slot", () => {
  expectTypeOf<ProfileCanonicalMutationPlan["metadata"]>()
    .toEqualTypeOf<ProfileMutationMetadata>();
  expectTypeOf<ProfileCanonicalMutationPlan["mutation_kind"]>()
    .toEqualTypeOf<"profile.bootstrap" | "profile.evolution">();
});
```

Cover invalid root kind/archetype, duplicate IDs, blank mission, absent owner, source/selection mismatch, absent approval, malformed hash, unknown key, a metadata type mismatch, and a mutation kind outside the two profile kinds.

- [ ] **Step 2: Run the contract tests and verify failure**

```powershell
npm test -- tests/profile/contracts.test.ts
```

Expected: FAIL because the profile schemas, resolved profile contract, metadata type, and shared-plan narrowing are not defined.

- [ ] **Step 3: Implement exact schemas and public contracts**

```ts
export const RootNamespaceSchema = Type.String({
  pattern: "^[a-z0-9]+(?:[.-][a-z0-9]+)*$",
  minLength: 3,
  maxLength: 160,
});

export const SafeRelativePathSchema = Type.String({
  pattern: "^(?![A-Za-z]:)(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$",
  minLength: 1,
});

export const RootAddressSchema = Type.Object({
  namespace: RootNamespaceSchema,
  root_id: InstanceIdSchema("ROOT"),
  canonical_repository: NonBlankStringSchema,
  profile_lock_hash: Sha256Schema,
}, { additionalProperties: false });

export const CanonicalArtifactReferenceSchema = Type.Object({
  root: RootAddressSchema,
  relative_path: SafeRelativePathSchema,
  revision: Type.Integer({ minimum: 1 }),
  sha256: Sha256Schema,
}, { additionalProperties: false });

export const PortfolioChildReferenceSchema = Type.Object({
  kind: Type.Literal("portfolio-child"),
  relationship_id: NonBlankStringSchema,
  revision: Type.Integer({ minimum: 1 }),
  portfolio: RootAddressSchema,
  child: RootAddressSchema,
  relationship_owner_root_id: InstanceIdSchema("ROOT"),
  child_truth_owner_root_id: InstanceIdSchema("ROOT"),
  relationship_status: Type.Union([
    Type.Literal("proposed"), Type.Literal("active"), Type.Literal("retired"),
  ]),
  dependency_kinds: Type.Array(NonBlankStringSchema, { uniqueItems: true }),
  approval_refs: Type.Array(InstanceIdSchema("APR"), { minItems: 1, uniqueItems: true }),
}, { $id: "project-memory/v1/portfolio-child-reference", additionalProperties: false });

export const SharedPlatformProviderReferenceSchema = Type.Object({
  kind: Type.Literal("shared-platform-provider"),
  relationship_id: NonBlankStringSchema,
  revision: Type.Integer({ minimum: 1 }),
  provider: RootAddressSchema,
  consumer: RootAddressSchema,
  owner_root_id: InstanceIdSchema("ROOT"),
  interface_refs: Type.Array(CanonicalArtifactReferenceSchema, { minItems: 1 }),
  approval_refs: Type.Array(InstanceIdSchema("APR"), { minItems: 1, uniqueItems: true }),
}, { $id: "project-memory/v1/shared-platform-provider-reference", additionalProperties: false });

export const SharedPlatformConsumerReferenceSchema = Type.Object({
  kind: Type.Literal("shared-platform-consumer"),
  relationship_id: NonBlankStringSchema,
  revision: Type.Integer({ minimum: 1 }),
  consumer: RootAddressSchema,
  provider: RootAddressSchema,
  owner_root_id: InstanceIdSchema("ROOT"),
  provider_interface_refs: Type.Array(CanonicalArtifactReferenceSchema, { minItems: 1 }),
  usage_component_ids: Type.Array(InstanceIdSchema("CMP"), { minItems: 1, uniqueItems: true }),
  migration_state: Type.Union([
    Type.Literal("current"), Type.Literal("migration-required"), Type.Literal("retiring"),
  ]),
  approval_refs: Type.Array(InstanceIdSchema("APR"), { minItems: 1, uniqueItems: true }),
}, { $id: "project-memory/v1/shared-platform-consumer-reference", additionalProperties: false });

export const RootRelationshipSourceDataSchema = Type.Union([
  PortfolioChildReferenceSchema,
  SharedPlatformProviderReferenceSchema,
  SharedPlatformConsumerReferenceSchema,
], { $id: "project-memory/v1/root-relationship-source-data" });

export const ProjectSelectionSchema = Type.Object({
  schema_version: SemverSchema,
  root: Type.Object({
    id: InstanceIdSchema("ROOT"),
    namespace: RootNamespaceSchema,
    kind: RootKindSchema,
    primary_archetype: PrimaryArchetypeSchema,
    blueprint: Type.Object({ id: DefinitionIdSchema, version: SemverSchema }),
    lifecycle: LifecycleSchema,
  }, { additionalProperties: false }),
  overlays: Type.Array(DefinitionIdSchema, { uniqueItems: true }),
  components: Type.Array(ProfileInstanceBindingSchema, { minItems: 1 }),
  domains: Type.Array(ProfileInstanceBindingSchema, { minItems: 1 }),
  adapters: AdapterSelectionSchema,
  catalog: Type.Object({ release: SemverSchema, catalog_hash: Sha256Schema }),
  acceptance: Type.Object({
    approval_id: InstanceIdSchema("APR"),
    accepted_by: Type.Literal("Pitaji"),
    accepted_at: UtcTimestampSchema,
  }, { additionalProperties: false }),
}, { $id: "project-memory/v1/project-selection", additionalProperties: false });

export const AcceptedProfileSourceSetSchema = Type.Object({
  project: ProjectSourceDataSchema,
  constraints: Type.Array(ConstraintDataSchema),
  policies: Type.Array(PolicyDataSchema),
  blueprint_documents: Type.Array(BlueprintSourceDocumentSchema),
  components: Type.Array(ComponentInstanceDataSchema),
  domains: Type.Array(DomainInstanceDataSchema),

  root_relationships: Type.Array(RootRelationshipSourceDataSchema),
}, { $id: "project-memory/v1/accepted-profile-source-set", additionalProperties: false });
```

Every accepted source record carries a stable type-specific ID (`id` or `relationship_id`), positive integer `revision`, non-empty `approval_refs`, and type-specific facts. Define `ProfileMutationMetadata` exactly as shown in Stable Profile Interfaces and define `ProfileCanonicalMutationPlan` only as the narrowed shared generic type. Diagnostics remain `RuntimeResult.warnings` and are not hashed into successful plan metadata. Profile retirement is proposed by the evolution diff and finalized by governance, never inferred by the compiler. Register and emit only profile-owned schemas.

- [ ] **Step 4: Run contract tests, schema emission, and type checking**

```powershell
npm test -- tests/profile/contracts.test.ts
npm run typecheck
npm run build
npm run schemas:emit
```

Expected: PASS; invalid fixtures fail at exact JSON Pointer paths and emitted schemas are under `schemas/project-memory/v1/`.

- [ ] **Step 5: Commit the profile contracts**

```powershell
git add src/profile/contracts tests/profile/contracts.test.ts tests/fixtures/profile/contracts schemas/project-memory/v1
git commit -m "feat(profile): define profile source and metadata contracts"
```

Expected: one commit containing contracts and generated schemas, with no runtime writer.

### Task 2: Add Strict Canonical Markdown Envelopes and Byte-Stable Round Trips

**Files:**

- Create: `src/profile/contracts/canonical-markdown.ts`
- Create: `src/materialize/parse-canonical-markdown.ts`
- Create: `src/materialize/render-canonical-markdown.ts`
- Create: `tests/materialize/canonical-markdown.test.ts`
- Create: `tests/fixtures/materialize/canonical-markdown/**`

**Interfaces:** Produces `CanonicalMarkdownEnvelope`, `CanonicalMarkdownDocument`, `parseCanonicalMarkdown(bytes)`, and `renderCanonicalMarkdown(document)` for project, component, domain, initiative, workstream, and task artifacts.

- [ ] **Step 1: Write failing strict-parser and byte-round-trip tests**

```ts
it.each(validCanonicalArtifacts)("round trips $type bytes exactly", fixture => {
  const bytes = readFixtureBytes(fixture.path);
  const parsed = mustValue(parseCanonicalMarkdown(bytes));
  expect(renderCanonicalMarkdown(parsed)).toEqual(bytes);
});

it.each([
  "missing-opening-delimiter.md",
  "unknown-envelope-key.md",
  "wrong-id-prefix.md",
  "zero-revision.md",
  "crlf.md",
  "bom.md",
  "body-without-trailing-newline.md",
])("rejects non-canonical document %s", fixture => {
  expect(parseCanonicalMarkdown(readFixtureBytes(fixture)).ok).toBe(false);
});
```

Use one valid fixture for each path class: `PROJECT.md`, `COMPONENT.md`, `DOMAIN.md`, `INITIATIVE.md`, `WORKSTREAM.md`, and `<task-id>.md`.

- [ ] **Step 2: Run canonical Markdown tests and verify failure**

```powershell
npm test -- tests/materialize/canonical-markdown.test.ts
```

Expected: FAIL because the envelope schema, parser, and renderer do not exist.

- [ ] **Step 3: Implement the discriminated envelope, strict parser, and canonical renderer**

```ts
export const CanonicalArtifactTypeSchema = Type.Union([
  Type.Literal("project"),
  Type.Literal("component"),
  Type.Literal("domain"),
  Type.Literal("initiative"),
  Type.Literal("workstream"),
  Type.Literal("task"),
]);

export const CanonicalMarkdownEnvelopeSchema = Type.Object({
  schema: Type.Literal("project-memory/canonical-markdown"),
  type: CanonicalArtifactTypeSchema,
  version: Type.Literal("1.0.0"),
  id: Type.String({ minLength: 1 }),
  revision: Type.Integer({ minimum: 1 }),
  root_id: InstanceIdSchema("ROOT"),
  approval_refs: Type.Array(InstanceIdSchema("APR"), { minItems: 1, uniqueItems: true }),
}, {
  $id: "project-memory/v1/canonical-markdown-envelope",
  additionalProperties: false,
});

export interface CanonicalMarkdownEnvelope {
  schema: "project-memory/canonical-markdown";
  type: CanonicalArtifactType;
  version: "1.0.0";
  id: string;
  revision: number;
  root_id: string;
  approval_refs: readonly string[];
}

export interface CanonicalMarkdownDocument {
  envelope: CanonicalMarkdownEnvelope;
  body: string;
}
```

The envelope YAML keys are emitted exactly in `schema`, `type`, `version`, `id`, `revision`, `root_id`, `approval_refs` order. Require UTF-8 without BOM, LF only, opening `---` on byte zero, the first subsequent delimiter line as the envelope terminator, one non-empty Markdown body, and exactly one final newline; later `---` lines remain ordinary body bytes. Validate ID prefixes by type: `ROOT`, `CMP`, `DOM`, `INIT`, `WS`, and `TASK`. The parser separates envelope bytes from body bytes, rejects aliases, tags, duplicate/unknown keys, and returns `CANONICAL_MARKDOWN_NON_CANONICAL` when rendering the parsed document would not reproduce the original bytes.

```ts
export function parseCanonicalMarkdown(bytes: Uint8Array): RuntimeResult<CanonicalMarkdownDocument> {
  const decoded = decodeStrictUtf8(bytes);
  if (!decoded.ok) return decoded;
  const sections = splitFrontMatter(decoded.value);
  if (!sections.ok) return sections;
  const parsedYaml = parseYamlDocument(
    sections.value.front_matter,
    "canonical-markdown-front-matter",
  );
  if (!parsedYaml.ok) return parsedYaml;
  const envelope = validateWithSchema<CanonicalMarkdownEnvelope>(
    "project-memory/v1/canonical-markdown-envelope",
    parsedYaml.value,
  );
  if (!envelope.ok) return envelope;
  const body = validateCanonicalBody(sections.value.body);
  if (!body.ok) return body;
  const document = { envelope: envelope.value, body: body.value };
  return bytesEqual(renderCanonicalMarkdown(document), bytes)
    ? success(document)
    : failure("CANONICAL_MARKDOWN_NON_CANONICAL");
}
```

- [ ] **Step 4: Run parser, schema, and round-trip checks**

```powershell
npm test -- tests/materialize/canonical-markdown.test.ts
npm run typecheck
npm run schemas:emit
```

Expected: PASS; every valid artifact round trips byte-for-byte and every malformed fixture fails closed.

- [ ] **Step 5: Commit the canonical Markdown layer**

```powershell
git add src/profile/contracts/canonical-markdown.ts src/materialize tests/materialize tests/fixtures/materialize schemas/project-memory/v1
git commit -m "feat(materialize): add strict canonical markdown envelopes"
```

Expected: one commit covering all six canonical Markdown artifact types.

### Task 3: Verify and Resolve the Exact Transitive Catalog Source Closure

**Files:**

- Create: `src/profile/catalog-release-reader.ts`
- Create: `src/profile/catalog-selection-resolver.ts`
- Create: `tests/profile/catalog-selection-resolver.test.ts`
- Create: `tests/fixtures/catalog-release/minimal-valid/**`
- Create: `tests/fixtures/catalog-release/tampered/**`

**Interfaces:** Produces `ResolvedCatalogSelection` containing trusted exact source bytes for every selected and transitively required definition plus required emitted schema bytes.

- [ ] **Step 1: Write failing closure and source-integrity tests**

```ts
it("returns both pattern halves and every referenced companion half", async () => {
  const resolved = mustValue(await resolver.resolve(validSelection, releaseUrl));
  expect(resolved.files.map(file => [file.kind, file.source_relative_path])).toEqual([
    ["blueprint", "blueprints/application-service/app.consumer-mobile.yaml"],
    ["companion-core", "companions/companion.mutation.core.yaml"],
    ["companion-taxonomy", "companions/companion.mutation.taxonomy.yaml"],
    ["pattern-core", "patterns/engineering/engineering.feature.implement.core.yaml"],
    ["pattern-taxonomy", "patterns/engineering/engineering.feature.implement.taxonomy.yaml"],
    ["definition-source", "components/surface.mobile-application.yaml"],
    ["generated-schema", "schemas/project-memory/v1/pattern-core.schema.json"],
  ]);
});

it("rejects one changed source byte before parsing it as trusted", async () => {
  expect(await resolver.resolve(validSelection, tamperedReleaseUrl)).toMatchObject({
    ok: false,
    issues: [{ code: "CATALOG_RELEASE_SOURCE_HASH_MISMATCH" }],
  });
});
```

Also cover missing half, missing blueprint source, missing schema, deprecated-for-selection definition, wrong release, unresolved reference, version conflict, and an unlisted extra transitive dependency.

- [ ] **Step 2: Run catalog-resolution tests and verify failure**

```powershell
npm test -- tests/profile/catalog-selection-resolver.test.ts
```

Expected: FAIL because no release reader computes a locked transitive byte closure.

- [ ] **Step 3: Implement release verification before semantic resolution**

```ts
export type CatalogSourceKind =
  | "pattern-core"
  | "pattern-taxonomy"
  | "companion-core"
  | "companion-taxonomy"
  | "blueprint"
  | "definition-source"
  | "generated-schema";

export interface ResolvedCatalogSourceFile {
  kind: CatalogSourceKind;
  definition_ids: readonly string[];
  source_relative_path: string;
  target_relative_path: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface ResolvedCatalogSelection {
  release: string;
  release_hash: string;
  files: readonly ResolvedCatalogSourceFile[];
  blueprint: BlueprintDefinition;
  definitions: readonly LockedDefinition[];
  required_schema_ids: readonly string[];
}
```

First verify the release manifest and every source hash from raw bytes. Then parse definitions, follow blueprint, overlay, component, domain, adapter, pattern, companion, template, policy, gate, and schema references to a fixed point. Require both `.core.yaml` and `.taxonomy.yaml` halves for every selected pattern and companion. Sort files by `target_relative_path` and reject cycles that do not converge to an identical already-visited `(id, version, hash)` tuple.

- [ ] **Step 4: Run resolver tests and type checking**

```powershell
npm test -- tests/profile/catalog-selection-resolver.test.ts
npm run typecheck
```

Expected: PASS; tampering and incomplete closure fail before a profile mutation plan is produced.

- [ ] **Step 5: Commit catalog closure resolution**

```powershell
git add src/profile/catalog-release-reader.ts src/profile/catalog-selection-resolver.ts tests/profile/catalog-selection-resolver.test.ts tests/fixtures/catalog-release
git commit -m "feat(profile): resolve exact catalog source closures"
```

Expected: one commit preserving the exact bytes required for vendoring.

### Task 4: Vendor Selected Catalog Bytes and Build the Target-Byte Lock

**Files:**

- Create: `src/profile/vendor-selected-catalog.ts`
- Create: `src/profile/build-selected-catalog-lock.ts`
- Create: `src/profile/verify-selected-catalog-lock.ts`
- Create: `tests/profile/selected-catalog-vendoring.test.ts`
- Create: `tests/fixtures/profile/selected-catalog/**`

**Interfaces:** Consumes `ResolvedCatalogSelection`. Produces exact vendoring writes, `SelectedCatalogLock`, and `verifySelectedCatalogLock(root)`; the verifier accepts no release-root argument.

- [ ] **Step 1: Write failing exact-byte, lock, and target-only verification tests**

```ts
it("locks the exact bytes at their final target paths", async () => {
  const lock = mustValue(buildSelectedCatalogLock(resolvedSelection));
  const writes = mustValue(buildSelectedCatalogVendoring(resolvedSelection, lock));
  expect(lock.entries.map(entry => entry.target_path)).toEqual([
    "docs/project-memory/catalog/selected/blueprints/application-service/app.consumer-mobile.yaml",
    "docs/project-memory/catalog/selected/companions/companion.mutation.core.yaml",
    "docs/project-memory/catalog/selected/companions/companion.mutation.taxonomy.yaml",
    "docs/project-memory/catalog/selected/patterns/engineering/engineering.feature.implement.core.yaml",
    "docs/project-memory/catalog/selected/patterns/engineering/engineering.feature.implement.taxonomy.yaml",
    "docs/project-memory/catalog/selected/components/surface.mobile-application.yaml",
    "schemas/project-memory/v1/pattern-core.schema.json",
  ]);
  for (const entry of lock.entries) {
    const write = writes.find(candidate => candidate.relative_path === entry.target_path);
    expect(entry.sha256).toBe(sha256(write!.bytes));
    expect(entry.byte_length).toBe(write!.bytes.byteLength);
  }
});

it("verifies with the source release removed", async () => {
  const lock = mustValue(buildSelectedCatalogLock(resolvedSelection));
  const writes = mustValue(buildSelectedCatalogVendoring(resolvedSelection, lock));
  await materializeFixtureTarget(targetRoot, { lock, writes });
  await removeFixtureReleaseCopy();
  expect(mustValue(await verifySelectedCatalogLock(targetRoot)).valid).toBe(true);
});
```

Add cases for one changed target byte, a missing target, an unlisted target under `catalog/selected`, a schema written outside `schemas/project-memory/v1`, duplicate target paths, and a reordered lock.

- [ ] **Step 2: Run selected-catalog vendoring tests and verify failure**

```powershell
npm test -- tests/profile/selected-catalog-vendoring.test.ts
```

Expected: FAIL because vendored target writes and `SelectedCatalogLock` do not exist.

- [ ] **Step 3: Implement exact vendoring and lock construction**

```ts
export interface SelectedCatalogLockEntry {
  kind: CatalogSourceKind;
  definition_ids: readonly string[];
  source_release_path: string;
  target_path: string;
  sha256: string;
  byte_length: number;
}

export interface SelectedCatalogLock {
  schema_version: "1.0.0";
  catalog_release: string;
  source_release_hash: string;
  entries: readonly SelectedCatalogLockEntry[];
  lock_hash: string;
}

export function buildSelectedCatalogLock(
  selection: ResolvedCatalogSelection,
): RuntimeResult<SelectedCatalogLock>;

export function buildSelectedCatalogVendoring(
  selection: ResolvedCatalogSelection,
  lock: SelectedCatalogLock,
): RuntimeResult<readonly PlannedWrite[]>;

export function verifySelectedCatalogLock(
  targetRoot: URL,
): Promise<RuntimeResult<SelectedCatalogVerificationReport>>;
```

`buildSelectedCatalogLock` computes sorted entries from the resolved final target paths and exact source byte arrays. `buildSelectedCatalogVendoring` checks that supplied lock against the same bytes, then maps catalog source files without parsing or reserializing their bytes. Preserve catalog-relative paths below `docs/project-memory/catalog/selected/`; map emitted schema bytes to `schemas/project-memory/v1/`. Require exact transitive blueprint, `.core.yaml`, `.taxonomy.yaml`, companion, component/domain/overlay/adapter/template/gate/policy source, and generated-schema bytes. Construct sorted lock entries from each final `target_path` and final byte array, then compute `lock_hash` from canonical JSON with only `lock_hash` omitted. `verifySelectedCatalogLock` reads `catalog.lock.json` and its listed target paths from the target root, enumerates the two target namespaces for unlisted files, and never reads `catalog_release_root`, a package cache, or a runtime registry.

- [ ] **Step 4: Run vendoring, tamper, and type checks**

```powershell
npm test -- tests/profile/selected-catalog-vendoring.test.ts
npm run typecheck
```

Expected: PASS; target-byte tampering fails and removal or mutation of the external release tree does not affect target verification.

- [ ] **Step 5: Commit selected catalog vendoring**

```powershell
git add src/profile/vendor-selected-catalog.ts src/profile/build-selected-catalog-lock.ts src/profile/verify-selected-catalog-lock.ts tests/profile/selected-catalog-vendoring.test.ts tests/fixtures/profile/selected-catalog
git commit -m "feat(profile): vendor and lock selected catalog bytes"
```

Expected: one commit defining the self-contained catalog boundary.

### Task 5: Enforce Compatibility and Expand the Resolved Profile

**Files:**

- Create: `src/profile/compatibility.ts`
- Create: `src/profile/expand-profile.ts`
- Create: `tests/profile/expand-profile.test.ts`

**Interfaces:** Consumes the accepted selection plus verified catalog closure. Produces a deterministic `ResolvedProfile` that references vendored definitions by stable ID, version, and target hash.

- [ ] **Step 1: Write failing compatibility and deterministic-order tests**

```ts
it("fails when an explicit overlay is forbidden by the blueprint", () => {
  const result = expandResolvedProfile(selectionWithForbiddenOverlay, catalog);
  expect(result).toMatchObject({
    ok: false,
    issues: [{ code: "PROFILE_OVERLAY_FORBIDDEN" }],
  });
});

it("sorts resolved instances and rules by stable identity", () => {
  const profile = mustValue(expandResolvedProfile(shuffledSelection, catalog));
  expect(profile.components.map(item => item.instance_id)).toEqual(sortedComponentIds);
  expect(profile.rules.map(item => item.id)).toEqual(sortedRuleIds);
});
```

Cover root kind, archetype, blueprint compatibility, baked/default/explicit overlays, required and forbidden overlays, required components/domains/adapters, duplicate references, and version conflicts.

- [ ] **Step 2: Run expansion tests and verify failure**

```powershell
npm test -- tests/profile/expand-profile.test.ts
```

Expected: FAIL because compatibility checks and deterministic expansion are absent.

- [ ] **Step 3: Implement ordered checks and fail-closed merging**

```ts
export function expandResolvedProfile(
  selection: ProjectSelection,
  catalog: ResolvedCatalogSelection,
): RuntimeResult<ResolvedProfile>;

export interface ResolvedComponentInstance {
  instance_id: ComponentInstanceId;
  definition_id: string;
  definition_version: string;
  definition_target_sha256: string;
  slug: string;
  required_domains: readonly DomainInstanceId[];
  rules: readonly ResolvedRule[];
  gates: readonly ResolvedGateExecution[];
}
```

Check in this order: root kind, primary archetype, blueprint, baked overlays, accepted explicit overlays, forbidden overlays, component/domain requirements, adapter requirements, pattern/companion closure, then executable gate closure. Merge by stable ID and version, preserve accepted instance bindings, sort every set, and fail on any unequal duplicate rather than selecting a later value. Keep reusable catalog facts separate from root-specific accepted facts.

- [ ] **Step 4: Run focused tests and type checking**

```powershell
npm test -- tests/profile/expand-profile.test.ts
npm run typecheck
```

Expected: PASS; no unsupported combination returns a resolved profile.

- [ ] **Step 5: Commit profile expansion**

```powershell
git add src/profile/compatibility.ts src/profile/expand-profile.ts tests/profile/expand-profile.test.ts
git commit -m "feat(profile): expand deterministic profile closures"
```

Expected: one commit with fail-closed compatibility semantics.

### Task 6: Add Multi-Root Namespaces and Ownership-Safe Portfolio and Platform References

**Files:**

- Modify: `src/profile/contracts/root-relationships.ts`
- Create: `src/profile/validate-root-ownership.ts`
- Create: `src/materialize/render-root-relationships.ts`
- Create: `tests/profile/root-relationships.test.ts`
- Create: `tests/fixtures/profile/root-relationships/portfolio-valid.yaml`
- Create: `tests/fixtures/profile/root-relationships/portfolio-copied-child-truth.yaml`
- Create: `tests/fixtures/profile/root-relationships/platform-provider-valid.yaml`
- Create: `tests/fixtures/profile/root-relationships/platform-consumer-valid.yaml`
- Create: `tests/fixtures/profile/root-relationships/platform-consumer-redefines-interface.yaml`

**Interfaces:** Produces globally scoped `RootAddress`, three non-overlapping relationship contracts, ownership validation, and accepted rendering of `source/ROOT_RELATIONSHIPS.md`.

- [ ] **Step 1: Write failing namespace and ownership tests**

```ts
it("rejects copied child truth in a portfolio root", () => {
  const result = validateRootRelationships(
    portfolioRoot,
    readYamlFixture("portfolio-copied-child-truth.yaml"),
  );
  expect(result).toMatchObject({
    ok: false,
    issues: [{ code: "ROOT_RELATIONSHIP_CHILD_TRUTH_FORBIDDEN" }],
  });
});

it("rejects a consumer-owned redefinition of a provider interface", () => {
  const result = validateRootRelationships(
    consumerRoot,
    readYamlFixture("platform-consumer-redefines-interface.yaml"),
  );
  expect(result).toMatchObject({
    ok: false,
    issues: [{ code: "ROOT_RELATIONSHIP_INTERFACE_OWNER_MISMATCH" }],
  });
});
```

Also cover invalid namespace syntax, duplicate `(namespace, root_id)`, local-root mismatch, wrong owner ID, missing remote profile-lock hash, portfolio child self-reference, and cross-namespace cycles.

- [ ] **Step 2: Run relationship tests and verify failure**

```powershell
npm test -- tests/profile/root-relationships.test.ts
```

Expected: FAIL because namespace and cross-root ownership contracts are absent.

- [ ] **Step 3: Implement explicit reference-only contracts and ownership rules**

```ts
export interface RootAddress {
  namespace: string;
  root_id: RootInstanceId;
  canonical_repository: string;
  profile_lock_hash: string;
}

export interface CanonicalArtifactReference {
  root: RootAddress;
  relative_path: string;
  revision: number;
  sha256: string;
}

export interface PortfolioChildReference {
  kind: "portfolio-child";
  relationship_id: string;
  revision: number;
  portfolio: RootAddress;
  child: RootAddress;
  relationship_owner_root_id: RootInstanceId;
  child_truth_owner_root_id: RootInstanceId;
  relationship_status: "proposed" | "active" | "retired";
  dependency_kinds: readonly string[];
  approval_refs: readonly string[];
}

export interface SharedPlatformProviderReference {
  kind: "shared-platform-provider";
  relationship_id: string;
  revision: number;
  provider: RootAddress;
  consumer: RootAddress;
  owner_root_id: RootInstanceId;
  interface_refs: readonly CanonicalArtifactReference[];
  approval_refs: readonly string[];
}

export interface SharedPlatformConsumerReference {
  kind: "shared-platform-consumer";
  relationship_id: string;
  revision: number;
  consumer: RootAddress;
  provider: RootAddress;
  owner_root_id: RootInstanceId;
  provider_interface_refs: readonly CanonicalArtifactReference[];
  usage_component_ids: readonly ComponentInstanceId[];
  migration_state: "current" | "migration-required" | "retiring";
  approval_refs: readonly string[];
}
```

Use `^[a-z0-9]+(?:[.-][a-z0-9]+)*$` for namespaces and treat `(namespace, root_id)` as the durable address. A portfolio record may own relationship status and dependency kind but may not contain child name, mission, PRD, scope, decisions, components, or copied records. A provider record owns interface contract/version/deprecation references. A consumer record owns usage components and migration state but may only point to provider interface artifacts by root address, relative path, revision, and hash. All schemas use `additionalProperties: false`. Render `ROOT_RELATIONSHIPS.md` only from accepted relationship source records and preserve their approval references.

- [ ] **Step 4: Run ownership, rendering, and schema tests**

```powershell
npm test -- tests/profile/root-relationships.test.ts
npm run typecheck
npm run schemas:emit
```

Expected: PASS; fixtures prove portfolio and shared-platform truth cannot be copied across owners.

- [ ] **Step 5: Commit multi-root contracts**

```powershell
git add src/profile/contracts/root-relationships.ts src/profile/validate-root-ownership.ts src/materialize/render-root-relationships.ts tests/profile/root-relationships.test.ts tests/fixtures/profile/root-relationships schemas/project-memory/v1
git commit -m "feat(profile): enforce multi-root reference ownership"
```

Expected: one commit with explicit portfolio and shared-platform authority boundaries.

### Task 7: Preserve Stable Instance Bindings Across Recompilation

**Files:**

- Create: `src/profile/instance-bindings.ts`
- Create: `tests/profile/instance-bindings.test.ts`

**Interfaces:** Produces `reconcileInstanceBindings(previousLock, selection, acceptedSources)` for root, component, domain, and relationship identities. Initiative, workstream, and task identity is governed downstream and is outside profile recompilation.

- [ ] **Step 1: Write failing identity-preservation tests**

```ts
it("does not mint an ID for an unaccepted addition", () => {
  const result = reconcileInstanceBindings(previousLock, selectionMissingNewId, sources);
  expect(result).toMatchObject({
    ok: false,
    issues: [{ code: "PROFILE_INSTANCE_ID_REQUIRED" }],
  });
});
```

Cover unchanged bindings, mutable slug change, duplicate ID, definition replacement, removal, a new definition without an accepted ID, relationship-address change, and revision rollback.

- [ ] **Step 2: Run instance-binding tests and verify failure**

```powershell
npm test -- tests/profile/instance-bindings.test.ts
```

Expected: FAIL because identity reconciliation has not been implemented.

- [ ] **Step 3: Reconcile by immutable IDs and accepted parentage**

```ts
export function reconcileInstanceBindings(
  previous: ProfileLock | null,
  selection: ProjectSelection,
  sources: AcceptedProfileSourceSet,
): RuntimeResult<ReconciledInstanceBindings>;
```

Key reconciliation by immutable instance ID, never slug or array position. Require accepted migration and approval references for addition, removal, replacement, definition-ID change, namespace change, or parent change. Permit slug/label changes only when canonical paths remain ID-based. Require every relationship owner to match its local root contract and reject lower source revisions than the previous lock. Initiative, workstream, and task parentage is validated by selection/planning and governance, not by profile recompilation.

- [ ] **Step 4: Run reconciliation tests and type checking**

```powershell
npm test -- tests/profile/instance-bindings.test.ts
npm run typecheck
```

Expected: PASS; recompilation cannot change identity or parentage implicitly.

- [ ] **Step 5: Commit stable identity reconciliation**

```powershell
git add src/profile/instance-bindings.ts tests/profile/instance-bindings.test.ts
git commit -m "feat(profile): preserve accepted instance identities"
```

Expected: one commit covering every persistent canonical artifact identity.

### Task 8: Produce a Pure, Byte-Stable Canonical Mutation Plan

**Files:**

- Create: `src/profile/profile-compiler.ts`
- Create: `src/profile/build-profile-lock.ts`
- Create: `src/profile/build-profile-mutation-plan.ts`
- Create: `tests/profile/profile-compiler-plan.test.ts`

**Interfaces:** Implements `ProfileCompiler.plan(input): Promise<RuntimeResult<ProfileCanonicalMutationPlan>>` by importing the shared generic contract and central hash. Produces no filesystem, Git object, commit, or ref mutation.

- [ ] **Step 1: Write failing determinism and no-side-effect tests**

```ts
it("returns byte-identical shared plans without writing or invoking Git mutation", async () => {
  const first = mustValue(await compiler.plan(fixedInput));
  const second = mustValue(await compiler.plan(fixedInput));
  expect(summarizeMutationPlan(first)).toEqual(summarizeMutationPlan(second));
  expect(first.mutation_kind).toBe("profile.bootstrap");
  expect(first.metadata.profile_lock.lock_hash).toBe(first.profile_lock_hash);
  expect(first.record_ids).toEqual([]);
  expect(first.event_ids).toEqual([]);
  expect(first.evidence_ids).toEqual([]);
  expect(fileSystem.writeCalls).toEqual([]);
  expect(git.mutationCalls).toEqual([]);
  expect(Object.keys(compiler)).toEqual(["plan"]);
});

it("plans accepted source artifacts but no generated views", async () => {
  const plan = mustValue(await compiler.plan(fixedInput));
  expect(plan.writes.map(write => write.relative_path)).toContain(
    "docs/project-memory/source/PROJECT.md",
  );
  expect(plan.writes.some(write => write.relative_path.startsWith("docs/project-memory/views/"))).toBe(false);
});
```

Also assert exact selected-catalog and schema writes, correct pre-image hashes, no unaccepted source data, stable lock hashes, sorted `RuntimeResult.warnings`, exact approval IDs, central hash parity, and all shared stable fields.

- [ ] **Step 2: Run compiler-plan tests and verify failure**

```powershell
npm test -- tests/profile/profile-compiler-plan.test.ts
```

Expected: FAIL because the mutation planner and lock builder do not exist.

- [ ] **Step 3: Implement side-effect-free plan assembly and hashing**

```ts
export async function buildProfileMutationPlan(
  input: ProfilePlanInput,
  dependencies: ProfilePlanningDependencies,
): Promise<RuntimeResult<ProfileCanonicalMutationPlan>> {
  const selection = mustValue(readAndValidateProjectSelection(input.project_yaml));
  const sources = mustValue(validateAcceptedSources(selection, input.accepted_sources, input.approval_records));
  const catalog = mustValue(await dependencies.catalog.resolve(selection, input.catalog_release_root));
  const profile = mustValue(expandResolvedProfile(selection, catalog));
  const selectedCatalogLock = mustValue(buildSelectedCatalogLock(catalog));
  const catalogWrites = mustValue(buildSelectedCatalogVendoring(catalog, selectedCatalogLock));
  const sourceWrites = mustValue(renderAcceptedProfileSources(selection, sources, profile));
  const locks = mustValue(buildProfileLocks(selection, sources, profile, selectedCatalogLock));
  const generatedWrites = mustValue(renderCompilerOwnedArtifacts(selection, profile, locks));
  const writes = sortAndValidateWrites([...catalogWrites, ...sourceWrites, ...generatedWrites]);
  const withoutHash: Omit<ProfileCanonicalMutationPlan, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: input.plan_id,
    mutation_kind: input.previous_profile_lock === null ? "profile.bootstrap" : "profile.evolution",
    root_id: selection.root.id,
    target_ref: input.target_ref,
    expected_head: input.expected_head,
    profile_lock_hash: locks.profile_lock.lock_hash,
    writes,
    record_ids: [],
    event_ids: [],
    approval_ids: sortIds(input.approval_records.map(record => record.id)),
    evidence_ids: [],
    created_by: input.created_by,
    created_at: input.created_at,
    expires_at: input.expires_at,
    metadata: {
      project_hash: sha256(input.project_yaml),
      profile,
      selected_catalog_lock: locks.selected_catalog_lock,
      profile_lock: locks.profile_lock,
    },
  };
  return success(
    { ...withoutHash, plan_hash: canonicalMutationPlanHash(withoutHash) },
    sortRuntimeIssues(collectPlanningWarnings()),
  );
}
```

Read current target bytes only to populate `PlannedWrite.expected_existing_sha256`; do not mutate them. Reject collisions between user-owned existing paths and compiler-owned outputs. Build `profile.lock.yaml` from resolved profile IDs, versions, target hashes, rules, gates, templates, adapters, relationships, and accepted profile-source hashes. Do not place initiative, workstream, task, changing record state, or diagnostics in the profile lock or metadata. Include `selected_catalog_lock_hash`. Render the locks, sort all writes by relative path, reject duplicate paths, and call foundation `canonicalMutationPlanHash` without reimplementing its projection or sorting. Return planning diagnostics only through sorted `RuntimeResult.warnings`. The compiler cannot accept a selection, add a fact, choose a relationship owner, or generate a view.

- [ ] **Step 4: Run deterministic plan, type, and no-side-effect checks**

```powershell
npm test -- tests/profile/profile-compiler-plan.test.ts
npm run typecheck
```

Expected: PASS; repeated inputs produce identical plans and all mutation spies remain empty.

- [ ] **Step 5: Commit pure mutation planning**

```powershell
git add src/profile/profile-compiler.ts src/profile/build-profile-lock.ts src/profile/build-profile-mutation-plan.ts tests/profile/profile-compiler-plan.test.ts
git commit -m "feat(profile): plan deterministic canonical mutations"
```

Expected: one commit with no profile-owned canonical write path.

### Task 9: Render Accepted Canonical Sources and the Startup Doorway

**Files:**

- Create: `src/materialize/render-project-tree.ts`
- Create: `src/materialize/render-startup-context.ts`
- Create: `src/materialize/render-project-source.ts`
- Create: `src/materialize/render-component.ts`
- Create: `src/materialize/render-domain.ts`
- Create: `templates/project-memory/PROTOCOL.md`
- Create: `templates/project-memory/PROJECT.md`
- Create: `templates/project-memory/CONSTRAINTS.md`
- Create: `templates/project-memory/POLICIES.md`
- Create: `templates/project-memory/ROOT_RELATIONSHIPS.md`
- Create: `templates/project-memory/COMPONENT.md`
- Create: `templates/project-memory/DOMAIN.md`
- Create: `tests/materialize/project-tree.test.ts`

**Interfaces:** Produces planned bytes for accepted profile-source documents and compiler-owned routers/configuration. It consumes only `AcceptedProfileSourceSet`, `ResolvedProfile`, locks, and explicit adapter selection; dynamic initiative/workstream/task truth remains downstream-owned.

- [ ] **Step 1: Write failing tree, envelope, and non-invention snapshot tests**

```ts
it("renders accepted profile-source paths from immutable IDs", () => {
  const writes = mustValue(renderAcceptedProfileSources(selection, sources, profile));
  expect(writes.map(write => write.relative_path)).toContain(
    "docs/project-memory/source/PROJECT.md",
  );
  expect(writes.map(write => write.relative_path)).toContain(
    "docs/project-memory/components/CMP-01J2X9QJ7K5RK7Q3VBM6F4T8NA/COMPONENT.md",
  );
  expect(writes.map(write => write.relative_path)).toContain(
    "docs/project-memory/domains/DOM-01J2X9QJ7K5RK7Q3VBM6F4T8NA/DOMAIN.md",
  );
  for (const write of canonicalMarkdownWrites(writes)) {
    expect(parseCanonicalMarkdown(write.bytes).ok).toBe(true);
  }
});

it("leaves dynamic truth and generated views to downstream owners", () => {
  const writes = mustValue(renderAcceptedProfileSources(selection, sources, profile));
  expect(writes.some(write => write.relative_path.includes("/initiatives/"))).toBe(false);
  expect(writes.some(write => write.relative_path.includes("/workstreams/"))).toBe(false);
  expect(writes.some(write => write.relative_path.includes("/views/"))).toBe(false);
});
```

Snapshot `PROJECT_CONTEXT.md`, exact tree paths, front matter, bodies, tracked empty directories, and project/component/domain facts for a minimal accepted source set.

- [ ] **Step 2: Run project-tree tests and verify failure**

```powershell
npm test -- tests/materialize/project-tree.test.ts
```

Expected: FAIL because accepted source renderers and templates are absent.

- [ ] **Step 3: Render only explicit accepted facts with canonical envelopes**

```ts
export function renderAcceptedProfileSources(
  selection: ProjectSelection,
  sources: AcceptedProfileSourceSet,
  profile: ResolvedProfile,
): RuntimeResult<readonly PlannedWrite[]>;
```

Render `source/PROJECT.md` from accepted root name, mission, owners, stakeholders, success criteria, included scope, and excluded scope. Render constraints, policies, blueprint-specific documents, and root relationships only from accepted source entries. Render component/domain records with accepted ownership, boundaries, status, repositories/paths, dependencies, risks, and links; locked catalog defaults may fill only fields explicitly declared as catalog-owned defaults. Use `renderCanonicalMarkdown` for `PROJECT.md`, every `COMPONENT.md`, and every `DOMAIN.md`. The same strict codec already covers initiative, workstream, and task documents for selection/planning and governance, but the profile compiler creates only their empty contract directories and never plans their changing truth. Never derive a mission, owner, scope item, requirement, status, risk, dependency, approval, or relationship from catalog prose or repository inspection.

Render `PROJECT_CONTEXT.md` with root address, profile-lock hash, canonical/source ownership, fixed startup order, and a prohibition on editing generated views. Compiler-owned locks, protocol/config, routers, and adapters carry generated markers; accepted canonical sources carry provenance and approvals but no generated marker. Add `.gitkeep` only for contract directories that would otherwise be absent.

- [ ] **Step 4: Run snapshot, parser, and type checks**

```powershell
npm test -- tests/materialize/project-tree.test.ts tests/materialize/canonical-markdown.test.ts
npm run typecheck
```

Expected: PASS; all accepted artifact bytes parse canonically, omitted facts stay omitted, and no view write exists.

- [ ] **Step 5: Commit accepted source rendering**

```powershell
git add src/materialize templates/project-memory tests/materialize/project-tree.test.ts
git commit -m "feat(materialize): render accepted canonical source artifacts"
```

Expected: one commit with deterministic source bytes and no generated-view implementation.

### Task 10: Render Optional Agent, Runtime, and Workflow Adapters

**Files:**

- Create: `src/materialize/render-adapters.ts`
- Create: `tests/materialize/adapters.test.ts`
- Create: `tests/fixtures/materialize/existing-agents.md`
- Create: `tests/fixtures/materialize/existing-claude.md`

**Interfaces:** Produces planned router/config writes from explicit adapter IDs in the resolved profile. It has no tool-brand inference and no existing-file overwrite authority.

- [ ] **Step 1: Write failing adapter-selection and collision tests**

```ts
it("does not infer CLAUDE.md from a model name", () => {
  const writes = mustValue(renderAdapters(profileWithClaudeModelButNoClaudeCodeAdapter));
  expect(writes.some(write => write.relative_path === "CLAUDE.md")).toBe(false);
});

it("proposes review instead of replacing an existing instruction file", () => {
  const result = renderAdapters(profileWithCodexAdapter, existingAgentsSnapshot);
  expect(result).toMatchObject({
    ok: false,
    issues: [{ code: "ADAPTER_EXISTING_FILE_REVIEW" }],
  });
});
```

Cover no `AGENTS.md` without `adapter.codex`, no `CLAUDE.md` without `adapter.claude-code`, both thin routers when selected, stable config JSON, and no copied PRD/status/history text.

- [ ] **Step 2: Run adapter tests and verify failure**

```powershell
npm test -- tests/materialize/adapters.test.ts
```

Expected: FAIL because adapter rendering is absent.

- [ ] **Step 3: Implement explicit thin-router and config rendering**

```ts
export function renderAdapters(
  profile: ResolvedProfile,
  targetSnapshot: TargetByteSnapshot,
): RuntimeResult<readonly PlannedWrite[]>;
```

Allow root instruction files to link only to `PROJECT_CONTEXT.md`, `docs/project-memory/PROTOCOL.md`, and `docs/project-memory/profile.lock.yaml`. Put runtime/workflow commands and flattened `ResolvedGateExecution` values in `tools/project-memory/config.json`. Existing instruction files produce a review artifact under `docs/project-memory/catalog/proposals/` and `ADAPTER_EXISTING_FILE_REVIEW`; they are never replacement writes. Sort adapters and config keys deterministically.

- [ ] **Step 4: Run adapter and snapshot tests**

```powershell
npm test -- tests/materialize/adapters.test.ts
npm run typecheck
```

Expected: PASS; explicit adapter selection alone controls root instruction files.

- [ ] **Step 5: Commit adapter rendering**

```powershell
git add src/materialize/render-adapters.ts tests/materialize/adapters.test.ts tests/fixtures/materialize
git commit -m "feat(materialize): render optional adapter routers"
```

Expected: one commit with adapter-only root routers.

### Task 11: Materialize Only to Isolated Staging and Verify Only Target Bytes

**Files:**

- Create: `src/profile/materialize-to-isolated-staging.ts`
- Create: `src/profile/verify-profile.ts`
- Create: `tests/profile/staging-materializer.test.ts`
- Create: `tests/profile/verify-profile.test.ts`

**Interfaces:** Implements `ProfileMaterializer.materializeToIsolatedStaging` and `ProfileVerifier.verify`. Produces `StagedProfileMutation`; neither interface exposes commit creation or ref mutation.

- [ ] **Step 1: Write failing isolation, fault, and target-only verification tests**

```ts
it("rejects a canonical or ordinary working tree", async () => {
  const before = await git.resolveRef(repo, "refs/heads/main");
  const result = await materializer.materializeToIsolatedStaging({
    staging_root: repo,
    expected_staging_head: before,
    plan,
  });
  expect(result).toMatchObject({
    ok: false,
    issues: [{ code: "PROFILE_STAGING_WORKTREE_REQUIRED" }],
  });
  expect(await git.resolveRef(repo, "refs/heads/main")).toBe(before);
});

it("verifies vendored bytes without the catalog release tree", async () => {
  await stageValidPlan();
  await deleteExternalReleaseFixture();
  const report = mustValue(await verifier.verify(stagingRoot));
  expect(report.valid).toBe(true);
  expect(report.external_reads).toEqual([]);
});
```

Cover head drift, dirty staging tree, pre-image drift, catalog target tampering, schema target tampering, profile-lock tampering, canonical Markdown envelope/body tampering, mid-transaction failure, idempotent staging, a Git commit spy, and a ref-update spy.

- [ ] **Step 2: Run staging and verifier tests and verify failure**

```powershell
npm test -- tests/profile/staging-materializer.test.ts tests/profile/verify-profile.test.ts
```

Expected: FAIL because staging materialization and independent target verification do not exist.

- [ ] **Step 3: Implement capability-checked staging and disk-only verification**

```ts
export interface StagedProfileMutation {
  plan_id: string;
  plan_hash: string;
  staging_root: URL;
  staging_head: string;
  writes: readonly {
    relative_path: string;
    previous_sha256: string | null;
    next_sha256: string;
  }[];
  verification: ProfileVerificationReport;
}

export async function materializeToIsolatedStaging(
  input: StagingMaterializationInput,
  dependencies: StagingMaterializationDependencies,
): Promise<RuntimeResult<StagedProfileMutation>> {
  const isolation = await dependencies.git.inspectWorktree(input.staging_root);
  if (!isCoordinatorStagingWorktree(isolation, input.expected_staging_head)) {
    return failure("PROFILE_STAGING_WORKTREE_REQUIRED");
  }
  const transaction = await applyFileTransaction(input.staging_root, input.plan.writes);
  if (!transaction.ok) return transaction;
  const verification = await dependencies.verifier.verify(input.staging_root);
  return verification.ok && verification.value.valid
    ? success(toStagedMutation(input, transaction.value, verification.value))
    : failure("PROFILE_STAGING_VERIFICATION_FAILED");
}
```

Require a detached linked worktree descriptor created by the coordinator, exact head, clean state, and a staging capability bound to plan ID, plan hash, root path, and expiry. `applyFileTransaction` appears only in this module and its tests; it writes planned paths but never `.git/**`. Do not expose it through `src/profile/index.ts`. Re-read every staged byte after the transaction.

`ProfileVerifier.verify(root)` must read only target `project.yaml`, locks, every locked `catalog/selected/**` byte, every locked `schemas/project-memory/v1/**` byte, compiler-owned routers/config, and accepted profile-source/component/domain Markdown artifacts listed by profile source hashes. It reparses their envelopes and bodies, recomputes selected-catalog/profile hashes, rejects unlisted vendored files, and records `external_reads: []`. Initiative, workstream, task, record, and view verification remains governance-owned. The verifier accepts no catalog release path and performs no repair.

Only `IntegrationCoordinator.finalizeMutation` may turn a validated plan into a canonical commit and compare-and-swap the target ref. Bootstrap adds initialization evidence and views, then delegates to the shared `finalizeMutation` CAS engine; it is not a second writer.

- [ ] **Step 4: Run fault-injection, target-only, and type checks**

```powershell
npm test -- tests/profile/staging-materializer.test.ts tests/profile/verify-profile.test.ts
npm run typecheck
```

Expected: PASS; every failure preserves prior staging bytes, no Git mutation spy fires, and verifier external reads remain empty.

- [ ] **Step 5: Commit staging-only materialization and verification**

```powershell
git add src/profile/materialize-to-isolated-staging.ts src/profile/verify-profile.ts tests/profile/staging-materializer.test.ts tests/profile/verify-profile.test.ts
git commit -m "feat(profile): stage plans and verify target bytes"
```

Expected: one commit with no canonical writer and no source-release verifier dependency.

### Task 12: Compute Profile Evolution Diffs Without Accepting Direction

**Files:**

- Create: `src/profile/diff-profile.ts`
- Create: `src/profile/profile-drift.ts`
- Create: `tests/profile/diff-profile.test.ts`
- Create: `tests/profile/profile-drift.test.ts`

**Interfaces:** Produces `ProfileEvolutionDiff` and factual drift proposals. It returns no writes and cannot update selection, sources, locks, relationships, or views.

- [ ] **Step 1: Write failing impact and observation-boundary tests**

```ts
it("keeps observed repository reality outside accepted intent", () => {
  const result = mustValue(inspectProfileDrift(acceptedProfile, observedNewComponent));
  expect(result.proposals).toEqual([
    expect.objectContaining({ status: "observed_unclassified" }),
  ]);
  expect(result.writes).toEqual([]);
});

it("requires directional approval for a relationship owner change", () => {
  const diff = mustValue(diffProfiles(before, afterWithNewOwner));
  expect(diff.impact).toBe("major");
  expect(diff.required_approval_kinds).toContain("directional");
});
```

Cover wording-only catalog patch, optional rule addition, authority change, component/domain addition/removal, adapter change, root namespace change, portfolio child change, platform interface reference change, and observed unclassified evidence.

- [ ] **Step 2: Run evolution tests and verify failure**

```powershell
npm test -- tests/profile/diff-profile.test.ts tests/profile/profile-drift.test.ts
```

Expected: FAIL because structured impact and drift reporting are absent.

- [ ] **Step 3: Implement read-only diff classification and proposals**

```ts
export interface ProfileEvolutionDiff {
  impact: "patch" | "minor" | "major";
  changes: readonly ProfileChange[];
  required_approval_kinds: readonly ApprovalKind[];
  migration_required: boolean;
  writes: readonly [];
}
```

Classify text/hash-only compatible updates as `patch`, additive accepted capabilities as `minor`, and identity, authority, ownership, removal, replacement, compatibility, namespace, or parent changes as `major`. Emit factual `observed_unclassified` proposals with evidence references but never add them to accepted sources. Require accepted `project.yaml` and accepted source changes before a later planner can include additions, removals, replacements, overlay changes, root-boundary changes, or ownership changes.

- [ ] **Step 4: Run diff, drift, and type checks**

```powershell
npm test -- tests/profile/diff-profile.test.ts tests/profile/profile-drift.test.ts
npm run typecheck
```

Expected: PASS; every result is read-only and directional changes enumerate approval requirements.

- [ ] **Step 5: Commit profile evolution reporting**

```powershell
git add src/profile/diff-profile.ts src/profile/profile-drift.ts tests/profile/diff-profile.test.ts tests/profile/profile-drift.test.ts
git commit -m "feat(profile): report profile evolution and drift"
```

Expected: one commit that cannot convert observation into accepted truth.

### Task 13: Lock Behavior with Golden Single-Root and Multi-Root Fixtures

**Files:**

- Create: `tests/fixtures/profile-golden/small-service/**`
- Create: `tests/fixtures/profile-golden/lifeof/**`
- Create: `tests/fixtures/profile-golden/dino-escape/**`
- Create: `tests/fixtures/profile-golden/portfolio/**`
- Create: `tests/fixtures/profile-golden/shared-platform-provider/**`
- Create: `tests/fixtures/profile-golden/shared-platform-consumer/**`
- Create: `tests/profile/golden-repositories.test.ts`
- Create: `src/profile/index.ts`

**Interfaces:** Exports `ProfileCompiler`, `ProfileMaterializer`, `ProfileVerifier`, contracts, parsers, renderers, and report types. It does not export `applyFileTransaction` or any canonical writer.

- [ ] **Step 1: Write failing clean-room golden and export-boundary tests**

```ts
it.each(goldenCases)("reproduces $name target bytes", async golden => {
  const first = mustValue(await compiler.plan(golden.input));
  const second = mustValue(await compiler.plan(golden.input));
  expect(summarizeMutationPlan(second)).toEqual(summarizeMutationPlan(first));
  expect(snapshotWrites(first.writes)).toMatchFileSnapshot(golden.snapshot);
});

it("keeps canonical finalization outside the profile package", async () => {
  const exports = await import("../../src/profile/index.js");
  expect(Object.keys(exports)).not.toContain("applyFileTransaction");
  expect(Object.keys(exports)).not.toContain("finalizeMutation");
});
```

The portfolio fixture references two child roots without child PRDs or decisions. The shared-platform provider fixture owns interface references; the consumer fixture owns usage and migration state without interface bodies. All fixtures use fixed clocks, IDs, approvals, release bytes, and pre-image snapshots.

- [ ] **Step 2: Run golden tests and verify failure**

```powershell
npm test -- tests/profile/golden-repositories.test.ts
```

Expected: FAIL until golden targets and the constrained package entry point exist.

- [ ] **Step 3: Add exact fixtures, snapshots, and public exports**

```ts
export type { ProfileCompiler } from "./profile-compiler.js";
export type { ProfileMaterializer, StagedProfileMutation } from "./materialize-to-isolated-staging.js";
export type { ProfileVerifier, ProfileVerificationReport } from "./verify-profile.js";
export * from "./contracts/index.js";
export { parseCanonicalMarkdown } from "../materialize/parse-canonical-markdown.js";
export { renderCanonicalMarkdown } from "../materialize/render-canonical-markdown.js";
```

Snapshot every planned relative path, mode, pre-image hash, final byte hash, selected catalog lock, profile lock, canonical artifact bytes, schema bytes, adapter bytes, and plan hash. Run the plan twice from separate clean fixture copies. Materialize one copy only through `materializeToIsolatedStaging`, verify only target bytes, and assert the canonical branch ref is unchanged. No fixture touches a live LifeOf, Dino Escape, portfolio, or platform repository.

- [ ] **Step 4: Run the complete profile subsystem gate**

```powershell
npm run typecheck
npm run lint
npm test -- tests/profile tests/materialize
npm run build
npm run schemas:emit
git diff --check
```

Expected: PASS; all six golden repositories plan deterministically, stage safely, and verify without external catalog access.

- [ ] **Step 5: Commit the profile release point**

```powershell
git add src/profile/index.ts tests/fixtures/profile-golden tests/profile/golden-repositories.test.ts schemas/project-memory/v1
git commit -m "test(profile): lock golden profile materialization"
git tag profile-compiler-v0.1.0
```

Expected: one release-point commit and an implementation checkpoint tag created only after the complete gate passes.

## Profile Compiler Completion Gate

- [ ] `ProfileCompiler` exposes `plan` only; no profile API commits or advances a canonical ref.
- [ ] `ProfileMaterializer` accepts only coordinator-authorized isolated staging worktrees.
- [ ] Raw `applyFileTransaction` is confined to staging materialization and tests.
- [ ] `IntegrationCoordinator.finalizeMutation` is the sole canonical commit/ref writer, including bootstrap delegation.
- [ ] Every `PROJECT`, component, domain, initiative, workstream, and task Markdown artifact has strict schema/type/version/id/revision front matter and a separate body.
- [ ] Canonical Markdown parse/render round trips are byte-stable.
- [ ] Exact transitive `.core.yaml`, `.taxonomy.yaml`, companion, blueprint, definition-source, and required generated-schema bytes are vendored into target namespaces.
- [ ] `SelectedCatalogLock` hashes exact final target bytes and `ProfileVerifier` reads only target bytes.
- [ ] Accepted source data, selected catalog bytes, selected catalog lock, profile lock, and generated views have non-overlapping authority.
- [ ] Missing accepted facts cause validation errors; the compiler does not invent or infer them.
- [ ] Multi-root namespaces are durable and portfolio/shared-platform references enforce truth ownership.
- [ ] Every canonical artifact path uses a stable instance ID.
- [ ] Repeated accepted inputs compile to identical mutation plans and bytes.
- [ ] Stale head, changed pre-image, missing approval, tampered vendored byte, or transaction failure leaves canonical state unchanged.
- [ ] `AGENTS.md` and `CLAUDE.md` appear only for explicitly selected adapters.
- [ ] No profile write targets `docs/project-memory/views/**`.
- [ ] Observed-unclassified reality remains outside accepted profile intent.
- [ ] `npm run check` exits `0`.
