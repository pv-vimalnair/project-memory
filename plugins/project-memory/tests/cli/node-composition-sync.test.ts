import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { CommandRunner, CommandSpec } from "../../src/contracts/command-runner.js";
import type { MutationReceipt } from "../../src/governance/integration/canonical-mutation-finalizer.js";
import * as nodeComposition from "../../src/cli/node-composition.js";

const roots: string[] = [];

function result(exitCode: number, stderr = "", stdout = "") {
  return {
    exit_code: exitCode,
    signal: null,
    stdout,
    stderr,
    timed_out: false,
    output_truncated: false,
  } as const;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("post-finalization checkout synchronization", () => {
  it("exposes the guided legacy import host services without widening command authority", () => {
    const repo = pathToFileURL(`${tmpdir()}${path.sep}`);
    const services = nodeComposition.createNodeProjectMemoryServices(repo);
    expect(typeof services.legacyImport.now).toBe("function");
    expect(typeof services.legacyImport.context).toBe("function");
    expect(typeof services.legacyImport.plan).toBe("function");
    expect(typeof services.legacyImport.finalize).toBe("function");
  });

  it("preserves an edit injected after ref advance and before checkout sync", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "project-memory-sync-race-"));
    roots.push(directory);
    const repo = pathToFileURL(`${directory}${path.sep}`);
    const tracked = path.join(directory, "tracked.txt");
    await writeFile(tracked, "previous revision bytes\n", "utf8");
    const calls: CommandSpec[] = [];
    const runner: CommandRunner = {
      async run(spec) {
        calls.push(spec);
        if (spec.args.includes("rev-parse")) {
          return result(0, "", `${"2".repeat(40)}\n`);
        }
        if (spec.args.includes("read-tree")) {
          await writeFile(tracked, "user edit arriving during sync\n", "utf8");
          return result(128, "Entry not uptodate. Cannot merge.");
        }
        return result(0);
      },
    };
    const receipt: MutationReceipt = {
      status: "mutation_integrated",
      plan_id: "work:create:WS-01J00000000000000000000001:0123456789ab",
      plan_hash: "a".repeat(64),
      previous_revision: "1".repeat(40),
      commit_revision: "2".repeat(40),
      audit_evidence_id: "EVD-01J00000000000000000000001",
      derived_view_hashes: {},
      audit_artifact_hashes: {},
      integrated_at: "2026-07-16T12:00:00.000Z",
    };
    const synchronizeCheckout = (nodeComposition as Readonly<Record<string, unknown>>)
      .synchronizeCheckout as undefined | ((
        root: URL,
        commandRunner: CommandRunner,
        mutationReceipt: MutationReceipt,
      ) => Promise<{ readonly ok: boolean; readonly issues?: readonly { readonly code: string }[] }>);

    expect(typeof synchronizeCheckout).toBe("function");
    if (synchronizeCheckout === undefined) return;
    const synchronized = await synchronizeCheckout(repo, runner, receipt);

    expect(synchronized).toMatchObject({
      ok: false,
      issues: [{ code: "runtime.checkout_sync_diverged" }],
    });
    expect(await readFile(tracked, "utf8")).toBe("user edit arriving during sync\n");
    expect(calls.some((call) => call.args.includes("restore"))).toBe(false);
    expect(calls.some((call) => call.args.includes("diff"))).toBe(false);
    expect(calls.some((call) => call.args.includes("reset"))).toBe(false);
    expect(calls.filter((call) => call.args.includes("read-tree"))).toHaveLength(1);
    expect(calls.find((call) => call.args.includes("read-tree"))?.args)
      .toEqual(expect.arrayContaining([receipt.previous_revision, receipt.commit_revision]));
  });
});