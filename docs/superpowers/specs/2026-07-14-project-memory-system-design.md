# Multi-Agent Project Memory System — Design Specification

**Owner:** Pv Vimal Nair (Pitaji)  
**Date:** 2026-07-14  
**Status:** Approved for implementation planning  
**Scope:** Architecture and behavior only. This document does not authorize implementation.

## 1. Purpose

This system preserves complete, reliable project context across Codex, Claude Code, other agent tools, lower-reasoning models, humans, concurrent workstreams, and future sessions.

It must let an incoming agent determine:

- What the enduring product or project is.
- What has been accepted, completed, changed, rejected, removed, superseded, or deferred.
- Which work is active, blocked, proposed, or awaiting integration.
- Which decisions and constraints govern current work.
- Which components and files the agent may inspect or modify.
- What evidence proves completion.
- What should happen next.

The system is repository-first, tool-neutral, versioned, and self-contained after setup. Weaker agents should mostly select and follow explicit structures rather than inventing them.

## 2. Approved decisions

1. The repository is the canonical project-memory source.
2. A product such as LifeOf has one enduring profile and history.
3. Campaigns, audits, redesigns, refactors, migrations, releases, and incidents are work inside the product, not separate product profiles.
4. The catalog covers software, games, AI/data, commerce, design, marketing, content, research, operations, and other digital or knowledge work.
5. The initial catalog provides 62 ready-made root-profile presets across 11 blueprint groups.
6. Agents select profiles and work patterns automatically from observable signals.
7. Pitaji confirms the initial root profile once.
8. Routine factual work does not require Pitaji to select folders, modules, or patterns.
9. Factual updates may be integrated automatically after validation.
10. Product-direction changes remain proposed until Pitaji approves them.
11. Worker agents operate in isolated branches or worktrees.
12. Only the designated lead integrator updates canonical truth after finalization.
13. Active truth remains concise while historical records remain permanently discoverable.
14. Each fact class has one canonical home.
15. Handoffs, changelogs, indexes, and current summaries are generated views.
16. Tool-specific instruction files are optional adapters and never contain canonical product truth.

## 3. Goals and non-goals

The system must:

- Provide a fixed, short startup reading path.
- Preserve full history without loading it by default.
- Resolve at least 98% of supported briefs without schema invention.
- Work for lower-reasoning agents through flattened profiles and task packets.
- Prevent concurrent workers from silently overwriting accepted state.
- Separate reusable definitions from product-specific instances.
- Separate assessments from modifications and proposals from accepted decisions.
- Require evidence for completion.
- Support small projects without removing safety guarantees.
- Support one root across several repositories and several roots in one monorepo.
- Evolve the catalog without silently changing existing projects.

The system does not:

- Treat raw transcripts as current truth.
- Require the user to classify every task.
- Create a product profile for every campaign, audit, or refactor.
- Replace Git, tests, or source control.
- Permit validators to decide product direction.
- Permit assessments automatically to authorize remediation.
- Require every agent tool to have an instruction file.
- Require every agent to load the archive.
- Cover physical products, hardware, or event operations in v1.

## 4. Normative principles

### One enduring root

Work attaches to the product, shared system, program, portfolio, or engagement that owns its mission, authority, operating lifecycle, roadmap, and history.

### One fact, one home

A fact is stored once in its canonical record. Other documents link to it or generate views from it.

### Explicit over inferred

The catalog may use inheritance internally, but repositories receive fully materialized profiles and workers receive flattened task packets.

### Proposals are not accepted truth

Workers may propose ideas, decisions, architecture, remediation, or direction. Authority rules determine whether those proposals become accepted.

### Evidence before completion

No task becomes verified without actual evidence or an explicit statement that a required check was not run.

### Append-only history

Rejected ideas, superseded decisions, findings, failed experiments, and reverted changes remain discoverable. Corrections use addenda or superseding records.

### Disposable generated views

Current-state views are regenerated and never outrank their sources.

### Serialized integration

Workers may operate concurrently. One designated integrator promotes work into canonical truth against the latest accepted revision.

## 5. Conceptual model

```text
Master Catalog
├── Root-profile blueprints
├── Component definitions
├── Permanent domains
├── Traits and overlays
├── Stack/tool adapters
├── Work-pattern recipes
├── Templates and schemas
├── Validation rules
└── Golden classification fixtures
             ↓ compile and lock
Root Repository
├── One enduring root profile
├── Persistent components
├── Permanent domains
├── Finite workstreams
│   └── Bounded task packets
├── Canonical records
├── Generated views
└── Historical archive
```

- **Root:** The enduring entity that owns mission, authority, lifecycle, roadmap, and canonical history.
- **Root kind:** Governance form: product, shared system, program, portfolio, or engagement.
- **Primary archetype:** The root's dominant operating model and selection boundary.
- **Blueprint:** A ready-made, versioned preset used to materialize a root profile.
- **Component:** Something the root permanently contains or operates.
- **Domain:** An ongoing responsibility or discipline.
- **Trait/overlay:** A cross-cutting condition that activates requirements.
- **Stack adapter:** Framework- or tool-specific conventions and gates.
- **Initiative:** Optional grouping for sibling workstreams serving one broader intent.
- **Work-pattern recipe:** Reusable procedure for a type of work.
- **Workstream:** One coherent finite outcome inside the root.
- **Task packet:** One isolated agent assignment.
- **Record:** A canonical decision, idea, finding, change, risk, evidence item, lesson, or approval.

### Root classification contract

The selector uses three separate fields:

- `root_kind`: `product`, `shared-system`, `program`, `portfolio`, or `engagement`.
- `primary_archetype`: `application-service`, `developer-platform`, `game-interactive`, `ai-data`, `commerce-network`, `content-learning`, `brand-design`, `research-knowledge`, `operations-automation`, `portfolio`, or `engagement`.
- `blueprint`: the exact ready-made preset and version selected from the catalog.

`root_kind` answers how the entity is governed. `primary_archetype` answers what operating model dominates. `blueprint` answers which concrete preset is compiled. They must not be collapsed into one ambiguous "profile type" field.

Every blueprint declares `group_id`, allowed `root_kind` values, exactly one `primary_archetype`, baked overlays, default overlays, and forbidden overlays. The compiler maintains an explicit compatibility matrix and rejects any root-kind/archetype/blueprint/overlay combination not declared by the selected blueprint version.

### Root versus workstream test

A candidate is a root only when it:

1. Persists beyond the current outcome.
2. Owns an enduring mission or value proposition.
3. Has independent authority and accountable ownership.
4. Maintains a canonical operating lifecycle, roadmap, and history.
5. Can contain and govern several finite outcomes over time.

A candidate is a workstream when it has a finish condition, inherits identity and authority from a parent root, and can close without ending that parent. Duration, budget, team size, repository count, or complexity do not determine this boundary.

**Bounded-engagement exception:** when no enduring parent exists, an engagement may serve as the canonical root for its finite contractual lifecycle. It must own authority, scope, acceptance, handoff, closure, and archive for that engagement. It must not be used when a real enduring parent can own the work, and it ends in `closed` or `archived` rather than pretending to have an endless roadmap.

One request may create several sibling workstreams when it contains several coherent outcomes. An initiative may group those workstreams, but the initiative does not become a second source of root truth.

### Root and component boundary rules

- A website is normally a component or surface unless it is itself an enduring application or content property with independent ownership and lifecycle.
- An API is normally a component unless developers are the primary customers and the API owns its own roadmap, contracts, and lifecycle.
- AI is normally a component or overlay unless intelligence is the root's primary value proposition and operating model.
- Marketing operations and support operations become roots only when independently operated with their own owners, roadmap, policies, and service lifecycle.
- A community is normally a component unless participation or network value is the primary promise.
- An organization-wide capability program is a root only when independently governed; a finite transformation remains a workstream.
- A child root is also required when legal, regulatory, security, contractual, or data-isolation requirements make shared authority or lifecycle unsafe.

## 6. Universal profile core

Every blueprint inherits:

- Identity, mission, ownership, and stakeholders.
- Success criteria, scope, and exclusions.
- Lifecycle stage.
- Requirements, constraints, and policies.
- Risks and dependencies.
- Decisions and ideas.
- Workstreams and tasks.
- Findings and evidence.
- Changes and releases.
- Handoffs and lessons.
- Historical archive.
- Governance, documentation, evidence-quality, and change-control rules.

Small projects use the same safe core with fewer components and shorter documents.

## 7. Blueprint catalog

The v1 catalog contains 62 ready-made root-profile presets across 11 blueprint groups.

| Group ID | Primary archetype |
|---|---|
| `blueprint-group.application-service` | `application-service` |
| `blueprint-group.developer-platform` | `developer-platform` |
| `blueprint-group.game-interactive` | `game-interactive` |
| `blueprint-group.ai-data` | `ai-data` |
| `blueprint-group.commerce-network` | `commerce-network` |
| `blueprint-group.content-learning` | `content-learning` |
| `blueprint-group.brand-design` | `brand-design` |
| `blueprint-group.research-knowledge` | `research-knowledge` |
| `blueprint-group.operations-automation` | `operations-automation` |
| `blueprint-group.portfolio` | `portfolio` |
| `blueprint-group.engagement` | `engagement` |

