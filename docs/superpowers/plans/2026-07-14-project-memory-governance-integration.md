# Project Memory Governance, History, and Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the repository-backed governance runtime that preserves immutable records and audit history, generates trustworthy current views, controls concurrent claims and integration authority, reconciles stale work safely, and finalizes single- and multi-repository work without allowing unverified or unauthorized state into canonical truth.

**Architecture:** Add one `src/governance/**` subsystem to the single TypeScript/ESM package at repository path `plugins/project-memory/`. The subsystem consumes foundation primitives plus selection/planning packet validators, produces side-effect-free write plans wherever possible, and lets only a lease-holding integrator turn a fully validated plan into an atomic canonical Git commit. Canonical records and events are append-only, generated views are disposable projections, archives are content-addressed and redacted, and cross-repository finalization uses prepared satellite commits followed by one authoritative hub commit.

**Tech Stack:** Node.js 24 LTS, TypeScript 6.0.3, ESM, TypeBox/Ajv schemas registered through the foundation schema registry, canonical JSON/SHA-256, Git worktrees and compare-and-swap refs, Vitest, ESLint, PowerShell.

## Global Constraints

- Repository root is `<repository-root>` (or its isolated worktree). Execute from `plugins/project-memory/`; every implementation path below is relative to that package root.
- This plan owns only `src/governance/**`, `tests/governance/**`, `tests/fixtures/governance/**`, and governance-owned emitted schemas under `schemas/project-memory/v1/`.
- Do not implement or modify catalog content, profile compilation, selection/scoring, task-packet materialization, CLI commands, migrations, legacy import, or pilot logic in this plan.
- Profile-owned frontmatter parsing/rendering and catalog vendoring remain outside governance; governance consumes only compiled locks/artifacts and their hashes.
- Governance exposes the one-time `IntegrationCoordinator.bootstrap` transaction for CLI-owned `init apply`. The CLI must call it before any profile or task packet exists; normal `validate`/`finalize` is never a bootstrap fallback, and this plan never edits `src/cli/**`.
- Consume foundation exports from `src/index.ts`; do not deep-import or duplicate `src/contracts/**`, `src/core/**`, or `src/schema/**`.
- Consume `validateCompletionPacket` and `validateClaimAndApprovals` from `src/planning/**`; governance adds operational state and integration behavior but does not redefine their schemas or validation semantics.
- Consume each packet gate through the planning-owned `ResolvedGateExecution` wrapper after materialization has fixed its stable `id`, `definition_ref`, `evidence_type`, and fully resolved `execution` union. Governance never redeclares that wrapper, resolves catalog definitions, or consults a gate registry during integration.
- Persistent JSON/YAML properties use `snake_case`; TypeScript function and method names use `camelCase`.
- Use injected `Clock`, `IdFactory`, `GitClient`, command execution, filesystem root, and fault injector. Tests must not read global time, generate uncontrolled IDs, invoke a shell, or depend on a developer's Git configuration.
- Every canonical filesystem path is repository-relative and must pass `resolveInside`. Canonical multi-file writes use `applyFileTransaction`; create-only history never uses replacement mode.
- Workers may submit evidence and proposals but never accept canonical directional state. Directional decisions, root/profile changes, security/privacy direction, pricing/business rules, destructive deletion, and external actions require a valid Pitaji approval.
- An approval must cover target, environment, scope, timing, and the exact authority category. Silence, a completion attestation, or successful tests never grants authority.
- Records, events, archive objects, prepared manifests, and audit evidence are append-only.
- Canonical producers are plan-only. Claim, view, archive, work-lifecycle, record, and administrative services never apply writes directly; only `IntegrationCoordinator.finalizeMutation`, `bootstrap`, or normal/multi-repository finalization may commit through the shared lease/CAS primitive. Corrections create addenda, superseding records, or new prepared commits.
- Workers never edit generated views. View drift is repaired only by regeneration from canonical sources during authorized integration.
- No task reaches `integrated_verified` unless its current claim, approvals, current-base evidence, required gates, records, and views all validate in the integration worktree.
- Gate commands are structured `executable` plus literal `args` and run with `shell: false`. Never interpret a task-provided string through `cmd.exe`, PowerShell `-Command`, `sh -c`, `bash -c`, or `eval`.
- Never force-push, run `git reset --hard`, rewrite a prepared satellite commit, or mutate a historical record.
- Single-repository finalization creates one commit and compare-and-swap updates the target ref from the expected head. Any failure before that ref update leaves canonical Git state unchanged.
- Cross-repository finalization is two-phase: immutable satellite preparation, then one hub finalization commit referencing exact satellite hashes.
- Each task below ends with its focused tests, typecheck, and one logical commit. Do not combine tasks into a single review unit.

---

## Ownership and Dependency Boundary

This plan consumes these already-planned interfaces without changing their names:

```ts
import type {
  Clock,
  CommandResult,
  CommandSpec,
  GitClient,
  IdFactory,
  PlannedWrite,
  RuntimeIssue,
  RuntimeResult,
} from "../../index.js";

import { applyFileTransaction, canonicalJson, resolveInside, runCommand, sha256 } from "../../index.js";
import type { ResolvedGateExecution } from "../../planning/types.js";
import type { CanonicalMutationPlan } from "../../contracts/canonical-mutation-plan.js";
import { canonicalMutationPlanHash } from "../../contracts/canonical-mutation-plan.js";
import type { AcceptedProfileSourceSet, ProfileVerifier } from "../../profile/index.js";
import { validateClaimAndApprovals } from "../../planning/validate-claim-approval.js";
import { validateCompletionPacket } from "../../planning/validate-completion-packet.js";
```

The shared foundation owns `CanonicalMutationPlan` and `canonicalMutationPlanHash` in `src/contracts/canonical-mutation-plan.ts`; the profile compiler returns that shared contract with `mutation_kind: "profile.bootstrap"` or `"profile.evolution"`. Selection/planning owns `task-packet.schema.json`, `completion-packet.schema.json`, `claim.schema.json`, and `approval.schema.json`. The CLI owns `init plan`/`init apply` argument handling and plan recomputation. Governance consumes those inputs and owns only the atomic bootstrap/integration transaction, runtime stores, projections, integration-specific contracts, and audit behavior described here.

## Governance File Map

```text
src/governance/
├── contracts/
│   ├── canonical-record.ts
│   ├── bootstrap-audit.ts
│   ├── record-payloads.ts
│   ├── governance-event.ts
│   ├── view-metadata.ts
│   ├── archive-manifest.ts
│   ├── integration-lease.ts
│   ├── gate-evidence.ts
│   ├── prepared-satellite.ts
│   ├── hub-finalization.ts
│   └── index.ts
├── records/
│   ├── record-path.ts
│   ├── immutable-record-store.ts
│   └── supersession-index.ts
├── events/
│   ├── append-only-event-store.ts
│   ├── event-chain-verifier.ts
│   └── effective-state-projector.ts
├── snapshot/
│   └── canonical-snapshot-builder.ts
├── views/
│   ├── generate-views.ts
│   ├── view-drift.ts
│   ├── render-now.ts
│   ├── render-handoff.ts
│   ├── render-workstreams.ts
│   ├── render-changelog.ts
│   ├── render-history.ts
│   └── render-index.ts
├── archive/
│   ├── redactor.ts
│   └── content-addressed-archive.ts
├── authority/
│   └── authority-coverage.ts
├── work/
│   └── work-lifecycle-service.ts
├── claims/
│   ├── claim-conflicts.ts
│   ├── claim-store.ts
│   └── claim-service.ts
├── integration/
│   ├── integration-git-client.ts
│   ├── integration-lease-store.ts
│   ├── canonical-mutation-finalizer.ts
│   ├── gate-runner.ts
│   ├── audit-evidence.ts
│   ├── stale-base-reconciler.ts
│   ├── bootstrap-finalizer.ts
│   ├── integration-coordinator.ts
│   ├── single-repo-finalizer.ts
│   ├── satellite-preparer.ts
│   ├── hub-finalizer.ts
│   └── integration-recovery.ts
└── index.ts

tests/governance/
├── contracts.test.ts
├── immutable-record-store.test.ts
├── append-only-event-store.test.ts
├── canonical-snapshot-builder.test.ts
├── generated-views.test.ts
├── view-drift.test.ts
├── content-addressed-archive.test.ts
├── authority-coverage.test.ts
├── claim-service.test.ts
├── integration-lease-store.test.ts
├── gate-runner.test.ts
├── audit-evidence.test.ts
├── stale-base-reconciler.test.ts
├── bootstrap-finalizer.test.ts
├── bootstrap-fault-injection.test.ts
├── single-repo-finalizer.test.ts
├── single-repo-fault-injection.test.ts
├── multi-repo-finalization.test.ts
└── governance-e2e.test.ts

tests/fixtures/governance/
├── records/
├── events/
├── views/
├── archive/
├── authority/
├── gates/
└── repositories/
```

## Canonical Runtime Paths

```text
docs/project-memory/records/<record-kind>/<record-id>.json
docs/project-memory/governance/events/<aggregate-id>/<yyyyMMddTHHmmss.SSSZ>-<event-hash>.json
docs/project-memory/governance/claims/<claim-id>.json
docs/project-memory/governance/integration/audit/<packet-id>.json
docs/project-memory/governance/integration/bootstrap/<root-id>.json
docs/project-memory/governance/integration/prepared/<packet-id>/<manifest-hash>.json
docs/project-memory/governance/integration/finalizations/<packet-id>.json
docs/project-memory/views/NOW.md
docs/project-memory/views/HANDOFF.md
docs/project-memory/views/WORKSTREAMS.md
docs/project-memory/views/CHANGELOG.md
docs/project-memory/views/HISTORY.md
docs/project-memory/views/INDEX.json
docs/project-memory/archive/objects/sha256/<first-two>/<sha256>
docs/project-memory/archive/manifests/<archive-hash>.json
<git-common-dir>/project-memory/integration-lease.json
<git-common-dir>/project-memory/integration-lease.mutex/
```

The runtime lease and mutex are generated coordination artifacts under the shared Git directory, not canonical project truth. Lease acquisition, takeover, release, and finalization are represented permanently by governance events and audit evidence in the repository.

## Stable Governance Interfaces

Preserve the roadmap-level public names below through implementation. `AppendOnlyEventStore` is an internal collaborator only and must not be re-exported from `src/governance/index.ts`:

```ts
export interface CanonicalRecordStore {
  planCreate(root: URL, record: CanonicalRecord): Promise<RuntimeResult<RecordMutationPlan>>;
  planSupersede(
    root: URL,
    previousId: string,
    replacement: CanonicalRecord,
  ): Promise<RuntimeResult<RecordMutationPlan>>;
  get(root: URL, recordId: string): Promise<RuntimeResult<CanonicalRecord>>;
  list(root: URL, query: RecordQuery): Promise<RuntimeResult<readonly CanonicalRecord[]>>;
}

interface AppendOnlyEventStore {
  planAppend(root: URL, event: UnsignedGovernanceEvent): Promise<RuntimeResult<PlannedWrite>>;
  readChain(root: URL, aggregateId: string): Promise<RuntimeResult<readonly GovernanceEvent[]>>;
  verifyChain(root: URL, aggregateId: string): Promise<RuntimeResult<EventChainVerification>>;
}

export interface ViewGenerator {
  plan(snapshot: CanonicalSnapshot): RuntimeResult<GeneratedViewPlan>;
  verify(root: URL): Promise<RuntimeResult<ViewDriftReport>>;
}

export interface ArchiveStore {
  planIngest(input: ArchiveInput): RuntimeResult<ArchivePlan>;
  verify(root: URL, manifestHash: string): Promise<RuntimeResult<ArchiveVerification>>;
}

export interface ClaimService {
  planIssue(input: IssueClaimInput): Promise<RuntimeResult<ClaimOperationPlan>>;
  planHeartbeat(input: HeartbeatClaimInput): Promise<RuntimeResult<ClaimOperationPlan>>;
  planRenew(input: RenewClaimInput): Promise<RuntimeResult<ClaimOperationPlan>>;
  planExpire(input: ExpireClaimInput): Promise<RuntimeResult<ClaimOperationPlan>>;
  effectiveClaim(root: URL, claimId: string): Promise<RuntimeResult<EffectiveClaim>>;
}

export interface IntegrationLeaseStore {
  acquire(input: AcquireLeaseInput): Promise<RuntimeResult<LeaseToken>>;
  heartbeat(token: LeaseToken): Promise<RuntimeResult<LeaseToken>>;
  release(token: LeaseToken): Promise<RuntimeResult<void>>;
  takeover(input: TakeoverLeaseInput): Promise<RuntimeResult<LeaseToken>>;
}

export interface GateRunner {
  run(
    root: URL,
    gate: ResolvedGateExecution,
    submittedCheck?: SubmittedCheckEvidence,
  ): Promise<RuntimeResult<GateEvidence>>;
}

export interface StaleBaseReconciler {
  reconcile(input: ReconcileInput): Promise<RuntimeResult<ReconciliationOutcome>>;
}

export interface WorkLifecycleService {
  planCreateInitiative(input: CreateInitiativeInput): Promise<RuntimeResult<CanonicalMutationPlan>>;
  planCreateWorkstream(input: CreateWorkstreamInput): Promise<RuntimeResult<CanonicalMutationPlan>>;
  planCreateTaskPacket(input: CreateTaskPacketInput): Promise<RuntimeResult<CanonicalMutationPlan>>;
  planTransition(input: WorkTransitionInput): Promise<RuntimeResult<CanonicalMutationPlan>>;
}

export interface IntegrationCoordinator {
  bootstrap(input: BootstrapInput): Promise<RuntimeResult<BootstrapFinalization>>;
  finalizeMutation(input: CanonicalMutationPlan): Promise<RuntimeResult<MutationReceipt>>;
  validate(input: SingleRepoFinalizationInput): Promise<RuntimeResult<ValidatedIntegration>>;
  finalize(input: ValidatedIntegration): Promise<RuntimeResult<IntegrationReceipt>>;
}

export interface MultiRepoFinalizer {
  prepareSatellite(input: PrepareSatelliteInput): Promise<RuntimeResult<PreparedSatellite>>;
  finalizeHub(input: FinalizeHubInput): Promise<RuntimeResult<HubFinalizationReceipt>>;
  inspectRecovery(input: RecoveryInput): Promise<RuntimeResult<RecoveryReport>>;
}
```

### Task 1: Define Governance Contracts and Register Their Schemas

**Files:**

- Create: `src/governance/contracts/canonical-record.ts`
- Import: `CanonicalMutationPlan` and `canonicalMutationPlanHash` from `src/contracts/canonical-mutation-plan.ts`
- Create: `src/governance/contracts/bootstrap-audit.ts`
- Create: `src/governance/contracts/record-payloads.ts`
- Create: `src/governance/contracts/governance-event.ts`
- Create: `src/governance/contracts/view-metadata.ts`
- Create: `src/governance/contracts/archive-manifest.ts`
- Create: `src/governance/contracts/integration-lease.ts`
- Create: `src/governance/contracts/gate-evidence.ts`
- Create: `src/governance/contracts/prepared-satellite.ts`
- Create: `src/governance/contracts/hub-finalization.ts`
- Create: `src/governance/contracts/index.ts`
- Create: `src/governance/index.ts`
- Create: `tests/governance/test-helpers.ts`
- Create: `tests/governance/contracts.test.ts`
- Generate: `schemas/project-memory/v1/canonical-record.schema.json`
- Generate: `schemas/project-memory/v1/bootstrap-audit.schema.json`
- Generate: `schemas/project-memory/v1/governance-event.schema.json`
- Generate: `schemas/project-memory/v1/view-metadata.schema.json`
- Generate: `schemas/project-memory/v1/archive-manifest.schema.json`
- Generate: `schemas/project-memory/v1/integration-lease.schema.json`
- Generate: `schemas/project-memory/v1/gate-evidence.schema.json`
- Generate: `schemas/project-memory/v1/prepared-satellite.schema.json`
- Generate: `schemas/project-memory/v1/hub-finalization.schema.json`

**Interfaces:** Consumes the shared `CanonicalMutationPlan`; produces `CanonicalRecord`, `BootstrapAuditManifest`, record payload unions, `GovernanceEvent`, `GeneratedViewMetadata`, `ArchiveManifest`, `IntegrationLease`, `GateEvidence`, `PreparedSatellite`, and `HubFinalizationReceipt`. Governance contracts import the mutation plan from `src/contracts/canonical-mutation-plan.ts` and export only governance-owned types from `src/governance/contracts/index.ts`.

- [ ] **Step 1: Write failing schema-registration and authority-field tests**

```ts
import { describe, expect, it } from "vitest";
import { validateWithSchema } from "../../src/index.js";
import "../../src/governance/contracts/index.js";

describe("governance contracts", () => {
  it("accepts an immutable decision record with complete provenance", () => {
    const result = validateWithSchema("project-memory/v1/canonical-record", {
      id: "DEC-01J2Z3Y4X5W6V7T8S9R0Q1P2N3",
      type: "decision",
      title: "Keep one canonical hub",
      status: "accepted",
      root_id: "ROOT-01J2Z3Y4X5W6V7T8S9R0Q1P2N3",
      component_ids: [],
      initiative_id: null,
      workstream_id: "WS-01J2Z3Y4X5W6V7T8S9R0Q1P2N3",
      task_id: "TASK-01J2Z3Y4X5W6V7T8S9R0Q1P2N3",
      actor_id: "pitaji",
      authority_class: "pitaji",
      created_at: "2026-07-14T12:00:00.000Z",
      original_base_revision: "0123456789abcdef0123456789abcdef01234567",
      integration_base_revision: "0123456789abcdef0123456789abcdef01234567",
      catalog_versions: ["1.0.0"],
      relationships: [],
      payload: {
        choice: "Use one memory-hub repository",
        rationale: "Serialized integration prevents competing truth",
        alternatives: ["Independent mutable handoffs"],
        consequences: ["Satellites reference the hub"],
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a lease without an expiry or nonce", () => {
    const result = validateWithSchema("project-memory/v1/integration-lease", {
      holder_id: "integrator-a",
      base_revision: "0123456789abcdef0123456789abcdef01234567",
    });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the contracts are absent**

```powershell
npm test -- tests/governance/contracts.test.ts
```

Expected: FAIL because `src/governance/contracts/index.ts` and the governance schema IDs do not exist.

- [ ] **Step 3: Implement the exact envelope and hash-chain contracts**

```ts
export const RECORD_TYPES = [
  "decision",
  "idea",
  "change",
  "finding",
  "risk",
  "evidence",
  "lesson",
  "approval",
] as const;

export const RELATIONSHIP_TYPES = [
  "supersedes",
  "corrects",
  "implements",
  "evidences",
  "blocks",
  "depends_on",
  "approves",
  "rejects",
] as const;

