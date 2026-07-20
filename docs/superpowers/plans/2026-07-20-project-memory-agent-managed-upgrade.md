# Project Memory Agent-Managed Repository Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any supported agent upgrade a compatible initialized Project Memory repository from repository contract `1.0.0` to `1.1.0` after one confirmation, without changing pre-existing canonical memory or application code.

**Architecture:** Add a repository-contract marker and one registered forward migration, then compose a repository-scope plan from the existing migration transform, current renderers, canonical snapshot, persistent proposal store, and `IntegrationCoordinator`. Startup detects the pre-marker contract read-only, the host retains an exact expiring proposal, and the dedicated MCP upgrade apply mode replans before one coordinator-owned mutation and verified resume.

**Tech Stack:** TypeScript 6, Node.js 24, TypeBox/Ajv, Vitest 4, Git plumbing, existing local stdio MCP bundle.

## Global Constraints

- The current repository contract is exactly `1.1.0`; absence of the marker is the supported pre-marker `1.0.0` contract only after authoritative validation.
- Keep every pre-existing canonical source, record, history, profile lock, catalog lock, vendored catalog file, archive object, and application file byte-for-byte.
- Add only the contract marker, regenerated `PROJECT_CONTEXT.md`, six generated views, one repository-upgrade migration record, and the coordinator's standard integration audit.
- Remove nothing.
- Require one explicit confirmation; never migrate silently.
- Preserve `require_clean_canonical_tree`; do not stash, commit user work, create user integration worktrees, or relax dirty-root policy.
- Recompute and compare repository identity, HEAD, contract versions, profile/catalog/source bindings, planned paths, preimages, and plan hash immediately before apply.
- All governed writes go through `IntegrationCoordinator.finalizeMutation`; no direct host, MCP, migration, or renderer writes.
- Work fully offline with no new dependency, hosted service, account, cloud sync, or Notion requirement.
- Do not change LifeOf or any other product repository during development or tests.
- Do not install, publish, push, or release this branch without separate approval.

---

## File Structure

- `src/version.ts` - package and repository-contract constants.
- `src/cli/config.ts` - strict current/pre-marker config parsing.
- `src/materialize/render-adapters.ts` - current bootstrap config renderer.
- `src/migrations/apply-path.ts` - one reusable, side-effect-free migration-path executor.
- `src/migrations/v1/project-memory-v1-1.ts` - the single `1.0.0 -> 1.1.0` transform for supported artifacts.
- `src/upgrades/contracts.ts` - repository-upgrade plan, metadata, summary, and verified-result types.
- `src/upgrades/plan-repository-upgrade.ts` - pure multi-artifact plan composition.
- `src/upgrades/node-repository-upgrade.ts` - local Git/filesystem compatibility inspection and replanning.
- `src/agent/contracts.ts`, `src/agent/start.ts`, `src/agent/node-dependencies.ts` - read-only startup detection and raw directive.
- `src/host/proposal-envelope.ts`, `src/host/project-memory-host.ts` - persistent proposal binding and one-confirmation host flow.
- `src/cli/node-composition.ts`, `src/host/index.ts` - trusted upgrade finalization and post-apply resume verification.
- `src/mcp/server.ts` - dedicated `upgrade` apply mode.
- `skills/project-memory/SKILL.md`, `skills/project-memory/references/agent-protocol.md` - lower-reasoning agent instructions.
- `tests/upgrades/**`, `tests/agent/**`, `tests/host/**`, `tests/mcp/**`, `tests/e2e/**`, `tests/plugin/**`, `tests/release/**` - focused, cross-process, preservation, and package coverage.

### Task 1: Establish the Repository Contract and Shared Migration Edge

**Files:**
- Modify: `plugins/project-memory/src/version.ts`
- Modify: `plugins/project-memory/src/cli/config.ts`
- Modify: `plugins/project-memory/src/materialize/render-adapters.ts`
- Modify: `plugins/project-memory/src/migrations/contracts.ts`
- Create: `plugins/project-memory/src/migrations/apply-path.ts`
- Create: `plugins/project-memory/src/migrations/v1/project-memory-v1-1.ts`
- Modify: `plugins/project-memory/src/migrations/v1/normalize-generated-metadata.ts`
- Modify: `plugins/project-memory/src/migrations/planner.ts`
- Modify: `plugins/project-memory/src/migrations/index.ts`
- Test: `plugins/project-memory/tests/cli/config.test.ts`
- Test: `plugins/project-memory/tests/materialize/adapters.test.ts`
- Test: `plugins/project-memory/tests/migrations/v1/project-memory-v1-1.test.ts`
- Test: `plugins/project-memory/tests/migrations/planner.test.ts`

**Interfaces:**
- Consumes: existing `MigrationRegistry.path`, `MigrationTransformInput`, `canonicalJson`, strict UTF-8/JSON parsing.
- Produces: `LEGACY_REPOSITORY_CONTRACT_VERSION`, `REPOSITORY_CONTRACT_VERSION`, optional `ToolConfig.repository_contract_version`, `projectMemoryV1_1Migration`, and `executeMigrationPath(registry, input)`.

- [ ] **Step 1: Write failing config and migration tests**

Add assertions that current bootstrap config includes the marker, pre-marker config still validates with `repository_contract_version === undefined`, unsupported values fail, LF and CRLF config bytes migrate to the same canonical JSON, and the existing profile-lock transform still behaves identically.

