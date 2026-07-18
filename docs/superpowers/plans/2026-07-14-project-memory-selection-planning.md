# Project Memory Selection and Task Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic selection and task-planning subsystem that turns normalized project evidence plus the locked catalog into blueprint/pattern selections, companion closure, bounded workstreams, complete task assignments, and validated task/completion packets without allowing workers to infer authority.

**Architecture:** The subsystem is a pure, fail-closed compiler pipeline: normalize evidence, evaluate typed predicates, score catalog definitions, expand companions to a fixed point, decompose outcomes, merge impacts, prove task coverage, and materialize flattened packets. Catalog taxonomy and runtime core halves are merged by ID/version, but taxonomy content remains owned by the taxonomy plans; this subsystem never writes repositories, canonical records, generated views, leases, or integrations.

**Tech Stack:** TypeScript in strict ESM mode, Node.js 24, TypeBox domain contracts registered with the foundation Ajv 2020 runtime, foundation YAML/document I/O and path-safety helpers, Node fs for path-confined recursive discovery, semver, and Vitest. This subsystem adds no package dependency.

## Global Constraints

- Repository root is `<repository-root>` (or its isolated worktree). Execute from `plugins/project-memory/`; every implementation path below is relative to that package root.
- Node must satisfy >=24.0.0 <25.0.0. Package-lock versions are exact and catalog outputs are deterministic.
- Source catalog root is catalog/project-memory/v1/.
- Use snake_case for every serialized YAML/JSON field and camelCase only for TypeScript functions and in-memory orchestration APIs.
- Register domain TypeBox schemas with the foundation registry and generate schemas/project-memory/v1/ by running the foundation emitter; never hand-edit generated schema JSON.
- Use foundation path confinement plus Node fs recursive discovery. Do not add fast-glob or any other dependency.
- Pattern halves share catalog/project-memory/v1/patterns/<family>/: each pattern has one <pattern-id>.core.yaml and one <pattern-id>.taxonomy.yaml.
- Companion halves share catalog/project-memory/v1/companion-rules/: each rule has one <rule-id>.core.yaml and one <rule-id>.taxonomy.yaml.
- This plan owns all 257 pattern .core.yaml files and all 13 companion-rule .core.yaml files. It must not create or modify any .taxonomy.yaml file.
- This plan owns only the selection/planning schemas and runtime listed below. It does not own blueprint taxonomy, component/domain taxonomy, repository materialization, canonical record persistence, generated views, Git/worktree operations, integration leases, or canonical integration.
- Runtime functions return values and validation reports only. They never mutate input objects or perform external actions.
- Workers receive flattened task packets. No unresolved conditional, not_applicable, catalog inheritance, missing authority, or implicit write scope may enter a packet.
- A companion may narrow authority or add inspection, validation, evidence, records, and approval requirements. It may not grant mutation, release, notification, or external-action authority.
- Every task is test-first. A worker runs the named failing test, implements only that task, runs its focused tests, runs npm run typecheck, and commits one logical change.
- Do not edit any other implementation plan.

---

## Ownership and File Map

### Inputs owned by neighboring plans

- package.json, package-lock.json, tsconfig.json, vitest.config.ts, and eslint.config.mjs.
- src/contracts/runtime-result.ts exporting RuntimeIssue and RuntimeResult.
- src/core/clock.ts exporting Clock.
- src/core/id-factory.ts exporting IdFactory.
- src/core/path-safety.ts exporting resolveInside(root: URL, relativePath: string): Promise<RuntimeResult<URL>>.
- src/core/document-io.ts exporting parseYamlDocument(text: string, source: string): RuntimeResult<unknown>.
- src/schema/index.ts exporting registerSchema, validateWithSchema, and emitJsonSchemas.
- src/catalog/index.ts exporting BlueprintDefinition, PatternTaxonomyBinding, PatternDefinition, CompanionTaxonomyBinding, CompanionRuleDefinition, ComponentDefinition, DomainDefinition, CatalogSource, CatalogManifest, loadCatalog, assemblePatternDefinition, and assembleCompanionRule. Catalog assembly consumes PatternCoreDefinition and CompanionRuleCore from src/selection/contracts/core.ts; it does not redefine them.
- catalog/project-memory/v1/manifest.yaml.
- catalog/project-memory/v1/patterns/<family>/<pattern-id>.taxonomy.yaml.
- catalog/project-memory/v1/companion-rules/<rule-id>.taxonomy.yaml.

If any input signature differs, stop and reconcile the owning plan. Do not create a duplicate adapter or second source of truth.

### Files owned by this plan

Domain contracts and generated outputs:

- src/selection/contracts/core.ts owns and registers pattern-core and companion-rule-core TypeBox schemas.
- src/selection/contracts/selection.ts owns and registers normalized-feature-map and selection-result TypeBox schemas.
- src/selection/contracts/resolved.ts owns and registers resolved-pattern and resolved-companion-rule schemas after composing selection core contracts with catalog taxonomy contracts.
- src/selection/contracts/index.ts and src/selection/index.ts are the public selection contract/runtime entry points.
- src/planning/contracts.ts owns and registers workstream-pattern-set, workstream-plan, task-assignment, task-packet, completion-packet, claim, and approval TypeBox schemas.
- src/planning/index.ts is the public planning entry point.
- The foundation emitter generates exactly these 13 outputs under schemas/project-memory/v1/: normalized-feature-map, selection-result, pattern-core, resolved-pattern, companion-rule-core, resolved-companion-rule, workstream-pattern-set, workstream-plan, task-assignment, task-packet, completion-packet, claim, and approval. Never edit emitted JSON by hand.

TypeScript runtime:

- src/selection/types.ts
- src/selection/normalize-feature-map.ts
- src/selection/evaluate-predicate.ts
- src/selection/score-candidates.ts
- src/selection/load-pattern-halves.ts
- src/selection/expand-companions.ts
- src/selection/compile-workstream.ts
- src/planning/types.ts
- src/planning/decompose-outcomes.ts
- src/planning/merge-impacts.ts
- src/planning/build-task-coverage.ts
- src/planning/assign-task-packets.ts
- src/planning/materialize-task-packet.ts
- src/planning/validate-completion-packet.ts
- src/planning/validate-claim-approval.ts

Catalog core halves:

- catalog/project-memory/v1/patterns/<family>/<pattern-id>.core.yaml for every ID in the 257-entry manifest.
- catalog/project-memory/v1/companion-rules/<rule-id>.core.yaml for all 13 approved companion rules.

Tests:

- tests/selection/normalize-feature-map.test.ts
- tests/selection/evaluate-predicate.test.ts
- tests/selection/score-candidates.test.ts
- tests/selection/load-pattern-halves.test.ts
- tests/helpers/pattern-core-family.ts
- tests/selection/pattern-core/governance.test.ts
- tests/selection/pattern-core/product.test.ts
- tests/selection/pattern-core/engineering.test.ts
- tests/selection/pattern-core/ux.test.ts
- tests/selection/pattern-core/security.test.ts
- tests/selection/pattern-core/qa.test.ts
- tests/selection/pattern-core/data.test.ts
- tests/selection/pattern-core/growth.test.ts
- tests/selection/pattern-core/content.test.ts
- tests/selection/pattern-core/research.test.ts
- tests/selection/pattern-core/release.test.ts
- tests/selection/pattern-core/support.test.ts
- tests/selection/pattern-core/game.test.ts
- tests/selection/pattern-core/ai.test.ts
- tests/selection/pattern-core/commerce.test.ts
- tests/selection/pattern-core/enterprise.test.ts
- tests/fixtures/selection/pattern-core/{governance,product,engineering,ux,security,qa,data,growth,content,research,release,support,game,ai,commerce,enterprise}.expected.yaml.
- tests/selection/companion-core-first-half.test.ts
- tests/selection/companion-core-second-half.test.ts
- tests/selection/expand-companions.test.ts
- tests/planning/decompose-outcomes.test.ts
- tests/planning/merge-impacts.test.ts
- tests/planning/build-task-coverage.test.ts
- tests/planning/assign-task-packets.test.ts
- tests/planning/materialize-task-packet.test.ts
- tests/planning/validate-completion-packet.test.ts
- tests/planning/validate-claim-approval.test.ts
- tests/selection/compile-workstream.test.ts
- tests/golden/selection-planning.golden.test.ts
- tests/fixtures/selection/lifeof-referral.yaml
- tests/fixtures/selection/lifeof-purchase-security.yaml
- tests/fixtures/selection/lifeof-settings-ux.yaml
- tests/fixtures/selection/external-campaign.yaml
- tests/fixtures/selection/dinoescape-game-system.yaml
- tests/fixtures/selection/runtime-fixtures.ts

## Public Interfaces

src/selection/types.ts exports the following stable in-memory APIs. Objects marked as schema payloads use snake_case exactly because they are serialized or hashable.

    export type FeatureScalar = string | number | boolean;

    export interface FeatureObservation {
      id: string;
      valueType: "string" | "number" | "boolean" | "string-set";
      value: FeatureScalar | readonly string[];
      evidenceId: string;
      sourceKind?: "brief" | "path" | "record" | "profile" | "classifier";
      sourceRef: string;
      sourceText?: string | null;
      extractorId?: string;
      extractorVersion?: string;
    }

    export interface FeatureEvidence {
      evidence_id: string;
      source_kind: "brief" | "path" | "record" | "profile" | "classifier";
      source_ref: string;
      source_text: string | null;
      extractor_id: string;
      extractor_version: string;
    }

    export interface NormalizedFeature {
      id: string;
      value_type: "string" | "number" | "boolean" | "string-set";
      value: FeatureScalar | readonly string[];
      evidence: readonly FeatureEvidence[];
    }

    export interface NormalizedFeatureMap {
      schema_version: "1.0.0";
      features: Readonly<Record<string, NormalizedFeature>>;
    }

    export type PredicateOperator =
      | "equals"
      | "in"
      | "contains_token"
      | "path_exists"
      | "record_exists"
      | "tag_present"
      | "relationship_exists"
      | "regex";

    export interface FeaturePredicate {
      id: string;
      feature: string;
      operator: PredicateOperator;
      expected: FeatureScalar | readonly string[];
      evidence_required: boolean;
      weight?: number;
      penalty?: number;
    }

    export interface PredicateEvaluation {
      predicate_id: string;
      matched: boolean;
      code:
        | "predicate.matched"
        | "predicate.not_matched"
        | "predicate.feature_missing"
        | "predicate.evidence_missing"
        | "predicate.type_mismatch"
        | "predicate.regex_unanchored"
        | "predicate.regex_invalid";
      evidence_ids: readonly string[];
    }

    export interface SelectableDefinition<K extends "blueprint" | "pattern" = "blueprint" | "pattern"> {
      id: string;
      version: string;
      status: "active" | "deprecated" | "retired";
      kind: K;
      compatibility: {
        root_kinds: readonly string[];
        primary_archetypes: readonly string[];
        profile_ids: readonly string[];
        required_overlays: readonly string[];
        forbidden_overlays: readonly string[];
      };
      selection: {
        required_signals: readonly FeaturePredicate[];
        positive_signals: readonly FeaturePredicate[];
        negative_signals: readonly FeaturePredicate[];
        exclusions: readonly FeaturePredicate[];
        max_positive_weight: number;
        specificity_rank: number;
        precedence: number;
      };
      authorization: {
        mutation: "none" | "task-scoped" | "approval-required";
        external_action: "none" | "explicit-approval-required";
      };
    }

    export type BlueprintSelectableDefinition = SelectableDefinition<"blueprint">;
    export type PatternSelectableDefinition = SelectableDefinition<"pattern">;

    export interface SelectionContext {
      rootKind: string;
      primaryArchetype: string;
      profileId: string;
      overlayIds: readonly string[];
      lockedDefinitionIds: readonly string[];
      migrationAllowed: boolean;
    }

    export interface CandidateScore {
      definition_id: string;
      version: string;
      eligible: boolean;
      score: number;
      matched_positive_ids: readonly string[];
      matched_negative_ids: readonly string[];
      disqualification_codes: readonly string[];
      specificity_rank: number;
      precedence: number;
      authority_rank: number;
    }

    export interface SelectionDecision {
      disposition: "automatic" | "integrator_review" | "clarification_required";
      winner: CandidateScore | null;
      runner_up: CandidateScore | null;
      margin: number | null;
      ranked: readonly CandidateScore[];
    }

