# Project Memory Catalog Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete, versioned v1 project-memory catalog: 11 blueprint groups, 62 ready-made root-profile blueprints, reusable component/domain/overlay/adapter registries, taxonomy bindings for all 257 work patterns and 13 companion rules, 150 blueprint-selection fixtures, deterministic manifests and release locks, and contract tests that prevent incomplete or ambiguous catalog content from becoming selectable.

**Architecture:** Keep human-authored catalog content in `catalog/project-memory/v1/`, one definition per YAML file, and compile it through executable TypeScript contracts into a deterministic release bundle. Pattern and companion-rule definitions are split: the work-pattern plan owns `*.core.yaml`; this plan owns `*.taxonomy.yaml`. Assembly joins identical ID/version pairs, rejects field overlap, and fails closed on missing or incompatible halves. Catalog code consumes foundation document I/O, schema validation, canonical JSON, hashing, and runtime diagnostics; executable normalization, scoring, tie handling, and selection remain exclusively in `src/selection/**`.

**Tech Stack:** Node.js 24, TypeScript ESM with strict checking, TypeBox schemas registered with the foundation Ajv 2020 validator, foundation YAML/JSON document I/O and canonical SHA-256 hashing, Vitest, and ESLint.

## Global Constraints

- Repository root: `<repository-root>` (or its isolated worktree). Package root: `plugins/project-memory/`; every implementation path below is relative to that package root.
- Approved design sources: repository-root `docs/superpowers/specs/2026-07-14-project-memory-system-design.md` and `docs/superpowers/specs/2026-07-14-project-memory-agent-plugin-design.md`.
- Source catalog root: `catalog/project-memory/v1/`.
- Generated catalog schemas: `schemas/project-memory/v1/`.
- Test root: `tests/`.
- Foundation owns package bootstrap, shared config, schema registration/validation, document I/O, path safety, canonical JSON, SHA-256, and runtime diagnostics.
- The CLI plan owns distributable-product argument parsing, stable process exit behavior, top-level `project-memory` routing, and `src/cli.ts`. This plan owns only the fixed internal build harness named below.
- The selection plan owns feature normalization, predicate evaluation, scoring, confidence, precedence, ambiguity, and selection in `src/selection/**`.
- This plan adds pure catalog command service functions plus one narrow `src/catalog/commands/build-tool.ts` harness used only by the five foundation-defined `catalog:*` npm scripts. The harness parses only the documented build flags, delegates all behavior to `RuntimeResult` handlers, and sets exit code `0` or `1`; it is never exported as the product CLI. Together with distributable `src/cli.ts`, it is one of exactly two entrypoints permitted to map issues to explicit process exit codes.
- YAML keys use the approved snake_case vocabulary; do not create a parallel camelCase content vocabulary.
- Stable IDs are lowercase dot-separated identifiers. A source filename equals its declared ID plus its owned suffix.
- Exactly 11 blueprint groups and 62 unique active v1 blueprints must exist.
- Exactly 16 pattern families, 257 unique pattern IDs, and nine allowed modes must exist.
- This plan creates only `*.taxonomy.yaml` for patterns and companion rules; it never creates or edits `*.core.yaml`.
- Taxonomy halves own only `compatibility`, `overlay_applicability`, `component_impacts`, and `domain_impacts`, plus identity/version metadata.
- Core halves own procedural, selection, authorization, evidence, and completion fields. Assembly rejects any cross-half field overlap.
- Exactly 13 companion-rule taxonomy halves must exist.
- Exactly 150 blueprint fixtures must exist: 62 positive, 62 anti-signal, and 26 boundary/composite.
- Missing contract fields, unknown references, duplicate IDs, count drift, or ambiguous mappings keep a definition disabled.
- Every blueprint declares `group_id`, allowed root kinds, exactly one primary archetype, baked/default/forbidden overlays, components, domains, adapters, documents, gates, and positive/negative examples.
- Component/domain/overlay impacts may add inspection, validation, evidence, records, or stricter approval; they never grant mutation or external-action authority.
- `not_applicable` is a hard exclusion. A conflict with `required` fails closed.
- Exact release versions and file hashes are locked. Released definitions are immutable and never upgrade silently.
- Preserve deprecated definitions with replacement and migration metadata; do not delete released history.
- No generated bundle, lock, schema, checksum, or inventory report is edited by hand.
- Only Task 46 writes the shared generated v1 release lock and bundle.
- Every implementation task is test-first and ends in one logical conventional commit.

---

## Ownership Boundary

This plan owns:

- `src/catalog/**` contracts, catalog-specific loading/assembly/validation, catalog fixture validation, manifest semantics, release comparison, and pure command handlers.
- All source files under `catalog/project-memory/v1/blueprint-groups/`, `blueprints/`, `components/`, `domains/`, `overlays/`, and `adapters/`.
- All `catalog/project-memory/v1/patterns/<family>/<pattern-id>.taxonomy.yaml`.
- All `catalog/project-memory/v1/companion-rules/<rule-id>.taxonomy.yaml`.
- Catalog inventories, catalog documentation, expected-outcome fixtures, generated catalog schemas, and catalog tests.

This plan consumes but does not own:

- `src/schema/index.ts`, `src/schema/registry.ts`, `src/schema/validate.ts`, and `src/schema/formats.ts`.
- `src/schema/project-registrars.ts` remains lead-integrator-owned: Catalog Task 2 specifies the exact registrar reference to add, but a catalog subsystem worker never edits that file.
- `src/core/document-io.ts`, `src/core/canonical-json.ts`, `src/core/hash.ts`, and `src/core/path-safety.ts`.
- `src/contracts/runtime-result.ts`.
- `src/selection/**`.
- Pattern and companion `*.core.yaml` files.
- Repository materialization, record storage, claims, leases, workstream decomposition, and task dispatch.

## Final Owned File Map

```text
src/catalog/
  foundation.ts
  contracts/{common,signals,blueprint,component,domain,overlay,adapter,pattern,companion-rule,fixture,manifest,index}.ts
  load-catalog.ts
  assembly/{assemble-pattern,assemble-companion-rule}.ts
  validation/{validate-catalog,validate-counts,validate-ids,validate-references,validate-compatibility,validate-pattern-bijection,validate-overlays,validate-fixtures}.ts
  manifest/{build-catalog-bundle,verify-catalog-release,compare-releases}.ts
  fixtures/{validate-golden-fixtures,run-integrated-blueprint-fixtures}.ts
  commands/{build-tool,generate-schemas,validate-catalog-command,inventory-command,fixtures-command,lock-command,bundle-command}.ts
catalog/project-memory/v1/
  manifest.yaml
  {CHANGELOG,VERSIONING,EXTENSIONS}.md
  inventories/**
  blueprint-groups/*.yaml
  blueprints/<group>/*.yaml
  components/<pack>/*.yaml
  domains/*.yaml
  overlays/<category>/*.yaml
  adapters/<kind>/*.yaml
  patterns/<family>/*.taxonomy.yaml
  companion-rules/*.taxonomy.yaml
  fixtures/blueprints/<group>/{*.positive.yaml,*.anti.yaml}
  fixtures/boundaries/{001..026}.yaml
  fixtures/pattern-taxonomy/<family>.yaml
  fixtures/companion-taxonomy.yaml
schemas/project-memory/v1/*.schema.json
tests/catalog/contracts/*.test.ts
tests/catalog/fixtures/catalog-invalid/**
dist/catalog/project-memory/1.0.0/{catalog.bundle.json,catalog.lock.json,SHA256SUMS}
```

The foundation and CLI plans own `package.json`, shared configuration, top-level scripts, and CLI routing. When this plan names an `npm run catalog:*` command, it is an integration acceptance command backed by these pure handlers and wired by the CLI/foundation plans.

## Shared Contracts

```ts
export type RootKind =
  | "product"
  | "shared-system"
  | "program"
  | "portfolio"
  | "engagement";

export type PrimaryArchetype =
  | "application-service"
  | "developer-platform"
  | "game-interactive"
  | "ai-data"
  | "commerce-network"
  | "content-learning"
  | "brand-design"
  | "research-knowledge"
  | "operations-automation"
  | "portfolio"
  | "engagement";

export type PatternMode =
  | "assess" | "plan" | "design" | "implement" | "change"
  | "validate" | "release" | "operate" | "retire";

export type ControlledDuty =
  | "inspect" | "propose" | "modify" | "validate" | "approve"
  | "release" | "notify" | "record" | "no-touch";

export interface PatternTaxonomyBinding {
  pattern_id: string;
  pattern_version: string;
  compatibility: Compatibility;
  overlay_applicability: OverlayApplicability;
  component_impacts: ComponentImpact[];
  domain_impacts: DomainImpact[];
}

export interface CatalogSource {
  blueprints: ReadonlyMap<string, BlueprintDefinition>;
  components: ReadonlyMap<string, ComponentDefinition>;
  domains: ReadonlyMap<string, DomainDefinition>;
  overlays: ReadonlyMap<string, OverlayDefinition>;
  adapters: ReadonlyMap<string, AdapterDefinition>;
  pattern_cores: ReadonlyMap<string, PatternCoreDefinition>;
  pattern_taxonomy: ReadonlyMap<string, PatternTaxonomyBinding>;
  companion_cores: ReadonlyMap<string, CompanionRuleCore>;
  companion_taxonomy: ReadonlyMap<string, CompanionTaxonomyBinding>;
}

export function loadCatalog(root: URL): Promise<RuntimeResult<CatalogSource>>;
export function assemblePatternDefinition(
  core: PatternCoreDefinition,
  taxonomy: PatternTaxonomyBinding,
): RuntimeResult<PatternDefinition>;
export function assembleCompanionRule(
  core: CompanionRuleCore,
  taxonomy: CompanionTaxonomyBinding,
): RuntimeResult<CompanionRuleDefinition>;
export interface CatalogReleaseLockEntry {
  relative_path: string;
  definition_id: string | null;
  version: string | null;
  schema_id: string | null;
  sha256: string;
}

export interface CatalogReleaseLock {
  schema_version: "1.0.0";
  catalog_id: "project-memory";
  release: string;
  source_entries: readonly CatalogReleaseLockEntry[];
  generated_entries: readonly CatalogReleaseLockEntry[];
  release_hash: string;
}

export interface CatalogReleaseArtifacts {
  root: URL;
  lock: CatalogReleaseLock;
  bundle_path: string;
  lock_path: string;
  checksums_path: string;
}

export interface CatalogValidationReport {
  valid: boolean;
  checked_definition_ids: readonly string[];
  issues: readonly RuntimeIssue[];
}

export interface CatalogReleaseVerification {
  valid: boolean;
  release: string;
  release_hash: string;
  checked_paths: readonly string[];
}

export function validateCatalog(
  catalog: CatalogSource,
  options: { strict: boolean; scope?: string },
): RuntimeResult<CatalogValidationReport>;
export function buildCatalogRelease(
  root: URL,
  catalog: CatalogSource,
  release: string,
): Promise<RuntimeResult<CatalogReleaseArtifacts>>;
export function verifyCatalogRelease(
  root: URL,
  lock: CatalogReleaseLock,
): Promise<RuntimeResult<CatalogReleaseVerification>>;
```

No catalog module exports `evaluatePredicate`, `scoreCandidate`, `selectCandidate`, a feature normalizer, or a tie resolver. `CatalogReleaseLock` is the full immutable master-release lock built and verified here. `SelectedCatalogLock` is the profile-owned lock for one target repository's vendored closure; catalog code never aliases, builds, or verifies it.

## Naming and Count Locks

- Blueprint group: `blueprint-group.<slug>`; blueprint: `<namespace>.<slug>`.
- Component: `component.<slug>`; domain: `domain.<slug>`.
- Overlay: `overlay.<category>.<slug>`; adapter: `adapter.<slug>`.
- Pattern: `<family>.<object>.<mode>`; this plan owns `<id>.taxonomy.yaml`.
- Companion: `companion.<slug>`; this plan owns `<id>.taxonomy.yaml`.
- All v1 definition versions and schema versions start at `1.0.0`.
- Blueprint counts by group: `8,6,6,6,6,6,4,6,6,5,3`.
- Pattern counts by family: `15,16,22,16,18,14,16,16,13,12,14,12,20,20,17,16`.

## Task Dependency Graph

```text
Tasks 1-4  foundation binding, contracts, loader/validator, manifests
Tasks 5-15 reusable registries
Tasks 16-26 blueprint groups plus 124 paired fixtures
Task 27     26 boundary fixtures; blueprint fixture total = 150
Tasks 28-43 pattern taxonomy families; taxonomy total = 257
Task 44     13 companion taxonomy halves
Tasks 45-47 cross-plan fixtures, deterministic release, final audit
```

### Task 1: Bind Catalog Code to Foundation Runtime Services

**Files:**
- Create: `src/catalog/foundation.ts`
- Create: `tests/catalog/contracts/foundation-integration.test.ts`

**Interfaces:**
- Consumes `registerSchema` and `validateWithSchema` from `src/schema/index.ts`.
- Consumes `readUtf8Document`, `parseYamlDocument`, and `parseJsonDocument` from `src/core/document-io.ts`.
- Consumes `canonicalJson`, `sha256`, and async `resolveInside` from the fixed foundation modules.
- Returns foundation `RuntimeResult<T>` diagnostics.
- Produces a frozen catalog-local import surface; it does not wrap or alter behavior.

- [ ] **Step 1: Write the failing foundation integration test**

```ts
import { describe, expect, it } from "vitest";
import { catalogFoundation } from "../../../src/catalog/foundation.js";

describe("catalog foundation integration", () => {
  it("exposes only foundation-owned infrastructure", () => {
    expect(Object.keys(catalogFoundation).sort()).toEqual([
      "canonicalJson",
      "parseJsonDocument",
      "parseYamlDocument",
      "readUtf8Document",
      "registerSchema",
      "resolveInside",
      "sha256",
      "validateWithSchema",
    ]);
  });
});
```

- [ ] **Step 2: Prove the test fails**

Run: `npm test -- tests/catalog/contracts/foundation-integration.test.ts`

Expected: FAIL with `Cannot find module '../../../src/catalog/foundation.js'`.

- [ ] **Step 3: Implement the thin import surface**

```ts
import { registerSchema, validateWithSchema } from "../schema/index.js";
import { canonicalJson } from "../core/canonical-json.js";
import {
  parseJsonDocument,
  parseYamlDocument,
  readUtf8Document,
} from "../core/document-io.js";
import { sha256 } from "../core/hash.js";
import { resolveInside } from "../core/path-safety.js";

export const catalogFoundation = Object.freeze({
  canonicalJson,
  parseJsonDocument,
  parseYamlDocument,
  resolveInside,
  readUtf8Document,
  registerSchema,
  sha256,
  validateWithSchema,
});
```

If a foundation export is absent, reconcile that prerequisite in the foundation plan; do not create a catalog-local substitute.

- [ ] **Step 4: Verify the focused contract**

Run:

```powershell
npm run typecheck
npm test -- tests/catalog/contracts/foundation-integration.test.ts
```

Expected: both commands exit `0`; Vitest reports `1 passed`.

- [ ] **Step 5: Commit**

```powershell
git add src/catalog/foundation.ts tests/catalog/contracts/foundation-integration.test.ts
git commit -m "feat(catalog): bind foundation runtime services"
```

### Task 2: Register TypeBox Catalog Contracts and Emit Catalog Schemas

**Files:**
- Create: `src/catalog/contracts/common.ts`
- Create: `src/catalog/contracts/signals.ts`
- Create: `src/catalog/contracts/blueprint.ts`
- Create: `src/catalog/contracts/component.ts`
- Create: `src/catalog/contracts/domain.ts`
- Create: `src/catalog/contracts/overlay.ts`
- Create: `src/catalog/contracts/adapter.ts`
- Create: `src/catalog/contracts/pattern.ts`
- Create: `src/catalog/contracts/companion-rule.ts`
- Create: `src/catalog/contracts/fixture.ts`
- Create: `src/catalog/contracts/manifest.ts`
- Create: `src/catalog/contracts/index.ts`
- Create: `src/catalog/commands/generate-schemas.ts`
- Modify (lead integrator only): `src/schema/project-registrars.ts`
- Create: `tests/catalog/contracts/schemas.test.ts`
- Create: `tests/catalog/contracts/schema-registrar-integration.test.ts`
- Generate: `schemas/project-memory/v1/*.schema.json`

**Interfaces:**
- Consumes TypeBox, the foundation Ajv 2020 schema registry, `SchemaRegistrar`, `registerProjectSchemas`, and the explicit `PROJECT_SCHEMA_REGISTRARS` aggregation.
- Produces `TSchema` objects plus `Static<typeof Schema>` types.
- Registers stable schema IDs under `project-memory/v1/<name>` through `registerCatalogSchemas(): readonly SchemaId[]`, which satisfies the foundation `SchemaRegistrar` contract.
- Exposes a pure `generateCatalogSchemaDocuments(): ReadonlyMap<string, string>`; persistence is performed through the foundation command/runtime layer.
- Does not parse command-line arguments or create another validator.
- Before any catalog schema emission, the lead integrator adds the explicit `registerCatalogSchemas` import and function reference to `src/schema/project-registrars.ts`; dynamic registrar discovery is forbidden.

- [ ] **Step 1: Write failing strict-schema and registrar-integration tests**

```ts
import { describe, expect, it } from "vitest";
import {
  BlueprintDefinitionSchema,
  PatternTaxonomyBindingSchema,
  registerCatalogSchemas,
} from "../../../src/catalog/contracts/index.js";
import { catalogFoundation } from "../../../src/catalog/foundation.js";

describe("catalog contracts", () => {
  it("registers strict Ajv 2020 schemas", () => {
    registerCatalogSchemas();
    const valid = {
      id: "application.consumer-mobile",
      version: "1.0.0",
      status: "active",
      group_id: "blueprint-group.application-service",
      allowed_root_kinds: ["product"],
      primary_archetype: "application-service",
      purpose: "Consumer value is delivered through a mobile application.",
      selection: {
        feature_schema_version: "1.0.0",
        required_signals: [],
        positive_signals: [],
        negative_signals: [],
        exclusions: [],
        max_positive_weight: 1,
        specificity_rank: 20,
        precedence: 20,
      },
      overlays: { baked: [], defaults: [], forbidden: [] },
      default_components: ["component.mobile-client"],
      default_domains: ["domain.product-strategy"],
      adapter_slots: ["mobile-client"],
      required_documents: ["source/PRD.md"],
      validation_gates: ["gate.profile.references-valid"],
      positive_examples: ["A consumer habit application."],
      negative_examples: ["A reusable mobile SDK."],
    };
    expect(catalogFoundation.validateWithSchema(BlueprintDefinitionSchema.$id, valid).ok).toBe(true);
    expect(
      catalogFoundation.validateWithSchema(BlueprintDefinitionSchema.$id, { ...valid, invented: true }).ok,
    ).toBe(false);
  });

  it("keeps taxonomy fields separate from core fields", () => {
    const invalid = {
      pattern_id: "engineering.feature.implement",
      pattern_version: "1.0.0",
      compatibility: {},
      overlay_applicability: {},
      component_impacts: [],
      domain_impacts: [],
      selection: {},
    };
    expect(catalogFoundation.validateWithSchema(PatternTaxonomyBindingSchema.$id, invalid).ok).toBe(false);
  });
});
```


