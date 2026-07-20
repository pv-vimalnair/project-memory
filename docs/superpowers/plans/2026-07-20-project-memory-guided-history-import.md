# Guided Legacy History Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the offline, agent-guided post-bootstrap history import so unresolved repository documents become reviewed canonical records and generated views through one exact Pitaji confirmation.

**Architecture:** Extend the existing scanner, startup, proposal cache, host, MCP surface, import planner, coordinator, and view generator. Repository reports resolve documents by exact path plus hash; agents submit evidence-bound fact drafts, while the engine owns identifiers, canonical schemas, destinations, approvals, plan hashes, and atomic writes.

**Tech Stack:** Node.js 24, strict TypeScript/ESM, existing TypeBox/Ajv schemas, Vitest, Git, local stdio MCP, and the existing IntegrationCoordinator.

## Global Constraints

- Normative design: `docs/superpowers/specs/2026-07-19-project-memory-post-bootstrap-history-import-design.md`.
- Work only on `codex/post-bootstrap-history-import` in `C:\tmp\pm`.
- Run npm commands from `plugins/project-memory/`.
- Do not change LifeOf application code, publication metadata, startup-order text, adapter selection, dirty-checkout policy, or the Repository-Grounded Project Map.
- Add no dependency, network call, service, database, background process, UI, generated view, or MCP tool.
- Preserve every legacy source byte-for-byte.
- Ambiguous, conflicting, low-confidence, ownerless, or secret-bearing material never becomes accepted truth.
- Every mutation remains root-, profile-, source-, plan-, head-, expiry-, actor-, and approval-bound and IntegrationCoordinator-only.
- Use TDD and one logical commit per task.
- Do not publish, push, install globally, or integrate into the original LifeOf checkout.

---

## File Map

New files:

- `src/import/pending-review.ts` — post-bootstrap exclusions and report-based pending detection.
- `src/import/materialize-guided-import.ts` — fact validation and complete canonical record planning.
- `src/host/legacy-import-service.ts` — exact-plan import authority and coordinator application.
- `tests/import/pending-review.test.ts`
- `tests/import/materialize-guided-import.test.ts`
- `tests/host/legacy-import-service.test.ts`
- `tests/e2e/plugin-mcp-legacy-import.test.ts`

Existing files remain split by their current responsibilities: import contracts/scanner/report, agent startup, proposal store/host, Node composition, MCP routing, skill/protocol documentation, and focused tests.

### Task 1: Detect unresolved post-bootstrap sources

**Files:**
- Create: `src/import/pending-review.ts`
- Modify: `src/import/contracts.ts`, `src/import/scanner.ts`, `src/import/index.ts`
- Test: `tests/import/scanner.test.ts`, `tests/import/pending-review.test.ts`

**Produces:**

```ts
export interface LegacyScanOptions {
  readonly phase: "bootstrap" | "post_bootstrap";
}

export interface PendingLegacyReview {
  readonly root_id: string;
  readonly scan: LegacyScan;
  readonly proposal: LegacyImportProposal;
}

export function findPendingLegacyReview(
  root: URL,
  rootId: string,
  scanner?: LegacyScanner,
): Promise<RuntimeResult<PendingLegacyReview | null>>;
```

- [ ] Write failing tests proving `post_bootstrap` excludes exactly `PROJECT_CONTEXT.md` and `docs/project-memory/**`, retains normal PRD/handoff/README/AGENTS sources, resolves only an exact source-path/SHA-256 pair from a valid immutable report, returns changed/new sources, and rejects malformed, symlinked, unsafe, or contradictory reports.
- [ ] Run `npx vitest run tests/import/scanner.test.ts tests/import/pending-review.test.ts`; expect failure because the phase option and detector do not exist.
- [ ] Add an optional phase to `LegacyScanner.scan` without changing bootstrap behavior. In the detector, parse strict UTF-8/JSON reports, validate schema version, proposal hash, source paths, hashes, and dispositions, index resolved `path + NUL + hash` pairs, recompute the filtered scan hash with `canonicalJson`, and reuse `proposeLegacyImport`.
- [ ] Run the focused tests and `npm run typecheck`; require success.
- [ ] Run `git diff --cached --check` and commit `feat(import): detect unresolved legacy sources`.

