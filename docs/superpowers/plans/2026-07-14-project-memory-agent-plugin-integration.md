# Project Memory Agent Plugin Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the validated Codex Plugin shell and completed Project Memory engine into an implicitly invokable, zero-runtime-install agent experience with deterministic startup, safe cross-tool fallback, reproducible packaging, and GitHub publication readiness.

**Architecture:** The skill calls one read-only `agent start` composition API before substantive work. That API returns a complete bootstrap, resume, or blocked directive so weaker agents do not invent startup behavior. A shell-free Node launcher invokes one self-contained bundled engine. Repository routers preserve tool-neutral recovery when the Plugin is missing, while canonical mutation still flows only through the integration coordinator.

**Tech Stack:** Node.js 24, strict TypeScript/ESM, existing Project Memory subsystems, esbuild 0.28.1, Codex Plugin and Skill validators, Vitest, Git, PowerShell, and GitHub Actions.

## Global Constraints

- Approved designs: `docs/superpowers/specs/2026-07-14-project-memory-system-design.md` and `docs/superpowers/specs/2026-07-14-project-memory-agent-plugin-design.md`.
- Execute after the Foundation through CLI completion gates unless a task explicitly augments an earlier contract.
- Repository root is the parent of `plugins/project-memory/`; all `src/`, `tests/`, `scripts/`, `catalog/`, `schemas/`, and `templates/` paths below are relative to `plugins/project-memory/`.
- The Plugin is primary. The CLI is internal machinery and a cross-tool fallback.
- `agent start` is read-only. It never applies bootstrap, creates a claim, changes a task, or finalizes work.
- The skill never asks the user to select a profile, folder, work pattern, or record destination.
- Initial root/profile/source truth still requires one Pitaji confirmation of the engine-selected proposal.
- Release runtime must work from Plugin files without `npm install`, `npx`, network access, or a global Project Memory package.
- Use esbuild only at development/build time. Pin `0.28.1`; license MIT; Node engine `>=18`; optional platform packages remain at `0.28.1`.
- Do not add an MCP server, hook, app, hosted service, telemetry, or runtime updater in v1.
- Do not install into active Codex configuration, publish, push, create a release, or modify a live product without the named approval gate.

---

## Task 1: Add the Read-Only Agent Startup Contract

**Files:**

- Create: `src/agent/contracts.ts`
- Create: `src/agent/start.ts`
- Create: `src/agent/index.ts`
- Create: `tests/agent/start.test.ts`

**Interfaces:**

- Consumes: doctor diagnostics, initialization planner, profile verifier, current-view verifier, and repository-relative path contracts.
- Produces: `startAgentSession(input, dependencies): Promise<RuntimeResult<AgentStartDirective>>`.

- [ ] **Step 1: Write failing startup tests.** Cover an empty repository, supported uninitialized repository, grouped clarification, initialized root, stale lock, stale views, missing assigned packet, and injected dependency rejection. Assert no write, commit, claim, lease, or finalization call occurs.

```ts
it("returns an engine-selected bootstrap proposal without a profile menu", async () => {
  const result = await startAgentSession(
    { root: rootUrl, brief_path: "brief.md", adapter_id: "adapter.codex" },
    bootstrapDependencies,
  );
  expect(result.ok).toBe(true);
  if (!result.ok || result.value.kind !== "bootstrap_review_required") return;
  expect(result.value.proposal.selection.blueprint_id).toBe("software.mobile-app");
  expect(result.value.proposal.confirmation_required).toBe(true);
  expect(result.value.proposal).not.toHaveProperty("profile_choices");
  expect(bootstrapDependencies.writes).toHaveLength(0);
});
```

- [ ] **Step 2: Run `npm test -- tests/agent/start.test.ts`.** Expected: fail because the contract and service do not exist.

- [ ] **Step 3: Define the immutable startup contract.**

```ts
export interface AgentStartInput {
  root: URL;
  brief_path: string | null;
  adapter_id: string;
}

export type AgentStartDirective =
  | {
      kind: "bootstrap_review_required";
      proposal: InitPlan;
      clarification: GroupedClarification | null;
      apply_command: readonly string[];
    }
  | {
      kind: "resume";
      root_id: string;
      profile_lock_hash: string;
      reading_order: readonly string[];
      assigned_task_packets: readonly string[];
      warnings: readonly RuntimeIssue[];
    }
  | { kind: "blocked"; issues: readonly RuntimeIssue[] };

export interface AgentStartDependencies {
  doctor(input: DoctorInput): Promise<RuntimeResult<DoctorReport>>;
  planInitialization(input: InitPlanInput): Promise<RuntimeResult<InitPlan>>;
  verifyProfile(root: URL): Promise<RuntimeResult<ProfileVerificationReport>>;
  verifyViews(root: URL): Promise<RuntimeResult<ViewFreshnessReport>>;
  findAssignedTaskPackets(root: URL): Promise<RuntimeResult<readonly string[]>>;
}
```

