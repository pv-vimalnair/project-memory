import { afterAll, describe, expect, it, vi } from "vitest";

import {
  NodeCommandRunner,
  canonicalJson,
  failure,
  sha256,
  success,
  type CommandResult,
  type CommandRunner,
  type CommandSpec,
} from "../../src/index.js";
import { IntegrationGitCliClient } from "../../src/governance/integration/integration-git-client.js";
import {
  EVIDENCE_ID,
  carryGate,
  cleanupStaleRepos,
  conflictGate,
  createCurrentBaseRepo,
  createDivergedRepo,
  readAt,
  reconcileInput,
  reconciler,
  semanticBindings,
  temporaryEntries,
} from "./stale-base-test-fixture.js";

afterAll(cleanupStaleRepos);

describe("literal integration Git operations", () => {
  it("passes cherry-pick metacharacters as one literal commit argument", async () => {
    const calls: CommandSpec[] = [];
    const commandResult: CommandResult = {
      exit_code: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timed_out: false,
      output_truncated: false,
    };
    const runner: CommandRunner = {
      run(spec) {
        calls.push(spec);
        return Promise.resolve(commandResult);
      },
    };
    const client = new IntegrationGitCliClient(runner);
    const commit = "a".repeat(40);
    await client.cherryPickNoCommit(new URL("file:///repo/"), commit);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      executable: "git",
      args: ["-c", "core.longpaths=true", "cherry-pick", "--no-commit", commit],
    });
    await expect(
      client.cherryPickNoCommit(new URL("file:///repo/"), "a;b"),
    ).rejects.toThrow("unsafe Git object ID");
    expect(calls).toHaveLength(1);
  });
  it("resolves trees and performs compare-and-swap ref updates", async () => {
    const fixture = await createCurrentBaseRepo();
    const client = new IntegrationGitCliClient(new NodeCommandRunner());
    expect(await client.resolveRef(fixture.repo, "refs/heads/main"))
      .toBe(fixture.integration_head);
    expect(await client.listTree(fixture.repo, fixture.integration_head, "app.txt"))
      .toEqual(["app.txt"]);
    const ref = "refs/project-memory/tests/task-12";
    expect(await client.updateRef(
      fixture.repo,
      ref,
      fixture.worker_head,
      "0".repeat(40),
    )).toBe(true);
    expect(await client.updateRef(
      fixture.repo,
      ref,
      fixture.integration_head,
      "0".repeat(40),
    )).toBe(false);
  });
});

