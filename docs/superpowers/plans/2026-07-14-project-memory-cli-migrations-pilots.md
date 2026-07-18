# Project Memory CLI, Migrations, Import, and Pilots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose every validated subsystem through one predictable `project-memory` command, support explicit schema/catalog migrations, safely import legacy project documents without rewriting history, prove the architecture against representative LifeOf and Dino Escape repositories, and package a reproducible v1 release.

**Architecture:** The CLI is a thin composition root. Command handlers parse arguments, call subsystem planners, render output, and map typed issues; they contain no business rules or canonical writers. Except for the explicit one-time `bootstrap` and normal/multi-repository finalization protocols, every mutating command recomputes a `CanonicalMutationPlan` and calls `IntegrationCoordinator.finalizeMutation`. Migrations are versioned pure transforms that only plan mutations. Legacy import is scan → proposed mapping → reviewed mutation plan, with originals, canonical destinations, archives, views, and audit evidence finalized together. Deterministic fixtures and recorded lower-reasoning trials provide release evidence before any live project is changed.

**Tech Stack:** Node.js 24, TypeScript/ESM, the completed Project Memory subsystems, Vitest, GitHub Actions, Git, npm pack, PowerShell.

## Global Constraints

- Repository root is `<repository-root>` (or its isolated worktree). Execute from `plugins/project-memory/`; every implementation path below is relative to that package root.
- The Codex Plugin and implicit skill are the primary agent experience. This CLI is the deterministic engine boundary and cross-tool fallback; it must never require a user or agent to browse and choose profile folders.
- Prerequisites: foundation, catalog, profile compiler, selection/task planning, and governance/integration completion gates.
- This plan owns `src/cli/**`, `src/migrations/**`, `src/import/**`, `src/benchmark/**`, end-to-end fixtures, CI workflows, and release packaging.
- CLI handlers never reimplement selector, compiler, authority, claim, view, archive, or integration rules.
- Every mutating command has an explicit `plan` path. Its `apply` path recomputes the plan, verifies the supplied plan hash and expected Git head, then calls the governance coordinator; a saved plan is never blindly replayed.
- No CLI, migration, import, profile, claim, view, archive, catalog, or lifecycle handler applies canonical writes directly. `ProfileCompiler.apply`, migration/import apply services, claim apply methods, and direct view/archive writes must not exist.
- `IntegrationCoordinator` owns the short-lived lease, isolated worktree, validation, commit, and compare-and-swap. CLI arguments never include or require a lease ID.
- Human output goes to stdout, diagnostics to stderr, and `--json` emits exactly one JSON document to stdout.
- No command asks a worker to choose a profile folder, work-pattern directory, or canonical record location.
- Import preserves source bytes and provenance. Extracted interpretations cannot silently become accepted decisions or profile intent.
- Do not touch live LifeOf, Dino Escape, or any other user repository during fixture work.
- A live pilot requires a separate target-specific review and explicit Pitaji authorization after the scratch pilot passes.
- External release, publication, registry upload, deployment, or user communication is excluded from this plan unless separately approved.

---

## Stable CLI Contract

Exit codes are fixed:

| Code | Meaning |
|---:|---|
| `0` | Operation completed, including a valid `review_required` decision result |
| `2` | Input, schema, catalog, lock, migration, or packet validation failure |
| `3` | Missing, expired, invalid, or insufficient approval/authority |
| `4` | Claim conflict/expiry, stale base, path-scope violation, dirty canonical tree, or integration-lease conflict |
| `5` | Operational failure: Git, filesystem, child process, timeout, or unexpected internal error |

All JSON responses use this envelope:

```ts
export interface MutationApplyRequest {
  root: URL;
  expected_head: string;
  expected_plan_hash: string;
  approval_ids: readonly string[];
}

export interface CliEnvelope<T> {
  schema_version: "1.0.0";
  command: string;
  status: "success" | "review_required" | "failed";
  data: T | null;
  issues: readonly RuntimeIssue[];
}
```

Command surface:

