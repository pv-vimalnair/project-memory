# Project Memory Plugin Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Project Memory Plugin operate automatically and offline through a bundled local MCP host without changing its repository model, authority rules, or user-facing product.

**Architecture:** Add one transport-neutral host facade that calls the existing engine and `IntegrationCoordinator` directly. A dependency-free stdio MCP adapter exposes compact startup, allowlisted read operations, and coordinator-mediated applies; the CLI remains a fallback over the same engine.

**Tech Stack:** TypeScript 6, Node.js 24, Vitest, esbuild, JSON-RPC/MCP over stdio, Git, existing Project Memory engine and schemas.

## Global Constraints

- One installable `project-memory` Plugin; no standalone app, hosted backend, cloud database, persistent daemon, listening port, login, telemetry, or mandatory network connection.
- Repository and Git history remain authoritative; Notion and future cloud features are optional mirrors only.
- No profile picker. Bootstrap allows at most one grouped clarification and one complete proposal confirmation.
- No Project Memory file changes before bootstrap confirmation.
- Every canonical mutation remains coordinator-only and validates the reviewed plan hash plus current expected Git head.
- Existing profile, catalog, schema, repository-memory, authority, claim, lease, history, migration, and publication semantics remain unchanged.
- Do not disable Codex sandbox protections or use a dangerous bypass mode.
- No new runtime dependency and no project-local dependency installation.
- No live product repository, remote, publication surface, license, credential, or external service changes.

---

### Task 1: Add the compact in-process Plugin host

**Files:**
- Create: `plugins/project-memory/src/host/proposal-store.ts`
- Create: `plugins/project-memory/src/host/project-memory-host.ts`
- Create: `plugins/project-memory/src/host/index.ts`
- Modify: `plugins/project-memory/src/cli/node-composition.ts`
- Modify: `plugins/project-memory/src/index.ts`
- Test: `plugins/project-memory/tests/host/proposal-store.test.ts`
- Test: `plugins/project-memory/tests/host/project-memory-host.test.ts`

**Interfaces:**
- Consumes: `AgentStartInput`, `AgentStartDirective`, `InitPlan`, `InitApplyInput`, `CanonicalRecord`, `CliExecution`, `RuntimeResult`, `createNodeCommandRegistry`, and the existing node composition dependencies.
- Produces: `InMemoryProposalStore`, `ProjectMemoryHost`, `CompactAgentStartDirective`, `ProjectMemoryHostDependencies`, and `createNodeProjectMemoryHost(root: URL)`.

- [ ] **Step 1: Write the failing proposal-store tests**

```ts
it("binds an unguessable handle to one exact bootstrap plan", () => {
  const store = new InMemoryProposalStore({
    now: () => new Date("2026-07-17T12:00:00.000Z"),
    handle: () => "pm-proposal-00000000000000000000000000000001",
  });
  const issued = store.issue(ROOT, PLAN);
  expect(issued).toMatchObject({
    ok: true,
    value: {
      handle: "pm-proposal-00000000000000000000000000000001",
      plan_hash: PLAN.plan_hash,
      expected_head: PLAN.expected_head,
    },
  });
  expect(store.resolve(issued.ok ? issued.value.handle : "")).toMatchObject({
    ok: true,
    value: { root: ROOT, plan: PLAN },
  });
});

it("rejects expired, unknown, or already-consumed handles", () => {
  const issued = store.issue(ROOT, PLAN);
  if (!issued.ok) throw new Error("fixture failed");
  expect(store.consume(issued.value.handle).ok).toBe(true);
  expect(store.resolve(issued.value.handle)).toMatchObject({
    ok: false,
    issues: [{ code: "HOST_PROPOSAL_NOT_FOUND" }],
  });
});
```

- [ ] **Step 2: Run the focused tests and require the expected failure**

Run: `npm test -- tests/host/proposal-store.test.ts tests/host/project-memory-host.test.ts`

Expected: FAIL because `src/host/proposal-store.ts` and `src/host/project-memory-host.ts` do not exist.

- [ ] **Step 3: Implement the bounded proposal store**