describe("stale-base reconciliation", () => {
  it("replays a non-conflicting worker commit on the current integration head", async () => {
    const fixture = await createDivergedRepo();
    const result = await reconciler(fixture).reconcile(reconcileInput(fixture));

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "ready") return;
    expect(result.value.integration_base_revision).toBe(fixture.integration_head);
    expect(result.value.reconciled_head_revision).not.toBe(fixture.worker_head);
    expect(result.value.changed_paths).toEqual(["worker.txt"]);
    expect(result.value.replayed_commit_ids).toEqual([fixture.worker_head]);
    expect(await readAt(fixture.repo, result.value.reconciled_head_revision, "worker.txt"))
      .toBe("worker addition");
    expect(result.value.gate_evidence.map((gate) => gate.gate_id)).toEqual([
      conflictGate.id,
      carryGate.id,
    ]);
    expect(result.value.carried_evidence).toHaveLength(1);
    expect(result.value.carried_evidence[0]).toMatchObject({
      evidence_id: EVIDENCE_ID,
      source_revision: fixture.worker_head,
      applicability_statement: "Static policy result is independent of source files.",
    });
    expect(await temporaryEntries(fixture)).toEqual([]);
  });

  it("returns current-base work without synthesizing another commit", async () => {
    const fixture = await createCurrentBaseRepo();
    const result = await reconciler(fixture).reconcile(reconcileInput(fixture));

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "ready",
        integration_base_revision: fixture.integration_head,
        reconciled_head_revision: fixture.worker_head,
        replayed_commit_ids: [],
      },
    });
    expect(await temporaryEntries(fixture)).toEqual([]);
  });

  it("returns work when accepted decision inputs changed", async () => {
    const fixture = await createDivergedRepo();
    const original = semanticBindings();
    const current = semanticBindings({
      accepted_decision_hashes: {
        ...original.accepted_decision_hashes,
        "DEC-01J00000000000000000000061": "f".repeat(64),
      },
    });
    const result = await reconciler(fixture).reconcile(reconcileInput(fixture, {
      semantic_bindings: { original, current },
    }));

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "return_to_worker") return;
    expect(result.value.reason_codes).toContain("stale.semantic_conflict");
    expect(result.value.reason_codes).toContain("stale.decision_changed");
    expect(await temporaryEntries(fixture)).toEqual([]);
  });

  it("returns work for every other intent-bearing semantic drift", async () => {
    const fixture = await createDivergedRepo();
    const original = semanticBindings();
    const cases = [
      ["profile_lock_hash", "stale.profile_changed"],
      ["authority_hash", "stale.authority_changed"],
      ["claimed_scope_hash", "stale.claimed_scope_changed"],
      ["behavior_hash", "stale.behavior_changed"],
      ["evidence_policy_hash", "stale.evidence_policy_changed"],
    ] as const;

    for (const [field, reason] of cases) {
      const current = { ...original, [field]: "f".repeat(64) };
      const result = await reconciler(fixture).reconcile(reconcileInput(fixture, {
        semantic_bindings: { original, current },
      }));
      expect(result.ok).toBe(true);
      if (!result.ok || result.value.status !== "return_to_worker") continue;
      expect(result.value.reason_codes).toContain("stale.semantic_conflict");
      expect(result.value.reason_codes).toContain(reason);
    }
    expect(await temporaryEntries(fixture)).toEqual([]);
  });
  it("returns work and cleans the isolated worktree after a textual conflict", async () => {
    const fixture = await createDivergedRepo(true);
    const result = await reconciler(fixture).reconcile(reconcileInput(fixture));

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "return_to_worker",
        reason_codes: ["stale.textual_conflict"],
      },
    });
    expect(await temporaryEntries(fixture)).toEqual([]);
  });

  it("reruns conflict-sensitive gates but carries exact applicable evidence", async () => {
    const fixture = await createDivergedRepo();
    const assess = vi.fn(() => Promise.resolve(success({ applicable: true, reason_code: null })));
    const input = reconcileInput(fixture);
    const result = await reconciler(fixture, { assess }).reconcile(input);

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "ready") return;
    expect(assess).toHaveBeenCalledTimes(1);
    const carried = result.value.carried_evidence[0];
    expect(carried).toMatchObject({
      gate_id: carryGate.id,
      evidence_id: input.prior_evidence[0]?.evidence_id,
      source_revision: fixture.worker_head,
      original_result_hash: sha256(canonicalJson(input.prior_evidence[0]?.evidence)),
    });
    expect(result.value.gate_evidence.find((gate) => gate.gate_id === conflictGate.id))
      .toMatchObject({ status: "passed", conflict_sensitive: true });
  });

  it("returns work when carried evidence is not applicable to the current base", async () => {
    const fixture = await createDivergedRepo();
    const applicability = {
      assess: () => Promise.resolve(success({
        applicable: false,
        reason_code: "stale.evidence_not_applicable",
      })),
    };
    const result = await reconciler(fixture, applicability).reconcile(reconcileInput(fixture));

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "return_to_worker",
        reason_codes: ["stale.evidence_not_applicable"],
      },
    });
    expect(await temporaryEntries(fixture)).toEqual([]);
  });

  it("returns work when a required current-base gate fails", async () => {
    const fixture = await createDivergedRepo();
    const failingGate = {
      ...conflictGate,
      execution: {
        ...conflictGate.execution,
        args: ["-e", "process.exit(7)"],
      },
    };
    const result = await reconciler(fixture).reconcile(reconcileInput(fixture, {
      gates: [carryGate, failingGate],
    }));

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "return_to_worker",
        reason_codes: ["stale.gate_rerun_failed"],
      },
    });
    expect(await temporaryEntries(fixture)).toEqual([]);
  });

  it("cleans temporary state when an applicability validator crashes", async () => {
    const fixture = await createDivergedRepo();
    const applicability = {
      assess: () => Promise.resolve(failure(
        "applicability.unavailable",
        "validator crashed",
      )),
    };
    const result = await reconciler(fixture, applicability).reconcile(reconcileInput(fixture));

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "applicability.unavailable" }],
    });
    expect(await temporaryEntries(fixture)).toEqual([]);
  });
});