`apply_command` is a literal argument array beginning with `init`, `apply`; it contains expected plan hash/head inputs and never a shell string or lease ID.

- [ ] **Step 4: Implement deterministic branching.** Run doctor first. Missing Project Memory calls the read-only initialization planner. A valid root verifies profile and views, then returns this fixed prefix in `reading_order`: `PROJECT_CONTEXT.md`, `docs/project-memory/PROTOCOL.md`, `docs/project-memory/profile.lock.yaml`, `docs/project-memory/views/NOW.md`, and `docs/project-memory/views/HANDOFF.md`. Catch every injected-port rejection and return stable issues.

- [ ] **Step 5: Run and commit.**

```powershell
npm test -- tests/agent/start.test.ts
npm run typecheck
git add src/agent tests/agent/start.test.ts
git commit -m "feat(agent): add deterministic project startup directive"
```

## Task 2: Expose `project-memory agent start`

**Files:**

- Create: `src/cli/commands/agent.ts`
- Modify: `src/cli/parser.ts`
- Modify: `src/cli/composition-root.ts`
- Modify: `src/index.ts`
- Create: `tests/cli/agent-start.test.ts`

**Interfaces:**

- Consumes: `startAgentSession` and the CLI result/exit-code envelope.
- Produces: `project-memory agent start --root <path> [--brief <path>] [--adapter <id>] --json`.

- [ ] **Step 1: Write failing parser and purity tests.**

```ts
it("emits exactly one JSON startup directive", async () => {
  const result = await runCli([
    "agent", "start", "--root", fixtureRoot, "--brief", "brief.md", "--json",
  ]);
  expect(result.exit_code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ kind: "bootstrap_review_required" });
  expect(result.stderr).toBe("");
});

it.each(["--apply", "--lease-id", "--profile", "--pattern"])(
  "rejects mutation or manual-selection flag %s",
  async (flag) => expect((await runCli(["agent", "start", flag])).exit_code).toBe(2),
);
```

- [ ] **Step 2: Run `npm test -- tests/cli/agent-start.test.ts`.** Expected: unknown `agent` command.

- [ ] **Step 3: Wire the thin handler.** Resolve `--root`, pass the optional brief and default `adapter.codex`, call `startAgentSession` exactly once, and render human output or one JSON object. Add no apply branch or duplicated doctor/selector logic.

- [ ] **Step 4: Add the command to help, the stable CLI contract, and root exports.**

- [ ] **Step 5: Run and commit.**

```powershell
npm test -- tests/cli/agent-start.test.ts
npm run typecheck
git add src/cli/commands/agent.ts src/cli/parser.ts src/cli/composition-root.ts src/index.ts tests/cli/agent-start.test.ts
git commit -m "feat(cli): expose agent-first startup orchestration"
```

## Task 3: Add the Shell-Free Plugin Launcher

**Files:**

- Create: `scripts/project-memory.mjs`
- Create: `tests/plugin/launcher.test.ts`
- Create: `tests/fixtures/plugin/fake-cli.mjs`

**Interfaces:**

- Consumes: `dist/project-memory.mjs` in release mode or `dist/cli.js` in development mode.
- Produces: the stable Plugin-local invocation used by `SKILL.md`.

- [ ] **Step 1: Write failing tests.** Cover release-entry preference, development fallback, missing entry, literal metacharacters, inherited repository cwd, and exit-code propagation.

```ts
it("passes metacharacters as literal arguments", async () => {
  const result = await runLauncher(["agent", "start", "a;b", "$HOME", "x&y"]);
  expect(JSON.parse(result.stdout)).toEqual({
    cwd: fixtureRepository,
    args: ["agent", "start", "a;b", "$HOME", "x&y"],
  });
});
```

- [ ] **Step 2: Run `npm test -- tests/plugin/launcher.test.ts`.** Expected: launcher absent.

- [ ] **Step 3: Implement the launcher.**

```js
#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const releaseEntry = fileURLToPath(new URL("../dist/project-memory.mjs", import.meta.url));
const developmentEntry = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const entry = existsSync(releaseEntry)
  ? releaseEntry
  : existsSync(developmentEntry)
    ? developmentEntry
    : null;

if (entry === null) {
  process.stderr.write("Project Memory engine bundle is missing. Reinstall the Plugin.\n");
  process.exitCode = 1;
} else {
  const child = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  process.exitCode = child.error === undefined ? (child.status ?? 1) : 1;
}
```