In `schema-registrar-integration.test.ts`, prove both explicit wiring and aggregation:

```ts
import {
  CATALOG_SCHEMA_IDS,
  registerCatalogSchemas,
} from "../../../src/catalog/contracts/index.js";
import { registerProjectSchemas } from "../../../src/schema/index.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../../src/schema/project-registrars.js";

it("wires catalog schemas into the foundation emitter", () => {
  expect(PROJECT_SCHEMA_REGISTRARS).toContain(registerCatalogSchemas);
  const result = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual(expect.arrayContaining(CATALOG_SCHEMA_IDS));
  }
});
```

- [ ] **Step 2: Prove the tests fail**

Run: `npm test -- tests/catalog/contracts/schemas.test.ts tests/catalog/contracts/schema-registrar-integration.test.ts`

Expected: FAIL because the contract barrel does not exist.

- [ ] **Step 3: Implement strict TypeBox contracts**

Use `Type.Object(..., { additionalProperties: false, $id })` at every object boundary. Use the foundation SemVer and stable-ID formats. Export the exact sorted 12-entry `CATALOG_SCHEMA_IDS`; `registerCatalogSchemas` registers those schemas and returns that same immutable array for the foundation registrar aggregation. Signal weights/penalties are integers `1..100`; required signals and exclusions are Boolean gates. Pattern IDs match:

```text
^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.(assess|plan|design|implement|change|validate|release|operate|retire)$
```

The split schema is exact:

```ts
export const PatternTaxonomyBindingSchema = Type.Object({
  pattern_id: PatternIdSchema,
  pattern_version: SemVerSchema,
  compatibility: CompatibilitySchema,
  overlay_applicability: OverlayApplicabilitySchema,
  component_impacts: Type.Array(ComponentImpactSchema),
  domain_impacts: Type.Array(DomainImpactSchema),
}, {
  $id: "project-memory/v1/pattern-taxonomy",
  additionalProperties: false,
});

export type PatternTaxonomyBinding =
  Static<typeof PatternTaxonomyBindingSchema>;
```

Enforce with schema constraints or post-schema catalog validation: `modify` requires non-empty `write_scope`; `approve` permits only `integrator` or `Pitaji`; `no-touch` excludes `modify`, `release`, and `notify`.

- [ ] **Step 4: Wire the catalog registrar, then generate the 12 catalog schemas**

After `registerCatalogSchemas` exists and before the first emitter invocation, the lead integrator updates `src/schema/project-registrars.ts` to import it and append that exact function reference to `PROJECT_SCHEMA_REGISTRARS`. Run the integration test before emission; it must pass and prove the catalog registrar is reachable by the foundation entrypoint.

Run:

```powershell
npm test -- tests/catalog/contracts/schema-registrar-integration.test.ts
npm run schemas:emit
npm test -- tests/catalog/contracts/schemas.test.ts tests/catalog/contracts/schema-registrar-integration.test.ts
git diff --check
```

Expected: registrar integration passes before emission; tests pass; the schema index contains exactly the 12 catalog schema IDs alongside previously registered foundation schemas; every catalog schema document uses canonical two-space JSON under `schemas/project-memory/v1/`; `git diff --check` emits no output.

- [ ] **Step 5: Commit**

```powershell
git add src/catalog/contracts src/catalog/commands/generate-schemas.ts src/schema/project-registrars.ts schemas/project-memory/v1 tests/catalog/contracts/schemas.test.ts tests/catalog/contracts/schema-registrar-integration.test.ts
git commit -m "feat(catalog): register executable catalog contracts"
```

### Task 3: Load, Assemble, and Validate Catalog Sources

**Files:**
- Create: `src/catalog/load-catalog.ts`
- Create: `src/catalog/assembly/assemble-pattern.ts`
- Create: `src/catalog/assembly/assemble-companion-rule.ts`
- Create: `src/catalog/validation/validate-catalog.ts`
- Create: `src/catalog/validation/validate-counts.ts`
- Create: `src/catalog/validation/validate-ids.ts`
- Create: `src/catalog/validation/validate-references.ts`
- Create: `src/catalog/validation/validate-compatibility.ts`
- Create: `src/catalog/validation/validate-pattern-bijection.ts`
- Create: `src/catalog/validation/validate-overlays.ts`
- Create: `src/catalog/validation/validate-fixtures.ts`
- Create: `src/catalog/fixtures/validate-golden-fixtures.ts`
- Create: `tests/catalog/contracts/load-and-assembly.test.ts`
- Create: `tests/catalog/contracts/ids-and-counts.test.ts`
- Create: `tests/catalog/contracts/references.test.ts`
- Create: `tests/catalog/fixtures/catalog-invalid/**`

**Interfaces:**
- Loads only through `catalogFoundation.resolveInside` and `catalogFoundation.readUtf8Document`.
- Validates through registered schemas and returns foundation `RuntimeResult<T>`.
- Joins core/taxonomy only when IDs and exact versions match.
- Rejects any property owned by both halves; taxonomy may contain only identity/version and the four taxonomy fields.
- Produces no score or selection decision.

- [ ] **Step 1: Write failing assembly and invalid-corpus tests**

```ts
it("rejects field overlap between core and taxonomy", () => {
  const taxonomy = {
    ...validTaxonomy,
    evidence_requirements: ["unexpected"],
  };
  const result = assemblePatternDefinition(validCore, taxonomy as never);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0]?.code).toBe("CATALOG_HALF_FIELD_OVERLAP");
});

it.each([
  ["duplicate-id", "CATALOG_DUPLICATE_ID"],
  ["unknown-reference", "CATALOG_UNKNOWN_REFERENCE"],
  ["pattern-version-mismatch", "CATALOG_HALF_VERSION_MISMATCH"],
  ["overlay-conflict", "CATALOG_OVERLAY_CONFLICT"],
])("%s fails closed", async (folder, code) => {
  const result = await loadAndValidateInvalidFixture(folder);
  expect(result.issues.some((issue) => issue.code === code)).toBe(true);
});
```


- [ ] **Step 2: Prove the tests fail**

Run: `npm test -- tests/catalog/contracts/load-and-assembly.test.ts tests/catalog/contracts/ids-and-counts.test.ts tests/catalog/contracts/references.test.ts`

Expected: FAIL because the loader, assemblers, validators, and invalid corpus do not exist.

- [ ] **Step 3: Implement deterministic loading and fail-closed validation**

Sort confined relative paths lexicographically before reading. Validate filename-to-ID equality, duplicate IDs, schema validity, references, status rules, count locks, overlay conflicts, impact authority restrictions, core/taxonomy bijection, and exact half versions. Return stable diagnostics sorted by `path`, `definition_id`, then `code`.

```ts
const unexpected = Object.keys(taxonomy).filter(
  (key) => !TAXONOMY_IDENTITY_FIELDS.has(key)
    && !TAXONOMY_OWNED_FIELDS.has(key),
);
const overlap = [...TAXONOMY_OWNED_FIELDS].filter(
  (key) => Object.hasOwn(core, key),
);
const conflicts = [...unexpected, ...overlap].sort();
if (conflicts.length > 0) {
  return failure("CATALOG_HALF_FIELD_OVERLAP", conflicts.join(","));
}
```

- [ ] **Step 4: Verify loader and validator behavior**

Run:

```powershell
npm run typecheck
npm test -- tests/catalog/contracts/load-and-assembly.test.ts tests/catalog/contracts/ids-and-counts.test.ts tests/catalog/contracts/references.test.ts
```

Expected: all focused tests pass; each invalid fixture emits its pinned diagnostic code and no uncaught exception.

- [ ] **Step 5: Commit**

```powershell
git add src/catalog/load-catalog.ts src/catalog/assembly src/catalog/validation src/catalog/fixtures/validate-golden-fixtures.ts tests/catalog
git commit -m "feat(catalog): load assemble and validate catalog sources"
```

### Task 4: Pin Manifest Semantics, Inventories, and Pure Command Handlers

**Files:**
- Create: `catalog/project-memory/v1/manifest.yaml`
- Create: `catalog/project-memory/v1/CHANGELOG.md`
- Create: `catalog/project-memory/v1/VERSIONING.md`
- Create: `catalog/project-memory/v1/EXTENSIONS.md`
- Create: `catalog/project-memory/v1/inventories/blueprint-groups.yaml`
- Create: `catalog/project-memory/v1/inventories/blueprints/*.yaml`
- Create: `catalog/project-memory/v1/inventories/pattern-families.yaml`
- Create: `catalog/project-memory/v1/inventories/patterns/*.yaml`
- Create: `catalog/project-memory/v1/inventories/components/*.yaml`
- Create: `catalog/project-memory/v1/inventories/domains.yaml`
- Create: `catalog/project-memory/v1/inventories/overlays/*.yaml`
- Create: `catalog/project-memory/v1/inventories/adapters/*.yaml`
- Create: `catalog/project-memory/v1/inventories/companion-rules.yaml`
- Create: `src/catalog/commands/build-tool.ts`
- Create: `src/catalog/commands/validate-catalog-command.ts`
- Create: `src/catalog/commands/inventory-command.ts`
- Create: `src/catalog/commands/fixtures-command.ts`
- Create: `src/catalog/commands/lock-command.ts`
- Create: `src/catalog/commands/bundle-command.ts`
- Create: `src/catalog/manifest/compare-releases.ts`
- Create: `tests/catalog/contracts/versioning.test.ts`

**Interfaces:**
- Inventories are hand-authored normative ID lists and expected counts, not generated reports.
- Pure handlers accept typed options and return `RuntimeResult`; they never inspect `process.argv`, print, or set process state.
- `build-tool.ts` accepts exactly `validate | inventory | fixtures | lock | bundle`, parses only `--scope`, `--strict`, `--check`, `--schema-only`, `--taxonomy-only`, `--integrated`, `--suite`, `--release`, and `--check-clean`, rejects every duplicate/unknown flag, delegates to the matching pure handler, prints one JSON report, and sets `process.exitCode` to `0` for success or `1` for failure.
- Release comparison consumes `CatalogReleaseLock` values and returns `RuntimeResult<"patch" | "minor" | "major" | "invalid">`.
- Tasks 5-44 add definitions against these inventories; only Task 46 emits the `CatalogReleaseLock`, bundle, and checksum artifacts. No catalog command creates a `SelectedCatalogLock`.

- [ ] **Step 1: Write failing count and SemVer tests**

```ts
it("pins all v1 catalog totals", async () => {
  const inventory = await loadInventory();
  expect(inventory.blueprint_groups).toHaveLength(11);
  expect(inventory.blueprints).toHaveLength(62);
  expect(inventory.pattern_families).toHaveLength(16);
  expect(inventory.patterns).toHaveLength(257);
  expect(inventory.companion_rules).toHaveLength(13);
});

it("classifies a selection-boundary change as major", () => {
  const result = compareCatalogReleases(previousLock, changedSelectionLock);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toBe("major");
});
```


- [ ] **Step 2: Prove the tests fail**

Run: `npm test -- tests/catalog/contracts/versioning.test.ts tests/catalog/contracts/ids-and-counts.test.ts`

Expected: FAIL because the manifest, inventories, and release comparator do not exist.

- [ ] **Step 3: Create the manifest and normative inventories**

```yaml
catalog:
  id: project-memory
  release: 1.0.0
  schema_version: 1.0.0
  source_root: catalog/project-memory/v1
  expected_counts:
    blueprint_groups: 11
    blueprints: 62
    pattern_families: 16
    patterns: 257
    companion_rules: 13
    blueprint_fixtures:
      positive: 62
      anti: 62
      boundary: 26
      total: 150
  generated_paths:
    schemas: schemas/project-memory/v1
    release: dist/catalog/project-memory/1.0.0
```

Populate each inventory with the exact stable IDs listed in Tasks 5-44. `VERSIONING.md` pins patch/minor/major rules and immutable releases. `EXTENSIONS.md` requires namespace ownership and prevents an extension from shadowing a built-in ID.

Implement `build-tool.ts` only after the five pure handlers exist. Keep this dispatch table literal so every foundation-defined npm script has one target and no fallback:

```ts
const BUILD_COMMANDS = {
  validate: validateCatalogCommand,
  inventory: inventoryCommand,
  fixtures: fixturesCommand,
  lock: lockCommand,
  bundle: bundleCommand,
} as const;
```

- [ ] **Step 4: Verify inventory and version policy**

Run:

```powershell
npm run catalog:inventory -- --check
npm test -- tests/catalog/contracts/versioning.test.ts tests/catalog/contracts/ids-and-counts.test.ts
```

Expected: inventory command reports the five pinned totals and exits `0`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/manifest.yaml catalog/project-memory/v1/CHANGELOG.md catalog/project-memory/v1/VERSIONING.md catalog/project-memory/v1/EXTENSIONS.md catalog/project-memory/v1/inventories src/catalog/commands src/catalog/manifest/compare-releases.ts tests/catalog/contracts/versioning.test.ts
git commit -m "feat(catalog): pin v1 manifest and inventories"
```

## Reusable Registry Task Contract

Tasks 5-15 use this exact content shape and test-first sequence. Every definition adds a purpose, inclusion boundary, exclusion boundary, defaults, required documents/records, compatibility references, positive examples, and negative examples.

Representative component definition:

```yaml
component_definition:
  id: component.mobile-client
  version: 1.0.0
  status: active
  name: Mobile client
  type: surface
  purpose: User-facing native or cross-platform mobile runtime.
  required_documents: [docs/components/mobile-client/COMPONENT.md]
  default_domains: [domain.engineering-architecture, domain.ux-content-design]
  tags: [client, mobile]
  positive_examples: [A Flutter application distributed through mobile stores.]
  negative_examples: [A mobile SDK consumed by other applications.]
```

Each registry task first adds a failing inventory/reference assertion, proves it fails, creates all named definitions and the matching inventory file, runs the scoped validator plus focused test, and commits only its owned paths.

### Task 5: Create the Foundation Product Component Pack

**Files:**
- Create: `catalog/project-memory/v1/components/foundation-product/component.product-strategy.yaml`, `catalog/project-memory/v1/components/foundation-product/component.product-management.yaml`, `catalog/project-memory/v1/components/foundation-product/component.user-research.yaml`, `catalog/project-memory/v1/components/foundation-product/component.ux.yaml`, `catalog/project-memory/v1/components/foundation-product/component.information-architecture.yaml`, `catalog/project-memory/v1/components/foundation-product/component.content-design.yaml`, `catalog/project-memory/v1/components/foundation-product/component.visual-design.yaml`, `catalog/project-memory/v1/components/foundation-product/component.brand.yaml`, `catalog/project-memory/v1/components/foundation-product/component.design-system.yaml`, `catalog/project-memory/v1/components/foundation-product/component.web-client.yaml`, `catalog/project-memory/v1/components/foundation-product/component.mobile-client.yaml`, `catalog/project-memory/v1/components/foundation-product/component.desktop-client.yaml`, `catalog/project-memory/v1/components/foundation-product/component.admin-console.yaml`
- Create: `catalog/project-memory/v1/inventories/components/foundation-product.yaml`
- Modify: `tests/catalog/contracts/references.test.ts`

**Interfaces:**
- Consumes the Task 2 definition schema and Task 3 reference validator.
- Produces the exact 13-ID inventory below; every ID is active at `1.0.0`.
- Each definition includes purpose, inclusion/exclusion boundaries, defaults, document/record requirements, positive examples, and negative examples.

- [ ] **Step 1: Add the failing exact-inventory assertion**

```ts
expect(await inventoryIds("components/foundation-product")).toEqual([
      "component.product-strategy",
      "component.product-management",
      "component.user-research",
      "component.ux",
      "component.information-architecture",
      "component.content-design",
      "component.visual-design",
      "component.brand",
      "component.design-system",
      "component.web-client",
      "component.mobile-client",
      "component.desktop-client",
      "component.admin-console",
]);
```

- [ ] **Step 2: Prove the scoped test fails**

Run: `npm test -- tests/catalog/contracts/references.test.ts`

Expected: FAIL with missing definitions or inventory entries for this task's 13 IDs.

- [ ] **Step 3: Create every definition and its inventory entry**

Create exactly: `component.product-strategy`, `component.product-management`, `component.user-research`, `component.ux`, `component.information-architecture`, `component.content-design`, `component.visual-design`, `component.brand`, `component.design-system`, `component.web-client`, `component.mobile-client`, `component.desktop-client`, `component.admin-console`. Keep IDs and filenames identical. Define deterministic compatibility/default references and both boundary example lists; do not leave empty descriptive fields.

- [ ] **Step 4: Validate the owned registry scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/components/foundation-product --strict
npm test -- tests/catalog/contracts/references.test.ts
```

Expected: validator reports `13 active, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/components/foundation-product catalog/project-memory/v1/inventories/components/foundation-product.yaml tests/catalog/contracts/references.test.ts
git commit -m "feat(catalog): add components foundation-product registry"
```

### Task 6: Create the Engineering Services Component Pack

**Files:**
- Create: `catalog/project-memory/v1/components/engineering-services/component.api.yaml`, `catalog/project-memory/v1/components/engineering-services/component.sdk.yaml`, `catalog/project-memory/v1/components/engineering-services/component.cli.yaml`, `catalog/project-memory/v1/components/engineering-services/component.backend-service.yaml`, `catalog/project-memory/v1/components/engineering-services/component.identity.yaml`, `catalog/project-memory/v1/components/engineering-services/component.datastore.yaml`, `catalog/project-memory/v1/components/engineering-services/component.search.yaml`, `catalog/project-memory/v1/components/engineering-services/component.messaging.yaml`, `catalog/project-memory/v1/components/engineering-services/component.notifications.yaml`, `catalog/project-memory/v1/components/engineering-services/component.realtime.yaml`, `catalog/project-memory/v1/components/engineering-services/component.integration.yaml`, `catalog/project-memory/v1/components/engineering-services/component.shared-platform.yaml`, `catalog/project-memory/v1/components/engineering-services/component.configuration.yaml`, `catalog/project-memory/v1/components/engineering-services/component.feature-flags.yaml`
- Create: `catalog/project-memory/v1/inventories/components/engineering-services.yaml`
- Modify: `tests/catalog/contracts/references.test.ts`

**Interfaces:**
- Consumes the Task 2 definition schema and Task 3 reference validator.
- Produces the exact 14-ID inventory below; every ID is active at `1.0.0`.
- Each definition includes purpose, inclusion/exclusion boundaries, defaults, document/record requirements, positive examples, and negative examples.

- [ ] **Step 1: Add the failing exact-inventory assertion**

```ts
expect(await inventoryIds("components/engineering-services")).toEqual([
      "component.api",
      "component.sdk",
      "component.cli",
      "component.backend-service",
      "component.identity",
      "component.datastore",
      "component.search",
      "component.messaging",
      "component.notifications",
      "component.realtime",
      "component.integration",
      "component.shared-platform",
      "component.configuration",
      "component.feature-flags",
]);
```

- [ ] **Step 2: Prove the scoped test fails**

Run: `npm test -- tests/catalog/contracts/references.test.ts`