### Task 2: Materialize valid evidence-bound records

**Files:**
- Create: `src/import/materialize-guided-import.ts`
- Modify: `src/import/contracts.ts`, `src/import/render-import-report.ts`, `src/import/index.ts`
- Test: `tests/import/materialize-guided-import.test.ts`, `tests/import/plan-reviewed-import.test.ts`, `tests/governance/canonical-snapshot-builder.test.ts`

**Consumes:**

```ts
export type LegacyFactCategory =
  | "completed_work" | "current_decision" | "constraint" | "next_action"
  | "idea" | "risk" | "finding" | "removed" | "rejected"
  | "superseded" | "lesson";

export interface LegacyFactDraft {
  readonly source_line_start: number;
  readonly source_line_end: number;
  readonly category: LegacyFactCategory;
  readonly title: string;
  readonly statement: string;
  readonly rationale: string;
  readonly confidence: "high" | "medium" | "low";
}

export interface LegacySourceReviewDraft {
  readonly source_path: string;
  readonly source_sha256: string;
  readonly disposition: "import" | "archive" | "reject" | "unresolved";
  readonly rationale: string;
  readonly facts: readonly LegacyFactDraft[];
}
```

**Produces:**

```ts
export interface GuidedLegacyImportInput {
  readonly root_id: string;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly profile_lock_hash: string;
  readonly catalog_version: string;
  readonly proposal_hash: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly sources: readonly LegacySourceReviewDraft[];
}

export function planGuidedLegacyImport(
  input: GuidedLegacyImportInput,
  dependencies: {
    readonly ids: IdFactory;
    readonly read_source: (path: string) => Promise<RuntimeResult<Uint8Array>>;
  },
): Promise<RuntimeResult<ReviewedImportPlan>>;
```

- [ ] Write failing tests for all eleven categories, exact hashes and line anchors, every source reviewed once, non-empty rationale, low-confidence refusal, sensitive-source redaction/exclusion, duplicates, unresolved sources, and deterministic injected identifiers.
- [ ] Run `npx vitest run tests/import/materialize-guided-import.test.ts tests/import/plan-reviewed-import.test.ts`; expect failure because guided materialization is absent.
- [ ] Validate source bytes and anchors. Create complete `evidence` records plus mapped `change`, `decision`, `idea`, `risk`, `finding`, or `lesson` records with every common field, locked catalog version, exact base revision, and evidence relationship. Only copy a real 40-character source Git revision into a completed change; never invent a commit.
- [ ] Emit content-addressed original/redacted archives and an append-only report containing every source, fact, disposition, unresolved reason, imported ID, archive path, approval binding, and all six required view paths. Validate every record with `CanonicalRecordSchema` before hashing the plan.
- [ ] Run the three focused tests plus `npm run typecheck`; require success and canonical snapshot parsing.
- [ ] Run `git diff --cached --check` and commit `feat(import): materialize reviewed legacy facts`.

### Task 3: Block normal resume on pending history

**Files:**
- Modify: `src/agent/contracts.ts`, `src/agent/start.ts`, `src/agent/node-dependencies.ts`
- Test: `tests/agent/start.test.ts`, `tests/e2e/plugin-resume-project.test.ts`

**Produces:**

```ts
{
  readonly kind: "legacy_import_review_required";
  readonly root_id: string;
  readonly profile_lock_hash: string;
  readonly expected_head: string;
  readonly proposal: LegacyImportProposal;
  readonly warnings: readonly RuntimeIssue[];
}
```