```ts
export interface StoredBootstrapProposal {
  readonly root: URL;
  readonly plan: InitPlan;
}

export interface IssuedProposal {
  readonly handle: string;
  readonly plan_hash: string;
  readonly expected_head: string;
  readonly expires_at: string;
}

export class InMemoryProposalStore {
  readonly #proposals = new Map<string, StoredBootstrapProposal>();

  constructor(private readonly dependencies = {
    now: () => new Date(),
    handle: () => `pm-proposal-${randomBytes(16).toString("hex")}`,
  }) {}

  issue(root: URL, plan: InitPlan): RuntimeResult<IssuedProposal> {
    this.pruneExpired();
    if (this.#proposals.size >= 8) {
      return failure("HOST_PROPOSAL_CACHE_FULL", "proposal cache contains eight active plans");
    }
    const handle = this.dependencies.handle();
    this.#proposals.set(handle, { root: new URL(root.href), plan: structuredClone(plan) });
    return success({
      handle,
      plan_hash: plan.plan_hash,
      expected_head: plan.expected_head,
      expires_at: plan.replay.expires_at,
    });
  }
}
```

Complete `resolve`, `consume`, and `pruneExpired` with exact `HOST_PROPOSAL_NOT_FOUND`, `HOST_PROPOSAL_EXPIRED`, and `HOST_PROPOSAL_CACHE_FULL` failures. Never evict an unexpired proposal silently.

- [ ] **Step 4: Write the failing host tests**

```ts
it("returns a compact bootstrap summary without compilation bytes", async () => {
  const host = harness({ start: success(BOOTSTRAP_DIRECTIVE) });
  const result = await host.start({ root: ROOT, brief_path: "brief.md", adapter_id: "adapter.codex" });
  expect(result).toMatchObject({
    ok: true,
    value: {
      kind: "bootstrap_review_required",
      proposal_handle: expect.stringMatching(/^pm-proposal-/),
      summary: {
        plan_hash: PLAN.plan_hash,
        expected_head: PLAN.expected_head,
        selected_blueprint: "application.consumer-mobile",
      },
    },
  });
  expect(JSON.stringify(result)).not.toContain("profile_compilation");
  expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(65_536);
});

it("applies a cached bootstrap once through the injected coordinator path", async () => {
  const host = harness({ start: success(BOOTSTRAP_DIRECTIVE) });
  const started = await host.start(START_INPUT);
  if (!started.ok || started.value.kind !== "bootstrap_review_required") throw new Error("fixture failed");
  const applied = await host.applyBootstrap({
    proposal_handle: started.value.proposal_handle,
    approval: { confirmed: true, granted_by: "Pitaji" },
  });
  expect(applied).toMatchObject({ ok: true, value: { status: "initialized_verified" } });
  expect(host.dependencies.applyBootstrap).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 5: Implement `ProjectMemoryHost` and node composition**

`ProjectMemoryHost.start` must pass through `blocked` and `resume` directives unchanged except for compact envelope metadata. For `bootstrap_review_required`, cache `proposal.plan`, remove the full plan from the model-facing result, and return the selection/source/assumption/risk summary plus handle, plan hash, expected head, expiry, clarification, legacy import proposal, and `confirmation_required: true`.

`ProjectMemoryHost.applyBootstrap` must require `{ confirmed: true, granted_by: "Pitaji" }`, resolve the cached plan, construct the existing schema-valid canonical approval record from the plan's preallocated approval ID and `bootstrapApprovalBinding`, invoke the existing in-process `applyInitPlan`, and consume the handle only after success.

Refactor `createNodeCommandRegistry` into a shared composition result:

```ts
export interface NodeProjectMemoryServices {
  readonly registry: CommandRegistry;
  readonly start: AgentCommandDependencies["start"];
  readonly applyBootstrap: InitCommandDependencies["apply_plan"];
}

export function createNodeProjectMemoryServices(repo: URL): NodeProjectMemoryServices;
export function createNodeCommandRegistry(repo: URL): CommandRegistry {
  return createNodeProjectMemoryServices(repo).registry;
}
```

`createNodeProjectMemoryHost(root)` uses those services directly; it never starts `scripts/project-memory.mjs`, `dist/project-memory.mjs`, PowerShell, `cmd.exe`, or another Node process.

- [ ] **Step 6: Run focused and adjacent tests**

Run: `npm test -- tests/host tests/agent/start.test.ts tests/cli/agent-start.test.ts tests/e2e/plugin-new-project.test.ts`

Expected: PASS with no project write before confirmation and no existing CLI regression.

- [ ] **Step 7: Commit Task 1**

```powershell
git add -- plugins/project-memory/src/host plugins/project-memory/src/cli/node-composition.ts plugins/project-memory/src/index.ts plugins/project-memory/tests/host
git diff --cached --check
git commit -m "feat(plugin): add compact in-process host"
```

### Task 2: Add the dependency-free bundled MCP server

**Files:**
- Create: `plugins/project-memory/src/mcp/server.ts`
- Create: `plugins/project-memory/src/mcp/index.ts`
- Create: `plugins/project-memory/src/mcp.ts`
- Test: `plugins/project-memory/tests/mcp/server.test.ts`
- Test: `plugins/project-memory/tests/mcp/stdio.test.ts`

**Interfaces:**
- Consumes: `ProjectMemoryHost`, `createNodeProjectMemoryHost`, `executeCli`, `parseCliArguments`, and `CommandRegistry`.
- Produces: `ProjectMemoryMcpServer`, `routeMcpMessage`, `startProjectMemoryMcpServer`, and the stdio entrypoint `src/mcp.ts`.

- [ ] **Step 1: Write failing MCP routing tests**

```ts
it("advertises exactly the three Project Memory tools", async () => {
  const server = harness();
  expect(await server.request("tools/list", {})).toMatchObject({
    tools: [
      { name: "project_memory_start", annotations: { readOnlyHint: true } },
      { name: "project_memory_read", annotations: { readOnlyHint: true } },
      { name: "project_memory_apply", annotations: { readOnlyHint: false } },
    ],
  });
});

