# Project Memory Agent Protocol

## Roles

- Pitaji accepts product, root/profile, architecture, security, business, production, and consequential external direction.
- A worker edits only inside a valid claim and returns a validated completion packet. It cannot apply or finalize canonical mutations.
- An integrator is the human or agent that reviews plans, evidence, and completion packets, then submits eligible operations to the engine.
- The IntegrationCoordinator is the sole engine component allowed to commit canonical mutations. The integrator is not the coordinator and cannot bypass it.

If role assignment is absent, act as a worker. If a task packet was assigned but is missing or unreadable, stop and request integrator or coordinator repair; do not reconstruct it from memory.

## Implemented command map

Use the bundled MCP route first. For a path below, pass its command tokens and required flags to `project_memory_read` when the registered operation is read-only, or to `project_memory_apply` in command mode when an integrator is authorized to submit a coordinator-governed mutation. Read operations generally take `--input <file>`. Apply operations must recompute the plan and require the reviewed `--expected-plan-hash` and `--expected-head`; use only arguments returned by the engine or configured host runtime.

The bundled `scripts/project-memory.mjs` launcher is a fallback only when MCP is unavailable. Invoke the same path below with `node <plugin-root>/scripts/project-memory.mjs`, its required operation flags, and `--json`.
<!-- commands:start -->
- `agent start`
- `initiative create plan`
- `initiative create apply`
- `initiative transition plan`
- `initiative transition apply`
- `workstream create plan`
- `workstream create apply`
- `workstream transition plan`
- `workstream transition apply`
- `task create plan`
- `task create apply`
- `task transition plan`
- `task transition apply`
- `init apply`
- `claim issue plan`
- `claim issue apply`
- `claim renew plan`
- `claim renew apply`
- `claim validate`
- `completion validate`
- `integrate validate`
- `integrate finalize`
- `import plan`
- `import apply`
- `migrate plan`
- `migrate apply`
- `satellite prepare`
- `hub finalize`
<!-- commands:end -->

The integrator owns lifecycle and claim plan/apply commands. One exact UTC `created_at` belongs in each lifecycle input and the identical input is reused for plan and apply, so replay retains the reviewed hash. A worker may run only read/validate operations unless a more restrictive packet says otherwise. Do not invent command paths, flags, or input shapes. Missing engine-returned arguments or a `CLI_RUNTIME_REQUIRED`, `INIT_COORDINATOR_REQUIRED`, or equivalent result is blocking; it is not permission to edit canonical files directly.

## Missing Plugin or engine

If neither the MCP tool route nor the bundled launcher is available, remain worker-only and use accepted repository evidence as follows.

Read the repository doorway and router files in their declared order: `PROJECT_CONTEXT.md`, `docs/project-memory/PROTOCOL.md`, `docs/project-memory/profile.lock.yaml`, `docs/project-memory/views/NOW.md`, and `docs/project-memory/views/HANDOFF.md`. Then read only the assigned packet and its direct references. If any fixed file or assigned packet is missing or unreadable, stop and request repair.

Remain worker-only. Perform scoped product work only when repository evidence independently proves that the packet's claim is valid, unexpired, assigned to you, and covers the intended paths; any uncertainty is blocking. You may return a completion proposal. Do not issue or renew claims, accept decisions, regenerate views, alter locks, append history, import, migrate, or promote canonical state. Report that the Plugin or coordinator is required for finalization.

## Legacy import

The guided host path is the only trusted legacy-import route. Generic command-mode `import apply` remains untrusted and cannot acquire the handle-scoped authority below.

1. Invoke `project_memory_start`. When it returns `legacy_import_review_required`, retain its short-lived `review_handle` and read only the named `sources` paths.
2. Cover every returned source path and hash exactly once with evidence-bound fact drafts and one `import`, `archive`, `reject`, or `unresolved` disposition. Use only the fixed categories in the skill. Sensitive, ambiguous, conflicting, low-confidence, or ownerless material stays rejected or unresolved without copied facts.
3. Invoke `project_memory_read` in `legacy_import` mode with the review handle, actor, and complete source drafts. The host rereads the sources, validates anchors and hashes, materializes complete canonical records locally, and returns only a bounded grouped proposal plus one apply handle.
4. Present every group, assumption, conflict, sensitivity count, plan hash, expected head, and expiry. Pitaji confirms or declines the complete proposal once.
5. After explicit confirmation, invoke `project_memory_apply` in `legacy_import` mode with only the apply handle and Pitaji approval. The host replans, revalidates root/ref/head/profile/source bindings, and grants authority only to that one import plan hash.
6. The IntegrationCoordinator is the sole writer. A failed apply retains the unexpired handle and changes no canonical state; a successful apply consumes it.
7. Invoke startup again. Continue only after `resume`, then read the normal five-file prefix.

Never expose source bytes or plan writes through MCP. Never manually edit canonical records, immutable import reports, generated views, configuration, or original legacy sources.

## Migrations

1. Detect and report the current schema, catalog, and profile-lock versions.
2. Run `migrate plan`; review every transform, compatibility warning, target version, plan hash, and expected head.
3. Run `migrate apply` only after explicit review and only through the IntegrationCoordinator.
4. Re-run startup and verification. Never upgrade schemas, catalogs, locks, or generated artifacts silently.

## Multi-repository work

1. Give each satellite repository its own packet, claim, allowed paths, gates, and completion evidence.
2. Run `satellite prepare` only after that repository is cleanly validated. Preserve its immutable commit hash and prepared receipt.
3. Gather all required satellite receipts at the hub; reject missing, dirty, stale, or mismatched revisions.
4. Run `hub finalize` once through the hub's IntegrationCoordinator. The hub commit references exact satellite hashes; it does not rewrite satellite history.
5. If any repository fails, leave hub canonical state unchanged and return the exact failure.
