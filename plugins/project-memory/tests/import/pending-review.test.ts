import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../../src/core/canonical-json.js";
import { sha256 } from "../../src/core/hash.js";
import {
  createLegacyScanner,
  findPendingLegacyReview,
} from "../../src/import/index.js";

const ROOT_ID = "ROOT-01J00000000000000000000000";
const roots: string[] = [];

async function temporaryRoot(): Promise<{ readonly path: string; readonly url: URL }> {
  const value = await mkdtemp(path.join(tmpdir(), "project-memory-pending-import-"));
  roots.push(value);
  return { path: value, url: pathToFileURL(`${value}${path.sep}`) };
}

async function writeReport(
  root: string,
  proposalHash: string,
  candidates: readonly Readonly<Record<string, unknown>>[],
): Promise<void> {
  const directory = path.join(root, "docs", "project-memory", "governance", "imports");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${proposalHash}.json`), canonicalJson({
    schema_version: "1.0.0",
    root_id: ROOT_ID,
    proposal_hash: proposalHash,
    created_at: "2026-07-20T00:00:00.000Z",
    approvals: ["APR-01J00000000000000000000000"],
    candidates,
    effects: {},
  }), "utf8");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("pending legacy review", () => {
  it("returns only unresolved reviewable sources after exact report resolution", async () => {
    const repository = await temporaryRoot();
    const prd = "# PRD\n\nAccepted direction.\n";
    const handoff = "# Handoff\n\nContinue the import.\n";
    await writeFile(path.join(repository.path, "PRD.md"), prd, "utf8");
    await writeFile(path.join(repository.path, "HANDOFF.md"), handoff, "utf8");
    await writeFile(path.join(repository.path, "notes.yaml"), "value: ignored\n", "utf8");
    await writeReport(repository.path, "3".repeat(64), [{
      candidate_id: "candidate.prd",
      source_path: "PRD.md",
      source_sha256: sha256(new TextEncoder().encode(prd)),
      disposition: "import",
      destination: null,
      rationale: "Reviewed.",
      sensitivity_finding_count: 0,
      redacted_sha256: null,
    }]);

    const result = await findPendingLegacyReview(
      repository.url,
      ROOT_ID,
      createLegacyScanner({ git_revision: () => Promise.resolve("1".repeat(40)) }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        root_id: ROOT_ID,
        scan: { artifacts: [{ relative_path: "HANDOFF.md" }] },
        proposal: {
          status: "review_required",
          mappings: [{ source_path: "HANDOFF.md" }],
        },
      },
    });
  });

  it("reopens a changed source while keeping unchanged resolved sources closed", async () => {
    const repository = await temporaryRoot();
    const original = "# PRD\n\nOriginal.\n";
    await writeFile(path.join(repository.path, "PRD.md"), "# PRD\n\nChanged.\n", "utf8");
    await writeReport(repository.path, "4".repeat(64), [{
      candidate_id: "candidate.prd",
      source_path: "PRD.md",
      source_sha256: sha256(new TextEncoder().encode(original)),
      disposition: "reject",
      destination: null,
      rationale: "Reviewed old revision.",
      sensitivity_finding_count: 0,
      redacted_sha256: null,
    }]);

    const result = await findPendingLegacyReview(
      repository.url,
      ROOT_ID,
      createLegacyScanner({ git_revision: () => Promise.resolve(null) }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: { scan: { artifacts: [{ relative_path: "PRD.md" }] } },
    });
  });

  it("fails closed on malformed, contradictory, and symlinked reports", async () => {
    const malformed = await temporaryRoot();
    const malformedDirectory = path.join(
      malformed.path, "docs", "project-memory", "governance", "imports",
    );
    await mkdir(malformedDirectory, { recursive: true });
    await writeFile(path.join(malformedDirectory, `${"5".repeat(64)}.json`), "{", "utf8");
    expect(await findPendingLegacyReview(malformed.url, ROOT_ID)).toMatchObject({
      ok: false,
      issues: [{ code: "LEGACY_REPORT_INVALID" }],
    });

    const contradictory = await temporaryRoot();
    const prd = "# PRD\n";
    await writeFile(path.join(contradictory.path, "PRD.md"), prd, "utf8");
    const sourceHash = sha256(new TextEncoder().encode(prd));
    for (const [index, disposition] of ["import", "reject"].entries()) {
      await writeReport(contradictory.path, String(index + 6).repeat(64), [{
        candidate_id: `candidate.${String(index)}`,
        source_path: "PRD.md",
        source_sha256: sourceHash,
        disposition,
        destination: null,
        rationale: "Reviewed.",
        sensitivity_finding_count: 0,
        redacted_sha256: null,
      }]);
    }
    expect(await findPendingLegacyReview(contradictory.url, ROOT_ID)).toMatchObject({
      ok: false,
      issues: [{ code: "LEGACY_REPORT_CONFLICT" }],
    });

    const linked = await temporaryRoot();
    const outside = await temporaryRoot();
    const linkedDirectory = path.join(
      linked.path, "docs", "project-memory", "governance", "imports",
    );
    await mkdir(path.dirname(linkedDirectory), { recursive: true });
    await symlink(
      outside.path,
      linkedDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(await findPendingLegacyReview(linked.url, ROOT_ID)).toMatchObject({
      ok: false,
      issues: [{ code: "LEGACY_REPORT_DIRECTORY_UNSAFE" }],
    });
  });
});