```text
project-memory doctor
project-memory init plan|apply
project-memory catalog validate|inventory|fixtures
project-memory catalog release plan|apply|verify
project-memory profile plan|apply|verify|diff
project-memory select root|work
project-memory initiative create plan|apply
project-memory initiative transition plan|apply
project-memory workstream compile
project-memory workstream create plan|apply
project-memory workstream transition plan|apply
project-memory task materialize|validate-completion
project-memory task create plan|apply
project-memory task transition plan|apply
project-memory claim issue plan|apply
project-memory claim renew plan|apply
project-memory claim validate
project-memory views generate plan|apply
project-memory views check
project-memory archive ingest plan|apply
project-memory archive verify
project-memory integrate validate|finalize
project-memory satellite prepare
project-memory hub finalize
project-memory migrate list|plan|apply
project-memory import scan|plan|apply
project-memory benchmark run|report
```

## Task 1: Build the CLI Parser, Result Envelope, and Exit-Code Mapper

**Files:**

- Create: `src/cli.ts`
- Create: `src/cli/main.ts`
- Create: `src/cli/command-registry.ts`
- Create: `src/cli/output.ts`
- Create: `src/cli/exit-codes.ts`
- Create: `src/cli/parse-args.ts`
- Create: `tests/cli/main.test.ts`

- [ ] **Step 1: Write failing parser and envelope tests.** Cover help, unknown command, JSON purity, human output, typed issue mapping, and an unexpected exception.

```ts
it.each([
  ["SCHEMA_INVALID", 2],
  ["APPROVAL_REQUIRED", 3],
  ["CLAIM_EXPIRED", 4],
  ["FILESYSTEM_ERROR", 5],
])("maps %s to exit code %i", (code, expected) => {
  expect(exitCodeForIssues([{ ...baseIssue, code }])).toBe(expected);
});
```

- [ ] **Step 2: Implement the dependency-free parser.** Support subcommands, `--root`, `--input`, `--output`, `--json`, `--dry-run`, and `--help`; reject duplicate scalar flags.

```ts
export interface ParsedInvocation {
  command_path: readonly string[];
  flags: Readonly<Record<string, string | boolean>>;
  positionals: readonly string[];
}
```

- [ ] **Step 3: Implement the command registry.** Handlers return `RuntimeResult`, never call `process.exit`, and declare whether they mutate.

```ts
export interface CliCommand<T> {
  path: readonly string[];
  mutates: boolean;
  run(context: CliContext, invocation: ParsedInvocation): Promise<RuntimeResult<T>>;
}
```

- [ ] **Step 4: Centralize process/error behavior.** Make only `src/cli.ts` set `process.exitCode`; redact unexpected stack traces from human output and preserve them only in explicitly enabled local debug evidence.

- [ ] **Step 5: Run focused tests and commit.**

```powershell
npm test -- tests/cli/main.test.ts
npm run typecheck
git add src/cli.ts src/cli tests/cli/main.test.ts
git commit -m "feat(cli): add stable command and exit contracts"
```

Expected: each error class maps to exactly one documented code and `--json` parses as one JSON object.

## Task 2: Implement Repository Configuration and `doctor`

**Files:**

- Create: `src/cli/config.ts`
- Create: `src/cli/commands/doctor.ts`
- Create: `tests/cli/doctor.test.ts`
- Create: `tests/fixtures/e2e/configured-root/tools/project-memory/config.json`

- [ ] **Step 1: Write failing repository diagnostic tests.** Cover a valid root, missing config, wrong root ID, absent Git, wrong Node major, missing lock, stale generated views, and an unreachable hub.

- [ ] **Step 2: Define the generated target configuration schema.**

```ts
export const ToolConfigSchema = Type.Object({
  schema_version: Type.Literal("1.0.0"),
  root_id: InstanceIdSchema("ROOT"),
  memory_root: Type.Literal("docs/project-memory"),
  profile_lock: Type.Literal("docs/project-memory/profile.lock.yaml"),
  catalog_lock: Type.Literal("docs/project-memory/catalog.lock.json"),
  hub: Type.Union([
    Type.Object({ kind: Type.Literal("local"), repository: Type.Literal(".") }),
    Type.Object({ kind: Type.Literal("satellite"), repository: SafeRepositoryReferenceSchema }),
  ]),
  policy: Type.Object({
    require_clean_canonical_tree: Type.Boolean(),
    generated_view_check: Type.Boolean(),
    archive_secret_scan: Type.Boolean(),
  }),
}, { $id: "project-memory/v1/tool-config", additionalProperties: false });
```

- [ ] **Step 3: Implement safe root discovery.** Walk upward for `tools/project-memory/config.json`; stop at the filesystem root and never cross into a different Git worktree.

- [ ] **Step 4: Implement stable read-only diagnostics.** Check runtime, Git, config, schema compatibility, project/profile/catalog locks, hub relationship, generated-view freshness, and writable transaction staging; emit `passed`, `failed`, or `warning` without repair.