Expected: FAIL with missing definitions or inventory entries for this task's 14 IDs.

- [ ] **Step 3: Create every definition and its inventory entry**

Create exactly: `component.api`, `component.sdk`, `component.cli`, `component.backend-service`, `component.identity`, `component.datastore`, `component.search`, `component.messaging`, `component.notifications`, `component.realtime`, `component.integration`, `component.shared-platform`, `component.configuration`, `component.feature-flags`. Keep IDs and filenames identical. Define deterministic compatibility/default references and both boundary example lists; do not leave empty descriptive fields.

- [ ] **Step 4: Validate the owned registry scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/components/engineering-services --strict
npm test -- tests/catalog/contracts/references.test.ts
```

Expected: validator reports `14 active, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/components/engineering-services catalog/project-memory/v1/inventories/components/engineering-services.yaml tests/catalog/contracts/references.test.ts
git commit -m "feat(catalog): add components engineering-services registry"
```

### Task 7: Create the Data and AI Component Pack

**Files:**
- Create: `catalog/project-memory/v1/components/data-ai/component.analytics.yaml`, `catalog/project-memory/v1/components/data-ai/component.instrumentation.yaml`, `catalog/project-memory/v1/components/data-ai/component.data-pipeline.yaml`, `catalog/project-memory/v1/components/data-ai/component.data-quality.yaml`, `catalog/project-memory/v1/components/data-ai/component.experimentation.yaml`, `catalog/project-memory/v1/components/data-ai/component.reporting.yaml`, `catalog/project-memory/v1/components/data-ai/component.ai-model.yaml`, `catalog/project-memory/v1/components/data-ai/component.ai-prompt.yaml`, `catalog/project-memory/v1/components/data-ai/component.ai-retrieval.yaml`, `catalog/project-memory/v1/components/data-ai/component.ai-agent-tools.yaml`, `catalog/project-memory/v1/components/data-ai/component.ai-evaluation.yaml`, `catalog/project-memory/v1/components/data-ai/component.ai-guardrails.yaml`, `catalog/project-memory/v1/components/data-ai/component.ai-serving.yaml`
- Create: `catalog/project-memory/v1/inventories/components/data-ai.yaml`
- Modify: `tests/catalog/contracts/references.test.ts`

**Interfaces:**
- Consumes the Task 2 definition schema and Task 3 reference validator.
- Produces the exact 13-ID inventory below; every ID is active at `1.0.0`.
- Each definition includes purpose, inclusion/exclusion boundaries, defaults, document/record requirements, positive examples, and negative examples.

- [ ] **Step 1: Add the failing exact-inventory assertion**

```ts
expect(await inventoryIds("components/data-ai")).toEqual([
      "component.analytics",
      "component.instrumentation",
      "component.data-pipeline",
      "component.data-quality",
      "component.experimentation",
      "component.reporting",
      "component.ai-model",
      "component.ai-prompt",
      "component.ai-retrieval",
      "component.ai-agent-tools",
      "component.ai-evaluation",
      "component.ai-guardrails",
      "component.ai-serving",
]);
```

- [ ] **Step 2: Prove the scoped test fails**

Run: `npm test -- tests/catalog/contracts/references.test.ts`

Expected: FAIL with missing definitions or inventory entries for this task's 13 IDs.

- [ ] **Step 3: Create every definition and its inventory entry**

Create exactly: `component.analytics`, `component.instrumentation`, `component.data-pipeline`, `component.data-quality`, `component.experimentation`, `component.reporting`, `component.ai-model`, `component.ai-prompt`, `component.ai-retrieval`, `component.ai-agent-tools`, `component.ai-evaluation`, `component.ai-guardrails`, `component.ai-serving`. Keep IDs and filenames identical. Define deterministic compatibility/default references and both boundary example lists; do not leave empty descriptive fields.

- [ ] **Step 4: Validate the owned registry scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/components/data-ai --strict
npm test -- tests/catalog/contracts/references.test.ts
```

Expected: validator reports `13 active, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/components/data-ai catalog/project-memory/v1/inventories/components/data-ai.yaml tests/catalog/contracts/references.test.ts
git commit -m "feat(catalog): add components data-ai registry"
```

### Task 8: Create the Assurance and Platform Component Pack

**Files:**
- Create: `catalog/project-memory/v1/components/assurance-platform/component.security.yaml`, `catalog/project-memory/v1/components/assurance-platform/component.privacy.yaml`, `catalog/project-memory/v1/components/assurance-platform/component.compliance.yaml`, `catalog/project-memory/v1/components/assurance-platform/component.trust-safety.yaml`, `catalog/project-memory/v1/components/assurance-platform/component.qa.yaml`, `catalog/project-memory/v1/components/assurance-platform/component.accessibility.yaml`, `catalog/project-memory/v1/components/assurance-platform/component.performance.yaml`, `catalog/project-memory/v1/components/assurance-platform/component.reliability.yaml`, `catalog/project-memory/v1/components/assurance-platform/component.ci-cd.yaml`, `catalog/project-memory/v1/components/assurance-platform/component.infrastructure.yaml`, `catalog/project-memory/v1/components/assurance-platform/component.observability.yaml`, `catalog/project-memory/v1/components/assurance-platform/component.release.yaml`, `catalog/project-memory/v1/components/assurance-platform/component.distribution.yaml`, `catalog/project-memory/v1/components/assurance-platform/component.incident-response.yaml`
- Create: `catalog/project-memory/v1/inventories/components/assurance-platform.yaml`
- Modify: `tests/catalog/contracts/references.test.ts`

**Interfaces:**
- Consumes the Task 2 definition schema and Task 3 reference validator.
- Produces the exact 14-ID inventory below; every ID is active at `1.0.0`.
- Each definition includes purpose, inclusion/exclusion boundaries, defaults, document/record requirements, positive examples, and negative examples.

- [ ] **Step 1: Add the failing exact-inventory assertion**

```ts
expect(await inventoryIds("components/assurance-platform")).toEqual([
      "component.security",
      "component.privacy",
      "component.compliance",
      "component.trust-safety",
      "component.qa",
      "component.accessibility",
      "component.performance",
      "component.reliability",
      "component.ci-cd",
      "component.infrastructure",
      "component.observability",
      "component.release",
      "component.distribution",
      "component.incident-response",
]);
```

- [ ] **Step 2: Prove the scoped test fails**

Run: `npm test -- tests/catalog/contracts/references.test.ts`

Expected: FAIL with missing definitions or inventory entries for this task's 14 IDs.

- [ ] **Step 3: Create every definition and its inventory entry**

Create exactly: `component.security`, `component.privacy`, `component.compliance`, `component.trust-safety`, `component.qa`, `component.accessibility`, `component.performance`, `component.reliability`, `component.ci-cd`, `component.infrastructure`, `component.observability`, `component.release`, `component.distribution`, `component.incident-response`. Keep IDs and filenames identical. Define deterministic compatibility/default references and both boundary example lists; do not leave empty descriptive fields.

- [ ] **Step 4: Validate the owned registry scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/components/assurance-platform --strict
npm test -- tests/catalog/contracts/references.test.ts
```

Expected: validator reports `14 active, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/components/assurance-platform catalog/project-memory/v1/inventories/components/assurance-platform.yaml tests/catalog/contracts/references.test.ts
git commit -m "feat(catalog): add components assurance-platform registry"
```

### Task 9: Create the Commercial and Specialist Component Pack

**Files:**
- Create: `catalog/project-memory/v1/components/commercial-specialist/component.commerce-catalog.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.checkout.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.payments.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.billing.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.entitlements.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.orders-bookings.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.settlement-reconciliation.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.fraud-disputes.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.growth-marketing.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.stores-aso.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.seo.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.editorial-content.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.localization.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.moderation-community.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.support.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.sop-training.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.game-design.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.game-runtime.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.game-art.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.game-audio.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.game-live-operations.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.research-program.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.knowledge-base.yaml`, `catalog/project-memory/v1/components/commercial-specialist/component.operations-workflow.yaml`
- Create: `catalog/project-memory/v1/inventories/components/commercial-specialist.yaml`
- Modify: `tests/catalog/contracts/references.test.ts`

**Interfaces:**
- Consumes the Task 2 definition schema and Task 3 reference validator.
- Produces the exact 24-ID inventory below; every ID is active at `1.0.0`.
- Each definition includes purpose, inclusion/exclusion boundaries, defaults, document/record requirements, positive examples, and negative examples.

- [ ] **Step 1: Add the failing exact-inventory assertion**

```ts
expect(await inventoryIds("components/commercial-specialist")).toEqual([
      "component.commerce-catalog",
      "component.checkout",
      "component.payments",
      "component.billing",
      "component.entitlements",
      "component.orders-bookings",
      "component.settlement-reconciliation",
      "component.fraud-disputes",
      "component.growth-marketing",
      "component.stores-aso",
      "component.seo",
      "component.editorial-content",
      "component.localization",
      "component.moderation-community",
      "component.support",
      "component.sop-training",
      "component.game-design",
      "component.game-runtime",
      "component.game-art",
      "component.game-audio",
      "component.game-live-operations",
      "component.research-program",
      "component.knowledge-base",
      "component.operations-workflow",
]);
```

- [ ] **Step 2: Prove the scoped test fails**

Run: `npm test -- tests/catalog/contracts/references.test.ts`

Expected: FAIL with missing definitions or inventory entries for this task's 24 IDs.

- [ ] **Step 3: Create every definition and its inventory entry**

Create exactly: `component.commerce-catalog`, `component.checkout`, `component.payments`, `component.billing`, `component.entitlements`, `component.orders-bookings`, `component.settlement-reconciliation`, `component.fraud-disputes`, `component.growth-marketing`, `component.stores-aso`, `component.seo`, `component.editorial-content`, `component.localization`, `component.moderation-community`, `component.support`, `component.sop-training`, `component.game-design`, `component.game-runtime`, `component.game-art`, `component.game-audio`, `component.game-live-operations`, `component.research-program`, `component.knowledge-base`, `component.operations-workflow`. Keep IDs and filenames identical. Define deterministic compatibility/default references and both boundary example lists; do not leave empty descriptive fields.

- [ ] **Step 4: Validate the owned registry scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/components/commercial-specialist --strict
npm test -- tests/catalog/contracts/references.test.ts
```

Expected: validator reports `24 active, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/components/commercial-specialist catalog/project-memory/v1/inventories/components/commercial-specialist.yaml tests/catalog/contracts/references.test.ts
git commit -m "feat(catalog): add components commercial-specialist registry"
```

### Task 10: Create the Fifteen Permanent Domain Definitions

**Files:**
- Create: `catalog/project-memory/v1/domains/domain.governance-coordination.yaml`, `catalog/project-memory/v1/domains/domain.product-strategy.yaml`, `catalog/project-memory/v1/domains/domain.research-insight.yaml`, `catalog/project-memory/v1/domains/domain.ux-content-design.yaml`, `catalog/project-memory/v1/domains/domain.visual-brand-design-systems.yaml`, `catalog/project-memory/v1/domains/domain.engineering-architecture.yaml`, `catalog/project-memory/v1/domains/domain.data-analytics-ai.yaml`, `catalog/project-memory/v1/domains/domain.security-privacy-compliance-trust.yaml`, `catalog/project-memory/v1/domains/domain.qa-reliability-performance.yaml`, `catalog/project-memory/v1/domains/domain.growth-marketing-commercial.yaml`, `catalog/project-memory/v1/domains/domain.content-communications-localization.yaml`, `catalog/project-memory/v1/domains/domain.release-platform-operations.yaml`, `catalog/project-memory/v1/domains/domain.support-community.yaml`, `catalog/project-memory/v1/domains/domain.finance-legal-partnerships.yaml`, `catalog/project-memory/v1/domains/domain.game-design-art-audio-live-operations.yaml`
- Create: `catalog/project-memory/v1/inventories/domains.yaml`
- Modify: `tests/catalog/contracts/references.test.ts`

**Interfaces:**
- Consumes the Task 2 definition schema and Task 3 reference validator.
- Produces the exact 15-ID inventory below; every ID is active at `1.0.0`.
- Each definition includes purpose, inclusion/exclusion boundaries, defaults, document/record requirements, positive examples, and negative examples.

- [ ] **Step 1: Add the failing exact-inventory assertion**

```ts
expect(await inventoryIds("domains")).toEqual([
      "domain.governance-coordination",
      "domain.product-strategy",
      "domain.research-insight",
      "domain.ux-content-design",
      "domain.visual-brand-design-systems",
      "domain.engineering-architecture",
      "domain.data-analytics-ai",
      "domain.security-privacy-compliance-trust",
      "domain.qa-reliability-performance",
      "domain.growth-marketing-commercial",
      "domain.content-communications-localization",
      "domain.release-platform-operations",
      "domain.support-community",
      "domain.finance-legal-partnerships",
      "domain.game-design-art-audio-live-operations",
]);
```

- [ ] **Step 2: Prove the scoped test fails**

Run: `npm test -- tests/catalog/contracts/references.test.ts`

Expected: FAIL with missing definitions or inventory entries for this task's 15 IDs.

- [ ] **Step 3: Create every definition and its inventory entry**

Create exactly: `domain.governance-coordination`, `domain.product-strategy`, `domain.research-insight`, `domain.ux-content-design`, `domain.visual-brand-design-systems`, `domain.engineering-architecture`, `domain.data-analytics-ai`, `domain.security-privacy-compliance-trust`, `domain.qa-reliability-performance`, `domain.growth-marketing-commercial`, `domain.content-communications-localization`, `domain.release-platform-operations`, `domain.support-community`, `domain.finance-legal-partnerships`, `domain.game-design-art-audio-live-operations`. Keep IDs and filenames identical. Define deterministic compatibility/default references and both boundary example lists; do not leave empty descriptive fields.

- [ ] **Step 4: Validate the owned registry scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/domains --strict
npm test -- tests/catalog/contracts/references.test.ts
```

Expected: validator reports `15 active, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/domains catalog/project-memory/v1/inventories/domains.yaml tests/catalog/contracts/references.test.ts
git commit -m "feat(catalog): add domains registry"
```

### Task 11: Create Audience, Surface, Commercial, and Tenancy Overlays

**Files:**
- Create: `catalog/project-memory/v1/overlays/market-shape/overlay.audience.consumer.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.audience.b2b.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.audience.internal.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.audience.public-sector.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.audience.developer.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.surface.mobile.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.surface.web.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.surface.desktop.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.surface.cli.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.surface.api.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.surface.xr.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.surface.multisurface.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.commercial.free.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.commercial.paid.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.commercial.subscription.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.commercial.transactional.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.commercial.advertising.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.commercial.marketplace.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.commercial.managed-service.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.commercial.open-source.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.tenancy.single-tenant.yaml`, `catalog/project-memory/v1/overlays/market-shape/overlay.tenancy.multi-tenant.yaml`
- Create: `catalog/project-memory/v1/inventories/overlays/market-shape.yaml`
- Modify: `tests/catalog/contracts/overlay-activation.test.ts`

**Interfaces:**
- Consumes the Task 2 definition schema and Task 3 reference validator.
- Produces the exact 22-ID inventory below; every ID is active at `1.0.0`.
- Each definition includes purpose, inclusion/exclusion boundaries, defaults, document/record requirements, positive examples, and negative examples.

- [ ] **Step 1: Add the failing exact-inventory assertion**

```ts
expect(await inventoryIds("overlays/market-shape")).toEqual([
      "overlay.audience.consumer",
      "overlay.audience.b2b",
      "overlay.audience.internal",
      "overlay.audience.public-sector",
      "overlay.audience.developer",
      "overlay.surface.mobile",
      "overlay.surface.web",
      "overlay.surface.desktop",
      "overlay.surface.cli",
      "overlay.surface.api",
      "overlay.surface.xr",
      "overlay.surface.multisurface",
      "overlay.commercial.free",
      "overlay.commercial.paid",
      "overlay.commercial.subscription",
      "overlay.commercial.transactional",
      "overlay.commercial.advertising",
      "overlay.commercial.marketplace",
      "overlay.commercial.managed-service",
      "overlay.commercial.open-source",
      "overlay.tenancy.single-tenant",
      "overlay.tenancy.multi-tenant",
]);
```

- [ ] **Step 2: Prove the scoped test fails**

Run: `npm test -- tests/catalog/contracts/overlay-activation.test.ts`

Expected: FAIL with missing definitions or inventory entries for this task's 22 IDs.

- [ ] **Step 3: Create every definition and its inventory entry**

Create exactly: `overlay.audience.consumer`, `overlay.audience.b2b`, `overlay.audience.internal`, `overlay.audience.public-sector`, `overlay.audience.developer`, `overlay.surface.mobile`, `overlay.surface.web`, `overlay.surface.desktop`, `overlay.surface.cli`, `overlay.surface.api`, `overlay.surface.xr`, `overlay.surface.multisurface`, `overlay.commercial.free`, `overlay.commercial.paid`, `overlay.commercial.subscription`, `overlay.commercial.transactional`, `overlay.commercial.advertising`, `overlay.commercial.marketplace`, `overlay.commercial.managed-service`, `overlay.commercial.open-source`, `overlay.tenancy.single-tenant`, `overlay.tenancy.multi-tenant`. Keep IDs and filenames identical. Define deterministic compatibility/default references and both boundary example lists; do not leave empty descriptive fields.

- [ ] **Step 4: Validate the owned registry scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/overlays/market-shape --strict
npm test -- tests/catalog/contracts/overlay-activation.test.ts
```

Expected: validator reports `22 active, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/overlays/market-shape catalog/project-memory/v1/inventories/overlays/market-shape.yaml tests/catalog/contracts/overlay-activation.test.ts
git commit -m "feat(catalog): add overlays market-shape registry"
```

### Task 12: Create Capability, Runtime, Risk, Lifecycle, and Distribution Overlays

**Files:**
- Create: `catalog/project-memory/v1/overlays/operating-shape/overlay.runtime.offline-capable.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.runtime.realtime.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.runtime.high-availability.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.runtime.hosted.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.runtime.self-hosted.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.capability.authentication.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.capability.ai.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.capability.community-ugc.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.capability.payments.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.capability.personal-data.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.risk.sensitive-data.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.risk.regulated.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.risk.child-directed.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.risk.financial-value.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.lifecycle.prototype.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.lifecycle.active.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.lifecycle.legacy.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.lifecycle.migration.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.lifecycle.retiring.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.distribution.app-store.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.distribution.play-store.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.distribution.public-web.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.distribution.enterprise.yaml`, `catalog/project-memory/v1/overlays/operating-shape/overlay.distribution.package-registry.yaml`
- Create: `catalog/project-memory/v1/inventories/overlays/operating-shape.yaml`
- Modify: `tests/catalog/contracts/overlay-activation.test.ts`

**Interfaces:**
- Consumes the Task 2 definition schema and Task 3 reference validator.
- Produces the exact 24-ID inventory below; every ID is active at `1.0.0`.
- Each definition includes purpose, inclusion/exclusion boundaries, defaults, document/record requirements, positive examples, and negative examples.

- [ ] **Step 1: Add the failing exact-inventory assertion**