### Application and service products

- `application.consumer-mobile` — Consumer mobile application.
- `application.consumer-multisurface` — Consumer multi-surface product.
- `application.b2b-saas` — B2B SaaS.
- `application.internal-business` — Internal business application.
- `application.desktop` — Desktop application.
- `application.public-web-service` — Public web application or service.
- `application.creator-professional` — Creator or professional tool.
- `service.managed` — Managed service offering.

Defaults include product, research, UX, design system, client surfaces, backend/API, identity, data, analytics, notifications, admin/support tools, security, privacy, QA, infrastructure, release, distribution, growth, and support.

The managed-service preset additionally requires service definition, intake, client/account records, SLAs, delivery workflow, capacity, quality control, reporting, billing, and renewal or closure rules.

### Developer and technical platforms

- `developer.api-product` — API product.
- `developer.sdk-library` — SDK, library, or package.
- `developer.cli-tool` — CLI or developer tool.
- `developer.shared-infrastructure` — Shared infrastructure platform.
- `developer.integration-ecosystem` — Integration or connector ecosystem.
- `developer.open-source` — Open-source technical product.

Defaults include technical contracts, architecture, schemas/interfaces, documentation, examples, compatibility, deprecation, CI, test harnesses, artifacts, sandbox, supply-chain controls, observability, SLA, support, changelog, and migrations.

The open-source technical-product entry is a convenience preset that applies the open-source overlay, including contribution, governance, licensing, security-reporting, maintainer, and release requirements.

### Games and interactive experiences

- `game.premium-single-player` — Premium single-player game.
- `game.casual-mobile` — Casual or mobile game.
- `game.free-to-play-live-service` — Free-to-play live-service game.
- `game.multiplayer-networked` — Multiplayer or networked game.
- `game.simulation-learning` — Simulation or serious-learning game.
- `game.xr-immersive` — XR or immersive experience.

Defaults include player promise, core loop, mechanics, progression, economy, world, levels, narrative, player UX, runtime, saves, backend/netcode, art, audio, telemetry, balance, monetization, playtesting, certification, community, trust/safety, and live operations where applicable.

### AI and data products

- `ai.assistant-agent` — AI assistant or agent.
- `ai.model-service` — Model or ML service.
- `ai.analytics-decision-support` — Analytics or decision-support product.
- `ai.data-platform` — Data platform or dataset product.
- `ai.benchmark-evaluation` — Benchmark or evaluation suite.
- `ai.recommendation-personalization` — Recommendation or personalization product.

Defaults include use cases, data sources, lineage, quality, pipelines, models, prompts, tools, retrieval, evaluations, guardrails, human review, serving, experiments, cost, latency, drift, monitoring, privacy, security, and model governance.

### Commerce, marketplace, and network products

- `commerce.ecommerce` — E-commerce product.
- `commerce.two-sided-marketplace` — Two-sided marketplace.
- `commerce.booking-reservation` — Booking or reservation platform.
- `network.community-social` — Community or social network.
- `commerce.membership` — Membership platform.
- `network.multi-party-transaction` — Multi-party transaction network.

Defaults include participants, catalog/listings, discovery/matching, orders/bookings, pricing, payments, settlement, reputation, messaging, moderation, fraud, disputes, support, operations, analytics, growth, administration, legal, and compliance.

### Content, media, and learning properties

- `content.publication-newsletter` — Publication or newsletter.
- `content.podcast-video-channel` — Podcast, video, or channel property.
- `content.media-library` — Media or asset library.
- `learning.course-curriculum` — Course or curriculum product.
- `content.documentation-portal` — Documentation or knowledge portal.
- `content.creator-property` — Creator content property.

Defaults include editorial mission, taxonomy, calendar, sources, production pipeline, assets, rights, review, CMS, publishing, SEO, accessibility, localization, audience, community, monetization, analytics, and archive.

The course or curriculum preset additionally requires pedagogy, learning outcomes, progression, assessments, credentials where applicable, instructor/cohort operations, and outcome measurement.

### Brand and design shared systems

- `design.brand-system` — Brand system.
- `design.product-design-system` — Product design system.
- `design.multi-brand-language` — Multi-brand design language.
- `design.creative-asset-system` — Creative asset or template system.

Defaults include positioning, voice, identity, typography, tokens, components, patterns, motion, content rules, accessibility, assets, templates, adoption, governance, versioning, and release.

This is a root only when independently reused, governed, and versioned. Otherwise it is a component of its parent product.

### Research and knowledge systems

- `research.ongoing-program` — Ongoing research program.
- `research.evidence-corpus` — Evidence base or literature corpus.
- `research.market-intelligence` — Market or competitive-intelligence system.
- `research.policy-standards` — Policy or standards knowledge base.
- `research.experimental-program` — Experimental program.
- `knowledge.organizational-base` — Maintained organizational knowledge base.

Defaults include questions, hypotheses, methods, protocols, sources, ethics, data, codebooks, analysis, findings, limitations, uncertainty, review, reproducibility, publication, taxonomy, index, and archive.

### Operations, process, and automation systems

- `operations.sop-library` — Operating system or SOP library.
- `operations.workflow-automation` — Workflow automation system.
- `operations.support-service` — Support or service-operations system.
- `operations.marketing-growth` — Marketing or growth-operations system.
- `operations.governance-compliance` — Governance or compliance system.
- `operations.business-process` — Business-process platform.

Defaults include service catalog, process maps, SOPs, RACI, inputs, outputs, SLAs, controls, approvals, integrations, automation, queues, exceptions, incidents, metrics, capacity, training, change management, continuity, and improvement.

Individual campaigns remain workstreams.

### Multi-product portfolios

- `portfolio.product-family` — Product family.
- `portfolio.company-brand-ecosystem` — Company or brand ecosystem.
- `portfolio.shared-platform` — Shared-platform ecosystem.
- `portfolio.franchise-white-label` — Franchise or white-label portfolio.
- `program.organization-capability` — Organization-wide capability program.

Defaults include entity registry, ownership, dependencies, shared strategy, constraints, standards, policies, roadmap, platform registry, governance, consolidated risks, and metrics. Portfolios link to child truth and never copy child PRDs or decisions.

### Standalone bounded engagements

- `engagement.client-delivery` — Client delivery engagement.
- `engagement.standalone-internal` — Standalone internal engagement.
- `engagement.one-off-deliverable` — One-off digital or knowledge deliverable.

Defaults include brief, scope, stakeholders, acceptance criteria, constraints, source materials, milestones, deliverables, decisions, evidence, reviews, approvals, handoff, closure, and archive.

This is a fallback only when no enduring parent can own the work.

Every blueprint definition uses the same executable scoring model as work patterns:

```yaml
blueprint:
  id: <catalog-definition-id>
  version: <semver>
  status: active | deprecated | retired
  group_id: <blueprint-group-id>
  allowed_root_kinds: []
  primary_archetype: <archetype-id>
  purpose: <selection-boundary>
  selection:
    feature_schema_version: <semver>
    required_signals: []
    positive_signals: []
    negative_signals: []
    exclusions: []
    max_positive_weight: <positive-integer>
    specificity_rank: <integer>
    precedence: <integer>
  overlays:
    baked: []
    defaults: []
    forbidden: []
  default_components: []
  default_domains: []
  adapter_slots: []
  required_documents: []
  validation_gates: []
  positive_examples: []
  negative_examples: []
```

Blueprint signals use the typed signal contract and exact scoring, status, compatibility, confidence, and tie rules in Section 11. A blueprint definition missing any field remains disabled.

## 8. Component, domain, overlay, and adapter catalogs

### Components

Component definitions cover product strategy, research, UX, brand/design systems, client surfaces, websites, administration, APIs, SDKs, CLIs, backend, identity, data stores, search, messaging, analytics, AI, realtime, commerce, payments, marketing, stores, SEO/ASO, content, localization, moderation, fraud, security, privacy, compliance, QA, performance, CI/CD, infrastructure, observability, release, support, incidents, SOPs, and training.

Specialized packs extend games, AI/data, content, research, operations, brand/design, marketplace/network, commerce, and enterprise products.

Each resolved component and domain is marked `required`, `conditional`, or `not_applicable`. A `not_applicable` entry records an intentional exclusion without generating empty folders or documents.

Every resolved component uses this minimum contract:

```yaml
component:
  id: CMP-<ULID>
  slug: <human-readable-slug>
  definition_id: <catalog-definition-id-or-null>
  definition_version: <semver-or-null>
  status: observed_unclassified | planned | active | deprecated | retired
  name: <human-readable-name>
  type: surface | service | data | platform | workflow | content | shared-system
  aliases: []
  tags: []
  owners: []
  repositories: []
  owned_paths: []
  dependencies: []
  impact_propagation: []
  risk_flags: []
  required_documents: []
  canonical_record: docs/project-memory/components/<component-id>/COMPONENT.md
```