Emit a stable check list with `passed`, `failed`, or `warning`; do not repair anything.

- [ ] **Step 5: Run focused tests and commit.**

```powershell
npm test -- tests/cli/doctor.test.ts
npm run build
node dist/cli.js doctor --root tests/fixtures/e2e/configured-root --json
git add src/cli tests/cli tests/fixtures/e2e/configured-root schemas/project-memory/v1
git commit -m "feat(cli): add root discovery and diagnostics"
```

Expected: the valid fixture reports all required checks `passed`; invalid fixtures exit `2`, `4`, or `5` by issue type.

## Task 3: Orchestrate Safe Root Initialization

**Files:**

- Create: `src/cli/commands/init.ts`
- Create: `src/cli/init/build-initial-source-proposal.ts`
- Create: `src/cli/init/build-init-plan.ts`
- Create: `src/cli/init/apply-init-plan.ts`
- Create: `tests/cli/init.test.ts`
- Create: `tests/fixtures/e2e/uninitialized-root/**`

- [ ] **Step 1: Write failing initialization boundary tests.** Cover read-only planning, grouped clarification, exact Pitaji approval, dirty-root refusal, plan/head drift, and one successful bootstrap commit. Assert `init apply` calls `IntegrationCoordinator.bootstrap` only; it must not call `ProfileCompiler.apply`, `IntegrationCoordinator.finalizeMutation`, or a direct writer.