```ts
expect(renderedConfig).toMatchObject({
  schema_version: "1.0.0",
  repository_contract_version: "1.1.0",
});

expect(validateToolConfigDocument(preMarkerConfig)).toMatchObject({
  ok: true,
  value: { repository_contract_version: undefined },
});

expect(validateToolConfigDocument({
  ...preMarkerConfig,
  repository_contract_version: "2.0.0",
})).toMatchObject({ ok: false });

for (const newline of ["\n", "\r\n"]) {
  const bytes = new TextEncoder().encode(JSON.stringify(preMarkerConfig, null, 2)
    .replaceAll("\n", newline) + newline);
  const migrated = executeMigrationPath(registry, {
    artifact_kind: "tool-config",
    relative_path: "tools/project-memory/config.json",
    from_version: "1.0.0",
    to_version: "1.1.0",
    bytes,
    context: {},
  });
  expect(migrated).toMatchObject({ ok: true });
  if (migrated.ok) {
    expect(JSON.parse(new TextDecoder().decode(migrated.value.bytes)))
      .toMatchObject({ repository_contract_version: "1.1.0" });
  }
}
```

- [ ] **Step 2: Run the focused tests and verify the new contract is absent**

Run from `plugins/project-memory`:

```powershell
npm test -- tests/cli/config.test.ts tests/materialize/adapters.test.ts tests/migrations/v1/project-memory-v1-1.test.ts tests/migrations/planner.test.ts
```

Expected: FAIL because the repository-contract constants, config field, `tool-config` artifact kind, and shared path executor do not exist.

- [ ] **Step 3: Add constants, config compatibility, and current bootstrap output**

Add these constants to `src/version.ts`:

```ts
export const PACKAGE_VERSION = "0.1.1" as const;
export const LEGACY_REPOSITORY_CONTRACT_VERSION = "1.0.0" as const;
export const REPOSITORY_CONTRACT_VERSION = "1.1.0" as const;
```

Add the optional marker to `ToolConfigSchema` so a known pre-marker repository remains readable while any unknown value fails strict validation:

```ts
repository_contract_version: Type.Optional(
  Type.Literal(REPOSITORY_CONTRACT_VERSION),
),
```

Emit it for every new bootstrap in `renderConfig`:

```ts
const config = {
  schema_version: "1.0.0",
  repository_contract_version: REPOSITORY_CONTRACT_VERSION,
  root_id: profile.root.id,
  // retain the existing fields unchanged
};
```

- [ ] **Step 4: Extract one reusable migration-path executor**

Move the transform loop from `createMigrationService` into `src/migrations/apply-path.ts` with this exact public contract:

```ts
export interface ExecuteMigrationPathInput extends MigrationTransformInput {}

export interface ExecutedMigrationPath {
  readonly bytes: Uint8Array;
  readonly steps: readonly AppliedMigrationStep[];
  readonly authority_impact: "none" | "directional";
}

export function executeMigrationPath(
  registry: MigrationRegistry,
  input: ExecuteMigrationPathInput,
): RuntimeResult<ExecutedMigrationPath> {
  const path = registry.path(input.from_version, input.to_version);
  if (!path.ok) return path;
  if (path.value.some((item) => !item.affected_artifacts.includes(input.artifact_kind))) {
    return failure(
      "MIGRATION_ARTIFACT_UNSUPPORTED",
      "migration path does not support the requested artifact kind",
      input.artifact_kind,
    );
  }
  let bytes = new Uint8Array(input.bytes);
  const steps: AppliedMigrationStep[] = [];
  for (const definition of path.value) {
    const transformed = definition.transform({
      ...input,
      from_version: definition.from_version,
      to_version: definition.to_version,
      bytes: new Uint8Array(bytes),
    });
    if (!transformed.ok) return transformed;
    if (!(transformed.value.bytes instanceof Uint8Array)) {
      return failure("MIGRATION_OUTPUT_INVALID", "migration transform must return bytes", definition.id);
    }
    const output = new Uint8Array(transformed.value.bytes);
    steps.push({
      migration_id: definition.id,
      from_version: definition.from_version,
      to_version: definition.to_version,
      input_sha256: sha256(bytes),
      output_sha256: sha256(output),
      semantic_diff: transformed.value.semantic_diff,
    });
    bytes = output;
  }
  return success({
    bytes,
    steps,
    authority_impact: path.value.some((item) => item.authority_impact === "directional")
      ? "directional"
      : "none",
  });
}
```

Update `createMigrationService` to validate hashes/preimages/approval as it does now, call `executeMigrationPath`, and pass its bytes, steps, and authority impact to `buildMigrationMutationPlan`. This keeps the developer CLI and repository upgrade on one transform implementation.

- [ ] **Step 5: Register the combined `1.0.0 -> 1.1.0` transform**

Extract the current profile-lock transform body into this local function without changing its behavior:

```ts
function normalizeProfileMetadata(
  input: MigrationTransformInput,
): RuntimeResult<MigrationOutput> {
  const decoded = decodeStrictUtf8(input.bytes, input.relative_path);
  if (!decoded.ok) return decoded;
  if (NORMALIZED_HEADER.test(decoded.value)) {
    return success({ bytes: new Uint8Array(input.bytes), semantic_diff: [] });
  }
  const match = LEGACY_HEADER.exec(decoded.value);
  if (match === null) {
    return failure(
      "MIGRATION_METADATA_HEADER_MISSING",
      "profile lock has neither legacy nor normalized generated metadata",
      input.relative_path,
    );
  }
  const generatedAt = match[1] ?? "";
  const newline = match[2] ?? "\n";
  const normalized = decoded.value.replace(
    LEGACY_HEADER,
    `# generated_metadata: normalized${newline}`,
  );
  return success({
    bytes: new TextEncoder().encode(normalized),
    semantic_diff: [{
      path: "/generated_metadata",
      before: generatedAt,
      after: "normalized",
    }],
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

Add `"tool-config"` to `ArtifactKind`. Create `projectMemoryV1_1Migration` with ID `project-memory-v1-1`, affected artifacts `profile-lock` and `tool-config`, and two strict branches:

```ts
export const projectMemoryV1_1Migration: MigrationDefinition = {
  id: "project-memory-v1-1",
  from_version: LEGACY_REPOSITORY_CONTRACT_VERSION,
  to_version: REPOSITORY_CONTRACT_VERSION,
  affected_artifacts: ["profile-lock", "tool-config"],
  authority_impact: "none",
  transform(input) {
    if (input.artifact_kind === "profile-lock") {
      return normalizeProfileMetadata(input);
    }
    if (input.artifact_kind !== "tool-config") {
      return failure("MIGRATION_ARTIFACT_UNSUPPORTED", "v1.1 migration cannot transform this artifact", input.relative_path);
    }
    const decoded = decodeStrictUtf8(input.bytes, input.relative_path);
    if (!decoded.ok) return decoded;
    const parsed = parseJsonDocument(decoded.value, input.relative_path);
    if (!parsed.ok || !isRecord(parsed.value)) {
      return failure("MIGRATION_CONFIG_INVALID", "tool configuration must be a JSON object", input.relative_path);
    }
    if (Object.hasOwn(parsed.value, "repository_contract_version")) {
      return failure("MIGRATION_CONFIG_NOT_LEGACY", "pre-marker configuration must not contain a repository contract version", input.relative_path);
    }
    return success({
      bytes: new TextEncoder().encode(canonicalJson({
        ...parsed.value,
        repository_contract_version: REPOSITORY_CONTRACT_VERSION,
      })),
      semantic_diff: [{
        path: "/repository_contract_version",
        before: null,
        after: REPOSITORY_CONTRACT_VERSION,
      }],
    });
  },
};
```

Export one default registry factory so the artifact CLI and repository upgrade cannot drift:

```ts
export const createProjectMemoryMigrationRegistry = () =>
  createMigrationRegistry([projectMemoryV1_1Migration]);
```

Keep `normalize-generated-metadata.ts` as a compatibility re-export, export the new definition and executor from `migrations/index.ts`, and update existing expected migration IDs/record paths.

- [ ] **Step 6: Run focused tests and commit**

```powershell
npm test -- tests/cli/config.test.ts tests/materialize/adapters.test.ts tests/migrations/v1/project-memory-v1-1.test.ts tests/migrations/planner.test.ts tests/migrations/registry.test.ts
git add src/version.ts src/cli/config.ts src/materialize/render-adapters.ts src/migrations tests/cli/config.test.ts tests/materialize/adapters.test.ts tests/migrations
git commit -m "feat(upgrade): define repository contract migration"
```

Expected: all focused tests pass; no generated schema or package files are committed yet.

### Task 2: Build the Pure Repository Upgrade Plan

**Files:**
- Create: `plugins/project-memory/src/upgrades/contracts.ts`
- Create: `plugins/project-memory/src/upgrades/plan-repository-upgrade.ts`
- Create: `plugins/project-memory/src/upgrades/index.ts`
- Modify: `plugins/project-memory/src/index.ts`
- Test: `plugins/project-memory/tests/upgrades/plan-repository-upgrade.test.ts`

**Interfaces:**
- Consumes: `CanonicalSnapshot`, `MigrationRegistry`, `executeMigrationPath`, `renderStartupContext`, `GENERATED_VIEW_PATHS`, `CanonicalMutationPlan`.
- Produces: `RepositoryUpgradePlan`, `RepositoryUpgradeMetadata`, `RepositoryUpgradePlanInput`, `buildRepositoryUpgradePlan(input, registry)`.

- [ ] **Step 1: Write failing plan-shape and preservation tests**

Use a deterministic canonical snapshot fixture. Assert the exact three explicit writes, six derived paths, preimage hashes, source-set binding, non-directional authority, one-hour expiry, stable hash, and no writes under application, source, profile, catalog, archive, or existing record paths.

```ts
expect(plan.writes.map((write) => write.relative_path)).toEqual([
  "PROJECT_CONTEXT.md",
  "docs/project-memory/governance/migrations/repository-contract-1.0.0-to-1.1.0.json",
  "tools/project-memory/config.json",
]);
expect(plan.metadata.derived_paths).toEqual([...GENERATED_VIEW_PATHS]);
expect(plan.metadata.canonical_source_set_hash).toBe(sourceSetHash(snapshot));
expect(plan.metadata.authority_impact).toBe("none");
expect(plan.approval_ids).toEqual([]);
expect(plan.writes.some((write) =>
  write.relative_path.startsWith("docs/project-memory/source/") ||
  write.relative_path.startsWith("docs/project-memory/archive/")
)).toBe(false);
```

- [ ] **Step 2: Run the focused test and verify it fails**

```powershell
npm test -- tests/upgrades/plan-repository-upgrade.test.ts
```

Expected: FAIL because the upgrade contracts and planner are not implemented.

- [ ] **Step 3: Define the repository-upgrade contracts**

Create these stable fields in `src/upgrades/contracts.ts`:

```ts
export interface RepositoryUpgradeMetadata {
  readonly governance_kind: "repository_upgrade";
  readonly migration_id: "project-memory-v1-1";
  readonly from_version: "1.0.0";
  readonly to_version: "1.1.0";
  readonly authority_impact: "none";
  readonly canonical_source_set_hash: string;
  readonly canonical_source_path_count: number;
  readonly catalog_lock_hash: string;
  readonly config_input_sha256: string;
  readonly config_output_sha256: string;
  readonly doorway_input_sha256: string;
  readonly doorway_output_sha256: string;
  readonly changed_paths: readonly string[];
  readonly derived_paths: readonly string[];
  readonly migration_record_path: string;
  readonly steps: readonly AppliedMigrationStep[];
}

export type RepositoryUpgradePlan = CanonicalMutationPlan<RepositoryUpgradeMetadata>;

export interface RepositoryUpgradePlanInput {
  readonly snapshot: CanonicalSnapshot;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly config_bytes: Uint8Array;
  readonly config_sha256: string;
  readonly doorway_bytes: Uint8Array;
  readonly doorway_sha256: string;
  readonly created_at: string;
  readonly expires_at: string;
}

export interface RepositoryUpgradeReplay {
  readonly created_at: string;
  readonly expires_at: string;
}
```

- [ ] **Step 4: Compose the deterministic multi-artifact plan**

Define stable ordering and reject a snapshot not bound to the expected HEAD:

```ts
const compareUtf8 = (left: string, right: string) =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
if (input.snapshot.source_revision !== input.expected_head) {
  return failure(
    "UPGRADE_SNAPSHOT_HEAD_MISMATCH",
    "upgrade snapshot must bind the expected HEAD",
    input.expected_head,
  );
}
```

Implement `buildRepositoryUpgradePlan` so it validates hashes and timestamps, executes the registered tool-config migration, renders the current doorway from `snapshot.project`, `snapshot.profile_lock.profile`, and `snapshot.profile_lock`, and produces one `migration` mutation:

```ts
const migrated = executeMigrationPath(registry, {
  artifact_kind: "tool-config",
  relative_path: CONFIG_RELATIVE_PATH,
  from_version: LEGACY_REPOSITORY_CONTRACT_VERSION,
  to_version: REPOSITORY_CONTRACT_VERSION,
  bytes: input.config_bytes,
  context: {},
});
if (!migrated.ok) return migrated;

const doorway = renderStartupContext(
  input.snapshot.project,
  input.snapshot.profile_lock.profile,
  input.snapshot.profile_lock,
);
if (!doorway.ok) return doorway;

const migrationRecordPath =
  "docs/project-memory/governance/migrations/repository-contract-1.0.0-to-1.1.0.json";
const metadata: RepositoryUpgradeMetadata = {
  governance_kind: "repository_upgrade",
  migration_id: "project-memory-v1-1",
  from_version: LEGACY_REPOSITORY_CONTRACT_VERSION,
  to_version: REPOSITORY_CONTRACT_VERSION,
  authority_impact: "none",
  canonical_source_set_hash: sourceSetHash(input.snapshot),
  canonical_source_path_count: input.snapshot.source_paths.length,
  catalog_lock_hash: input.snapshot.selected_catalog_lock_hash,
  config_input_sha256: input.config_sha256,
  config_output_sha256: sha256(migrated.value.bytes),
  doorway_input_sha256: input.doorway_sha256,
  doorway_output_sha256: sha256(doorway.value.bytes),
  changed_paths: [PROJECT_CONTEXT_PATH, migrationRecordPath, CONFIG_RELATIVE_PATH].sort(compareUtf8),
  derived_paths: [...GENERATED_VIEW_PATHS],
  migration_record_path: migrationRecordPath,
  steps: migrated.value.steps,
};
```

The migration record bytes must include exactly the before/after versions, all metadata hashes/path counts, semantic diff, `created_at`, and `created_by: "project-memory-upgrader"`. Build the plan with `expected_existing_sha256` on config and doorway, `mode: "create"` on the migration record, `profile_lock_hash` from the unchanged snapshot, no approval/evidence IDs, and `canonicalMutationPlanHash` over the final body.

- [ ] **Step 5: Run focused tests and commit**

```powershell
npm test -- tests/upgrades/plan-repository-upgrade.test.ts tests/migrations/planner.test.ts
git add src/upgrades src/index.ts tests/upgrades/plan-repository-upgrade.test.ts
git commit -m "feat(upgrade): plan repository contract upgrade"
```

Expected: plan tests pass with deterministic hashes and exact allowlisted writes.

### Task 3: Detect Compatible Upgrades During Read-Only Startup

**Files:**
- Create: `plugins/project-memory/src/upgrades/node-repository-upgrade.ts`
- Modify: `plugins/project-memory/src/agent/contracts.ts`
- Modify: `plugins/project-memory/src/agent/start.ts`
- Modify: `plugins/project-memory/src/agent/node-dependencies.ts`
- Modify: `plugins/project-memory/src/agent/index.ts`
- Test: `plugins/project-memory/tests/upgrades/node-repository-upgrade.test.ts`
- Test: `plugins/project-memory/tests/agent/start.test.ts`

**Interfaces:**
- Consumes: `buildRepositoryUpgradePlan`, current branch/HEAD/status, canonical snapshot builder, strict config reader, safe path resolver.
- Produces: replay-stable `NodeRepositoryUpgradePlanner.plan(root, replay?)`, `AgentStartDependencies.planRepositoryUpgrade`, and `upgrade_review_required` raw directives.

- [ ] **Step 1: Write failing inspection and startup-routing tests**

Cover current marker returning `null`, valid pre-marker returning a plan, dirty pre-marker returning `GIT_DIRTY_ROOT`, unknown version returning `REPOSITORY_CONTRACT_UNSUPPORTED`, invalid profile/catalog/canonical state preserving its exact error, and startup selecting upgrade before a stale-view block.

```ts
expect(await planner.plan(currentRoot)).toEqual({ ok: true, value: null, warnings: [] });
expect(await planner.plan(legacyRoot)).toMatchObject({
  ok: true,
  value: { metadata: { from_version: "1.0.0", to_version: "1.1.0" } },
});
expect(await planner.plan(dirtyRoot)).toMatchObject({
  ok: false,
  issues: [{ code: "GIT_DIRTY_ROOT" }],
});

expect(await startAgentSession(input, dependencies)).toMatchObject({
  ok: true,
  value: {
    kind: "upgrade_review_required",
    proposal: { confirmation_required: true },
  },
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

```powershell
npm test -- tests/upgrades/node-repository-upgrade.test.ts tests/agent/start.test.ts
```

Expected: FAIL because startup has no repository-upgrade dependency or directive.

- [ ] **Step 3: Implement the node compatibility planner**

Create a planner with this public surface:

```ts
export interface NodeRepositoryUpgradePlanner {
  plan(
    root: URL,
    replay?: RepositoryUpgradeReplay,
  ): Promise<RuntimeResult<RepositoryUpgradePlan | null>>;
}

export function createNodeRepositoryUpgradePlanner(
  now: () => Date = () => new Date(),
): NodeRepositoryUpgradePlanner;
```

When `replay` is absent, read `now()` once and derive an expiry exactly one hour later. When it is supplied during apply, validate both UTC timestamps, require `expires_at > created_at`, and reuse them byte-for-byte. Never call the live clock while rebuilding an approved plan; otherwise identical proposal/apply processes would generate different plan hashes.

Its `plan` implementation must perform this exact read-only order:

```ts
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

```ts
const document = await readToolConfigDocument(root);
if (!document.ok) return document;
const rawVersion = isRecord(document.value)
  ? document.value.repository_contract_version
  : undefined;
if (rawVersion === REPOSITORY_CONTRACT_VERSION) return success(null);
if (rawVersion !== undefined) {
  return failure(
    "REPOSITORY_CONTRACT_UNSUPPORTED",
    `repository contract ${String(rawVersion)} is not supported by this plugin`,
    CONFIG_RELATIVE_PATH,
    [REPOSITORY_CONTRACT_VERSION],
  );
}
const config = validateToolConfigDocument(document.value);
if (!config.ok) return config;
const status = await git.statusPorcelain(root);
if (status.length > 0) {
  return failure(
    "GIT_DIRTY_ROOT",
    "repository upgrade requires a clean local checkout; no files were changed",
    root.href,
  );
}
```

Then resolve the checked-out branch and exact HEAD, build a commit snapshot (thereby verifying profile, selected catalog, and canonical sources), read regular non-symlink config and doorway bytes, create valid one-hour timestamps, create the known migration registry, and call `buildRepositoryUpgradePlan`. Do not read or trust generated views as canonical inputs.

- [ ] **Step 4: Add the startup directive without weakening existing blocks**

Extend `AgentStartDependencies`:

```ts
readonly planRepositoryUpgrade: (
  root: URL,
) => Promise<RuntimeResult<RepositoryUpgradePlan | null>>;
```

Add this directive variant:

```ts
| {
    readonly kind: "upgrade_review_required";
    readonly proposal: {
      readonly confirmation_required: true;
      readonly plan: RepositoryUpgradePlan;
    };
    readonly warnings: readonly RuntimeIssue[];
  }
```

After detecting uninitialized state, but before returning any non-bootstrap doctor failure, call the dependency:

```ts
const upgrade = await callDependency("planRepositoryUpgrade", () =>
  dependencies.planRepositoryUpgrade(input.root));
if (!upgrade.ok) return blocked(upgrade.issues);
if (upgrade.value !== null) {
  const warnings = stableIssues([...doctor.warnings, ...upgrade.warnings]);
  return success({
    kind: "upgrade_review_required",
    proposal: { confirmation_required: true, plan: upgrade.value },
    warnings,
  }, warnings);
}
if (!doctor.ok || !doctor.value.valid) {
  return blocked(doctorIssues.length > 0
    ? doctorIssues
    : [agentIssue("AGENT_DOCTOR_INVALID", "repository diagnostics are not valid")]);
}
```

Wire `createNodeRepositoryUpgradePlanner(now).plan` into `createNodeAgentStartDependencies`. Preserve bootstrap, legacy review, resume, and current-contract stale-view behavior unchanged.

- [ ] **Step 5: Run focused tests and commit**

```powershell
npm test -- tests/upgrades/node-repository-upgrade.test.ts tests/agent/start.test.ts tests/cli/agent-start.test.ts tests/cli/doctor.test.ts
git add src/upgrades/node-repository-upgrade.ts src/agent tests/upgrades/node-repository-upgrade.test.ts tests/agent/start.test.ts tests/cli/agent-start.test.ts
git commit -m "feat(agent): propose compatible repository upgrades"
```

Expected: supported old repositories produce a read-only upgrade directive; current invalid repositories keep their existing fail-closed result.

### Task 4: Persist, Replan, Apply, and Verify One Upgrade Proposal

**Files:**
- Modify: `plugins/project-memory/src/host/proposal-envelope.ts`
- Modify: `plugins/project-memory/src/host/proposal-store.ts`
- Modify: `plugins/project-memory/src/host/project-memory-host.ts`
- Modify: `plugins/project-memory/src/cli/node-composition.ts`
- Modify: `plugins/project-memory/src/cli/command-registry.ts`
- Modify: `plugins/project-memory/src/host/index.ts`
- Test: `plugins/project-memory/tests/host/proposal-store.test.ts`
- Test: `plugins/project-memory/tests/host/project-memory-host.test.ts`
- Test: `plugins/project-memory/tests/cli/planning-commands.test.ts`
- Test: `plugins/project-memory/tests/upgrades/node-upgrade-apply.test.ts`

**Interfaces:**
- Consumes: raw upgrade directive, `RepositoryUpgradePlan`, persistent proposal store, node replanner, existing coordinator and checkout synchronizer.
- Produces: `upgrade` proposal envelopes, compact upgrade summaries, `ProjectMemoryHost.applyUpgrade`, trusted node apply dependency, `upgraded_verified` result.

- [ ] **Step 1: Write failing persistence, invalidation, authority, and post-verify tests**

Cover in-memory and file stores, separate store instances, corrupt/expired/wrong-kind handles, HEAD/preimage/plan drift, coordinator failure, success consumption, exact authority allowlisting, fresh resume, and no second proposal.

```ts
const issued = await firstStore.issue({
  kind: "upgrade",
  root,
  adapter_id: "adapter.codex",
  plan,
});
expect(issued).toMatchObject({ ok: true, value: { kind: "upgrade" } });
if (!issued.ok) throw new Error("proposal issuance failed");
expect(await secondStore.resolve(issued.value.handle, "upgrade"))
  .toMatchObject({ ok: true, value: { plan: { plan_hash: plan.plan_hash } } });

expect(await host.applyUpgrade({
  proposal_handle: issued.value.handle,
  approval: { confirmed: true },
})).toMatchObject({
  ok: true,
  value: {
    status: "upgraded_verified",
    receipt: { status: "mutation_integrated" },
    reading_order: AGENT_READING_ORDER_PREFIX,
  },
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

```powershell
npm test -- tests/host/proposal-store.test.ts tests/host/project-memory-host.test.ts tests/upgrades/node-upgrade-apply.test.ts tests/cli/planning-commands.test.ts
```

Expected: FAIL because `upgrade` is not a proposal kind and the host has no apply method.

- [ ] **Step 3: Add an exact persistent upgrade envelope**

Extend `StoredProposalEnvelope`:

```ts
| {
    readonly kind: "upgrade";
    readonly root: URL;
    readonly adapter_id: string;
    readonly plan: RepositoryUpgradePlan;
  }
```

Clone it deeply, derive issue fields/expiry from its plan, persist it in the existing v2 envelope, and decode it without changing cache format. Validate it with:

```ts
function upgradeExact(value: Extract<StoredProposalEnvelope, { readonly kind: "upgrade" }>): boolean {
  try {
    const { plan_hash: boundPlanHash, ...body } = value.plan;
    return value.root.protocol === "file:" &&
      /^adapter[.][a-z][a-z0-9-]*$/u.test(value.adapter_id) &&
      /^[0-9a-f]{64}$/u.test(boundPlanHash) &&
      value.plan.mutation_kind === "migration" &&
      value.plan.metadata.governance_kind === "repository_upgrade" &&
      value.plan.metadata.from_version === LEGACY_REPOSITORY_CONTRACT_VERSION &&
      value.plan.metadata.to_version === REPOSITORY_CONTRACT_VERSION &&
      canonicalMutationPlanHash(body) === boundPlanHash;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Add compact host proposal and verified apply**

Add `CompactRepositoryUpgradeSummary` containing operation, repository, from/to versions, plan hash, expected HEAD, changed paths, derived paths, canonical source count/hash, profile/catalog hashes, authority impact, and `preserves_existing_canonical_history: true`.

In `ProjectMemoryHost.start`, issue the stored upgrade envelope and return:

```ts
{
  kind: "upgrade_review_required",
  proposal_handle: issued.value.handle,
  confirmation_required: true,
  expires_at: issued.value.expires_at,
  summary: compactUpgradeSummary(input.root, plan),
  warnings: started.value.warnings,
}
```

Add the apply input/result:

```ts
export interface ApplyRepositoryUpgradeProposalInput {
  readonly proposal_handle: string;
  readonly approval: { readonly confirmed: boolean };
}

export interface VerifiedRepositoryUpgrade {
  readonly status: "upgraded_verified";
  readonly receipt: MutationReceipt;
  readonly repository_contract_version: "1.1.0";
  readonly root_id: string;
  readonly reading_order: readonly string[];
}
```

`applyUpgrade` must reject false confirmation, resolve the exact `upgrade` handle, call the trusted `applyUpgrade` dependency, consume only after successful coordinator finalization, then call the raw startup dependency with the stored root/adapter. Return `upgraded_verified` only when the fresh directive is `resume`, has the same root, and retains `AGENT_READING_ORDER_PREFIX`; otherwise return `HOST_UPGRADE_VERIFICATION_FAILED`.

- [ ] **Step 5: Wire trusted node replanning and coordinator authority**

Add `applyUpgrade(root, savedPlan)` to `NodeProjectMemoryServices`. Re-run `NodeRepositoryUpgradePlanner.plan` with the saved timestamps and reject `null` or any changed hash/binding:

```ts
const replanned = await upgrades.plan(root, {
  created_at: savedPlan.created_at,
  expires_at: savedPlan.expires_at,
});
if (!replanned.ok) return replanned;
if (replanned.value === null) {
  return failure("UPGRADE_NO_LONGER_REQUIRED", "repository already uses the current contract", root.href);
}
if (replanned.value.plan_hash !== savedPlan.plan_hash) {
  return failure(
    "UPGRADE_PLAN_CHANGED",
    "repository upgrade inputs changed; request a fresh proposal",
    savedPlan.plan_id,
    [savedPlan.plan_hash, replanned.value.plan_hash],
  );
}
```

Create a narrowly scoped `PlanAuthorityValidator` that returns success only for the configured root and a `migration` plan whose metadata is `repository_upgrade`, authority impact is `none`, versions are `1.0.0 -> 1.1.0`, changed paths match the exact allowlist, and derived paths match `GENERATED_VIEW_PATHS`. Finalize through `createLocalCoordinator(..., upgradeAuthority).finalizeMutation(replanned.value)` so clean-tree binding, lease, detached mutation worktree, deterministic view generation, integration audit, CAS ref update, and checkout sync remain unchanged.

Also wire the same `projectMemoryV1_1Migration` registry/service into `createDefaultCommandRegistry({ migration: ... })` so developer `migrate plan/apply` and the agent upgrade use one transform registry.

- [ ] **Step 6: Run focused tests and commit**

```powershell
npm test -- tests/host/proposal-store.test.ts tests/host/project-memory-host.test.ts tests/upgrades/node-upgrade-apply.test.ts tests/cli/planning-commands.test.ts tests/governance/single-repo-rejections.test.ts
git add src/host src/cli/node-composition.ts src/cli/command-registry.ts tests/host tests/upgrades/node-upgrade-apply.test.ts tests/cli/planning-commands.test.ts
git commit -m "feat(host): apply exact repository upgrade proposals"
```

Expected: plan/head drift fails before finalization, dirty checkout still returns `GIT_DIRTY_ROOT`, success produces one coordinator receipt and verified resume.

### Task 5: Expose the One-Confirmation Flow to Every Agent

**Files:**
- Modify: `plugins/project-memory/src/mcp/server.ts`
- Modify: `plugins/project-memory/skills/project-memory/SKILL.md`
- Modify: `plugins/project-memory/skills/project-memory/references/agent-protocol.md`
- Modify: `plugins/project-memory/README.md`
- Test: `plugins/project-memory/tests/mcp/server.test.ts`
- Test: `plugins/project-memory/tests/mcp/stdio.test.ts`
- Test: `plugins/project-memory/tests/plugin/skill-contract.test.ts`
- Test: `plugins/project-memory/tests/release/mcp-plugin-contents.test.ts`

**Interfaces:**
- Consumes: compact host upgrade directive and `ProjectMemoryHost.applyUpgrade`.
- Produces: `project_memory_apply` mode `upgrade`, portable agent instructions, bounded structured results.

- [ ] **Step 1: Write failing MCP and skill-contract tests**

Assert startup caches the upgrade handle, apply routes it through a host recreated from the persistent envelope, only `{ confirmed: true }` is accepted, false/missing confirmation is rejected, a wrong-kind handle fails, response size remains below 64 KiB, and the skill gives lower-reasoning agents one exact sequence.

```ts
expect(toolList).toContainEqual(expect.objectContaining({ name: "project_memory_apply" }));
expect(upgradeStart.structuredContent).toMatchObject({
  kind: "upgrade_review_required",
  confirmation_required: true,
});
expect(upgradeApply.structuredContent).toMatchObject({
  status: "upgraded_verified",
  repository_contract_version: "1.1.0",
});
expect(Buffer.byteLength(JSON.stringify(upgradeStart), "utf8"))
  .toBeLessThanOrEqual(65_536);
```

- [ ] **Step 2: Run focused tests and verify they fail**

```powershell
npm test -- tests/mcp/server.test.ts tests/mcp/stdio.test.ts tests/plugin/skill-contract.test.ts tests/release/mcp-plugin-contents.test.ts
```

Expected: FAIL because MCP and the skill do not recognize the upgrade directive.

- [ ] **Step 3: Add the dedicated MCP upgrade mode**

Add an upgrade-only input branch rather than weakening bootstrap/import approval schemas:

```ts
{
  type: "object",
  additionalProperties: false,
  required: ["mode", "proposal_handle", "approval"],
  properties: {
    mode: { enum: ["upgrade"] },
    proposal_handle: { type: "string", minLength: 1 },
    approval: {
      type: "object",
      additionalProperties: false,
      required: ["confirmed"],
      properties: { confirmed: { type: "boolean" } },
    },
  },
}
```

Include `applyUpgrade` in `ProjectMemoryHostAdapter`. Cache `proposal_handle` when startup returns `upgrade_review_required`. In `apply`, resolve kind `upgrade`, invoke:

```ts
const applied = await host.value.applyUpgrade({
  proposal_handle: proposalHandle,
  approval: { confirmed: approval.confirmed },
});
if (applied.ok) this.#proposalHosts.delete(proposalHandle);
return runtimeToolResult(applied);
```

Keep command mode and bootstrap/import routing unchanged. Update the final protocol error to list `upgrade` among accepted modes.

- [ ] **Step 4: Teach the plugin skill the complete portable sequence**

Insert a section before legacy import:

```md
For `upgrade_review_required`:

1. Explain that Project Memory's repository format is being upgraded; the user's application is not being changed.
2. Present `summary` completely: current and target contract versions, changed and regenerated paths, canonical-preservation statement, plan hash, expected Git head, expiry, warnings, and risks.
3. Request one confirmation of that exact proposal. Never infer approval from silence.
4. After confirmation, invoke `project_memory_apply` in `upgrade` mode with only the engine-issued `proposal_handle` and `approval: { confirmed: true }`.
5. Do not edit, regenerate, stash, commit, or move Project Memory files manually.
6. Continue only when apply returns `upgraded_verified` and a fresh `project_memory_start` returns `resume`.
```

Document in `agent-protocol.md` that upgrade is local/offline, pre-marker-only, clean-root-only, exact-handle-bound, and coordinator-owned. Add one short README paragraph explaining automatic compatibility upgrades without exposing internal commands.

- [ ] **Step 5: Run focused tests and commit**

```powershell
npm test -- tests/mcp/server.test.ts tests/mcp/stdio.test.ts tests/plugin/skill-contract.test.ts tests/release/mcp-plugin-contents.test.ts
git add src/mcp/server.ts skills/project-memory README.md tests/mcp tests/plugin/skill-contract.test.ts tests/release/mcp-plugin-contents.test.ts
git commit -m "feat(mcp): guide one-confirmation repository upgrades"
```

Expected: Codex and other MCP-capable agents receive the same bounded, tool-driven upgrade path without manual repository operations.

### Task 6: Prove Real v0.1.0 Compatibility, Preservation, and Offline Packaging

**Files:**
- Create: `plugins/project-memory/tests/upgrades/v1-repository-fixture.ts`
- Create: `plugins/project-memory/tests/e2e/plugin-mcp-repository-upgrade.test.ts`
- Modify: `plugins/project-memory/tests/e2e/plugin-workflow-harness.ts`
- Modify: `plugins/project-memory/tests/release/plugin-bundle.test.ts`
- Modify: `plugins/project-memory/tests/release/plugin-contents.test.ts`
- Modify: `plugins/project-memory/scripts/verify-plugin-contents.mjs`
- Modify: `plugins/project-memory/scripts/verify-package.mjs`

**Interfaces:**
- Consumes: v0.1.0 tagged renderer behavior, packaged MCP one-shot harness, Git tree/hash inspection, generated-view verifier.
- Produces: sanitized pre-marker fixture builder and end-to-end proof through separate plugin processes.

- [ ] **Step 1: Commit an exact sanitized v0.1.0 renderer fixture**

Create `v1-repository-fixture.ts` containing the exact v0.1.0 `PROJECT_CONTEXT.md` startup order and `HANDOFF.md` continuation renderer copied from tag `v0.1.0`, with no LifeOf content. Its exported helper must:

```ts
export async function convertWorkflowToRepositoryContractV1(
  workflow: PluginWorkflow,
  newline: "\n" | "\r\n",
): Promise<{
  readonly head: string;
  readonly canonical_hashes: Readonly<Record<string, string>>;
  readonly archive_hashes: Readonly<Record<string, string>>;
}>;
```

The helper removes only `repository_contract_version` from config, writes exact legacy doorway/HANDOFF projections using the requested checkout newline, stages a valid source tree, regenerates all other views from the unchanged snapshot, commits the fixture, and returns the pre-upgrade canonical/archive hash inventories. It must assert the checkout is clean before returning.

- [ ] **Step 2: Write the cross-process end-to-end test**

Use `preparePluginWorkflow`, bootstrap normally, convert to the sanitized v1 contract, then invoke every MCP operation through a fresh process:

```ts
const before = await projectSnapshot(workflow.project_root);
const started = await callPluginMcpOnce(workflow, "project_memory_start", {
  root: workflow.project_url.href,
});
const proposal = started.tool_result.structuredContent as UpgradeDirective;
expect(proposal.kind).toBe("upgrade_review_required");
expect(await projectSnapshot(workflow.project_root)).toEqual(before);

const applied = await callPluginMcpOnce(workflow, "project_memory_apply", {
  mode: "upgrade",
  proposal_handle: proposal.proposal_handle,
  approval: { confirmed: true },
});
expect(applied.tool_result.structuredContent).toMatchObject({
  status: "upgraded_verified",
  receipt: { status: "mutation_integrated", plan_hash: proposal.summary.plan_hash },
});

const resumed = await callPluginMcpOnce(workflow, "project_memory_start", {
  root: workflow.project_url.href,
});
expect(resumed.tool_result.structuredContent).toMatchObject({
  kind: "resume",
  reading_order: AGENT_READING_ORDER_PREFIX,
});
```

Assert distinct process IDs, exact changed-path allowlist including the coordinator integration audit and six regenerated views, current config marker, one migration record, unchanged pre-existing canonical/archive hashes, exact receipt view hashes after `normalizeGitTextBytes`, clean checkout, and idempotent second startup.

- [ ] **Step 3: Add failure matrix and line-ending coverage**

Run the same successful scenario for LF and CRLF. Add isolated cases for dirty root, expired handle, wrong handle kind, HEAD drift, config preimage drift, unsupported version, profile/catalog corruption, current-contract HANDOFF tampering, and injected coordinator failure. Each must assert no partial upgrade writes and no `upgraded_verified` result.

```ts
for (const newline of ["\n", "\r\n"] as const) {
  await expectUpgradeRoundTrip(newline);
}

expect(dirtyStart.tool_result.structuredContent).toMatchObject({
  kind: "blocked",
  issues: [{ code: "GIT_DIRTY_ROOT" }],
});
expect(currentTamper.tool_result.structuredContent).toMatchObject({
  kind: "blocked",
  issues: expect.arrayContaining([
    expect.objectContaining({ code: "DOCTOR_VIEWS_STALE" }),
  ]),
});
```

The successful cross-process case must use different live clocks for proposal and apply while asserting the saved/replayed plan hash remains identical. This prevents the repeated-confirmation hash churn seen when timestamps are regenerated.

- [ ] **Step 4: Verify the offline bundle contains the complete path**

Extend release assertions so a clean bundled plugin with no `node_modules`:

- advertises `upgrade` in `project_memory_apply`;
- starts a sanitized v1 repository with `upgrade_review_required`;
- applies the persisted handle in another process;
- returns `resume` afterward;
- contains no URL, token, network call, or undeclared runtime file for the upgrade path.

Run:

```powershell
npm test -- tests/e2e/plugin-mcp-repository-upgrade.test.ts tests/release/plugin-bundle.test.ts tests/release/plugin-contents.test.ts
npm run bundle:plugin
npm run plugin:verify
npm run package:verify
```

Expected: all focused end-to-end and offline package checks pass.

- [ ] **Step 5: Run the complete regression gate**

```powershell
npm run typecheck
npm run lint
npm run test:ci
npm run schemas:emit
npm run generated:verify
npm run package:verify
git diff --check
git status --short
```

Expected: every command exits `0`; `git diff --check` prints nothing; only intended implementation/test/generated schema changes are present before the final commit.

- [ ] **Step 6: Commit the validated end-to-end slice**

```powershell
git add tests/upgrades tests/e2e tests/release scripts schemas dist
git commit -m "test(upgrade): prove offline v1 repository migration"
git status --short
```

Expected: clean isolated feature branch with the complete compatibility path committed. Do not merge, install, publish, push, or modify LifeOf.

## Final Acceptance Checklist

- [ ] A clean compatible pre-marker repository returns `upgrade_review_required` without writes.
- [ ] One confirmation and one persistent handle work across separate MCP processes.
- [ ] Apply replans and compares every binding before coordinator finalization.
- [ ] Only config, doorway, migration record, derived views, and standard integration audit change.
- [ ] Every pre-existing canonical/history/profile/catalog/archive/application hash is unchanged.
- [ ] Fresh startup returns `resume` with the exact five-file prefix; the next startup is idempotent.
- [ ] Current-contract tampering, unsupported versions, dirty roots, expired handles, and drift remain fail-closed.
- [ ] LF and CRLF succeed logically on Windows and Ubuntu.
- [ ] The bundled plugin performs the entire flow offline without `node_modules`.
- [ ] Full typecheck, lint, test, generated-artifact, package, diff, and clean-status gates pass.
- [ ] No LifeOf/product repository, installation, publication, push, or release occurred.