export interface GovernanceEvent {
  aggregate_id: string;
  sequence: number;
  event_type: string;
  occurred_at: string;
  actor_id: string;
  authority_class: "worker" | "validator" | "integrator" | "pitaji";
  previous_event_hash: string | null;
  payload_hash: string;
  evidence_ids: readonly string[];
  event_hash: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface BootstrapAuditManifest {
  schema_version: "1.0.0";
  root_id: string;
  target_ref: string;
  parent_revision: string;
  compilation_plan_hash: string;
  source_proposal_hash: string;
  profile_lock_hash: string;
  catalog_lock_hash: string;
  approval_record_id: string;
  evidence_record_id: string;
  bootstrap_event_hash: string;
  planned_content_hashes: Readonly<Record<string, string>>;
  generated_view_hashes: Readonly<Record<string, string>>;
  bootstrap_content_hash: string;
  checks: readonly { id: string; status: "passed" | "failed" | "not_run"; evidence_id: string | null }[];
  remaining_risks: readonly string[];
  created_at: string;
  created_by: string;
}
```

Create `tests/governance/test-helpers.ts` with this assertion helper for the focused tests below:

```ts
export function mustValue<T>(result: RuntimeResult<T>): T {
  if (!result.ok) throw new Error(result.issues.map(issue => issue.code).join(","));
  return result.value;
}
```

Every canonical record also requires both `original_base_revision` and `integration_base_revision`. The original revision never changes; the integration revision records the exact base on which the fact was accepted. A generic `base_revision` field is rejected.

Record payload schemas must require these fields:

| Type | Required payload fields |
|---|---|
| `decision` | `choice`, `rationale`, `alternatives`, `consequences` |
| `idea` | `proposal`, `disposition_reason` |
| `change` | `summary`, `files`, `commits`, `artifacts`, `authorization_refs` |
| `finding` | `severity`, `description`, `evidence_ids`, `remediation_proposal_ids` |
| `risk` | `likelihood`, `impact`, `mitigation` |
| `evidence` | `evidence_type`, `exact_result`, `source_refs`, `hashes`, `not_run_reason` |
| `lesson` | `observation`, `evidence_ids`, `rule` |
| `approval` | `approval_kind`, `granted_by`, `target`, `environment`, `scope`, `timing`, `expires_at`, `invalidation_conditions` |

- [ ] **Step 4: Emit schemas twice and prove byte stability**

```powershell
npm run schemas:emit
$first = Get-FileHash schemas/project-memory/v1/*.schema.json
npm run schemas:emit
$second = Get-FileHash schemas/project-memory/v1/*.schema.json
Compare-Object $first $second
```

Expected: both schema-emission commands exit `0`; `Compare-Object` prints no rows.

- [ ] **Step 5: Run contract tests, typecheck, and commit**

```powershell
npm test -- tests/governance/contracts.test.ts
npm run typecheck
git add src/governance/contracts src/governance/index.ts tests/governance/test-helpers.ts tests/governance/contracts.test.ts schemas/project-memory/v1
git commit -m "feat(governance): define governance contracts"
```

Expected: tests and typecheck pass; the commit contains only governance contract sources, emitted schemas, exports, and their test.

### Task 2: Implement Immutable Records and Supersession

**Files:**

- Create: `src/governance/records/record-path.ts`
- Create: `src/governance/records/immutable-record-store.ts`
- Create: `src/governance/records/supersession-index.ts`
- Create: `tests/governance/immutable-record-store.test.ts`
- Create: `tests/fixtures/governance/records/accepted-decision.json`
- Create: `tests/fixtures/governance/records/superseding-decision.json`

**Interfaces:** Implements `CanonicalRecordStore`. Produces create-only `RecordMutationPlan` as a typed `metadata` view over the shared `CanonicalMutationPlan`; it never calls Git, replaces an existing record, or edits the superseded record.

- [ ] **Step 1: Write failing create-only and supersession-cycle tests**

```ts
it("plans one create-only canonical record write", async () => {
  const result = await store.planCreate(root, acceptedDecision);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.writes).toHaveLength(1);
    expect(result.value.writes[0]).toMatchObject({
      relative_path: "docs/project-memory/records/decisions/DEC-01J2Z3Y4X5W6V7T8S9R0Q1P2N3.json",
      expected_existing_sha256: null,
      mode: "create",
    });
  }
});

it("rejects replacement of an existing record ID", async () => {
  const duplicate = await store.planCreate(rootWithExistingRecord, acceptedDecision);
  expect(duplicate.ok).toBe(false);
  if (!duplicate.ok) expect(duplicate.issues[0].code).toBe("record.id_exists");
});

it("rejects a corrupted existing supersession cycle", () => {
  const result = buildSupersessionIndex([cycleRecordA, cycleRecordB]);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0].code).toBe("record.supersession_cycle");
});
```

- [ ] **Step 2: Run the test and verify failure**

```powershell
npm test -- tests/governance/immutable-record-store.test.ts
```

Expected: FAIL because record paths, create-only planning, and supersession validation are absent.

- [ ] **Step 3: Implement the record directory map and create-only writes**

```ts
const RECORD_DIRECTORIES = {
  decision: "decisions",
  idea: "ideas",
  change: "changes",
  finding: "findings",
  risk: "risks",
  evidence: "evidence",
  lesson: "lessons",
  approval: "approvals",
} as const;

export function canonicalRecordPath(record: CanonicalRecord): string {
  return `docs/project-memory/records/${RECORD_DIRECTORIES[record.type]}/${record.id}.json`;
}

export function recordWrite(record: CanonicalRecord): PlannedWrite {
  return {
    relative_path: canonicalRecordPath(record),
    bytes: new TextEncoder().encode(canonicalJson(record)),
    expected_existing_sha256: null,
    mode: "create",
  };
}
```

Wrap every `recordWrite` set in a `RecordMutationPlan` with `mutation_kind: "record"`, exact target/head/profile bindings, a short expiry, and a hash computed by `canonicalMutationPlanHash`; never apply the writes in the record store. `planSupersede` must require a new ID, the same root and fact class, one `supersedes` relationship to the previous record, no reverse path from the previous record to the replacement, and no accepted directional record whose actor/authority lacks Pitaji approval coverage.

- [ ] **Step 4: Run focused tests and verify persisted bytes**

```powershell
npm test -- tests/governance/immutable-record-store.test.ts
npm run typecheck
```

Expected: PASS for create/load/query/supersession plans, exact canonical planned bytes, duplicate and unsafe-path rejection, missing-target and cycle rejection, required original/integration bases, and no direct filesystem mutation.

- [ ] **Step 5: Commit the immutable record store**

```powershell
git add src/governance/records tests/governance/immutable-record-store.test.ts tests/fixtures/governance/records
git commit -m "feat(governance): add immutable canonical records"
```

### Task 3: Add Hash-Chained Append-Only Events and Effective-State Projection

**Files:**

- Create: `src/governance/events/append-only-event-store.ts`
- Create: `src/governance/events/event-chain-verifier.ts`
- Create: `src/governance/events/effective-state-projector.ts`
- Create: `tests/governance/append-only-event-store.test.ts`
- Create: `tests/fixtures/governance/events/claim-chain.json`

**Interfaces:** Implements `AppendOnlyEventStore`. `planAppend` derives `sequence`, `previous_event_hash`, `payload_hash`, and `event_hash`; callers do not supply trusted hash fields.

- [ ] **Step 1: Write failing chain-integrity and idempotence tests**

```ts
it("links every event to the previous event hash", async () => {
  await appendAndApply(root, issuedEvent);
  await appendAndApply(root, heartbeatEvent);
  const chain = await store.readChain(root, issuedEvent.aggregate_id);
  expect(chain.ok).toBe(true);
  if (chain.ok) {
    expect(chain.value[1].sequence).toBe(2);
    expect(chain.value[1].previous_event_hash).toBe(chain.value[0].event_hash);
  }
});

it("detects deletion or payload mutation", async () => {
  await appendAndApply(root, issuedEvent);
  await appendAndApply(root, heartbeatEvent);
  await mutateFixtureEventByte(root, issuedEvent.aggregate_id, 1);
  const verification = await store.verifyChain(root, issuedEvent.aggregate_id);
  expect(verification.ok).toBe(false);
  if (!verification.ok) expect(verification.issues[0].code).toBe("event.hash_mismatch");
});
```

- [ ] **Step 2: Confirm tests fail before the event store exists**

```powershell
npm test -- tests/governance/append-only-event-store.test.ts
```

Expected: FAIL because event planning and verification are absent.

- [ ] **Step 3: Implement canonical event hashing and filenames**

```ts
function signEvent(unsigned: UnsignedGovernanceEvent, previous: GovernanceEvent | null): GovernanceEvent {
  const payloadHash = sha256(canonicalJson(unsigned.payload));
  const body = {
    ...unsigned,
    sequence: previous === null ? 1 : previous.sequence + 1,
    previous_event_hash: previous?.event_hash ?? null,
    payload_hash: payloadHash,
  };
  return { ...body, event_hash: sha256(canonicalJson(body)) };
}

function filenameSafeUtc(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}\.\d{3})Z$/.exec(value);
  if (match === null) throw new Error("event.occurred_at must be RFC3339 UTC with milliseconds");
  return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6]}Z`;
}

function eventPath(event: GovernanceEvent): string {
  const timestamp = filenameSafeUtc(event.occurred_at);
  return `docs/project-memory/governance/events/${event.aggregate_id}/${timestamp}-${event.event_hash}.json`;
}
```

`occurred_at` remains RFC3339 UTC inside the event; only the derived filename uses `yyyyMMddTHHmmss.SSSZ`, which is portable on Windows and Unix.

The projector must implement these exact event transitions: `bootstrap_initialized`, `record_created`, `record_superseded`, `status_changed`, `claim_issued`, `claim_heartbeat`, `claim_renewed`, `claim_expired`, `integration_validated`, `integrated_verified`, `lease_taken_over`, `satellite_prepared`, and `hub_finalized`. An unknown event type is retained in history but cannot change effective state.

- [ ] **Step 4: Run event tests and typecheck**

```powershell
npm test -- tests/governance/append-only-event-store.test.ts
npm run typecheck
```

Expected: PASS for valid chains, identical-event idempotence, sequence gaps, deleted events, changed payloads, changed prior hashes, and unsupported state transitions.

- [ ] **Step 5: Commit append-only event history**

```powershell
git add src/governance/events tests/governance/append-only-event-store.test.ts tests/fixtures/governance/events
git commit -m "feat(governance): add append-only event history"
```

### Task 4: Build a Revision-Pinned Canonical Snapshot

**Files:**

- Create: `src/governance/snapshot/revision-tree-reader.ts`
- Create: `src/governance/snapshot/canonical-snapshot-builder.ts`
- Create: `tests/governance/canonical-snapshot-builder.test.ts`
- Create: `tests/fixtures/governance/repositories/snapshot-root/**`

**Interfaces:** Produces `CanonicalSnapshot` from the exact tree and blob objects of one caller-supplied Git commit or staged tree object. It contains root/profile references, source documents, component/domain records, initiatives, workstreams, task packets, effective records, evidence, risks, approvals, claims, events, and blob hashes. It excludes `views/**` and `archive/**` as truth sources and never reads working-tree bytes.

- [ ] **Step 1: Write failing exact-revision and source-boundary tests**

```ts
it("ignores dirty working-tree bytes and reads the requested commit tree", async () => {
  const revision = await git.head(root);
  const committed = mustValue(await builder.build(root, { kind: "commit", object_id: revision }));
  await replaceWorkingTreeSource(root, "docs/project-memory/source/PROJECT.md", "uncommitted edit");
  const repeated = mustValue(await builder.build(root, { kind: "commit", object_id: revision }));
  expect(repeated.source_hashes).toEqual(committed.source_hashes);
  expect(repeated.source_revision).toBe(revision);
});

it("excludes generated views and archives from the requested tree", async () => {
  const result = await builder.build(root, { kind: "commit", object_id: snapshotRevision });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.source_paths.some(path => path.includes("/views/"))).toBe(false);
    expect(result.value.source_paths.some(path => path.includes("/archive/"))).toBe(false);
  }
});

it("rejects a missing or non-commit revision", async () => {
  const result = await builder.build(root, { kind: "commit", object_id: "f".repeat(40) });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0].code).toBe("snapshot.revision_not_found");
});
```

- [ ] **Step 2: Run the snapshot test and confirm failure**

```powershell
npm test -- tests/governance/canonical-snapshot-builder.test.ts
```

Expected: FAIL because no revision-tree reader exists.

- [ ] **Step 3: Implement literal Git tree/blob reads**

```ts
export interface RevisionBlob {
  relative_path: string;
  object_id: string;
  bytes: Uint8Array;
}

export interface RevisionTreeReader {
  readCanonicalBlobs(
    root: URL,
    source: { kind: "commit" | "tree"; object_id: string },
  ): Promise<RuntimeResult<readonly RevisionBlob[]>>;
}

export async function buildCanonicalSnapshot(
  root: URL,
  source: { kind: "commit" | "tree"; object_id: string },
  reader: RevisionTreeReader,
): Promise<RuntimeResult<CanonicalSnapshot>> {
  const blobs = await reader.readCanonicalBlobs(root, source);
  if (!blobs.ok) return blobs;
  const sources = validateCanonicalBlobs(blobs.value);
  if (!sources.ok) return sources;
  return {
    ok: true,
    value: {
      source_revision: source.object_id,
      source_paths: sources.value.map(source => source.relative_path).sort(),
      source_hashes: Object.fromEntries(
        sources.value.map(source => [source.relative_path, sha256(source.bytes)]),
      ),
      records: projectEffectiveRecords(sources.value),
      workstreams: projectWorkstreams(sources.value),
      tasks: projectTasks(sources.value),
    },
    warnings: [],
  };
}
```

Verify the object with literal `git cat-file -e <object>^{commit}` or `git cat-file -e <object>^{tree}` according to the discriminant. Enumerate allowed paths with NUL-delimited `git ls-tree -rz --full-tree <object> -- <pathspecs>`, then read each exact object with `git cat-file blob <object-id>` through the injected command runner. Never call `readFile` on a working-tree path. Reject duplicate paths/IDs, non-blob entries, malformed object IDs, schema-invalid canonical files, broken relationships, stale profile-lock references, and active documents that depend only on archive content.

- [ ] **Step 4: Run focused tests and typecheck**

```powershell
npm test -- tests/governance/canonical-snapshot-builder.test.ts
npm run typecheck
```

Expected: PASS for exact historical/current revisions, dirty-working-tree isolation, deterministic blob ordering/hashes, and failure for missing revisions, duplicate IDs, invalid records, broken references, archive-only dependencies, and manual view input.

- [ ] **Step 5: Commit the canonical snapshot builder**

```powershell
git add src/governance/snapshot tests/governance/canonical-snapshot-builder.test.ts tests/fixtures/governance/repositories/snapshot-root
git commit -m "feat(governance): build canonical snapshots"
```

### Task 5: Generate Views and Detect Drift

**Files:**

- Create: `src/governance/views/generate-views.ts`
- Create: `src/governance/views/view-drift.ts`
- Create: `src/governance/views/render-now.ts`
- Create: `src/governance/views/render-handoff.ts`
- Create: `src/governance/views/render-workstreams.ts`
- Create: `src/governance/views/render-changelog.ts`
- Create: `src/governance/views/render-history.ts`
- Create: `src/governance/views/render-index.ts`
- Create: `tests/governance/generated-views.test.ts`
- Create: `tests/governance/view-drift.test.ts`
- Create: `tests/fixtures/governance/views/expected/**`

**Interfaces:** Implements `ViewGenerator`. `GeneratedViewPlan` is a typed `metadata` view over the shared `CanonicalMutationPlan`; `plan` is pure and returns six replacement-mode writes but only the finalizer applies them. `verify` recomputes expected bytes and never repairs drift.

- [ ] **Step 1: Write failing golden-view and manual-edit tests**

```ts
it("renders all six generated views in stable order", () => {
  const result = views.plan(snapshotFixture);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.writes.map(write => write.relative_path)).toEqual([
      "docs/project-memory/views/CHANGELOG.md",
      "docs/project-memory/views/HANDOFF.md",
      "docs/project-memory/views/HISTORY.md",
      "docs/project-memory/views/INDEX.json",
      "docs/project-memory/views/NOW.md",
      "docs/project-memory/views/WORKSTREAMS.md",
    ]);
  }
});

it("reports a manually changed generated view", async () => {
  await replaceNowHeading(root, "Edited by hand");
  const result = await views.verify(root);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.drifted_paths).toContain("docs/project-memory/views/NOW.md");
});
```

- [ ] **Step 2: Run the view tests and confirm failure**

```powershell
npm test -- tests/governance/generated-views.test.ts tests/governance/view-drift.test.ts
```

Expected: FAIL because renderers and drift verification do not exist.

- [ ] **Step 3: Implement deterministic metadata and projection rules**

Every Markdown view must start with this exact generated block:

```markdown
<!-- GENERATED: DO NOT EDIT -->
<!-- source_revision: 0123456789abcdef0123456789abcdef01234567 -->
<!-- profile_version: 1.0.0 -->
<!-- profile_lock_hash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->
<!-- catalog_version: 1.0.0 -->
<!-- catalog_lock_hash: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc -->
<!-- source_set_hash: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb -->
<!-- generated_at: 2026-07-14T12:00:00.000Z -->
```

Sort records by `occurred_at`, then immutable ID. `NOW.md` contains accepted current state, active workstreams, blockers, and next actions. `HANDOFF.md` contains the fixed startup continuation set. `CHANGELOG.md` contains validated change/release records only. `HISTORY.md` contains completed/superseded chronology. `INDEX.json` contains typed nodes, edges, metadata, and hashes.

Every Markdown header and `INDEX.json.metadata` must carry the exact profile version, profile-lock hash, catalog version, and catalog-lock hash from the snapshot; a version/hash mismatch is view drift. `plan` uses the injected `Clock` once and applies that one timestamp to all six outputs. `verify` parses the existing `generated_at` metadata and rerenders with that exact timestamp; it validates source revision and hashes but must not report drift merely because wall-clock time advanced.

- [ ] **Step 4: Run golden tests, update only deliberate fixture bytes, and rerun**

```powershell
npm test -- tests/governance/generated-views.test.ts tests/governance/view-drift.test.ts
npm run typecheck
```

Expected: PASS with byte-for-byte fixture equality, stable ordering, stale-source detection, manual-edit detection, and zero archive-derived current facts.

- [ ] **Step 5: Commit views and drift detection**

```powershell
git add src/governance/views tests/governance/generated-views.test.ts tests/governance/view-drift.test.ts tests/fixtures/governance/views
git commit -m "feat(governance): generate and verify current views"
```

### Task 6: Implement Redacted Content-Addressed Archives

**Files:**

- Create: `src/governance/archive/redactor.ts`
- Create: `src/governance/archive/content-addressed-archive.ts`
- Create: `tests/governance/content-addressed-archive.test.ts`
- Create: `tests/fixtures/governance/archive/clean-session.json`
- Create: `tests/fixtures/governance/archive/secret-bearing-session.txt`

**Interfaces:** Implements `ArchiveStore`. `ArchivePlan` is a typed `metadata` view over the shared `CanonicalMutationPlan`; it stores redacted bytes by SHA-256 and a create-only manifest containing source hash, stored hash, object kind, redaction report, actor, time, and source references.

- [ ] **Step 1: Write failing deduplication and redaction tests**

```ts
it("deduplicates identical redacted bytes", () => {
  const first = archive.planIngest(cleanSessionInput);
  const second = archive.planIngest(cleanSessionInput);
  expect(first.ok && second.ok).toBe(true);
  if (first.ok && second.ok) {
    expect(first.value.object_hash).toBe(second.value.object_hash);
    expect(first.value.object_write.relative_path).toBe(second.value.object_write.relative_path);
  }
});

it("never stores the original secret bytes", () => {
  const result = archive.planIngest(secretSessionInput);
  expect(result.ok).toBe(true);
  if (result.ok) {
    const bytes = new TextDecoder().decode(result.value.object_write.bytes);
    expect(bytes).not.toContain("synthetic-test-credential-value");
    expect(bytes).toContain("[REDACTED:credential-value:");
  }
});
```

- [ ] **Step 2: Run archive tests and verify failure**

```powershell
npm test -- tests/governance/content-addressed-archive.test.ts
```

Expected: FAIL because no archive planner or redactor exists.

- [ ] **Step 3: Implement the exact redaction token and object paths**

```ts
function replacement(ruleId: string, secret: string): string {
  return `[REDACTED:${ruleId}:${sha256(secret).slice(0, 12)}]`;
}

function archiveObjectPath(hash: string): string {
  return `docs/project-memory/archive/objects/sha256/${hash.slice(0, 2)}/${hash}`;
}

function archiveManifestPath(hash: string): string {
  return `docs/project-memory/archive/manifests/${hash}.json`;
}
```

Built-in rules must cover PEM private keys, bearer tokens, common API-key/token/secret/password assignments, and URI credentials. If a match cannot be redacted without destroying the artifact's meaning, return `archive.review_required` and produce no write plan.

- [ ] **Step 4: Run archive verification and tamper tests**

```powershell
npm test -- tests/governance/content-addressed-archive.test.ts
npm run typecheck
```

Expected: PASS for clean input, redacted input, idempotent duplicate input, append-only manifests, changed-object hash failure, path confinement, and review-required refusal.

- [ ] **Step 5: Commit the archive implementation**

```powershell
git add src/governance/archive tests/governance/content-addressed-archive.test.ts tests/fixtures/governance/archive
git commit -m "feat(governance): add redacted content-addressed archives"
```

### Task 7: Enforce Authority and Approval Coverage

**Files:**

- Create: `src/governance/authority/authority-coverage.ts`
- Create: `tests/governance/authority-coverage.test.ts`
- Create: `tests/fixtures/governance/authority/routine-task.json`
- Create: `tests/fixtures/governance/authority/directional-task.json`
- Create: `tests/fixtures/governance/authority/external-action-task.json`

**Interfaces:** Produces `evaluateAuthorityCoverage(input): RuntimeResult<AuthorityCoverage>`. It composes planning validators with governance-only checks for the strictest applicable authority, exact changed paths, destructive deletion, directional acceptance, and external-action scope.

- [ ] **Step 1: Write failing worker-acceptance and approval-drift tests**

```ts
it("rejects worker acceptance of directional state", () => {
  const result = evaluateAuthorityCoverage(workerAcceptedDirectionalTask, context);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0].code).toBe("authority.direction_requires_pitaji");
});

it("rejects an external approval after target drift", () => {
  const result = evaluateAuthorityCoverage(externalActionTask, {
    ...context,
    actual_target: "production-project-b",
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0].code).toBe("approval.target_drift");
});
```

- [ ] **Step 2: Run authority tests and verify failure**

```powershell
npm test -- tests/governance/authority-coverage.test.ts
```

Expected: FAIL because governance authority coverage does not exist.

- [ ] **Step 3: Implement the strict authority ladder and coverage result**

```ts
export const AUTHORITY_RANK = {
  worker: 1,
  validator: 2,
  integrator: 3,
  pitaji: 4,
} as const;

export interface AuthorityCoverage {
  claim_id: string;
  covered_change_ids: readonly string[];
  approval_ids: readonly string[];
  effective_write_paths: readonly string[];
  external_action_allowed: boolean;
  directional_acceptance: "pitaji" | "not_applicable";
}
```

Apply rules in this order: immutable safety/core, root policies/overlays, accepted decisions/approvals, task packet, inference. Lower layers may only narrow. A worker attestation never satisfies acceptance. An absent non-required approval scope is universal; a missing required approval fails closed. Destructive deletion and all directional categories require a valid Pitaji approval record.

- [ ] **Step 4: Run authority and planning validation tests together**

```powershell
npm test -- tests/governance/authority-coverage.test.ts tests/planning/validate-completion-packet.test.ts tests/planning/validate-claim-approval.test.ts
npm run typecheck
```

Expected: PASS for authorized routine implementation and rejection of worker acceptance, expired approval, target/environment/scope/timing drift, missing deletion approval, authority expansion, and external action without approval.

- [ ] **Step 5: Commit authority coverage**

```powershell
git add src/governance/authority tests/governance/authority-coverage.test.ts tests/fixtures/governance/authority
git commit -m "feat(governance): enforce authority coverage"
```

### Task 8: Persist Claims, Detect Conflicts, and Renew Without Mutation

**Files:**

- Create: `src/governance/claims/claim-conflicts.ts`
- Create: `src/governance/claims/claim-store.ts`
- Create: `src/governance/claims/claim-service.ts`
- Create: `tests/governance/claim-service.test.ts`

**Interfaces:** Implements `ClaimService`. `ClaimOperationPlan` is a typed `metadata` view over the shared `CanonicalMutationPlan`; the issued claim file is immutable; heartbeat, renewal, and expiry are append-only governance events folded into `EffectiveClaim`.

- [ ] **Step 1: Write failing overlap, expiry, and renewal tests**

```ts
it("rejects overlapping write paths in one repository", async () => {
  const result = await service.planIssue(secondWriteClaimAgainstExistingFixture);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0].code).toBe("claim.write_conflict");
});

it("allows overlapping reads", async () => {
  const result = await service.planIssue(secondReadClaimAgainstExistingFixture);
  expect(result.ok).toBe(true);
});

it("requires a new claim when the base revision changed", async () => {
  const result = await service.planRenew({
    claim_id: issuedClaim.id,
    requested_by: issuedClaim.issuer,
    current_base_revision: "b".repeat(40),
    requested_expires_at: "2026-07-14T14:00:00.000Z",
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0].code).toBe("claim.base_changed");
});
```

- [ ] **Step 2: Run claim tests and verify failure**

```powershell
npm test -- tests/governance/claim-service.test.ts
```

Expected: FAIL because operational claim persistence and conflict logic are absent.

- [ ] **Step 3: Implement normalized path conflict checks**

```ts
function pathsOverlap(left: string, right: string): boolean {
  const a = normalizeClaimPath(left);
  const b = normalizeClaimPath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function isWriteDuty(duty: string): boolean {
  return duty === "modify" || duty === "release" || duty === "notify";
}
```

Conflict only when repository IDs match, paths overlap, and both claims contain write duties. A coordination exception must reference a valid approval and an explicit coordination ID. Renewal is issuer-only and requires unchanged base, scope, duties, approvals, and no new conflict. Expiry immediately removes mutation authority while preserving the branch and history.

- [ ] **Step 4: Run claim, event-chain, and authority tests**

```powershell
npm test -- tests/governance/claim-service.test.ts tests/governance/append-only-event-store.test.ts tests/governance/authority-coverage.test.ts
npm run typecheck
```

Expected: PASS for plan-only issue/heartbeat/renewal/expiry, effective state, issuer renewal, automatic expiry, read overlap, coordinated exception, all conflict/authority failures, and no direct canonical writes.

- [ ] **Step 5: Commit claim operations**

```powershell
git add src/governance/claims tests/governance/claim-service.test.ts
git commit -m "feat(governance): manage concurrent claims"
```

### Task 9: Implement the Shared-Git-Directory Integration Lease

**Files:**

- Create: `src/governance/integration/integration-lease-store.ts`
- Create: `tests/governance/integration-lease-store.test.ts`
- Create: `tests/fixtures/governance/gates/lease-contender.mjs`

**Interfaces:** Implements `IntegrationLeaseStore`. All worktrees resolve the same lease through `GitClient.commonGitDir`. Mutating lease operations serialize through an atomic `mkdir` mutex and compare holder plus nonce before change. A governance-owned injected `NonceSource` supplies cryptographically random production nonces and fixed test nonces.

- [ ] **Step 1: Write failing cross-worktree and takeover tests**

```ts
it("allows exactly one lease holder across concurrent worktrees", async () => {
  const attempts = await Promise.all(
    Array.from({ length: 16 }, (_, index) => spawnLeaseContender(repo, `integrator-${index}`)),
  );
  expect(attempts.filter(attempt => attempt.ok)).toHaveLength(1);
});

it("rejects takeover without Pitaji or designated-owner approval", async () => {
  await store.acquire(validAcquireInput);
  const result = await store.takeover({
    ...validTakeoverInput,
    approval: unrelatedActorApproval,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0].code).toBe("lease.takeover_not_approved");
});
```

- [ ] **Step 2: Run the lease test and verify failure**

```powershell
npm test -- tests/governance/integration-lease-store.test.ts
```

Expected: FAIL because the shared lease store does not exist.

- [ ] **Step 3: Implement atomic acquisition and holder-token checks**

```ts
function leaseUrl(commonGitDir: URL): URL {
  return new URL("project-memory/integration-lease.json", ensureDirectoryUrl(commonGitDir));
}

function mutexUrl(commonGitDir: URL): URL {
  return new URL("project-memory/integration-lease.mutex/", ensureDirectoryUrl(commonGitDir));
}

function holderMatches(lease: IntegrationLease, token: LeaseToken): boolean {
  return lease.holder_id === token.holder_id && lease.nonce === token.nonce;
}

export interface NonceSource {
  nextNonce(): string;
}
```

Acquisition records holder, authority, base revision, target ref, acquired time, heartbeat, expiry, and nonce. Heartbeat fails after expiry or base/ref drift. Release is holder-and-nonce only. Existing lease takeover requires approval from Pitaji or the repository-designated human integration owner recorded in accepted root policy, and yields a create-only `lease_taken_over` event plus audit evidence for later integration.

The operation mutex contains holder, nonce, acquired time, and a 30-second expiry. If its owning process crashes, a contender may atomically rename the expired mutex directory to a generated quarantine name and retry. It may never use mutex recovery to take over the integration lease itself. Tests must kill a contender process after mutex acquisition and prove a later contender recovers only the mutex.

- [ ] **Step 4: Run concurrency tests repeatedly**

```powershell
1..10 | ForEach-Object { npm test -- tests/governance/integration-lease-store.test.ts }
npm run typecheck
```

Expected: all ten runs pass; every run has one winner, fifteen `lease.already_held` results, no partial JSON, recovery from a killed mutex holder, and no abandoned mutex after test cleanup.

- [ ] **Step 5: Commit the integration lease**

```powershell
git add src/governance/integration/integration-lease-store.ts tests/governance/integration-lease-store.test.ts tests/fixtures/governance/gates/lease-contender.mjs
git commit -m "feat(integration): serialize canonical integration"
```

### Task 10: Finalize Canonical Mutation Plans and Govern Work Lifecycles

**Files:**

- Create: `src/governance/integration/canonical-mutation-finalizer.ts`
- Create: `src/governance/work/work-lifecycle-service.ts`
- Create: `tests/governance/canonical-mutation-finalizer.test.ts`
- Create: `tests/governance/work-lifecycle-service.test.ts`
- Create: `tests/fixtures/governance/repositories/mutations/**`

**Interfaces:** Implements `IntegrationCoordinator.finalizeMutation` and `WorkLifecycleService`. Work lifecycle planning consumes the shared parse/render canonical Markdown codec for `initiatives/<id>/INITIATIVE.md`, `workstreams/<id>/WORKSTREAM.md`, and task documents, preserving their strict canonical format. Record, claim, generated-view, archive, initiative, workstream, task-packet, and administrative services may only produce immutable `CanonicalMutationPlan` values (or typed metadata views/builders over that plan). Only the coordinator may acquire the short-lived lease, apply their writes, create a commit, and compare-and-swap a canonical ref.

- [ ] **Step 1: Write failing plan-only, lifecycle, and CAS tests**

```ts
it("does not mutate while planning an initiative", async () => {
  const before = await git.resolveRef(root, input.target_ref);
  const plan = mustValue(await lifecycle.planCreateInitiative(createInitiativeInput));
  expect(plan.mutation_kind).toBe("work_lifecycle");
  expect(await git.resolveRef(root, input.target_ref)).toBe(before);
  expect(await exists(root, "docs/project-memory/initiatives/INIT-01J0000000000000000000001/INITIATIVE.md")).toBe(false);
});

it("persists a planned lifecycle transition only through the coordinator", async () => {
  const plan = mustValue(await lifecycle.planTransition(activateWorkstreamInput));
  const receipt = await coordinator.finalizeMutation(plan);
  expect(receipt.ok).toBe(true);
  if (receipt.ok) {
    expect(receipt.value.status).toBe("mutation_integrated");
    expect(await git.resolveRef(root, plan.target_ref)).toBe(receipt.value.commit_revision);
  }
});

it.each([claimPlan, viewPlan, archivePlan, adminPlan])(
  "keeps %s writes unapplied until finalizeMutation",
  async plan => {
    expect(await mutationWritesExist(root, plan)).toBe(false);
    mustValue(await coordinator.finalizeMutation(plan));
    expect(await mutationWritesExist(root, plan)).toBe(true);
  },
);
```

Add fault tests after lease acquisition, worktree creation, write application, repository validation, tree write, and before ref update. Every failure must preserve the expected ref and leave no lease, mutex, or temporary worktree.

- [ ] **Step 2: Run the focused tests and confirm the coordinator is absent**

```powershell
npm test -- tests/governance/canonical-mutation-finalizer.test.ts tests/governance/work-lifecycle-service.test.ts
```

Expected: FAIL because canonical mutation finalization and work lifecycle planning do not exist.

- [ ] **Step 3: Consume the shared immutable mutation contract**

```ts
import type { CanonicalMutationPlan } from "../../contracts/canonical-mutation-plan.js";
import { canonicalMutationPlanHash } from "../../contracts/canonical-mutation-plan.js";

export interface MutationReceipt {
  status: "mutation_integrated";
  plan_id: string;
  plan_hash: string;
  previous_revision: string;
  commit_revision: string;
  audit_evidence_id: string;
  derived_view_hashes: Readonly<Record<string, string>>;
  audit_artifact_hashes: Readonly<Record<string, string>>;
  integrated_at: string;
}

export interface RecordMutationMetadata {
  governance_kind: "record";
  record_type: CanonicalRecord["type"];
}
```

The foundation contract is used unchanged, including its complete mutation-kind union and `metadata` field. `RecordMutationPlan`, `GeneratedViewPlan`, `ArchivePlan`, `ClaimOperationPlan`, and work-lifecycle plan types are typed metadata views/builders over `CanonicalMutationPlan`; they put governance-specific discriminants in `metadata` and do not redeclare, narrow, extend, or hash the shared envelope locally. Reject an expired plan, a `canonicalMutationPlanHash` mismatch, duplicate/overlapping writes, a path outside the repository, a target/head or profile-lock mismatch, missing approvals/evidence, direct edits to immutable history, or a write whose expected-existing hash drifted. Planning reads canonical state but performs no filesystem or Git mutation.
- [ ] **Step 4: Implement lifecycle transitions and coordinator-owned persistence**

```ts
const ALLOWED_WORK_TRANSITIONS = {
  initiative: {
    proposed: ["accepted", "cancelled"],
    accepted: ["active", "cancelled"],
    active: ["paused", "completed", "cancelled"],
    paused: ["active", "cancelled"],
    completed: [],
    cancelled: [],
  },
  workstream: {
    planned: ["active", "cancelled"],
    active: ["blocked", "completed", "cancelled"],
    blocked: ["active", "cancelled"],
    completed: [],
    cancelled: [],
  },
  task_packet: {
    issued: ["claimed", "cancelled"],
    claimed: ["in_progress", "returned", "cancelled"],
    in_progress: ["submitted", "returned"],
    submitted: ["validated", "returned"],
    validated: ["integrated_verified", "returned"],
    returned: ["claimed", "cancelled"],
    integrated_verified: [],
    cancelled: [],
  },
} as const;
```

`planCreateInitiative`, `planCreateWorkstream`, and `planCreateTaskPacket` validate their owner/profile schemas and return create-only document plus event writes. Task packets consume the planning-owned schema and cannot invent gates, approvals, or authority. `planTransition` validates the map above, current Git revision, actor authority, prerequisite evidence, and terminal-state immutability; it emits an append-only event and replacement of only the current work document.

`finalizeMutation` first validates the shared plan without mutation; `plan_hash` binds exactly the caller-supplied envelope, metadata, and writes. It then acquires the short-lived lease for the exact target/head, revalidates hash/expiry/head/profile/authority, creates an isolated worktree, and stages the caller's source writes. From that staged source state it writes an exact pre-view tree, builds the canonical snapshot from that tree object, plans and applies all six generated views, and adds deterministic immutable audit evidence. It verifies records, events, archive manifests, views, and cross-references; validates the complete staged repository; creates one commit; and compare-and-swap updates the target ref. The receipt binds the deterministic hashes of every derived view and audit artifact, keeping those derived bytes out of the caller plan hash and avoiding circular hashing. Lease and worktree cleanup runs in `finally`. The `profile.bootstrap` and normal task-finalization branches use this same implementation and add only their stricter preflight/post-write validations, so claim, lifecycle, migration, import, and administrative mutations cannot leave generated views stale.

```powershell
npm test -- tests/governance/canonical-mutation-finalizer.test.ts tests/governance/work-lifecycle-service.test.ts tests/governance/claim-service.test.ts tests/governance/generated-views.test.ts tests/governance/content-addressed-archive.test.ts
npm run typecheck
```

Expected: PASS for every legal lifecycle, every illegal/terminal transition, plan-only producers, coordinator-only application, one-commit CAS success, stale/expired/unauthorized plans, and the complete injected-fault matrix.

- [ ] **Step 5: Commit mutation coordination and work lifecycle**

```powershell
git add src/governance/integration/canonical-mutation-finalizer.ts src/governance/work tests/governance/canonical-mutation-finalizer.test.ts tests/governance/work-lifecycle-service.test.ts tests/fixtures/governance/repositories/mutations
git commit -m "feat(governance): coordinate canonical mutations"
```

### Task 11: Run Gates Without Shell Interpretation and Build Audit Evidence

**Files:**

- Create: `src/governance/integration/gate-runner.ts`
- Create: `src/governance/integration/audit-evidence.ts`
- Create: `tests/governance/gate-runner.test.ts`
- Create: `tests/governance/audit-evidence.test.ts`
- Create: `tests/fixtures/governance/gates/echo-args.mjs`
- Create: `tests/fixtures/governance/gates/emit-secret.mjs`

**Interfaces:** `GateRunner` imports and consumes the planning-owned `ResolvedGateExecution` directly plus optional governance-owned `SubmittedCheckEvidence`; it validates the packet-owned `evidence_type` before accepting evidence and performs no catalog or registry lookup. `AuditEvidenceBuilder` converts gate results, claims, approvals, bases, commits, files, view hashes, and archive receipts into one immutable `EVD-` record and integration audit manifest.

- [ ] **Step 1: Write failing literal-argument and evidence tests**

```ts
it("passes metacharacters as literal arguments", async () => {
  const result = await runner.run(root, {
    id: "gate.literal-args",
    definition_ref: "project-memory/gates/literal-args@1",
    required: true,
    conflict_sensitive: true,
    evidence_type: "test-result",
    execution: {
      kind: "command",
      executable: process.execPath,
      args: [echoArgsScript, "a;b", "$HOME", "x&y"],
      cwd: ".",
      timeout_ms: 5_000,
      env_allowlist: {},
    },
  });
  expect(result.ok).toBe(true);
  if (result.ok) expect(JSON.parse(result.value.stdout_redacted)).toEqual(["a;b", "$HOME", "x&y"]);
});

it("blocks a required check when verifier evidence is absent", async () => {
  const result = await runner.run(root, requiredExternalCheck);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0].code).toBe("gate.required_check_not_run");
});

it("rejects submitted evidence of the wrong packet-owned evidence type", async () => {
  const result = await runner.run(root, requiredExternalCheck, wrongTypeCheckEvidence);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0].code).toBe("gate.evidence_type_mismatch");
});
```

- [ ] **Step 2: Run gate tests and verify failure**

```powershell
npm test -- tests/governance/gate-runner.test.ts tests/governance/audit-evidence.test.ts
```

Expected: FAIL because gate execution and audit evidence do not exist.

- [ ] **Step 3: Implement structured gate execution**

The wrapper below is owned and exported by `src/planning/types.ts`. Keep these as compile-time contract examples in the gate-runner test; do not redeclare the wrapper or emit a governance schema for it.

```ts
const commandGateContractExample = {
  id: "gate.regression",
  definition_ref: "adapter.flutter.test@1.0.0",
  required: true,
  conflict_sensitive: true,
  evidence_type: "test-result",
  execution: {
    kind: "command",
    executable: "flutter",
    args: ["test"],
    cwd: ".",
    timeout_ms: 600_000,
    env_allowlist: {},
  },
} satisfies ResolvedGateExecution;

const externalCheckGateContractExample = {
  id: "gate.release-review",
  definition_ref: "adapter.release.human-review@1.0.0",
  required: true,
  conflict_sensitive: true,
  evidence_type: "human-verification",
  execution: {
    kind: "check",
    instruction: "Verify the production release checklist against the prepared commit.",
    verifier_role: "external",
    approval_refs: ["APR-01J00000000000000000000001"],
  },
} satisfies ResolvedGateExecution;

export interface SubmittedCheckEvidence {
  gate_id: string;
  verifier_role: string;
  evidence_type: string;
  status: "passed" | "failed" | "not_run";
  exact_result: string;
  evidence_ids: readonly string[];
  approval_refs: readonly string[];
  occurred_at: string;
}
```

Planning/materialization has already resolved the catalog definition before the packet reaches governance. Governance validates that `id`, `definition_ref`, `evidence_type`, and `execution` are present, but performs no runtime registry lookup. For a command execution, resolve `cwd` through `resolveInside`, construct a foundation `CommandSpec`, and pass `executable`, literal `args`, timeout, and allowlisted environment to the injected foundation command runner. Never parse `instruction` or any packet text as a command. For a check execution, accept evidence only when its `gate_id`, `verifier_role`, and `evidence_type` exactly match the packet gate; an external check must also carry approval refs that pass authority validation. Missing or invalid required evidence is `not_run` and blocks integration. Redact captured stdout/stderr before persistence while preserving their original hashes.

- [ ] **Step 4: Build complete audit evidence and run tests**

Audit evidence must contain task/workstream/claim IDs, original and integration bases, worker head, changed paths, authorization refs, approval IDs, lease holder/nonce hash, exact gate IDs, definition refs, evidence types, and statuses, command/verifier identity, exit code, redacted results, original result hashes, evidence IDs, profile/catalog versions and lock hashes, generated-view hashes, completion/archive source, stored, and manifest hashes with redaction reports, prepared/final commit hashes, checks not run with reasons, and remaining risks.

```powershell
npm test -- tests/governance/gate-runner.test.ts tests/governance/audit-evidence.test.ts
npm run typecheck
```

Expected: PASS for literal arguments, timeout, bounded output, environment allowlist, secret redaction, verifier-role checks, external-check approval validation, evidence-type mismatch rejection, required not-run failure, no registry lookup, and byte-stable evidence.

- [ ] **Step 5: Commit gate execution and audit evidence**

```powershell
git add src/governance/integration/gate-runner.ts src/governance/integration/audit-evidence.ts tests/governance/gate-runner.test.ts tests/governance/audit-evidence.test.ts tests/fixtures/governance/gates
git commit -m "feat(integration): run safe gates and record evidence"
```

### Task 12: Reconcile Stale Bases in Isolated Worktrees

**Files:**

- Create: `src/governance/integration/integration-git-client.ts`
- Create: `src/governance/integration/stale-base-reconciler.ts`
- Create: `tests/governance/stale-base-reconciler.test.ts`
- Create: `tests/fixtures/governance/repositories/stale-base/**`

**Interfaces:** `IntegrationGitClient` extends the read-only foundation `GitClient` with literal-argument Git operations required for prepared commits and compare-and-swap refs. `StaleBaseReconciler` returns `ready` or `return_to_worker`; it never resolves semantic conflicts by inference.

- [ ] **Step 1: Write failing clean-replay and semantic-conflict tests**

```ts
it("replays a non-conflicting worker commit on the current integration head", async () => {
  const result = await reconciler.reconcile(nonConflictingInput);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.status).toBe("ready");
    expect(result.value.integration_base_revision).toBe(nonConflictingInput.integration_head);
  }
});

it("returns work when accepted decision inputs changed", async () => {
  const result = await reconciler.reconcile(changedDecisionInput);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.status).toBe("return_to_worker");
    expect(result.value.reason_codes).toContain("stale.semantic_conflict");
  }
});
```

- [ ] **Step 2: Run the stale-base test and confirm failure**

```powershell
npm test -- tests/governance/stale-base-reconciler.test.ts
```

Expected: FAIL because the integration Git client and reconciler are absent.

- [ ] **Step 3: Implement literal Git operations and isolated replay**

```ts
export interface IntegrationGitClient extends GitClient {
  resolveRef(repo: URL, ref: string): Promise<string>;
  listTree(repo: URL, revision: string, pathspec: string): Promise<readonly string[]>;
  listCommits(repo: URL, base: string, head: string): Promise<readonly string[]>;
  cherryPickNoCommit(worktree: URL, commit: string): Promise<CommandResult>;
  stageAll(worktree: URL): Promise<void>;
  writeTree(worktree: URL): Promise<string>;
  commitTree(repo: URL, tree: string, parent: string, message: string): Promise<string>;
  updateRef(repo: URL, ref: string, next: string, expected: string): Promise<boolean>;
}
```

Create a detached worktree at the current integration head under a generated temporary directory. Replay worker commits in original order with `git cherry-pick --no-commit <sha>` through `runCommand`; never use a shell command string. Always remove the generated worktree in `finally`.

- [ ] **Step 4: Apply current-base evidence rules**

Rerun every conflict-sensitive gate. Carry a non-conflict-sensitive evidence item only with its original evidence ID, source revision, original result hash, and an explicit applicability statement. Return work when changed canonical decisions, profile locks, authority, claimed scope, behavior, or evidence validity alter intent. A clean textual replay alone is insufficient.

```powershell
npm test -- tests/governance/stale-base-reconciler.test.ts
npm run typecheck
```

Expected: PASS for current-base work, clean stale replay, textual conflict, semantic conflict, required gate rerun, provenance-preserving carry-forward, failed applicability, and temporary-worktree cleanup.

- [ ] **Step 5: Commit stale-base reconciliation**

```powershell
git add src/governance/integration/integration-git-client.ts src/governance/integration/stale-base-reconciler.ts tests/governance/stale-base-reconciler.test.ts tests/fixtures/governance/repositories/stale-base
git commit -m "feat(integration): reconcile stale work safely"
```

### Task 13: Bootstrap an Uninitialized Repository Atomically

**Files:**

- Create: `src/governance/integration/bootstrap-finalizer.ts`
- Create: `tests/governance/bootstrap-finalizer.test.ts`
- Create: `tests/governance/bootstrap-fault-injection.test.ts`
- Create: `tests/fixtures/governance/repositories/bootstrap/**`

**Interfaces:** Adds the one-time bootstrap implementation behind `IntegrationCoordinator.bootstrap`. The CLI-owned `init apply` command recomputes its `InitPlan` and passes the approved compilation inputs here; governance owns the atomic Git transaction. This task does not create CLI code and never routes bootstrap through normal task-packet `validate` or `finalize`.

- [ ] **Step 1: Write failing one-commit, rerun, and fault-injection tests**

```ts
it("creates one initialization commit without a task packet", async () => {
  const before = await git.resolveRef(repo, validBootstrapInput.target_ref);
  const result = await coordinator.bootstrap(validBootstrapInput);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.status).toBe("initialized_verified");
    expect(result.value.previous_revision).toBe(before);
    expect(await git.resolveRef(repo, validBootstrapInput.target_ref)).toBe(result.value.commit_revision);
    expect(await git.commitCount(repo, before, result.value.commit_revision)).toBe(1);
    expect(await readJsonAt(repo, result.value.commit_revision, result.value.audit_path)).toMatchObject({
      root_id: validBootstrapInput.root_id,
      approval_record_id: validBootstrapInput.approval_record.id,
      compilation_plan_hash: validBootstrapInput.expected_plan_hash,
    });
  }
});

it("fails closed when initialization is rerun", async () => {
  mustValue(await coordinator.bootstrap(validBootstrapInput));
  const before = await git.resolveRef(repo, validBootstrapInput.target_ref);
  const second = await coordinator.bootstrap(validBootstrapInput);
  expect(second.ok).toBe(false);
  if (!second.ok) expect(second.issues[0].code).toBe("bootstrap.already_initialized");
  expect(await git.resolveRef(repo, validBootstrapInput.target_ref)).toBe(before);
});

it.each([
  "after_lease",
  "after_plan_validation",
  "after_compilation_writes",
  "after_profile_verification",
  "after_audit_writes",
  "after_view_generation",
  "after_repository_validation",
  "after_tree_write",
  "before_ref_update",
] as const)("leaves the target ref unchanged on bootstrap fault %s", async faultPoint => {
  const before = await git.resolveRef(repo, validBootstrapInput.target_ref);
  const faultedCoordinator = createCoordinator({
    faultInjector: new ThrowingFaultInjector(faultPoint),
  });
  const result = await faultedCoordinator.bootstrap(validBootstrapInput);
  expect(result.ok).toBe(false);
  expect(await git.resolveRef(repo, validBootstrapInput.target_ref)).toBe(before);
});
```

Add focused cases for non-Git input, dirty tracked or untracked state, missing target ref, head mismatch, any existing tracked `docs/project-memory/**` path, existing `PROJECT_CONTEXT.md`, plan-hash drift, write-precondition drift, non-Pitaji approval, approval scope/timing drift, secret-bearing planned bytes, profile/catalog/schema/source verification failure, and compare-and-swap loss.

- [ ] **Step 2: Run bootstrap tests and confirm the API is absent**

```powershell
npm test -- tests/governance/bootstrap-finalizer.test.ts tests/governance/bootstrap-fault-injection.test.ts
```

Expected: FAIL because `IntegrationCoordinator.bootstrap` and the bootstrap finalizer do not exist.

- [ ] **Step 3: Implement deterministic input binding and fail-closed preconditions**

```ts
export interface BootstrapInput {
  root: URL;
  target_ref: string;
  expected_head: string;
  root_id: string;
  accepted_sources: AcceptedProfileSourceSet;
  compilation_plan: CanonicalMutationPlan;
  expected_plan_hash: string;
  source_proposal_hash: string;
  approval_record: CanonicalRecord;
}

export interface BootstrapFinalization {
  schema_version: "1.0.0";
  status: "initialized_verified";
  root_id: string;
  target_ref: string;
  previous_revision: string;
  commit_revision: string;
  compilation_plan_hash: string;
  source_proposal_hash: string;
  profile_lock_hash: string;
  approval_record_id: string;
  audit_record_id: string;
  audit_path: string;
  audit_hash: string;
  generated_view_hashes: Readonly<Record<string, string>>;
}

```

Before any lease or worktree mutation: prove the root is a Git repository, `statusPorcelain(root)` is empty, `target_ref` resolves exactly to `expected_head`, and the target tree contains neither `docs/project-memory/**` nor `PROJECT_CONTEXT.md`. Require `compilation_plan.mutation_kind === "profile.bootstrap"` and exact root/ref/head bindings; recompute it with the shared `canonicalMutationPlanHash`, require both `compilation_plan.plan_hash` and `expected_plan_hash` to match, and validate every planned-write compare-and-swap precondition plus `source_proposal_hash === sha256(canonicalJson(accepted_sources))`. Scan every candidate written byte; any credential match returns `bootstrap.secret_detected` without redacting or writing.

The approval record must be an accepted `approval` record issued by Pitaji and valid now. Its target/environment/scope must bind the repository, target ref, root ID, exact profile-lock hash, source-proposal hash, and compilation-plan hash. Missing or broader inferred authority fails closed. `bootstrap` performs these read-only preflights, builds the bound `profile.bootstrap` plan, and calls `finalizeMutation` exactly once; it does not acquire a lease or create a worktree. Inside the finalizer's `profile.bootstrap` branch, the coordinator acquires the shared lease and repeats the ref/head and no-existing-memory checks to close the race. Normal task-packet completion, claim, and gate validators are not called on this branch.

- [ ] **Step 4: Build the bootstrap mutation and delegate exactly once**

`bootstrap` builds an augmented `profile.bootstrap` `CanonicalMutationPlan` from the compiler-owned profile/source writes plus planned approval, `bootstrap_initialized` event, and canonical `EVD-` evidence writes, with bootstrap-specific audit inputs in `metadata`; it then calls `finalizeMutation` exactly once. It never calls `ProfileCompiler.apply`, acquires a lease, creates a worktree, stages bytes, commits, or updates a ref. The caller plan hash binds those supplied writes and metadata. The evidence binds the parent revision, target ref, plan/source/profile/catalog hashes, exact planned paths and content hashes, approval ID, checks, and remaining risks.

Inside `canonical-mutation-finalizer` only, the `mutation_kind: "profile.bootstrap"` branch stages the supplied writes, runs `ProfileVerifier.verify`, and verifies schema-valid project/profile/catalog locks, vendored catalog closure/hashes, exact accepted source artifacts, approval/evidence records, and absence of secrets. The shared finalizer then writes the exact pre-view source tree, builds the initial canonical snapshot from that tree object, plans/applies and drift-checks all six views, and derives a schema-valid create-only `BootstrapAuditManifest` at `docs/project-memory/governance/integration/bootstrap/<root-id>.json`. The manifest references approval/evidence IDs and contains generated-view hashes plus `bootstrap_content_hash` over caller writes; the mutation receipt binds the deterministic derived view and manifest hashes. The manifest does not embed its own tree or final commit hash. The shared finalizer validates the complete staged repository, creates one commit with parent `expected_head`, compare-and-swap updates only `target_ref`, and cleans lease/worktree state in `finally`.

A failure before ref update may leave an unreachable Git object but no canonical ref movement, bootstrap marker, partial memory tree, prepared ref, or false success. A rerun after success and any pre-existing root memory return `bootstrap.already_initialized` without mutation; bootstrap never merges with or repairs existing memory.

```powershell
npm test -- tests/governance/bootstrap-finalizer.test.ts tests/governance/bootstrap-fault-injection.test.ts
npm run typecheck
```

Expected: PASS for one-commit initialization and every fail-closed case; every injected fault preserves the target ref and cleans the lease, mutex, and worktree.

- [ ] **Step 5: Commit the bootstrap integration path**

```powershell
git add src/governance/integration/bootstrap-finalizer.ts tests/governance/bootstrap-finalizer.test.ts tests/governance/bootstrap-fault-injection.test.ts tests/fixtures/governance/repositories/bootstrap
git commit -m "feat(integration): bootstrap roots atomically"
```

### Task 14: Finalize a Single Repository Atomically With Fault Injection

**Files:**

- Create: `src/governance/integration/single-repo-finalizer.ts`
- Create: `src/governance/integration/integration-coordinator.ts`
- Create: `tests/governance/single-repo-finalizer.test.ts`
- Create: `tests/governance/single-repo-fault-injection.test.ts`
- Create: `tests/fixtures/governance/repositories/single-repo/**`

**Interfaces:** Completes `IntegrationCoordinator`: `bootstrap` delegates only to the Task 13 bootstrap finalizer, while `validate` is read-only and returns a short-lived `ValidatedIntegration` bound to lease nonce, expected head, packet hash, completion hash, approval hashes, and gate-evidence hashes. `finalize` rejects any changed binding.

- [ ] **Step 1: Write failing happy-path and fault-matrix tests**

```ts
it("creates one integrated_verified commit", async () => {
  const validated = mustValue(await finalizer.validate(validInput));
  const result = await finalizer.finalize(validated);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.status).toBe("integrated_verified");
    expect(await git.head(repo)).toBe(result.value.commit_revision);
  }
});

it.each([
  "after_lease",
  "after_reconcile",
  "after_gates",
  "after_completion_archive",
  "after_record_plan",
  "after_view_plan",
  "after_tree_write",
  "before_ref_update",
] as const)("leaves the canonical ref unchanged on %s failure", async faultPoint => {
  const before = await git.head(repo);
  const faultedFinalizer = createFinalizer({ faultInjector: new ThrowingFaultInjector(faultPoint) });
  const result = await faultedFinalizer.finalize(validatedFixture);
  expect(result.ok).toBe(false);
  expect(await git.head(repo)).toBe(before);
});

it("archives the completion packet with redaction and audit linkage", async () => {
  const validated = mustValue(await finalizer.validate(inputWithSecretBearingCompletionEvidence));
  const receipt = mustValue(await finalizer.finalize(validated));
  const audit = await readAudit(repo, receipt.evidence_id);
  const manifest = await readArchiveManifest(repo, audit.completion_archive_manifest_hash);
  expect(manifest.source_hash).toBe(sha256(canonicalJson(inputWithSecretBearingCompletionEvidence.completion)));
  expect(manifest.redaction_report.matches).toBeGreaterThan(0);
  expect(await readArchiveObject(repo, manifest.stored_hash)).not.toContain("synthetic-test-secret");
  expect(audit.archive_manifest_hashes).toContain(manifest.manifest_hash);
});
```

- [ ] **Step 2: Run finalization tests and verify failure**

```powershell
npm test -- tests/governance/single-repo-finalizer.test.ts tests/governance/single-repo-fault-injection.test.ts
```

Expected: FAIL because the finalizer does not exist.

- [ ] **Step 3: Implement the exact validation order**

```ts
const FINALIZATION_PHASES = [
  "lease",
  "head_and_hashes",
  "claim_and_authority",
  "stale_base",
  "completion_and_gates",
  "completion_archive",
  "records_and_events",
  "views",
  "staged_repository_validation",
  "commit_tree",
  "compare_and_swap_ref",
] as const;
```

`validate` never synthesizes a profile or task packet: an uninitialized root returns `integration.bootstrap_required` without acquiring a normal-finalization lease, and callers must use `bootstrap`. Acquire the shared lease first. Recheck target ref/head, profile-lock hash, packet/completion hashes, claim, approvals, authority, and completion validity. Reconcile stale work. Run required gates. Canonicalize the submitted completion packet and pass its exact bytes through `ArchiveStore.planIngest`; include the redacted archive object, content-addressed manifest, and archive receipt in the same finalization mutation. Assert that no unredacted secret-bearing completion bytes appear in records, events, views, audit, or other writes. Plan records, events, and audit evidence in the integration worktree, stage them, and obtain an exact pre-view source tree object. Build views only from that tree object, then stage the views and validate the entire repository. Create one commit tree and update the target ref only with `update-ref <ref> <new> <expected>`. Mark the task `integrated_verified` in that commit. Release the lease in `finally`.

- [ ] **Step 4: Verify every pre-ref failure preserves canonical state**

```powershell
npm test -- tests/governance/single-repo-finalizer.test.ts tests/governance/single-repo-fault-injection.test.ts
npm run typecheck
```

Expected: PASS for one-commit success, `integration.bootstrap_required` on an uninitialized root, redacted completion-packet archival with verified object/manifest hashes and audit links; failure for stale lease/head/hash/claim/approval/gate/archive/view; unchanged target ref at every injected fault; no leaked worktree/mutex; and an auditable failure result without a false canonical completion.

- [ ] **Step 5: Commit atomic single-repository finalization**

```powershell
git add src/governance/integration/single-repo-finalizer.ts src/governance/integration/integration-coordinator.ts tests/governance/single-repo-finalizer.test.ts tests/governance/single-repo-fault-injection.test.ts tests/fixtures/governance/repositories/single-repo
git commit -m "feat(integration): finalize one repository atomically"
```

### Task 15: Implement Two-Phase Cross-Repository Finalization and Recovery

**Files:**

- Create: `src/governance/integration/satellite-preparer.ts`
- Create: `src/governance/integration/hub-finalizer.ts`
- Create: `src/governance/integration/integration-recovery.ts`
- Create: `tests/governance/multi-repo-finalization.test.ts`
- Create: `tests/fixtures/governance/repositories/multi-repo/hub/**`
- Create: `tests/fixtures/governance/repositories/multi-repo/satellite-a/**`
- Create: `tests/fixtures/governance/repositories/multi-repo/satellite-b/**`

**Interfaces:** Implements `MultiRepoFinalizer`. Preparation creates immutable commit/packet/manifest hashes. Hub finalization references them exactly and is the only operation that marks root tasks `integrated_verified`.

- [ ] **Step 1: Write failing two-phase and recovery tests**

```ts
it("keeps satellites prepared until the hub commit references them", async () => {
  const prepared = mustValue(await finalizer.prepareSatellite(satelliteInput));
  expect(prepared.state).toBe("prepared");
  expect(await taskState(hub, prepared.task_id)).not.toBe("integrated_verified");
});

it("finalizes exact immutable satellite commits in one hub commit", async () => {
  const first = mustValue(await finalizer.prepareSatellite(firstSatelliteInput));
  const second = mustValue(await finalizer.prepareSatellite(secondSatelliteInput));
  const result = await finalizer.finalizeHub(hubInput([first, second]));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.satellite_commit_hashes).toEqual([first.commit_hash, second.commit_hash].sort());
});

it("leaves prepared commits unfinalized after hub failure", async () => {
  const prepared = mustValue(await finalizer.prepareSatellite(satelliteInput));
  const result = await finalizer.finalizeHub(staleHubInput([prepared]));
  expect(result.ok).toBe(false);
  expect((await finalizer.inspectRecovery({ hub, prepared: [prepared] })).value?.state).toBe("prepared_unfinalized");
});
```

- [ ] **Step 2: Run multi-repository tests and verify failure**

```powershell
npm test -- tests/governance/multi-repo-finalization.test.ts
```

Expected: FAIL because satellite preparation, hub finalization, and recovery inspection are absent.

- [ ] **Step 3: Implement immutable prepared manifests**

```ts
export interface PreparedSatellite {
  schema_version: "1.0.0";
  root_id: string;
  repository_id: string;
  task_id: string;
  packet_id: string;
  state: "prepared";
  original_base_revision: string;
  integration_base_revision: string;
  commit_hash: string;
  manifest_hash: string;
  manifest_ref: string;
  task_packet_hash: string;
  completion_packet_hash: string;
  profile_version: string;
  profile_lock_hash: string;
  catalog_version: string;
  catalog_lock_hash: string;
  approval_ids: readonly string[];
  evidence_ids: readonly string[];
  gate_evidence_hashes: readonly string[];
  changed_paths: readonly string[];
  artifact_hashes: Readonly<Record<string, string>>;
  generated_view_hashes: Readonly<Record<string, string>>;
  archive_manifest_hashes: readonly string[];
  audit_evidence_id: string;
  prepared_at: string;
  prepared_by: string;
}
```

Create the immutable work commit first. Compute `manifest_hash` from canonical manifest JSON with only `manifest_hash` omitted. Then create a metadata commit whose parent is that exact work commit and whose sole prepared artifact is `docs/project-memory/governance/integration/prepared/<packet-id>/<manifest-hash>.json`; this avoids embedding a commit hash inside the commit it hashes. Keep the metadata commit reachable through `refs/project-memory/prepared/<packet-id>/<manifest-hash>`. The hub verifies the ref, metadata-commit parent, work commit, packet and manifest hashes, both bases, profile/catalog versions and lock hashes, approvals, evidence/gates, changed paths, artifacts, views, completion archive manifests, actor, and time. Any mismatch invalidates preparation; never rewrite either commit or ref key.

- [ ] **Step 4: Implement hub verification and idempotent recovery**

The hub finalizer acquires the hub lease, verifies every exact satellite object and manifest, verifies current-base compatibility and authority, plans finalization/audit records and views, then creates one hub commit. A failed hub commit leaves all satellites prepared. Re-running the same successful finalization returns the existing receipt; a correction uses a new task packet, new prepared commit, and new manifest.

```powershell
npm test -- tests/governance/multi-repo-finalization.test.ts
npm run typecheck
```

Expected: PASS for two satellites/one hub, exact packet-id plus manifest-hash keys, metadata-parent/work-commit and full-metadata verification, deterministic manifest order, idempotent retry, stale hub, missing object, rewritten commit, failed gate, prepared-unfinalized recovery, and successful finalization.

- [ ] **Step 5: Commit cross-repository finalization**

```powershell
git add src/governance/integration/satellite-preparer.ts src/governance/integration/hub-finalizer.ts src/governance/integration/integration-recovery.ts tests/governance/multi-repo-finalization.test.ts tests/fixtures/governance/repositories/multi-repo
git commit -m "feat(integration): finalize multi-repository work"
```

### Task 16: Prove End-to-End Governance, History, and Audit Coverage

**Files:**

- Modify: `src/governance/index.ts`
- Create: `tests/governance/governance-e2e.test.ts`
- Create: `tests/fixtures/governance/repositories/e2e-root/**`

**Interfaces:** Exports the governance public surface only through `src/governance/index.ts`: `CanonicalRecordStore`, `ViewGenerator`, `ArchiveStore`, `ClaimService`, `WorkLifecycleService`, `IntegrationLeaseStore`, `GateRunner`, `StaleBaseReconciler`, `IntegrationCoordinator`, and `MultiRepoFinalizer`. The test performs issue claim -> worker completion -> stale reconciliation -> gate evidence -> record/event/archive planning -> view generation -> lease-held integration -> audit verification.

- [ ] **Step 1: Write the failing end-to-end proof**

```ts
it("preserves complete audit context across one finalized task", async () => {
  const claimPlan = mustValue(await claims.planIssue(issueInput));
  mustValue(await coordinator.finalizeMutation(claimPlan));
  const validated = mustValue(await finalizer.validate(finalizationInput));
  const receipt = mustValue(await finalizer.finalize(validated));
  const snapshot = mustValue(await snapshotBuilder.build(root, { kind: "commit", object_id: receipt.commit_revision }));
  const drift = mustValue(await views.verify(root));
  const evidence = snapshot.records.find(record => record.id === receipt.evidence_id);

  expect(receipt.status).toBe("integrated_verified");
  expect(drift.drifted_paths).toEqual([]);
  expect(evidence?.type).toBe("evidence");
  expect(evidence?.payload).toMatchObject({
    claim_id: issueInput.claim.id,
    original_base_revision: finalizationInput.completion.original_base_revision,
    integration_base_revision: receipt.integration_base_revision,
    commit_revision: receipt.commit_revision,
  });
});
```

- [ ] **Step 2: Run the end-to-end test and address only missing governance wiring**

```powershell
npm test -- tests/governance/governance-e2e.test.ts
```

Expected: initial FAIL identifies missing exports or composition wiring; it must not require catalog, compiler, CLI, migration, or importer changes.

- [ ] **Step 3: Export the final governance surface**

```ts
export * from "./contracts/index.js";
export * from "./records/immutable-record-store.js";
export * from "./views/generate-views.js";
export * from "./archive/content-addressed-archive.js";
export * from "./authority/authority-coverage.js";
export * from "./claims/claim-service.js";
export * from "./work/work-lifecycle-service.js";
export * from "./integration/integration-lease-store.js";
export * from "./integration/canonical-mutation-finalizer.js";
export * from "./integration/gate-runner.js";
export * from "./integration/stale-base-reconciler.js";
export * from "./integration/bootstrap-finalizer.js";
export * from "./integration/integration-coordinator.js";
export * from "./integration/single-repo-finalizer.js";
export * from "./integration/satellite-preparer.js";
export * from "./integration/hub-finalizer.js";
export * from "./integration/integration-recovery.js";
```

- [ ] **Step 4: Run the complete governance gate**

```powershell
npm run typecheck
npm run lint
npm test -- tests/governance
npm run build
npm run schemas:emit
git diff --check
git status --short
```

Expected: all commands exit `0`; governance tests pass; schema emission creates no drift; there are no leaked runtime leases, mutexes, or temporary worktrees; `git status --short` lists only the deliberate Task 16 files before commit.

- [ ] **Step 5: Commit the governance integration release point**

```powershell
git add src/governance/index.ts tests/governance/governance-e2e.test.ts tests/fixtures/governance/repositories/e2e-root
git commit -m "test(governance): prove audited integration flow"
```

## Verification Matrix

| Requirement | Focused verification |
|---|---|
| Immutable records | Duplicate ID, replacement, unsafe path, history mutation, and missing original/integration bases rejected |
| Supersession | New-ID replacement, target existence, same fact class, no cycles |
| Append-only events | Sequence, prior hash, payload hash, deletion/reorder/tamper detection |
| Revision snapshot | Exact Git tree/blob reads; dirty working tree ignored; missing revision rejected |
| Current-state projection | Effective state folds valid events; unknown events cannot mutate state |
| Generated views | Six deterministic outputs, profile/catalog versions and lock hashes, source hashes, do-not-edit marker, drift detection |
| Archive | Redaction, content address, deduplication, append-only manifest, tamper detection |
| Authority | Worker non-acceptance, Pitaji directional approval, external scope/timing coverage |
| Claims | Write conflicts, read overlap, expiry, heartbeat, issuer renewal, base drift |
| Mutation/lifecycle | Plan-only producers, legal initiative/workstream/task transitions, short lease, one CAS commit, faults |
| Lease | Shared Git directory, one holder, nonce check, heartbeat, expiry, approved takeover |
| Gate runner | Literal args, no shell, timeout, output bound, env allowlist, external refusal |
| Audit evidence | Exact commands/results/hashes, bases, commits, claims, approvals, views, risks |
| Stale base | Isolated replay, semantic conflict return, conflict-sensitive rerun, provenance |
| Bootstrap | Clean Git/ref/head, absent memory, Pitaji scope, deterministic plan, secret refusal, verified profile/source/views, one CAS commit, safe rerun, fault matrix |
| Single repo | Completion archive redaction/manifest/audit, one CAS `integrated_verified` commit, bootstrap-required refusal, fault matrix |
| Multi repo | Packet-ID/manifest-hash preparation key, full metadata and parent verification, one hub commit, recovery |

## Spec-to-Plan Coverage Checklist

- [ ] Repository remains canonical truth; runtime leases are coordination only. — Tasks 4, 9–16
- [ ] Canonical snapshots read exact tree/blob objects at the requested Git revision, never working-tree bytes. — Task 4
- [ ] Every canonical record preserves both original and integration base revisions. — Tasks 1–2
- [ ] One fact has one canonical record home; corrections use addenda/supersession. — Tasks 1–3
- [ ] Historical events and archive packets remain append-only and tamper-evident. — Tasks 3, 6
- [ ] All claim, view, archive, work-lifecycle, and administrative changes are plan-only and only `finalizeMutation` may apply them under a short lease/CAS. — Tasks 5–6, 8, 10
- [ ] WorkLifecycleService plans initiative/workstream/task-packet creation and legal event-backed transitions. — Task 10
- [ ] Generated views carry profile/catalog versions and lock hashes and are drift-checked. — Task 5
- [ ] Archive content is redacted, content-addressed, indexed, and excluded from current truth. — Tasks 4, 6
- [ ] Workers cannot accept decisions or modify canonical views. — Tasks 5, 7, 10, 13–14
- [ ] Claims include issuer, assignee, base, exact scope/duties, heartbeat, expiry, evidence, and coordination approval. — Task 8
- [ ] Overlapping writes fail closed; overlapping reads are permitted. — Task 8
- [ ] Claim renewal is issuer-only and refuses changed base/scope/authority. — Task 8
- [ ] One integrator holds the shared-hub lease; takeover is human-approved and audited. — Task 9
- [ ] Gate execution never invokes a shell or parses task text as a command. — Task 11
- [ ] Every required gate produces evidence or blocks normal integration. — Tasks 11, 14
- [ ] Stale packets replay on the current integration head in an isolated worktree; semantic conflicts return to the worker. — Task 12
- [ ] Unaffected evidence carries forward only with original provenance and applicability. — Task 12
- [ ] CLI-owned `init apply` calls one-time `IntegrationCoordinator.bootstrap`, never normal task finalization. — Task 13
- [ ] Bootstrap requires clean expected Git state, absent memory, deterministic compiler input, exact Pitaji approval, secret-free writes, verified artifacts/views, and one CAS commit. — Task 13
- [ ] Normal finalization archives the completion packet with redaction, manifest verification, and audit links in the same commit. — Task 14
- [ ] Every injected bootstrap or normal-finalization pre-ref failure leaves canonical Git state unchanged. — Tasks 13–14
- [ ] Satellite preparation is keyed by packet ID plus manifest hash and verifies full immutable metadata before one hub finalization commit. — Task 15
- [ ] Failed hub finalization leaves satellites prepared and recoverable without rewrite. — Task 15
- [ ] Bootstrap and integrated work record exact files, commits, artifacts, bases, checks, approvals, evidence, risks, and next action. — Tasks 10–16
- [ ] Governance code does not implement catalog, compiler, selector, CLI, migration, import, frontmatter, or vendor responsibilities. — Final ownership audit

## Final Ownership Audit

Before handing this plan to execution, confirm the implementation diff contains no changes under `catalog/project-memory/v1/**`, `src/profile/**`, `src/materialize/**`, `src/selection/**`, `src/planning/**`, `src/cli/**`, `src/migrations/**`, or `src/import/**`. Governance may import their public contracts and validation hooks, but any required change to those owners must be returned to the corresponding plan owner as a documented interface mismatch rather than silently patched here.

Frontmatter interpretation and catalog vendoring stay with the profile-compiler plan; this plan neither creates nor patches those files.

The CLI-plan owner receives only the stable `IntegrationCoordinator.bootstrap(input)` handoff: `init apply` recomputes and validates its `InitPlan`, then calls bootstrap exactly once. Governance must not add argument parsing, prompts, plan-file loading, or CLI dispatch.
