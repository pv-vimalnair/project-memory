---
name: project-memory
description: Use when substantive repository work starts or resumes, including requests to follow installed repository-continuity instructions; automatically establish accepted Project Memory context before planning, claiming, handing off, integrating, importing, migrating, or validating.
---

# Project Memory

Use this workflow automatically. Never ask Pitaji to choose a profile, folder set, pattern, or record destination.
When repository-continuity instructions are requested, invoke the Project Memory startup tool; never paraphrase or simulate its proposal.

## Locate the engine

Use the bundled MCP tools first. The trusted MCP surface is `project_memory_start`, `project_memory_read`, and `project_memory_apply`.

This skill directory is `<plugin-root>/skills/project-memory`; `<plugin-root>` is the parent of its parent. Use `scripts/project-memory.mjs` only when the bundled MCP server is unavailable. Its fallback form is:

`node <plugin-root>/scripts/project-memory.mjs <command> --json`

Any response from a registered MCP tool means the MCP server is available. Do not invoke the launcher fallback after an MCP response, including a bounded or runtime error; report the exact MCP issue instead.

Never create `tools/project-memory/config.json` manually. Its absence before initialization is expected; the approved bootstrap materializes it.

Do not search for or install dependencies. If neither the bundled MCP route nor the launcher and bundle are available, follow `references/agent-protocol.md` and remain worker-only.

## Start every substantive task

1. Locate the repository root.
2. Invoke `project_memory_start` with the repository root only first.
3. For an uninitialized repository, let the engine infer one complete proposal from a pre-existing conventional brief or repository evidence. Do not create a YAML brief or ask Pitaji to prepare one.
4. Pass `brief_path` only when Pitaji explicitly identifies a pre-existing repository initialization brief.
5. Never pass a task dataset, prompt, schema, output file, or other work artifact as `brief_path` merely because the user asked to read or process it later.
6. Include an adapter only when it is not Codex.
7. Follow the compact directive returned by the tool. Startup is read-only.

For `bootstrap_review_required`:

1. Present the complete compact bootstrap proposal from `summary`: selected root, blueprint, overlays, components, domains, adapters, source mapping, assumptions, risks, plan hash, and expected Git head.
2. Ask one grouped clarification only when `clarification` requires it.
3. Request one confirmation of the complete bootstrap proposal. Never split approval across profile or folder choices, and never infer approval from silence.
4. After explicit confirmation, invoke `project_memory_apply` in bootstrap mode with the engine-issued `proposal_handle` and `approval: { confirmed: true, granted_by: "Pitaji" }`. The MCP host retains and applies the exact plan through the IntegrationCoordinator; never reconstruct, expose, or write the plan yourself.
5. Re-invoke `project_memory_start`. Continue only when it returns `resume`.

For `resume`, read these fixed files in this exact order, followed only by the returned assigned task packets and their direct references:

1. `PROJECT_CONTEXT.md`
2. `docs/project-memory/PROTOCOL.md`
3. `docs/project-memory/profile.lock.yaml`
4. `docs/project-memory/views/NOW.md`
5. `docs/project-memory/views/HANDOFF.md`

The returned `reading_order` must retain that prefix. If any fixed file or assigned packet is missing or unreadable, stop and ask the integrator to repair the repository or assignment. Do not invent a replacement. Follow the locked root profile; a task such as a campaign, audit, redesign, security check, or refactor does not reclassify the product.

For `blocked`, report the exact issues and make no Project Memory mutation.

## Plan and claim work

Use `project_memory_read` for read, plan, and validate command paths. Use `project_memory_apply` in command mode only for integrator-owned, coordinator-governed apply or finalize paths.

1. Translate the requested outcome into engine-planned initiatives, workstreams, and task packets. The integrator uses the lifecycle commands listed in the protocol, always running `plan` before coordinator-mediated `apply`. A worker may propose structure in its packet but does not create or transition canonical work records.
2. Before a worker edits, the integrator runs `claim issue plan`, reviews the plan hash and expected head, and submits `claim issue apply` through the IntegrationCoordinator.
3. The worker runs `claim validate` against the assigned packet and claim. Work only inside allowed paths and lease time.
4. Treat another task's records, canonical events, locks, generated views, and append-only history as no-touch paths.

Workers never run apply or finalize. Workers may propose decisions but never accept them.

## Complete and integrate

1. The worker produces a completion packet containing task and claim IDs, base and resulting revisions, changed paths, commands, gate results, evidence, risks, omissions, and every check not run with its reason.
2. Run `completion validate`, then return the packet to the integrator. A worker does not update canonical truth.
3. The integrator supplies the packet and current repository evidence to `integrate validate`.
4. Only after validation succeeds, the integrator may invoke `integrate finalize`; that command delegates the mutation to the IntegrationCoordinator. Finalization is coordinator-only.
5. Report the coordinator receipt or exact failure. A failed finalization leaves canonical state unchanged.

Never write canonical records, locks, generated views, or history directly.

## Safety invariants

- Recompute every mutation immediately before apply; require the reviewed plan hash and current expected Git head.
- Never replay stale plans, bypass claim validation, or broaden allowed paths silently.
- Never expose secrets, credentials, private transcripts, or absolute local paths in public artifacts.
- Never publish, deploy, message externally, or change a live product without explicit authority.

Read `references/agent-protocol.md` for exact command paths and for role boundaries, missing-engine fallback, legacy import, migration, or multi-repository finalization.