- [ ] **Step 4: Run and commit.**

```powershell
npm test -- tests/plugin/launcher.test.ts
git add scripts/project-memory.mjs tests/plugin/launcher.test.ts tests/fixtures/plugin/fake-cli.mjs
git commit -m "feat(plugin): add safe bundled-engine launcher"
```

## Task 4: Produce a Self-Contained Release Bundle

**Files:**

- Create: `scripts/build-plugin-bundle.mjs`
- Create: `tests/release/plugin-bundle.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: `src/cli.ts` and reviewed development dependency `esbuild@0.28.1`.
- Produces: `dist/project-memory.mjs` and `dist/project-memory.mjs.sha256`.

- [ ] **Step 1: Write the failing clean-runtime test.** Build into a temporary Plugin copy without `node_modules`, run the launcher with `--version` and `agent start`, and compare two independent bundle hashes.

- [ ] **Step 2: Run `npm test -- tests/release/plugin-bundle.test.ts`.** Expected: missing bundle builder/script.

- [ ] **Step 3: After the exact dependency approval, add `esbuild: "0.28.1"` to `devDependencies` and `"bundle:plugin": "node scripts/build-plugin-bundle.mjs"` to scripts.

- [ ] **Step 4: Implement deterministic bundling.**

```js
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/project-memory.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: false,
  legalComments: "none",
  charset: "utf8",
  logLevel: "warning",
});

const bytes = await readFile("dist/project-memory.mjs");
const digest = createHash("sha256").update(bytes).digest("hex");
await writeFile("dist/project-memory.mjs.sha256", `${digest}\n`, "utf8");
```

- [ ] **Step 5: Run twice, compare hashes, test, and commit source/config only.**

```powershell
npm run bundle:plugin
$first=(Get-FileHash dist/project-memory.mjs -Algorithm SHA256).Hash
npm run bundle:plugin
$second=(Get-FileHash dist/project-memory.mjs -Algorithm SHA256).Hash
if($first -ne $second){ throw "Plugin bundle is nondeterministic" }
npm test -- tests/release/plugin-bundle.test.ts
git add package.json package-lock.json scripts/build-plugin-bundle.mjs tests/release/plugin-bundle.test.ts
git commit -m "build(plugin): create zero-install engine bundle"
```

Generated `dist/` bytes are committed only by the final release-artifact task.

## Task 5: Bind the Skill to Implemented Commands

**Files:**

- Modify: `skills/project-memory/SKILL.md`
- Modify: `skills/project-memory/references/agent-protocol.md`
- Create: `tests/plugin/skill-contract.test.ts`

**Interfaces:**

- Consumes: the implemented CLI registry and launcher.
- Produces: a concise skill whose commands and directive handling are executable and tested.

- [ ] **Step 1: Write failing static contract tests.** Parse command references and assert each operation exists. Require `agent start`, one bootstrap confirmation, exact reading order, claims, completion packets, coordinator-only finalization, and no manual profile menu or direct canonical writes.

- [ ] **Step 2: Run `npm test -- tests/plugin/skill-contract.test.ts`.** Expected: fail on any stale or unregistered reference.

- [ ] **Step 3: Reconcile the skill only against implemented interfaces.** Keep `SKILL.md` below 500 lines. Move detailed import, migration, and multi-repository behavior into the one-level reference. Do not copy catalog definitions, schema fields, or project truth into the skill.

- [ ] **Step 4: Validate and commit.**

```powershell
npm test -- tests/plugin/skill-contract.test.ts
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" "skills\project-memory"
python "$env:USERPROFILE\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" "."
git add skills/project-memory tests/plugin/skill-contract.test.ts
git commit -m "test(plugin): bind agent workflow to real commands"
```

## Task 6: Generate Tool-Neutral Router Fallbacks

**Files:**

- Modify: `templates/project-memory/AGENTS.md`
- Modify: `templates/project-memory/CLAUDE.md`
- Create: `tests/profile/agent-router-contract.test.ts`

**Interfaces:**

- Consumes: the fixed startup doorway and coordinator authority model.
- Produces: concise generated routers for adapted and unadapted agents.

- [ ] **Step 1: Write failing router tests.** Assert both routers point to `PROJECT_CONTEXT.md`, `PROTOCOL.md`, and the locked profile; contain no project facts; distinguish Plugin-available and Plugin-missing behavior; require completion packets; and forbid workers from promoting canonical state.

- [ ] **Step 2: Run `npm test -- tests/profile/agent-router-contract.test.ts`.** Expected: current templates lack the Plugin fallback contract.

- [ ] **Step 3: Implement exact fallback behavior.** The Codex router uses the installed Plugin when available. Without it, the agent reads the startup doorway and operates as a worker only. The Claude router follows the same repository protocol and may call the bundled CLI when configured; it never claims a native Claude Plugin exists.

- [ ] **Step 4: Compile golden roots and commit.**

```powershell
npm test -- tests/profile/agent-router-contract.test.ts tests/profile/golden-repositories.test.ts
npm run typecheck
git add templates/project-memory tests/profile/agent-router-contract.test.ts
git commit -m "feat(profile): add tool-neutral agent router fallbacks"
```

## Task 7: Verify Clean Installable Plugin Contents

**Files:**

- Create: `scripts/verify-plugin-contents.mjs`
- Create: `tests/release/plugin-contents.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: Plugin manifest, skill, launcher, bundle, catalog, schemas, and templates.
- Produces: a canonical logical Plugin manifest and clean-copy execution report.