```ts
expect(await inventoryIds("overlays/operating-shape")).toEqual([
      "overlay.runtime.offline-capable",
      "overlay.runtime.realtime",
      "overlay.runtime.high-availability",
      "overlay.runtime.hosted",
      "overlay.runtime.self-hosted",
      "overlay.capability.authentication",
      "overlay.capability.ai",
      "overlay.capability.community-ugc",
      "overlay.capability.payments",
      "overlay.capability.personal-data",
      "overlay.risk.sensitive-data",
      "overlay.risk.regulated",
      "overlay.risk.child-directed",
      "overlay.risk.financial-value",
      "overlay.lifecycle.prototype",
      "overlay.lifecycle.active",
      "overlay.lifecycle.legacy",
      "overlay.lifecycle.migration",
      "overlay.lifecycle.retiring",
      "overlay.distribution.app-store",
      "overlay.distribution.play-store",
      "overlay.distribution.public-web",
      "overlay.distribution.enterprise",
      "overlay.distribution.package-registry",
]);
```

- [ ] **Step 2: Prove the scoped test fails**

Run: `npm test -- tests/catalog/contracts/overlay-activation.test.ts`

Expected: FAIL with missing definitions or inventory entries for this task's 24 IDs.

- [ ] **Step 3: Create every definition and its inventory entry**

Create exactly: `overlay.runtime.offline-capable`, `overlay.runtime.realtime`, `overlay.runtime.high-availability`, `overlay.runtime.hosted`, `overlay.runtime.self-hosted`, `overlay.capability.authentication`, `overlay.capability.ai`, `overlay.capability.community-ugc`, `overlay.capability.payments`, `overlay.capability.personal-data`, `overlay.risk.sensitive-data`, `overlay.risk.regulated`, `overlay.risk.child-directed`, `overlay.risk.financial-value`, `overlay.lifecycle.prototype`, `overlay.lifecycle.active`, `overlay.lifecycle.legacy`, `overlay.lifecycle.migration`, `overlay.lifecycle.retiring`, `overlay.distribution.app-store`, `overlay.distribution.play-store`, `overlay.distribution.public-web`, `overlay.distribution.enterprise`, `overlay.distribution.package-registry`. Keep IDs and filenames identical. Define deterministic compatibility/default references and both boundary example lists; do not leave empty descriptive fields.

- [ ] **Step 4: Validate the owned registry scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/overlays/operating-shape --strict
npm test -- tests/catalog/contracts/overlay-activation.test.ts
```

Expected: validator reports `24 active, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/overlays/operating-shape catalog/project-memory/v1/inventories/overlays/operating-shape.yaml tests/catalog/contracts/overlay-activation.test.ts
git commit -m "feat(catalog): add overlays operating-shape registry"
```

### Task 13: Create Agent Tool Adapters

**Files:**
- Create: `catalog/project-memory/v1/adapters/agent/adapter.codex.yaml`, `catalog/project-memory/v1/adapters/agent/adapter.claude-code.yaml`
- Create: `catalog/project-memory/v1/inventories/adapters/agent.yaml`
- Modify: `tests/catalog/contracts/adapter-contract.test.ts`

**Interfaces:**
- Consumes the Task 2 definition schema and Task 3 reference validator.
- Produces the exact 2-ID inventory below; every ID is active at `1.0.0`.
- Each definition includes purpose, inclusion/exclusion boundaries, defaults, document/record requirements, positive examples, and negative examples.

- [ ] **Step 1: Add the failing exact-inventory assertion**

```ts
expect(await inventoryIds("adapters/agent")).toEqual([
      "adapter.codex",
      "adapter.claude-code",
]);
```

- [ ] **Step 2: Prove the scoped test fails**

Run: `npm test -- tests/catalog/contracts/adapter-contract.test.ts`

Expected: FAIL with missing definitions or inventory entries for this task's 2 IDs.

- [ ] **Step 3: Create every definition and its inventory entry**

Create exactly: `adapter.codex`, `adapter.claude-code`. Keep IDs and filenames identical. Define deterministic compatibility/default references and both boundary example lists; do not leave empty descriptive fields.

- [ ] **Step 4: Validate the owned registry scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/adapters/agent --strict
npm test -- tests/catalog/contracts/adapter-contract.test.ts
```

Expected: validator reports `2 active, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/adapters/agent catalog/project-memory/v1/inventories/adapters/agent.yaml tests/catalog/contracts/adapter-contract.test.ts
git commit -m "feat(catalog): add adapters agent registry"
```

### Task 14: Create Runtime and Framework Adapters

**Files:**
- Create: `catalog/project-memory/v1/adapters/runtime/adapter.flutter.yaml`, `catalog/project-memory/v1/adapters/runtime/adapter.firebase.yaml`, `catalog/project-memory/v1/adapters/runtime/adapter.unity.yaml`, `catalog/project-memory/v1/adapters/runtime/adapter.react-nextjs.yaml`, `catalog/project-memory/v1/adapters/runtime/adapter.ios.yaml`, `catalog/project-memory/v1/adapters/runtime/adapter.android.yaml`, `catalog/project-memory/v1/adapters/runtime/adapter.node-typescript.yaml`, `catalog/project-memory/v1/adapters/runtime/adapter.python-data-ai.yaml`
- Create: `catalog/project-memory/v1/inventories/adapters/runtime.yaml`
- Modify: `tests/catalog/contracts/adapter-contract.test.ts`

**Interfaces:**
- Consumes the Task 2 definition schema and Task 3 reference validator.
- Produces the exact 8-ID inventory below; every ID is active at `1.0.0`.
- Each definition includes purpose, inclusion/exclusion boundaries, defaults, document/record requirements, positive examples, and negative examples.

- [ ] **Step 1: Add the failing exact-inventory assertion**

```ts
expect(await inventoryIds("adapters/runtime")).toEqual([
      "adapter.flutter",
      "adapter.firebase",
      "adapter.unity",
      "adapter.react-nextjs",
      "adapter.ios",
      "adapter.android",
      "adapter.node-typescript",
      "adapter.python-data-ai",
]);
```

- [ ] **Step 2: Prove the scoped test fails**

Run: `npm test -- tests/catalog/contracts/adapter-contract.test.ts`

Expected: FAIL with missing definitions or inventory entries for this task's 8 IDs.

- [ ] **Step 3: Create every definition and its inventory entry**

Create exactly: `adapter.flutter`, `adapter.firebase`, `adapter.unity`, `adapter.react-nextjs`, `adapter.ios`, `adapter.android`, `adapter.node-typescript`, `adapter.python-data-ai`. Keep IDs and filenames identical. Define deterministic compatibility/default references and both boundary example lists; do not leave empty descriptive fields.

- [ ] **Step 4: Validate the owned registry scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/adapters/runtime --strict
npm test -- tests/catalog/contracts/adapter-contract.test.ts
```

Expected: validator reports `8 active, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/adapters/runtime catalog/project-memory/v1/inventories/adapters/runtime.yaml tests/catalog/contracts/adapter-contract.test.ts
git commit -m "feat(catalog): add adapters runtime registry"
```

### Task 15: Create Workflow Tool Adapters

**Files:**
- Create: `catalog/project-memory/v1/adapters/workflow/adapter.figma.yaml`, `catalog/project-memory/v1/adapters/workflow/adapter.notion.yaml`, `catalog/project-memory/v1/adapters/workflow/adapter.maestro.yaml`, `catalog/project-memory/v1/adapters/workflow/adapter.playwright.yaml`, `catalog/project-memory/v1/adapters/workflow/adapter.github-ci.yaml`
- Create: `catalog/project-memory/v1/inventories/adapters/workflow.yaml`
- Modify: `tests/catalog/contracts/adapter-contract.test.ts`

**Interfaces:**
- Consumes the Task 2 definition schema and Task 3 reference validator.
- Produces the exact 5-ID inventory below; every ID is active at `1.0.0`.
- Each definition includes purpose, inclusion/exclusion boundaries, defaults, document/record requirements, positive examples, and negative examples.

- [ ] **Step 1: Add the failing exact-inventory assertion**

```ts
expect(await inventoryIds("adapters/workflow")).toEqual([
      "adapter.figma",
      "adapter.notion",
      "adapter.maestro",
      "adapter.playwright",
      "adapter.github-ci",
]);
```

- [ ] **Step 2: Prove the scoped test fails**

Run: `npm test -- tests/catalog/contracts/adapter-contract.test.ts`

Expected: FAIL with missing definitions or inventory entries for this task's 5 IDs.

- [ ] **Step 3: Create every definition and its inventory entry**

Create exactly: `adapter.figma`, `adapter.notion`, `adapter.maestro`, `adapter.playwright`, `adapter.github-ci`. Keep IDs and filenames identical. Define deterministic compatibility/default references and both boundary example lists; do not leave empty descriptive fields.

- [ ] **Step 4: Validate the owned registry scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/adapters/workflow --strict
npm test -- tests/catalog/contracts/adapter-contract.test.ts
```

Expected: validator reports `5 active, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/adapters/workflow catalog/project-memory/v1/inventories/adapters/workflow.yaml tests/catalog/contracts/adapter-contract.test.ts
git commit -m "feat(catalog): add adapters workflow registry"
```

## Blueprint Content Task Contract

Tasks 16-26 each create one blueprint-group definition, all blueprints in that group, and one positive plus one anti fixture per blueprint. The paired fixtures account for 124 of the required 150 fixtures.

Representative blueprint fixture pair:

```yaml
fixture:
  id: fixture.application.consumer-mobile.positive
  kind: blueprint-positive
  normalized_features:
    root_kind: product
    audience: consumer
    surfaces: [mobile]
  expected:
    decision: selected
    blueprint_id: application.consumer-mobile
    prohibited_blueprint_ids: [developer.sdk-library]
    reason_codes: [required-signals-satisfied]
---
fixture:
  id: fixture.application.consumer-mobile.anti
  kind: blueprint-anti
  normalized_features:
    root_kind: product
    audience: developer
    deliverable: reusable-sdk
  expected:
    decision: rejected
    blueprint_id: application.consumer-mobile
    reason_codes: [exclusion-matched]
```

Catalog tests validate fixture syntax, references, expected outcomes, and one-to-one positive/anti coverage. Executable selection is not called until Task 45.

### Task 16: Author the blueprint-group.application-service Group

**Files:**
- Create: `catalog/project-memory/v1/blueprint-groups/blueprint-group.application-service.yaml`
- Create: `catalog/project-memory/v1/blueprints/application-service/application.consumer-mobile.yaml`, `catalog/project-memory/v1/blueprints/application-service/application.consumer-multisurface.yaml`, `catalog/project-memory/v1/blueprints/application-service/application.b2b-saas.yaml`, `catalog/project-memory/v1/blueprints/application-service/application.internal-business.yaml`, `catalog/project-memory/v1/blueprints/application-service/application.desktop.yaml`, `catalog/project-memory/v1/blueprints/application-service/application.public-web-service.yaml`, `catalog/project-memory/v1/blueprints/application-service/application.creator-professional.yaml`, `catalog/project-memory/v1/blueprints/application-service/service.managed.yaml`
- Create: `catalog/project-memory/v1/fixtures/blueprints/application-service/<blueprint-id>.positive.yaml` for all 8 IDs
- Create: `catalog/project-memory/v1/fixtures/blueprints/application-service/<blueprint-id>.anti.yaml` for all 8 IDs
- Modify: `catalog/project-memory/v1/inventories/blueprints/blueprint-group.application-service.yaml`
- Modify: `tests/catalog/contracts/blueprint-mapping.test.ts`

**Interfaces:**
- Group primary archetype is `application-service`; allowed root kinds are `product`.
- Produces 8 active blueprints and 16 paired fixtures.
- Fixtures store normalized inputs and expected outcomes only; they do not encode scoring algorithms.

- [ ] **Step 1: Add the failing exact group assertion**

```ts
expect(await blueprintIds("blueprint-group.application-service")).toEqual([
      "application.consumer-mobile",
      "application.consumer-multisurface",
      "application.b2b-saas",
      "application.internal-business",
      "application.desktop",
      "application.public-web-service",
      "application.creator-professional",
      "service.managed",
]);
expect(await pairedFixtureCount("application-service")).toBe(16);
```

- [ ] **Step 2: Prove the group test fails**

Run: `npm test -- tests/catalog/contracts/blueprint-mapping.test.ts`

Expected: FAIL with missing group, blueprint, and paired-fixture entries.

- [ ] **Step 3: Author every blueprint and fixture pair**

Create exactly `application.consumer-mobile`, `application.consumer-multisurface`, `application.b2b-saas`, `application.internal-business`, `application.desktop`, `application.public-web-service`, `application.creator-professional`, `service.managed`. Each blueprint supplies complete selection signals, exclusions, overlays, component/domain/adapter defaults, documents, gates, and examples. Each positive fixture must select its blueprint; each anti fixture must reject it and name the exclusion reason.

- [ ] **Step 4: Validate this group**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/blueprints/application-service --strict
npm run catalog:fixtures -- --scope application-service --schema-only
npm test -- tests/catalog/contracts/blueprint-mapping.test.ts
```

Expected: `8 blueprints, 16 fixtures, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/blueprint-groups/blueprint-group.application-service.yaml catalog/project-memory/v1/blueprints/application-service catalog/project-memory/v1/fixtures/blueprints/application-service catalog/project-memory/v1/inventories/blueprints/blueprint-group.application-service.yaml tests/catalog/contracts/blueprint-mapping.test.ts
git commit -m "feat(catalog): add application-service blueprints"
```

### Task 17: Author the blueprint-group.developer-platform Group

**Files:**
- Create: `catalog/project-memory/v1/blueprint-groups/blueprint-group.developer-platform.yaml`
- Create: `catalog/project-memory/v1/blueprints/developer-platform/developer.api-product.yaml`, `catalog/project-memory/v1/blueprints/developer-platform/developer.sdk-library.yaml`, `catalog/project-memory/v1/blueprints/developer-platform/developer.cli-tool.yaml`, `catalog/project-memory/v1/blueprints/developer-platform/developer.shared-infrastructure.yaml`, `catalog/project-memory/v1/blueprints/developer-platform/developer.integration-ecosystem.yaml`, `catalog/project-memory/v1/blueprints/developer-platform/developer.open-source.yaml`
- Create: `catalog/project-memory/v1/fixtures/blueprints/developer-platform/<blueprint-id>.positive.yaml` for all 6 IDs
- Create: `catalog/project-memory/v1/fixtures/blueprints/developer-platform/<blueprint-id>.anti.yaml` for all 6 IDs
- Modify: `catalog/project-memory/v1/inventories/blueprints/blueprint-group.developer-platform.yaml`
- Modify: `tests/catalog/contracts/blueprint-mapping.test.ts`

**Interfaces:**
- Group primary archetype is `developer-platform`; allowed root kinds are `product`, `shared-system`.
- Produces 6 active blueprints and 12 paired fixtures.
- Fixtures store normalized inputs and expected outcomes only; they do not encode scoring algorithms.

- [ ] **Step 1: Add the failing exact group assertion**

```ts
expect(await blueprintIds("blueprint-group.developer-platform")).toEqual([
      "developer.api-product",
      "developer.sdk-library",
      "developer.cli-tool",
      "developer.shared-infrastructure",
      "developer.integration-ecosystem",
      "developer.open-source",
]);
expect(await pairedFixtureCount("developer-platform")).toBe(12);
```

- [ ] **Step 2: Prove the group test fails**

Run: `npm test -- tests/catalog/contracts/blueprint-mapping.test.ts`

Expected: FAIL with missing group, blueprint, and paired-fixture entries.

- [ ] **Step 3: Author every blueprint and fixture pair**

Create exactly `developer.api-product`, `developer.sdk-library`, `developer.cli-tool`, `developer.shared-infrastructure`, `developer.integration-ecosystem`, `developer.open-source`. Each blueprint supplies complete selection signals, exclusions, overlays, component/domain/adapter defaults, documents, gates, and examples. Each positive fixture must select its blueprint; each anti fixture must reject it and name the exclusion reason.

- [ ] **Step 4: Validate this group**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/blueprints/developer-platform --strict
npm run catalog:fixtures -- --scope developer-platform --schema-only
npm test -- tests/catalog/contracts/blueprint-mapping.test.ts
```

Expected: `6 blueprints, 12 fixtures, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/blueprint-groups/blueprint-group.developer-platform.yaml catalog/project-memory/v1/blueprints/developer-platform catalog/project-memory/v1/fixtures/blueprints/developer-platform catalog/project-memory/v1/inventories/blueprints/blueprint-group.developer-platform.yaml tests/catalog/contracts/blueprint-mapping.test.ts
git commit -m "feat(catalog): add developer-platform blueprints"
```

### Task 18: Author the blueprint-group.game-interactive Group

**Files:**
- Create: `catalog/project-memory/v1/blueprint-groups/blueprint-group.game-interactive.yaml`
- Create: `catalog/project-memory/v1/blueprints/game-interactive/game.premium-single-player.yaml`, `catalog/project-memory/v1/blueprints/game-interactive/game.casual-mobile.yaml`, `catalog/project-memory/v1/blueprints/game-interactive/game.free-to-play-live-service.yaml`, `catalog/project-memory/v1/blueprints/game-interactive/game.multiplayer-networked.yaml`, `catalog/project-memory/v1/blueprints/game-interactive/game.simulation-learning.yaml`, `catalog/project-memory/v1/blueprints/game-interactive/game.xr-immersive.yaml`
- Create: `catalog/project-memory/v1/fixtures/blueprints/game-interactive/<blueprint-id>.positive.yaml` for all 6 IDs
- Create: `catalog/project-memory/v1/fixtures/blueprints/game-interactive/<blueprint-id>.anti.yaml` for all 6 IDs
- Modify: `catalog/project-memory/v1/inventories/blueprints/blueprint-group.game-interactive.yaml`
- Modify: `tests/catalog/contracts/blueprint-mapping.test.ts`

**Interfaces:**
- Group primary archetype is `game-interactive`; allowed root kinds are `product`.
- Produces 6 active blueprints and 12 paired fixtures.
- Fixtures store normalized inputs and expected outcomes only; they do not encode scoring algorithms.

- [ ] **Step 1: Add the failing exact group assertion**

```ts
expect(await blueprintIds("blueprint-group.game-interactive")).toEqual([
      "game.premium-single-player",
      "game.casual-mobile",
      "game.free-to-play-live-service",
      "game.multiplayer-networked",
      "game.simulation-learning",
      "game.xr-immersive",
]);
expect(await pairedFixtureCount("game-interactive")).toBe(12);
```

- [ ] **Step 2: Prove the group test fails**

Run: `npm test -- tests/catalog/contracts/blueprint-mapping.test.ts`

Expected: FAIL with missing group, blueprint, and paired-fixture entries.

- [ ] **Step 3: Author every blueprint and fixture pair**

Create exactly `game.premium-single-player`, `game.casual-mobile`, `game.free-to-play-live-service`, `game.multiplayer-networked`, `game.simulation-learning`, `game.xr-immersive`. Each blueprint supplies complete selection signals, exclusions, overlays, component/domain/adapter defaults, documents, gates, and examples. Each positive fixture must select its blueprint; each anti fixture must reject it and name the exclusion reason.