src/planning/types.ts exports these exact orchestration contracts:

    export type PatternMode =
      | "assess" | "plan" | "design" | "implement" | "change"
      | "validate" | "release" | "operate" | "retire";

    export interface OutcomeIntent {
      id: string;
      statement: string;
      primaryMode: PatternMode;
      acceptanceCriteria: readonly string[];
      authorityClass: "automatic-by-rule" | "integrator" | "Pitaji";
      releaseFate: "none" | "planned" | "production";
      canCompleteIndependently: boolean;
      dependsOnOutcomeIds: readonly string[];
    }

    export interface PatternRef {
      id: string;
      version: string;
      provenanceRuleIds: readonly string[];
    }

    export interface WorkstreamPatternSet {
      outcomePrimary: PatternRef;
      companions: readonly PatternRef[];
    }

    export type RequirementKind =
      | "duty" | "gate" | "evidence" | "output" | "record_update" | "approval";

    export interface WorkstreamRequirement {
      id: string;
      kind: RequirementKind;
      exclusive: boolean;
      coordinationRequired: boolean;
      sourcePatternIds: readonly string[];
    }

    export interface TaskAssignment {
      taskId: string;
      primaryPattern: PatternRef;
      coveredRequirementIds: readonly string[];
      claimedPaths: readonly string[];
      coordinationIds: readonly string[];
    }

    export interface CoverageMap {
      requirementTaskIds: Readonly<Record<string, readonly string[]>>;
      unassignedRequirementIds: readonly string[];
      duplicateExclusiveRequirementIds: readonly string[];
    }

    export interface TaskCandidate {
      taskId: string;
      primaryPatternId: string;
      requestedRequirementIds: readonly string[];
      claimedPaths: readonly string[];
      coordinationIds: readonly string[];
    }

    export interface TaskAssignmentInput {
      patternSet: WorkstreamPatternSet;
      requirements: readonly WorkstreamRequirement[];
      taskCandidates: readonly TaskCandidate[];
    }

    export type ImpactRequirement = "required" | "conditional" | "not_applicable";

    export interface ImpactEntry {
      sourceId: string;
      targetKind: "component" | "domain";
      targetId: string;
      requirement: ImpactRequirement;
      duties: readonly ("inspect" | "propose" | "modify" | "validate" | "approve" | "release" | "notify" | "record" | "no-touch")[];
      readPaths: readonly string[];
      writePaths: readonly string[];
      requiredEvidenceIds: readonly string[];
      requiredRecordTypes: readonly string[];
      responsibleRole: "worker" | "integrator" | "Pitaji";
    }

    export interface ImpactMergeInput {
      immutableImpacts: readonly ImpactEntry[];
      rootPolicyImpacts: readonly ImpactEntry[];
      overlayImpacts: readonly ImpactEntry[];
      patternImpacts: readonly ImpactEntry[];
      ownedPathsByTarget: Readonly<Record<string, readonly string[]>>;
      claimCandidatePaths: readonly string[];
      acceptedDecisionScopes: readonly (readonly string[])[];
      approvalScopes: readonly (readonly string[])[];
      dependencyEdges: readonly { from: string; to: string }[];
    }

TaskPacket, CompletionPacket, Claim, and Approval are TypeBox Static types exported from src/planning/contracts.ts. Their serialized fields mirror the approved specification's Flattened task-packet contract and Completion-packet contract exactly, including every nested claim, approval, authorization, duty-resolution, gate, evidence, record, output, and fallback field. They use additionalProperties: false at every object level; conditions and not_applicable values are forbidden in TaskPacket.

Every flattened packet gate has stable id and definition_ref plus this exact execution union; no shell string or runtime catalog lookup is allowed:

    export type GateType =
      | "test" | "lint" | "build" | "review" | "policy" | "render" | "external";

    export type GateExecution =
      | {
          kind: "command";
          executable: string;
          args: readonly string[];
          cwd: string;
          timeout_ms: number;
          env_allowlist: Readonly<Record<string, string>>;
        }
      | {
          kind: "check";
          instruction: string;
          verifier_role: "worker" | "integrator" | "Pitaji" | "external";
          approval_refs: readonly string[];
        };

    export interface ResolvedGateExecution {
      id: string;
      definition_ref: string;
      type: GateType;
      command_or_check: string;
      required: boolean;
      conflict_sensitive: boolean;
      evidence_type: string;
      execution: GateExecution;
    }

TaskPacket.gates is readonly ResolvedGateExecution[]. Governance imports this exact selection/planning-owned wrapper and must not duplicate it.

For `verifier_role: "external"`, `approval_refs` must be non-empty and valid for target/environment/scope/timing. For every other role it must be empty. Adapter/catalog gate definitions are resolved into this union before dispatch. `type` and `command_or_check` preserve the approved task-packet surface: for a check, `command_or_check` must exactly equal `execution.instruction`; for a command, it is a deterministic audit/display string derived from `executable`, literal `args`, and `cwd`. It is never parsed or executed. Only the structured `execution` union reaches governance.

TaskPacketInput is exact and contains packet: Omit<TaskPacket, "packet_id" | "claim"> plus claim: Omit<Claim, "id" | "issued_at" | "expires_at" | "last_heartbeat_at"> and claim_ttl_ms. materializeTaskPacket is the only function that creates those IDs and timestamps.

The exact public function signatures are:

    normalizeFeatureMap(
      observations: readonly FeatureObservation[],
    ): RuntimeResult<NormalizedFeatureMap>

    evaluatePredicate(
      predicate: FeaturePredicate,
      features: NormalizedFeatureMap,
    ): PredicateEvaluation

    scoreCandidates(
      definitions: readonly SelectableDefinition[],
      features: NormalizedFeatureMap,
      context: SelectionContext,
    ): RuntimeResult<SelectionDecision>

    selectBlueprint(
      definitions: readonly BlueprintSelectableDefinition[],
      features: NormalizedFeatureMap,
      context: SelectionContext,
    ): RuntimeResult<SelectionDecision>

    selectPattern(
      definitions: readonly PatternSelectableDefinition[],
      features: NormalizedFeatureMap,
      context: SelectionContext,
    ): RuntimeResult<SelectionDecision>

    loadResolvedPatterns(
      catalog: CatalogSource,
    ): RuntimeResult<ResolvedPatternCatalog>

    expandCompanions(
      input: CompanionExpansionInput,
    ): RuntimeResult<CompanionClosure>

    decomposeOutcomes(
      outcomes: readonly OutcomeIntent[],
    ): RuntimeResult<InitiativePlan>

    mergeImpacts(
      input: ImpactMergeInput,
    ): RuntimeResult<ResolvedImpactPlan>

    buildTaskCoverage(
      patternSet: WorkstreamPatternSet,
      requirements: readonly WorkstreamRequirement[],
      tasks: readonly TaskAssignment[],
    ): RuntimeResult<CoverageMap>

    assignTaskPackets(
      input: TaskAssignmentInput,
    ): RuntimeResult<readonly TaskAssignment[]>

    materializeTaskPacket(
      input: TaskPacketInput,
      clock: Clock,
      ids: IdFactory,
    ): RuntimeResult<TaskPacket>

    validateCompletionPacket(
      completion: CompletionPacket,
      task: TaskPacket,
      context: CompletionValidationContext,
    ): RuntimeResult<ValidatedCompletion>

    validateClaimAndApprovals(
      task: TaskPacket,
      context: AuthorityValidationContext,
    ): RuntimeResult<AuthorityValidation>

    compileWorkstream(
      input: CompileWorkstreamInput,
      clock: Clock,
      ids: IdFactory,
    ): Promise<RuntimeResult<CompileWorkstreamResult>>
## Pattern Core-Half Contract

Core halves own status, purpose, selection signals and anti-signals, composition semantics, duties, write scope, authorization, inputs, outputs, evidence, gates, memory updates, completion conditions, and fallback. Taxonomy halves own compatibility, component impacts, domain impacts, and overlay applicability because those fields bind to taxonomy registries. The merger allows only id and version in both halves and rejects every other overlapping key.

Every .core.yaml file has this exact top-level shape:

    id: engineering.feature.implement
    version: 1.0.0
    status: active
    purpose: Implement one accepted, bounded product feature.
    selection:
      feature_schema_version: 1.0.0
      required_signals:
        - id: mode-implement
          feature: action.mode
          operator: equals
          expected: implement
          evidence_required: true
      positive_signals:
        - id: feature-change
          feature: work.object
          operator: equals
          expected: feature
          evidence_required: true
          weight: 100
      negative_signals: []
      exclusions: []
      max_positive_weight: 100
      specificity_rank: 50
      precedence: 50
    composition:
      allowed_primary_pattern_ids: []
      mandatory_companion_rule_ids:
        - companion.mutation
      incompatible_pattern_ids: []
      triggers_companions: true
    duties:
      - modify
      - record
    write_scope:
      - claim-owned-paths
    authorization:
      mutation: task-scoped
      task_result_submission: worker
      factual_integration: integrator
      workstream_activation: automatic-by-rule
      directional_acceptance: Pitaji
      external_action: none
    inputs:
      - accepted-scope
      - accepted-decisions
    outputs:
      - implementation-change
    evidence:
      - exact-diff
      - required-gate-results
    gates:
      - claim-valid
      - scope-valid
      - companion-coverage-valid
    memory_updates:
      - change-record
      - evidence-record
    completion_conditions:
      - implementation-matches-accepted-scope
      - every-required-gate-has-evidence
    fallback_and_escalation:
      - stop-on-implicit-authority
      - route-direction-change-to-Pitaji

No core half may declare compatibility, component_impacts, domain_impacts, or overlay applicability. Assess and validate patterns use mutation: none. Release patterns use mutation: approval-required and external_action: explicit-approval-required. Retire patterns require Pitaji directional acceptance. Implement/change patterns may use task-scoped mutation only when the pattern is not in a higher-authority category and the accepted claim resolves non-empty write paths.
## Companion Core-Half Contract

Companion taxonomy halves own applicability bindings: root kinds, component types, artifact types, required overlays, and forbidden overlays. Companion core halves own status, purpose, executable when predicates, required pattern IDs/version ranges, required duties/evidence, selection/composition semantics, narrow-only authority effect, and fail-closed conflict policy. Assembly rejects every overlap beyond exact id/version.