- [ ] **Step 1: Write the failing contents test.** Require all runtime artifacts. Reject `node_modules`, coverage, source fixtures, raw model output, secrets, absolute paths, `.env*`, credentials, logs, and nested Git data.

- [ ] **Step 2: Run `npm test -- tests/release/plugin-contents.test.ts`.** Expected: verifier absent.

- [ ] **Step 3: Implement the verifier.** Copy only the declared runtime allowlist into `.tmp/plugin-install/project-memory`, run both official validators, verify the bundle hash, invoke the launcher, and emit canonical JSON entries containing relative path, byte length, and SHA-256. The clean copy must run without `node_modules` and with network disabled.

- [ ] **Step 4: Add `"plugin:verify": "node scripts/verify-plugin-contents.mjs"`, run, and commit.**

```powershell
npm run bundle:plugin
npm run plugin:verify
npm test -- tests/release/plugin-contents.test.ts
git add scripts/verify-plugin-contents.mjs tests/release/plugin-contents.test.ts package.json .gitignore
git commit -m "test(plugin): verify clean installable contents"
```

## Task 8: Prove Automatic Agent Workflows

**Files:**

- Create: `tests/e2e/plugin-new-project.test.ts`
- Create: `tests/e2e/plugin-resume-project.test.ts`
- Create: `tests/e2e/plugin-legacy-project.test.ts`
- Create: `tests/fixtures/plugin-workflows/{new,resume,legacy}/**`

**Interfaces:**

- Consumes: clean Plugin copy, launcher, `agent start`, initialization, compiler, coordinator, and import planner.
- Produces: end-to-end proof of the intended user experience without a profile picker.

- [ ] **Step 1: Write the failing new-project test.** A normal brief returns one selected proposal and at most one grouped clarification. No files change before confirmation. Exact test approval bootstraps once; the next start returns `resume` and fixed reading order.

- [ ] **Step 2: Write failing resume and legacy tests.** Resume preserves one enduring root, creates workstreams instead of roots, and integrates a simulated task through the coordinator. Legacy returns a review-only import proposal, exact source hashes, and no writes.

- [ ] **Step 3: Run all three tests and verify RED.**

```powershell
npm test -- tests/e2e/plugin-new-project.test.ts tests/e2e/plugin-resume-project.test.ts tests/e2e/plugin-legacy-project.test.ts
```

- [ ] **Step 4: Fix composition only.** Do not add business rules to the skill or launcher.

- [ ] **Step 5: Run and commit.**

```powershell
npm test -- tests/e2e/plugin-new-project.test.ts tests/e2e/plugin-resume-project.test.ts tests/e2e/plugin-legacy-project.test.ts
git add tests/e2e tests/fixtures/plugin-workflows
git commit -m "test(plugin): prove automatic project memory workflows"
```

## Task 9: Add Plugin-Aware Lower-Reasoning Gates

**Files:**

- Create: `benchmarks/plugin-agent-rubric.yaml`
- Create: `benchmarks/lower-reasoning-trials/PLUGIN_PROTOCOL.md`
- Create: `tests/benchmark/plugin-agent-report.test.ts`
- Modify: `src/benchmark/report.ts`

**Acceptance thresholds:**

```yaml
minimum_supported_resolution_rate: 0.98
maximum_clarification_questions: 1
maximum_manual_profile_requests: 0
maximum_schema_invention_count: 0
maximum_authority_expansion_count: 0
minimum_recorded_runs: 2
minimum_supported_briefs: 30
```

- [ ] **Step 1: Write the failing benchmark-report test.** It rejects missing model/tool identity, prompt hash, clean Plugin hash, raw-output hash, timestamp, reviewer, or redacted output evidence.

