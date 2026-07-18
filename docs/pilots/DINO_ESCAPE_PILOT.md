# Dino Escape live pilot handoff

Status: **PREPARED — NOT AUTHORIZED**

This handoff prepares a reversible Project Memory validation for Dino Escape. It grants no repository access, scratch creation, write, import, commit, or external action. A completed copy of [LIVE_PILOT_APPROVAL.md](LIVE_PILOT_APPROVAL.md) with explicit Pitaji approval for this exact pilot and target is mandatory before execution.

## Enduring root

Dino Escape remains one enduring game product root. Unity setup, gameplay work, art production, QA, performance review, security review, marketing, and Project Memory onboarding are finite workstreams inside that root.

## Workstreams, not roots

The proposed pilot uses bounded workstreams for:

1. repository and planning-document discovery;
2. proposed PRD/history import mapping and review;
3. game-product profile compilation and doorway generation;
4. agent handoff, task packet, claim, completion, and coordinator checks;
5. evidence review and rollback readiness.

No folder, scene, feature, platform, or campaign is promoted to another root.

## Read-only discovery

Within the approved window, record the exact repository identity, branch, HEAD, worktree list, concise status, applicable instructions, Unity/package versions visible from configuration, Project Memory presence, and candidate planning-document paths. Do not open or copy private content beyond the approved discovery fields. Stop on target drift, an unexpected nested repository, a dirty path outside the baseline, or a sensitive-data indication.

Discovery observations remain hash-bound proposals; they do not silently become accepted game direction, scope, or history.

## Sensitive exclusions

Exclude credentials, tokens, signing keystores, certificates, `.env*`, platform service files, private package-registry credentials, player data, analytics or crash exports, device captures, private communications, licensed third-party source assets, and full private-repository copies. Record a redacted type/path/hash finding only; never copy the underlying bytes into prompts, fixtures, reports, archives, or scratch evidence.

Unity `Library`, `Temp`, `Logs`, `obj`, build outputs, caches, IDE state, and generated platform folders are neither import sources nor evidence. Stop the affected path when ownership, license, secrecy, or personal-data status is uncertain.

## Approved scratch path

The approval must bind one empty, isolated worktree and evidence directory in `isolated_worktree_path`, outside the live checkout and dedicated to this Dino Escape pilot. A placeholder, reused path, implicit system temporary directory, or LifeOf scratch path is invalid.

All proposals and writes remain isolated there until coordinator validation and any explicit commit permission.

## Preflight

Before any mutation:

- validate approval identity, repository, branch, expected HEAD, time window, scope, exact allowed writes, import owner, and permissions;
- verify Node.js 24, Git, the package SHA-256, generated artifacts, deterministic benchmark, and Project Memory diagnostics;
- compare status to the approved dirty-state baseline and stop on drift;
- verify the isolated scratch boundary and sensitive exclusion list;
- record a no-write preflight receipt, abort owner, and rollback owner.

Warnings do not authorize continuation unless Pitaji explicitly accepts them for this pilot.

## Dry run

Use read-only diagnostics, initialization planning, import scanning/proposal, profile planning, task materialization, and completion validation. Do not run apply or finalization. Present the proposed single game root, profile, document/source mapping, path allowlist, canonical diff, plan hash, expected HEAD, evidence gaps, secret findings, approvals, and not-run checks.

The dry run passes only when it preserves one Dino Escape root, treats all finite game work as workstreams, uses at most one grouped clarification, invents no schema, expands no authority, and stays within the exact approval.

## Backup and rollback

After approval and before any authorized write, record the pre-pilot HEAD and create a verified Git bundle in the approved scratch path. Hash the bundle and prove the expected commit is readable. Untracked, licensed, secret, or personal files must never enter the backup.

If work is uncommitted, stop with evidence preserved and request cleanup direction. If an authorized pilot commit must be reversed, validate rollback permission and create a new `git revert` commit for that exact pilot commit. Re-run diagnostics and view checks and preserve both sides of the history.

## Provisional allowed writes

The target approval must enumerate the exact subset:

- `tools/project-memory/config.json`;
- `docs/project-memory/**`;
- `PROJECT_CONTEXT.md`;
- a newly created or explicitly approved Project Memory block in `AGENTS.md` and/or `CLAUDE.md`.

Unity scenes, scripts, prefabs, assets, packages, project settings, platform configuration, builds, and existing PRD content remain out of scope unless a new approval names exact paths and authority.

## Acceptance checks

- Approval and preflight bind one target, HEAD, window, scratch path, and write allowlist.
- Dry-run and final recomputation hashes agree exactly.
- Dino Escape remains the only enduring root and all finite work remains workstreams.
- Legacy bytes, proposed interpretations, accepted decisions, and history remain distinct and fully evidenced.
- No secret, player, licensed, or private source bytes enter generated records or evidence.
- Canonical writes are atomic, coordinator-owned, and restricted to approved paths.
- Views, archive references, task packets, claims, gates, and append-only audit history validate.
- Tests are passed or accurately recorded as not run; the final diff contains no unexpected game-file change.
- Backup verification and the `git revert` rollback path are proven.
- No external action occurs, and Pitaji reviews the final evidence before acceptance.

Failure of any check leaves the result `not accepted`; it never grants follow-on authority.