```ts
it("boots through the one-time coordinator protocol", async () => {
  await runCli(["init", "apply", "--plan", planPath], spies);
  expect(spies.profileCompiler.plan).toHaveBeenCalledTimes(1);
  expect(spies.integrationCoordinator.bootstrap).toHaveBeenCalledTimes(1);
  expect(spies.integrationCoordinator.finalizeMutation).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Implement deterministic read-only planning.** Scan observable repository evidence, merge the supplied brief, normalize features, score blueprint candidates, build evidenced source proposals, and call `ProfileCompiler.plan` to obtain a `profile.bootstrap` `CanonicalMutationPlan`.

```ts
export interface InitPlan {
  schema_version: "1.0.0";
  target_root_id: string;
  target_ref: string;
  expected_head: string;
  normalized_feature_hash: string;
  selection: SelectionDecision;
  proposed_project_selection: ProjectSelection;
  proposed_sources: AcceptedProfileSourceSet;
  source_proposal_hash: string;
  unresolved_required_facts: readonly string[];
  required_approval_kinds: readonly ApprovalKind[];
  profile_compilation: CanonicalMutationPlan;
  plan_hash: string;
}
```

- [ ] **Step 3: Enforce evidence and approval rules.** Every proposed source value carries exact evidence or `unresolved`; group missing required facts into at most one focused clarification. Even an `automatic` selection remains `review_required` until one Pitaji approval covers the exact root/profile selection and source proposal hash.

- [ ] **Step 4: Implement `init apply` through bootstrap.** Recompute the full plan, validate `plan_hash`, `expected_head`, approval scope/timing, and `profile_compilation.plan_hash`, then call `IntegrationCoordinator.bootstrap`. The coordinator owns its isolated worktree, short-lived lease, one initialization commit, compare-and-swap ref update, audit record, and cleanup.

- [ ] **Step 5: Verify the focused flow and commit.**

```powershell
npm test -- tests/cli/init.test.ts
npm run build
node dist/cli.js init plan --root tests/fixtures/e2e/uninitialized-root --brief tests/fixtures/e2e/uninitialized-root/brief.md --catalog dist/catalog/project-memory/1.0.0/catalog.bundle.json --agent-adapter adapter.codex --output .tmp/init.plan.json --json
npm run typecheck
git add src/cli/commands/init.ts src/cli/init tests/cli/init.test.ts tests/fixtures/e2e/uninitialized-root
git commit -m "feat(cli): orchestrate approved root initialization"
```

Expected: planning writes nothing, returns one review packet, and apply tests prove `IntegrationCoordinator.bootstrap` creates one compare-and-swap initialization commit only with matching approval.

## Task 4: Wire Catalog, Profile, Selection, and Work Lifecycle Commands

**Files:**

- Create: `src/cli/commands/catalog.ts`
- Create: `src/cli/commands/profile.ts`
- Create: `src/cli/commands/select.ts`
- Create: `src/cli/commands/initiative.ts`
- Create: `src/cli/commands/workstream.ts`
- Create: `src/cli/commands/task.ts`
- Create: `tests/cli/planning-commands.test.ts`

- [ ] **Step 1: Write failing composition-boundary tests.** Prove read-only commands have no writes and every apply command freshly recomputes the same plan before calling `IntegrationCoordinator.finalizeMutation`. Spy tests must fail if `ProfileCompiler.apply`, a catalog writer, a lifecycle writer, or any transaction apply API exists or is called.

```ts
it("profile apply recomputes and finalizes the canonical mutation", async () => {
  await runCli(["profile", "apply", "--expected-plan-hash", expectedHash], spies);
  expect(spies.profileCompiler.plan).toHaveBeenCalledTimes(1);
  expect(spies.integrationCoordinator.finalizeMutation).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Wire catalog read paths and the two distinct lock APIs.** Master release commands use `CatalogReleaseLock`, `buildCatalogRelease(root, catalog, release)`, and `verifyCatalogRelease(root, lock)`. Target selection uses `SelectedCatalogLock`, `buildSelectedCatalogLock(resolvedSelection)`, and `verifySelectedCatalogLock(root, lock)`. `catalog release plan` returns generated bytes plus a `CanonicalMutationPlan`; `catalog release apply` recomputes and finalizes it.

- [ ] **Step 3: Wire profile and selection commands.** `profile plan` returns `ProfileCompiler.plan`; `profile apply` recomputes it, checks `expected_plan_hash` and `expected_head`, and calls `finalizeMutation`. `ProfileVerifier.verify`, profile diff, root/work selection, workstream compilation, task materialization, and completion validation remain read-only.

- [ ] **Step 4: Add governed work-lifecycle commands.** Expose `initiative|workstream|task create plan|apply` and `initiative|workstream|task transition plan|apply` through `WorkLifecycleService`. The service validates parent existence and legal transitions and returns a `work_lifecycle` `CanonicalMutationPlan`; apply recomputes and submits that plan to `finalizeMutation`.

```ts
export interface WorkLifecycleService {
  planCreateInitiative(input: CreateInitiativeInput): Promise<RuntimeResult<CanonicalMutationPlan>>;
  planCreateWorkstream(input: CreateWorkstreamInput): Promise<RuntimeResult<CanonicalMutationPlan>>;
  planCreateTaskPacket(input: CreateTaskPacketInput): Promise<RuntimeResult<CanonicalMutationPlan>>;
  planTransition(input: WorkTransitionInput): Promise<RuntimeResult<CanonicalMutationPlan>>;
}
```

- [ ] **Step 5: Run focused tests and commit.**

```powershell
npm test -- tests/cli/planning-commands.test.ts
npm run typecheck
git add src/cli/commands tests/cli/planning-commands.test.ts
git commit -m "feat(cli): expose governed planning and lifecycle workflows"
```

Expected: planning stays side-effect free; each catalog, profile, or lifecycle mutation is recomputed and finalized by the coordinator under the correct lock contract.

## Task 5: Wire Claims, Views, Archive, and Integration Commands

**Files:**

- Create: `src/cli/commands/claim.ts`
- Create: `src/cli/commands/views.ts`
- Create: `src/cli/commands/archive.ts`
- Create: `src/cli/commands/integrate.ts`
- Create: `src/cli/commands/satellite.ts`
- Create: `src/cli/commands/hub.ts`
- Create: `tests/cli/governance-commands.test.ts`

- [ ] **Step 1: Write failing coordinator-boundary tests.** Prove claim conflicts map to `4`, missing approval maps to `3`, failed gates block finalization, checks never rewrite files, and no command accepts `--lease-id`. Assert apply handlers call `IntegrationCoordinator.finalizeMutation` exactly once and no subsystem apply/write API.

- [ ] **Step 2: Wire claim planning and application.** `claim issue plan|apply` and `claim renew plan|apply` call read-only `ClaimService` planners. Apply recomputes the `claim` `CanonicalMutationPlan`, validates the supplied expected hash/head, and calls `finalizeMutation`; `claim validate` remains read-only.

- [ ] **Step 3: Wire generated-view and archive planning.** `views generate plan|apply` and `archive ingest plan|apply` recompute `view` or `archive` mutation plans and finalize through the coordinator. `views check` and `archive verify` are strictly read-only. No CLI path writes generated views or archive objects directly.

- [ ] **Step 4: Wire the explicit finalization protocols.** `integrate validate` is read-only and `integrate finalize` accepts a completion-packet path, not a lease token; `IntegrationCoordinator` owns the short-lived lease and compare-and-swap. `satellite prepare` and `hub finalize` delegate to `MultiRepoFinalizer` with exact satellite commit hashes and preparation IDs.

- [ ] **Step 5: Run focused tests and commit.**

```powershell
npm test -- tests/cli/governance-commands.test.ts
npm run typecheck
git add src/cli/commands tests/cli/governance-commands.test.ts
git commit -m "feat(cli): expose governed integration workflows"
```

Expected: no CLI path bypasses claims, approvals, current-base checks, gates, coordinator-owned leases, or the normal/multi-repository finalization protocols.

## Task 6: Build the Versioned Migration Registry

**Files:**

- Create: `src/migrations/contracts.ts`
- Create: `src/migrations/registry.ts`
- Create: `src/migrations/planner.ts`
- Create: `src/migrations/plan-mutation.ts`
- Create: `src/migrations/index.ts`
- Create: `tests/migrations/registry.test.ts`
- Create: `tests/migrations/planner.test.ts`

- [ ] **Step 1: Write failing registry and purity tests.** Cover one-hop, multi-hop, missing path, cycle, downgrade, duplicate edge, input-hash mismatch, deterministic plan hashing, dry-run purity, and the absence of any migration apply/writer method.

```ts
export interface MigrationDefinition {
  id: string;
  from_version: string;
  to_version: string;
  affected_artifacts: readonly ArtifactKind[];
  authority_impact: "none" | "directional";
  transform(input: MigrationInput): RuntimeResult<MigrationOutput>;
}
```

- [ ] **Step 2: Build the pure forward-only registry and planner.** Require one unambiguous shortest path, reject cycles and duplicate edges at startup, and produce deterministic planned writes plus semantic diffs from input bytes and context only.

- [ ] **Step 3: Export a planner-only migration facade.** `MigrationService` never writes and exposes no `apply`; its sole mutation operation is `plan`, returning the shared coordinator contract.

```ts
export interface MigrationService {
  list(): readonly MigrationSummary[];
  plan(input: MigrationPlanInput): Promise<RuntimeResult<CanonicalMutationPlan>>;
}
```

- [ ] **Step 4: Wire user-facing migration plan/apply semantics.** `migrate plan` calls `plan`. `migrate apply` rescans inputs, recomputes the same `migration` plan, verifies expected plan hash/head/source hashes and required Pitaji approval, then calls `IntegrationCoordinator.finalizeMutation`. The mutation includes the immutable migration record and archive preimages.

- [ ] **Step 5: Run focused tests and commit.**

```powershell
npm test -- tests/migrations
npm run typecheck
git add src/migrations tests/migrations
git commit -m "feat(migrations): add explicit versioned mutation plans"
```

Expected: no catalog or schema upgrade happens silently, migration code never writes canonical state, and apply always recomputes before coordinator finalization.

## Task 7: Add the First No-Op and Profile-Lock Migration Fixtures

**Files:**

- Create: `src/migrations/v1/normalize-generated-metadata.ts`
- Create: `tests/fixtures/migrations/profile-v1-metadata/**`
- Create: `tests/migrations/v1/normalize-generated-metadata.test.ts`

- [ ] **Step 1: Add the metadata-normalization migration fixture.** Preserve semantics and authority.

- [ ] **Step 2: Write the exact-byte golden test.** Include before bytes, planned writes, canonical diff, and after hashes.

- [ ] **Step 3: Prove idempotence.** The second plan has no writes.

- [ ] **Step 4: Prove coordinator-owned preservation.** The `migration` plan includes original profile/catalog locks as verifiable archive preimages, and only `IntegrationCoordinator.finalizeMutation` persists the replacement.

- [ ] **Step 5: Run focused tests and commit.**

```powershell
npm test -- tests/migrations/v1/normalize-generated-metadata.test.ts
git add src/migrations/v1 tests/migrations/v1 tests/fixtures/migrations
git commit -m "test(migrations): prove profile lock migration safety"
```

Expected: the fixture upgrades once, preserves history, and becomes a no-op on the second run.

## Task 8: Implement Legacy Scanning and Proposed Destination Mapping

**Files:**

- Create: `src/import/contracts.ts`
- Create: `src/import/index.ts`
- Create: `src/import/scanner.ts`
- Create: `src/import/classifiers.ts`
- Create: `src/import/planner.ts`
- Create: `tests/import/scanner.test.ts`
- Create: `tests/import/planner.test.ts`
- Create: `tests/fixtures/legacy-repositories/{minimal,dino-style,lifeof-style}/**`

- [ ] **Step 1: Write failing scan and planner tests.** Cover common legacy files, exact hashes, encoding, sensitivity findings, Git provenance, deterministic ordering, symlink escape, duplicate destinations, PRD/requirements routing, and the absence of any importer apply/write method.

- [ ] **Step 2: Implement the safe deterministic scanner.** Scan without following symlinks outside the root and return exact bytes metadata and proposed roles only.

```ts
export interface LegacySourceArtifact {
  relative_path: string;
  sha256: string;
  byte_length: number;
  git_revision: string | null;
  detected_roles: readonly LegacyDocumentRole[];
  sensitivity_findings: readonly SensitivityFinding[];
}
```

- [ ] **Step 3: Export the planner-only importer facade.** `LegacyImporter` never writes and exposes no `apply`; `plan` consumes the reviewed decisions and returns one shared `import` mutation plan.

```ts
export interface LegacyImporter {
  scan(root: URL): Promise<RuntimeResult<LegacyScan>>;
  propose(scan: LegacyScan, context: LegacyImportReviewContext): RuntimeResult<LegacyImportProposal>;
  plan(input: ReviewedLegacyImportInput): RuntimeResult<CanonicalMutationPlan>;
}
```

- [ ] **Step 4: Build conservative destination proposals.** Classify facts as observations, directional candidates, historical status, view candidates, or archive-only without accepting them. PRDs and requirements may propose only an approved `canonical_document_patch` to the governing source document, never a generic canonical record; reject one fact mapped to multiple canonical homes.

- [ ] **Step 5: Run focused tests and commit.**

```powershell
npm test -- tests/import/scanner.test.ts tests/import/planner.test.ts
npm run typecheck
git add src/import tests/import tests/fixtures/legacy-repositories
git commit -m "feat(import): plan legacy project memory safely"
```

Expected: interpretations remain proposed, every source byte has a stable hash, and import code has no canonical write capability.

## Task 9: Finalize Reviewed Legacy Imports as One Mutation

**Files:**

- Create: `src/import/plan-reviewed-import.ts`
- Create: `src/import/render-import-report.ts`
- Create: `tests/import/plan-reviewed-import.test.ts`

- [ ] **Step 1: Write failing reviewed-import tests.** Cover exact plan hash, changed source bytes, rejected mapping, directional change without approval, duplicate destination, secret finding, archive planning failure, and one valid plan. Assert `import apply` recomputes and calls `IntegrationCoordinator.finalizeMutation` exactly once.

- [ ] **Step 2: Require an exact reviewed destination discriminant.** Every candidate is imported or rejected with rationale; an imported candidate selects exactly one of the following destinations.

```ts
export type ReviewedImportDestination =
  | { kind: "canonical_document_patch"; document_path: string; patch: SourceDocumentPatch; approval_id: ApprovalId }
  | { kind: "canonical_record"; record_type: string; record_id: string; status: ImportedRecordStatus; approval_id: ApprovalId }
  | { kind: "archive_only" };

export interface ReviewedImportDecision {
  candidate_id: string;
  disposition: "import" | "reject";
  destination: ReviewedImportDestination | null;
  rationale: string;
}
```

- [ ] **Step 3: Plan all import effects together.** `LegacyImporter.plan` returns one `CanonicalMutationPlan` whose caller writes contain content-addressed original/redacted archive objects, approved source-document patches or canonical records, and immutable import evidence, while `metadata` binds the import report and mandatory six-view regeneration. `IntegrationCoordinator.finalizeMutation` derives those views and audit artifacts from the staged pre-view tree and includes them in the same atomic import commit and receipt. PRD/requirements content can enter canonical state only through its approved source-document patch destination.

- [ ] **Step 4: Implement user-facing `import apply` as recompute plus coordinator finalization.** Rescan source bytes, reload reviewed decisions, recompute the mutation, validate expected plan hash/head and approvals, then call `IntegrationCoordinator.finalizeMutation`. Never write archives, records, source documents, reports, or views directly.

- [ ] **Step 5: Run fault-injection tests and commit.**

```powershell
npm test -- tests/import/plan-reviewed-import.test.ts
npm run typecheck
git add src/import tests/import
git commit -m "feat(import): finalize reviewed imports as one mutation"
```

Expected: failed imports leave canonical state unchanged; successful imports produce one coordinator-owned commit in which originals, destinations, audit evidence, and regenerated views agree.

## Task 10: Create End-to-End Scratch Repository Pilots

**Files:**

- Create: `tests/e2e/lifeof-pilot.test.ts`
- Create: `tests/e2e/dino-escape-pilot.test.ts`
- Create: `tests/e2e/external-campaign-pilot.test.ts`
- Create: `tests/fixtures/pilots/lifeof/**`
- Create: `tests/fixtures/pilots/dino-escape/**`
- Create: `tests/fixtures/pilots/external-campaign/**`

- [ ] **Step 1: Build sanitized representative fixtures.** Include representative stack files and legacy planning documents, never live secrets, credentials, personal data, or full private repositories.

- [ ] **Step 2: Create governed roots and work through the coordinator.** Bootstrap each root once, then create initiatives, workstreams, and tasks with `WorkLifecycleService` mutation plans finalized by `IntegrationCoordinator.finalizeMutation`; assert LifeOf and Dino Escape workstreams never become extra roots.

- [ ] **Step 3: Exercise the complete governed lifecycle.** Cover profile selection, task packet, claim plan/finalize, simulated completion, validation, atomic finalization, archive/view verification, and external-only campaign activation boundaries.

- [ ] **Step 4: Exercise migration and import application boundaries.** Run `migrate apply` and `import apply`, assert both recompute `CanonicalMutationPlan` and call `finalizeMutation`, assert one import commit contains originals/destinations/audit/views, and assert no CLI lease argument or subsystem apply/direct writer exists.

- [ ] **Step 5: Run all scratch pilots and commit.**

```powershell
npm test -- tests/e2e/lifeof-pilot.test.ts tests/e2e/dino-escape-pilot.test.ts tests/e2e/external-campaign-pilot.test.ts
git add tests/e2e tests/fixtures/pilots
git commit -m "test(e2e): prove coordinator-owned product-root pilots"
```

Expected: all pilots preserve one enduring root, coordinator-only canonical mutation, exact authority boundaries, append-only history, and generated-view consistency.

## Task 11: Implement the 150-Brief Acceptance Benchmark

**Files:**

- Create: `src/benchmark/contracts.ts`
- Create: `src/benchmark/run-benchmark.ts`
- Create: `src/benchmark/report.ts`
- Create: `tests/benchmark/run-benchmark.test.ts`
- Create: `benchmarks/briefs/*.yaml`
- Create: `benchmarks/rubric.yaml`
- Create: `benchmarks/lower-reasoning-trials/README.md`

- [ ] **Step 1: Define the benchmark contract.** Include expected root boundary, blueprint, components, domains, overlays, patterns, authority, evidence, gates, and maximum clarification count.

```ts
export interface BenchmarkCase {
  id: string;
  supported: boolean;
  brief: string;
  normalized_features: NormalizedFeatureMap;
  expected: ExpectedResolution;
  max_clarification_questions: 0 | 1;
}
```

- [ ] **Step 2: Import all 150 catalog golden cases.** Reuse their expected definition IDs.

- [ ] **Step 3: Calculate and gate exact metrics.** Measure supported/correct counts, schema invention, clarifications, authority violations, and resolution rate; fail below `98%`, above one clarification, or on any schema invention or authority expansion.

Fail the release gate below `98%`, on more than one clarification for any supported brief, on any schema invention, or on any authority expansion.

```ts
expect(report.supported_resolution_rate).toBeGreaterThanOrEqual(0.98);
expect(report.schema_invention_count).toBe(0);
expect(report.authority_expansion_count).toBe(0);
expect(report.max_clarification_questions).toBeLessThanOrEqual(1);
```

- [ ] **Step 4: Define and satisfy the lower-reasoning trial protocol.** Record fixed prompt, clean repository copy, model/tool ID, raw-result hash, rubric, reviewer, timestamp, and evidence; require two runs across 30 supported briefs and store no credentials.

Require at least two lower-reasoning trial runs across at least 30 supported briefs before calling v1 accepted; store only redacted outputs and hashes.

- [ ] **Step 5: Run deterministic benchmark tests and commit.**

```powershell
npm test -- tests/benchmark/run-benchmark.test.ts
npm run build
node dist/cli.js benchmark run --input benchmarks/briefs --output .tmp/benchmark-report.json --json
git add src/benchmark tests/benchmark benchmarks
git commit -m "test(benchmark): enforce supported-brief resolution targets"
```

Expected: deterministic catalog/runtime resolution meets the threshold; human/model trial evidence remains a separate required release artifact.

## Task 12: Add Cross-Platform CI and Reproducible Packaging

**Files:**

- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release-candidate.yml`
- Create: `scripts/verify-generated.mjs`
- Create: `scripts/verify-package.mjs`
- Create: `tests/release/package.test.ts`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Write the package-content test.** Include required runtime artifacts and exclude source fixtures/secrets.

- [ ] **Step 2: Add Windows and Ubuntu CI.** On Node 24 run clean install, audit, typecheck, lint, tests, build, regeneration checks, benchmark, and package dry run.

```yaml
strategy:
  matrix:
    os: [windows-latest, ubuntu-latest]
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 24
      cache: npm
  - run: npm ci --ignore-scripts
  - run: npm audit --omit=dev
  - run: npm run check
  - run: node scripts/verify-generated.mjs
  - run: npm pack --dry-run
```

- [ ] **Step 3: Implement generated-artifact verification.** Regenerate in a temporary directory and byte-compare with tracked outputs.

- [ ] **Step 4: Produce reproducible unsigned artifacts and document installation.** Emit tarball, SHA-256, catalog/schema bundles, benchmark report, and test evidence without publishing; document verified-tarball installation and startup.

Document installation from a verified tarball and the target repository startup flow.

- [ ] **Step 5: Run the release gate locally and commit.**

```powershell
npm ci --ignore-scripts
npm audit --omit=dev
npm run check
node scripts/verify-generated.mjs
npm pack --dry-run
git diff --check
git add .github scripts tests/release package.json README.md
git commit -m "ci(release): add reproducible project memory package gates"
```

Expected: Windows and Linux produce equivalent logical manifests and all generated artifacts match tracked bytes.

## Task 13: Prepare, but Do Not Execute, Live Pilot Handoffs

**Files:**

- Create: `docs/pilots/LIFEOF_PILOT.md`
- Create: `docs/pilots/DINO_ESCAPE_PILOT.md`
- Create: `docs/pilots/LIVE_PILOT_APPROVAL.md`
- Create: `tests/release/live-pilot-readiness.test.ts`

- [ ] **Step 1: Document each live-pilot discovery and rollback procedure.** Include sensitive exclusions, scratch path, root/workstreams, and acceptance checks.

- [ ] **Step 2: Require target-specific approval.** Bind repository, branch/worktree, scope, timing, allowed writes, import owner, and commit permission.

- [ ] **Step 3: Encode approval non-transferability.** Neither pilot authorizes the other, deployment, publication, production changes, or deletion.

- [ ] **Step 4: Add the live-pilot readiness test.** Require backup/rollback, secret handling, preflight, dry run, acceptance, and explicit approval.

- [ ] **Step 5: Run focused tests and commit.**

```powershell
npm test -- tests/release/live-pilot-readiness.test.ts
git add docs/pilots tests/release/live-pilot-readiness.test.ts
git commit -m "docs(pilots): prepare scoped live validation handoffs"
```

Expected: the repository is ready to request live-pilot authorization, but no live project has changed.

## Final v1 Release-Candidate Gate

- [ ] `npm ci --ignore-scripts` succeeds from a fresh clone.
- [ ] `npm audit --omit=dev` has no unresolved high or critical runtime finding.
- [ ] `npm run check` exits `0` on Windows and Linux.
- [ ] Catalog inventory reports 11 groups, 62 blueprints, 16 families, 257 assembled patterns, and 13 companion rules.
- [ ] All 150 blueprint fixtures and all cross-subsystem golden scenarios pass.
- [ ] The supported-brief benchmark is at least `98%` with zero schema invention and zero authority expansion.
- [ ] At least two recorded lower-reasoning trials across at least 30 supported briefs satisfy the rubric.
- [ ] Scratch LifeOf, Dino Escape, and external-campaign pilots pass end to end.
- [ ] Generated schemas, locks, views, archives, and release bundles are deterministic and verify independently.
- [ ] `npm pack --dry-run` contains only the declared runtime, catalog, schema, template, and documentation files.
- [ ] No live project, registry, deployment target, or public channel was modified.
- [ ] `git diff --check` produces no output and `git status --short` is empty.