- [ ] **Step 4: Validate this group**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/blueprints/game-interactive --strict
npm run catalog:fixtures -- --scope game-interactive --schema-only
npm test -- tests/catalog/contracts/blueprint-mapping.test.ts
```

Expected: `6 blueprints, 12 fixtures, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/blueprint-groups/blueprint-group.game-interactive.yaml catalog/project-memory/v1/blueprints/game-interactive catalog/project-memory/v1/fixtures/blueprints/game-interactive catalog/project-memory/v1/inventories/blueprints/blueprint-group.game-interactive.yaml tests/catalog/contracts/blueprint-mapping.test.ts
git commit -m "feat(catalog): add game-interactive blueprints"
```

### Task 19: Author the blueprint-group.ai-data Group

**Files:**
- Create: `catalog/project-memory/v1/blueprint-groups/blueprint-group.ai-data.yaml`
- Create: `catalog/project-memory/v1/blueprints/ai-data/ai.assistant-agent.yaml`, `catalog/project-memory/v1/blueprints/ai-data/ai.model-service.yaml`, `catalog/project-memory/v1/blueprints/ai-data/ai.analytics-decision-support.yaml`, `catalog/project-memory/v1/blueprints/ai-data/ai.data-platform.yaml`, `catalog/project-memory/v1/blueprints/ai-data/ai.benchmark-evaluation.yaml`, `catalog/project-memory/v1/blueprints/ai-data/ai.recommendation-personalization.yaml`
- Create: `catalog/project-memory/v1/fixtures/blueprints/ai-data/<blueprint-id>.positive.yaml` for all 6 IDs
- Create: `catalog/project-memory/v1/fixtures/blueprints/ai-data/<blueprint-id>.anti.yaml` for all 6 IDs
- Modify: `catalog/project-memory/v1/inventories/blueprints/blueprint-group.ai-data.yaml`
- Modify: `tests/catalog/contracts/blueprint-mapping.test.ts`

**Interfaces:**
- Group primary archetype is `ai-data`; allowed root kinds are `product`, `shared-system`.
- Produces 6 active blueprints and 12 paired fixtures.
- Fixtures store normalized inputs and expected outcomes only; they do not encode scoring algorithms.

- [ ] **Step 1: Add the failing exact group assertion**

```ts
expect(await blueprintIds("blueprint-group.ai-data")).toEqual([
      "ai.assistant-agent",
      "ai.model-service",
      "ai.analytics-decision-support",
      "ai.data-platform",
      "ai.benchmark-evaluation",
      "ai.recommendation-personalization",
]);
expect(await pairedFixtureCount("ai-data")).toBe(12);
```

- [ ] **Step 2: Prove the group test fails**

Run: `npm test -- tests/catalog/contracts/blueprint-mapping.test.ts`

Expected: FAIL with missing group, blueprint, and paired-fixture entries.

- [ ] **Step 3: Author every blueprint and fixture pair**

Create exactly `ai.assistant-agent`, `ai.model-service`, `ai.analytics-decision-support`, `ai.data-platform`, `ai.benchmark-evaluation`, `ai.recommendation-personalization`. Each blueprint supplies complete selection signals, exclusions, overlays, component/domain/adapter defaults, documents, gates, and examples. Each positive fixture must select its blueprint; each anti fixture must reject it and name the exclusion reason.

- [ ] **Step 4: Validate this group**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/blueprints/ai-data --strict
npm run catalog:fixtures -- --scope ai-data --schema-only
npm test -- tests/catalog/contracts/blueprint-mapping.test.ts
```

Expected: `6 blueprints, 12 fixtures, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/blueprint-groups/blueprint-group.ai-data.yaml catalog/project-memory/v1/blueprints/ai-data catalog/project-memory/v1/fixtures/blueprints/ai-data catalog/project-memory/v1/inventories/blueprints/blueprint-group.ai-data.yaml tests/catalog/contracts/blueprint-mapping.test.ts
git commit -m "feat(catalog): add ai-data blueprints"
```

### Task 20: Author the blueprint-group.commerce-network Group

**Files:**
- Create: `catalog/project-memory/v1/blueprint-groups/blueprint-group.commerce-network.yaml`
- Create: `catalog/project-memory/v1/blueprints/commerce-network/commerce.ecommerce.yaml`, `catalog/project-memory/v1/blueprints/commerce-network/commerce.two-sided-marketplace.yaml`, `catalog/project-memory/v1/blueprints/commerce-network/commerce.booking-reservation.yaml`, `catalog/project-memory/v1/blueprints/commerce-network/network.community-social.yaml`, `catalog/project-memory/v1/blueprints/commerce-network/commerce.membership.yaml`, `catalog/project-memory/v1/blueprints/commerce-network/network.multi-party-transaction.yaml`
- Create: `catalog/project-memory/v1/fixtures/blueprints/commerce-network/<blueprint-id>.positive.yaml` for all 6 IDs
- Create: `catalog/project-memory/v1/fixtures/blueprints/commerce-network/<blueprint-id>.anti.yaml` for all 6 IDs
- Modify: `catalog/project-memory/v1/inventories/blueprints/blueprint-group.commerce-network.yaml`
- Modify: `tests/catalog/contracts/blueprint-mapping.test.ts`

**Interfaces:**
- Group primary archetype is `commerce-network`; allowed root kinds are `product`.
- Produces 6 active blueprints and 12 paired fixtures.
- Fixtures store normalized inputs and expected outcomes only; they do not encode scoring algorithms.

- [ ] **Step 1: Add the failing exact group assertion**

```ts
expect(await blueprintIds("blueprint-group.commerce-network")).toEqual([
      "commerce.ecommerce",
      "commerce.two-sided-marketplace",
      "commerce.booking-reservation",
      "network.community-social",
      "commerce.membership",
      "network.multi-party-transaction",
]);
expect(await pairedFixtureCount("commerce-network")).toBe(12);
```

- [ ] **Step 2: Prove the group test fails**

Run: `npm test -- tests/catalog/contracts/blueprint-mapping.test.ts`

Expected: FAIL with missing group, blueprint, and paired-fixture entries.

- [ ] **Step 3: Author every blueprint and fixture pair**

Create exactly `commerce.ecommerce`, `commerce.two-sided-marketplace`, `commerce.booking-reservation`, `network.community-social`, `commerce.membership`, `network.multi-party-transaction`. Each blueprint supplies complete selection signals, exclusions, overlays, component/domain/adapter defaults, documents, gates, and examples. Each positive fixture must select its blueprint; each anti fixture must reject it and name the exclusion reason.

- [ ] **Step 4: Validate this group**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/blueprints/commerce-network --strict
npm run catalog:fixtures -- --scope commerce-network --schema-only
npm test -- tests/catalog/contracts/blueprint-mapping.test.ts
```

Expected: `6 blueprints, 12 fixtures, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/blueprint-groups/blueprint-group.commerce-network.yaml catalog/project-memory/v1/blueprints/commerce-network catalog/project-memory/v1/fixtures/blueprints/commerce-network catalog/project-memory/v1/inventories/blueprints/blueprint-group.commerce-network.yaml tests/catalog/contracts/blueprint-mapping.test.ts
git commit -m "feat(catalog): add commerce-network blueprints"
```

### Task 21: Author the blueprint-group.content-learning Group

**Files:**
- Create: `catalog/project-memory/v1/blueprint-groups/blueprint-group.content-learning.yaml`
- Create: `catalog/project-memory/v1/blueprints/content-learning/content.publication-newsletter.yaml`, `catalog/project-memory/v1/blueprints/content-learning/content.podcast-video-channel.yaml`, `catalog/project-memory/v1/blueprints/content-learning/content.media-library.yaml`, `catalog/project-memory/v1/blueprints/content-learning/learning.course-curriculum.yaml`, `catalog/project-memory/v1/blueprints/content-learning/content.documentation-portal.yaml`, `catalog/project-memory/v1/blueprints/content-learning/content.creator-property.yaml`
- Create: `catalog/project-memory/v1/fixtures/blueprints/content-learning/<blueprint-id>.positive.yaml` for all 6 IDs
- Create: `catalog/project-memory/v1/fixtures/blueprints/content-learning/<blueprint-id>.anti.yaml` for all 6 IDs
- Modify: `catalog/project-memory/v1/inventories/blueprints/blueprint-group.content-learning.yaml`
- Modify: `tests/catalog/contracts/blueprint-mapping.test.ts`

**Interfaces:**
- Group primary archetype is `content-learning`; allowed root kinds are `product`, `shared-system`.
- Produces 6 active blueprints and 12 paired fixtures.
- Fixtures store normalized inputs and expected outcomes only; they do not encode scoring algorithms.

- [ ] **Step 1: Add the failing exact group assertion**

```ts
expect(await blueprintIds("blueprint-group.content-learning")).toEqual([
      "content.publication-newsletter",
      "content.podcast-video-channel",
      "content.media-library",
      "learning.course-curriculum",
      "content.documentation-portal",
      "content.creator-property",
]);
expect(await pairedFixtureCount("content-learning")).toBe(12);
```

- [ ] **Step 2: Prove the group test fails**

Run: `npm test -- tests/catalog/contracts/blueprint-mapping.test.ts`

Expected: FAIL with missing group, blueprint, and paired-fixture entries.

- [ ] **Step 3: Author every blueprint and fixture pair**

Create exactly `content.publication-newsletter`, `content.podcast-video-channel`, `content.media-library`, `learning.course-curriculum`, `content.documentation-portal`, `content.creator-property`. Each blueprint supplies complete selection signals, exclusions, overlays, component/domain/adapter defaults, documents, gates, and examples. Each positive fixture must select its blueprint; each anti fixture must reject it and name the exclusion reason.

- [ ] **Step 4: Validate this group**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/blueprints/content-learning --strict
npm run catalog:fixtures -- --scope content-learning --schema-only
npm test -- tests/catalog/contracts/blueprint-mapping.test.ts
```

Expected: `6 blueprints, 12 fixtures, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/blueprint-groups/blueprint-group.content-learning.yaml catalog/project-memory/v1/blueprints/content-learning catalog/project-memory/v1/fixtures/blueprints/content-learning catalog/project-memory/v1/inventories/blueprints/blueprint-group.content-learning.yaml tests/catalog/contracts/blueprint-mapping.test.ts
git commit -m "feat(catalog): add content-learning blueprints"
```

### Task 22: Author the blueprint-group.brand-design Group

**Files:**
- Create: `catalog/project-memory/v1/blueprint-groups/blueprint-group.brand-design.yaml`
- Create: `catalog/project-memory/v1/blueprints/brand-design/design.brand-system.yaml`, `catalog/project-memory/v1/blueprints/brand-design/design.product-design-system.yaml`, `catalog/project-memory/v1/blueprints/brand-design/design.multi-brand-language.yaml`, `catalog/project-memory/v1/blueprints/brand-design/design.creative-asset-system.yaml`
- Create: `catalog/project-memory/v1/fixtures/blueprints/brand-design/<blueprint-id>.positive.yaml` for all 4 IDs
- Create: `catalog/project-memory/v1/fixtures/blueprints/brand-design/<blueprint-id>.anti.yaml` for all 4 IDs
- Modify: `catalog/project-memory/v1/inventories/blueprints/blueprint-group.brand-design.yaml`
- Modify: `tests/catalog/contracts/blueprint-mapping.test.ts`

**Interfaces:**
- Group primary archetype is `brand-design`; allowed root kinds are `shared-system`.
- Produces 4 active blueprints and 8 paired fixtures.
- Fixtures store normalized inputs and expected outcomes only; they do not encode scoring algorithms.

- [ ] **Step 1: Add the failing exact group assertion**

```ts
expect(await blueprintIds("blueprint-group.brand-design")).toEqual([
      "design.brand-system",
      "design.product-design-system",
      "design.multi-brand-language",
      "design.creative-asset-system",
]);
expect(await pairedFixtureCount("brand-design")).toBe(8);
```

- [ ] **Step 2: Prove the group test fails**

Run: `npm test -- tests/catalog/contracts/blueprint-mapping.test.ts`

Expected: FAIL with missing group, blueprint, and paired-fixture entries.

- [ ] **Step 3: Author every blueprint and fixture pair**

Create exactly `design.brand-system`, `design.product-design-system`, `design.multi-brand-language`, `design.creative-asset-system`. Each blueprint supplies complete selection signals, exclusions, overlays, component/domain/adapter defaults, documents, gates, and examples. Each positive fixture must select its blueprint; each anti fixture must reject it and name the exclusion reason.

- [ ] **Step 4: Validate this group**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/blueprints/brand-design --strict
npm run catalog:fixtures -- --scope brand-design --schema-only
npm test -- tests/catalog/contracts/blueprint-mapping.test.ts
```

Expected: `4 blueprints, 8 fixtures, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/blueprint-groups/blueprint-group.brand-design.yaml catalog/project-memory/v1/blueprints/brand-design catalog/project-memory/v1/fixtures/blueprints/brand-design catalog/project-memory/v1/inventories/blueprints/blueprint-group.brand-design.yaml tests/catalog/contracts/blueprint-mapping.test.ts
git commit -m "feat(catalog): add brand-design blueprints"
```

### Task 23: Author the blueprint-group.research-knowledge Group

**Files:**
- Create: `catalog/project-memory/v1/blueprint-groups/blueprint-group.research-knowledge.yaml`
- Create: `catalog/project-memory/v1/blueprints/research-knowledge/research.ongoing-program.yaml`, `catalog/project-memory/v1/blueprints/research-knowledge/research.evidence-corpus.yaml`, `catalog/project-memory/v1/blueprints/research-knowledge/research.market-intelligence.yaml`, `catalog/project-memory/v1/blueprints/research-knowledge/research.policy-standards.yaml`, `catalog/project-memory/v1/blueprints/research-knowledge/research.experimental-program.yaml`, `catalog/project-memory/v1/blueprints/research-knowledge/knowledge.organizational-base.yaml`
- Create: `catalog/project-memory/v1/fixtures/blueprints/research-knowledge/<blueprint-id>.positive.yaml` for all 6 IDs
- Create: `catalog/project-memory/v1/fixtures/blueprints/research-knowledge/<blueprint-id>.anti.yaml` for all 6 IDs
- Modify: `catalog/project-memory/v1/inventories/blueprints/blueprint-group.research-knowledge.yaml`
- Modify: `tests/catalog/contracts/blueprint-mapping.test.ts`

**Interfaces:**
- Group primary archetype is `research-knowledge`; allowed root kinds are `program`, `shared-system`.
- Produces 6 active blueprints and 12 paired fixtures.
- Fixtures store normalized inputs and expected outcomes only; they do not encode scoring algorithms.

- [ ] **Step 1: Add the failing exact group assertion**

```ts
expect(await blueprintIds("blueprint-group.research-knowledge")).toEqual([
      "research.ongoing-program",
      "research.evidence-corpus",
      "research.market-intelligence",
      "research.policy-standards",
      "research.experimental-program",
      "knowledge.organizational-base",
]);
expect(await pairedFixtureCount("research-knowledge")).toBe(12);
```

- [ ] **Step 2: Prove the group test fails**

Run: `npm test -- tests/catalog/contracts/blueprint-mapping.test.ts`

Expected: FAIL with missing group, blueprint, and paired-fixture entries.

- [ ] **Step 3: Author every blueprint and fixture pair**

Create exactly `research.ongoing-program`, `research.evidence-corpus`, `research.market-intelligence`, `research.policy-standards`, `research.experimental-program`, `knowledge.organizational-base`. Each blueprint supplies complete selection signals, exclusions, overlays, component/domain/adapter defaults, documents, gates, and examples. Each positive fixture must select its blueprint; each anti fixture must reject it and name the exclusion reason.

- [ ] **Step 4: Validate this group**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/blueprints/research-knowledge --strict
npm run catalog:fixtures -- --scope research-knowledge --schema-only
npm test -- tests/catalog/contracts/blueprint-mapping.test.ts
```

Expected: `6 blueprints, 12 fixtures, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/blueprint-groups/blueprint-group.research-knowledge.yaml catalog/project-memory/v1/blueprints/research-knowledge catalog/project-memory/v1/fixtures/blueprints/research-knowledge catalog/project-memory/v1/inventories/blueprints/blueprint-group.research-knowledge.yaml tests/catalog/contracts/blueprint-mapping.test.ts
git commit -m "feat(catalog): add research-knowledge blueprints"
```

### Task 24: Author the blueprint-group.operations-automation Group

**Files:**
- Create: `catalog/project-memory/v1/blueprint-groups/blueprint-group.operations-automation.yaml`
- Create: `catalog/project-memory/v1/blueprints/operations-automation/operations.sop-library.yaml`, `catalog/project-memory/v1/blueprints/operations-automation/operations.workflow-automation.yaml`, `catalog/project-memory/v1/blueprints/operations-automation/operations.support-service.yaml`, `catalog/project-memory/v1/blueprints/operations-automation/operations.marketing-growth.yaml`, `catalog/project-memory/v1/blueprints/operations-automation/operations.governance-compliance.yaml`, `catalog/project-memory/v1/blueprints/operations-automation/operations.business-process.yaml`
- Create: `catalog/project-memory/v1/fixtures/blueprints/operations-automation/<blueprint-id>.positive.yaml` for all 6 IDs
- Create: `catalog/project-memory/v1/fixtures/blueprints/operations-automation/<blueprint-id>.anti.yaml` for all 6 IDs
- Modify: `catalog/project-memory/v1/inventories/blueprints/blueprint-group.operations-automation.yaml`
- Modify: `tests/catalog/contracts/blueprint-mapping.test.ts`

**Interfaces:**
- Group primary archetype is `operations-automation`; allowed root kinds are `shared-system`, `program`.
- Produces 6 active blueprints and 12 paired fixtures.
- Fixtures store normalized inputs and expected outcomes only; they do not encode scoring algorithms.

- [ ] **Step 1: Add the failing exact group assertion**

```ts
expect(await blueprintIds("blueprint-group.operations-automation")).toEqual([
      "operations.sop-library",
      "operations.workflow-automation",
      "operations.support-service",
      "operations.marketing-growth",
      "operations.governance-compliance",
      "operations.business-process",
]);
expect(await pairedFixtureCount("operations-automation")).toBe(12);
```

- [ ] **Step 2: Prove the group test fails**

Run: `npm test -- tests/catalog/contracts/blueprint-mapping.test.ts`

Expected: FAIL with missing group, blueprint, and paired-fixture entries.

- [ ] **Step 3: Author every blueprint and fixture pair**

Create exactly `operations.sop-library`, `operations.workflow-automation`, `operations.support-service`, `operations.marketing-growth`, `operations.governance-compliance`, `operations.business-process`. Each blueprint supplies complete selection signals, exclusions, overlays, component/domain/adapter defaults, documents, gates, and examples. Each positive fixture must select its blueprint; each anti fixture must reject it and name the exclusion reason.