- [ ] Write failing tests proving doctor/profile/views run first, pending review runs before task-packet discovery, no pending sources preserve the exact current `resume`, and dependency failure returns `blocked`.
- [ ] Run `npx vitest run tests/agent/start.test.ts tests/e2e/plugin-resume-project.test.ts`; expect failure.
- [ ] Add `findPendingLegacyReview` to startup dependencies, bind the current Git head, return the new directive when pending sources exist, and preserve stable warnings and the uninitialized bootstrap flow.
- [ ] Run focused tests plus `npm run typecheck`; require success.
- [ ] Run `git diff --cached --check` and commit `feat(agent): require pending legacy review`.

### Task 4: Persist typed handles across MCP processes

**Files:**
- Modify: `src/host/proposal-store.ts`
- Test: `tests/host/proposal-store.test.ts`

**Produces:**

```ts
export type StoredProposalEnvelope =
  | { readonly kind: "bootstrap"; readonly root: URL; readonly plan: InitPlan }
  | { readonly kind: "legacy_review"; readonly root: URL; readonly pending: PendingLegacyReview; readonly expected_head: string; readonly profile_lock_hash: string }
  | { readonly kind: "legacy_import"; readonly root: URL; readonly input: GuidedLegacyImportInput; readonly plan: ReviewedImportPlan };

issue(value: StoredProposalEnvelope): ProposalStoreResult<IssuedProposal>;
resolve(handle: string): ProposalStoreResult<StoredProposalEnvelope>;
consume(handle: string): ProposalStoreResult<StoredProposalEnvelope>;
```

- [ ] Write failing tests for bootstrap compatibility, review/import round trips, kind checks, root/hash/expiry validation, corruption/tamper rejection, second-process recovery, capacity failure without eviction, and consumption.
- [ ] Run `npx vitest run tests/host/proposal-store.test.ts`; expect failure.
- [ ] Generalize the existing versioned V8 envelope while retaining unguessable `pm-proposal-<32 hex>` handles, private temporary storage, eight-entry bound, exact expiry, and tamper validation. Keep a bootstrap wrapper if it reduces call-site churn.
- [ ] Run the focused test plus `npm run typecheck`; require success.
- [ ] Run `git diff --cached --check` and commit `refactor(host): persist typed proposal handles`.

### Task 5: Plan and apply one exact approved import

**Files:**
- Create: `src/host/legacy-import-service.ts`
- Modify: `src/host/project-memory-host.ts`, `src/host/index.ts`, `src/cli/node-composition.ts`
- Test: `tests/host/legacy-import-service.test.ts`, `tests/host/project-memory-host.test.ts`, `tests/cli/node-composition-sync.test.ts`

**Produces:**

```ts
ProjectMemoryHost.planLegacyImport(input: {
  readonly review_handle: string;
  readonly created_by: string;
  readonly sources: readonly LegacySourceReviewDraft[];
}): Promise<RuntimeResult<CompactLegacyImportProposal>>;

ProjectMemoryHost.applyLegacyImport(input: {
  readonly proposal_handle: string;
  readonly approval: { readonly confirmed: boolean; readonly granted_by: string };
}): Promise<RuntimeResult<MutationReceipt>>;
```

- [ ] Write failing host tests for compact startup review handles, complete source coverage, bounded grouped summaries, one apply handle, Pitaji-only confirmation, replan/hash/head/profile/source validation, failure retention, and success consumption.
- [ ] Write failing service tests proving authority accepts only one `mutation_kind: "import"` plan hash for one root/ref/head and rejects altered plans, other kinds, roots, and generic CLI requests.
- [ ] Run the three focused files; expect failure.
- [ ] Implement read-only planning: resolve the review handle, reread exact sources, obtain ref/head/profile/catalog context locally, call `planGuidedLegacyImport`, store input plus exact plan, and return only grouped summaries, assumptions/conflicts/sensitivity counts, plan hash, expected head, expiry, and apply handle.
- [ ] Implement apply: require exact Pitaji confirmation, rebuild the plan from stored input, compare plan/head/profile/source bindings, create an authority closure accepting only that plan hash, call `IntegrationCoordinator.finalizeMutation` once, retain checkout synchronization, and consume only after success. Generic command import remains denied.
- [ ] Run the focused tests plus `npm run typecheck`; require success.
- [ ] Run `git diff --cached --check` and commit `feat(host): apply approved legacy imports`.

