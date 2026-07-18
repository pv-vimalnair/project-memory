import { afterAll, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../../src/index.js";

import {
  cleanupSingleRepoHarnesses,
  expectSingleRepoClean,
  git,
  readArchiveObject,
  readArchiveManifest,
  readIntegrationAudit,
  readTaskStatus,
  singleRepoHarness,
  uninitializedRepository,
} from "./single-repo-test-fixture.js";

afterAll(cleanupSingleRepoHarnesses);

describe("single-repository integration finalization", () => {
  it("creates one integrated_verified commit", async () => {
    const harness = await singleRepoHarness();
    const validated = await harness.finalizer.validate(harness.input);
    if (!validated.ok) throw new Error(JSON.stringify(validated.issues));

    const result = await harness.finalizer.finalize(validated.value);

    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.status).toBe("integrated_verified");
    expect(await git(harness.repo, ["rev-parse", harness.input.target_ref]))
      .toBe(result.value.commit_revision);
    expect(await git(harness.repo, [
      "rev-list",
      "--count",
      `${harness.input.expected_head}..${result.value.commit_revision}`,
    ])).toBe("1");
    expect(await readTaskStatus(harness, result.value.commit_revision)).toBe(
      "integrated_verified",
    );
    await expectSingleRepoClean(harness);
  }, 30_000);

  it("requires explicit bootstrap before normal validation", async () => {
    const harness = await singleRepoHarness();
    const empty = await uninitializedRepository();

    const result = await harness.finalizer.validate({
      ...harness.input,
      root: empty.repo,
      expected_head: empty.head,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "integration.bootstrap_required" }],
    });
    expect(empty.lease_created()).toBe(false);
  });

  it("archives the exact completion with redaction and audit linkage", async () => {
    const harness = await singleRepoHarness({ completion_secret: true });
    const validated = await harness.finalizer.validate(harness.input);
    if (!validated.ok) throw new Error(JSON.stringify(validated.issues));
    const result = await harness.finalizer.finalize(validated.value);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));

    const audit = await readIntegrationAudit(harness, result.value);
    expect(audit.completion_archive_manifest_hash).toBe(
      result.value.completion_archive_manifest_hash,
    );
    expect(audit.archive_manifest_hashes).toContain(
      result.value.completion_archive_manifest_hash,
    );
    const object = await readArchiveObject(
      harness,
      result.value.commit_revision,
      result.value.completion_archive_manifest_hash,
    );
    const manifest = await readArchiveManifest(
      harness,
      result.value.commit_revision,
      result.value.completion_archive_manifest_hash,
    );
    expect(manifest.source_hash).toBe(
      sha256(canonicalJson(harness.input.completion_packet)),
    );
    expect(manifest.redaction_report.replacement_count).toBeGreaterThan(0);
    expect(object).not.toContain("synthetic-test-secret");
    expect(object).toContain("[REDACTED:");
    await expectSingleRepoClean(harness);
  }, 30_000);

  it("rejects a changed validated binding without canonical mutation", async () => {
    const harness = await singleRepoHarness();
    const validated = await harness.finalizer.validate(harness.input);
    if (!validated.ok) throw new Error(JSON.stringify(validated.issues));
    const before = await git(harness.repo, ["rev-parse", harness.input.target_ref]);

    const result = await harness.finalizer.finalize({
      ...validated.value,
      completion_hash: "f".repeat(64),
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "integration.validated_binding_drift" }],
    });
    expect(await git(harness.repo, ["rev-parse", harness.input.target_ref]))
      .toBe(before);
    await expectSingleRepoClean(harness);
  });
});
