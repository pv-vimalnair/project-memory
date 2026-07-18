# Codex Plugin Installation Pilot

Status: **PREPARED - NOT AUTHORIZED**

This runbook prepares one reversible local-install pilot for the Project Memory Plugin. It does not authorize installation, registration, cachebuster updates, or changes to Codex configuration.

The marketplace definition is read-only during validation. The delegated clean-package verifier may rewrite `plugins/project-memory/.tmp/**` and `plugins/project-memory/dist/**`; it also executes Node, Python, Git, and official validators from `CODEX_HOME` as explicitly external, not-bound inputs. It does not invoke the Codex CLI, and Codex configuration changes are `not_assessed` rather than claimed absent.
## Local offline workflow proof

Before requesting the real installation pilot, run:

```powershell
npm test -- tests/e2e/plugin-mcp-new-project.test.ts tests/e2e/plugin-mcp-resume-project.test.ts
```

These tests use the packaged `.mcp.json` and clean MCP bundle with no `node_modules` and network-denied environment settings. They require a compact read-only proposal no larger than 64 KiB with no `profile_compilation`, no repository changes before approval, one explicit bootstrap confirmation, an `initialized_verified` result, the fixed resume reading order, and successful resume from a second MCP process using accepted repository context.

This local proof does not install or register the Plugin and does not replace the real Codex implicit-discovery, lower-reasoning, rollback, license, repository-identity, or publication-authority gates.


## Approval gate

Do not run the installation commands until there is explicit Pitaji approval for this exact pilot. The approval request must name:

- the expected HEAD captured with `git rev-parse HEAD` from a clean source checkout;
- the absolute path of a disposable, isolated source worktree at that expected HEAD;
- the absolute path of a separate sanitized scratch repository;
- every path-resolved operational command; and
- the rollback command `codex plugin remove project-memory@project-memory`.

No other agent may use the disposable source worktree. Immediately before the first state-changing command, confirm that `git status --short` is empty and `git rev-parse HEAD` still equals the approved expected HEAD. Any mismatch voids the approval.

## Preconditions

1. Designate an **existing isolated source worktree** at the expected HEAD before requesting approval. It may be a worktree created during separate local preparation, but it must already exist, be clean, and be unused by other agents.
2. Confirm that its pinned local dependencies are already present. Installing or changing dependencies is outside this pilot; if they are missing, stop.
3. In that existing worktree, run `node plugins/project-memory/scripts/verify-local-marketplace.mjs` from the repository root. It must report `"valid": true`, `"mode": "marketplace_read_only"`, `"codex_cli_invoked": false`, and `"codex_configuration_changed": "not_assessed"`; capture its `logical_manifest_sha256`.
4. Confirm both declared write scopes, `plugins/project-memory/.tmp/**` and `plugins/project-memory/dist/**`; confirm all bound inputs and output roots are symlink-free and repository-contained; record the delegated external inputs as `external_not_bound`.
5. Verify the current CLI syntax with all relevant read-only help commands:

```powershell
codex plugin --help
codex plugin add --help
codex plugin remove --help
codex plugin marketplace --help
```

During preparation these help commands were access-denied, so any unresolved or changed syntax is a stop condition.
6. Create a separate sanitized scratch repository containing only synthetic project files. It must contain no secrets, credentials, `.env` files, customer data, or links to a production repository.
7. Capture `codex plugin list` and the verified marketplace-list command as the complete before-state. If Project Memory is already installed, stop: this pilot no longer has a clean baseline.
8. Record whether the `project-memory` marketplace already exists, plus the pre-cachebuster SHA-256 of `.codex-plugin/plugin.json`. Marketplace cleanup is conditional on that before-state.

## Installation commands - pending approval, do not run

The next block is the exact plan-mandated specification record. It is documentation only and is **not executable as written**:

```powershell
python plugin-creator/scripts/update_plugin_cachebuster.py plugins/project-memory
codex plugin marketplace add "<repository-root>"
codex plugin add project-memory@project-memory
```

The first relative script does not exist under this repository root. Before requesting approval, resolve it from the current installed `plugin-creator` system-skill directory and replace every placeholder with the disposable worktree's absolute path. Record an operational block shaped like this in the approval request:

```powershell
python "<verified-absolute-cachebuster-script>" "<pilot-source-worktree>\plugins\project-memory"
codex plugin marketplace add "<pilot-source-worktree>"
codex plugin add project-memory@project-memory
```

