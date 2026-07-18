# Project Memory Agent Plugin Design Addendum

**Owner:** Pv Vimal Nair (Pitaji)
**Date:** 2026-07-14
**Status:** Approved for implementation planning
**Extends:** `2026-07-14-project-memory-system-design.md`
**Approved by:** Pv Vimal Nair (Pitaji), 2026-07-14

## 1. Decision and scope

Project Memory is an agent-operated system. Its primary v1 product surface is an installable Codex Plugin named `project-memory`, not a command-line application that Pitaji is expected to operate.

The Plugin contains an implicitly invokable Project Memory skill and a self-contained local engine. The engine also exposes a command-line interface for automation, CI, recovery, and agent tools that cannot load the Codex Plugin. Canonical memory remains tool-neutral repository content under `docs/project-memory/`.

This addendum changes packaging, installation, startup behavior, and release verification. The approved repository-first data model, authority boundaries, catalog, compiler, append-only history, claims, integration coordinator, and generated views remain normative.

V1 includes:

- One installable Codex Plugin and repo-local Codex marketplace entry.
- One Project Memory skill with implicit invocation enabled.
- One bundled, zero-runtime-install Node.js engine and CLI fallback.
- Tool-neutral project files plus generated `AGENTS.md` and optional `CLAUDE.md` routers.
- GitHub-publication readiness without publishing, pushing, or selecting a license on Pitaji's behalf.

V1 does not include:

- A standalone graphical application.
- A user-facing profile picker.
- A hosted service, database, telemetry service, or mandatory network connection.
- Native Plugin packages for every agent vendor.
- Automatic publication to GitHub, npm, a registry, or a marketplace.
- Modification of LifeOf or another live product without a separately approved pilot.

## 2. Approaches considered

### A. CLI-only

Agents or Pitaji would call a command-line program directly. This is portable and testable, but it makes the internal engine look like the product and does not reliably establish the before-work agent behavior Pitaji requested.

**Decision:** Rejected as the primary experience. Retained only as a fallback and automation boundary.

### B. Codex Plugin only

All behavior would live in Codex-specific skill instructions. Installation would be simple, but deterministic classification, schema validation, atomic updates, concurrency controls, and cross-tool reuse would depend too heavily on model reasoning.

**Decision:** Rejected. It cannot meet the 98-99% structure, lower-reasoning-agent, and safe-concurrency goals.

### C. Agent-first Plugin with a shared local engine

Codex installs one Plugin. Its skill decides when Project Memory applies and invokes the deterministic engine. Project repositories store the canonical, tool-neutral result. Other agent tools use adapters or the same CLI fallback.

**Decision:** Selected. It gives Pitaji an agent-native experience while preserving deterministic behavior and cross-tool portability.

## 3. User experience

Pitaji installs the Plugin once. After installation, he works in natural language.

### New project

1. Pitaji opens a project in Codex and describes what he wants to build.
2. The Plugin skill is eligible for implicit invocation before substantive project work.
3. The agent runs the read-only Project Memory doctor.
4. If the repository is not initialized, the agent inspects the brief, repository, enduring value proposition, lifecycle, existing documents, stack, and risks.
5. The engine selects the root blueprint, overlays, components, domains, and adapters. Pitaji does not browse or choose profiles.
6. The agent presents one concise proposal with the detected product root, source documents, assumptions, and any consequential authority boundary.
7. Pitaji gives one confirmation. If the result is genuinely ambiguous, the agent asks at most one grouped clarification before confirmation.
8. The agent applies the confirmed bootstrap through the normal integration coordinator.
9. Validation completes before implementation work begins.

The one-time confirmation preserves the approved authority model. It is a yes/no review of an agent-selected proposal, not manual profile selection.

### Existing initialized project

1. The agent follows `PROJECT_CONTEXT.md` and the locked profile.
2. The normal task request is decomposed into an initiative only when useful, finite workstreams, and bounded task packets.
3. Workers claim scope and operate in isolated branches or worktrees.
4. Workers submit completion packets with exact changes, evidence, checks, omissions, and risks.
5. Only the integrator promotes accepted facts, regenerates current views, and appends history.
6. A later agent starts from the same accepted state without needing the previous chat.

### Existing project without Project Memory

The Plugin scans legacy PRDs, handoffs, changelogs, worklogs, decision logs, and relevant repository signals. It proposes one canonical destination per fact and does not accept interpretations automatically. Originals are preserved by content hash. Apply occurs only after review and through one atomic import mutation.

## 4. Product architecture

Project Memory has four bounded layers:

### 4.1 Codex Plugin shell

The Plugin is the installable product surface. It owns:

- `.codex-plugin/plugin.json`.
- The `project-memory` skill.
- Skill UI metadata with implicit invocation enabled.
- Starter prompts and public presentation metadata.
- The bundled engine, catalog, schemas, templates, and adapters required at runtime.