- [ ] **Step 2: Add the Plugin protocol and rubric.** The protocol must test implicit invocation, one-confirmation bootstrap, deterministic resume, no profile picker, no schema invention, and no authority expansion.

- [ ] **Step 3: Extend the report generator.** Compute all thresholds from immutable trial records; never allow a narrative assertion to substitute for evidence.

- [ ] **Step 4: Run and commit.**

```powershell
npm test -- tests/benchmark/plugin-agent-report.test.ts
git add benchmarks/plugin-agent-rubric.yaml benchmarks/lower-reasoning-trials/PLUGIN_PROTOCOL.md tests/benchmark/plugin-agent-report.test.ts src/benchmark/report.ts
git commit -m "test(plugin): define agent invocation acceptance gate"
```

## Task 10: Prepare Local Codex Installation Validation

**Files:**

- Create: `docs/pilots/CODEX_PLUGIN_INSTALL_PILOT.md`
- Create: `scripts/verify-local-marketplace.mjs`
- Create: `tests/release/codex-install-readiness.test.ts`

**Boundary:** This task prepares the pilot but does not install or register the Plugin. The actual commands require Pitaji's separate approval because they change the user's Codex installation.

- [ ] **Step 1: Write the failing readiness test.** It requires a clean Plugin verifier result, local marketplace validation, explicit install approval, an isolated scratch repository, and a rollback command.

- [ ] **Step 2: Add the read-only marketplace verifier and pilot runbook.** The runbook must capture `codex plugin list` before and after, open a new Codex task against a sanitized scratch repository, verify automatic start behavior, and document rollback.

- [ ] **Step 3: Record the exact commands as pending approval.** Do not run them in this task.

```powershell
python plugin-creator/scripts/update_plugin_cachebuster.py plugins/project-memory
codex plugin marketplace add "<repository-root>"
codex plugin add project-memory@project-memory
```

- [ ] **Step 4: Run read-only validation and commit.**

```powershell
npm test -- tests/release/codex-install-readiness.test.ts
node scripts/verify-local-marketplace.mjs
git add docs/pilots/CODEX_PLUGIN_INSTALL_PILOT.md scripts/verify-local-marketplace.mjs tests/release/codex-install-readiness.test.ts
git commit -m "docs(plugin): prepare scoped Codex install pilot"
```

## Task 11: Prepare GitHub Publication Without Publishing

**Files:**

- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Create: `docs/publication/PUBLICATION_CHECKLIST.md`
- Create: `scripts/verify-publication-readiness.mjs`
- Create: `tests/release/publication-readiness.test.ts`
- Create: `.github/workflows/release-candidate.yml`
- Modify: `README.md`
- Modify: `package.json`

**Boundary:** Keep development metadata `UNLICENSED`. Do not create a remote, choose a license for Pitaji, push, publish a package, create a release, or enable a write-capable workflow.

- [ ] **Step 1: Write the failing publication-readiness test.** It must block while the project is `UNLICENSED`, canonical repository URLs are absent, publication approvals are absent, or required trial evidence is incomplete.

- [ ] **Step 2: Add the read-only publication checker and documentation.** Add `publication:check` to `package.json`. The checklist must separate technical readiness from legal/owner decisions.

- [ ] **Step 3: Add a non-publishing release-candidate workflow.** It may test and build an artifact, but it must have no write token and no package/release publication step.

- [ ] **Step 4: Run the expected blocked gate and commit.**

```powershell
npm test -- tests/release/publication-readiness.test.ts
npm run publication:check
# Expected: non-zero until Pitaji supplies the release approvals and metadata.
git add SECURITY.md CONTRIBUTING.md docs/publication/PUBLICATION_CHECKLIST.md scripts/verify-publication-readiness.mjs tests/release/publication-readiness.test.ts .github/workflows/release-candidate.yml README.md package.json
git commit -m "docs(release): prepare GitHub publication gate"
```

## Final Plugin Gate

Before the Plugin architecture is called implementation-complete:

- [ ] Official Plugin and skill validators pass.
- [ ] The clean Plugin copy starts with no `node_modules` and no network.
- [ ] The bundled runtime is deterministic and its hash is recorded.
- [ ] New, resumed, and legacy-project workflows pass without a manual profile picker.
- [ ] No project files change before the one required bootstrap confirmation.
- [ ] Lower-reasoning evidence meets every numeric threshold in Task 9.
- [ ] A real Codex installation pilot remains blocked until separately approved and is then recorded without touching a live product repository.
- [ ] Publication readiness remains visibly blocked while license, repository, and release authority are undecided.
