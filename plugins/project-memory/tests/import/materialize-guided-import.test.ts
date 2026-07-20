import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InstancePrefix } from "../../src/contracts/ids.js";
import { sha256 } from "../../src/core/hash.js";
import type { IdFactory } from "../../src/core/id-factory.js";
import {
  PROJECT_SCHEMA_REGISTRARS,
  registerProjectSchemas,
} from "../../src/index.js";
import {
  planGuidedLegacyImport,
  type GuidedLegacyImportInput,
  type LegacyFactCategory,
  type LegacyFactDraft,
} from "../../src/import/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const ROOT_ID = "ROOT-01J00000000000000000000000";
const HEAD = "1".repeat(40);
const PROFILE_HASH = "2".repeat(64);
const PROPOSAL_HASH = "3".repeat(64);
const CATEGORIES: readonly LegacyFactCategory[] = [
  "completed_work",
  "current_decision",
  "constraint",
  "next_action",
  "idea",
  "risk",
  "finding",
  "removed",
  "rejected",
  "superseded",
  "lesson",
];

class FixedIds implements IdFactory {
  #counter = 0;

  next(prefix: InstancePrefix): string {
    this.#counter += 1;
    return `${prefix}-${String(this.#counter).padStart(26, "0")}`;
  }
}

const sourceText = `${CATEGORIES.join("\n")}\n`;
const sourceBytes = new TextEncoder().encode(sourceText);

function facts(): readonly LegacyFactDraft[] {
  return CATEGORIES.map((category, index) => ({
    source_line_start: index + 1,
    source_line_end: index + 1,
    category,
    title: `Imported ${category}`,
    statement: `Historical fact for ${category}`,
    rationale: `The source line records ${category}.`,
    confidence: "high",
  }));
}

function input(
  overrides: Partial<GuidedLegacyImportInput> = {},
): GuidedLegacyImportInput {
  return {
    root_id: ROOT_ID,
    target_ref: "refs/heads/main",
    expected_head: HEAD,
    profile_lock_hash: PROFILE_HASH,
    catalog_version: "1.0.0",
    proposal_hash: PROPOSAL_HASH,
    created_by: "codex",
    created_at: "2026-07-20T04:00:00.000Z",
    expires_at: "2026-07-20T05:00:00.000Z",
    sources: [{
      source_path: "HISTORY.md",
      source_sha256: sha256(sourceBytes),
      source_git_revision: HEAD,
      disposition: "import",
      rationale: "Import the reviewed historical facts.",
      facts: facts(),
    }],
    ...overrides,
  };
}