- [ ] **Step 4: Validate this group**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/blueprints/operations-automation --strict
npm run catalog:fixtures -- --scope operations-automation --schema-only
npm test -- tests/catalog/contracts/blueprint-mapping.test.ts
```

Expected: `6 blueprints, 12 fixtures, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/blueprint-groups/blueprint-group.operations-automation.yaml catalog/project-memory/v1/blueprints/operations-automation catalog/project-memory/v1/fixtures/blueprints/operations-automation catalog/project-memory/v1/inventories/blueprints/blueprint-group.operations-automation.yaml tests/catalog/contracts/blueprint-mapping.test.ts
git commit -m "feat(catalog): add operations-automation blueprints"
```

### Task 25: Author the blueprint-group.portfolio Group

**Files:**
- Create: `catalog/project-memory/v1/blueprint-groups/blueprint-group.portfolio.yaml`
- Create: `catalog/project-memory/v1/blueprints/portfolio/portfolio.product-family.yaml`, `catalog/project-memory/v1/blueprints/portfolio/portfolio.company-brand-ecosystem.yaml`, `catalog/project-memory/v1/blueprints/portfolio/portfolio.shared-platform.yaml`, `catalog/project-memory/v1/blueprints/portfolio/portfolio.franchise-white-label.yaml`, `catalog/project-memory/v1/blueprints/portfolio/program.organization-capability.yaml`
- Create: `catalog/project-memory/v1/fixtures/blueprints/portfolio/<blueprint-id>.positive.yaml` for all 5 IDs
- Create: `catalog/project-memory/v1/fixtures/blueprints/portfolio/<blueprint-id>.anti.yaml` for all 5 IDs
- Modify: `catalog/project-memory/v1/inventories/blueprints/blueprint-group.portfolio.yaml`
- Modify: `tests/catalog/contracts/blueprint-mapping.test.ts`

**Interfaces:**
- Group primary archetype is `portfolio`; allowed root kinds are `portfolio`, `program`.
- Produces 5 active blueprints and 10 paired fixtures.
- Fixtures store normalized inputs and expected outcomes only; they do not encode scoring algorithms.

- [ ] **Step 1: Add the failing exact group assertion**

```ts
expect(await blueprintIds("blueprint-group.portfolio")).toEqual([
      "portfolio.product-family",
      "portfolio.company-brand-ecosystem",
      "portfolio.shared-platform",
      "portfolio.franchise-white-label",
      "program.organization-capability",
]);
expect(await pairedFixtureCount("portfolio")).toBe(10);
```

- [ ] **Step 2: Prove the group test fails**

Run: `npm test -- tests/catalog/contracts/blueprint-mapping.test.ts`

Expected: FAIL with missing group, blueprint, and paired-fixture entries.

- [ ] **Step 3: Author every blueprint and fixture pair**

Create exactly `portfolio.product-family`, `portfolio.company-brand-ecosystem`, `portfolio.shared-platform`, `portfolio.franchise-white-label`, `program.organization-capability`. Each blueprint supplies complete selection signals, exclusions, overlays, component/domain/adapter defaults, documents, gates, and examples. Each positive fixture must select its blueprint; each anti fixture must reject it and name the exclusion reason.

- [ ] **Step 4: Validate this group**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/blueprints/portfolio --strict
npm run catalog:fixtures -- --scope portfolio --schema-only
npm test -- tests/catalog/contracts/blueprint-mapping.test.ts
```

Expected: `5 blueprints, 10 fixtures, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/blueprint-groups/blueprint-group.portfolio.yaml catalog/project-memory/v1/blueprints/portfolio catalog/project-memory/v1/fixtures/blueprints/portfolio catalog/project-memory/v1/inventories/blueprints/blueprint-group.portfolio.yaml tests/catalog/contracts/blueprint-mapping.test.ts
git commit -m "feat(catalog): add portfolio blueprints"
```

### Task 26: Author the blueprint-group.engagement Group

**Files:**
- Create: `catalog/project-memory/v1/blueprint-groups/blueprint-group.engagement.yaml`
- Create: `catalog/project-memory/v1/blueprints/engagement/engagement.client-delivery.yaml`, `catalog/project-memory/v1/blueprints/engagement/engagement.standalone-internal.yaml`, `catalog/project-memory/v1/blueprints/engagement/engagement.one-off-deliverable.yaml`
- Create: `catalog/project-memory/v1/fixtures/blueprints/engagement/<blueprint-id>.positive.yaml` for all 3 IDs
- Create: `catalog/project-memory/v1/fixtures/blueprints/engagement/<blueprint-id>.anti.yaml` for all 3 IDs
- Modify: `catalog/project-memory/v1/inventories/blueprints/blueprint-group.engagement.yaml`
- Modify: `tests/catalog/contracts/blueprint-mapping.test.ts`

**Interfaces:**
- Group primary archetype is `engagement`; allowed root kinds are `engagement`.
- Produces 3 active blueprints and 6 paired fixtures.
- Fixtures store normalized inputs and expected outcomes only; they do not encode scoring algorithms.

- [ ] **Step 1: Add the failing exact group assertion**

```ts
expect(await blueprintIds("blueprint-group.engagement")).toEqual([
      "engagement.client-delivery",
      "engagement.standalone-internal",
      "engagement.one-off-deliverable",
]);
expect(await pairedFixtureCount("engagement")).toBe(6);
```

- [ ] **Step 2: Prove the group test fails**

Run: `npm test -- tests/catalog/contracts/blueprint-mapping.test.ts`

Expected: FAIL with missing group, blueprint, and paired-fixture entries.

- [ ] **Step 3: Author every blueprint and fixture pair**

Create exactly `engagement.client-delivery`, `engagement.standalone-internal`, `engagement.one-off-deliverable`. Each blueprint supplies complete selection signals, exclusions, overlays, component/domain/adapter defaults, documents, gates, and examples. Each positive fixture must select its blueprint; each anti fixture must reject it and name the exclusion reason.

- [ ] **Step 4: Validate this group**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/blueprints/engagement --strict
npm run catalog:fixtures -- --scope engagement --schema-only
npm test -- tests/catalog/contracts/blueprint-mapping.test.ts
```

Expected: `3 blueprints, 6 fixtures, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/blueprint-groups/blueprint-group.engagement.yaml catalog/project-memory/v1/blueprints/engagement catalog/project-memory/v1/fixtures/blueprints/engagement catalog/project-memory/v1/inventories/blueprints/blueprint-group.engagement.yaml tests/catalog/contracts/blueprint-mapping.test.ts
git commit -m "feat(catalog): add engagement blueprints"
```

### Task 27: Add the 26 Cross-Boundary and Composite Blueprint Fixtures

**Files:**
- Create: `catalog/project-memory/v1/fixtures/boundaries/001.yaml` through `026.yaml`
- Modify: `tests/catalog/contracts/golden-fixtures.test.ts`

**Interfaces:**
- Adds the final 26 fixtures, bringing the blueprint fixture total to 150.
- Every fixture declares normalized features, selected or review-required outcome, competing IDs, prohibited IDs, and stable reason codes.
- Fixture 026 proves that campaign, security, UI/UX, and code-restructure workstreams remain inside the enduring LifeOf application root.

- [ ] **Step 1: Add the failing case-table assertion**

```ts
expect(await boundaryFixtureCases()).toEqual([
  ["001", "application.consumer-mobile", "developer.sdk-library"],
  ["002", "application.consumer-multisurface", "application.public-web-service"],
  ["003", "application.b2b-saas", "application.internal-business"],
  ["004", "application.desktop", "application.creator-professional"],
  ["005", "service.managed", "application.b2b-saas"],
  ["006", "developer.api-product", "developer.integration-ecosystem"],
  ["007", "developer.cli-tool", "developer.sdk-library"],
  ["008", "developer.shared-infrastructure", "developer.open-source"],
  ["009", "game.casual-mobile", "game.free-to-play-live-service"],
  ["010", "game.premium-single-player", "game.multiplayer-networked"],
  ["011", "game.simulation-learning", "game.xr-immersive"],
  ["012", "ai.assistant-agent", "ai.model-service"],
  ["013", "ai.analytics-decision-support", "ai.data-platform"],
  ["014", "ai.benchmark-evaluation", "ai.recommendation-personalization"],
  ["015", "commerce.ecommerce", "commerce.two-sided-marketplace"],
  ["016", "commerce.booking-reservation", "network.multi-party-transaction"],
  ["017", "commerce.membership", "network.community-social"],
  ["018", "content.publication-newsletter", "content.creator-property"],
  ["019", "content.media-library", "content.documentation-portal"],
  ["020", "learning.course-curriculum", "content.documentation-portal"],
  ["021", "design.brand-system", "design.product-design-system"],
  ["022", "research.ongoing-program", "research.evidence-corpus"],
  ["023", "operations.workflow-automation", "operations.business-process"],
  ["024", "portfolio.product-family", "portfolio.shared-platform"],
  ["025", "engagement.client-delivery", "application.b2b-saas"],
  ["026", "application.consumer-multisurface", "engagement.one-off-deliverable"],
]);
```

- [ ] **Step 2: Prove the boundary test fails**

Run: `npm test -- tests/catalog/contracts/golden-fixtures.test.ts`

Expected: FAIL because fixtures `001..026` are absent.

- [ ] **Step 3: Author the exact boundary scenarios**

- `001`: mobile app versus reusable SDK; expected primary `application.consumer-mobile`, explicit competitor `developer.sdk-library`.
- `002`: multi-surface product versus public web service; expected primary `application.consumer-multisurface`, explicit competitor `application.public-web-service`.
- `003`: B2B SaaS versus internal business app; expected primary `application.b2b-saas`, explicit competitor `application.internal-business`.
- `004`: desktop app versus creator tool; expected primary `application.desktop`, explicit competitor `application.creator-professional`.
- `005`: managed service versus B2B SaaS; expected primary `service.managed`, explicit competitor `application.b2b-saas`.
- `006`: API product versus integration ecosystem; expected primary `developer.api-product`, explicit competitor `developer.integration-ecosystem`.
- `007`: CLI tool versus SDK library; expected primary `developer.cli-tool`, explicit competitor `developer.sdk-library`.
- `008`: shared infrastructure versus open source product; expected primary `developer.shared-infrastructure`, explicit competitor `developer.open-source`.
- `009`: casual mobile game versus F2P live service; expected primary `game.casual-mobile`, explicit competitor `game.free-to-play-live-service`.
- `010`: premium single-player versus multiplayer game; expected primary `game.premium-single-player`, explicit competitor `game.multiplayer-networked`.
- `011`: simulation learning versus XR experience; expected primary `game.simulation-learning`, explicit competitor `game.xr-immersive`.
- `012`: assistant agent versus model service; expected primary `ai.assistant-agent`, explicit competitor `ai.model-service`.
- `013`: analytics support versus data platform; expected primary `ai.analytics-decision-support`, explicit competitor `ai.data-platform`.
- `014`: benchmark suite versus recommendation product; expected primary `ai.benchmark-evaluation`, explicit competitor `ai.recommendation-personalization`.
- `015`: ecommerce versus two-sided marketplace; expected primary `commerce.ecommerce`, explicit competitor `commerce.two-sided-marketplace`.
- `016`: booking platform versus multi-party transaction network; expected primary `commerce.booking-reservation`, explicit competitor `network.multi-party-transaction`.
- `017`: membership platform versus social community; expected primary `commerce.membership`, explicit competitor `network.community-social`.
- `018`: publication versus creator property; expected primary `content.publication-newsletter`, explicit competitor `content.creator-property`.
- `019`: media library versus documentation portal; expected primary `content.media-library`, explicit competitor `content.documentation-portal`.
- `020`: course curriculum versus content portal; expected primary `learning.course-curriculum`, explicit competitor `content.documentation-portal`.
- `021`: brand system versus product design system; expected primary `design.brand-system`, explicit competitor `design.product-design-system`.
- `022`: ongoing research program versus evidence corpus; expected primary `research.ongoing-program`, explicit competitor `research.evidence-corpus`.
- `023`: workflow automation versus business process; expected primary `operations.workflow-automation`, explicit competitor `operations.business-process`.
- `024`: product family versus shared platform portfolio; expected primary `portfolio.product-family`, explicit competitor `portfolio.shared-platform`.
- `025`: client engagement versus enduring product root; expected primary `engagement.client-delivery`, explicit competitor `application.b2b-saas`.
- `026`: LifeOf app with campaign security and UI work; expected primary `application.consumer-multisurface`, explicit competitor `engagement.one-off-deliverable`.

Use `review_required` only when the supplied feature set intentionally remains tied after exclusions; otherwise pin `selected` and the expected primary ID.

- [ ] **Step 4: Validate all 150 blueprint fixtures**

Run:

```powershell
npm run catalog:fixtures -- --suite blueprint --schema-only
npm test -- tests/catalog/contracts/golden-fixtures.test.ts
```

Expected: `62 positive, 62 anti, 26 boundary, 150 total, 0 invalid`; focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/fixtures/boundaries tests/catalog/contracts/golden-fixtures.test.ts
git commit -m "test(catalog): add blueprint boundary fixtures"
```

## Taxonomy Content Task Contract

Tasks 28-43 create only `*.taxonomy.yaml` files. The work-pattern plan independently creates matching `*.core.yaml` files. A taxonomy definition has exactly this shape:

```yaml
pattern_taxonomy:
  pattern_id: engineering.feature.implement
  pattern_version: 1.0.0
  compatibility:
    root_kinds: [product, shared-system]
    primary_archetypes: [application-service, developer-platform]
    required_overlays: []
    forbidden_overlays: []
  overlay_applicability:
    baked: []
    allowed: [overlay.lifecycle.active]
    forbidden: []
  component_impacts:
    - selector: { type: service }
      duties: [inspect, modify, validate, record]
      requirement: conditional
      condition: affected_paths_match_component
      reason: The selected service owns an affected path.
      write_scope: [resolved_component_paths]
      responsible_role: worker
  domain_impacts:
    - selector: { id: domain.engineering-architecture }
      duties: [inspect, validate, record]
      requirement: required
      condition: true
      reason: Engineering mutation requires architecture ownership and evidence.
      write_scope: []
      required_records: [worklog, evidence]
      responsible_role: validator
```

Each family also owns one schema/reference fixture at `fixtures/pattern-taxonomy/<family>.yaml`. It verifies exact ID coverage and representative compatibility/impact behavior without executing selection.

### Task 28: Author the governance Pattern Taxonomy Family (15)

