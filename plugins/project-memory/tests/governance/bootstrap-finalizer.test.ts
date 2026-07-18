import { mkdir, writeFile } from "node:fs/promises";

import { afterAll, describe, expect, it } from "vitest";

import {
  canonicalJson,
  canonicalMutationPlanHash,
  sha256,
} from "../../src/index.js";
import { GENERATED_VIEW_PATHS } from "../../src/governance/views/generate-views.js";
import type {
  ApprovalRecordPayload,
  CanonicalRecord,
} from "../../src/governance/contracts/index.js";
import type { BootstrapInput } from "../../src/governance/integration/bootstrap-finalizer.js";
import {
  bootstrapPlanHashes,
  buildBootstrapMutationPlan,
  validateBootstrapCompilationInput,
} from "../../src/governance/integration/bootstrap-plan.js";
import { validateAugmentedBootstrapPlan } from "../../src/governance/integration/bootstrap-plan-validation.js";
import {
  bootstrapHarness,
  cleanupBootstrapHarnesses,
  commitCount,
  expectCoordinationClean,
  git,
  readJsonAt,
  replanBootstrapInput,
} from "./bootstrap-test-fixture.js";

afterAll(cleanupBootstrapHarnesses);

describe("atomic repository bootstrap", () => {
  it("creates one initialization commit without a task packet", async () => {
    const harness = await bootstrapHarness();
    const before = await harness.git_client.resolveRef(
      harness.repo,
      harness.input.target_ref,
    );

    const result = await harness.finalizer.bootstrap(harness.input);

    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      status: "initialized_verified",
      root_id: harness.input.root_id,
      target_ref: harness.input.target_ref,
      previous_revision: before,
      compilation_plan_hash: harness.input.expected_plan_hash,
      source_proposal_hash: harness.input.source_proposal_hash,
      approval_record_id: harness.input.approval_record.id,
    });
    expect(
      await harness.git_client.resolveRef(harness.repo, harness.input.target_ref),
    ).toBe(result.value.commit_revision);
    expect(await commitCount(harness.repo, before, result.value.commit_revision)).toBe(1);
    const audit = await readJsonAt<Record<string, unknown>>(
      harness.repo,
      result.value.commit_revision,
      result.value.audit_path,
    );
    expect(audit).toMatchObject({
      root_id: harness.input.root_id,
      approval_record_id: harness.input.approval_record.id,
      compilation_plan_hash: harness.input.expected_plan_hash,
    });
    const committedPaths = await harness.git_client.listTree(
      harness.repo,
      result.value.commit_revision,
      "docs/project-memory",
    );
    expect(committedPaths.some((value) => value.includes("/tasks/"))).toBe(false);
    for (const viewPath of GENERATED_VIEW_PATHS) expect(committedPaths).toContain(viewPath);
    expect(harness.coordinator_calls.value).toBe(1);
    await expectCoordinationClean(harness);
  }, 30_000);

  it("fails closed when initialization is rerun", async () => {
    const harness = await bootstrapHarness();
    const first = await harness.finalizer.bootstrap(harness.input);
    if (!first.ok) throw new Error(JSON.stringify(first.issues));
    const before = await harness.git_client.resolveRef(
      harness.repo,
      harness.input.target_ref,
    );

    const second = await harness.finalizer.bootstrap(harness.input);

    expect(second).toMatchObject({
      ok: false,
      issues: [{ code: "bootstrap.already_initialized" }],
    });
    expect(harness.coordinator_calls.value).toBe(1);
    expect(await git(harness.repo, ["rev-parse", harness.input.target_ref])).toBe(before);
    await expectCoordinationClean(harness);
  }, 30_000);
});
type CanonicalApproval = CanonicalRecord & {
  readonly type: "approval";
  readonly payload: ApprovalRecordPayload;
};

type Harness = Awaited<ReturnType<typeof bootstrapHarness>>;

function changedApproval(
  input: BootstrapInput,
  changes: Partial<ApprovalRecordPayload>,
): BootstrapInput {
  const record = input.approval_record as CanonicalApproval;
  return {
    ...input,
    approval_record: {
      ...record,
      payload: { ...record.payload, ...changes },
    },
  };
}

