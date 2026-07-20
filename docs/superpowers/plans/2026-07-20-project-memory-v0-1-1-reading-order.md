# Project Memory v0.1.1 Reading-Order Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release a bounded v0.1.1 candidate in which every agent-facing startup surface presents the same canonical five-file reading prefix.

**Architecture:** Reuse `AGENT_READING_ORDER_PREFIX` as the single runtime definition. Generated `PROJECT_CONTEXT.md` and `HANDOFF.md` render their numbered startup lists from that definition, while focused tests lock the rendered bytes and skill/protocol order. Package and Plugin identity move together to `0.1.1`; historical v0.1.0 publication authorization remains unchanged.

**Tech Stack:** Node.js 24, strict TypeScript/ESM, Vitest, Codex Plugin manifest, Git.

## Global Constraints

- Keep Guided History Import and offline behavior unchanged.
- Add no dependency, service, adapter, profile, schema, catalog, or LifeOf application change.
- Do not edit generated project-memory files in a product repository.
- Do not install, publish, push, tag, or modify historical v0.1.0 authorization.
- Preserve the exact prefix: `PROJECT_CONTEXT.md`, `docs/project-memory/PROTOCOL.md`, `docs/project-memory/profile.lock.yaml`, `docs/project-memory/views/NOW.md`, `docs/project-memory/views/HANDOFF.md`.

---

### Task 1: Lock and render one startup reading prefix

**Files:**
- Modify: `plugins/project-memory/tests/materialize/project-tree.test.ts`
- Modify: `plugins/project-memory/tests/governance/generated-views.test.ts`
- Modify: `plugins/project-memory/tests/plugin/skill-contract.test.ts`
- Modify: `plugins/project-memory/src/materialize/render-startup-context.ts`
- Modify: `plugins/project-memory/src/governance/views/render-handoff.ts`
- Modify: `plugins/project-memory/tests/fixtures/governance/views/expected/HANDOFF.md`

**Interfaces:**
- Consumes: `AGENT_READING_ORDER_PREFIX: readonly [string, string, string, string, string]` from `src/agent/start.ts`.
- Produces: generated startup and handoff documents whose first five numbered entries match that tuple exactly.

- [x] **Step 1: Write focused regression assertions**

Assert that the generated `PROJECT_CONTEXT.md`, generated `HANDOFF.md`, skill, and fallback protocol expose every `AGENT_READING_ORDER_PREFIX` item in exact order and before task-specific references.

- [x] **Step 2: Run the focused tests and verify the existing renderers fail**

Run: `npx vitest run tests/materialize/project-tree.test.ts tests/governance/generated-views.test.ts tests/plugin/skill-contract.test.ts --maxWorkers=1`

Expected: FAIL because generated startup and handoff currently omit `PROTOCOL.md` and `HANDOFF.md`.

- [x] **Step 3: Render both lists from the canonical tuple**

Import `AGENT_READING_ORDER_PREFIX` in both renderers and generate numbered lines with `map`, followed by assigned-task and direct-reference guidance.

- [x] **Step 4: Refresh only the affected checked-in handoff golden**

Run: `$env:UPDATE_VIEW_GOLDENS='1'; npx vitest run tests/governance/generated-views.test.ts --maxWorkers=1; Remove-Item Env:UPDATE_VIEW_GOLDENS`

Expected: PASS and only `tests/fixtures/governance/views/expected/HANDOFF.md` changes.

- [x] **Step 5: Run the focused contract tests**

Run: `npx vitest run tests/materialize/project-tree.test.ts tests/governance/generated-views.test.ts tests/plugin/skill-contract.test.ts --maxWorkers=1`

Expected: PASS.

### Task 2: Align the v0.1.1 candidate identity and validate it

**Files:**
- Modify: `plugins/project-memory/package.json`
- Modify: `plugins/project-memory/package-lock.json`
- Modify: `plugins/project-memory/.codex-plugin/plugin.json`
- Modify: `plugins/project-memory/src/version.ts`
- Modify: `plugins/project-memory/README.md`
- Modify: `plugins/project-memory/scripts/verify-plugin-contents.mjs`
- Modify: version assertions under `plugins/project-memory/tests/cli/`, `tests/mcp/`, `tests/e2e/`, and `tests/release/`
- Modify: generated Plugin/runtime bundles only through repository scripts

**Interfaces:**
- Consumes: approved candidate version `0.1.1`.
- Produces: matching npm package, Plugin manifest, CLI, MCP, clean-bundle, test, and documented tarball identities.

- [x] **Step 1: Update canonical version sources and assertions**

Change active package/plugin/runtime references from `0.1.0` to `0.1.1`. Do not modify dependency versions, schema/catalog versions, or `docs/publication/PUBLICATION_APPROVALS.json`.

- [x] **Step 2: Run version and clean-Plugin checks**

Run: `npx vitest run tests/cli/main.test.ts tests/mcp/server.test.ts tests/mcp/stdio.test.ts tests/release/plugin-bundle.test.ts tests/release/plugin-contents.test.ts tests/e2e/plugin-mcp-new-project.test.ts --maxWorkers=1`

Expected: PASS with runtime identity `0.1.1`.

- [x] **Step 3: Run package gates**

Run: `npm run typecheck`, `npm run lint`, `npm run generated:verify`, `npm run plugin:verify`, and `npm run package:verify`.

Expected: PASS. `npm run publication:check` may remain read-only blocked solely because v0.1.1 has no separate publication authorization or refreshed lower-reasoning release evidence.

- [x] **Step 4: Retry the unchanged full serial suite once**

Run: `npm run test:ci`

Expected: PASS. If the known MCP-child shutdown hang recurs, stop the processes created by this run, record the timeout honestly, and do not claim a full-suite pass.

Result: an initial bounded run timed out during Plugin-content verification. After refreshing the six expected profile golden snapshots, the exact serial CI command passed 125/125 test files and 835/835 tests.

- [x] **Step 5: Inspect scope and whitespace**

Run: `git diff --check`, `git status --short`, and inspect `git diff --stat` plus the complete diff.

Expected: no unrelated source, dependency, authorization, installation, publication, or LifeOf change.