function dependencies(bytes: Uint8Array = sourceBytes) {
  return {
    ids: new FixedIds(),
    read_source: () => Promise.resolve({
      ok: true as const,
      value: new Uint8Array(bytes),
      warnings: [],
    }),
  };
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("guided legacy import materialization", () => {
  it("maps all categories to complete evidence-bound canonical records deterministically", async () => {
    const first = await planGuidedLegacyImport(input(), dependencies());
    const second = await planGuidedLegacyImport(input(), dependencies());
    expect(first.ok).toBe(true);
    expect(second).toMatchObject(first);
    if (!first.ok) return;

    const records = first.value.writes
      .filter((write) => write.relative_path.includes("/records/"))
      .map((write) => JSON.parse(new TextDecoder().decode(write.bytes)) as {
        readonly id: string;
        readonly title: string;
        readonly type: string;
        readonly status: string;
        readonly original_base_revision: string;
        readonly integration_base_revision: string;
        readonly catalog_versions: readonly string[];
        readonly relationships: readonly { readonly type: string; readonly target_id: string }[];
        readonly payload: Readonly<Record<string, unknown>>;
      });
    expect(records).toHaveLength(CATEGORIES.length * 2);
    expect(first.value.record_ids).toHaveLength(CATEGORIES.length * 2);
    expect(first.value.evidence_ids).toHaveLength(CATEGORIES.length);
    expect(records.every((record) =>
      record.original_base_revision === HEAD &&
      record.integration_base_revision === HEAD &&
      record.catalog_versions[0] === "1.0.0"
    )).toBe(true);

    const evidence = records.filter((record) => record.type === "evidence");
    expect(evidence).toHaveLength(CATEGORIES.length);
    expect(evidence[0]?.payload).toMatchObject({
      source_refs: ["HISTORY.md#L1-L1", `git:${HEAD}`],
      hashes: { source_sha256: sha256(sourceBytes) },
    });
    const factsByTitle = new Map(
      records.filter((record) => record.type !== "evidence")
        .map((record) => [record.title, record]),
    );
    expect(factsByTitle.get("Imported completed_work")).toMatchObject({
      type: "change",
      status: "closed",
      payload: { commits: [HEAD], files: ["HISTORY.md"] },
    });
    expect(factsByTitle.get("Imported current_decision")).toMatchObject({
      type: "decision", status: "accepted",
    });
    expect(factsByTitle.get("Imported constraint")).toMatchObject({
      type: "decision", status: "accepted",
    });
    expect(factsByTitle.get("Imported next_action")).toMatchObject({
      type: "idea", status: "proposed",
    });
    expect(factsByTitle.get("Imported idea")).toMatchObject({
      type: "idea", status: "proposed",
    });
    expect(factsByTitle.get("Imported risk")).toMatchObject({
      type: "risk", status: "proposed",
    });
    expect(factsByTitle.get("Imported finding")).toMatchObject({
      type: "finding", status: "accepted",
    });
    expect(factsByTitle.get("Imported removed")).toMatchObject({
      type: "idea", status: "withdrawn",
    });
    expect(factsByTitle.get("Imported rejected")).toMatchObject({
      type: "idea", status: "rejected",
    });
    expect(factsByTitle.get("Imported superseded")).toMatchObject({
      type: "idea", status: "superseded",
    });
    expect(factsByTitle.get("Imported lesson")).toMatchObject({
      type: "lesson", status: "accepted",
    });
    expect(records.filter((record) => record.type !== "evidence").every((record) =>
      record.relationships.some((relationship) =>
        relationship.type === "evidences" &&
        first.value.evidence_ids.includes(relationship.target_id)
      )
    )).toBe(true);
    expect(first.value.metadata.required_view_paths).toHaveLength(6);
    expect(first.value.writes.map((write) => write.relative_path)).toContain(
      `docs/project-memory/governance/imports/${PROPOSAL_HASH}.json`,
    );
  });

  it("validates source coverage, hashes, anchors, rationales, confidence, and duplicates", async () => {
    const base = input();
    const source = base.sources[0];
    if (source === undefined) throw new Error("source fixture missing");
    const oneFact = source.facts[0];
    if (oneFact === undefined) throw new Error("fact fixture missing");

    expect(await planGuidedLegacyImport(input({
      sources: [source, source],
    }), dependencies())).toMatchObject({
      ok: false, issues: [{ code: "GUIDED_IMPORT_SOURCE_DUPLICATE" }],
    });
    expect(await planGuidedLegacyImport(input({
      sources: [{ ...source, source_sha256: "4".repeat(64) }],
    }), dependencies())).toMatchObject({
      ok: false, issues: [{ code: "GUIDED_IMPORT_SOURCE_HASH_MISMATCH" }],
    });
    expect(await planGuidedLegacyImport(input({
      sources: [{ ...source, rationale: " " }],
    }), dependencies())).toMatchObject({
      ok: false, issues: [{ code: "GUIDED_IMPORT_RATIONALE_REQUIRED" }],
    });
    expect(await planGuidedLegacyImport(input({
      sources: [{
        ...source,
        facts: [{ ...oneFact, source_line_start: 0 }],
      }],
    }), dependencies())).toMatchObject({
      ok: false, issues: [{ code: "GUIDED_IMPORT_ANCHOR_INVALID" }],
    });
    expect(await planGuidedLegacyImport(input({
      sources: [{
        ...source,
        facts: [{ ...oneFact, confidence: "low" }],
      }],
    }), dependencies())).toMatchObject({
      ok: false, issues: [{ code: "GUIDED_IMPORT_LOW_CONFIDENCE" }],
    });
    expect(await planGuidedLegacyImport(input({
      sources: [{
        ...source,
        facts: [oneFact, oneFact],
      }],
    }), dependencies())).toMatchObject({
      ok: false, issues: [{ code: "GUIDED_IMPORT_FACT_DUPLICATE" }],
    });
  });

  it("keeps unresolved sources eligible and requires exclusion for sensitive sources", async () => {
    const base = input();
    const source = base.sources[0];
    if (source === undefined) throw new Error("source fixture missing");
    const unresolvedFact = source.facts[0];
    if (unresolvedFact === undefined) throw new Error("fact fixture missing");
    const unresolved = await planGuidedLegacyImport(input({
      sources: [{
        ...source,
        disposition: "unresolved",
        rationale: "The source remains ambiguous.",
        facts: [{ ...unresolvedFact, confidence: "low" }],
      }],
    }), dependencies());
    expect(unresolved).toMatchObject({
      ok: true,
      value: {
        record_ids: [],
        metadata: { unresolved_source_paths: ["HISTORY.md"] },
      },
    });
    if (!unresolved.ok) return;
    const unresolvedReport = unresolved.value.writes.find((write) =>
      write.relative_path.includes("/governance/imports/")
    );
    expect(new TextDecoder().decode(unresolvedReport?.bytes)).toContain(
      `"confidence":"low"`,
    );

    const credential = ["AK", "IA"].join("") + "X".repeat(16);
    const sensitiveBytes = new TextEncoder().encode(`secret ${credential}\n`);
    const sensitiveSource = {
      ...source,
      source_sha256: sha256(sensitiveBytes),
      facts: [{
        ...unresolvedFact,
        statement: "Sensitive historical fact",
      }],
    };
    expect(await planGuidedLegacyImport(input({
      sources: [sensitiveSource],
    }), dependencies(sensitiveBytes))).toMatchObject({
      ok: false,
      issues: [{ code: "GUIDED_IMPORT_SENSITIVE_SOURCE_EXCLUSION_REQUIRED" }],
    });

    const rejected = await planGuidedLegacyImport(input({
      sources: [{
        ...sensitiveSource,
        disposition: "reject",
        rationale: "Exclude the sensitive source.",
        facts: [],
      }],
    }), dependencies(sensitiveBytes));
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    const reportWrite = rejected.value.writes.find((write) =>
      write.relative_path.includes("/governance/imports/")
    );
    expect(reportWrite).toBeDefined();
    expect(new TextDecoder().decode(reportWrite?.bytes)).not.toContain(credential);
  });

  it("never fabricates a completed-work commit when no source revision exists", async () => {
    const base = input();
    const source = base.sources[0];
    if (source === undefined) throw new Error("source fixture missing");
    const completed = source.facts.find((fact) => fact.category === "completed_work");
    if (completed === undefined) throw new Error("completed fact missing");
    const result = await planGuidedLegacyImport(input({
      sources: [{
        ...source,
        source_git_revision: null,
        facts: [completed],
      }],
    }), dependencies());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const change = result.value.writes
      .filter((write) => write.relative_path.includes("/records/changes/"))
      .map((write) => JSON.parse(new TextDecoder().decode(write.bytes)) as {
        readonly payload: { readonly commits: readonly string[] };
      })[0];
    expect(change?.payload.commits).toEqual([]);
  });
});