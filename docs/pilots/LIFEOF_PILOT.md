# LifeOf live pilot handoff

Status: **PREPARED — NOT AUTHORIZED**

This handoff prepares a reversible Project Memory validation for LifeOf. It does not authorize reading the live repository beyond the approved discovery scope, creating a worktree, writing files, importing documents, committing, or contacting anyone. Execution begins only after a completed copy of [LIVE_PILOT_APPROVAL.md](LIVE_PILOT_APPROVAL.md) records explicit Pitaji approval for this pilot and exact target.

## Enduring root

LifeOf remains one enduring product root. A campaign, UX review, security assessment, code restructure, release check, or Project Memory setup is finite work inside LifeOf; none becomes another root.

## Workstreams, not roots

The proposed pilot separates bounded workstreams:

1. repository and legacy-document discovery;
2. proposed legacy import mapping and human review;
3. product-profile compilation and generated doorway review;
4. agent handoff, claim, completion-packet, and coordinator-finalization validation;
5. evidence review and rollback readiness.

The approval may narrow or remove workstreams. It cannot broaden them by implication.

## Read-only discovery

Within the approved time window, record only the exact repository path, remote identity, branch, current HEAD, worktree list, concise status, applicable instruction files, Project Memory presence, and candidate legacy-document paths. Do not copy file contents during discovery. Stop on an unexpected repository, branch, worktree, submodule, dirty path, access boundary, or sensitive-data indication and request a new review.

The discovery report must bind every observation to its command, path, timestamp, and content hash where applicable. It remains proposed evidence, never accepted product intent.

## Sensitive exclusions

Exclude credentials, tokens, signing material, `.env*`, Firebase service-account material, private certificates, local emulator data, user records, analytics exports, financial records, crash dumps, device backups, private messages, and full private-repository copies. Record only a redacted finding type, path, byte length, and hash when a candidate may be sensitive. Never place sensitive bytes in prompts, reports, archives, fixtures, or the approved scratch path.

Generated build folders, dependency caches, IDE state, coverage, logs, and platform-derived artifacts are not import candidates. A secret or personal-data indication blocks the affected path until Pitaji reviews it.

## Approved scratch path

The exact isolated worktree and evidence directory must be written into `isolated_worktree_path` in the approval. It must be outside the live checkout, empty before use, and dedicated to the one approved LifeOf pilot. Placeholders, a reused worktree, an implicit temporary directory, or a path shared with Dino Escape invalidates authorization.

All proposed writes are staged there first. The live branch remains unchanged until coordinator validation and any separately granted commit permission.

## Preflight

Before any mutation:

- validate the completed approval, target identity, current HEAD, branch, window, scope, allowed-write list, import owner, and permissions;
- confirm Node.js 24, Git availability, package hash, generated artifacts, deterministic benchmark gate, and Project Memory diagnostics;
- compare current status with the approved dirty-state baseline and stop on drift;
- confirm the scratch path is isolated and that no sensitive bytes will be copied;
- record a no-write preflight receipt and the exact abort/rollback owner.

Any failed or warning check remains unresolved until Pitaji explicitly accepts it for this exact pilot.

## Dry run

Run planning and validation paths only: diagnostics, initialization planning, import scanning/proposal, profile planning, task materialization, and completion validation. Do not invoke an apply or finalization path. Present the root/profile selection, source proposal, planned file allowlist, canonical diff, plan hash, expected HEAD, required approvals, unresolved facts, secret findings, and not-run checks.

The dry run passes only when it proposes one LifeOf root, keeps every finite effort as a workstream, asks no more than one grouped clarification, invents no schema, expands no authority, and proposes no path outside the approval.

## Backup and rollback

After approval but before any authorized write, record the immutable pre-pilot HEAD and create a verified Git bundle in the approved scratch path. Record its SHA-256 and prove that the expected commit is readable from it. The backup is evidence for this pilot only and must not contain untracked sensitive files.

If no commit exists, stop with the isolated worktree preserved and request explicit cleanup direction. If an authorized pilot commit exists and acceptance fails, use a new `git revert` commit against that exact pilot commit after validating rollback permission; never rewrite history. Re-run diagnostics and view checks, record both commit IDs, and keep the audit trail append-only.

## Provisional allowed writes

The approval must list the exact subset, never merely refer to this section:

- `tools/project-memory/config.json`;
- `docs/project-memory/**`;
- `PROJECT_CONTEXT.md`;
- a newly created or explicitly approved Project Memory block in `AGENTS.md` and/or `CLAUDE.md`.

LifeOf application code, Firebase configuration, design assets, store metadata, release configuration, and existing product documents are outside this pilot unless a new approval names exact paths and authority.

## Acceptance checks

- Approval and preflight receipts bind the exact target, HEAD, time window, and file allowlist.
- The dry run and final recomputation have the same plan hash and source hashes.
- LifeOf is the sole enduring root; pilot activities are workstreams.
- Original legacy bytes and interpretations remain distinguishable, provenance is complete, and no secret bytes are stored.
- Every canonical mutation is coordinator-owned, atomic, and within the approved paths.
- Required views are current, history is append-only, and worker output cannot accept decisions.
- Tests and diagnostics are recorded as passed or exactly not run; no unsupported success claim remains.
- The final diff contains no unexpected path, product-code change, sensitive data, or authority expansion.
- Backup verification and the `git revert` rollback path are proven before acceptance.
- No external action occurs, and the live pilot is not called complete until Pitaji reviews the evidence.

Until every check passes inside the approved scope, the outcome is `not accepted` and the live target must not advance.
