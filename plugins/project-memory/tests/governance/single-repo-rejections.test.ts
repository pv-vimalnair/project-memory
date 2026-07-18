import { afterAll, describe, expect, it } from "vitest";

import {
  cleanupSingleRepoHarnesses,
  expectSingleRepoClean,
  git,
  singleRepoHarness,
  type SingleRepoHarness,
  type SingleRepoHarnessOptions,
} from "./single-repo-test-fixture.js";

afterAll(cleanupSingleRepoHarnesses);

async function head(harness: SingleRepoHarness): Promise<string> {
  return git(harness.repo, ["rev-parse", harness.input.target_ref]);
}

async function expectFinalizationFailure(
  options: SingleRepoHarnessOptions,
  code: string,
): Promise<void> {
  const harness = await singleRepoHarness(options);
  const before = await head(harness);
  const validated = await harness.finalizer.validate(harness.input);
  if (!validated.ok) throw new Error(JSON.stringify(validated.issues));

  const result = await harness.finalizer.finalize(validated.value);

  expect(result).toMatchObject({ ok: false, issues: [{ code }] });
  expect(await head(harness)).toBe(before);
  await expectSingleRepoClean(harness);
}

describe("single-repository fail-closed bindings", () => {
  it("rejects a stale target head", async () => {
    const harness = await singleRepoHarness();
    const validated = await harness.finalizer.validate(harness.input);
    if (!validated.ok) throw new Error(JSON.stringify(validated.issues));
    const driftedHead = harness.input.completion_packet.worker_head_revision;
    await git(harness.repo, [
      "update-ref",
      harness.input.target_ref,
      driftedHead,
      harness.input.expected_head,
    ]);

    const result = await harness.finalizer.finalize(validated.value);

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "integration.head_mismatch" }],
    });
    expect(await head(harness)).toBe(driftedHead);
    await expectSingleRepoClean(harness);
  }, 30_000);

  it("rejects an expired validation lease", async () => {
    const harness = await singleRepoHarness();
    const before = await head(harness);
    const validated = await harness.finalizer.validate(harness.input);
    if (!validated.ok) throw new Error(JSON.stringify(validated.issues));
    harness.clock.advance(5 * 60_000);

    const result = await harness.finalizer.finalize(validated.value);

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "integration.validation_expired" }],
    });
    expect(await head(harness)).toBe(before);
    await expectSingleRepoClean(harness);
  }, 30_000);

  it("rechecks claim expiry after validation", async () => {
    const harness = await singleRepoHarness({ lease_ttl_ms: 20 * 60_000 });
    const before = await head(harness);
    const validated = await harness.finalizer.validate(harness.input);
    if (!validated.ok) throw new Error(JSON.stringify(validated.issues));
    harness.clock.advance(11 * 60_000);

    const result = await harness.finalizer.finalize(validated.value);

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "claim.expired" }],
    });
    expect(await head(harness)).toBe(before);
    await expectSingleRepoClean(harness);
  }, 30_000);

  it("rejects changed approval-hash bindings", async () => {
    const harness = await singleRepoHarness();
    const before = await head(harness);
    const validated = await harness.finalizer.validate(harness.input);
    if (!validated.ok) throw new Error(JSON.stringify(validated.issues));

    const result = await harness.finalizer.finalize({
      ...validated.value,
      approval_hashes: { forged: "f".repeat(64) },
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "integration.validated_binding_drift" }],
    });
    expect(await head(harness)).toBe(before);
    await expectSingleRepoClean(harness);
  }, 30_000);

  it("returns failed required gates to the worker", async () => {
    const harness = await singleRepoHarness({ gate_failure: true });
    const before = await head(harness);

    const result = await harness.finalizer.validate(harness.input);

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "integration.return_to_worker" }],
    });
    expect(result.ok ? [] : result.issues[0]?.references).toContain(
      "stale.gate_rerun_failed",
    );
    expect(await head(harness)).toBe(before);
    await expectSingleRepoClean(harness);
  }, 30_000);

  it("preserves the ref when archive planning fails", async () => {
    await expectFinalizationFailure({ archive_failure: true }, "archive.injected");
  }, 30_000);

  it("preserves the ref when view generation fails", async () => {
    await expectFinalizationFailure(
      { view_failure: true },
      "integration.view_injected",
    );
  }, 30_000);
  it("rejects a rehashed view plan with drifted source metadata", async () => {
    await expectFinalizationFailure(
      { view_metadata_drift: true },
      "integration.view_plan_drift",
    );
  }, 30_000);
});