The Plugin manifest contains only validated fields and only references files that exist in the Plugin archive. Hooks, apps, MCP servers, icons, and screenshots are omitted unless they are intentionally implemented and validated.

### 4.2 Agent skill

The skill is concise and procedural. Its frontmatter description covers these triggers:

- Beginning substantive work in a new or existing software, product, research, design, marketing, or operations repository.
- Creating or resuming Project Memory.
- Planning, assigning, claiming, handing off, integrating, importing, migrating, or closing project work.
- Recovering project context after a new agent or new conversation starts.

The skill instructs agents to:

1. Run doctor before substantive work.
2. Bootstrap only when Project Memory is absent.
3. Read the fixed startup doorway when it is present.
4. Use plan/apply operations rather than hand-editing generated or canonical artifacts.
5. Keep workers out of canonical integration paths.
6. Return exact evidence and failure information.
7. Ask only when authority or genuine ambiguity requires Pitaji.

Detailed schemas, catalog definitions, and command contracts stay in bundled references or the engine. They are not copied into `SKILL.md`.

### 4.3 Deterministic engine

The TypeScript engine remains the authority-preserving implementation described by the original specification. It owns selection, compilation, materialization, validation, records, views, archives, claims, leases, imports, migrations, and finalization.

Development uses exact npm dependencies and lifecycle scripts remain disabled during installation. Release produces a self-contained JavaScript bundle containing all required runtime code. A Plugin user needs the supported Node.js runtime but does not run `npm install` inside each project.

The CLI is a typed adapter over the same engine. It is not a second implementation and cannot bypass the coordinator.

### 4.4 Repository memory

Each initialized product repository owns its accepted instance:

- `PROJECT_CONTEXT.md` is the fixed startup doorway.
- `docs/project-memory/project.yaml` is the accepted profile-selection input.
- Locked, vendored catalog definitions make the project self-contained.
- Canonical records and events own changing facts.
- `NOW.md`, `HANDOFF.md`, `WORKSTREAMS.md`, `CHANGELOG.md`, `HISTORY.md`, and `INDEX.json` are generated views.
- Historical artifacts and superseded facts remain append-only or content-addressed.
- `AGENTS.md` and optional `CLAUDE.md` are routers, not truth stores.

## 5. Repository and Plugin layout

The GitHub-ready source repository is also a one-Plugin Codex marketplace:

```text
project-memory-system/
├── .agents/plugins/marketplace.json
├── docs/superpowers/
├── README.md
├── AGENTS.md
└── plugins/project-memory/
    ├── .codex-plugin/plugin.json
    ├── package.json
    ├── package-lock.json
    ├── skills/project-memory/
    │   ├── SKILL.md
    │   └── agents/openai.yaml
    ├── src/
    ├── tests/
    ├── catalog/project-memory/v1/
    ├── schemas/project-memory/v1/
    ├── templates/project-memory/
    ├── scripts/
    └── dist/
```

`plugins/project-memory/` is the only npm package. The repository does not use npm workspaces. Existing implementation-plan paths such as `src/`, `tests/`, `catalog/`, and `templates/` are interpreted relative to this Plugin package root after the implementation plans are revised.

The marketplace name is `project-memory`. Its entry is `AVAILABLE`, uses `ON_INSTALL` authentication policy, has category `Productivity`, and points to `./plugins/project-memory`.

The development manifest uses:

- Name: `project-memory`.
- Version: `0.1.0` plus a Codex cachebuster only during local reinstall iterations.
- Developer name: `Pv Vimal Nair`.
- Category: `Productivity`.
- Capabilities: project initialization, context recovery, planning, governed writes, handoff, history, and validation.
- License: `UNLICENSED` until Pitaji approves a public license.

Repository, homepage, privacy, terms, and visual asset fields are omitted until real public destinations or files exist. No placeholder URLs or missing assets enter the manifest.

## 6. Invocation and data flow

### Startup

```text
Normal user request
  -> implicit Project Memory skill
  -> read-only doctor
  -> existing root: read PROJECT_CONTEXT.md
  -> missing root: generate initialization plan
  -> Pitaji confirms selected proposal
  -> coordinator bootstrap
  -> validation
  -> normal work begins
```

### Routine work

```text
Natural-language outcome
  -> profile and current-view read
  -> pattern selection and companion closure
  -> initiative/workstream/task planning
  -> claimed worker execution
  -> completion packet
  -> current-base validation and gates
  -> integrator finalization
  -> append-only events/archive plus regenerated views
```

The Plugin never treats chat history as canonical truth. Conversational facts enter the project only through a reviewed plan and a coordinator-owned mutation.