Every companion .core.yaml has this exact shape:

    id: companion.mutation
    version: 1.0.0
    status: active
    purpose: Add evidence, documentation, and one validation track to mutation work.
    when:
      all:
        - id: mutation-mode
          feature: action.mode
          operator: in
          expected:
            - implement
            - change
          evidence_required: true
      any: []
      none: []
    require_patterns:
      - id: governance.evidence.validate
        version_range: ^1.0.0
        condition: true
      - id: governance.documentation.validate
        version_range: ^1.0.0
        condition: true
    require_duties:
      - validate
      - record
    require_evidence:
      - required-gate-results
    authority_effect: narrow-only
    conflict_policy: fail_closed

No companion core may declare applicability, root_kinds, component_types, artifact_types, required_overlays, or forbidden_overlays. The taxonomy half binds the rule to those registries; the core half decides the executable expansion once applicable.

The 13 approved rules are:

1. companion.mutation
2. companion.user-visible
3. companion.ui
4. companion.identity-security
5. companion.personal-data
6. companion.commerce
7. companion.contract-change
8. companion.supply-chain
9. companion.campaign
10. companion.ai
11. companion.game-system
12. companion.production-release
13. companion.retirement

## Task 1: Register Selection, Planning, and Packet Contracts

**Files:**

- Create src/selection/contracts/core.ts.
- Create src/selection/contracts/selection.ts.
- Create src/selection/contracts/resolved.ts.
- Create src/selection/contracts/index.ts.
- Create src/selection/index.ts.
- Create src/planning/contracts.ts.
- Create src/planning/index.ts.
- Create src/selection/types.ts.
- Create src/planning/types.ts.
- Create src/selection/load-pattern-halves.ts.
- Create tests/selection/load-pattern-halves.test.ts.

