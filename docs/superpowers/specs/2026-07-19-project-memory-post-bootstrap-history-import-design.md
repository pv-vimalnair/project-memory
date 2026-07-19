# Project Memory Post-Bootstrap Guided History Import Design

Date: 2026-07-19

Status: Approved in conversation; awaiting written-spec review

Scope: One Project Memory plugin improvement

## 1. Outcome

After Project Memory bootstraps a repository that already contains PRDs, handoffs, changelogs, decision logs, plans, task lists, or agent notes, the plugin must not forget those sources or leave the generated memory views empty.

On the next startup, the plugin guides the active agent through one bounded legacy-review flow. The agent extracts proposed facts from the detected sources, the engine validates and maps them to canonical records, Pitaji reviews one grouped proposal, and the trusted coordinator applies the exact approved plan. The original source documents remain unchanged. Subsequent startups resume normally unless a legacy source is new or has changed.

This feature is general-purpose. LifeOf is the acceptance pilot, not a special-case implementation.

## 2. Problem

The current engine already performs a safe read-only legacy scan during uninitialized startup. It records source paths, hashes, detected document roles, Git revisions, and sensitivity findings, and it returns an all-unaccepted `legacy_import_proposal` with the bootstrap proposal.

That is not yet an end-to-end user experience:

- successful bootstrap consumes the bootstrap proposal handle;
- initialized startup returns `resume` and does not surface the unresolved legacy review;
- no durable import report exists until an import is applied;
- the generic reviewed-import record writer does not materialize complete canonical record schemas;
- consequently, `NOW.md`, `HANDOFF.md`, `CHANGELOG.md`, and `HISTORY.md` remain mostly empty even when the repository already contains valuable history;
- an agent must currently understand internal input schemas and command details to continue the import.

The improvement must close this lifecycle gap without treating unreviewed legacy prose as accepted truth.

## 3. Success criteria

The feature is complete when all of the following are true:

1. A legacy repository follows `bootstrap proposal -> bootstrap apply -> legacy review proposal -> legacy import apply -> resume` without manual Project Memory file creation.
2. Startup surfaces only unresolved legacy sources. A source already resolved at the same path and content hash is not proposed again.
3. A new source or a changed source is proposed on a later startup without reopening unchanged resolved sources.
4. The user sees one concise grouped proposal and makes one confirmation decision; the user never selects schemas, record IDs, destinations, folders, or profiles.
5. Accepted facts create schema-valid canonical records with durable source provenance.
6. Completed work, decisions, constraints, ideas, risks, removed/rejected items, and next actions appear in the appropriate generated views when the available evidence supports them.
7. Ambiguous, contradictory, ownerless, low-confidence, or sensitive material is unresolved, rejected, or archive-only; it never silently becomes accepted truth.
8. Legacy sources are never deleted, rewritten, or moved by the import.
9. Every mutation is bound to the repository, root ID, profile lock, source hashes, plan hash, expected Git head, expiry, actor, and exact approval.
10. The entire workflow works offline and adds no dependency or cloud service.

## 4. Non-goals

This change does not:

- modify LifeOf application code;
- make Project Memory depend on Codex, Claude, Notion, or any hosted model;
- repair unrelated release metadata, CI, startup reading-order text, or adapter-selection issues;
- auto-accept product direction merely because it appears in an existing document;
- infer every possible prose format perfectly;
- replace the normal work lifecycle for future tasks;
- make dirty-checkout or worktree policy changes;
- publish a release.

## 5. User experience

### 5.1 Uninitialized repository

The existing bootstrap experience remains unchanged. `project_memory_start` returns one compact bootstrap proposal and may include a read-only legacy-source summary. Pitaji confirms the bootstrap once. Bootstrap creates only the normal Project Memory structure.

### 5.2 First initialized startup with unresolved legacy sources