it("rejects a mutating command through project_memory_read", async () => {
  expect(await call("project_memory_read", {
    root: ROOT.href,
    arguments: ["init", "apply", "--plan", "plan.json", "--approval", "approval.json"],
  })).toMatchObject({ isError: true, structuredContent: { code: "MCP_OPERATION_CLASS_MISMATCH" } });
});
```

- [ ] **Step 2: Run the MCP tests and require the expected failure**

Run: `npm test -- tests/mcp/server.test.ts tests/mcp/stdio.test.ts`

Expected: FAIL because the MCP server modules do not exist.

- [ ] **Step 3: Implement JSON-RPC and tool routing**

Implement newline-delimited JSON-RPC 2.0 using only Node core modules. Handle `initialize`, `ping`, `tools/list`, `tools/call`, and notifications. Unknown methods return `-32601`; invalid tool arguments return `-32602`. Never write logs to stdout.

The initialization response is:

```ts
{
  protocolVersion: requestedVersion,
  capabilities: { tools: {} },
  serverInfo: { name: "Project Memory", version: PACKAGE_VERSION },
  instructions: "Use project_memory_start before substantive repository work. Project Memory is repository-first, offline, and coordinator-governed. Never ask the user to select a profile."
}
```

`project_memory_start` calls the compact host. `project_memory_read` parses the supplied argument array against the existing registry and rejects handlers whose `mutates` flag is true. `project_memory_apply` supports either `{ mode: "bootstrap", proposal_handle, approval }` or `{ mode: "command", root, arguments }`; command mode rejects handlers whose `mutates` flag is false. Both command modes call `executeCli` in-process and return its envelope, never its rendered stdout.

Every tool response includes matching `content` and `structuredContent`. Enforce a 64 KiB serialized tool-response limit. Oversized output returns `MCP_RESPONSE_TOO_LARGE`; it never falls back to returning full bytes.

- [ ] **Step 4: Implement and test the stdio entrypoint**

`src/mcp.ts` registers schemas once, starts `createInterface({ input: process.stdin, crlfDelay: Infinity })`, routes one request per line, and emits one JSON line per response. It sets `process.exitCode = 1` only for startup failure; individual tool failures remain MCP results.

The stdio test spawns the compiled development entry, sends `initialize`, `tools/list`, and `ping`, verifies three valid JSON responses, closes stdin, and requires clean exit. It supplies a denied proxy and `PROJECT_MEMORY_NETWORK=disabled`.

- [ ] **Step 5: Run focused MCP and host tests**

Run: `npm test -- tests/mcp tests/host`

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- plugins/project-memory/src/mcp.ts plugins/project-memory/src/mcp plugins/project-memory/tests/mcp
git diff --cached --check
git commit -m "feat(plugin): expose local MCP tools"
```

### Task 3: Wire MCP into the single Plugin package

**Files:**
- Create: `plugins/project-memory/.mcp.json`
- Modify: `plugins/project-memory/.codex-plugin/plugin.json`
- Modify: `plugins/project-memory/scripts/build-plugin-bundle.mjs`
- Modify: `plugins/project-memory/scripts/verify-plugin-contents.mjs`
- Modify: `plugins/project-memory/skills/project-memory/SKILL.md`
- Modify: `plugins/project-memory/skills/project-memory/references/agent-protocol.md`
- Modify: `plugins/project-memory/tests/plugin/skill-contract.test.ts`
- Modify: `plugins/project-memory/tests/release/plugin-bundle.test.ts`
- Test: `plugins/project-memory/tests/release/mcp-plugin-contents.test.ts`

