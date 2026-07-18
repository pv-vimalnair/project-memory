import { describe, expect, it } from "vitest";

import { sha256 } from "../../src/core/hash.js";
import {
  createLegacyImporter,
  type LegacyScan,
  type ReviewedLegacyImportInput,
} from "../../src/import/index.js";

const ROOT_ID = "ROOT-01J00000000000000000000000";

function scan(paths: readonly { readonly path: string; readonly roles: readonly string[] }[]): LegacyScan {
  return {
    schema_version: "1.0.0",
    root: "file:///legacy/",
    artifacts: paths.map(({ path, roles }) => ({
      relative_path: path,
      sha256: "a".repeat(64),
      byte_length: 10,
      git_revision: null,
      detected_roles: roles as LegacyScan["artifacts"][number]["detected_roles"],
      sensitivity_findings: [],
    })),
    scan_hash: "b".repeat(64),
  };
}

describe("legacy import proposals", () => {
  it("routes PRDs and requirements only to reviewed governing-document patches", () => {
    const importer = createLegacyImporter();
    const proposed = importer.propose(scan([{ path: "PRD.md", roles: ["prd"] }]), {
      root_id: ROOT_ID,
      governing_document: "docs/project-memory/PROJECT.md",
    });
    expect(proposed).toMatchObject({
      ok: true,
      value: {
        status: "review_required",
        mappings: [{
          source_path: "PRD.md",
          classification: "directional_candidate",
          destination_kind: "canonical_document_patch",
          destination_path: "docs/project-memory/PROJECT.md",
          accepted: false,
        }],
      },
    });
    if (!proposed.ok) return;
    expect(proposed.value.mappings.some((mapping) => mapping.destination_kind === "canonical_record")).toBe(false);
  });

  it("rejects duplicate canonical destinations and exposes no importer apply/write API", () => {
    const importer = createLegacyImporter();
    expect(importer.propose(scan([
      { path: "PRD.md", roles: ["prd"] },
      { path: "REQUIREMENTS.md", roles: ["requirements"] },
    ]), {
      root_id: ROOT_ID,
      governing_document: "docs/project-memory/PROJECT.md",
    })).toMatchObject({
      ok: false,
      issues: [{ code: "LEGACY_DESTINATION_DUPLICATE" }],
    });
    expect("apply" in importer).toBe(false);
    expect("write" in importer).toBe(false);
  });

  it("builds a deterministic reviewed import plan from exact source bytes", () => {
    const importer = createLegacyImporter();
    const source = new TextEncoder().encode("# Handoff\n\nHistorical status.\n");
    const reviewed: ReviewedLegacyImportInput = {
      root_id: ROOT_ID,
      target_ref: "refs/heads/main",
      expected_head: "1".repeat(40),
      profile_lock_hash: "2".repeat(64),
      proposal_hash: "3".repeat(64),
      created_by: "codex",
      created_at: "2026-07-16T10:00:00.000Z",
      expires_at: "2026-07-16T11:00:00.000Z",
      approval_ids: ["APR-01J00000000000000000000000"],
      decisions: [{
        source_path: "HANDOFF.md",
        source_bytes: source,
        source_sha256: sha256(source),
        decision: "archive",
        classification: "historical_status",
        destination_kind: "archive_only",
        destination_path: null,
      }],
    };
    const first = importer.plan(reviewed);
    const second = importer.plan(reviewed);
    expect(first.ok && second.ok && first.value.plan_hash).toBe(second.ok && second.value.plan_hash);
    expect(first).toMatchObject({
      ok: true,
      value: {
        mutation_kind: "import",
        writes: [{ relative_path: `docs/project-memory/archive/imports/${sha256(source)}.bin` }],
      },
    });
  });
});