**Interfaces:** Produces every domain type and schema consumed by Tasks 2-27. Consumes RuntimeResult from src/contracts/runtime-result.ts and foundation schema/path/document primitives. Foundation retains exclusive ownership of src/contracts/** and src/schema/**. Catalog assembly imports the core-half types from src/selection/contracts/core.ts instead of redefining them.

- [ ] **Step 1: Write the failing contract-registration test**

    import { describe, expect, it } from "vitest";
    import { registerSelectionSchemas } from "../../src/selection/contracts/index.js";
    import { registerPlanningSchemas } from "../../src/planning/contracts.js";
    import { validateOwnedContracts } from "../../src/selection/load-pattern-halves.js";

    const EXPECTED_SCHEMA_IDS = [
      "project-memory/v1/approval",
      "project-memory/v1/claim",
      "project-memory/v1/companion-rule-core",
      "project-memory/v1/completion-packet",
      "project-memory/v1/normalized-feature-map",
      "project-memory/v1/pattern-core",
      "project-memory/v1/resolved-companion-rule",
      "project-memory/v1/resolved-pattern",
      "project-memory/v1/selection-result",
      "project-memory/v1/task-assignment",
      "project-memory/v1/task-packet",
      "project-memory/v1/workstream-pattern-set",
      "project-memory/v1/workstream-plan",
    ] as const;

    describe("selection/planning contracts", () => {
      it("registers the exact owned schema IDs once", () => {
        const ids = [...registerSelectionSchemas(), ...registerPlanningSchemas()].sort();
        expect(ids).toEqual(EXPECTED_SCHEMA_IDS);
        const result = validateOwnedContracts(EXPECTED_SCHEMA_IDS);
        expect(result.ok).toBe(true);
      });
    });

- [ ] **Step 2: Run the test and verify the expected failure**

    npm test -- tests/selection/load-pattern-halves.test.ts

Expected: FAIL because the contract modules and load-pattern-halves.ts are absent.

- [ ] **Step 3: Implement strict TypeBox contracts and the initial path-confined loaders**

Use each exact ID in EXPECTED_SCHEMA_IDS and additionalProperties: false at every object level. Serialized properties are snake_case. Export TypeBox Static types through src/selection/contracts/index.ts and src/planning/contracts.ts. registerSelectionSchemas and registerPlanningSchemas return their exact sorted schema-ID arrays after calling the foundation registerSchema function.

Dependency direction is exact: core.ts imports only TypeBox; catalog taxonomy contracts may import core.ts; resolved.ts may import catalog taxonomy schemas; catalog runtime must not import src/selection/index.ts. This prevents an ESM cycle while keeping core contracts selection-owned. src/selection/index.ts and src/planning/index.ts export only public contracts, types, and runtime functions.

In load-pattern-halves.ts, implement these initial interfaces:

    validateOwnedContracts(
      expectedSchemaIds: readonly string[],
    ): RuntimeResult<{ schema_ids: readonly string[] }>

    loadPatternCoreHalves(
      catalogRoot: URL,
      familyIds: readonly string[],
    ): Promise<RuntimeResult<readonly PatternCoreDefinition[]>>

    loadCompanionCoreHalves(
      catalogRoot: URL,
    ): Promise<RuntimeResult<readonly CompanionRuleCore[]>>

Await resolveInside for every requested directory before reading it. Discover files with Node fs readdir({ withFileTypes: true }), reject symlinks and non-files, sort by UTF-8 relative path, decode with TextDecoder("utf-8", { fatal: true }), parse with parseYamlDocument, and validate with the selection-owned core schema. Reject duplicate IDs, wrong filename/ID pairs, path escape, malformed UTF-8, and any .taxonomy.yaml input. Task 22 extends this module with half assembly; Tasks 4-21 can use the core-only loaders immediately.

- [ ] **Step 4: Run focused checks and verify emitted schemas in a temporary directory**

    npm test -- tests/selection/load-pattern-halves.test.ts
    npm run typecheck
    npm run build

In the test, register all 13 contracts, call emitJsonSchemas with a temporary output URL, and assert the 13 generated files contain the exact schema IDs and byte-identical output across two emissions. Do not edit schemas/project-memory/v1 by hand; central integration invokes the same foundation emitter after all subsystem registrars are wired.

Expected: PASS and exit code 0 for all commands; temporary output contains exactly the 13 owned schemas.

- [ ] **Step 5: Commit**

    git add src/selection/contracts src/selection/index.ts src/selection/types.ts src/selection/load-pattern-halves.ts src/planning/contracts.ts src/planning/index.ts src/planning/types.ts tests/selection/load-pattern-halves.test.ts
    git commit -m "feat(selection): register selection and packet contracts"

## Task 2: Feature Normalization and Predicate Evaluation

**Files:**

- Create src/selection/normalize-feature-map.ts.
- Create src/selection/evaluate-predicate.ts.
- Create tests/selection/normalize-feature-map.test.ts.
- Create tests/selection/evaluate-predicate.test.ts.

**Interfaces:** Implements normalizeFeatureMap and evaluatePredicate exactly. Produces deterministic predicate results for Task 3 scoring and Task 22 companion predicates.

- [ ] **Step 1: Write failing normalization and predicate tests**

    import { describe, expect, it } from "vitest";
    import { normalizeFeatureMap } from "../../src/selection/normalize-feature-map.js";
    import { evaluatePredicate } from "../../src/selection/evaluate-predicate.js";

    describe("normalized feature map", () => {
      it("sorts features and preserves evidence", () => {
        const result = normalizeFeatureMap([
          { id: "surface.ui", valueType: "boolean", value: true, evidenceId: "EVD-01J00000000000000000000002", sourceRef: "brief:2" },
          { id: "action.mode", valueType: "string", value: "implement", evidenceId: "EVD-01J00000000000000000000001", sourceRef: "brief:1" }
        ]);
        expect(result.ok).toBe(true);
        if (result.ok) expect(Object.keys(result.value.features)).toEqual(["action.mode", "surface.ui"]);
      });

      it("rejects unanchored regex predicates", () => {
        const map = normalizeFeatureMap([{ id: "request.text", valueType: "string", value: "audit settings", evidenceId: "EVD-01J00000000000000000000001", sourceRef: "brief:1" }]);
        if (!map.ok) throw new Error("fixture failed");
        const result = evaluatePredicate({ id: "p1", feature: "request.text", operator: "regex", expected: "audit", evidence_required: true }, map.value);
        expect(result.matched).toBe(false);
        expect(result.code).toBe("predicate.regex_unanchored");
      });
    });

- [ ] **Step 2: Verify the tests fail**

    npm test -- tests/selection/normalize-feature-map.test.ts tests/selection/evaluate-predicate.test.ts

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement deterministic normalization and all eight operators**

Reject conflicting typed values for one feature ID. Sort feature IDs, set values, and evidence IDs. Preserve exact source text and extractor version. Implement equals, in, contains_token, path_exists, record_exists, tag_present, relationship_exists, and anchored regex; an evidence-required predicate cannot match without evidence.

- [ ] **Step 4: Run focused tests and typecheck**

    npm test -- tests/selection/normalize-feature-map.test.ts tests/selection/evaluate-predicate.test.ts
    npm run typecheck

Expected: PASS.

- [ ] **Step 5: Commit**

    git add src/selection/normalize-feature-map.ts src/selection/evaluate-predicate.ts tests/selection/normalize-feature-map.test.ts tests/selection/evaluate-predicate.test.ts
    git commit -m "feat(selection): normalize evidence and evaluate predicates"

## Task 3: Executable Blueprint and Pattern Scoring

**Files:**

- Create src/selection/score-candidates.ts.
- Create tests/selection/score-candidates.test.ts.
- Create tests/fixtures/selection/runtime-fixtures.ts.

**Interfaces:** Implements `scoreCandidates`, `selectBlueprint`, and `selectPattern`. The typed wrappers accept only `BlueprintSelectableDefinition[]` or `PatternSelectableDefinition[]`, validate the runtime `kind`, and delegate unchanged inputs to `scoreCandidates`. `scoreCandidates` is the only executable scoring implementation and produces one `SelectionDecision` with the complete ranked trace; wrappers never reproduce scoring, confidence, precedence, or tie logic.

- [ ] **Step 1: Create the exact scoring fixture and failing boundary test**

In `tests/fixtures/selection/runtime-fixtures.ts`, export `scoringFeatures`, `scoringContext`, `patternScoringCandidates`, and structurally identical `blueprintScoringCandidates`; only the candidates' `kind` differs. Use this exact score setup:

    export const scoringFeatures: NormalizedFeatureMap = {
      schema_version: "1.0.0",
      features: {
        "action.mode": {
          id: "action.mode",
          value_type: "string",
          value: "implement",
          evidence: [{
            evidence_id: "EVD-01J00000000000000000000001",
            source_kind: "brief",
            source_ref: "brief:1",
            source_text: "Implement the referral flow",
            extractor_id: "fixture",
            extractor_version: "1.0.0",
          }],
        },
      },
    };

    export const scoringContext: SelectionContext = {
      rootKind: "product",
      primaryArchetype: "application-service",
      profileId: "profile.lifeof",
      overlayIds: ["overlay.surface.mobile-first"],
      lockedDefinitionIds: [],
      migrationAllowed: false,
    };

Create two active compatible candidates with max positive weight 100. Both have one matched positive predicate on action.mode = implement; its weight is 80 for engineering.feature.implement and 65 for engineering.integration.implement. Give each a second unmatched predicate carrying the remaining weight. Set winner/runner specificity, precedence, and authority equal so the result is determined by score only.

    import { blueprintScoringCandidates, patternScoringCandidates, scoringContext, scoringFeatures } from "../fixtures/selection/runtime-fixtures.js";
    import { scoreCandidates, selectBlueprint, selectPattern } from "../../src/selection/score-candidates.js";

    it("auto-selects only at score 80 with margin 15", () => {
      const result = scoreCandidates(patternScoringCandidates, scoringFeatures, scoringContext);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.disposition).toBe("automatic");
        expect(result.value.winner?.score).toBe(80);
        expect(result.value.margin).toBe(15);
      }
    });

    it("keeps typed wrappers byte-for-byte equivalent to the shared scorer", () => {
      expect(selectBlueprint(blueprintScoringCandidates, scoringFeatures, scoringContext))
        .toEqual(scoreCandidates(blueprintScoringCandidates, scoringFeatures, scoringContext));
      expect(selectPattern(patternScoringCandidates, scoringFeatures, scoringContext))
        .toEqual(scoreCandidates(patternScoringCandidates, scoringFeatures, scoringContext));
    });

- [ ] **Step 2: Verify failure**

    npm test -- tests/selection/score-candidates.test.ts

Expected: FAIL because scoreCandidates is missing.

- [ ] **Step 3: Implement the approved scoring algorithm and full matrix**

Reject retired definitions. Permit a deprecated definition only when its exact ID is already locked or `migrationAllowed` is true. Reject incompatible root kind, primary archetype, profile, required/forbidden overlays, missing required signals, and matched exclusions. Verify `max_positive_weight` equals the sum of positive weights and is greater than zero. Compute raw score, normalize, cap at 100, determine runner-up and margin, and tie-break by specificity, exact profile match, precedence, then least mutation/external authority. Remaining ties return `integrator_review`. Score 60-79 or margin below 15 returns `integrator_review`; below 60 returns `clarification_required`. Implement `selectBlueprint` and `selectPattern` as runtime-kind-checking one-line delegations to `scoreCandidates`; a mismatched kind returns `selection.candidate_kind_mismatch`. Add focused cases for every rejection, wrapper, and tie-break branch.

- [ ] **Step 4: Run the complete scoring matrix**

    npm test -- tests/selection/score-candidates.test.ts
    npm run typecheck

Expected: PASS for score normalization, definition status, compatibility, exclusion, runner-up, tie, least-authority, and all confidence-band cases.

- [ ] **Step 5: Commit**

    git add src/selection/score-candidates.ts tests/selection/score-candidates.test.ts tests/fixtures/selection/runtime-fixtures.ts
    git commit -m "feat(selection): add deterministic catalog scoring"

## Shared Pattern-Family Authoring Contract

Task 4 creates tests/helpers/pattern-core-family.ts. The helper loads one hand-authored expected-ID fixture, calls loadPatternCoreHalves for exactly one family, validates every file against PatternCoreSchema, and proves:

- fixture family/count/IDs match the approved normative inventory;
- filename equals full definition ID plus .core.yaml;
- every ID/version has exactly one taxonomy partner with the same version;
- status is active; purpose is bounded and non-empty;
- signals use only approved operators, positive weights are 1-100, and max_positive_weight equals their positive sum and is greater than zero;
- composition references existing pattern/companion IDs and meta patterns default triggers_companions to false;
- no core file declares compatibility, component_impacts, domain_impacts, root_kinds, component_types, artifact_types, required_overlays, or forbidden_overlays;
- duties, scope, authorization, inputs, outputs, evidence, gates, memory updates, completion, and fallback are explicit;
- assess/validate grant no mutation; release/publication/production operate requires scoped external approval; retire requires Pitaji directional acceptance; task-scoped mutation is limited to accepted routine work and declared write scope;
- shuffled filesystem order produces byte-identical canonical results.

Every expected fixture has exactly family, count, and ids keys. The ID arrays below are literal; copy them without additions, omissions, aliases, or generated inference.

## Task 4: Governance Pattern Core Family

**Files:** Create 15 files in catalog/project-memory/v1/patterns/governance/, tests/fixtures/selection/pattern-core/governance.expected.yaml, tests/selection/pattern-core/governance.test.ts, and tests/helpers/pattern-core-family.ts.

- [ ] **Write the failing family test**

    it("locks the 15 governance core contracts", async () => {
      await assertPatternCoreFamily({ family: "governance", expectedCount: 15, fixture: new URL("../../fixtures/selection/pattern-core/governance.expected.yaml", import.meta.url) });
    });

- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/governance.test.ts
```

Expected: FAIL listing all 15 absent core IDs.

- [ ] **Author exactly:** governance.context.assess, governance.scope.plan, governance.task.plan, governance.claim.operate, governance.decision.plan, governance.evidence.validate, governance.handoff.change, governance.integration.change, governance.documentation.change, governance.documentation.validate, governance.finding.change, governance.archive.operate, governance.postmortem.assess, governance.profile.change, governance.catalog.change.

Profile/catalog/directional decision changes require Pitaji; canonical integration is integrator-only; claims cannot grant integration; evidence/documentation validation is mutation none; archive operation cannot rewrite history.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/governance.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with exactly 15 unique governance cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/governance tests/fixtures/selection/pattern-core/governance.expected.yaml tests/selection/pattern-core/governance.test.ts tests/helpers/pattern-core-family.ts
git commit -m "feat(catalog): add governance pattern cores"
```

## Task 5: Product Pattern Core Family

**Files:** Create 16 files in catalog/project-memory/v1/patterns/product/, tests/fixtures/selection/pattern-core/product.expected.yaml, and tests/selection/pattern-core/product.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "product", expectedCount: 16, fixture: new URL("../../fixtures/selection/pattern-core/product.expected.yaml", import.meta.url) });

- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/product.test.ts
```

Expected: FAIL listing all 16 absent core IDs.

- [ ] **Author exactly:** product.discovery.assess, product.opportunity.assess, product.requirements.plan, product.prd.plan, product.prd.change, product.feature.design, product.acceptance.validate, product.roadmap.plan, product.rule.change, product.pricing.plan, product.pricing.change, product.experiment.plan, product.launch.plan, product.policy.change, product.feature.retire, product.root.retire.

Pricing, policy, rule, roadmap direction, launch direction, PRD acceptance, and retirement require Pitaji; assessments/validation grant no mutation; planning/design remains proposed until accepted.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/product.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with exactly 16 unique product cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/product tests/fixtures/selection/pattern-core/product.expected.yaml tests/selection/pattern-core/product.test.ts
git commit -m "feat(catalog): add product pattern cores"
```

## Task 6: Engineering Pattern Core Family

**Files:** Create 22 files in catalog/project-memory/v1/patterns/engineering/, tests/fixtures/selection/pattern-core/engineering.expected.yaml, and tests/selection/pattern-core/engineering.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "engineering", expectedCount: 22, fixture: new URL("../../fixtures/selection/pattern-core/engineering.expected.yaml", import.meta.url) });

- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/engineering.test.ts
```

Expected: FAIL listing all 22 absent core IDs.

- [ ] **Author exactly:** engineering.feature.design, engineering.feature.implement, engineering.bug.implement, engineering.refactor.implement, engineering.repository.change, engineering.architecture.design, engineering.architecture.change, engineering.code.retire, engineering.api.design, engineering.api.change, engineering.schema.design, engineering.schema.change, engineering.migration.plan, engineering.migration.implement, engineering.migration.validate, engineering.integration.implement, engineering.dependency.change, engineering.platform.change, engineering.configuration.change, engineering.feature-flag.operate, engineering.build-tool.change, engineering.automation.implement.

Implementation/change activates companion.mutation; API/schema activates contract-change; dependency/platform/build-tool activates supply-chain; production feature flags require approval; architecture requires accepted decision scope; migration validation grants no mutation.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/engineering.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with exactly 22 unique engineering cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/engineering tests/fixtures/selection/pattern-core/engineering.expected.yaml tests/selection/pattern-core/engineering.test.ts
git commit -m "feat(catalog): add engineering pattern cores"
```

## Task 7: UX Pattern Core Family

**Files:** Create 16 files in catalog/project-memory/v1/patterns/ux/, tests/fixtures/selection/pattern-core/ux.expected.yaml, and tests/selection/pattern-core/ux.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "ux", expectedCount: 16, fixture: new URL("../../fixtures/selection/pattern-core/ux.expected.yaml", import.meta.url) });

- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/ux.test.ts
```

Expected: FAIL listing all 16 absent core IDs.

- [ ] **Author exactly:** ux.research.assess, ux.flow.assess, ux.flow.design, ux.information-architecture.design, ux.interaction.design, ux.visual.design, ux.prototype.design, ux.copy.design, ux.accessibility.assess, ux.accessibility.change, ux.design-system.assess, ux.design-system.change, ux.responsive.validate, ux.localization.validate, ux.visual.validate, ux.handoff.change.

Assess/validate grants no mutation; design outputs are proposed; user-visible changes activate user-visible and UI companions; accessibility/design-system mutation is claim-scoped; visual deliverables require exact target-surface evidence.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/ux.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with exactly 16 unique UX cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/ux tests/fixtures/selection/pattern-core/ux.expected.yaml tests/selection/pattern-core/ux.test.ts
git commit -m "feat(catalog): add UX pattern cores"
```

## Task 8: Security Pattern Core Family

**Files:** Create 18 files in catalog/project-memory/v1/patterns/security/, tests/fixtures/selection/pattern-core/security.expected.yaml, and tests/selection/pattern-core/security.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "security", expectedCount: 18, fixture: new URL("../../fixtures/selection/pattern-core/security.expected.yaml", import.meta.url) });

- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/security.test.ts
```

Expected: FAIL listing all 18 absent core IDs.

- [ ] **Author exactly:** security.posture.assess, security.threat-model.assess, security.auth.assess, security.auth.change, security.authorization.assess, security.authorization.change, security.data.assess, security.privacy.assess, security.privacy.change, security.consent.assess, security.secrets.assess, security.dependency.assess, security.supply-chain.assess, security.compliance.assess, security.compliance.change, security.finding.validate, security.remediation.implement, security.incident.operate.

Assessments/finding validation grant no mutation; auth/authorization/privacy/compliance changes require approval; remediation is limited to an accepted finding and claim; incident operation requires scoped authority; evidence never exposes secrets.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/security.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with exactly 18 unique security cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/security tests/fixtures/selection/pattern-core/security.expected.yaml tests/selection/pattern-core/security.test.ts
git commit -m "feat(catalog): add security pattern cores"
```

## Task 9: QA Pattern Core Family

**Files:** Create 14 files in catalog/project-memory/v1/patterns/qa/, tests/fixtures/selection/pattern-core/qa.expected.yaml, and tests/selection/pattern-core/qa.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "qa", expectedCount: 14, fixture: new URL("../../fixtures/selection/pattern-core/qa.expected.yaml", import.meta.url) });

- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/qa.test.ts
```

Expected: FAIL listing all 14 absent core IDs.

- [ ] **Author exactly:** qa.strategy.plan, qa.unit.validate, qa.integration.validate, qa.e2e.validate, qa.regression.validate, qa.visual.validate, qa.accessibility.validate, qa.performance.assess, qa.performance.change, qa.reliability.assess, qa.compatibility.validate, qa.release.validate, qa.defect.assess, qa.test-automation.implement.

Validate/assess grants no mutation; performance change/test automation activates mutation companion; release validation cannot release; visual gates require render evidence; not-run required gates block completion.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/qa.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with exactly 14 unique QA cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/qa tests/fixtures/selection/pattern-core/qa.expected.yaml tests/selection/pattern-core/qa.test.ts
git commit -m "feat(catalog): add QA pattern cores"
```

## Task 10: Data Pattern Core Family

**Files:** Create 16 files in catalog/project-memory/v1/patterns/data/, tests/fixtures/selection/pattern-core/data.expected.yaml, and tests/selection/pattern-core/data.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "data", expectedCount: 16, fixture: new URL("../../fixtures/selection/pattern-core/data.expected.yaml", import.meta.url) });

- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/data.test.ts
```

Expected: FAIL listing all 16 absent core IDs.

- [ ] **Author exactly:** data.requirement.plan, data.instrumentation.design, data.instrumentation.implement, data.instrumentation.validate, data.quality.assess, data.pipeline.design, data.pipeline.implement, data.schema.change, data.migration.validate, data.analysis.assess, data.metric.design, data.dashboard.implement, data.experiment.design, data.experiment.validate, data.governance.assess, data.retention.change.

Personal-data instrumentation/retention activates personal-data; schema changes activate contract-change; assess/validate grants no mutation; pipeline/instrumentation/dashboard mutation is claim-scoped; retention direction requires Pitaji.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/data.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with exactly 16 unique data cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/data tests/fixtures/selection/pattern-core/data.expected.yaml tests/selection/pattern-core/data.test.ts
git commit -m "feat(catalog): add data pattern cores"
```

## Task 11: Growth Pattern Core Family

**Files:** Create 16 files in catalog/project-memory/v1/patterns/growth/, tests/fixtures/selection/pattern-core/growth.expected.yaml, and tests/selection/pattern-core/growth.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "growth", expectedCount: 16, fixture: new URL("../../fixtures/selection/pattern-core/growth.expected.yaml", import.meta.url) });

- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/growth.test.ts
```

Expected: FAIL listing all 16 absent core IDs.

- [ ] **Author exactly:** growth.strategy.plan, growth.campaign.plan, growth.campaign.implement, growth.campaign.release, growth.positioning.design, growth.offer.design, growth.funnel.assess, growth.acquisition.plan, growth.lifecycle.plan, growth.referral.design, growth.store-listing.change, growth.seo.change, growth.measurement.design, growth.creative.design, growth.pricing.assess, growth.partnership.plan.

Campaign work activates campaign companion; release/publication requires scoped approval; in-product campaign mutation adds engineering only when paths prove it; pricing remains assessment/proposal; store listing/SEO require target evidence.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/growth.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with exactly 16 unique growth cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/growth tests/fixtures/selection/pattern-core/growth.expected.yaml tests/selection/pattern-core/growth.test.ts
git commit -m "feat(catalog): add growth pattern cores"
```
## Task 12: Content Pattern Core Family

**Files:** Create 13 cores in catalog/project-memory/v1/patterns/content/, tests/fixtures/selection/pattern-core/content.expected.yaml, and tests/selection/pattern-core/content.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "content", expectedCount: 13, fixture: new URL("../../fixtures/selection/pattern-core/content.expected.yaml", import.meta.url) });
- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/content.test.ts
```

Expected: FAIL listing 13 absent IDs.

- [ ] **Author exactly:** content.strategy.plan, content.editorial.plan, content.copy.design, content.asset.implement, content.review.validate, content.publish.release, content.localization.plan, content.localization.implement, content.accessibility.validate, content.rights.assess, content.taxonomy.design, content.archive.operate, content.material.retire.

Review/accessibility/rights grants no mutation; publication requires external approval and rights evidence; localization/assets activate mutation; archive/retire preserves immutable history and checks affected audiences.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/content.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with 13 unique content cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/content tests/fixtures/selection/pattern-core/content.expected.yaml tests/selection/pattern-core/content.test.ts
git commit -m "feat(catalog): add content pattern cores"
```

## Task 13: Research Pattern Core Family

**Files:** Create 12 cores in catalog/project-memory/v1/patterns/research/, tests/fixtures/selection/pattern-core/research.expected.yaml, and tests/selection/pattern-core/research.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "research", expectedCount: 12, fixture: new URL("../../fixtures/selection/pattern-core/research.expected.yaml", import.meta.url) });
- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/research.test.ts
```

Expected: FAIL listing 12 absent IDs.

- [ ] **Author exactly:** research.question.plan, research.protocol.design, research.source.assess, research.user.assess, research.market.assess, research.competitor.assess, research.literature.assess, research.experiment.implement, research.analysis.assess, research.finding.validate, research.synthesis.change, research.reproducibility.validate.

Assessment/validation grants no mutation; participant/personal-data work activates privacy; experiments require protocol/evidence; synthesis cannot accept direction; publication uses finding/reproducibility gates, not software regression.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/research.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with 12 unique research cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/research tests/fixtures/selection/pattern-core/research.expected.yaml tests/selection/pattern-core/research.test.ts
git commit -m "feat(catalog): add research pattern cores"
```

## Task 14: Release Pattern Core Family

**Files:** Create 14 cores in catalog/project-memory/v1/patterns/release/, tests/fixtures/selection/pattern-core/release.expected.yaml, and tests/selection/pattern-core/release.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "release", expectedCount: 14, fixture: new URL("../../fixtures/selection/pattern-core/release.expected.yaml", import.meta.url) });
- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/release.test.ts
```

Expected: FAIL listing 14 absent IDs.

- [ ] **Author exactly:** release.readiness.validate, release.execution.plan, release.build.validate, release.migration.validate, release.rollback.plan, release.notes.change, release.deployment.release, release.store.release, release.feature-flag.operate, release.monitor.operate, release.communication.release, release.hotfix.release, release.postrelease.assess, release.asset.retire.

Validate/plan/assess does not execute release; every release/production operate requires target/environment/scope/timing approval; deployment/store/hotfix activates production-release; rollback/monitoring is required; retirement preserves records.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/release.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with 14 unique release cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/release tests/fixtures/selection/pattern-core/release.expected.yaml tests/selection/pattern-core/release.test.ts
git commit -m "feat(catalog): add release pattern cores"
```

## Task 15: Support Pattern Core Family

**Files:** Create 12 cores in catalog/project-memory/v1/patterns/support/, tests/fixtures/selection/pattern-core/support.expected.yaml, and tests/selection/pattern-core/support.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "support", expectedCount: 12, fixture: new URL("../../fixtures/selection/pattern-core/support.expected.yaml", import.meta.url) });
- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/support.test.ts
```

Expected: FAIL listing 12 absent IDs.

- [ ] **Author exactly:** support.request.assess, support.issue.assess, support.incident.operate, support.problem.assess, support.knowledge.change, support.sop.change, support.escalation.operate, support.service.validate, support.root-cause.assess, support.remediation.change, support.maintenance.operate, support.deprecation.retire.

Assessment/service validation grants no mutation; incident/escalation/maintenance needs operate authority; remediation is limited to accepted findings; knowledge/SOP needs review; deprecation activates retirement.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/support.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with 12 unique support cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/support tests/fixtures/selection/pattern-core/support.expected.yaml tests/selection/pattern-core/support.test.ts
git commit -m "feat(catalog): add support pattern cores"
```

## Task 16: Game Pattern Core Family

**Files:** Create 20 cores in catalog/project-memory/v1/patterns/game/, tests/fixtures/selection/pattern-core/game.expected.yaml, and tests/selection/pattern-core/game.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "game", expectedCount: 20, fixture: new URL("../../fixtures/selection/pattern-core/game.expected.yaml", import.meta.url) });
- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/game.test.ts
```

Expected: FAIL listing 20 absent IDs.

- [ ] **Author exactly:** game.mechanic.design, game.mechanic.implement, game.loop.design, game.progression.design, game.economy.design, game.economy.change, game.balance.assess, game.balance.change, game.level.design, game.narrative.design, game.save.change, game.save.validate, game.multiplayer.implement, game.telemetry.implement, game.telemetry.validate, game.playtest.validate, game.content.release, game.live-operations.operate, game.anti-cheat.assess, game.certification.validate.

System changes activate game-system; competitive/valuable state adds anti-cheat; save change needs save validation/migration evidence; economy direction requires Pitaji; live operations/release needs approval; assess/validate grants no mutation.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/game.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with 20 unique game cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/game tests/fixtures/selection/pattern-core/game.expected.yaml tests/selection/pattern-core/game.test.ts
git commit -m "feat(catalog): add game pattern cores"
```

## Task 17: AI Pattern Core Family

**Files:** Create 20 cores in catalog/project-memory/v1/patterns/ai/, tests/fixtures/selection/pattern-core/ai.expected.yaml, and tests/selection/pattern-core/ai.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "ai", expectedCount: 20, fixture: new URL("../../fixtures/selection/pattern-core/ai.expected.yaml", import.meta.url) });
- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/ai.test.ts
```

Expected: FAIL listing 20 absent IDs.

- [ ] **Author exactly:** ai.use-case.plan, ai.data.assess, ai.model.assess, ai.model.implement, ai.prompt.design, ai.prompt.change, ai.retrieval.design, ai.retrieval.implement, ai.tooling.implement, ai.evaluation.design, ai.evaluation.validate, ai.safety.assess, ai.guardrail.implement, ai.human-review.design, ai.serving.implement, ai.cost.assess, ai.latency.assess, ai.drift.operate, ai.monitoring.operate, ai.model.retire.

AI mutation activates AI and mutation companions; evaluation/safety/privacy/cost/latency evidence is explicit; human review follows risk; production serving/monitoring needs operate approval; retirement preserves lineage/rollback.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/ai.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with 20 unique AI cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/ai tests/fixtures/selection/pattern-core/ai.expected.yaml tests/selection/pattern-core/ai.test.ts
git commit -m "feat(catalog): add AI pattern cores"
```

## Task 18: Commerce Pattern Core Family

**Files:** Create 17 cores in catalog/project-memory/v1/patterns/commerce/, tests/fixtures/selection/pattern-core/commerce.expected.yaml, and tests/selection/pattern-core/commerce.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "commerce", expectedCount: 17, fixture: new URL("../../fixtures/selection/pattern-core/commerce.expected.yaml", import.meta.url) });
- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/commerce.test.ts
```

Expected: FAIL listing 17 absent IDs.

- [ ] **Author exactly:** commerce.catalog.change, commerce.checkout.design, commerce.checkout.implement, commerce.payment.implement, commerce.entitlement.implement, commerce.entitlement.validate, commerce.pricing.change, commerce.order.implement, commerce.booking.implement, commerce.settlement.validate, commerce.reconciliation.validate, commerce.fraud.assess, commerce.dispute.operate, commerce.refund.operate, commerce.tax.assess, commerce.policy.validate, commerce.marketplace.validate.

Money/reward/order/entitlement mutation activates commerce; pricing requires Pitaji; payment/refund/dispute requires target/environment/scope/timing approval; validate/assess grants no mutation; reconciliation/entitlement evidence is mandatory.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/commerce.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with 17 unique commerce cores.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/commerce tests/fixtures/selection/pattern-core/commerce.expected.yaml tests/selection/pattern-core/commerce.test.ts
git commit -m "feat(catalog): add commerce pattern cores"
```

## Task 19: Enterprise Pattern Core Family

**Files:** Create 16 cores in catalog/project-memory/v1/patterns/enterprise/, tests/fixtures/selection/pattern-core/enterprise.expected.yaml, and tests/selection/pattern-core/enterprise.test.ts.

- [ ] **Write test:** await assertPatternCoreFamily({ family: "enterprise", expectedCount: 16, fixture: new URL("../../fixtures/selection/pattern-core/enterprise.expected.yaml", import.meta.url) });
- [ ] **Run failure:**

```powershell
npm test -- tests/selection/pattern-core/enterprise.test.ts
```

Expected: FAIL listing 16 absent IDs.

- [ ] **Author exactly:** enterprise.requirement.plan, enterprise.integration.design, enterprise.integration.implement, enterprise.identity.change, enterprise.rbac.design, enterprise.rbac.implement, enterprise.audit.validate, enterprise.compliance.validate, enterprise.migration.plan, enterprise.migration.implement, enterprise.rollout.plan, enterprise.training.implement, enterprise.change-management.operate, enterprise.sla.validate, enterprise.procurement.assess, enterprise.tenancy.design.

Identity/RBAC activates identity-security; integration/schema activates contract-change; compliance/audit/SLA validation grants no mutation; rollout/change-management needs approval; tenancy/requirements direction requires Pitaji.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/pattern-core/enterprise.test.ts tests/selection/load-pattern-halves.test.ts
npm run typecheck
```

Expected: PASS with 16 enterprise cores and 257 unique cores across all family fixtures.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/patterns/enterprise tests/fixtures/selection/pattern-core/enterprise.expected.yaml tests/selection/pattern-core/enterprise.test.ts
git commit -m "feat(catalog): add enterprise pattern cores"
```
## Task 20: Companion Core Halves, Rules 1-7

**Files:** Create companion.mutation.core.yaml, companion.user-visible.core.yaml, companion.ui.core.yaml, companion.identity-security.core.yaml, companion.personal-data.core.yaml, companion.commerce.core.yaml, companion.contract-change.core.yaml, tests/fixtures/selection/companion-core/first-seven.expected.yaml, and tests/selection/companion-core-first-half.test.ts.

- [ ] **Write the failing test**

    const FIRST_SEVEN_IDS = ["companion.mutation", "companion.user-visible", "companion.ui", "companion.identity-security", "companion.personal-data", "companion.commerce", "companion.contract-change"];
    const result = await loadCompanionCoreHalves(new URL("../../catalog/project-memory/v1/", import.meta.url));
    expect(result.ok && result.value.filter(rule => FIRST_SEVEN_IDS.includes(rule.id)).length).toBe(7);

The fixture repeats these seven literal IDs and count 7.

- [ ] **Run failure:**

```powershell
npm test -- tests/selection/companion-core-first-half.test.ts
```

Expected: FAIL listing seven absent IDs.

- [ ] **Author exact mappings:** mutation always adds evidence and documentation validation plus exactly one artifact track: code/runtime to regression, design to visual, content/media to content review, research to reproducibility, data to quality, AI to evaluation, process/SOP to service validation. Implement the approved user-visible, UI, identity/security, personal-data, commerce, and contract-change tables. Core owns when/conditions and requirements; taxonomy owns applicability. authority_effect is narrow-only; conflict_policy is fail_closed.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/companion-core-first-half.test.ts
npm run typecheck
```

Expected: PASS with seven unique cores, exact references, one validation track per artifact class, and no applicability keys.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/companion-rules tests/fixtures/selection/companion-core/first-seven.expected.yaml tests/selection/companion-core-first-half.test.ts
git commit -m "feat(catalog): add first seven companion cores"
```
## Task 21: Companion Core Halves, Rules 8-13

**Files:** Create companion.supply-chain.core.yaml, companion.campaign.core.yaml, companion.ai.core.yaml, companion.game-system.core.yaml, companion.production-release.core.yaml, companion.retirement.core.yaml, tests/fixtures/selection/companion-core/last-six.expected.yaml, and tests/selection/companion-core-second-half.test.ts.

- [ ] **Write the failing test**

    const LAST_SIX_IDS = ["companion.supply-chain", "companion.campaign", "companion.ai", "companion.game-system", "companion.production-release", "companion.retirement"];
    const result = await loadCompanionCoreHalves(new URL("../../catalog/project-memory/v1/", import.meta.url));
    expect(result.ok && result.value.filter(rule => LAST_SIX_IDS.includes(rule.id)).length).toBe(6);

The fixture repeats these six literal IDs and count 6.

- [ ] **Run failure:**

```powershell
npm test -- tests/selection/companion-core-second-half.test.ts
```

Expected: FAIL listing six absent IDs.

- [ ] **Author exact mappings:** supply-chain adds supply-chain assessment, compatibility, and build validation. Campaign adds content review and measurement, with engineering/release only for resolved in-product/instrumentation paths. AI adds evaluation, safety, privacy, cost, latency, and monitoring. Game-system adds balance, telemetry, playtest, save validation, and conditional anti-cheat. Production-release adds rollback, monitoring, communication, and support readiness without granting execution. Retirement always adds context/archive and conditionally technical migration/audience communication. Core contains no taxonomy applicability fields.

- [ ] **Verify:**

```powershell
npm test -- tests/selection/companion-core-first-half.test.ts tests/selection/companion-core-second-half.test.ts
npm run typecheck
```

Expected: PASS with 13 total companion cores and no dangling pattern reference.

- [ ] **Commit:**

```powershell
git add catalog/project-memory/v1/companion-rules tests/fixtures/selection/companion-core/last-six.expected.yaml tests/selection/companion-core-second-half.test.ts
git commit -m "feat(catalog): complete companion cores"
```
## Task 22: Half Merging and Fixed-Point Companion Closure

**Files:**

- Modify src/selection/load-pattern-halves.ts.
- Create src/selection/expand-companions.ts.
- Create tests/selection/expand-companions.test.ts.
- Modify tests/selection/load-pattern-halves.test.ts.

**Interfaces:** Implements loadResolvedPatterns and expandCompanions. Produces exact-version, stable-sorted pattern sets with provenance. Catalog loading and taxonomy ownership remain in src/catalog; this task performs runtime assembly and closure only.

- [ ] **Step 1: Write failing merge and closure tests against the real catalog halves**

    import { loadCatalog } from "../../src/catalog/index.js";
    import { normalizeFeatureMap } from "../../src/selection/normalize-feature-map.js";
    import { expandCompanions } from "../../src/selection/expand-companions.js";
    import { loadResolvedPatterns } from "../../src/selection/load-pattern-halves.js";

    it("expands mutation companions to a stable fixed point", async () => {
      const catalog = await loadCatalog(new URL("../../catalog/project-memory/v1/", import.meta.url));
      const resolved = loadResolvedPatterns(catalog);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;

      const features = normalizeFeatureMap([
        { id: "action.mode", valueType: "string", value: "implement", evidenceId: "EVD-01J00000000000000000000001", sourceRef: "brief:1" },
        { id: "artifact.classes", valueType: "string-set", value: ["code/runtime"], evidenceId: "EVD-01J00000000000000000000002", sourceRef: "brief:2" },
      ]);
      if (!features.ok) throw new Error("fixture normalization failed");

      const result = expandCompanions({
        catalog: resolved.value,
        initialPatternIds: ["engineering.feature.implement"],
        features: features.value,
        applicability: {
          rootKind: "product",
          componentTypes: ["application"],
          artifactTypes: ["code/runtime"],
          overlayIds: [],
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.patterns.map(pattern => pattern.id)).toEqual([
          "engineering.feature.implement",
          "governance.documentation.validate",
          "governance.evidence.validate",
          "qa.regression.validate",
        ]);
      }
    });

Add a merge test that deletes one taxonomy half from an in-memory CatalogSource clone and expects pattern.missing_taxonomy_half. Add a second closure test with the initial patterns shuffled and assert byte-identical canonical JSON.

- [ ] **Step 2: Verify failure**

    npm test -- tests/selection/load-pattern-halves.test.ts tests/selection/expand-companions.test.ts

Expected: FAIL because runtime half assembly and fixed-point expansion are absent.

- [ ] **Step 3: Implement exact half assembly and bounded closure**

loadResolvedPatterns accepts CatalogSource. Require one core and one taxonomy half per manifest ID with matching ID/version. Call catalog-owned assemblePatternDefinition and assembleCompanionRule only after proving the halves do not overlap beyond id/version. Pattern taxonomy contributes compatibility, component_impacts, domain_impacts, and overlay applicability; pattern core contributes purpose, selection, composition, duties, write scope, authority, evidence, gates, records, completion, and fallback. Companion taxonomy contributes applicability bindings; companion core contributes executable conditions and expansion requirements.

For expandCompanions, start from unique initial pattern IDs sorted by UTF-8 bytes. Evaluate taxonomy applicability, then core when/condition predicates. Lock each added pattern to the exact resolved version, attach source rule and source pattern provenance, deduplicate, and repeat until no additions occur. Stop after at most resolvedPatternCount + resolvedCompanionCount iterations. Fail on version conflict, incompatible pair, authority expansion, zero or multiple validation tracks for one artifact class, unresolved condition, or expansion bound. Meta patterns do not trigger companions unless their core composition explicitly allowlists it.

- [ ] **Step 4: Run complete catalog and closure tests**

    npm test -- tests/selection/load-pattern-halves.test.ts tests/selection/expand-companions.test.ts tests/selection/pattern-core
    npm run typecheck

Expected: PASS; assembly rejects ownership overlap, and closure is byte-stable across shuffled inputs.

- [ ] **Step 5: Commit**

    git add src/selection/load-pattern-halves.ts src/selection/expand-companions.ts tests/selection/load-pattern-halves.test.ts tests/selection/expand-companions.test.ts
    git commit -m "feat(selection): assemble catalog halves and expand companions"

## Task 23: Outcome Decomposition and Impact Merge

**Files:**

- Create src/planning/decompose-outcomes.ts.
- Create src/planning/merge-impacts.ts.
- Create tests/planning/decompose-outcomes.test.ts.
- Create tests/planning/merge-impacts.test.ts.

**Interfaces:** Implements decomposeOutcomes and mergeImpacts. Consumes selected patterns, taxonomy-owned component/domain impacts, locked profile components/domains, overlays, accepted decisions, approvals, and exact resolved paths.

- [ ] **Step 1: Write failing decomposition and conflict tests with complete inputs**

    const compoundOutcomes: readonly OutcomeIntent[] = [
      {
        id: "outcome.settings-audit",
        statement: "Audit the settings flow",
        primaryMode: "assess",
        acceptanceCriteria: ["Evidence-backed findings are recorded"],
        authorityClass: "integrator",
        releaseFate: "none",
        canCompleteIndependently: true,
        dependsOnOutcomeIds: [],
      },
      {
        id: "outcome.settings-redesign",
        statement: "Redesign the accepted settings problems",
        primaryMode: "design",
        acceptanceCriteria: ["A reviewed design resolves accepted findings"],
        authorityClass: "Pitaji",
        releaseFate: "none",
        canCompleteIndependently: true,
        dependsOnOutcomeIds: ["outcome.settings-audit"],
      },
      {
        id: "outcome.settings-implementation",
        statement: "Implement the accepted settings design",
        primaryMode: "implement",
        acceptanceCriteria: ["The accepted design is implemented and validated"],
        authorityClass: "integrator",
        releaseFate: "planned",
        canCompleteIndependently: true,
        dependsOnOutcomeIds: ["outcome.settings-redesign"],
      },
    ];

    it("splits audit, redesign, and implementation into sibling workstreams", () => {
      const result = decomposeOutcomes(compoundOutcomes);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.workstreams.map(item => item.primaryMode)).toEqual(["assess", "design", "implement"]);
    });

    const notApplicableConflict: ImpactMergeInput = {
      immutableImpacts: [{
        sourceId: "policy.settings.no-touch",
        targetKind: "component",
        targetId: "CMP-01J00000000000000000000001",
        requirement: "not_applicable",
        duties: ["no-touch"],
        readPaths: [],
        writePaths: [],
        requiredEvidenceIds: [],
        requiredRecordTypes: [],
        responsibleRole: "Pitaji",
      }],
      rootPolicyImpacts: [],
      overlayImpacts: [],
      patternImpacts: [{
        sourceId: "pattern.ux.flow.design",
        targetKind: "component",
        targetId: "CMP-01J00000000000000000000001",
        requirement: "required",
        duties: ["modify"],
        readPaths: ["lib/features/settings/**"],
        writePaths: ["lib/features/settings/**"],
        requiredEvidenceIds: ["ux-review"],
        requiredRecordTypes: ["change"],
        responsibleRole: "worker",
      }],
      ownedPathsByTarget: { "CMP-01J00000000000000000000001": ["lib/features/settings/**"] },
      claimCandidatePaths: ["lib/features/settings/**"],
      acceptedDecisionScopes: [],
      approvalScopes: [],
      dependencyEdges: [],
    };

    it("rejects required impact against a not-applicable component", () => {
      const result = mergeImpacts(notApplicableConflict);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0]?.code).toBe("impact.required_not_applicable");
    });

- [ ] **Step 2: Verify failures**

    npm test -- tests/planning/decompose-outcomes.test.ts tests/planning/merge-impacts.test.ts

Expected: FAIL because both functions are absent.

- [ ] **Step 3: Implement fail-closed planning rules and the complete merge matrix**

Split outcomes when terminal acceptance, primary mode, authority, rollback/release fate, or independent completion differs. Preserve explicit dependency edges and reject cycles in outcome dependencies.

Merge immutable policy, root policy, overlays, then pattern taxonomy impacts. not_applicable conflicts with required; otherwise required outranks conditional. Union inspection, validation, evidence, and record duties. Reject no-touch against modify/release/notify. Intersect pattern write paths, component/domain owned paths, claim candidates, accepted-decision scopes, and applicable approval scopes; an absent non-required decision/approval scope is universal, while a missing required approval is an error. Empty intersection means no mutation. Expand dependency edges with a visited set; collapse read/validation cycles, but require explicit per-target paths and coordinated claims for mutation across a cycle.

Add exact tests for these issue codes: impact.no_touch_conflict, impact.empty_write_scope, impact.missing_required_approval, impact.dependency_cycle_uncoordinated, and impact.unknown_target. Also assert source IDs and precedence provenance survive every successful merge.

- [ ] **Step 4: Run planning tests and typecheck**

    npm test -- tests/planning/decompose-outcomes.test.ts tests/planning/merge-impacts.test.ts
    npm run typecheck

Expected: PASS for compound outcomes, authority differences, not-applicable conflict, no-touch conflict, empty write scope, and coordinated/uncoordinated dependency cycles.

- [ ] **Step 5: Commit**

    git add src/planning/decompose-outcomes.ts src/planning/merge-impacts.ts tests/planning/decompose-outcomes.test.ts tests/planning/merge-impacts.test.ts
    git commit -m "feat(planning): decompose outcomes and merge impacts"

## Task 24: Workstream Pattern Ownership and Task Coverage

**Files:**

- Create src/planning/build-task-coverage.ts.
- Create src/planning/assign-task-packets.ts.
- Create tests/planning/build-task-coverage.test.ts.
- Create tests/planning/assign-task-packets.test.ts.

**Interfaces:** Implements buildTaskCoverage and assignTaskPackets. It returns deterministic assignments and coverage reports; it does not dispatch workers, create claims, or create worktrees.

- [ ] **Step 1: Write failing ownership and coverage tests with one mutation owner**

    const patternSet: WorkstreamPatternSet = {
      outcomePrimary: {
        id: "engineering.feature.implement",
        version: "1.0.0",
        provenanceRuleIds: [],
      },
      companions: [{
        id: "qa.regression.validate",
        version: "1.0.0",
        provenanceRuleIds: ["companion.mutation"],
      }],
    };

    const requirements: readonly WorkstreamRequirement[] = [
      {
        id: "requirement.modify-referral",
        kind: "duty",
        exclusive: true,
        coordinationRequired: false,
        sourcePatternIds: ["engineering.feature.implement"],
      },
      {
        id: "requirement.regression-gate",
        kind: "gate",
        exclusive: false,
        coordinationRequired: true,
        sourcePatternIds: ["qa.regression.validate"],
      },
    ];

    const assignmentInput: TaskAssignmentInput = {
      patternSet,
      requirements,
      taskCandidates: [
        {
          taskId: "TASK-01J00000000000000000000001",
          primaryPatternId: "engineering.feature.implement",
          requestedRequirementIds: ["requirement.modify-referral"],
          claimedPaths: ["lib/features/referral/**"],
          coordinationIds: [],
        },
        {
          taskId: "TASK-01J00000000000000000000002",
          primaryPatternId: "qa.regression.validate",
          requestedRequirementIds: ["requirement.regression-gate"],
          claimedPaths: [],
          coordinationIds: ["coordination.referral-regression"],
        },
      ],
    };

    it("assigns each mutation requirement to exactly one task", () => {
      const assignments = assignTaskPackets(assignmentInput);
      expect(assignments.ok).toBe(true);
      if (!assignments.ok) return;
      const coverage = buildTaskCoverage(patternSet, requirements, assignments.value);
      expect(coverage.ok).toBe(true);
      if (coverage.ok) expect(coverage.value.unassignedRequirementIds).toEqual([]);
    });

- [ ] **Step 2: Verify failure**

    npm test -- tests/planning/build-task-coverage.test.ts tests/planning/assign-task-packets.test.ts

Expected: FAIL because assignment and coverage modules are absent.

- [ ] **Step 3: Implement pattern provenance and total coverage proof**

WORKSTREAM.md owns outcome primary plus companion IDs, exact versions, and provenance. A task primary must equal the outcome primary or one companion assigned as a dedicated execution task. Allocate every duty, gate, evidence item, output, record update, and approval dependency. Mutation and external-action requirements have exactly one owner. Read/validation overlap requires the same non-empty coordination ID on every overlapping task. Stable-sort assignments by task ID and all nested IDs.

Reject with exact codes task.pattern_not_in_workstream, coverage.unassigned_requirement, coverage.duplicate_exclusive_owner, coverage.overlap_without_coordination, coverage.unknown_requirement, and coverage.unauthorized_path. Add one focused test per code.

- [ ] **Step 4: Run coverage tests and typecheck**

    npm test -- tests/planning/build-task-coverage.test.ts tests/planning/assign-task-packets.test.ts
    npm run typecheck

Expected: PASS for complete assignment, missing gate rejection, duplicate mutation rejection, coordinated validation overlap, invented pattern rejection, and stable shuffled-input ordering.

- [ ] **Step 5: Commit**

    git add src/planning/build-task-coverage.ts src/planning/assign-task-packets.ts tests/planning/build-task-coverage.test.ts tests/planning/assign-task-packets.test.ts
    git commit -m "feat(planning): prove workstream task coverage"

## Task 25: Task Packet Materialization

**Files:**

- Create src/planning/materialize-task-packet.ts.
- Create tests/planning/materialize-task-packet.test.ts.

**Interfaces:** Implements materializeTaskPacket and validates the final object against task-packet schema through the foundation registry. It consumes assigned work and fully resolved adapter/catalog gates but does not persist or dispatch the packet.

- [ ] **Step 1: Write the failing flattened-packet test with a complete minimal input**

    const fixedClock: Clock = { now: () => new Date("2026-07-14T12:00:00.000Z") };
    const fixedIds: IdFactory = {
      next(prefix) {
        if (prefix === "PKT") return "PKT-01J00000000000000000000001";
        if (prefix === "CLAIM") return "CLAIM-01J00000000000000000000001";
        throw new Error("unexpected prefix " + prefix);
      },
    };

    const input: TaskPacketInput = {
      packet: {
        schema_version: "1.0.0",
        root: {
          id: "ROOT-01J00000000000000000000001",
          profile_lock_hash: "a".repeat(64),
          catalog_release: "1.0.0",
          catalog_hash: "b".repeat(64),
        },
        initiative_id: null,
        workstream_id: "WS-01J00000000000000000000001",
        task_id: "TASK-01J00000000000000000000001",
        assignment: {
          assignee_id: "agent.codex-worker-1",
          issued_by: "agent.integrator",
          issued_at: "2026-07-14T12:00:00.000Z",
        },
        patterns: {
          primary: { id: "engineering.feature.implement", version: "1.0.0" },
          companions: [{ id: "qa.regression.validate", version: "1.0.0" }],
        },
        selector: {
          score: 90,
          runner_up_score: 70,
          margin: 20,
          matched_signal_ids: ["mode-implement"],
          evidence_ids: ["EVD-01J00000000000000000000001"],
        },
        goal: "Implement the accepted referral flow",
        scope: {
          inclusions: ["lib/features/referral/**"],
          exclusions: ["firebase/**"],
        },
        resolved_inputs: {
          record_ids: ["DEC-01J00000000000000000000001"],
          artifact_refs: ["profile.lock.yaml"],
          original_base_revision: "0123456789abcdef0123456789abcdef01234567",
        },
        component_duties: [{
          component_id: "CMP-01J00000000000000000000001",
          duties: ["modify"],
          requirement: "required",
          reason: "Resolved engineering implementation impact",
          read_scope: ["lib/features/referral/**"],
          write_scope: ["lib/features/referral/**"],
          responsible_role: "worker",
          resolution: {
            source_impact_ids: ["engineering.feature.implement"],
            predicate_ids: ["mode-implement"],
            result: true,
            evidence_ids: ["EVD-01J00000000000000000000001"],
            evaluated_by: "validator.selection",
            evaluated_at: "2026-07-14T12:00:00.000Z",
          },
        }],
        domain_duties: [],
        decisions: {
          accepted_record_ids: ["DEC-01J00000000000000000000001"],
          proposed_record_ids: [],
        },
        authorization: {
          mutation: "task-scoped",
          task_result_submission: "worker",
          factual_integration: "integrator",
          workstream_activation: "automatic-by-rule",
          directional_acceptance: "Pitaji",
          external_action: {
            allowed: false,
            approval_ids: [],
            target: null,
            environment: null,
            scope: [],
            timing: null,
          },
        },
        approvals: [],
        required_outputs: ["implementation-change"],
        required_evidence: ["exact-diff", "regression-result"],
        gates: [{
          id: "gate.regression",
          definition_ref: "adapter.flutter.test@1.0.0",
          type: "test",
          command_or_check: "flutter test",
          required: true,
          conflict_sensitive: true,
          evidence_type: "test-result",
          execution: {
            kind: "command",
            executable: "flutter",
            args: ["test"],
            cwd: ".",
            timeout_ms: 600000,
            env_allowlist: {},
          },
        }],
        memory_updates: {
          create_record_types: ["change", "evidence"],
          update_record_ids: [],
        },
        completion_conditions: ["Accepted referral behavior passes regression"],
        fallback_and_escalation: {
          triggers: ["scope-drift", "claim-expiry"],
          owner: "integrator",
          allowed_fallbacks: ["submit-partial-completion"],
        },
      },
      claim: {
        issuer: "agent.integrator",
        assignee_id: "agent.codex-worker-1",
        base_revision: "0123456789abcdef0123456789abcdef01234567",
        heartbeat_interval: "PT5M",
        renewal_policy: "claim.same-scope-only",
        status: "active",
        components: ["CMP-01J00000000000000000000001"],
        repositories: ["lifeof"],
        paths: ["lib/features/referral/**"],
        duties: ["modify"],
        required_evidence: ["exact-diff", "regression-result"],
        coordination_exception_approval_id: null,
      },
      claim_ttl_ms: 900000,
    };

    it("emits only resolved required duties and a complete claim", () => {
      const result = materializeTaskPacket(input, fixedClock, fixedIds);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.component_duties.every(duty => duty.requirement === "required")).toBe(true);
        expect(result.value.claim.last_heartbeat_at).toBe("2026-07-14T12:00:00.000Z");
        expect(result.value.gates[0]?.execution.kind).toBe("command");
      }
    });

- [ ] **Step 2: Verify failure**

    npm test -- tests/planning/materialize-task-packet.test.ts

Expected: FAIL because materializeTaskPacket is missing.

- [ ] **Step 3: Implement fully flattened packet generation**

Resolve every conditional and exclusion before emission. Generate packet_id, claim.id, claim.issued_at, claim.expires_at, and claim.last_heartbeat_at only through injected IdFactory/Clock. Include pattern provenance, selector trace, exact inputs, required component/domain duties, condition-resolution evidence, self-contained claim, accepted/proposed decision IDs, authorization, approvals, outputs, evidence, gates, memory updates, completion, and fallback.

Resolve adapter/catalog gate definitions before packet creation. Every gate retains `type` and `command_or_check` from the approved packet contract and adds the structured `execution` union. A command gate contains executable plus literal args, cwd, timeout_ms, and env_allowlist; `command_or_check` is a deterministic display value and never a shell string to parse. A non-command gate contains a concrete instruction and verifier_role, and its `command_or_check` must equal that instruction. External checks require non-empty approval_refs valid for target/environment/scope/timing. Packet validation performs no catalog lookup.

Reject unresolved predicates, conditional or `not_applicable` duties, empty mutation paths, implicit approvals, unstable ordering, nondeterministic IDs/timestamps, missing or inconsistent gate `type`/`command_or_check`, shell command strings, and unresolved gate definition references.

- [ ] **Step 4: Run packet tests and schema validation**

    npm test -- tests/planning/materialize-task-packet.test.ts
    npm run typecheck

Expected: PASS for the valid packet and rejection of unresolved condition, missing heartbeat, empty write path, approval drift, shell string, unresolved gate, and unstable ordering.

- [ ] **Step 5: Commit**

    git add src/planning/materialize-task-packet.ts tests/planning/materialize-task-packet.test.ts
    git commit -m "feat(planning): materialize flattened task packets"

## Task 26: Completion, Claim, and Approval Validation Hooks

**Files:**

- Create src/planning/validate-completion-packet.ts.
- Create src/planning/validate-claim-approval.ts.
- Create tests/planning/validate-completion-packet.test.ts.
- Create tests/planning/validate-claim-approval.test.ts.
- Modify tests/fixtures/selection/runtime-fixtures.ts.

**Interfaces:** Implements validateCompletionPacket and validateClaimAndApprovals. These are validation hooks only; they do not acquire/renew leases, write approval records, rebase branches, or integrate changes.

- [ ] **Step 1: Add exact valid-packet factories and write failing mutations**

In runtime-fixtures.ts, export makeValidTaskPacket and makeValidCompletionPacket. makeValidTaskPacket returns the byte-for-byte successful Task 25 output. makeValidCompletionPacket returns a schema-valid completion linked to that task, claim, workstream, original base, one passed gate with matching command execution/evidence, one authorized change, required records/outputs, no remaining risks, and a worker attestation that submits facts without accepting direction. Validate both factories through the foundation registry before using them.

    const expiredClaimTask = makeValidTaskPacket();
    expiredClaimTask.claim.expires_at = "2026-07-14T11:59:59.000Z";
    const authorityContext: AuthorityValidationContext = {
      now: "2026-07-14T12:00:00.000Z",
      expectedIssuer: "agent.integrator",
      currentBaseRevision: expiredClaimTask.claim.base_revision,
      conflictingClaims: [],
      recordedApprovals: [],
    };

    it("fails an expired claim before completion can be accepted", () => {
      const authority = validateClaimAndApprovals(expiredClaimTask, authorityContext);
      expect(authority.ok).toBe(false);
      if (!authority.ok) expect(authority.issues[0]?.code).toBe("claim.expired");
    });

    const task = makeValidTaskPacket();
    const completionContext: CompletionValidationContext = {
      currentBaseRevision: task.claim.base_revision,
      availableEvidenceIds: ["EVD-01J00000000000000000000001"],
      approvedExceptionIds: [],
    };
    const acceptanceEscalationCompletion = {
      ...makeValidCompletionPacket(task),
      accepted_decision_ids: ["DEC-01J00000000000000000000001"],
    } as unknown as CompletionPacket;

    it("does not let a completion packet grant acceptance", () => {
      const result = validateCompletionPacket(acceptanceEscalationCompletion, task, completionContext);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0]?.code).toBe("completion.authority_expansion");
    });

- [ ] **Step 2: Verify failures**

    npm test -- tests/planning/validate-completion-packet.test.ts tests/planning/validate-claim-approval.test.ts

Expected: FAIL because both validators are absent.

- [ ] **Step 3: Implement validation hooks**

Claim validation checks issuer, assignee, original base, issue/expiry, last heartbeat, status, exact repositories/paths/duties, evidence, and coordination approval. Approval validation checks granter, kind, target, environment, scope, timing, expiry, and invalidation drift. Completion validation checks task/workstream/claim links, exact files and artifacts, authorization refs, passed/failed/not-run gates, evidence IDs, records, outputs, risks, and worker attestation. A not-run required gate blocks validation unless an applicable approved exception exists. Return reports only.

- [ ] **Step 4: Run focused validation tests and typecheck**

    npm test -- tests/planning/validate-completion-packet.test.ts tests/planning/validate-claim-approval.test.ts
    npm run typecheck

Expected: PASS for valid claims/approvals/completions and rejection of expiry, overlap without coordination, stale heartbeat, target/environment/timing drift, missing evidence, failed gate, and authority expansion.

- [ ] **Step 5: Commit**

    git add src/planning/validate-completion-packet.ts src/planning/validate-claim-approval.ts tests/planning/validate-completion-packet.test.ts tests/planning/validate-claim-approval.test.ts tests/fixtures/selection/runtime-fixtures.ts
    git commit -m "feat(planning): validate completion and authority contracts"

## Task 27: Compile Workstream Pipeline and Golden Scenarios

**Files:**

- Create src/selection/compile-workstream.ts.
- Create tests/selection/compile-workstream.test.ts.
- Create tests/golden/selection-planning.golden.test.ts.
- Create tests/helpers/compile-fixture.ts.
- Create the five YAML fixtures listed in the owned test file map.

**Interfaces:** Implements compileWorkstream by composing the already-tested pure functions. It returns workstream plans and task packets only.

- [ ] **Step 1: Write the safe fixture loader and failing LifeOf referral golden test**

tests/helpers/compile-fixture.ts reads one URL with Node readFile, fatal UTF-8 decoding, parseYamlDocument, explicit required-key/type checks for CompileWorkstreamInput, and additional-key rejection. It returns RuntimeResult and never writes.

    const loaded = await readCompileFixture(new URL("../fixtures/selection/lifeof-referral.yaml", import.meta.url));
    if (!loaded.ok) throw new Error(loaded.issues.map(issue => issue.code).join(","));

    const fixedClock: Clock = { now: () => new Date("2026-07-14T12:00:00.000Z") };
    let idCounter = 0;
    const fixedIds: IdFactory = {
      next(prefix) {
        idCounter += 1;
        return prefix + "-01J" + String(idCounter).padStart(23, "0");
      },
    };

    it("compiles an in-app LifeOf referral launch", async () => {
      const result = await compileWorkstream(loaded.value, fixedClock, fixedIds);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workstreams).toHaveLength(1);
        expect(result.value.taskPackets.map(packet => packet.patterns.primary.id)).toContain("growth.campaign.release");
        expect(result.value.coverage.unassignedRequirementIds).toEqual([]);
      }
    });

- [ ] **Step 2: Verify failure**

    npm test -- tests/selection/compile-workstream.test.ts tests/golden/selection-planning.golden.test.ts

Expected: FAIL because the compiler and fixtures are missing.

- [ ] **Step 3: Implement the pure orchestration pipeline and all fixtures**

Pipeline order is normalize features, decompose outcomes, select primary pattern per outcome, expand companions, merge impacts, lock workstream pattern set, assign tasks, prove coverage, and materialize packets. The purchase/security fixture produces sibling implementation and assessment workstreams. Settings audit/redesign produces dependent assess/design workstreams without implementation. External campaign does not claim Flutter/Firebase paths. Dino Escape adds game balance, telemetry, playtest, and save validation plus conditional anti-cheat only when competitive/valuable state is present.

- [ ] **Step 4: Run subsystem and full repository checks**

    npm test -- tests/selection tests/planning tests/golden/selection-planning.golden.test.ts
    npm run typecheck
    npm run lint
    npm test

Expected: every command exits 0; golden output is byte-identical across two runs with the same fixed clock and ID factory.

- [ ] **Step 5: Commit**

    git add src/selection/compile-workstream.ts tests/selection/compile-workstream.test.ts tests/golden/selection-planning.golden.test.ts tests/helpers/compile-fixture.ts tests/fixtures/selection
    git commit -m "feat(selection): compile deterministic workstream plans"

## Final Verification

- [ ] Confirm no .taxonomy.yaml file changed.

    git diff --name-only -- '*.taxonomy.yaml'

Expected: no output.

- [ ] Confirm this plan did not add repository materialization, canonical persistence, view generation, lease acquisition, Git/worktree mutation, or integration execution modules.

```powershell
$matches = rg -n "writeCanonical|regenerateView|acquireIntegrationLease|git checkout|git worktree|integrateCanonical" src/selection src/planning
if ($LASTEXITCODE -eq 0) { $matches; throw "Out-of-scope integration capability found" }
if ($LASTEXITCODE -gt 1) { throw "Ownership scan failed" }
```

Expected: no output.

- [ ] Confirm exact catalog counts.

    npm test -- tests/selection/pattern-core tests/selection/companion-core-first-half.test.ts tests/selection/companion-core-second-half.test.ts

Expected: 257 unique pattern core halves and 13 unique companion core halves.

- [ ] Run all quality gates.

    npm run typecheck
    npm run lint
    npm test
    git diff --check

Expected: every command exits 0 and git diff --check prints nothing.
