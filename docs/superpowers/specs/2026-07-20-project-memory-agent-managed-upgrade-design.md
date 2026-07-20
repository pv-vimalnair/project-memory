# Project Memory Agent-Managed Repository Upgrade Design

**Date:** 2026-07-20
**Status:** Draft for Pitaji review
**Scope:** First product-level compatibility improvement after v0.1.1

## Decision

Project Memory will gain a backward-compatible, agent-managed repository upgrade flow.

When a newer plugin recognizes an older supported Project Memory repository contract, startup will present one bounded proposal. After one explicit confirmation, the plugin will upgrade only its own repository metadata and derived artifacts through the existing coordinator, verify the result, and resume normal Project Memory use.

This is a Project Memory product capability. LifeOf is only the first realistic compatibility fixture; no LifeOf-specific rule or application-code change belongs in the implementation.

## Problem

An initialized repository can be valid under the plugin version that created it and appear stale under a newer plugin whose generated startup or view contract changed. The current v0.1.1 behavior reports `DOCTOR_VIEWS_STALE` and stops. That is safe, but it leaves an ordinary user without a product-supported recovery path.

The missing product behavior is not a looser verifier. It is a versioned upgrade contract that can distinguish:

- an older supported repository that can be upgraded safely;
- a current repository whose derived files were altered;
- an unsupported or ambiguous repository that must remain blocked.

## Considered Approaches

### 1. Tell the user to run repair commands

The agent could diagnose stale files and ask the user to regenerate them manually. This is simple to implement but fails the product goal: it exposes internal paths and commands, produces inconsistent experiences across agents, and makes preservation dependent on user expertise.

### 2. Silently regenerate stale files

Startup could overwrite generated files whenever verification fails. This has the smoothest surface but weakens consent and makes real corruption indistinguishable from a supported upgrade. It conflicts with the existing explicit-migration architecture.

### 3. Guided automatic upgrade after one confirmation

Startup recognizes a supported older contract, creates an exact expiring proposal, and asks once. Apply revalidates the proposal and commits one coordinator-owned mutation. This preserves safety while giving Codex, Claude, OpenClaw, Hermes, and other MCP-capable agents the same simple workflow.

**Chosen:** Approach 3.

## User Experience

### Compatible initialized repository

1. The agent calls `project_memory_start` as usual.
2. Project Memory detects that the repository contract is older but supported.
3. Startup returns `upgrade_review_required` with a compact summary:
   - current and target repository contract versions;
   - exact categories and count of files that may change;
   - a statement that canonical memory and history will be preserved;
   - expected Git HEAD, plan hash, expiration, and any warnings;
   - one explicit confirmation request.
4. The user confirms once.
5. The agent calls the dedicated upgrade apply mode with the proposal handle.
6. Project Memory revalidates, applies one atomic mutation, verifies it, and returns `upgraded_verified`.
7. A fresh startup returns `resume` with the normal five-file reading order.

The user does not select a profile, write YAML, choose internal files, or run migration commands.

### Unsupported or unsafe repository

Project Memory remains fail-closed and returns one concrete next action. It never relabels arbitrary corruption as an upgrade.

## Repository Contract Version

Add `repository_contract_version` to `tools/project-memory/config.json`. This version describes the on-repository Project Memory layout and generated-artifact contract. It is independent of:

- the plugin package version;
- record schema versions;
- the catalog release;
- the profile-lock version.

The first explicit target is `1.1.0`. A repository without the field is treated as the pre-marker `1.0.0` contract only when all authoritative compatibility checks pass:

- tool configuration validates against the known pre-marker shape;
- the profile lock verifies;
- the selected catalog lock verifies;
- canonical source and records build a valid snapshot;
- there is no unfinished coordinator transaction;
- a registered `1.0.0 -> 1.1.0` path exists.

Generated view drift does not disqualify this specific upgrade because generated views are non-authoritative and will be rebuilt. Failure of any authoritative check remains a blocker.

New bootstraps write `repository_contract_version: "1.1.0"` directly and never need this migration.

## Architecture

### Compatibility inspection

Agent startup performs a read-only repository-contract inspection before treating derived-view mismatch as a terminal doctor failure.

The inspector returns one of four states:

- `current`: run the existing doctor and resume flow;
- `upgrade_available`: create an upgrade proposal;
- `unsupported`: block with the current and supported versions;
- `invalid`: preserve the existing validation failure.

The inspector does not write, repair, or infer missing authoritative facts.

### Upgrade planning

Add a plan-only repository upgrade service that composes existing capabilities rather than creating a second migration engine. It uses:

- the existing forward-only migration registry for the version path;
- current profile, catalog, and canonical snapshot verifiers;
- the existing config, startup doorway, and view renderers;
- the existing canonical mutation contract;
- the existing `IntegrationCoordinator` as the only writer.

The service produces one deterministic plan containing expected preimages, writes, preservation evidence, the migration record, and validation requirements. Planning is side-effect free.

### Proposal lifecycle

Add an `upgrade` proposal kind to the persistent proposal store and host API. The stored envelope binds:

- canonical repository identity;
- current and target repository contract versions;
- expected Git HEAD;
- profile-lock and catalog-lock hashes;
- canonical source-set hash;
- exact planned path set and preimage hashes;
- plan hash and expiry;
- confirmation state.

The compact directive contains the proposal handle and user-readable summary, not the full internal plan.

### Apply lifecycle

Add a dedicated `upgrade` mode to `project_memory_apply`.

Apply must:

1. Resolve the exact unexpired proposal.
2. Re-read repository state and rebuild the plan.
3. Compare repository identity, HEAD, versions, authoritative hashes, path set, and plan hash.
4. Require the explicit confirmation token carried by the approved proposal flow.
5. Submit the recomputed plan once to `IntegrationCoordinator.finalizeMutation`.
6. Consume the proposal handle only after successful finalization.
7. Run post-apply verification and a fresh startup check.

No MCP handler, host method, migration transform, or renderer may write governed files directly.

### CLI fallback

The existing migration CLI remains the lower-level and non-MCP fallback. The agent-managed flow shares the same version registry, planning rules, and coordinator. It must not maintain a separate set of transforms.

## Exact Mutation Boundary

For `1.0.0 -> 1.1.0`, the approved mutation may:

### Keep byte-for-byte

- project source records;
- decisions, ideas, risks, findings, evidence, changes, approvals, and history;
- workstream and task records;
- profile lock;
- catalog lock and vendored catalog selections;
- accepted legacy-import records and original archives;
- application and product source code.

### Add or update

- `tools/project-memory/config.json`, only to add the target repository contract version while preserving all existing settings;
- `PROJECT_CONTEXT.md`, regenerated by the target startup-doorway renderer;
- the six plugin-owned generated views, regenerated deterministically from the unchanged canonical snapshot;
- one immutable repository-upgrade migration record containing before/after versions, hashes, changed paths, actor, timestamp, and verification outcome.

### Remove

Nothing.

Generated views are disposable projections, not canonical history. Their prior hashes are recorded in the migration evidence; they are not imported as new product facts.

## Clean and Dirty Repository Behavior

This first improvement preserves the existing clean-canonical-tree safety policy.

- A clean compatible repository receives the one-confirmation upgrade flow.
- A dirty repository receives a clear `upgrade_blocked` result naming `GIT_DIRTY_ROOT` and explaining that no files were changed.
- The plugin does not auto-stash, commit user work, create an integration worktree, or relax `require_clean_canonical_tree` in this slice.

Automatic dirty-root isolation and integration is a separate product improvement because it changes concurrency and ownership policy. It must not be smuggled into this compatibility fix.

## Failure and Recovery Rules

- Unsupported version or missing migration edge: block without writes.
- Invalid profile, catalog, or canonical snapshot: return the original validation error.
- Current-contract derived drift: retain `DOCTOR_VIEWS_STALE`; do not offer an upgrade.
- Expired handle, changed HEAD, changed preimage, or changed plan: invalidate the proposal and require a fresh one.
- Coordinator or gate failure: leave canonical state unchanged and keep the handle retryable only when the failure is demonstrably transient and the plan remains identical.
- Successful apply with failed post-verification: return a precise failure and do not report `upgraded_verified`.
- Re-running startup after success: return `resume`, not another proposal.

The flow remains fully local and offline. It introduces no network call, hosted service, account, or dependency.

## Agent and Protocol Contract

The plugin skill must teach every supported agent the same behavior:

- always call startup first;
- summarize `upgrade_review_required` in plain language;
- ask for one confirmation of that exact proposal;
- call only the dedicated upgrade apply mode after confirmation;
- never edit or regenerate Project Memory files manually;
- read the returned five-file order only after `resume` or `upgraded_verified` validation succeeds.

The result wording must make clear that the repository memory format is being upgraded, not the user's application.

## Verification Strategy

Add a sanitized pre-marker repository fixture generated from committed v0.1.0-compatible bytes. Test the product through host, MCP, and package boundaries.

Required focused scenarios:

1. v0.1.0-compatible startup returns `upgrade_review_required`, not `DOCTOR_VIEWS_STALE`.
2. Proposal creation is read-only.
3. Apply succeeds across separate MCP processes using the persistent handle.
4. Only the exact allowlisted plugin-owned paths change.
5. Every pre-existing canonical source, record, profile-lock, catalog-lock, and archive hash is unchanged.
6. Exactly one new migration record accurately describes the mutation.
7. Fresh startup returns `resume` with the five-file reading order.
8. A second startup is idempotent and proposes no upgrade.
9. Current-contract view tampering remains blocked as stale.
10. Dirty root, expired handle, HEAD drift, preimage drift, unsupported version, and coordinator failure all fail closed with no partial writes.
11. LF and CRLF checkouts produce the same logical result without false `PROFILE_TARGET_READ_FAILED` or view-hash failures.
12. The offline plugin bundle contains the contract metadata, migration edge, agent instructions, and runtime code required for the flow.

Run focused tests first, then the existing full `npm run check`, generated-artifact verification, package tests, and `git diff --check`.

## Acceptance Criteria

This improvement is complete only when:

- an agent can upgrade a compatible clean initialized repository after one user confirmation;
- no manual Project Memory file creation or command selection is required;
- every pre-existing canonical memory and history artifact is proven unchanged, with only the new migration record appended;
- all writes are one coordinator-owned mutation;
- startup resumes and reads the correct five files after upgrade;
- the flow works offline and across separate proposal/apply processes;
- unsafe, ambiguous, unsupported, dirty, or changed repositories remain fail-closed;
- no product repository, including LifeOf, is modified during plugin development or testing.

## Non-Goals

- repairing LifeOf application code or its existing dirty checkout;
- automatically merging an isolated worktree into a user's active branch;
- changing schema, catalog, profile, or historical record semantics;
- importing previously rejected legacy material;
- silent migrations;
- cloud sync, Notion synchronization, hosted services, or accounts;
- new dependencies, graphical UI, public publishing, installation, or release in this change;
- general repair of arbitrary corrupted Project Memory repositories.
