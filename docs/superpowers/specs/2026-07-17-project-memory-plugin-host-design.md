# Project Memory Plugin Host Design

**Owner:** Pv Vimal Nair (Pitaji)
**Date:** 2026-07-17
**Status:** Approved for implementation planning
**Extends:** `2026-07-14-project-memory-agent-plugin-design.md`
**Approved by:** Pv Vimal Nair (Pitaji), 2026-07-17
**Corrected:** 2026-07-19 after the live Codex pilot proved confirmation crosses MCP processes

## 1. Decision

Project Memory remains one installable, offline Codex Plugin named `project-memory`. It does not become a standalone application, hosted service, background service that Pitaji manages, cloud database, or second product.

The Plugin will bundle a local stdio MCP server as its supported agent-to-engine execution boundary. MCP is an internal Plugin component, not a separate user-facing installation. The Project Memory skill invokes the bundled tools automatically. The existing CLI remains a fallback for CI, recovery, and tools that cannot use MCP.

The repository and Git history remain authoritative. Notion or a future cloud feature may mirror accepted information, but Project Memory must initialize, resume, coordinate, validate, and preserve history with no network connection.

## 2. Why the boundary must change

The approved real-install pilot proved that Plugin installation and implicit skill discovery work. It also proved two defects in the current skill-to-CLI route:

1. A Codex agent running in the default Windows workspace sandbox cannot let the bundled Node launcher spawn Git; startup fails closed with `COMMAND_RUNNER_FAILURE: spawn EPERM`.
2. A valid bootstrap envelope is approximately 3 MB because it returns the complete compilation plan and generated file bytes to the model.

Disabling the sandbox, requiring repeated manual command approvals, or sending the full plan through model context would degrade the agreed product. The durable correction is to use the Plugin's supported MCP capability and keep full plans inside the local Plugin process.

## 3. Non-negotiable user experience

1. Pitaji installs one Plugin once.
2. Pitaji opens a repository and works in normal language without naming Project Memory.
3. The skill invokes Project Memory before substantive work.
4. A new project receives one inferred structure proposal, no profile picker, and at most one grouped clarification.
5. No Project Memory files change before Pitaji confirms the bootstrap proposal.
6. After one confirmation, the Plugin validates the reviewed plan against the current Git head and applies it through the existing `IntegrationCoordinator`.
7. An initialized project resumes deterministically from repository context without repeating setup.
8. Routine factual work may be recorded through the existing governed workflow. Direction, removal, architecture, security, authentication, production, and external-action decisions retain their existing approval gates.
9. Concurrent agents retain claims, leases, expected-head checks, isolated work, and coordinator-only finalization.
10. Lower-reasoning agents receive compact directives and bounded task packets rather than internal plans or generated file bytes.
11. The complete workflow works offline.

## 4. Scope

### Included

- Add `.mcp.json` at the Plugin root and reference it from `.codex-plugin/plugin.json`.
- Add one bundled local stdio MCP server to the Plugin release artifact.
- Add a transport-neutral host facade over the existing engine and `IntegrationCoordinator`.
- Route every agent-facing Project Memory operation through the host facade rather than spawning the CLI.
- Keep complete reviewed plans in a bounded, expiring, user-local temporary proposal cache until apply so confirmation can cross MCP process boundaries.
- Return compact, schema-validated summaries, handles, hashes, expected heads, reading orders, and receipts to agents.
- Keep the CLI as a thin adapter over the same engine behavior.
- Update the skill and protocol references to prefer bundled MCP tools and use the CLI only as fallback.
- Repeat the real install pilot and the two fixed lower-reasoning trials.

### Excluded

- A hosted backend, remote MCP endpoint, cloud database, telemetry, login, account system, or mandatory network connection.
- A standalone desktop or web UI.
- A persistent daemon, listening port, Windows service, or process Pitaji must start and manage.
- Notion synchronization or any other mirror implementation.
- New profile, catalog, repository-memory, authority, claim, lease, history, or migration semantics.
- Disabling Codex sandbox protections or using a dangerous bypass mode.
- Replacing the existing engine, CLI, or `IntegrationCoordinator` with a second implementation.
- Publishing, choosing a license, creating a remote, or touching a live product repository.

## 5. Component architecture

```text
Natural-language request
        |
Project Memory skill
        |
Bundled local MCP server
        |
Transport-neutral host facade
        |
Existing deterministic engine
        |
Existing IntegrationCoordinator
        |
Repository canonical records and Git history
```

### 5.1 Plugin shell

The Plugin remains the only installed product. Its manifest points to the existing skill and the new `.mcp.json`. The MCP configuration starts one local stdio server from the installed Plugin bundle. It requires no project-local dependency installation and no network access.

### 5.2 Skill

The skill owns discovery and workflow instructions only. It does not implement selection, validation, authorization, plan storage, Git operations, or canonical writes. It calls the bundled Project Memory tools, follows returned directives, and presents the one required confirmation in plain language.

### 5.3 Host facade

The host facade is the only new application boundary. It calls existing TypeScript engine functions directly. It does not shell out to the Project Memory CLI and does not duplicate business rules.

It separates read-only operations from mutating operations so the MCP tools can expose accurate safety annotations. Only explicit, allowlisted Project Memory operations are accepted; the facade never accepts an arbitrary executable or shell string.

### 5.4 MCP server

The server implements only the MCP lifecycle required by Codex: initialize, ping, tool listing, and tool calls. It exposes a small agent-facing surface:

- `project_memory_start`: read-only startup, bootstrap proposal, or deterministic resume.
- `project_memory_read`: allowlisted doctor, plan, validate, inspect, and status operations.
- `project_memory_apply`: allowlisted coordinator-mediated mutations using an engine-issued proposal handle.