Catalog definitions provide defaults; the resolved component record provides root-specific ownership and current state. Paths may be exact paths or declared globs, but selectors must resolve them before a write claim is issued.

definition_id and definition_version may be null only while status is observed_unclassified. Every other status requires a valid locked definition. Mapping an observation fills both fields and records provenance.

Every pattern-to-component impact entry uses this contract:

```yaml
component_impact:
  selector: <component-id | type | tag | dependency-rule>
  duties: [inspect, propose, modify, validate, approve, release, notify, record, no-touch]
  requirement: required | conditional | not_applicable
  condition: <machine-checkable-expression-or-null>
  reason: <why-this-component-is-in-scope>
  write_scope: []
  responsible_role: <worker | validator | integrator | Pitaji>
```

Every resolved permanent domain uses this minimum contract:

```yaml
domain:
  id: DOM-<ULID>
  slug: <human-readable-slug>
  definition_id: <catalog-definition-id>
  definition_version: <semver>
  status: planned | active | deprecated | retired
  name: <human-readable-name>
  purpose: <ongoing-responsibility>
  owners: []
  component_ids: []
  repositories: []
  policies: []
  risk_flags: []
  required_records: []
  required_documents: []
  canonical_record: docs/project-memory/domains/<domain-id>/DOMAIN.md
```

Every domain impact uses the parallel contract:

```yaml
domain_impact:
  selector: <domain-id | tag>
  duties: [inspect, propose, modify, validate, approve, release, notify, record, no-touch]
  requirement: required | conditional | not_applicable
  condition: <machine-checkable-expression-or-null>
  reason: <why-this-domain-is-in-scope>
  write_scope: []
  required_records: []
  responsible_role: <worker | validator | integrator | Pitaji>
```

The controlled-duty enum is identical everywhere. `modify` requires a non-empty resolved write scope. `approve` may be assigned only to the integrator or Pitaji. `release` and `notify` require valid external-action authority. `no-touch` is mutually exclusive with `modify`, `release`, and `notify`.

Impact propagation follows declared component dependencies. It may add inspection, validation, documentation, or approval duties; it may not add mutation or external-action authority.

### Permanent domains

- Governance and coordination.
- Product and strategy.
- Research and insight.
- UX, information architecture, and content design.
- Visual design, brand, and design systems.
- Engineering and architecture.
- Data, analytics, and AI.
- Security, privacy, compliance, and trust.
- QA, reliability, and performance.
- Growth, marketing, and commercial.
- Content, communications, and localization.
- Release, platform, and operations.
- Support and community.
- Finance, legal, and partnerships.
- Game design, art, audio, and live operations where applicable.

### Traits and overlays

Overlays include consumer/B2B/internal/public-sector, platform/surface, commercial model, tenancy, offline/realtime/high-availability, hosted/self-hosted, AI, community/UGC, payments, sensitive data, regulated use, lifecycle, and risk.

Overlays activate requirements deterministically:

- Authentication activates identity, security, and privacy.
- Payments activate billing, fraud, legal, reconciliation, support, and analytics.
- PII activates consent, retention, privacy, security, and governance.
- Community activates moderation, content policy, and trust/safety.
- AI activates lineage, evaluations, guardrails, safety, cost, latency, and monitoring.
- Mobile-store distribution activates store policy, release compliance, and ASO.

### Stack and tool adapters

Frameworks and tools are adapters, not blueprints. An adapter defines detection signals, relevant files, repository conventions, supported commands, tests, lint/build/release gates, documentation requirements, risks, and handoff fields.

Initial high-value adapters should cover Flutter, Firebase, Unity, React/Next.js, native iOS/Android, Node/TypeScript, Python/data/AI, Figma, Notion, Maestro, Playwright, and GitHub CI.

Tool-specific root files are optional:

- `AGENTS.md` only when Codex is selected.
- `CLAUDE.md` only when Claude Code is selected.
- Equivalent adapters only when their tools are selected.

They contain routing and tool-specific instructions only. They point to `PROJECT_CONTEXT.md`, `PROTOCOL.md`, and `profile.lock.yaml`; they never duplicate PRDs, decisions, status, or history. Using a Claude model in another application does not itself require `CLAUDE.md`.

## 9. Profile materialization and locks

`project.yaml` stores the concise accepted root selection. `profile.lock.yaml` stores the generated, fully resolved selection.

The lock includes the stable root reference, root kind, primary archetype, exact blueprint version, traits/overlays, fully expanded components/domains, rules, templates, adapters, gates, catalog release/hash, and lock hash.

### Artifact precedence

The profile artifacts have non-overlapping authority:

1. `project.yaml` is the accepted, human-reviewable root selection and the only mutable input for profile selection.
2. `catalog/selected/` contains immutable vendored catalog definitions used as compiler inputs.
3. `catalog.lock.json` is the integrity manifest for those exact definitions, versions, and hashes.
4. `profile.lock.yaml` is the generated resolved output and is never edited by hand.
5. Component records and other canonical records hold changing root-specific facts; locks never replace them.

A profile change is made by accepting a change to `project.yaml`, resolving exact catalog inputs, validating them, regenerating both locks, and recording the migration. Changing a generated lock directly is invalid.

Example:

```yaml
root:
  id: ROOT-<ULID>
  kind: product
  primary_archetype: application-service
  blueprint: application.consumer-mobile
  lifecycle: production

overlays:
  - overlay.audience.consumer
  - overlay.surface.mobile-first
  - overlay.business-model.subscription
  - overlay.risk.privacy-sensitive

component_definitions:
  - component.surface.flutter-mobile
  - component.backend.firebase
  - component.identity.authentication
  - component.data.analytics
  - component.distribution.app-store
  - component.design.system
  - component.marketing.brand-assets
  - component.operations.support

domain_definitions:
  - domain.product-strategy
  - domain.engineering-architecture
  - domain.research-ux
  - domain.visual-design
  - domain.security-privacy
  - domain.qa-reliability
  - domain.growth-marketing
  - domain.data-analytics
  - domain.release-operations

agent_adapters:
  - adapter.codex

catalog:
  release: 1.0.0
  blueprint_version: 1.0.0
  catalog_hash: "immutable-hash"
```

Workers read the resolved lock rather than reconstructing inheritance.

`profile.lock.yaml` contains resolved catalog definitions and selected IDs; it does not replace mutable root-specific state. Current component facts remain canonical in component records. The lock is generated and must not be edited manually.

## 10. Work-pattern system

Pattern IDs use `<family>.<object>.<mode>`.

Modes are `assess`, `plan`, `design`, `implement`, `change`, `validate`, `release`, `operate`, and `retire`.

Mode separation is an authorization safeguard:

```text
security.auth.assess != security.auth.change
ux.flow.assess != ux.flow.design
ux.flow.design != engineering.ui.implement
```

Pattern families are:

1. Governance and coordination.
2. Product and strategy.
3. Engineering and architecture.
4. UI, UX, and design.
5. Security, privacy, and compliance.
6. QA, reliability, and performance.
7. Data, analytics, and experimentation.
8. Growth, marketing, and commercial.
9. Content, communications, and localization.
10. Research and insight.
11. Release, platform, and operations.
12. Support, incidents, and maintenance.
13. Game-specific work.
14. AI-specific work.
15. Commerce-specific work.
16. Enterprise-specific work.

Every pattern defines identity, selection signals and anti-signals, composition, component/domain impact, duties, write scope, authorization, inputs, outputs, evidence, gates, memory updates, completion conditions, and fallback/escalation.

Controlled duties are `inspect`, `propose`, `modify`, `validate`, `approve`, `release`, `notify`, `record`, and `no-touch`.

A pattern can expand inspection and validation but cannot silently expand mutation or external-action authority.

### Normative pattern-definition contract

A pattern is selectable only when a machine-readable definition satisfies this contract and its positive, negative, composition, authorization, and golden tests pass:

```yaml
pattern:
  id: <family>.<object>.<mode>
  version: <semver>
  status: active | deprecated | retired
  purpose: <single-bounded-purpose>
  compatibility:
    root_kinds: []
    primary_archetypes: []
    required_overlays: []
    forbidden_overlays: []
  selection:
    feature_schema_version: <semver>
    required_signals: []
    positive_signals: []
    negative_signals: []
    exclusions: []
    max_positive_weight: <positive-integer>
    specificity_rank: <integer>
    precedence: <integer>
  composition:
    allowed_primary_with: []
    mandatory_companions: []
    incompatible_with: []
    triggers_companions: true
  component_impacts: []
  domain_impacts: []
  duties: []
  write_scope: []
  authorization:
    mutation: none | task-scoped | approval-required
    task_result_submission: worker
    factual_integration: integrator
    workstream_activation: automatic-by-rule | integrator | Pitaji
    directional_acceptance: Pitaji
    external_action: none | explicit-approval-required
  inputs: []
  outputs: []
  evidence: []
  gates: []
  memory_updates: []
  completion_conditions: []
  fallback_and_escalation: []
```