After profile and view verification, startup rescans eligible legacy sources and subtracts sources already covered by valid import reports. If unresolved sources remain, startup returns `legacy_import_review_required` instead of `resume`.

The compact directive contains:

- repository/root/profile bindings;
- a short-lived review handle;
- unresolved source paths and content hashes;
- detected document roles and Git revision when available;
- sensitivity warnings;
- deterministic review guidance;
- no full source bytes and no canonical mutation plan.

The skill reads only those source files and prepares fact drafts. The user does not fill in a form or create YAML/JSON files.

### 5.3 Guided planning

The skill submits the fact drafts through `project_memory_read` in legacy-import planning mode. The engine validates the review handle, rereads and rehashes every source, converts supported facts into complete canonical records, builds an immutable import report, regenerates all six views, and stores the exact mutation plan behind a separate apply handle.

The returned compact proposal groups facts under plain-language headings:

- Completed work
- Current accepted facts and decisions
- Constraints and do-not-do rules
- Next actions
- Ideas under consideration
- Risks and findings
- Removed, rejected, superseded, or withdrawn items
- Archive-only or unresolved material

For each proposed canonical fact, the summary shows its source path, classification, destination record type/status, and concise rationale. It also shows assumptions, conflicts, sensitivity handling, plan hash, expected Git head, and expiry.

The skill asks Pitaji for one confirmation of this complete proposal. If the proposal contains unresolved consequential ambiguity, it asks one focused clarification before producing the final grouped proposal.

### 5.4 Apply and resume

After explicit confirmation, the skill invokes `project_memory_apply` in legacy-import mode with the engine-issued apply handle. The host recomputes and validates the bound plan, creates the exact approval evidence, and delegates the atomic mutation to the `IntegrationCoordinator`.

On success, the tool returns a compact `legacy_imported_verified` receipt. The skill calls startup again. Startup returns `resume` when no unresolved sources remain, and the agent reads the normal five-file prefix.

Declining the proposal performs no write. A later startup may surface the same unresolved sources again because no repository decision was recorded.

## 6. Architecture

The feature extends existing components rather than creating a parallel import system.

### 6.1 Pending-source detector

Add a repository-aware detector on top of the existing `LegacyScanner`.

It must:

1. exclude Project Memory-owned material (`PROJECT_CONTEXT.md` and `docs/project-memory/**`) from post-bootstrap scans;
2. retain normal repository sources such as PRDs, handoffs, changelogs, README files, and tool instruction files;
3. read and schema-validate existing immutable import reports under `docs/project-memory/governance/imports/`;
4. treat a source as resolved only when a valid report contains the same repository-relative path and exact source hash;
5. return only new or changed source artifacts;
6. fail closed if a report is malformed, path-unsafe, hash-inconsistent, or contradictory.

The detector does not use timestamps or filenames alone. Path plus content hash is the durable resolution identity. A modified source therefore becomes a new candidate while unchanged sources remain resolved.

### 6.2 Agent start directive

Extend `AgentStartDirective` with `legacy_import_review_required`.

This directive is evaluated after doctor, profile, and generated-view verification and before assigned task packets are returned. Project work must not begin from incomplete context when unresolved legacy sources exist.

The directive carries only compact review metadata. The host issues an unguessable, expiring review handle bound to the root URL, root ID, profile-lock hash, scan hash, unresolved source path/hash set, and current Git head.

### 6.3 Fact-draft contract

The agent submits small evidence-bound fact drafts rather than internal canonical records. A draft contains:

- source path and source hash;
- source line range or heading anchor;
- category;
- title;
- concise statement;
- rationale;
- confidence (`high`, `medium`, or `low`);
- optional temporal status and Git revision evidence;
- disposition (`import`, `archive`, `reject`, or `unresolved`).

Supported categories are:

- `completed_work`
- `current_decision`
- `constraint`
- `next_action`
- `idea`
- `risk`
- `finding`
- `removed`
- `rejected`
- `superseded`
- `lesson`