**Interfaces:**
- Consumes: `src/cli.ts`, `src/mcp.ts`, the three MCP tool names, and existing clean-Plugin verification.
- Produces: `dist/project-memory.mjs`, `dist/project-memory-mcp.mjs`, both SHA-256 files, `.mcp.json`, and an installed Plugin whose skill uses MCP first.

- [ ] **Step 1: Write failing packaging and skill-contract tests**

Require the manifest to contain `"mcpServers": "./.mcp.json"`; require `.mcp.json` to contain one stdio server with `command: "node"`, `args: ["./dist/project-memory-mcp.mjs"]`, `cwd: "."`, and no URL or environment secrets. Require the skill to name `project_memory_start`, prefer MCP, and reserve `scripts/project-memory.mjs` for fallback only.

- [ ] **Step 2: Run the focused release tests and require failure**

Run: `npm test -- tests/plugin/skill-contract.test.ts tests/release/plugin-bundle.test.ts tests/release/mcp-plugin-contents.test.ts`

Expected: FAIL because the Plugin manifest and clean package do not yet contain MCP.

- [ ] **Step 3: Add the Plugin MCP declaration**

```json
{
  "mcpServers": {
    "project-memory": {
      "command": "node",
      "args": ["./dist/project-memory-mcp.mjs"],
      "cwd": ".",
      "tool_timeout_sec": 900
    }
  }
}
```

Add `"mcpServers": "./.mcp.json"` to `plugin.json`. Do not add an app, connector, hook, hosted URL, authentication, or network capability.

- [ ] **Step 4: Build deterministic CLI and MCP bundles**

Refactor `build-plugin-bundle.mjs` so the default invocation builds both entrypoints with the same esbuild settings and writes one SHA-256 file beside each bundle. Preserve `--output <path>` as the existing single CLI-bundle test path. Sort the default JSON report by output path.

Update the clean-package allowlist, required files, copy list, network-import check, logical manifest, and smoke verification for `.mcp.json`, `dist/project-memory-mcp.mjs`, and its hash. The MCP clean-copy smoke test must complete initialize/list/ping over stdio with `node_modules` absent and the network-denied environment active.

- [ ] **Step 5: Update the skill without adding business rules**

The startup instruction becomes: invoke `project_memory_start` with the active repository and optional repository-relative brief. Follow its compact directive. On confirmation call `project_memory_apply` in bootstrap mode with the engine-issued handle and explicit approval. Use `project_memory_read` and `project_memory_apply` for the existing protocol command paths. Use the launcher only when bundled MCP is unavailable, and remain worker-only if neither trusted route exists.

- [ ] **Step 6: Run official and clean-package checks**

Run:

```powershell
npm test -- tests/plugin/skill-contract.test.ts tests/release/plugin-bundle.test.ts tests/release/mcp-plugin-contents.test.ts
npm run bundle:plugin
npm run plugin:verify
npm run package:verify
```

Expected: all commands PASS; the clean Plugin contains no `node_modules`, no network import, and both deterministic bundle hashes.

- [ ] **Step 7: Commit Task 3**

```powershell
git add -- plugins/project-memory/.mcp.json plugins/project-memory/.codex-plugin/plugin.json plugins/project-memory/scripts plugins/project-memory/skills plugins/project-memory/tests/plugin plugins/project-memory/tests/release
git diff --cached --check
git commit -m "feat(plugin): bundle offline MCP host"
```

### Task 4: Prove the corrected automatic workflow

**Files:**
- Create: `plugins/project-memory/tests/e2e/plugin-mcp-new-project.test.ts`
- Create: `plugins/project-memory/tests/e2e/plugin-mcp-resume-project.test.ts`
- Modify: `plugins/project-memory/tests/e2e/plugin-workflow-harness.ts`
- Modify: `docs/pilots/CODEX_PLUGIN_INSTALL_PILOT.md`

**Interfaces:**
- Consumes: the clean installed Plugin, MCP stdio protocol, compact proposal handle, canonical approval serializer, and existing scratch workflow fixtures.
- Produces: repeatable offline MCP bootstrap/resume evidence before the real Codex install pilot.

- [ ] **Step 1: Write failing clean-Plugin MCP workflow tests**

The new-project test must start the clean MCP bundle with no `node_modules`, issue a normal startup call, verify a compact proposal no larger than 64 KiB and no `profile_compilation`, verify the project snapshot is unchanged, submit one explicit confirmation, require `initialized_verified`, and then require deterministic resume in the fixed reading order.

The resume test must start a separate MCP process against the initialized repository and prove that accepted repository context—not process memory or prior chat—is sufficient.

- [ ] **Step 2: Run the tests and require the expected failure**

