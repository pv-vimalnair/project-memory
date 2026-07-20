# Project Memory v0.1.1 History-Preserving Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make v0.1.1 the current source on local `main` while preserving the published v0.1.0 release as an independently recoverable and installable historical version.

**Architecture:** Treat Git tags and GitHub releases as immutable version boundaries. Import the existing remote `v0.1.0` annotated tag into the local repository, fast-forward `main` without squashing the v0.1.1 commits, and validate the old tag and new package independently.

**Tech Stack:** Git, GitHub Releases, Node.js, npm, TypeScript, Vitest

## Global Constraints

- Preserve the existing remote `v0.1.0` tag object `f2e09339e988bb044eceea81191d083440746a58` and its target commit `5e74f7a85356045633ba5a924b3a7deb82bfd21d` unchanged.
- Preserve the existing GitHub release at `https://github.com/pv-vimalnair/project-memory/releases/tag/v0.1.0`.
- Keep commit `af623d9bca914b13c7ab786bddc7fc481300f7c1` in the unsquashed ancestry of the merged `main` branch.
- Do not force-push, retarget tags, rewrite history, delete branches, publish, install, or create the v0.1.1 release in this merge task.
- Stop before merging if either checkout is dirty or the merge cannot be completed with `--ff-only`.

---

### Task 1: Preserve the v0.1.0 boundary and fast-forward local main

**Files:**
- Read: `docs/superpowers/specs/2026-07-20-v0.1.1-release-history-design.md`
- Read: `docs/publication/PUBLICATION_APPROVALS.json`
- Modify through Git only: local `refs/tags/v0.1.0` and local `refs/heads/main`

**Interfaces:**
- Consumes: remote annotated tag `refs/tags/v0.1.0` and branch `codex/post-bootstrap-history-import`.
- Produces: local `main` pointing at the complete feature-branch tip, with the independent v0.1.0 tag retained.

- [ ] **Step 1: Verify both worktrees and capture the feature tip**

```powershell
git -C C:\tmp\pm status --porcelain
git -C "C:\Users\Pv Vimal Nair\project-memory" status --porcelain
git -C C:\tmp\pm merge-base --is-ancestor main codex/post-bootstrap-history-import
git -C C:\tmp\pm merge-base --is-ancestor af623d9bca914b13c7ab786bddc7fc481300f7c1 codex/post-bootstrap-history-import
$featureTip = git -C C:\tmp\pm rev-parse codex/post-bootstrap-history-import
```

Expected: both status commands emit nothing, both ancestry checks exit `0`, and `$featureTip` is a 40-character commit SHA.

- [ ] **Step 2: Fetch and verify the existing published v0.1.0 tag**

```powershell
git -C "C:\Users\Pv Vimal Nair\project-memory" fetch origin refs/tags/v0.1.0:refs/tags/v0.1.0
git -C "C:\Users\Pv Vimal Nair\project-memory" rev-parse v0.1.0
git -C "C:\Users\Pv Vimal Nair\project-memory" rev-parse 'v0.1.0^{commit}'
```

Expected: the tag object is `f2e09339e988bb044eceea81191d083440746a58` and its peeled commit is `5e74f7a85356045633ba5a924b3a7deb82bfd21d`.

- [ ] **Step 3: Fast-forward local main without rewriting commits**

```powershell
git -C "C:\Users\Pv Vimal Nair\project-memory" merge --ff-only codex/post-bootstrap-history-import
git -C "C:\Users\Pv Vimal Nair\project-memory" rev-parse main
git -C "C:\Users\Pv Vimal Nair\project-memory" merge-base --is-ancestor af623d9bca914b13c7ab786bddc7fc481300f7c1 main
```

Expected: the merge reports a fast-forward, `main` equals `$featureTip`, and the ancestry check exits `0`.

### Task 2: Validate version separation and the v0.1.1 candidate

**Files:**
- Verify: `plugins/project-memory/package.json`
- Verify: `plugins/project-memory/package-lock.json`
- Verify: `plugins/project-memory/.codex-plugin/plugin.json`
- Verify: `plugins/project-memory/src/version.ts`
- Verify: `docs/publication/PUBLICATION_APPROVALS.json`

**Interfaces:**
- Consumes: merged local `main`, immutable tag `v0.1.0`, and Project Memory release scripts.
- Produces: evidence that v0.1.0 remains recoverable and v0.1.1 passes all local release gates.

- [ ] **Step 1: Verify separate version identities**

```powershell
git -C "C:\Users\Pv Vimal Nair\project-memory" show v0.1.0:plugins/project-memory/package.json
Get-Content -Raw "C:\Users\Pv Vimal Nair\project-memory\plugins\project-memory\package.json"
Get-Content -Raw "C:\Users\Pv Vimal Nair\project-memory\docs\publication\PUBLICATION_APPROVALS.json"
```

Expected: the tagged package reports `0.1.0`, current `main` reports `0.1.1`, and historical publication authorization remains scoped to `0.1.0`.

- [ ] **Step 2: Run static and packaging gates on merged main**

```powershell
npm run typecheck
npm run lint
npm run generated:verify
npm run plugin:verify
npm run package:verify
```

Run from: `C:\Users\Pv Vimal Nair\project-memory\plugins\project-memory`

Expected: every command exits `0`; package verification confirms the v0.1.1 artifact layout and identity.

- [ ] **Step 3: Run the exact full test suite**

```powershell
npm run test:ci
```

Run from: `C:\Users\Pv Vimal Nair\project-memory\plugins\project-memory`

Expected: all test files and tests pass with exit code `0`.

- [ ] **Step 4: Verify final repository state**

```powershell
git -C "C:\Users\Pv Vimal Nair\project-memory" diff --check
git -C "C:\Users\Pv Vimal Nair\project-memory" status --short --branch
git -C "C:\Users\Pv Vimal Nair\project-memory" rev-parse 'v0.1.0^{commit}'
git -C "C:\Users\Pv Vimal Nair\project-memory" rev-parse main
```

Expected: diff check exits `0`, the checkout is clean, v0.1.0 still peels to `5e74f7a85356045633ba5a924b3a7deb82bfd21d`, and `main` remains at the captured feature tip.