### Task 6: Extend the existing MCP and skill workflow

**Files:**
- Modify: `src/mcp/server.ts`, `tests/mcp/server.test.ts`, `tests/mcp/stdio.test.ts`
- Modify: `skills/project-memory/SKILL.md`, `skills/project-memory/references/agent-protocol.md`, `tests/plugin/skill-contract.test.ts`, `README.md`

- [ ] Write failing tests asserting exactly three tools remain, legacy planning is a typed `project_memory_read` mode, legacy apply is a typed `project_memory_apply` mode, invalid fields return `-32602`, outputs stay below 64 KiB, and recovery works across MCP processes.
- [ ] Add skill-contract tests for start → read named sources → submit drafts → present one grouped proposal → confirm → apply → restart. Assert the skill forbids manual Project Memory files and silent acceptance.
- [ ] Run `npx vitest run tests/mcp/server.test.ts tests/mcp/stdio.test.ts tests/plugin/skill-contract.test.ts`; expect failure.
- [ ] Add legacy modes without breaking current command/bootstrap modes, annotations, response bounds, or host recovery. Never return source bytes or plan writes.
- [ ] Update the skill, protocol, and package README with the deterministic lower-reasoning flow.
- [ ] Run focused tests, `npm run typecheck`, and `npm run plugin:verify`; require success.
- [ ] Run `git diff --cached --check` and commit `feat(plugin): guide post-bootstrap history import`.

### Task 7: End-to-end proof and release-quality validation

**Files:**
- Create: `tests/e2e/plugin-mcp-legacy-import.test.ts`
- Modify: `tests/e2e/plugin-legacy-project.test.ts`, `tests/e2e/plugin-workflow-harness.ts`
- Modify compiled `dist/**` only through existing build/verification commands when required.

- [ ] Write a failing fixture workflow covering PRD, handoff, changelog, decisions, and task notes. Capture original bytes; assert bootstrap is read-only, post-bootstrap startup requires review, separate-process plan/apply works, records and views are useful, sources remain identical, restart resumes, and one changed source alone reopens.
- [ ] Run `npx vitest run tests/e2e/plugin-mcp-legacy-import.test.ts`; expect failure.
- [ ] Fix only integration defects within Tasks 1–6; add no architecture, dependency, tool, view, project-map, release, or LifeOf-specific behavior.
- [ ] Run all focused import/agent/host/MCP/skill/E2E tests and require success.
- [ ] Run serial gates: `npm run typecheck`, `npm run lint`, `npm run test:ci`, `npm run generated:verify`, `npm run plugin:verify`, and `npm run package:verify`. If a Windows hook times out, rerun the unchanged file and then require the exact full serial suite.
- [ ] In a fresh clean isolated LifeOf worktree at a pinned head, run the locally built offline workflow on a bounded representative legacy set. Require `legacy_import_review_required`, `legacy_imported_verified`, then `resume`; valid six-view hashes; unchanged legacy bytes; and unchanged original LifeOf checkout. Do not integrate or install.
- [ ] From the repository root run `git diff --check`, `git status --short`, and inspect the last eight commits. Require no unrelated changes.
- [ ] Commit E2E-only changes as `test(import): verify guided legacy workflow`.
- [ ] Report exact commits, test counts, gates, LifeOf evidence, unrun checks, remaining risks, and that publication, installation, push, and Repository-Grounded Project Map remain pending.