A pattern ID listed below is part of the normative v1 inventory, but the selector must keep it disabled until its complete definition and tests exist. Lower-reasoning agents must never synthesize a missing pattern contract from the ID alone.

### Normative v1 pattern inventory

The inventory below defines exactly 257 normative v1 pattern IDs across 16 families. The count is pinned in the catalog manifest; every listed ID must have a complete machine-readable definition and tests before the v1 selector may claim the target coverage.

**Governance and coordination**

`governance.context.assess`, `governance.scope.plan`, `governance.task.plan`, `governance.claim.operate`, `governance.decision.plan`, `governance.evidence.validate`, `governance.handoff.change`, `governance.integration.change`, `governance.documentation.change`, `governance.documentation.validate`, `governance.finding.change`, `governance.archive.operate`, `governance.postmortem.assess`, `governance.profile.change`, `governance.catalog.change`.

**Product and strategy**

`product.discovery.assess`, `product.opportunity.assess`, `product.requirements.plan`, `product.prd.plan`, `product.prd.change`, `product.feature.design`, `product.acceptance.validate`, `product.roadmap.plan`, `product.rule.change`, `product.pricing.plan`, `product.pricing.change`, `product.experiment.plan`, `product.launch.plan`, `product.policy.change`, `product.feature.retire`, `product.root.retire`.

**Engineering and architecture**

`engineering.feature.design`, `engineering.feature.implement`, `engineering.bug.implement`, `engineering.refactor.implement`, `engineering.repository.change`, `engineering.architecture.design`, `engineering.architecture.change`, `engineering.code.retire`, `engineering.api.design`, `engineering.api.change`, `engineering.schema.design`, `engineering.schema.change`, `engineering.migration.plan`, `engineering.migration.implement`, `engineering.migration.validate`, `engineering.integration.implement`, `engineering.dependency.change`, `engineering.platform.change`, `engineering.configuration.change`, `engineering.feature-flag.operate`, `engineering.build-tool.change`, `engineering.automation.implement`.

**UI, UX, and design**

`ux.research.assess`, `ux.flow.assess`, `ux.flow.design`, `ux.information-architecture.design`, `ux.interaction.design`, `ux.visual.design`, `ux.prototype.design`, `ux.copy.design`, `ux.accessibility.assess`, `ux.accessibility.change`, `ux.design-system.assess`, `ux.design-system.change`, `ux.responsive.validate`, `ux.localization.validate`, `ux.visual.validate`, `ux.handoff.change`.

**Security, privacy, and compliance**

`security.posture.assess`, `security.threat-model.assess`, `security.auth.assess`, `security.auth.change`, `security.authorization.assess`, `security.authorization.change`, `security.data.assess`, `security.privacy.assess`, `security.privacy.change`, `security.consent.assess`, `security.secrets.assess`, `security.dependency.assess`, `security.supply-chain.assess`, `security.compliance.assess`, `security.compliance.change`, `security.finding.validate`, `security.remediation.implement`, `security.incident.operate`.

**QA, reliability, and performance**

`qa.strategy.plan`, `qa.unit.validate`, `qa.integration.validate`, `qa.e2e.validate`, `qa.regression.validate`, `qa.visual.validate`, `qa.accessibility.validate`, `qa.performance.assess`, `qa.performance.change`, `qa.reliability.assess`, `qa.compatibility.validate`, `qa.release.validate`, `qa.defect.assess`, `qa.test-automation.implement`.

**Data, analytics, and experimentation**

`data.requirement.plan`, `data.instrumentation.design`, `data.instrumentation.implement`, `data.instrumentation.validate`, `data.quality.assess`, `data.pipeline.design`, `data.pipeline.implement`, `data.schema.change`, `data.migration.validate`, `data.analysis.assess`, `data.metric.design`, `data.dashboard.implement`, `data.experiment.design`, `data.experiment.validate`, `data.governance.assess`, `data.retention.change`.

**Growth, marketing, and commercial**

`growth.strategy.plan`, `growth.campaign.plan`, `growth.campaign.implement`, `growth.campaign.release`, `growth.positioning.design`, `growth.offer.design`, `growth.funnel.assess`, `growth.acquisition.plan`, `growth.lifecycle.plan`, `growth.referral.design`, `growth.store-listing.change`, `growth.seo.change`, `growth.measurement.design`, `growth.creative.design`, `growth.pricing.assess`, `growth.partnership.plan`.

**Content, communications, and localization**

`content.strategy.plan`, `content.editorial.plan`, `content.copy.design`, `content.asset.implement`, `content.review.validate`, `content.publish.release`, `content.localization.plan`, `content.localization.implement`, `content.accessibility.validate`, `content.rights.assess`, `content.taxonomy.design`, `content.archive.operate`, `content.material.retire`.

**Research and insight**

`research.question.plan`, `research.protocol.design`, `research.source.assess`, `research.user.assess`, `research.market.assess`, `research.competitor.assess`, `research.literature.assess`, `research.experiment.implement`, `research.analysis.assess`, `research.finding.validate`, `research.synthesis.change`, `research.reproducibility.validate`.

**Release, platform, and operations**

`release.readiness.validate`, `release.execution.plan`, `release.build.validate`, `release.migration.validate`, `release.rollback.plan`, `release.notes.change`, `release.deployment.release`, `release.store.release`, `release.feature-flag.operate`, `release.monitor.operate`, `release.communication.release`, `release.hotfix.release`, `release.postrelease.assess`, `release.asset.retire`.

**Support, incidents, and maintenance**

`support.request.assess`, `support.issue.assess`, `support.incident.operate`, `support.problem.assess`, `support.knowledge.change`, `support.sop.change`, `support.escalation.operate`, `support.service.validate`, `support.root-cause.assess`, `support.remediation.change`, `support.maintenance.operate`, `support.deprecation.retire`.

**Game-specific work**

`game.mechanic.design`, `game.mechanic.implement`, `game.loop.design`, `game.progression.design`, `game.economy.design`, `game.economy.change`, `game.balance.assess`, `game.balance.change`, `game.level.design`, `game.narrative.design`, `game.save.change`, `game.save.validate`, `game.multiplayer.implement`, `game.telemetry.implement`, `game.telemetry.validate`, `game.playtest.validate`, `game.content.release`, `game.live-operations.operate`, `game.anti-cheat.assess`, `game.certification.validate`.

**AI-specific work**

`ai.use-case.plan`, `ai.data.assess`, `ai.model.assess`, `ai.model.implement`, `ai.prompt.design`, `ai.prompt.change`, `ai.retrieval.design`, `ai.retrieval.implement`, `ai.tooling.implement`, `ai.evaluation.design`, `ai.evaluation.validate`, `ai.safety.assess`, `ai.guardrail.implement`, `ai.human-review.design`, `ai.serving.implement`, `ai.cost.assess`, `ai.latency.assess`, `ai.drift.operate`, `ai.monitoring.operate`, `ai.model.retire`.

**Commerce-specific work**

`commerce.catalog.change`, `commerce.checkout.design`, `commerce.checkout.implement`, `commerce.payment.implement`, `commerce.entitlement.implement`, `commerce.entitlement.validate`, `commerce.pricing.change`, `commerce.order.implement`, `commerce.booking.implement`, `commerce.settlement.validate`, `commerce.reconciliation.validate`, `commerce.fraud.assess`, `commerce.dispute.operate`, `commerce.refund.operate`, `commerce.tax.assess`, `commerce.policy.validate`, `commerce.marketplace.validate`.

**Enterprise-specific work**

`enterprise.requirement.plan`, `enterprise.integration.design`, `enterprise.integration.implement`, `enterprise.identity.change`, `enterprise.rbac.design`, `enterprise.rbac.implement`, `enterprise.audit.validate`, `enterprise.compliance.validate`, `enterprise.migration.plan`, `enterprise.migration.implement`, `enterprise.rollout.plan`, `enterprise.training.implement`, `enterprise.change-management.operate`, `enterprise.sla.validate`, `enterprise.procurement.assess`, `enterprise.tenancy.design`.

### Mandatory companion rules

Companion rules are machine-readable catalog objects, not prose hints:

```yaml
companion_rule:
  id: companion.<stable-id>
  version: <semver>
  applicability:
    root_kinds: []
    component_types: []
    artifact_types: []
    required_overlays: []
    forbidden_overlays: []
  when:
    all: []
    any: []
    none: []
  require_patterns:
    - id: <pattern-id>
      version: <version-range>
      condition: <predicate-or-true>
  require_duties: []
  require_evidence: []
  authority_effect: narrow-only
  conflict_policy: fail_closed
```

Predicates use the same normalized feature operators as selection. The normative v1 mappings are:

| Rule ID | Trigger | Required companion patterns |
|---|---|---|
| `companion.mutation` | Any `implement` or `change` mutation | Always `governance.evidence.validate` and `governance.documentation.validate`; choose exactly one applicable validation track per mutated artifact class: code/runtime -> `qa.regression.validate`, design -> `ux.visual.validate`, content/media -> `content.review.validate`, research -> `research.reproducibility.validate`, data -> `data.quality.assess`, AI -> `ai.evaluation.validate`, process/SOP -> `support.service.validate` |
| `companion.user-visible` | User-visible behavior, content, or publication | Product behavior -> `product.acceptance.validate`; content -> `content.review.validate`; research publication -> `research.finding.validate`; add `data.instrumentation.validate` only when measurement is required and `release.notes.change` only when released behavior changes |
| `companion.ui` | UI, interaction, or visual-surface changes | `ux.design-system.assess`, `qa.accessibility.validate`, `ux.localization.validate`, `qa.visual.validate` |
| `companion.identity-security` | Authentication, authorization, permission, or secret changes | `security.auth.assess`, `security.authorization.assess`, `security.secrets.assess`; require the applicable approval record before mutation |
| `companion.personal-data` | Personal data, tracking, consent, or retention impact | `security.privacy.assess`, `security.consent.assess`, `data.instrumentation.validate` |
| `companion.commerce` | Payments, rewards, pricing, orders, or entitlements | `commerce.entitlement.validate`, `commerce.reconciliation.validate`, `commerce.fraud.assess`, `commerce.policy.validate`, `support.service.validate`, `data.instrumentation.validate` |
| `companion.contract-change` | API, schema, storage, or serialized-format change | `qa.compatibility.validate`, `engineering.migration.plan`, `release.rollback.plan`, `qa.integration.validate`, `governance.documentation.validate` |
| `companion.supply-chain` | Dependency, platform, build-tool, or runtime change | `security.supply-chain.assess`, `qa.compatibility.validate`, `release.build.validate` |
| `companion.campaign` | Campaign or launch communication | `content.review.validate`, `growth.measurement.design`; add engineering/release patterns only when resolved in-product paths or instrumentation are affected |
| `companion.ai` | Model, prompt, retrieval, tool, or AI-serving change | `ai.evaluation.validate`, `ai.safety.assess`, `security.privacy.assess`, `ai.cost.assess`, `ai.latency.assess`, `ai.monitoring.operate` |
| `companion.game-system` | Mechanic, economy, progression, balance, or multiplayer change | `game.balance.assess`, `game.telemetry.validate`, `game.playtest.validate`, `game.save.validate`; add `game.anti-cheat.assess` for competitive or valuable state |
| `companion.production-release` | Production deployment, store release, or public launch | `release.rollback.plan`, `release.monitor.operate`, `release.communication.release`, `support.service.validate` |
| `companion.retirement` | Deprecation, removal, or retirement | Always `governance.context.assess` and `governance.archive.operate`; add `engineering.migration.plan` only for technical/data consumers and `release.communication.release` only when an affected audience must be notified |

Every alternative is resolved by catalog predicates over root kind, component type, artifact type, overlays, and affected paths. For each affected component/artifact class, exactly one validation track is required. Distinct classes may require distinct tracks; zero or several matches for the same class fail closed for integrator review.

Companion expansion uses deterministic fixed-point closure:

1. Begin with the selected primary pattern set in stable ID order.
2. Evaluate applicable companion rules and add exact locked pattern versions with rule-provenance links.
3. Deduplicate identical ID/version pairs and repeat until no new patterns appear.
4. A repeated ID at the same version is harmless; a version conflict, incompatible pair, or authority-expanding cycle fails closed.
5. Catalog validation rejects non-terminating rule graphs. Runtime expansion also maintains a visited set and maximum defined expansion count.
6. Meta patterns such as `governance.evidence.validate`, `governance.documentation.validate`, `release.notes.change`, and `governance.archive.operate` set `triggers_companions: false` unless an explicit allowlisted rule says otherwise.
7. The final set is sorted by family, object, mode, and version before task coverage is generated.

A companion may add inspection, validation, records, evidence, or a stricter approval requirement. It cannot grant a new write scope, mutation, release, notification, or external action. Incompatible companions fail closed and cause workstream decomposition or integrator review.

## 11. Automatic selection

Initial root setup occurs once:

1. The lead inspects the repository, brief, enduring value proposition, owners, lifecycle, and existing documentation.
2. The selector recommends a root, blueprint, overlays, components, domains, and adapters with supporting signals.
3. Pitaji confirms the initial root profile.
4. The compiler materializes the repository structure and resolved lock.
5. Validation must pass before normal work begins.

Routine work then follows the process below.

The user describes the outcome normally. The system:

1. Reads `PROJECT_CONTEXT.md` and the locked profile.
2. Never reclassifies an existing root because of a task prompt.
3. Extracts outcomes, verbs, objects, surfaces, exclusions, and risks.
4. Maps verbs to modes.
5. Selects one primary pattern per independent outcome.
6. Adds mandatory companion patterns.
7. Expands affected components through declared dependencies.
8. Creates an optional initiative when several outcomes serve one broader intent.
9. Creates one finite workstream per coherent outcome.
10. Splits each workstream into bounded task packets.
11. Assigns claims and authority.
12. Flattens and validates each packet before work.

### Workstream-to-task pattern ownership

`WORKSTREAM.md` owns the canonical outcome pattern set:

```yaml
pattern_set:
  outcome_primary:
    id: <pattern-id>
    version: <semver>
  companions:
    - id: <pattern-id>
      version: <semver>
      provenance_rule_ids: []
  coverage:
    - requirement_id: <duty-gate-evidence-or-output-id>
      task_ids: []
      exclusive: true | false
```

A task packet's primary pattern is an execution pattern derived from this locked workstream set; it may be the outcome-primary pattern or one companion assigned as a dedicated task. No task invents or independently selects a pattern. Before dispatch, the validator proves that the union of task packets covers every workstream duty, gate, evidence item, output, record update, and approval dependency. Mutating and external duties must have exactly one owner. Read/validation overlap requires an explicit coordination ID. Unassigned, unauthorized, or accidentally duplicated coverage fails closed.

Changing an active workstream's pattern set requires re-selection, a resolved diff, and the authority required by the changed scope or direction.

Mode mapping:

- Check/review/audit -> `assess`.
- Plan/prepare -> `plan`.
- Design/redesign -> `design`.
- Build/add/fix/refactor -> `implement`.
- Update/configure -> `change`.
- Test/verify -> `validate`.
- Deploy/publish/launch -> `release`.
- Monitor/run -> `operate`.
- Remove/deprecate/sunset -> `retire`.

### Deterministic decomposition and impact merge

A request is split before patterns are composed. Separate workstreams are required when clauses have different terminal acceptance criteria, primary modes across `assess`/`design`/`implement`/`release`, approval authorities, rollback or release fate, or the ability to complete independently. Thus “audit, redesign, and implement” becomes three dependent sibling workstreams under one initiative. Tasks remain in one workstream only when they jointly satisfy one outcome, one authority boundary, and one final acceptance.

Pattern and overlay impacts merge fail-closed:

1. Apply immutable rules, root policy, and overlays before pattern defaults.
2. A resolved `not_applicable` is a hard exclusion. Conflict with `required` is an error for integrator review; it is never silently overridden.
3. Without an exclusion, `required` outranks `conditional`.
4. Inspection, validation, evidence, and record duties union across compatible impacts.
5. `no-touch` conflicting with mutation, release, or notification is an error.
6. Effective write scope is the intersection of the pattern scope, component-owned paths, and task claim, further narrowed by any applicable accepted-decision or approval scope. An absent non-required decision/approval scope is universal, not empty; a missing required approval fails closed. An empty final intersection means no mutation.
7. The strictest responsible role and authority requirement wins.
8. Dependency expansion uses a visited set. Cycles are collapsed for inspection/validation, but mutation across a cycle requires explicit per-component paths and coordinated claims.
9. Incompatible primary or companion patterns cause workstream decomposition; if they cannot be separated, selection stops for integrator review.

### Deterministic scoring and ambiguity handling

Selection runs on one normalized feature map. Every feature contains a stable feature ID, typed value, source location, extraction-rule version, and evidence reference. Allowed predicate operators are `equals`, `in`, `contains_token`, `path_exists`, `record_exists`, `tag_present`, `relationship_exists`, and anchored `regex`. A model-inferred semantic feature must preserve the exact source text and classifier version; inconsistent extraction forces integrator review.

Each signal entry contains `id`, `feature`, `operator`, `expected`, and `evidence_required`. Positive entries also contain integer `weight` from `1-100`; negative entries contain integer `penalty` from `1-100`. Required signals and exclusions are unweighted Boolean gates.

Selection is executable and deterministic:

1. Reject `retired` candidates. A `deprecated` candidate is eligible only for an already locked root or an explicit migration; new selection considers `active` candidates only.
2. Reject candidates outside their declared root-kind, archetype, overlay, and profile compatibility.
3. Reject candidates with a missing required signal or a matched exclusion.
4. Compute `raw = max(0, sum(matched positive weights) - sum(matched negative penalties))`.
5. Require `max_positive_weight` to equal the sum of all positive weights and be greater than zero.
6. Compute `score = round(100 * raw / max_positive_weight)`, capped at `100`.
7. The runner-up is the next-highest eligible score; `margin = winner_score - runner_up_score`. With no runner-up, margin is `100`.
8. Equal scores resolve by higher explicit `specificity_rank`, enabled-profile exact match, higher declared `precedence`, then the candidate granting the least mutation/external authority.
9. A remaining tie or incompatible companion set fails closed for integrator review; workers never improvise.