## 7. Cross-tool behavior

Codex receives the complete v1 Plugin experience.

Other agent tools receive two portable surfaces:

1. Repository adapters such as `AGENTS.md` and optional `CLAUDE.md` route agents into the same `PROJECT_CONTEXT.md` and protocol.
2. The self-contained CLI bundle exposes the same plan, validation, and finalization contracts when the other tool can execute local commands.

A native Plugin for another vendor is a separate packaging project. It may reuse the same engine and repository protocol, but it is not required to call Codex v1 complete.

An unadapted agent can read the repository memory and produce a completion packet. It cannot safely promote canonical state unless it can invoke the coordinator contract.

## 8. Safety and authority

- Plugin installation grants no production, deployment, publication, credential, or external-message authority.
- Runtime is local and network-free by default.
- The Plugin may inspect and mutate only the repository explicitly opened for the task.
- Initial root/profile truth still requires Pitaji's one-time confirmation.
- Directional, architecture, security, authentication, production, and consequential external actions retain their existing approval gates.
- Workers never edit generated views, locks, canonical events, or append-only history directly.
- All applies recompute their plan, verify expected hashes and current Git state, and finalize through the coordinator.
- Failed validation leaves canonical state unchanged.
- Secrets and private project content never enter public fixtures, Plugin presentation metadata, telemetry, or release artifacts.

## 9. GitHub publication model

The repository can be published on GitHub after the publication gate. Public users clone the marketplace repository, configure that local marketplace using the verified Codex installation instructions, and install `project-memory` from it. The exact installation commands must be tested against the current Codex release before documentation is finalized.

Before publication, Pitaji must approve:

- The GitHub owner and repository name.
- The open-source or source-available license. MIT is the recommended permissive option, but it is not selected automatically.
- Public author/contact metadata.
- The first public semantic version.
- The final README, privacy statement, contribution policy, and security-reporting route.
- The exact push, release, and marketplace actions.

Public release checks include secret scanning, fixture sanitization, dependency licenses and audit, reproducible bundle hashes, package contents, clean-clone tests, Windows and Linux CI, Plugin validation, skill validation, and an install/reinstall/new-thread pickup test.

Development may prepare these artifacts but must not publish, push, create a release, or change a public marketplace without separate authorization.

## 10. Failure handling

- Plugin absent: the repository router remains readable; the agent reports that automatic coordinator operations require the Plugin or CLI.
- Node.js absent or unsupported: doctor fails with one actionable compatibility issue and performs no writes.
- Uninitialized project: generate a plan; never invent or partially create folders outside apply.
- Ambiguous root: ask at most one grouped clarification and do not apply.
- Existing conflicting documentation: produce an import proposal and preserve originals.
- Stale or tampered lock: fail closed and generate a verification report.
- Worker without authority: create a proposal or completion packet; do not promote truth.
- Plugin update changes schemas or catalog semantics: require explicit versioned migration; never silently upgrade a project.

## 11. Testing and acceptance

The original subsystem tests remain required. The Plugin adds these gates:

1. The Plugin manifest passes the official local validator with no unsupported fields or missing paths.
2. The Project Memory skill passes skill validation and stays concise enough for implicit use.
3. Plugin and skill metadata consistently name `project-memory`.
4. The release Plugin archive contains the engine bundle, selected runtime catalog, schemas, templates, skill, and manifest without development fixtures or secrets.
5. A clean Plugin install requires no project-local `npm install`.
6. A new Codex thread discovers the installed skill.
7. A scratch new project triggers doctor before substantive work and produces one initialization proposal without asking the user to select a profile.
8. A scratch initialized project resumes from `PROJECT_CONTEXT.md` and generated current views.
9. A worker cannot directly mutate canonical truth.
10. An existing legacy fixture produces a review-only import plan and no writes.
11. Two lower-reasoning-agent runs across at least 30 supported briefs meet the existing 98% resolution, zero schema invention, and zero authority expansion gate.
12. Windows and Linux produce equivalent logical manifests and bundle hashes.

No live product repository participates in acceptance testing until Pitaji approves a scoped pilot.

## 12. Implementation transition

The current baseline commit contains only the approved documentation. An uncommitted package manifest and smoke test from the earlier CLI-first start exist only in the isolated development worktree; they are not functional software and are not part of the baseline.

After this addendum is approved:

1. Revise the master roadmap and subsystem plans so the package root is `plugins/project-memory/`.
2. Add a dedicated Plugin and agent-workflow implementation plan.
3. Re-review the dependency set, including the deterministic release bundler.
4. Scaffold the Plugin with the Plugin Creator scripts rather than hand-building its manifest.
5. Initialize the bundled skill with the Skill Creator scripts.
6. Resume test-first foundation implementation inside the Plugin package.