The engine, not the agent, chooses canonical record IDs, paths, schema fields, relationships, and statuses. Unknown categories, unsafe paths, unbound anchors, duplicate facts, invalid transitions, and unsupported destinations fail validation.

Low-confidence facts cannot be accepted. Directional facts require exact Pitaji approval. Sensitive source content is never copied into a record or tool response; archive-only storage requires validated redaction when existing policy requires it.

### 6.4 Canonical materialization

Replace the incomplete generic record output in the reviewed import planner with complete, schema-validated records.

The deterministic mapping is:

| Draft category | Canonical outcome |
| --- | --- |
| `completed_work` | Historical `change` plus source `evidence`; `closed` only when the source supports completion |
| `current_decision` | `decision` with `accepted` or `proposed` status according to approval |
| `constraint` | Accepted `decision` whose choice and consequences express the constraint |
| `next_action` | Proposed `idea`; it becomes a task only through the normal work lifecycle later |
| `idea` | Proposed, rejected, or withdrawn `idea` |
| `risk` | Accepted or proposed `risk` |
| `finding` | Accepted or proposed `finding` with source evidence |
| `removed` / `rejected` / `superseded` | Terminal `idea` or `decision`, preserving the stated reason |
| `lesson` | Accepted or proposed `lesson` with source evidence |

Every imported fact links to a schema-valid `evidence` record containing the source-relative path, exact source hash, source Git revision when available, and the review statement. Record IDs are deterministic from the approved input and creation timestamp so replan-before-apply reproduces the exact plan.

A historical change appears in `CHANGELOG.md` only when it has both a real source Git revision and an evidence relationship, matching the existing validated-change rule. Otherwise it remains honestly discoverable in `HISTORY.md` without fabricating a commit. The import does not invent verification evidence.

### 6.5 Resolution report

The existing import report becomes the durable resolution ledger for the reviewed source set. It records every source path/hash, every fact draft and disposition, imported record IDs, original/redacted archive paths, approval IDs, unresolved reasons, and generated-view hashes.

A fully rejected or archive-only source is still recorded as resolved so it does not prompt again unchanged. An unresolved source is not marked resolved and remains eligible for a later review.

Reports are append-only. A changed source creates a new proposal and report; it does not rewrite the earlier report.

### 6.6 Host and MCP surface

Keep the three existing MCP tools.

- `project_memory_start` adds the initialized `legacy_import_review_required` directive.
- `project_memory_read` adds a typed legacy-import planning mode that accepts the review handle and fact drafts and returns a compact apply proposal.
- `project_memory_apply` adds a `legacy_import` mode that accepts only the apply handle and explicit approval.

The proposal store is generalized to retain typed, expiring review envelopes and exact mutation plans across MCP process restarts. Full source bytes and plans remain local and never enter model context.

Generic command-mode `import apply` does not gain trusted authority. Only the host path may authorize an import, and only for the exact handle-bound plan confirmed by Pitaji. The host-scoped authority validator accepts that single plan hash and rejects every other mutation. The `IntegrationCoordinator` remains the only writer.

### 6.7 Skill behavior

Update the Project Memory skill and agent protocol so lower-reasoning agents follow one deterministic route:

1. start;
2. if legacy review is required, read only the returned source paths;
3. extract evidence-bound drafts using the fixed categories;
4. request the engine plan;
5. present the complete grouped summary;
6. obtain one confirmation;
7. apply by handle;
8. restart and read the normal context prefix.

The skill must explicitly forbid manual edits to canonical records, import reports, generated views, and Project Memory configuration.

## 7. Data flow