Confidence bands:

- Score `>= 80` with margin `>= 15`: select automatically.
- Score `60-79`, or any margin below `15`: integrator review.
- Score below `60`: no supported match; ask at most one focused clarification question or create a proposed local extension.

The same algorithm governs initial blueprint selection and routine pattern selection. Initial root selection still requires Pitaji's one-time confirmation regardless of score. A conservative superset may add inspection or validation, never mutation or external-action authority.

## 12. Repository architecture

```text
/
├── PROJECT_CONTEXT.md
├── [AGENTS.md]                    # only if Codex is selected
├── [CLAUDE.md]                    # only if Claude Code is selected
├── docs/project-memory/
│   ├── PROTOCOL.md
│   ├── project.yaml
│   ├── profile.lock.yaml
│   ├── catalog.lock.json
│   ├── source/
│   │   ├── PROJECT.md
│   │   ├── CONSTRAINTS.md
│   │   ├── POLICIES.md
│   │   └── blueprint-specific canonical documents
│   ├── components/<component-id>/COMPONENT.md
│   ├── domains/<domain-id>/DOMAIN.md
│   ├── initiatives/<initiative-id>/INITIATIVE.md
│   ├── workstreams/<workstream-id>/
│   │   ├── WORKSTREAM.md
│   │   └── tasks/<task-id>.md
│   ├── records/
│   │   ├── decisions/
│   │   ├── ideas/
│   │   ├── changes/
│   │   ├── findings/
│   │   ├── risks/
│   │   ├── evidence/
│   │   ├── lessons/
│   │   └── approvals/
│   ├── governance/
│   │   ├── claims/
│   │   ├── integration/
│   │   └── migrations/
│   ├── catalog/
│   │   ├── selected/
│   │   └── proposals/
│   ├── views/
│   │   ├── NOW.md
│   │   ├── HANDOFF.md
│   │   ├── WORKSTREAMS.md
│   │   ├── CHANGELOG.md
│   │   ├── HISTORY.md
│   │   └── INDEX.json
│   └── archive/
│       ├── sessions/
│       ├── transcripts/
│       ├── snapshots/
│       └── retired/
├── schemas/project-memory/
└── tools/project-memory/
```

Workstream paths remain stable; status changes do not move folders.

Startup read order:

1. `PROJECT_CONTEXT.md`.
2. `profile.lock.yaml`.
3. `views/NOW.md`.
4. Assigned workstream/task packet.
5. Named component/domain documents.
6. Linked canonical records.
7. Archive only for historical investigation.

## 13. Canonical ownership and records

| Fact class | Canonical home |
|---|---|
| Stable root ID and accepted profile classification | `project.yaml` |
| Root name, mission, ownership, success criteria, and scope | `source/PROJECT.md` |
| Accepted requirements | Blueprint-specific source document such as `PRD.md` |
| Constraints and policies | `source/CONSTRAINTS.md` and `POLICIES.md` |
| Component boundary/state | Component record |
| Initiative intent/sibling relationships | `INITIATIVE.md` |
| Workstream objective/status | `WORKSTREAM.md` |
| Agent assignment/progress | Task packet |
| Accepted choice/rationale | Decision record |
| Proposed/deferred/rejected concept | Idea record |
| Discovered issue | Finding record |
| Actual modification | Change record |
| Proof/test result | Evidence record |
| Exposure/uncertainty | Risk record |
| Human authorization | Approval record |
| Evidence-backed improvement | Lesson record |
| Current summary | Generated `NOW.md` |
| Changelog/timeline | Generated views |
| Session/transcript history | Archive packet |

Catalog definition IDs use lowercase dot-separated identifiers matching `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`. They are versioned definitions, not project instances.

Root-specific instances use a type prefix plus UUIDv7 or ULID: `ROOT-`, `CMP-`, `DOM-`, `INIT-`, `WS-`, `TASK-`, `CLAIM-`, `PKT-`, `DEC-`, `IDEA-`, `CHG-`, `FIND-`, `RISK-`, `EVD-`, `LESSON-`, and `APR-`. Human-readable slugs and aliases are separate mutable fields and never substitute for an instance ID.

Every record includes ID/type, title/status, root/component/initiative/workstream/task references, timestamps, actor, authority class, relationships/supersession, original base revision, integration base revision where applicable, and catalog versions.

### Flattened task-packet contract

Workers receive a fully flattened packet. They do not resolve blueprint inheritance, consult the catalog, infer duties, or invent authority during execution.

```yaml
task_packet:
  schema_version: <semver>
  packet_id: PKT-<ULID>
  root:
    id: ROOT-<ULID>
    profile_lock_hash: <hash>
    catalog_release: <semver>
    catalog_hash: <hash>
  initiative_id: <INIT-id-or-null>
  workstream_id: WS-<ULID>
  task_id: TASK-<ULID>
  assignment:
    assignee_id: <actor-id>
    issued_by: <actor-id>
    issued_at: <timestamp>
  patterns:
    primary:
      id: <pattern-id>
      version: <semver>
    companions:
      - id: <pattern-id>
        version: <semver>
  selector:
    score: <0-100>
    runner_up_score: <0-100-or-null>
    margin: <0-100>
    matched_signal_ids: []
    evidence_ids: []
  goal: <one-verifiable-outcome>
  scope:
    inclusions: []
    exclusions: []
  resolved_inputs:
    record_ids: []
    artifact_refs: []
    original_base_revision: <commit-or-content-revision>
  component_duties:
    - component_id: CMP-<ULID>
      duties: []
      requirement: required
      reason: <resolved-reason>
      read_scope: []
      write_scope: []
      responsible_role: <role>
      resolution:
        source_impact_ids: []
        predicate_ids: []
        result: true
        evidence_ids: []
        evaluated_by: <actor-or-validator>
        evaluated_at: <timestamp>
  domain_duties:
    - domain_id: DOM-<ULID>
      duties: []
      requirement: required
      reason: <resolved-reason>
      write_scope: []
      required_records: []
      responsible_role: <role>
      resolution:
        source_impact_ids: []
        predicate_ids: []
        result: true
        evidence_ids: []
        evaluated_by: <actor-or-validator>
        evaluated_at: <timestamp>
  claim:
    id: CLAIM-<ULID>
    issuer: <actor-id>
    assignee_id: <actor-id>
    base_revision: <commit-or-content-revision>
    issued_at: <timestamp>
    expires_at: <timestamp>
    heartbeat_interval: <duration>
    last_heartbeat_at: <timestamp>
    renewal_policy: <policy-id>
    status: active
    components: []
    repositories: []
    paths: []
    duties: []
    required_evidence: []
    coordination_exception_approval_id: null
  decisions:
    accepted_record_ids: []
    proposed_record_ids: []
  authorization:
    mutation: none | task-scoped | approval-required
    task_result_submission: worker
    factual_integration: integrator
    workstream_activation: automatic-by-rule | integrator | Pitaji
    directional_acceptance: Pitaji
    external_action:
      allowed: false
      approval_ids: []
      target: null
      environment: null
      scope: []
      timing: null
  approvals:
    - id: APR-<ULID>
      kind: <approval-kind>
      granted_by: <actor-id>
      issued_at: <timestamp>
      expires_at: <timestamp-or-null>
      target: <target-or-null>
      environment: <environment-or-null>
      scope: []
      timing: <window-or-null>
      invalidation_conditions: []
  required_outputs: []
  required_evidence: []
  gates:
    - id: <gate-id>
      type: <test | lint | build | review | policy | render | external>
      command_or_check: <exact-instruction>
      required: true
      conflict_sensitive: true
      evidence_type: <evidence-type>
  memory_updates:
    create_record_types: []
    update_record_ids: []
  completion_conditions: []
  fallback_and_escalation:
    triggers: []
    owner: <integrator-or-Pitaji>
    allowed_fallbacks: []
```

The packet is invalid if any component/domain duty, claimed path, output, evidence item, gate, record update, authority boundary, accepted decision, approval scope, or escalation trigger remains implicit. A worker may submit results but may never accept canonical directional state.

Conditional and `not_applicable` catalog impacts are resolved before packet creation. Only true, required duties enter a worker packet. False conditions and exclusions remain in the selector trace. An unresolved predicate, missing evidence, or multiple applicable alternatives makes the packet invalid.

Claim expiry fails closed. The worker stops mutation, preserves its isolated branch, marks the task `blocked_claim_expired`, and either submits a partial completion packet or requests renewal. Only the issuer may renew, and only after checking the latest base, unchanged scope, conflicts, and approvals. Changed scope requires a new claim. Any overlapping-write exception requires a linked approval record and explicit coordination plan.

### Completion-packet contract