The exact operation names accepted by `project_memory_read` and `project_memory_apply` are derived from the existing protocol and classified explicitly as read-only or mutating. Benchmark, packaging, publication, and developer-only commands remain CLI-only.

### 5.5 CLI fallback

The CLI remains supported for automation, CI, diagnostics, recovery, and non-MCP agent tools. It and MCP call the same engine behavior. A fix made in the engine therefore applies to both interfaces.

## 6. Compact proposal contract

When an operation creates a plan, the host facade stores the exact plan object in a bounded, expiring, user-local temporary cache and returns only:

- proposal handle;
- operation and repository identity;
- inferred root and profile summary;
- selected blueprint, components, domains, and adapters when relevant;
- source mapping, assumptions, clarifications, and risks;
- expected Git head and plan hash;
- expiry time;
- whether confirmation is required.

The model never receives compilation file bytes. The proposal cache stays on the local machine outside the product repository and Git, is size-bounded and time-bounded, and contains no credentials. Cache directories and files use private operating-system permissions where supported. Handles are unguessable and bound to the repository, operation, exact plan hash, and expected head.

The cache is intentionally not a new database or canonical store. It preserves an exact reviewed plan across short-lived MCP processes, deletes it after successful apply, and removes expired entries during later cache access. A missing, expired, corrupt, or tampered entry must be regenerated and reviewed again. Accepted project truth always lives in the repository, not in the cache.

## 7. Apply and confirmation flow

1. A read-only tool builds the plan through the existing engine.
2. The facade caches the exact plan and returns its compact summary and handle.
3. The skill presents one complete proposal to Pitaji.
4. After explicit confirmation, the agent submits the handle and approval evidence to `project_memory_apply`.
5. The facade verifies handle validity, repository binding, role, approval shape, expiry, plan hash, and expected Git head.
6. The existing engine replans where required and compares the fresh result with the reviewed plan.
7. The existing `IntegrationCoordinator` performs the atomic mutation and validation.
8. The tool returns a compact receipt containing the resulting revision, changed paths, evidence IDs, gate results, and remaining risks.
9. Any mismatch or failure leaves canonical state unchanged.

Codex or workspace security policy may still require a host-level tool approval. Project Memory does not bypass host security controls. Its product-level bootstrap remains one grouped proposal confirmation.

## 8. Repository and concurrency behavior

No repository schema or authority rule changes.

- Accepted truth remains under the existing repository memory structure.
- Generated views remain derived and non-authoritative.
- Workers remain unable to accept direction or edit canonical history directly.
- Existing claims, allowed paths, integration leases, expected-head checks, isolated worktrees, gate execution, and coordinator receipts remain normative.
- Separate MCP processes may recover only the same exact unexpired proposal through its unguessable local handle. Canonical coordination still occurs through the existing repository and Git governance rules.
- A stale proposal, expired claim, changed head, conflicting lease, dirty root, or failed gate fails closed.

## 9. Security and privacy

- Local and network-free by default.
- No arbitrary shell or executable interface.
- Git commands continue to use argument arrays with `shell: false`.
- Each proposal is bound to one validated repository root.
- Read and mutation tools have accurate MCP annotations.
- Mutation tools cannot bypass the `IntegrationCoordinator`.
- Tool responses are size-bounded and redact sensitive output.
- Secrets, private transcripts, absolute local paths, and full project plans do not enter public evidence or lower-reasoning fixtures.
- Installation grants no deployment, publication, credential, production, or external-message authority.

## 10. Failure handling

- MCP unavailable: the skill reports the exact issue and may use the existing CLI only when the host can execute it safely.
- Git runner unavailable inside the MCP host: fail the install pilot; do not request sandbox bypass.
- Proposal cache miss, expiry, corruption, or tampering: regenerate and reconfirm; perform no write. An MCP process restart alone must not invalidate an unexpired proposal.
- Oversized compact response: fail validation; never fall back to the full plan.
- Head, plan, approval, role, or expiry mismatch: reject apply and replan.
- Server crash during apply: rely on the existing atomic coordinator and Git evidence; inspect the resulting revision before retrying.
- Plugin absent: repository routers and accepted memory remain readable, but canonical mutation remains blocked without a trusted coordinator.

## 11. Verification gates

The correction is complete only when all of the following pass:

1. Existing full typecheck, lint, tests, generated checks, Plugin validation, clean-package verification, and publication-blocker checks still pass.
2. MCP protocol tests cover initialize, tool discovery, read/write classification, invalid input, output bounds, and clean shutdown.
3. Host-facade tests prove direct engine composition and prove that no Project Memory CLI subprocess is spawned.
4. Bootstrap tests prove no project write before confirmation, exact plan preservation across separate MCP processes, fresh replan comparison, one coordinator call, and atomic failure behavior.
5. The bundled clean Plugin starts offline with no `node_modules` and includes only declared runtime files.
6. A real default-sandbox Codex pilot in a sanitized scratch repository proves implicit invocation, no profile picker, one confirmation, successful initialization, one small synthetic task, new-thread deterministic resume, and exact rollback.
7. Two independent lower-reasoning runs use the same fixed prompt and at least 30 identical supported briefs and meet every existing Task 9 threshold.
8. No live product repository, remote, publication surface, license, credential, or external service is changed.

## 12. Implementation boundary

Implementation should change only the Plugin transport and composition boundary, the related bundle/manifest/skill wiring, and focused verification evidence. Existing product-memory schemas, catalog content, repository layouts, authority rules, and lifecycle semantics remain unchanged unless a failing compatibility test proves a narrowly required correction.

This design supersedes the earlier assumption that the skill-to-CLI path is the primary Codex runtime. It does not supersede any other approved Project Memory architecture.