**Files:**
- Create: `catalog/project-memory/v1/patterns/governance/governance.context.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/governance/governance.scope.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/governance/governance.task.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/governance/governance.claim.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/governance/governance.decision.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/governance/governance.evidence.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/governance/governance.handoff.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/governance/governance.integration.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/governance/governance.documentation.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/governance/governance.documentation.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/governance/governance.finding.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/governance/governance.archive.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/governance/governance.postmortem.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/governance/governance.profile.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/governance/governance.catalog.change.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/governance.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/governance.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 15 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("governance")).toEqual([
      "governance.context.assess",
      "governance.scope.plan",
      "governance.task.plan",
      "governance.claim.operate",
      "governance.decision.plan",
      "governance.evidence.validate",
      "governance.handoff.change",
      "governance.integration.change",
      "governance.documentation.change",
      "governance.documentation.validate",
      "governance.finding.change",
      "governance.archive.operate",
      "governance.postmortem.assess",
      "governance.profile.change",
      "governance.catalog.change",
]);
expect(await taxonomyFixtureCount("governance")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 15 missing `governance` taxonomy halves.

- [ ] **Step 3: Author all 15 taxonomy bindings**

Create exactly `governance.context.assess`, `governance.scope.plan`, `governance.task.plan`, `governance.claim.operate`, `governance.decision.plan`, `governance.evidence.validate`, `governance.handoff.change`, `governance.integration.change`, `governance.documentation.change`, `governance.documentation.validate`, `governance.finding.change`, `governance.archive.operate`, `governance.postmortem.assess`, `governance.profile.change`, `governance.catalog.change` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/governance --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `15 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/governance catalog/project-memory/v1/fixtures/pattern-taxonomy/governance.yaml catalog/project-memory/v1/inventories/patterns/governance.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add governance taxonomy bindings"
```

### Task 29: Author the product Pattern Taxonomy Family (16)

**Files:**
- Create: `catalog/project-memory/v1/patterns/product/product.discovery.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.opportunity.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.requirements.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.prd.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.prd.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.feature.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.acceptance.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.roadmap.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.rule.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.pricing.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.pricing.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.experiment.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.launch.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.policy.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.feature.retire.taxonomy.yaml`, `catalog/project-memory/v1/patterns/product/product.root.retire.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/product.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/product.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 16 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("product")).toEqual([
      "product.discovery.assess",
      "product.opportunity.assess",
      "product.requirements.plan",
      "product.prd.plan",
      "product.prd.change",
      "product.feature.design",
      "product.acceptance.validate",
      "product.roadmap.plan",
      "product.rule.change",
      "product.pricing.plan",
      "product.pricing.change",
      "product.experiment.plan",
      "product.launch.plan",
      "product.policy.change",
      "product.feature.retire",
      "product.root.retire",
]);
expect(await taxonomyFixtureCount("product")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 16 missing `product` taxonomy halves.

- [ ] **Step 3: Author all 16 taxonomy bindings**

Create exactly `product.discovery.assess`, `product.opportunity.assess`, `product.requirements.plan`, `product.prd.plan`, `product.prd.change`, `product.feature.design`, `product.acceptance.validate`, `product.roadmap.plan`, `product.rule.change`, `product.pricing.plan`, `product.pricing.change`, `product.experiment.plan`, `product.launch.plan`, `product.policy.change`, `product.feature.retire`, `product.root.retire` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/product --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `16 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/product catalog/project-memory/v1/fixtures/pattern-taxonomy/product.yaml catalog/project-memory/v1/inventories/patterns/product.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add product taxonomy bindings"
```

### Task 30: Author the engineering Pattern Taxonomy Family (22)

**Files:**
- Create: `catalog/project-memory/v1/patterns/engineering/engineering.feature.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.feature.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.bug.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.refactor.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.repository.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.architecture.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.architecture.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.code.retire.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.api.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.api.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.schema.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.schema.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.migration.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.migration.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.migration.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.integration.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.dependency.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.platform.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.configuration.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.feature-flag.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.build-tool.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/engineering/engineering.automation.implement.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/engineering.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/engineering.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 22 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("engineering")).toEqual([
      "engineering.feature.design",
      "engineering.feature.implement",
      "engineering.bug.implement",
      "engineering.refactor.implement",
      "engineering.repository.change",
      "engineering.architecture.design",
      "engineering.architecture.change",
      "engineering.code.retire",
      "engineering.api.design",
      "engineering.api.change",
      "engineering.schema.design",
      "engineering.schema.change",
      "engineering.migration.plan",
      "engineering.migration.implement",
      "engineering.migration.validate",
      "engineering.integration.implement",
      "engineering.dependency.change",
      "engineering.platform.change",
      "engineering.configuration.change",
      "engineering.feature-flag.operate",
      "engineering.build-tool.change",
      "engineering.automation.implement",
]);
expect(await taxonomyFixtureCount("engineering")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 22 missing `engineering` taxonomy halves.

- [ ] **Step 3: Author all 22 taxonomy bindings**

Create exactly `engineering.feature.design`, `engineering.feature.implement`, `engineering.bug.implement`, `engineering.refactor.implement`, `engineering.repository.change`, `engineering.architecture.design`, `engineering.architecture.change`, `engineering.code.retire`, `engineering.api.design`, `engineering.api.change`, `engineering.schema.design`, `engineering.schema.change`, `engineering.migration.plan`, `engineering.migration.implement`, `engineering.migration.validate`, `engineering.integration.implement`, `engineering.dependency.change`, `engineering.platform.change`, `engineering.configuration.change`, `engineering.feature-flag.operate`, `engineering.build-tool.change`, `engineering.automation.implement` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/engineering --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `22 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/engineering catalog/project-memory/v1/fixtures/pattern-taxonomy/engineering.yaml catalog/project-memory/v1/inventories/patterns/engineering.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add engineering taxonomy bindings"
```

### Task 31: Author the ux Pattern Taxonomy Family (16)

**Files:**
- Create: `catalog/project-memory/v1/patterns/ux/ux.research.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.flow.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.flow.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.information-architecture.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.interaction.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.visual.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.prototype.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.copy.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.accessibility.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.accessibility.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.design-system.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.design-system.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.responsive.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.localization.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.visual.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ux/ux.handoff.change.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/ux.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/ux.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 16 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("ux")).toEqual([
      "ux.research.assess",
      "ux.flow.assess",
      "ux.flow.design",
      "ux.information-architecture.design",
      "ux.interaction.design",
      "ux.visual.design",
      "ux.prototype.design",
      "ux.copy.design",
      "ux.accessibility.assess",
      "ux.accessibility.change",
      "ux.design-system.assess",
      "ux.design-system.change",
      "ux.responsive.validate",
      "ux.localization.validate",
      "ux.visual.validate",
      "ux.handoff.change",
]);
expect(await taxonomyFixtureCount("ux")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 16 missing `ux` taxonomy halves.

- [ ] **Step 3: Author all 16 taxonomy bindings**

Create exactly `ux.research.assess`, `ux.flow.assess`, `ux.flow.design`, `ux.information-architecture.design`, `ux.interaction.design`, `ux.visual.design`, `ux.prototype.design`, `ux.copy.design`, `ux.accessibility.assess`, `ux.accessibility.change`, `ux.design-system.assess`, `ux.design-system.change`, `ux.responsive.validate`, `ux.localization.validate`, `ux.visual.validate`, `ux.handoff.change` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/ux --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `16 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/ux catalog/project-memory/v1/fixtures/pattern-taxonomy/ux.yaml catalog/project-memory/v1/inventories/patterns/ux.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add ux taxonomy bindings"
```

### Task 32: Author the security Pattern Taxonomy Family (18)

**Files:**
- Create: `catalog/project-memory/v1/patterns/security/security.posture.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.threat-model.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.auth.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.auth.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.authorization.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.authorization.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.data.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.privacy.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.privacy.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.consent.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.secrets.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.dependency.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.supply-chain.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.compliance.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.compliance.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.finding.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.remediation.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/security/security.incident.operate.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/security.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/security.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 18 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("security")).toEqual([
      "security.posture.assess",
      "security.threat-model.assess",
      "security.auth.assess",
      "security.auth.change",
      "security.authorization.assess",
      "security.authorization.change",
      "security.data.assess",
      "security.privacy.assess",
      "security.privacy.change",
      "security.consent.assess",
      "security.secrets.assess",
      "security.dependency.assess",
      "security.supply-chain.assess",
      "security.compliance.assess",
      "security.compliance.change",
      "security.finding.validate",
      "security.remediation.implement",
      "security.incident.operate",
]);
expect(await taxonomyFixtureCount("security")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 18 missing `security` taxonomy halves.

- [ ] **Step 3: Author all 18 taxonomy bindings**

Create exactly `security.posture.assess`, `security.threat-model.assess`, `security.auth.assess`, `security.auth.change`, `security.authorization.assess`, `security.authorization.change`, `security.data.assess`, `security.privacy.assess`, `security.privacy.change`, `security.consent.assess`, `security.secrets.assess`, `security.dependency.assess`, `security.supply-chain.assess`, `security.compliance.assess`, `security.compliance.change`, `security.finding.validate`, `security.remediation.implement`, `security.incident.operate` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/security --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `18 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/security catalog/project-memory/v1/fixtures/pattern-taxonomy/security.yaml catalog/project-memory/v1/inventories/patterns/security.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add security taxonomy bindings"
```

### Task 33: Author the qa Pattern Taxonomy Family (14)

**Files:**
- Create: `catalog/project-memory/v1/patterns/qa/qa.strategy.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/qa/qa.unit.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/qa/qa.integration.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/qa/qa.e2e.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/qa/qa.regression.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/qa/qa.visual.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/qa/qa.accessibility.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/qa/qa.performance.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/qa/qa.performance.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/qa/qa.reliability.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/qa/qa.compatibility.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/qa/qa.release.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/qa/qa.defect.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/qa/qa.test-automation.implement.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/qa.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/qa.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 14 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("qa")).toEqual([
      "qa.strategy.plan",
      "qa.unit.validate",
      "qa.integration.validate",
      "qa.e2e.validate",
      "qa.regression.validate",
      "qa.visual.validate",
      "qa.accessibility.validate",
      "qa.performance.assess",
      "qa.performance.change",
      "qa.reliability.assess",
      "qa.compatibility.validate",
      "qa.release.validate",
      "qa.defect.assess",
      "qa.test-automation.implement",
]);
expect(await taxonomyFixtureCount("qa")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 14 missing `qa` taxonomy halves.

- [ ] **Step 3: Author all 14 taxonomy bindings**

Create exactly `qa.strategy.plan`, `qa.unit.validate`, `qa.integration.validate`, `qa.e2e.validate`, `qa.regression.validate`, `qa.visual.validate`, `qa.accessibility.validate`, `qa.performance.assess`, `qa.performance.change`, `qa.reliability.assess`, `qa.compatibility.validate`, `qa.release.validate`, `qa.defect.assess`, `qa.test-automation.implement` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/qa --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `14 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/qa catalog/project-memory/v1/fixtures/pattern-taxonomy/qa.yaml catalog/project-memory/v1/inventories/patterns/qa.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add qa taxonomy bindings"
```

### Task 34: Author the data Pattern Taxonomy Family (16)

**Files:**
- Create: `catalog/project-memory/v1/patterns/data/data.requirement.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.instrumentation.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.instrumentation.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.instrumentation.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.quality.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.pipeline.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.pipeline.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.schema.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.migration.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.analysis.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.metric.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.dashboard.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.experiment.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.experiment.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.governance.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/data/data.retention.change.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/data.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/data.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 16 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("data")).toEqual([
      "data.requirement.plan",
      "data.instrumentation.design",
      "data.instrumentation.implement",
      "data.instrumentation.validate",
      "data.quality.assess",
      "data.pipeline.design",
      "data.pipeline.implement",
      "data.schema.change",
      "data.migration.validate",
      "data.analysis.assess",
      "data.metric.design",
      "data.dashboard.implement",
      "data.experiment.design",
      "data.experiment.validate",
      "data.governance.assess",
      "data.retention.change",
]);
expect(await taxonomyFixtureCount("data")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 16 missing `data` taxonomy halves.

- [ ] **Step 3: Author all 16 taxonomy bindings**

Create exactly `data.requirement.plan`, `data.instrumentation.design`, `data.instrumentation.implement`, `data.instrumentation.validate`, `data.quality.assess`, `data.pipeline.design`, `data.pipeline.implement`, `data.schema.change`, `data.migration.validate`, `data.analysis.assess`, `data.metric.design`, `data.dashboard.implement`, `data.experiment.design`, `data.experiment.validate`, `data.governance.assess`, `data.retention.change` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/data --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `16 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/data catalog/project-memory/v1/fixtures/pattern-taxonomy/data.yaml catalog/project-memory/v1/inventories/patterns/data.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add data taxonomy bindings"
```

### Task 35: Author the growth Pattern Taxonomy Family (16)

**Files:**
- Create: `catalog/project-memory/v1/patterns/growth/growth.strategy.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.campaign.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.campaign.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.campaign.release.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.positioning.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.offer.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.funnel.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.acquisition.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.lifecycle.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.referral.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.store-listing.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.seo.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.measurement.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.creative.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.pricing.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/growth/growth.partnership.plan.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/growth.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/growth.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 16 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("growth")).toEqual([
      "growth.strategy.plan",
      "growth.campaign.plan",
      "growth.campaign.implement",
      "growth.campaign.release",
      "growth.positioning.design",
      "growth.offer.design",
      "growth.funnel.assess",
      "growth.acquisition.plan",
      "growth.lifecycle.plan",
      "growth.referral.design",
      "growth.store-listing.change",
      "growth.seo.change",
      "growth.measurement.design",
      "growth.creative.design",
      "growth.pricing.assess",
      "growth.partnership.plan",
]);
expect(await taxonomyFixtureCount("growth")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 16 missing `growth` taxonomy halves.

- [ ] **Step 3: Author all 16 taxonomy bindings**

Create exactly `growth.strategy.plan`, `growth.campaign.plan`, `growth.campaign.implement`, `growth.campaign.release`, `growth.positioning.design`, `growth.offer.design`, `growth.funnel.assess`, `growth.acquisition.plan`, `growth.lifecycle.plan`, `growth.referral.design`, `growth.store-listing.change`, `growth.seo.change`, `growth.measurement.design`, `growth.creative.design`, `growth.pricing.assess`, `growth.partnership.plan` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/growth --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `16 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/growth catalog/project-memory/v1/fixtures/pattern-taxonomy/growth.yaml catalog/project-memory/v1/inventories/patterns/growth.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add growth taxonomy bindings"
```

### Task 36: Author the content Pattern Taxonomy Family (13)

**Files:**
- Create: `catalog/project-memory/v1/patterns/content/content.strategy.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/content/content.editorial.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/content/content.copy.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/content/content.asset.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/content/content.review.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/content/content.publish.release.taxonomy.yaml`, `catalog/project-memory/v1/patterns/content/content.localization.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/content/content.localization.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/content/content.accessibility.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/content/content.rights.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/content/content.taxonomy.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/content/content.archive.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/content/content.material.retire.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/content.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/content.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 13 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("content")).toEqual([
      "content.strategy.plan",
      "content.editorial.plan",
      "content.copy.design",
      "content.asset.implement",
      "content.review.validate",
      "content.publish.release",
      "content.localization.plan",
      "content.localization.implement",
      "content.accessibility.validate",
      "content.rights.assess",
      "content.taxonomy.design",
      "content.archive.operate",
      "content.material.retire",
]);
expect(await taxonomyFixtureCount("content")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 13 missing `content` taxonomy halves.

- [ ] **Step 3: Author all 13 taxonomy bindings**

Create exactly `content.strategy.plan`, `content.editorial.plan`, `content.copy.design`, `content.asset.implement`, `content.review.validate`, `content.publish.release`, `content.localization.plan`, `content.localization.implement`, `content.accessibility.validate`, `content.rights.assess`, `content.taxonomy.design`, `content.archive.operate`, `content.material.retire` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/content --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `13 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/content catalog/project-memory/v1/fixtures/pattern-taxonomy/content.yaml catalog/project-memory/v1/inventories/patterns/content.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add content taxonomy bindings"
```

### Task 37: Author the research Pattern Taxonomy Family (12)

**Files:**
- Create: `catalog/project-memory/v1/patterns/research/research.question.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/research/research.protocol.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/research/research.source.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/research/research.user.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/research/research.market.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/research/research.competitor.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/research/research.literature.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/research/research.experiment.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/research/research.analysis.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/research/research.finding.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/research/research.synthesis.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/research/research.reproducibility.validate.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/research.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/research.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 12 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("research")).toEqual([
      "research.question.plan",
      "research.protocol.design",
      "research.source.assess",
      "research.user.assess",
      "research.market.assess",
      "research.competitor.assess",
      "research.literature.assess",
      "research.experiment.implement",
      "research.analysis.assess",
      "research.finding.validate",
      "research.synthesis.change",
      "research.reproducibility.validate",
]);
expect(await taxonomyFixtureCount("research")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 12 missing `research` taxonomy halves.

- [ ] **Step 3: Author all 12 taxonomy bindings**

Create exactly `research.question.plan`, `research.protocol.design`, `research.source.assess`, `research.user.assess`, `research.market.assess`, `research.competitor.assess`, `research.literature.assess`, `research.experiment.implement`, `research.analysis.assess`, `research.finding.validate`, `research.synthesis.change`, `research.reproducibility.validate` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/research --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `12 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/research catalog/project-memory/v1/fixtures/pattern-taxonomy/research.yaml catalog/project-memory/v1/inventories/patterns/research.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add research taxonomy bindings"
```

### Task 38: Author the release Pattern Taxonomy Family (14)

**Files:**
- Create: `catalog/project-memory/v1/patterns/release/release.readiness.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/release/release.execution.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/release/release.build.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/release/release.migration.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/release/release.rollback.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/release/release.notes.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/release/release.deployment.release.taxonomy.yaml`, `catalog/project-memory/v1/patterns/release/release.store.release.taxonomy.yaml`, `catalog/project-memory/v1/patterns/release/release.feature-flag.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/release/release.monitor.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/release/release.communication.release.taxonomy.yaml`, `catalog/project-memory/v1/patterns/release/release.hotfix.release.taxonomy.yaml`, `catalog/project-memory/v1/patterns/release/release.postrelease.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/release/release.asset.retire.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/release.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/release.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 14 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("release")).toEqual([
      "release.readiness.validate",
      "release.execution.plan",
      "release.build.validate",
      "release.migration.validate",
      "release.rollback.plan",
      "release.notes.change",
      "release.deployment.release",
      "release.store.release",
      "release.feature-flag.operate",
      "release.monitor.operate",
      "release.communication.release",
      "release.hotfix.release",
      "release.postrelease.assess",
      "release.asset.retire",
]);
expect(await taxonomyFixtureCount("release")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 14 missing `release` taxonomy halves.

- [ ] **Step 3: Author all 14 taxonomy bindings**

Create exactly `release.readiness.validate`, `release.execution.plan`, `release.build.validate`, `release.migration.validate`, `release.rollback.plan`, `release.notes.change`, `release.deployment.release`, `release.store.release`, `release.feature-flag.operate`, `release.monitor.operate`, `release.communication.release`, `release.hotfix.release`, `release.postrelease.assess`, `release.asset.retire` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/release --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `14 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/release catalog/project-memory/v1/fixtures/pattern-taxonomy/release.yaml catalog/project-memory/v1/inventories/patterns/release.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add release taxonomy bindings"
```

### Task 39: Author the support Pattern Taxonomy Family (12)

**Files:**
- Create: `catalog/project-memory/v1/patterns/support/support.request.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/support/support.issue.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/support/support.incident.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/support/support.problem.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/support/support.knowledge.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/support/support.sop.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/support/support.escalation.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/support/support.service.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/support/support.root-cause.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/support/support.remediation.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/support/support.maintenance.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/support/support.deprecation.retire.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/support.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/support.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 12 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("support")).toEqual([
      "support.request.assess",
      "support.issue.assess",
      "support.incident.operate",
      "support.problem.assess",
      "support.knowledge.change",
      "support.sop.change",
      "support.escalation.operate",
      "support.service.validate",
      "support.root-cause.assess",
      "support.remediation.change",
      "support.maintenance.operate",
      "support.deprecation.retire",
]);
expect(await taxonomyFixtureCount("support")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 12 missing `support` taxonomy halves.

- [ ] **Step 3: Author all 12 taxonomy bindings**

Create exactly `support.request.assess`, `support.issue.assess`, `support.incident.operate`, `support.problem.assess`, `support.knowledge.change`, `support.sop.change`, `support.escalation.operate`, `support.service.validate`, `support.root-cause.assess`, `support.remediation.change`, `support.maintenance.operate`, `support.deprecation.retire` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/support --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `12 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/support catalog/project-memory/v1/fixtures/pattern-taxonomy/support.yaml catalog/project-memory/v1/inventories/patterns/support.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add support taxonomy bindings"
```

### Task 40: Author the game Pattern Taxonomy Family (20)

**Files:**
- Create: `catalog/project-memory/v1/patterns/game/game.mechanic.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.mechanic.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.loop.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.progression.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.economy.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.economy.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.balance.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.balance.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.level.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.narrative.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.save.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.save.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.multiplayer.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.telemetry.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.telemetry.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.playtest.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.content.release.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.live-operations.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.anti-cheat.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/game/game.certification.validate.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/game.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/game.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 20 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("game")).toEqual([
      "game.mechanic.design",
      "game.mechanic.implement",
      "game.loop.design",
      "game.progression.design",
      "game.economy.design",
      "game.economy.change",
      "game.balance.assess",
      "game.balance.change",
      "game.level.design",
      "game.narrative.design",
      "game.save.change",
      "game.save.validate",
      "game.multiplayer.implement",
      "game.telemetry.implement",
      "game.telemetry.validate",
      "game.playtest.validate",
      "game.content.release",
      "game.live-operations.operate",
      "game.anti-cheat.assess",
      "game.certification.validate",
]);
expect(await taxonomyFixtureCount("game")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 20 missing `game` taxonomy halves.

- [ ] **Step 3: Author all 20 taxonomy bindings**

Create exactly `game.mechanic.design`, `game.mechanic.implement`, `game.loop.design`, `game.progression.design`, `game.economy.design`, `game.economy.change`, `game.balance.assess`, `game.balance.change`, `game.level.design`, `game.narrative.design`, `game.save.change`, `game.save.validate`, `game.multiplayer.implement`, `game.telemetry.implement`, `game.telemetry.validate`, `game.playtest.validate`, `game.content.release`, `game.live-operations.operate`, `game.anti-cheat.assess`, `game.certification.validate` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/game --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `20 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/game catalog/project-memory/v1/fixtures/pattern-taxonomy/game.yaml catalog/project-memory/v1/inventories/patterns/game.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add game taxonomy bindings"
```

### Task 41: Author the ai Pattern Taxonomy Family (20)

**Files:**
- Create: `catalog/project-memory/v1/patterns/ai/ai.use-case.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.data.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.model.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.model.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.prompt.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.prompt.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.retrieval.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.retrieval.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.tooling.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.evaluation.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.evaluation.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.safety.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.guardrail.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.human-review.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.serving.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.cost.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.latency.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.drift.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.monitoring.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/ai/ai.model.retire.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/ai.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/ai.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 20 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("ai")).toEqual([
      "ai.use-case.plan",
      "ai.data.assess",
      "ai.model.assess",
      "ai.model.implement",
      "ai.prompt.design",
      "ai.prompt.change",
      "ai.retrieval.design",
      "ai.retrieval.implement",
      "ai.tooling.implement",
      "ai.evaluation.design",
      "ai.evaluation.validate",
      "ai.safety.assess",
      "ai.guardrail.implement",
      "ai.human-review.design",
      "ai.serving.implement",
      "ai.cost.assess",
      "ai.latency.assess",
      "ai.drift.operate",
      "ai.monitoring.operate",
      "ai.model.retire",
]);
expect(await taxonomyFixtureCount("ai")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 20 missing `ai` taxonomy halves.

- [ ] **Step 3: Author all 20 taxonomy bindings**

Create exactly `ai.use-case.plan`, `ai.data.assess`, `ai.model.assess`, `ai.model.implement`, `ai.prompt.design`, `ai.prompt.change`, `ai.retrieval.design`, `ai.retrieval.implement`, `ai.tooling.implement`, `ai.evaluation.design`, `ai.evaluation.validate`, `ai.safety.assess`, `ai.guardrail.implement`, `ai.human-review.design`, `ai.serving.implement`, `ai.cost.assess`, `ai.latency.assess`, `ai.drift.operate`, `ai.monitoring.operate`, `ai.model.retire` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/ai --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `20 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/ai catalog/project-memory/v1/fixtures/pattern-taxonomy/ai.yaml catalog/project-memory/v1/inventories/patterns/ai.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add ai taxonomy bindings"
```

### Task 42: Author the commerce Pattern Taxonomy Family (17)

**Files:**
- Create: `catalog/project-memory/v1/patterns/commerce/commerce.catalog.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.checkout.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.checkout.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.payment.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.entitlement.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.entitlement.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.pricing.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.order.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.booking.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.settlement.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.reconciliation.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.fraud.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.dispute.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.refund.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.tax.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.policy.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/commerce/commerce.marketplace.validate.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/commerce.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/commerce.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 17 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("commerce")).toEqual([
      "commerce.catalog.change",
      "commerce.checkout.design",
      "commerce.checkout.implement",
      "commerce.payment.implement",
      "commerce.entitlement.implement",
      "commerce.entitlement.validate",
      "commerce.pricing.change",
      "commerce.order.implement",
      "commerce.booking.implement",
      "commerce.settlement.validate",
      "commerce.reconciliation.validate",
      "commerce.fraud.assess",
      "commerce.dispute.operate",
      "commerce.refund.operate",
      "commerce.tax.assess",
      "commerce.policy.validate",
      "commerce.marketplace.validate",
]);
expect(await taxonomyFixtureCount("commerce")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 17 missing `commerce` taxonomy halves.

- [ ] **Step 3: Author all 17 taxonomy bindings**

Create exactly `commerce.catalog.change`, `commerce.checkout.design`, `commerce.checkout.implement`, `commerce.payment.implement`, `commerce.entitlement.implement`, `commerce.entitlement.validate`, `commerce.pricing.change`, `commerce.order.implement`, `commerce.booking.implement`, `commerce.settlement.validate`, `commerce.reconciliation.validate`, `commerce.fraud.assess`, `commerce.dispute.operate`, `commerce.refund.operate`, `commerce.tax.assess`, `commerce.policy.validate`, `commerce.marketplace.validate` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/commerce --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `17 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/commerce catalog/project-memory/v1/fixtures/pattern-taxonomy/commerce.yaml catalog/project-memory/v1/inventories/patterns/commerce.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add commerce taxonomy bindings"
```

### Task 43: Author the enterprise Pattern Taxonomy Family (16)

**Files:**
- Create: `catalog/project-memory/v1/patterns/enterprise/enterprise.requirement.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.integration.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.integration.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.identity.change.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.rbac.design.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.rbac.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.audit.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.compliance.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.migration.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.migration.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.rollout.plan.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.training.implement.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.change-management.operate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.sla.validate.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.procurement.assess.taxonomy.yaml`, `catalog/project-memory/v1/patterns/enterprise/enterprise.tenancy.design.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/pattern-taxonomy/enterprise.yaml`
- Modify: `catalog/project-memory/v1/inventories/patterns/enterprise.yaml`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`

**Interfaces:**
- Owns only the 16 taxonomy halves listed below; it never edits `*.core.yaml`.
- Each half contains identity/version, compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes exact `1.0.0` core halves at full integration time.

- [ ] **Step 1: Add the failing exact-family assertion**

```ts
expect(await taxonomyIds("enterprise")).toEqual([
      "enterprise.requirement.plan",
      "enterprise.integration.design",
      "enterprise.integration.implement",
      "enterprise.identity.change",
      "enterprise.rbac.design",
      "enterprise.rbac.implement",
      "enterprise.audit.validate",
      "enterprise.compliance.validate",
      "enterprise.migration.plan",
      "enterprise.migration.implement",
      "enterprise.rollout.plan",
      "enterprise.training.implement",
      "enterprise.change-management.operate",
      "enterprise.sla.validate",
      "enterprise.procurement.assess",
      "enterprise.tenancy.design",
]);
expect(await taxonomyFixtureCount("enterprise")).toBe(1);
```

- [ ] **Step 2: Prove the family test fails**

Run: `npm test -- tests/catalog/contracts/pattern-bijection.test.ts`

Expected: FAIL with 16 missing `enterprise` taxonomy halves.

- [ ] **Step 3: Author all 16 taxonomy bindings**

Create exactly `enterprise.requirement.plan`, `enterprise.integration.design`, `enterprise.integration.implement`, `enterprise.identity.change`, `enterprise.rbac.design`, `enterprise.rbac.implement`, `enterprise.audit.validate`, `enterprise.compliance.validate`, `enterprise.migration.plan`, `enterprise.migration.implement`, `enterprise.rollout.plan`, `enterprise.training.implement`, `enterprise.change-management.operate`, `enterprise.sla.validate`, `enterprise.procurement.assess`, `enterprise.tenancy.design` at version `1.0.0`. Every mutation mode maps conditional owned-path mutation plus independent validation/record duties; validation and assessment modes grant no mutation; retirement uses explicit archive/no-touch impacts; all references resolve to Tasks 5-15.

- [ ] **Step 4: Validate taxonomy-only scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/patterns/enterprise --taxonomy-only --strict
npm test -- tests/catalog/contracts/pattern-bijection.test.ts
```

Expected before core integration: `16 taxonomy halves, 0 schema/reference errors`; missing core halves are reported as deferred integration prerequisites, not silently synthesized.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/patterns/enterprise catalog/project-memory/v1/fixtures/pattern-taxonomy/enterprise.yaml catalog/project-memory/v1/inventories/patterns/enterprise.yaml tests/catalog/contracts/pattern-bijection.test.ts
git commit -m "feat(catalog): add enterprise taxonomy bindings"
```

### Task 44: Author the Thirteen Companion-Rule Taxonomy Halves

**Files:**
- Create: `catalog/project-memory/v1/companion-rules/companion.mutation.taxonomy.yaml`, `catalog/project-memory/v1/companion-rules/companion.user-visible.taxonomy.yaml`, `catalog/project-memory/v1/companion-rules/companion.ui.taxonomy.yaml`, `catalog/project-memory/v1/companion-rules/companion.identity-security.taxonomy.yaml`, `catalog/project-memory/v1/companion-rules/companion.personal-data.taxonomy.yaml`, `catalog/project-memory/v1/companion-rules/companion.commerce.taxonomy.yaml`, `catalog/project-memory/v1/companion-rules/companion.contract-change.taxonomy.yaml`, `catalog/project-memory/v1/companion-rules/companion.supply-chain.taxonomy.yaml`, `catalog/project-memory/v1/companion-rules/companion.campaign.taxonomy.yaml`, `catalog/project-memory/v1/companion-rules/companion.ai.taxonomy.yaml`, `catalog/project-memory/v1/companion-rules/companion.game-system.taxonomy.yaml`, `catalog/project-memory/v1/companion-rules/companion.production-release.taxonomy.yaml`, `catalog/project-memory/v1/companion-rules/companion.retirement.taxonomy.yaml`
- Create: `catalog/project-memory/v1/fixtures/companion-taxonomy.yaml`
- Modify: `catalog/project-memory/v1/inventories/companion-rules.yaml`
- Modify: `tests/catalog/contracts/companion-bijection.test.ts`

**Interfaces:**
- Owns compatibility, overlay applicability, component impacts, and domain impacts only.
- Consumes matching `1.0.0` companion core halves for triggers, required patterns, procedural behavior, authorization, evidence, and completion.
- Assembly rejects taxonomy attempts to redefine triggers, required patterns, predicates, authority effects, evidence, or conflict policy.

- [ ] **Step 1: Add the failing exact companion assertion**

```ts
expect(await companionTaxonomyIds()).toEqual([
  "companion.mutation",
  "companion.user-visible",
  "companion.ui",
  "companion.identity-security",
  "companion.personal-data",
  "companion.commerce",
  "companion.contract-change",
  "companion.supply-chain",
  "companion.campaign",
  "companion.ai",
  "companion.game-system",
  "companion.production-release",
  "companion.retirement",
]);
```

- [ ] **Step 2: Prove the test fails**

Run: `npm test -- tests/catalog/contracts/companion-bijection.test.ts`

Expected: FAIL with 13 missing companion taxonomy halves.

- [ ] **Step 3: Author the 13 taxonomy halves**

Create every listed rule at `1.0.0`. Map each rule to the permanent domains and component classes implied by its scope: mutation to affected components plus governance/QA; UI to UX/accessibility/visual QA; identity-security and personal-data to security/privacy/data; commerce to payments/fraud/support/data; contract and supply-chain changes to engineering/release/security; campaign to growth/content/data; AI and game-system to their specialist components/domains; production-release to release/support/observability; retirement to governance/archive and affected owners. Do not copy core-owned required-pattern lists into taxonomy.

- [ ] **Step 4: Validate taxonomy-only companion scope**

Run:

```powershell
npm run catalog:validate -- --scope catalog/project-memory/v1/companion-rules --taxonomy-only --strict
npm test -- tests/catalog/contracts/companion-bijection.test.ts
```

Expected before core integration: `13 taxonomy halves, 0 schema/reference errors`; missing core halves remain explicit deferred prerequisites.

- [ ] **Step 5: Commit**

```powershell
git add catalog/project-memory/v1/companion-rules catalog/project-memory/v1/fixtures/companion-taxonomy.yaml catalog/project-memory/v1/inventories/companion-rules.yaml tests/catalog/contracts/companion-bijection.test.ts
git commit -m "feat(catalog): add companion taxonomy bindings"
```

### Task 45: Run Full Bijection and Selection Contract Fixtures

**Files:**
- Create: `src/catalog/fixtures/run-integrated-blueprint-fixtures.ts`
- Create: `tests/catalog/contracts/selection-contract.test.ts`
- Modify: `tests/catalog/contracts/pattern-bijection.test.ts`
- Modify: `tests/catalog/contracts/companion-bijection.test.ts`
- Modify: `tests/catalog/contracts/golden-fixtures.test.ts`

**Interfaces:**
- Consumes assembled pattern/companion definitions after the work-pattern core plan lands.
- Consumes only `selectBlueprint` and its public input/output types from `src/selection/index.ts`.
- Catalog owns fixture inputs and expected outcomes; selection owns all executable normalization, predicate evaluation, scoring, confidence, precedence, and ambiguity logic.
- Produces a deterministic fixture report, never a second selector.

- [ ] **Step 1: Write the failing cross-plan contract**

```ts
import { selectBlueprint } from "../../../src/selection/index.js";
import { runIntegratedBlueprintFixtures } from "../../../src/catalog/fixtures/run-integrated-blueprint-fixtures.js";

it("matches every catalog-owned blueprint expectation", async () => {
  const result = await runIntegratedBlueprintFixtures({
    selectBlueprint,
    catalog: await loadCompleteCatalog(),
    fixtures: await loadAllBlueprintFixtures(),
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({
      total: 150,
      passed: 150,
      failed: 0,
    });
  }
});
```

Also assert exactly 257 pattern and 13 companion ID/version bijections with no missing, duplicate, mismatched, or overlapping halves.

- [ ] **Step 2: Prove integration fails before dependencies land**

Run:

```powershell
npm test -- tests/catalog/contracts/selection-contract.test.ts tests/catalog/contracts/pattern-bijection.test.ts tests/catalog/contracts/companion-bijection.test.ts
```

Expected: FAIL with a missing public selection export or missing core-half diagnostics; no fallback selector is created.

- [ ] **Step 3: Implement only the fixture adapter and reconcile public contracts**

The runner projects each catalog `BlueprintDefinition` into the public `BlueprintSelectableDefinition` shape without changing weights, predicates, status, or precedence; it then passes each fixture's already-normalized features and those typed candidates to `selectBlueprint`. It compares `decision`, selected/rejected IDs, and stable reason codes. It must not inspect weights or reproduce tie rules. Reconcile schema/type mismatches at the owning plan boundary rather than adding catalog aliases.

- [ ] **Step 4: Run the complete cross-plan suite**

Run:

```powershell
npm run catalog:validate -- --scope taxonomy --strict
npm run catalog:fixtures -- --suite blueprint --integrated
npm test -- tests/catalog/contracts/selection-contract.test.ts tests/catalog/contracts/pattern-bijection.test.ts tests/catalog/contracts/companion-bijection.test.ts tests/catalog/contracts/golden-fixtures.test.ts
```

Expected: `257/257` pattern pairs, `13/13` companion pairs, and `150/150` blueprint fixtures pass.

- [ ] **Step 5: Commit**

```powershell
git add src/catalog/fixtures/run-integrated-blueprint-fixtures.ts tests/catalog/contracts/selection-contract.test.ts tests/catalog/contracts/pattern-bijection.test.ts tests/catalog/contracts/companion-bijection.test.ts tests/catalog/contracts/golden-fixtures.test.ts
git commit -m "test(catalog): verify selection and taxonomy contracts"
```

### Task 46: Build and Verify the Deterministic v1 Release

**Files:**
- Create: `src/catalog/manifest/build-catalog-bundle.ts`
- Create: `src/catalog/manifest/verify-catalog-release.ts`
- Create: `tests/catalog/contracts/manifest-determinism.test.ts`
- Generate: `dist/catalog/project-memory/1.0.0/catalog.bundle.json`
- Generate: `dist/catalog/project-memory/1.0.0/catalog.lock.json`
- Generate: `dist/catalog/project-memory/1.0.0/SHA256SUMS`

**Interfaces:**
- Consumes foundation `canonicalJson`, `sha256`, async `resolveInside`, and document reads.
- Does not add catalog-local canonical JSON, hashing, generic lock building, or path-safety code.
- Bundle order is stable by definition class, stable ID, and exact version.
- Lock records source-relative path, definition ID, version, schema ID, and SHA-256 for every source and generated artifact.

- [ ] **Step 1: Write the failing determinism test**

```ts
it("emits byte-identical releases from identical sources", async () => {
  const first = await buildReleaseInTemp("1.0.0");
  const second = await buildReleaseInTemp("1.0.0");
  expect(first.bundleBytes).toEqual(second.bundleBytes);
  expect(first.lockBytes).toEqual(second.lockBytes);
  expect(first.checksums).toEqual(second.checksums);
  const verification = await verifyCatalogRelease(first.root, first.lock);
  expect(verification.ok).toBe(true);
  if (verification.ok) expect(verification.value.valid).toBe(true);
});
```

- [ ] **Step 2: Prove the release test fails**

Run: `npm test -- tests/catalog/contracts/manifest-determinism.test.ts`

Expected: FAIL because catalog release assembly is not implemented.

- [ ] **Step 3: Implement catalog-specific release assembly**

Load and fully validate all sources, assemble exact pairs, sort deterministically, serialize through foundation `canonicalJson`, hash through foundation `sha256`, and resolve every output through awaited `resolveInside`. Reject an existing release directory whose bytes differ; never rewrite a published version silently.

- [ ] **Step 4: Generate and verify v1 twice**

Run:

```powershell
npm run catalog:bundle -- --release 1.0.0
npm run catalog:lock -- --release 1.0.0 --check
npm test -- tests/catalog/contracts/manifest-determinism.test.ts
npm run catalog:bundle -- --release 1.0.0 --check-clean
```

Expected: the first command emits three artifacts; lock verification and tests pass; the second generation reports byte-identical output and leaves no diff.

- [ ] **Step 5: Commit**

```powershell
git add src/catalog/manifest/build-catalog-bundle.ts src/catalog/manifest/verify-catalog-release.ts tests/catalog/contracts/manifest-determinism.test.ts dist/catalog/project-memory/1.0.0
git commit -m "feat(catalog): build deterministic v1 release"
```

### Task 47: Enforce the Complete Catalog Release Gate

**Files:**
- Create: `tests/catalog/contracts/release-acceptance.test.ts`
- Modify: `catalog/project-memory/v1/CHANGELOG.md`
- Modify: `catalog/project-memory/v1/VERSIONING.md`
- Modify: `catalog/project-memory/v1/EXTENSIONS.md`

**Interfaces:**
- Pins final active totals: 11 groups, 62 blueprints, 78 components, 15 domains, 46 overlays, 15 adapters, 257 pattern taxonomy halves, 13 companion taxonomy halves, and 150 blueprint fixtures.
- Confirms no catalog-owned scorer, normalizer, CLI parser, YAML parser, canonicalizer, hasher, or `*.core.yaml`.
- Confirms released docs describe extension namespaces, deprecation/migration, immutable history, and SemVer boundaries.

- [ ] **Step 1: Write the failing release acceptance test**

```ts
expect(await activeCatalogCounts()).toEqual({
  blueprint_groups: 11,
  blueprints: 62,
  components: 78,
  domains: 15,
  overlays: 46,
  adapters: 15,
  pattern_taxonomy: 257,
  companion_taxonomy: 13,
  blueprint_fixtures: 150,
});
expect(await forbiddenCatalogOwnedModules()).toEqual([]);
```

- [ ] **Step 2: Run the full gate and record every failure**

Run:

```powershell
npm test -- tests/catalog/contracts/release-acceptance.test.ts
npm run catalog:validate -- --scope all --strict
```

Expected before final reconciliation: FAIL with an exact list of incomplete counts, invalid references, stale docs, or forbidden ownership paths; no generic error.

- [ ] **Step 3: Reconcile only catalog-owned release defects**

Fix missing inventory entries, content/schema mismatches, invalid references, fixture expectations, and catalog documentation. Do not repair another subsystem by copying its code or files into `src/catalog/**`. Add the `1.0.0` release entry with locked counts and artifact hash provenance.

- [ ] **Step 4: Run the complete repository-quality gate**

Run:

```powershell
npm run typecheck
npm run lint
npm run schemas:emit
npm run catalog:inventory -- --check
npm run catalog:validate -- --scope all --strict
npm run catalog:fixtures -- --suite blueprint --integrated
npm run catalog:lock -- --release 1.0.0 --check
npm run build
npm test
npm pack --dry-run
git diff --check
git diff --name-only -- catalog/project-memory/v1/patterns catalog/project-memory/v1/companion-rules | Select-String -Pattern '\.core\.yaml$'
```

Expected: every command exits `0`; tests report the pinned totals; package dry-run includes the catalog, schemas, and v1 release artifacts; `git diff --check` and the final forbidden-core-file scan emit no output.

- [ ] **Step 5: Commit**

```powershell
git add tests/catalog/contracts/release-acceptance.test.ts catalog/project-memory/v1/CHANGELOG.md catalog/project-memory/v1/VERSIONING.md catalog/project-memory/v1/EXTENSIONS.md
git commit -m "chore(catalog): enforce v1 release gate"
```

## Implementation Handoff

Start in the implementation repository, verify the foundation plan has landed, and execute Tasks 1-4 sequentially. Tasks 5-15 may then run in parallel by owned directory; Tasks 16-26 may run in parallel by blueprint group; Tasks 28-43 may run in parallel by pattern family. Do not start Task 45 until the selection public interface and all core halves are available. Reserve Task 46 for one integrator because it alone writes the shared release artifacts.
