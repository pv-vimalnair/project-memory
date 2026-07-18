import { afterAll, describe, expect, it } from "vitest";

import {
  preparedManifestPath,
} from "../../src/governance/integration/satellite-preparer.js";
import { hubReceiptHash } from "../../src/governance/integration/hub-finalizer.js";
import { taskDocumentPath } from "../../src/governance/work/work-document.js";
import {
  cleanupMultiRepoHarnesses,
  git,
  multiRepoHarness,
  passingGateEvidence,
} from "./multi-repo-test-fixture.js";

afterAll(cleanupMultiRepoHarnesses);

async function taskState(repo: URL, revision: string, workstream: string, task: string) {
  const body = await git(repo, ["show", `${revision}:${taskDocumentPath(workstream, task)}`]);
  return /^Status: ([a-z_]+)$/mu.exec(body)?.[1] ?? "missing";
}

describe("two-phase multi-repository finalization", () => {
  it("keeps an exact metadata commit prepared until the hub references it", async () => {
    const harness = await multiRepoHarness();
    const item = harness.satellites[0];
    const result = await harness.finalizer.prepareSatellite(item.prepare);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const prepared = result.value;

    expect(prepared.state).toBe("prepared");
    expect(prepared.manifest_ref).toBe(
      `refs/project-memory/prepared/${prepared.packet_id}/${prepared.manifest_hash}`,
    );
    const metadataCommit = await git(item.repo, ["rev-parse", prepared.manifest_ref]);
    const retried = await harness.finalizer.prepareSatellite(item.prepare);
    expect(retried).toEqual(result);
    expect(await git(item.repo, ["rev-parse", prepared.manifest_ref])).toBe(metadataCommit);
    expect(await git(item.repo, ["rev-parse", `${metadataCommit}^`])).toBe(item.work_commit);
    expect((await git(item.repo, [
      "diff", "--name-only", item.work_commit, metadataCommit,
    ])).split(/\r?\n/u)).toEqual([preparedManifestPath(prepared)]);
    expect(JSON.parse(await git(item.repo, [
      "show", `${metadataCommit}:${preparedManifestPath(prepared)}`,
    ]))).toEqual(prepared);
    expect(await taskState(
      harness.hub,
      harness.hub_head,
      harness.task.workstream_id,
      harness.task.task_id,
    )).toBe("submitted");
  }, 30_000);

  it("finalizes sorted immutable satellites through one hub-only commit", async () => {
    const harness = await multiRepoHarness();
    const second = await harness.finalizer.prepareSatellite(harness.satellites[1].prepare);
    const first = await harness.finalizer.prepareSatellite(harness.satellites[0].prepare);
    if (!first.ok || !second.ok) throw new Error("satellite preparation failed");
    const input = harness.hubInput([
      harness.verify(harness.satellites[1], second.value),
      harness.verify(harness.satellites[0], first.value),
    ]);

    const result = await harness.finalizer.finalizeHub(input);

    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.satellite_manifest_hashes).toEqual(
      [first.value.manifest_hash, second.value.manifest_hash].sort(),
    );
    expect(result.value.satellite_commit_hashes).toEqual(
      [first.value.commit_hash, second.value.commit_hash].sort(),
    );
    expect(await git(harness.hub, [
      "rev-list", "--count", `${harness.hub_head}..${result.value.commit_revision}`,
    ])).toBe("1");
    expect(await taskState(
      harness.hub,
      result.value.commit_revision,
      harness.task.workstream_id,
      harness.task.task_id,
    )).toBe("integrated_verified");
  }, 30_000);

  it("returns the existing receipt for an identical successful retry", async () => {
    const harness = await multiRepoHarness();
    const prepared = await harness.finalizer.prepareSatellite(harness.satellites[0].prepare);
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.issues));
    const input = harness.hubInput([
      harness.verify(harness.satellites[0], prepared.value),
    ]);
    const first = await harness.finalizer.finalizeHub(input);
    const second = await harness.finalizer.finalizeHub(input);

    expect(second).toEqual(first);
    if (!first.ok) throw new Error(JSON.stringify(first.issues));
    expect(await git(harness.hub, ["rev-parse", "refs/heads/main"]))
      .toBe(first.value.commit_revision);
  }, 30_000);

  it("leaves prepared refs recoverable when a stale hub cannot finalize", async () => {
    const harness = await multiRepoHarness();
    const item = harness.satellites[0];
    const prepared = await harness.finalizer.prepareSatellite(item.prepare);
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.issues));
    const verified = harness.verify(item, prepared.value);
    const result = await harness.finalizer.finalizeHub({
      ...harness.hubInput([verified]),
      expected_head: item.prepare.completion_packet.original_base_revision,
    });
    const recovery = await harness.finalizer.inspectRecovery({
      hub: harness.hub,
      target_ref: "refs/heads/main",
      prepared: [prepared.value],
    });

    expect(result.ok).toBe(false);
    expect(recovery).toMatchObject({ ok: true, value: { state: "prepared_unfinalized" } });
    expect(await git(item.repo, ["rev-parse", prepared.value.manifest_ref])).toMatch(/^[0-9a-f]{40}$/u);
  }, 30_000);

  it("reports a partial reference without promoting the remaining satellite", async () => {
    const harness = await multiRepoHarness();
    const first = await harness.finalizer.prepareSatellite(harness.satellites[0].prepare);
    const second = await harness.finalizer.prepareSatellite(harness.satellites[1].prepare);
    if (!first.ok || !second.ok) throw new Error("preparation failed");
    const finalized = await harness.finalizer.finalizeHub(harness.hubInput([
      harness.verify(harness.satellites[0], first.value),
    ]));
    if (!finalized.ok) throw new Error(JSON.stringify(finalized.issues));
    const recovery = await harness.finalizer.inspectRecovery({
      hub: harness.hub,
      prepared: [first.value, second.value],
    });

    expect(recovery).toMatchObject({
      ok: true,
      value: {
        state: "partial_reference",
        referenced_manifest_hashes: [first.value.manifest_hash],
        missing_manifest_hashes: [second.value.manifest_hash],
      },
    });
  }, 30_000);

  it("rejects a rewritten preparation ref and failed exact gate evidence", async () => {
    const harness = await multiRepoHarness();
    const item = harness.satellites[0];
    const prepared = await harness.finalizer.prepareSatellite(item.prepare);
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.issues));
    const before = await git(harness.hub, ["rev-parse", "refs/heads/main"]);
    const metadataCommit = await git(item.repo, ["rev-parse", prepared.value.manifest_ref]);
    await git(item.repo, ["update-ref", prepared.value.manifest_ref, item.prepare.integration_base_revision]);

    const rewritten = await harness.finalizer.finalizeHub(harness.hubInput([
      harness.verify(item, prepared.value),
    ]));
    await git(item.repo, [
      "update-ref",
      prepared.value.manifest_ref,
      metadataCommit,
      item.prepare.integration_base_revision,
    ]);
    const failedGate = await harness.finalizer.finalizeHub(harness.hubInput([{
      ...harness.verify(item, prepared.value),
      gate_evidence: [passingGateEvidence(true)],
    }]));

    expect(rewritten).toMatchObject({
      ok: false, issues: [{ code: "satellite.metadata_commit_drift" }],
    });
    expect(failedGate).toMatchObject({
      ok: false, issues: [{ code: "satellite.gate_failed" }],
    });
    expect(await git(harness.hub, ["rev-parse", "refs/heads/main"])).toBe(before);
  }, 30_000);

  it("detects full manifest drift and missing work objects", async () => {
    const harness = await multiRepoHarness();
    const item = harness.satellites[0];
    const prepared = await harness.finalizer.prepareSatellite(item.prepare);
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.issues));
    const drifted = await harness.finalizer.finalizeHub(harness.hubInput([{
      ...harness.verify(item, prepared.value),
      catalog_lock_hash: "f".repeat(64),
    }]));
    const missing = await harness.finalizer.finalizeHub(harness.hubInput([{
      ...harness.verify(item, prepared.value),
      work_commit_hash: "f".repeat(40),
    }]));

    expect(drifted.ok).toBe(false);
    expect(missing).toMatchObject({
      ok: false, issues: [{ code: "satellite.object_missing" }],
    });
  }, 30_000);

  it("reports a finalized recovery set after the authoritative hub commit", async () => {
    const harness = await multiRepoHarness();
    const prepared = await Promise.all(harness.satellites.map((item) =>
      harness.finalizer.prepareSatellite(item.prepare)));
    const first = prepared[0];
    const second = prepared[1];
    if (first === undefined || second === undefined || !first.ok || !second.ok) {
      throw new Error("preparation failed");
    }
    const verified = [
      harness.verify(harness.satellites[0], first.value),
      harness.verify(harness.satellites[1], second.value),
    ];
    const finalized = await harness.finalizer.finalizeHub(harness.hubInput(verified));
    if (!finalized.ok) throw new Error(JSON.stringify(finalized.issues));

    const recovery = await harness.finalizer.inspectRecovery({
      hub: harness.hub,
      prepared: prepared.map((result) => result.ok ? result.value : never()),
    });

    expect(recovery).toMatchObject({
      ok: true,
      value: {
        state: "finalized",
        hub_revision: finalized.value.commit_revision,
        referenced_manifest_hashes: finalized.value.satellite_manifest_hashes,
      },
    });
    expect(finalized.value.receipt_hash).toBe(hubReceiptHash(finalized.value));
  }, 30_000);
});

function never(): never {
  throw new Error("unreachable failed preparation");
}