Run: `npm test -- tests/e2e/plugin-mcp-new-project.test.ts tests/e2e/plugin-mcp-resume-project.test.ts`

Expected: FAIL until the clean Plugin MCP path is fully wired.

- [ ] **Step 3: Fix composition only**

Correct only host/MCP/bundle/skill integration defects exposed by these tests. Do not modify catalog selection, repository schemas, lifecycle rules, authority classes, or generated document layouts.

- [ ] **Step 4: Run the complete local verification matrix**

Run:

```powershell
npm run typecheck
npm run lint
npm run test:ci
npm run generated:verify
npm run plugin:verify
npm run package:verify
npm run publication:check
```

Expected: all technical commands PASS. `publication:check` remains intentionally non-zero only for the already documented license, repository identity, publication authority, and lower-reasoning evidence blockers; no new technical blocker is allowed.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- plugins/project-memory/tests/e2e docs/pilots/CODEX_PLUGIN_INSTALL_PILOT.md
git diff --cached --check
git commit -m "test(plugin): prove offline MCP workflows"
```

### Task 5: Repeat the approved real installation pilot and acceptance trials

**Files:**
- Create: `plugins/project-memory/benchmarks/lower-reasoning-trials/run-01.redacted.json`
- Create: `plugins/project-memory/benchmarks/lower-reasoning-trials/run-02.redacted.json`
- Create: `docs/publication/LOWER_REASONING_TRIAL_EVIDENCE.json`
- Modify: `docs/pilots/CODEX_PLUGIN_INSTALL_PILOT.md` only if the real current CLI surface requires a factual correction.

**Interfaces:**
- Consumes: the fixed prompt, fixed 30-brief set, rubric, clean Plugin hash, real Codex plugin commands, sanitized scratch repositories, and Task 9 report builder.
- Produces: qualifying real-pilot evidence, two independently reviewed lower-reasoning trial records, the exact recomputed report, and exact rollback evidence.

- [ ] **Step 1: Prepare a fresh reversible pilot approval record**

Capture the new clean HEAD, isolated source worktree, sanitized scratch paths, resolved cachebuster script, exact install commands, current plugin/marketplace before-state, source manifest hash, clean logical manifest hash, and exact rollback commands. Do not reuse the prior approval because the source HEAD changed.

- [ ] **Step 2: Install only into the approved local Codex pilot scope**

Run the approved cachebuster, local marketplace add, and Plugin add commands. Confirm the installed Plugin and MCP bundle hashes match the source and that only the Project Memory plugin/marketplace entries changed.

- [ ] **Step 3: Run the real default-sandbox behavior check**

In a new Codex thread against the sanitized scratch repository, give a normal request without naming Project Memory. Require implicit invocation, compact proposal, no profile picker, one confirmation, successful bootstrap, one small synthetic task, a second new thread, deterministic resume, no credentials, and no live service connection.

- [ ] **Step 4: Run two fixed lower-reasoning trials**

Use two clean, byte-identical scratch repositories, `gpt-5.6-terra` with low reasoning, the same fixed prompt, the same 30 supported briefs, the same clean Plugin hash, and no shared conversation context. Preserve only sanitized outputs plus raw hashes.

- [ ] **Step 5: Independently review and recompute evidence**

Record every per-brief observation, workflow check, model/tool ID, timestamp, reviewer, prompt hash, clean Plugin hash, rubric hash, raw-output hash, and distinct repository-relative redacted evidence path. Build `LOWER_REASONING_TRIAL_EVIDENCE.json` from the immutable trials and require the report to meet all existing Task 9 thresholds.

- [ ] **Step 6: Roll back exactly**

Remove the temporary Plugin and marketplace when they were absent before, compare final lists byte-for-byte or canonically with their captured before-state, restore only the cachebuster manifest change, and require the source and all scratch repositories to be clean. Retain sanitized evidence; remove raw generated outputs after recording their hashes.

- [ ] **Step 7: Run final gates and commit qualifying evidence**

Run:

```powershell
npm test -- tests/benchmark/plugin-agent-report.test.ts tests/release/publication-readiness.test.ts
npm run publication:check
git diff --check
```

Expected: lower-reasoning and real-pilot technical gates PASS. Publication remains blocked only by Pitaji's separately undecided license, public repository metadata, and publication authority.

```powershell
git add -- plugins/project-memory/benchmarks/lower-reasoning-trials docs/publication/LOWER_REASONING_TRIAL_EVIDENCE.json docs/pilots/CODEX_PLUGIN_INSTALL_PILOT.md
git diff --cached --check
git commit -m "test(plugin): record final acceptance evidence"
```