After explicit approval:

1. Reconfirm that the approved existing isolated source worktree is clean, still at the approved expected HEAD, and still unused by other agents.
2. Run only the approved, path-resolved cachebuster command.
3. Require `git status --short` to show exactly one modified file: `plugins/project-memory/.codex-plugin/plugin.json`. Inspect the diff and require that only `version` changed, preserving its base version and adding one `+codex.<token>` suffix.
4. Rerun `node plugins/project-memory/scripts/verify-local-marketplace.mjs`; capture the post-cachebuster `logical_manifest_sha256` and the manifest's SHA-256.
5. Immediately before registration, confirm that the one-file diff and both post-cachebuster hashes are unchanged. Any additional or changed byte voids the approval.
6. Add the marketplace only if it was absent in the captured before-state. If it already existed, stop and reconcile the baseline rather than adding it again.
7. Run the approved Plugin-add command, then capture both plugin-list and marketplace-list after-states.

## Behavior check

1. Capture both plugin-list and marketplace-list immediately after installation and confirm that only the approved Project Memory entries changed.
2. In the Codex App, open a **New Codex App task/thread** against the sanitized scratch repository.
3. Give a normal project request without naming Project Memory. Verify **implicit invocation**: the agent discovers the Plugin and starts the appropriate project-memory flow automatically.
4. Verify that initialization asks for **one confirmation**, produces **no profile picker**, and explains the inferred product profile before writing project memory.
5. Complete one small synthetic task, close the task/thread, and open another new task/thread against the same scratch repository. Verify **deterministic resume** from accepted repository context without repeating finalized setup.
6. Do not enter real credentials, connect production services, or copy product data into the scratch repository.

## Evidence capture

Store only sanitized pilot evidence outside the scratch repository:

- approved expected HEAD plus the disposable-source and sanitized-scratch paths;
- confirmation that the scratch repository contains synthetic data only;
- verified CLI help output and the exact path-resolved operational commands;
- before-, after-, and final-state plugin-list and marketplace-list output;
- the pre-cachebuster manifest hash, exact cachebuster-only diff, post-cachebuster manifest hash, and `logical_manifest_sha256`;
- the validated `.tmp` and `dist` output boundaries plus the delegated `external_not_bound` input list;
- the prompts and sanitized responses proving implicit invocation, one confirmation, no profile picker, and deterministic resume;
- all rollback output.

The pilot passes only if all behavior checks succeed and rollback restores the exact before-state. Otherwise record the first failed check and roll back immediately.

## Rollback

1. Remove the pilot installation:

   ```powershell
   codex plugin remove project-memory@project-memory
   ```

2. Perform **conditional marketplace removal** only when the marketplace was absent before this pilot and was added by it. Confirm the exact current removal syntax with `codex plugin marketplace --help` first:

   ```powershell
   codex plugin marketplace remove project-memory
   ```

3. Capture final plugin-list and marketplace-list output and compare both with their before-states. If either differs, stop and report the remaining entry; do not delete unrelated configuration.

4. Confirm that the disposable worktree's manifest still has the recorded post-cachebuster hash. If it differs, stop and do not overwrite it.

5. Restore cachebuster state only inside the isolated worktree:

   ```powershell
   git -C "<pilot-source-worktree>" restore --source=HEAD --worktree -- plugins/project-memory/.codex-plugin/plugin.json
   ```

   Confirm that the restored manifest matches the recorded pre-cachebuster hash and that the disposable worktree is clean.

6. If the clean source worktree was created solely for this pilot, remove it only after the previous checks pass; otherwise retain the existing worktree:

   ```powershell
   git worktree remove "<pilot-source-worktree>"
   ```

7. Retain the sanitized scratch repository and evidence until Pitaji separately confirms cleanup; do not delete them automatically.

## Stop conditions

Stop without installing, or roll back immediately, if approval is missing, an operational path is unresolved, HEAD or worktree state differs, a bound input or output root is unsafe, a delegated external input is unresolved, the verifier fails, the cachebuster changes anything except the approved version field, a captured hash drifts, current CLI help disagrees with this runbook, the scratch repository is not sanitized, an unexpected confirmation or profile picker appears, or rollback cannot reproduce both captured before-states.