```yaml
completion_packet:
  schema_version: <semver>
  packet_id: PKT-<ULID>
  task_id: TASK-<ULID>
  workstream_id: WS-<ULID>
  claim_id: CLAIM-<ULID>
  actor: <actor-id>
  submitted_at: <timestamp>
  original_base_revision: <revision>
  worker_head_revision: <revision>
  scope_performed: []
  scope_not_completed: []
  changes:
    - change_id: CHG-<ULID>
      authorization_refs: []
      files: []
      commits: []
      artifacts: []
      rationale: <why>
  proposed_decision_ids: []
  checks:
    - gate_id: <gate-id>
      command_or_check: <exact-value>
      status: passed | failed | not_run
      exact_result: <result>
      evidence_id: EVD-<ULID-or-null>
      not_run_reason: <reason-or-null>
  records_created: []
  records_updated: []
  outputs: []
  remaining_risk_ids: []
  next_action: <action-or-null>
  worker_attestation: <scope-and-honesty-attestation>
```

A completion packet describes what happened; it does not grant integration or acceptance. Missing, failed, stale, or not-run required gates prevent `integrated_verified` unless the governing policy explicitly allows a recorded exception approved by the proper authority.

## 14. Workstream, task, and completion lifecycle

Workstream:

```text
proposed -> approved/auto-accepted -> active -> integrating -> completed
```

Additional states are `paused`, `blocked`, `cancelled`, and `superseded`.

The selected patterns determine whether a proposed workstream is auto-accepted, accepted by the integrator, or requires Pitaji's approval.

Task:

```text
draft -> claimed -> in_progress -> ready_for_integration -> integration_validated -> integrated_verified
```

Additional states are `returned`, `blocked`, `blocked_claim_expired`, `cancelled`, and `superseded`.

`integration_validated` means the completion packet, claim, approvals, current-base evidence, and every required gate have passed without changing canonical state. The single canonical integration commit then applies the implementation and memory records, regenerates views, and marks the task `integrated_verified` atomically. There is no ordinary `integrated-but-unverified` state. Post-deployment monitoring is a separate operate/validate task when required.

Without a valid completion packet, work is not finalized.

## 15. Concurrent-agent protocol

1. The lead creates canonical task packets and claims before dispatch.
2. Each claim uses the flattened claim contract, including issuer, assignee, base, exact paths/duties, evidence, issue/expiry times, heartbeat, renewal policy, and any coordination approval.
3. Workers use isolated branches/worktrees.
4. Overlapping reads are allowed.
5. Overlapping writes are rejected unless explicitly coordinated.
6. Workers append task-local records/evidence in their branches.
7. Workers may propose decisions but cannot accept them.
8. Workers never edit generated views.
9. One integrator holds the canonical integration lease.
10. The integrator checks latest revision, conflicts, evidence, approvals, companion rules, and documentation.
11. Packets are integrated sequentially.
12. Canonical records update once and views regenerate.
13. Failed integration leaves canonical state unchanged.

Stale claims, expired claims, stale bases, overlapping scopes, missing evidence, or missing approval prevent integration.

### Stale-base reconciliation

The integrator never accepts a stale packet merely because its patch applies cleanly:

1. Record the worker's original base revision.
2. Rebase or replay the packet onto the latest integration head in isolated space.
3. Set and record the integration base revision.
4. Rerun every conflict-sensitive test, validator, generated artifact, and evidence check.
5. Carry unaffected evidence forward only with its original provenance and an explicit applicability statement.
6. Return the packet to the worker when a semantic conflict changes intent, scope, accepted decisions, behavior, or evidence validity.
7. Integrate only after all current-base gates pass.

### Integration-lease protocol

There is at most one active integration lease per canonical memory hub.

- Acquisition is atomic against the latest hub revision.
- The lease records holder, authority, acquired time, expiry time, heartbeat, and base revision.
- Only the holder may renew it, and renewal fails if the holder is stale or a valid takeover is pending.
- Expiry fails closed: no canonical write is allowed until a new lease is acquired.
- Crash recovery or takeover requires approval from Pitaji or the repository-designated human integration owner and creates an immutable audit record containing the old holder, new holder, reason, timestamps, and observed base.
- After validation, the integrator promotes implementation records, canonical memory updates, and regenerated views in one atomic hub commit; satellite commits, when present, are immutable inputs referenced by that commit.
- Any failed gate or write leaves the prior canonical state unchanged and releases or expires the lease according to policy.

## 16. Authority

### Strictest-authority-wins precedence

When instructions differ, the strictest applicable rule wins in this order:

1. Immutable safety and governing core instructions.
2. Accepted root policy, constraints, and activated overlays.
3. Accepted decisions and recorded approvals.
4. Pattern definitions and flattened task-packet grants.
5. Agent inference.

Lower layers may narrow authority but cannot expand a higher layer. Silence is never a grant of mutation, acceptance, deletion, or external-action authority.

### Object-specific authority matrix

| Object or action | Worker | Integrator | Pitaji |
|---|---|---|---|
| Task result | Submit an evidence-backed completion packet | Validate and integrate | Not required unless an exception changes direction |
| Factual record/evidence | Create task-local facts and proposals | Accept verified facts into canonical truth | May correct or override |
| Authorized routine implementation/remediation | Modify only within the active claim and accepted decisions | Integrate after all current-base gates pass | Required only when a higher-authority category is crossed |
| Workstream activation | Never accept | Apply an explicit automatic rule or accept factual/routine work | Accept directional work |
| Directional decision, PRD, architecture, policy, or business rule | Propose only | Validate and route; never self-accept | Accept or reject |
| Profile/root selection | Report observations and drift | Record drift; never change accepted selection unilaterally | Accept or reject selection changes |
| Canonical catalog definition | Propose local extension | Maintainer may promote compatible non-authority patches | Required for authority/classification changes |
| External action | Execute only with a valid scoped approval | Verify and record approval/execution | Grant or revoke approval |

A worker may attest that its task result is complete. That attestation is not integration, workstream acceptance, decision acceptance, profile acceptance, or external-action approval. Workers never accept canonical directional state.

### Factual updates versus directional changes

The integrator may accept these factual updates after evidence and gates pass:

Changes outside the packet's authority are preserved only as proposed or rejected branch evidence; the fact that code was written does not make it accepted implementation.

- Commands run and their exact results.
- Actual files, commits, artifacts, and implementation changes already authorized by the active claim, packet, and accepted decisions.
- Test, lint, build, validation, and not-run status.
- Evidence-supported task transitions and workstream transitions permitted by the selected authority rule.
- Routine in-scope remediation already authorized by the task packet and accepted decisions.
- Discovery of an already-existing component, dependency, owner, path, or revision, recorded as observed state without changing the accepted profile.
- Generated-view refreshes from unchanged canonical sources.
- Architecture or product documentation synchronized to an already-approved, actually implemented state.

These are directional and require Pitaji:

- Mission, root identity, accepted scope, PRD, roadmap, or success-criteria changes.
- New architecture direction rather than documentation of accepted implementation.
- Authentication, authorization, security, privacy, or data-governance direction.
- Pricing, rewards, monetization, entitlement, or business-rule changes.
- Planned component addition, removal, replacement, deprecation, or retirement.
- Root kind, archetype, blueprint, overlay, profile, or authority changes.
- Acceptance or rejection of a directional proposal or consequential tradeoff. Finding remediation is directional only when it changes scope, architecture, security/privacy policy, business rules, profile, or another higher-authority category.
- Any production release, publication, deployment, communication, purchase, or other external action.

Workers may inspect, record facts, update task-local progress, produce evidence, propose findings/decisions/remediation, and modify accepted in-scope implementation when authorized.

The integrator may validate and integrate factual work, close tasks/workstreams under their authority rules, update observed component state from evidence, and regenerate views.

Pitaji approval is required for:

- Root identity, archetype, mission, accepted scope, or PRD direction.
- Breaking architecture, API, or schema changes.
- Lasting new dependencies.
- Authentication, authorization, or security direction.
- Pricing, rewards, monetization, or major business rules.
- Production infrastructure.
- Destructive deletion.
- Consequential external publication, deployment, release, or communication.
- Major catalog changes affecting authority or required structure.

Catalog maintainers may promote compatible, tested definitions. Authority/classification changes require applicable higher approval.

### Profile evolution

Observed reality and accepted profile intent remain separate:

- Evidence that an existing component was omitted may create or update a component record with status `observed_unclassified` and a linked profile-drift finding. This is factual and does not edit `project.yaml` or either lock.
- If the observation maps to an already selected component definition without changing requirements, authority, gates, or intended architecture, the integrator may link it to that definition as a factual correction.
- Until mapped, an observed-unclassified component may be inspected and validated but receives no implicit mutation authority.
- Adding a new intended component definition, removing/replacing/retiring one, changing overlays, changing a root boundary, or changing authority is directional and requires Pitaji.
- Every accepted profile evolution updates `project.yaml` first, resolves vendored inputs, regenerates locks, validates the migration, and records approval. No agent edits a lock to make a discovery appear accepted.

### External-action approval

A direct instruction from Pitaji counts as external-action approval only when it identifies the target, environment, scope, and timing clearly enough to execute safely. The integrator records it as an approval record linked to the task. It expires at its stated limit and is invalidated by material scope, target, environment, risk, or timing drift.