async function commitFixtureFile(
  harness: Harness,
  relativePath: string,
  bytes: string,
): Promise<void> {
  const slash = relativePath.lastIndexOf("/");
  if (slash >= 0) {
    await mkdir(new URL(relativePath.slice(0, slash + 1), harness.repo), {
      recursive: true,
    });
  }
  await writeFile(new URL(relativePath, harness.repo), bytes, "utf8");
  await git(harness.repo, ["add", "--all", "--", "."]);
  await git(harness.repo, ["commit", "-m", `fixture:${relativePath}`]);
}

async function expectBootstrapFailure(
  harness: Harness,
  input: BootstrapInput,
  code: string,
  expectedCoordinatorCalls = 0,
): Promise<void> {
  const before = await harness.git_client.resolveRef(
    harness.repo,
    harness.input.target_ref,
  );
  const result = await harness.finalizer.bootstrap(input);
  expect(result).toMatchObject({ ok: false, issues: [{ code }] });
  expect(harness.coordinator_calls.value).toBe(expectedCoordinatorCalls);
  expect(
    await harness.git_client.resolveRef(harness.repo, harness.input.target_ref),
  ).toBe(before);
  await expectCoordinationClean(harness);
}

describe("bootstrap fail-closed preconditions", () => {
  it("rejects a non-Git root", async () => {
    const harness = await bootstrapHarness();
    await expectBootstrapFailure(
      harness,
      { ...harness.input, root: harness.temporary_root },
      "bootstrap.not_git_repository",
    );
  });

  it.each([
    ["tracked", "README.md"],
    ["untracked", "untracked.txt"],
  ])("rejects dirty %s state", async (_kind, relativePath) => {
    const harness = await bootstrapHarness();
    await writeFile(new URL(relativePath, harness.repo), "dirty\n", "utf8");
    await expectBootstrapFailure(
      harness,
      harness.input,
      "bootstrap.dirty_repository",
    );
  });

  it("rejects a missing target ref", async () => {
    const harness = await bootstrapHarness();
    await expectBootstrapFailure(
      harness,
      { ...harness.input, target_ref: "refs/heads/missing" },
      "bootstrap.target_ref_missing",
    );
  });

  it("rejects target-head drift", async () => {
    const harness = await bootstrapHarness();
    await commitFixtureFile(harness, "ordinary.txt", "new head\n");
    await expectBootstrapFailure(
      harness,
      harness.input,
      "bootstrap.head_mismatch",
    );
  });

  it.each([
    "docs/project-memory/existing.md",
    "PROJECT_CONTEXT.md",
  ])("rejects an existing bootstrap marker at %s", async (relativePath) => {
    const harness = await bootstrapHarness();
    await commitFixtureFile(harness, relativePath, "already initialized\n");
    await expectBootstrapFailure(
      harness,
      harness.input,
      "bootstrap.already_initialized",
    );
  });

  it("rejects expected plan-hash drift", async () => {
    const harness = await bootstrapHarness();
    await expectBootstrapFailure(
      harness,
      { ...harness.input, expected_plan_hash: "f".repeat(64) },
      "bootstrap.plan_binding_invalid",
    );
  });

  it("rejects write-precondition drift", async () => {
    const harness = await bootstrapHarness();
    const first = harness.input.compilation_plan.writes.find((write) => write.mode === "create_or_replace");
    if (first === undefined) throw new Error("compiler write missing");
    const input = replanBootstrapInput(harness.input, {
      writes: harness.input.compilation_plan.writes.map((write) =>
        write === first
          ? { ...write, expected_existing_sha256: "f".repeat(64) }
          : write,
      ),
    });
    await expectBootstrapFailure(
      harness,
      input,
      "bootstrap.write_precondition_mismatch",
    );
  });

  it("rejects a non-Pitaji approval", async () => {
    const harness = await bootstrapHarness();
    await expectBootstrapFailure(
      harness,
      changedApproval(harness.input, { granted_by: "agent.integrator" }),
      "bootstrap.approval_invalid",
    );
  });

  it.each(["scope", "timing"] as const)(
    "rejects approval %s drift",
    async (kind) => {
      const harness = await bootstrapHarness();
      const record = harness.input.approval_record as CanonicalApproval;
      const input = kind === "scope"
        ? changedApproval(harness.input, {
            scope: [...record.payload.scope, "broader-than-approved"],
          })
        : changedApproval(harness.input, { timing: "whenever" });
      await expectBootstrapFailure(
        harness,
        input,
        "bootstrap.approval_invalid",
      );
    },
  );

  it("rejects secret-bearing compiler bytes without writing or redacting them", async () => {
    const harness = await bootstrapHarness();
    const input = replanBootstrapInput(harness.input, {
      writes: [
        ...harness.input.compilation_plan.writes,
        {
          relative_path: "docs/project-memory/secret-check.txt",
          bytes: new TextEncoder().encode("api_key=synthetic-bootstrap-secret\n"),
          expected_existing_sha256: null,
          mode: "create",
        },
      ],
    });
    await expectBootstrapFailure(
      harness,
      input,
      "bootstrap.secret_detected",
    );
  });

  it.each([
    ["profile", "docs/project-memory/profile.lock.yaml"],
    ["catalog", "docs/project-memory/catalog.lock.json"],
    ["schema", "schemas/project-memory/v1/"],
    ["source", "docs/project-memory/source/PROJECT.md"],
  ] as const)(
    "rejects %s verification drift",
    async (_kind, pathNeedle) => {
      const harness = await bootstrapHarness();
      const target = harness.input.compilation_plan.writes.find((write) =>
        pathNeedle.endsWith("/")
          ? write.relative_path.startsWith(pathNeedle)
          : write.relative_path === pathNeedle,
      );
      if (target === undefined) throw new Error(`fixture write missing: ${pathNeedle}`);
      const input = replanBootstrapInput(harness.input, {
        writes: harness.input.compilation_plan.writes.map((write) =>
          write === target
            ? { ...write, bytes: new TextEncoder().encode("invalid\n") }
            : write,
        ),
      });
      const before = await harness.git_client.resolveRef(
        harness.repo,
        harness.input.target_ref,
      );
      const result = await harness.finalizer.bootstrap(input);
      expect(result.ok).toBe(false);
      expect(
        await harness.git_client.resolveRef(harness.repo, harness.input.target_ref),
      ).toBe(before);
      await expectCoordinationClean(harness);
    },
    30_000,
  );

  it.each(["evidence", "event"] as const)(
    "rejects a hash-rebound substitute for the canonical bootstrap %s",
    async (kind) => {
      const harness = await bootstrapHarness();
      const now = new Date("2026-07-15T04:30:00.000Z");
      const validated = validateBootstrapCompilationInput(harness.input, now);
      if (!validated.ok) throw new Error(JSON.stringify(validated.issues));
      const built = buildBootstrapMutationPlan(harness.input, validated.value);
      if (!built.ok) throw new Error(JSON.stringify(built.issues));
      const plan = built.value;
      const relativePath = kind === "evidence"
        ? `docs/project-memory/records/evidence/${plan.metadata.evidence_record_id}.json`
        : plan.metadata.bootstrap_event_path;
      const target = plan.writes.find((write) => write.relative_path === relativePath);
      if (target === undefined) throw new Error(`audit write missing: ${relativePath}`);
      const document = JSON.parse(new TextDecoder().decode(target.bytes)) as Record<string, unknown>;
      const substitute = kind === "evidence"
        ? { ...document, title: "Substituted bootstrap evidence" }
        : {
            ...document,
            payload: {
              ...(document.payload as Readonly<Record<string, unknown>>),
              unexpected: true,
            },
          };
      const bytes = new TextEncoder().encode(canonicalJson(substitute));
      const writes = plan.writes.map((write) =>
        write === target ? { ...write, bytes } : write,
      );
      const plannedContentHashes = bootstrapPlanHashes(writes);
      const metadata = {
        ...plan.metadata,
        planned_content_hashes: plannedContentHashes,
        bootstrap_content_hash: sha256(canonicalJson(plannedContentHashes)),
        ...(kind === "evidence" ? { evidence_record_hash: sha256(bytes) } : {}),
      };
      const { plan_hash: ignored, ...base } = plan;
      void ignored;
      const withoutHash = { ...base, writes, metadata };
      const tampered = {
        ...withoutHash,
        plan_hash: canonicalMutationPlanHash(withoutHash),
      };

      expect(validateAugmentedBootstrapPlan(tampered, now)).toMatchObject({
        ok: false,
        issues: [{ code: "bootstrap.audit_binding_invalid" }],
      });
    },
  );
  it("fails closed on compare-and-swap loss", async () => {
    const harness = await bootstrapHarness();
    harness.git_client.cas_allowed = false;
    await expectBootstrapFailure(
      harness,
      harness.input,
      "bootstrap.cas_lost",
      1,
    );
  }, 30_000);
});