```text
initialized startup
  -> verify doctor, profile, views
  -> scan eligible repository sources
  -> subtract path+hash pairs in valid import reports
  -> no pending sources: resume
  -> pending sources: issue review handle
  -> agent reads named sources and submits fact drafts
  -> validate handle, hashes, anchors, classifications, confidence, sensitivity
  -> materialize complete records + evidence + report + regenerated views
  -> issue compact apply proposal and exact-plan handle
  -> Pitaji confirms once
  -> revalidate head, hashes, profile, approval, expiry, and plan
  -> IntegrationCoordinator applies atomically
  -> verify receipt and generated views
  -> startup returns resume
```

## 8. Safety and failure behavior

- Any changed Git head, profile lock, source hash, plan hash, approval binding, or expiry invalidates the handle and causes a fresh proposal.
- A missing, corrupt, or expired local handle causes no repository write and can be regenerated from repository evidence.
- A malformed import report blocks startup with its exact issue; it is never silently ignored.
- A source containing detected secrets or personal data is not echoed in the compact proposal. Import requires validated redaction or an explicit exclude decision.
- Conflicting fact drafts remain unresolved until clarified; the engine must not choose between them.
- An import that would create an invalid record or stale generated view fails before canonical ref advancement.
- Coordinator failure leaves canonical state unchanged.
- Original legacy sources remain byte-identical after success and failure.
- The workflow is deterministic under LF/CRLF normalization rules already used by repository mutation verification.

## 9. Test strategy

### Unit tests

- post-bootstrap scanner exclusions;
- valid-report resolution by exact path and hash;
- changed and newly added source detection;
- malformed or conflicting report rejection;
- review/apply handle binding, expiry, persistence, consumption, and tamper rejection;
- fact-draft category, anchor, confidence, duplicate, sensitivity, and approval validation;
- complete canonical record materialization for every supported category;
- no fabricated commit in historical change records;
- deterministic plan and record IDs;
- original-source no-write invariant.

### Host and MCP tests

- compact `legacy_import_review_required` response;
- plan mode returns a bounded summary and apply handle, not full source bytes or plan writes;
- apply requires `confirmed: true` and `granted_by: "Pitaji"`;
- plan survives a separate MCP process;
- generic command-mode import cannot acquire trusted authority;
- successful handle is consumed; failed apply remains safely retryable only while bindings remain valid.

### End-to-end tests

1. Bootstrap a legacy fixture containing a PRD, handoff, changelog, decisions, and task notes.
2. Verify bootstrap changes no legacy source.
3. Restart and receive legacy review rather than `resume`.
4. Plan and apply reviewed facts through separate MCP processes.
5. Verify schema-valid records, immutable evidence/report, all six view hashes, clean diff check, and byte-identical legacy sources.
6. Restart and receive `resume` with no repeated prompt.
7. Change one legacy source and verify only that source returns for review.
8. Repeat the flow on Windows with CRLF sources and on Linux with LF sources.

### LifeOf acceptance pilot

Run the feature in a clean isolated LifeOf worktree at a pinned Git head. The expected result is that its existing detected legacy materials are reviewed through one grouped proposal and useful accepted history appears in generated views. Verify the original LifeOf checkout remains unchanged. This pilot is validation only; no LifeOf-specific rule enters production code.

## 10. Implementation boundaries

Expected changes are limited to:

- legacy scan/pending detection and import contracts;
- reviewed import record materialization and report schema;
- agent startup directive;
- host proposal storage and trusted import apply path;
- MCP schemas/routing;
- Project Memory skill/protocol documentation;
- focused unit, host, MCP, end-to-end, and LifeOf pilot tests.

No new package dependency, network call, database, background service, UI, or separate plugin is required.

## 11. Release gate for this improvement

This feature is implementation-complete only when:

- focused tests pass;
- full typecheck, lint, and test suites pass;
- plugin and skill validation pass;
- MCP initialize/ping and offline verification pass;
- the end-to-end legacy fixture passes across proposal and apply processes;
- the isolated LifeOf pilot produces meaningful populated views and leaves the original checkout untouched;
- `git diff --check` passes;
- no unrelated release, CI, or application files changed.

Publishing remains a separate explicitly approved action.