## 17. Generated views and archive

Generated views:

- `NOW.md`: accepted current state, active workstreams, blockers, next actions.
- `HANDOFF.md`: concise continuation packet.
- `WORKSTREAMS.md`: status index.
- `CHANGELOG.md`: validated changes/releases.
- `HISTORY.md`: completed-work timeline.
- `INDEX.json`: machine-readable relationship graph.

Each includes profile/catalog version, source revision, generation timestamp, source list/hash, and generated/do-not-edit marker. Validation rejects manual edits and stale views.

The archive stores session completion packets, optional transcript exports/links, meaningful milestone snapshots, retired documents, and superseded catalog selections.

It is append-only, content-addressed, redacted, indexed, and never current truth. Active documents cannot depend on archive-only content. Corrections create addenda or superseding records.

## 18. Multi-repository and portfolio handling

One root across multiple repositories uses one canonical memory-hub repository.

Cross-repository finalization is two-phase because separate Git repositories cannot share one atomic commit:

1. Each satellite produces an immutable validated commit and completion packet. Its state is `prepared`, not canonical root completion.
2. The hub integrator verifies exact satellite commit hashes, current-base compatibility, evidence, claims, approvals, and gates.
3. One atomic hub finalization commit records those immutable satellite hashes, integrates canonical memory, regenerates views, and marks the tasks `integrated_verified`.
4. If hub finalization fails, satellite commits remain prepared and unfinalized. They are never rewritten; corrections use new commits and packets.

Satellites store root ID, component ID, hub location, last-seen hub revision, preparation state, and local task/evidence references. Cross-repository work is finalized only by the referencing hub commit.

Multiple roots in one monorepo use separate namespaces under a portfolio index.

Shared platforms own their truth; consumers reference contracts and dependencies.

Surfaces remain one root when they share value proposition, authority, owner, roadmap, release fate, and history. A child root normally requires an independent value proposition, roadmap, and release/sunset lifecycle. A child root is mandatory even with shared branding when legal, regulatory, contractual, security, or data-isolation requirements demand separate authority or lifecycle.

## 19. Catalog distribution, versioning, and extension

The master catalog is a tool-neutral versioned Git repository. It may be distributed through skills/plugins, but selected definitions are vendored into root repositories.

Semantic Versioning:

- Patch: wording/examples/template/validator correction without structural change.
- Minor: backward-compatible optional component, overlay, or rule.
- Major: required component, semantics, authority, selection boundary, or folder-contract change.

Exact versions/hashes are locked. Roots never upgrade silently. Upgrades generate resolved diffs and migration reports. Deprecated versions remain resolvable with replacement and migration paths. Historical records keep original catalog versions.

Before adding a blueprint, classify the proposal:

- Different tool/framework -> adapter.
- Optional lasting subsystem -> component.
- Cross-cutting condition/risk -> overlay.
- Finite outcome/procedure -> work pattern.
- Materially different enduring root operating model -> blueprint.

A new blueprint requires a distinct selection boundary, materially different defaults, at least three verified examples or one critical regulated case, and golden tests showing no unacceptable ambiguity.

Workers may propose `x-local-*` extensions. Only the catalog maintainer may promote them.

## 20. Validation and failure behavior

Validators check schema, UTF-8, ID uniqueness, references, canonical ownership, locks/hashes, catalog compatibility, required documents, companion patterns, claim conflicts/expiry, base freshness, authorization, approvals, evidence/not-run statements, view freshness, archive immutability, migrations, external-action gates, and secret/sensitive-data leakage.

Validators must never decide direction, approve proposals, silently repair truth, convert assessment into remediation, or expand mutation/external authority.

Failure behavior:

- Ambiguity -> lead reviews candidates.
- Missing lock -> read-only orientation until setup.
- Stale base -> follow stale-base reconciliation; record both bases and rerun conflict-sensitive evidence.
- Claim conflict -> reassign or coordinate.
- Missing evidence -> remain unverified.
- Tests unavailable -> record exactly what was not run and why.
- Integration failure -> canonical state unchanged.
- Protocol ignored -> work not finalized.
- Partial work -> preserve completion packet and next action.

## 21. Testing and measurable coverage

Maintain at least 150 realistic golden briefs covering all blueprint groups. Each brief declares expected root, blueprint, components, domains, overlays, patterns, authorization, evidence, and gates.

Acceptance:

- At least 98% resolve correctly without schema invention.
- No more than one clarification question for supported briefs.
- Target 99% after pilots.
- Include lower-reasoning agents, not only top models.

Catalog contract tests require:

- Exactly 62 unique v1 blueprint IDs matching the catalog-ID grammar, distributed across the 11 declared groups.
- Every blueprint to declare group, root-kind, archetype, overlay, component, domain, signal, and gate mappings.
- Exactly 257 unique v1 pattern IDs matching `<family>.<object>.<mode>`, using only the nine allowed modes.
- Every selectable pattern and companion rule to have a complete definition, deterministic signals, authorization, evidence, gates, and positive/negative fixtures.
- No incomplete, deprecated-for-new-selection, retired, incompatible, or authority-invalid definition to become enabled.

Additional tests cover profile compilation, positive/negative pattern examples, corrupt fixtures, claim collisions and expiry, stale bases, lease takeover, compound-request decomposition, impact conflicts/cycles, migrations, archive immutability, multi-repository integration, worker non-acceptance, authority enforcement, view freshness, and exact target-surface verification for visual deliverables.

## 22. Examples

### LifeOf referral launch

One LifeOf initiative groups dependent workstreams for growth planning, UX design, Flutter/Firebase implementation, fraud/privacy assessment, regression and visual validation, and release operations. Each workstream keeps one outcome and authority boundary.

### LifeOf purchase restructure plus security check

Sibling workstreams cover refactoring, security assessment, regression validation, and documentation synchronization. Their task packets stay bounded. Findings propose remediation; the assessment does not authorize out-of-scope fixes.

### LifeOf Settings UX audit/redesign

A UX-assessment workstream precedes a design workstream. Implementation becomes another dependent workstream only when explicitly requested and authorized.

### External-only campaign

Brand/content and measurement activate. Flutter/Firebase work is added only if an in-product surface or instrumentation is required.

### Dino Escape

A game/interactive blueprint uses mobile/multiplayer traits and components for Unity runtime, mechanics, levels, multiplayer, art/audio, telemetry, playtesting, and release. Campaigns and audits remain Dino Escape workstreams.

### Research

A maintained intelligence corpus may be an independent root. A LifeOf competitor study remains a LifeOf workstream.

## 23. Risks and safeguards

| Risk | Safeguard |
|---|---|
| Profile explosion | Blueprint/component/overlay/adapter/pattern classification |
| Lower agents cannot resolve inheritance | Materialized locks and flattened task packets |
| Current docs drift | Generated views with hashes |
| Concurrent overwrite | Precommitted claims, isolated work, one integration lease |
| Worker changes direction | Proposed-only decisions and authority validation |
| Audit becomes fix | Separate assess/change modes |
| Silent catalog drift | Exact locks and explicit migrations |
| Multiple repositories compete | One memory hub |
| Archive becomes junk | Redacted, indexed, append-only packets |
| Context becomes too large | Fixed startup read order |
| Tool ignores rules | Integration rejects missing completion packets |

## 24. Rollout after written-spec approval

1. Create the implementation plan.
2. Build catalog structure and schemas.
3. Implement compiler, selector, and validator.
4. Materialize the 62 root-profile presets.
5. Materialize all 257 normative v1 work-pattern definitions, contracts, selector rules, and golden tests.
6. Pilot LifeOf.
7. Pilot game extensions with Dino Escape.
8. Import existing PRDs, decision logs, worklogs, and handoffs.
9. Preserve originals in the archive.
10. Generate current views.
11. Run the golden suite.
12. Expand from evidence.

## 25. Acceptance criteria

The implementation is acceptable when:

- An incoming agent finds accepted context through one fixed doorway.
- It can identify completed, active, proposed, rejected, removed, superseded, and next work.
- Routine work does not require user folder/profile/pattern selection.
- All 62 blueprint definitions and all 257 work-pattern definitions are materialized, versioned, and contract-tested.
- At least 98% of supported briefs resolve correctly.
- Lower-reasoning agents operate from explicit flattened packets and never invent missing pattern contracts.
- Root versus workstream classification follows the deterministic boundary test.
- Each fact has one canonical home.
- Workers cannot silently overwrite accepted truth.
- Direction cannot be accepted without Pitaji.
- Every verified task has evidence.
- Generated views remain consistent.
- Roots never receive silent catalog upgrades.
- Historical decisions, ideas, findings, and changes remain discoverable.
- Work that ignores the protocol cannot be treated as finalized.

## 26. Implementation details intentionally deferred

The implementation plan will choose the compiler/validator language, concrete schema library, catalog repository name, distribution method, command names, CI integration, and migration tooling.

These choices do not change the approved architecture and remain gated behind written-specification review.
