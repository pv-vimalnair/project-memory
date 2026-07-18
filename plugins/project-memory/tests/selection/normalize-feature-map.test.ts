import { describe, expect, it } from "vitest";

import { normalizeFeatureMap } from "../../src/selection/normalize-feature-map.js";

describe("normalized feature map", () => {
  it("sorts features, set values, and evidence while preserving provenance", () => {
    const result = normalizeFeatureMap([
      {
        id: "surface.ui",
        valueType: "boolean",
        value: true,
        evidenceId: "EVD-01J00000000000000000000002",
        sourceRef: "brief:2",
      },
      {
        id: "action.tags",
        valueType: "string-set",
        value: ["beta", "alpha", "beta"],
        evidenceId: "EVD-01J00000000000000000000002",
        sourceRef: "brief:2",
      },
      {
        id: "action.mode",
        valueType: "string",
        value: "implement",
        evidenceId: "EVD-01J00000000000000000000001",
        sourceRef: "brief:1",
      },
      {
        id: "action.tags",
        valueType: "string-set",
        value: ["alpha", "beta"],
        evidenceId: "EVD-01J00000000000000000000001",
        sourceKind: "classifier",
        sourceRef: "brief:1",
        sourceText: "Alpha and beta",
        extractorId: "test-classifier",
        extractorVersion: "2.1.0",
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.features)).toEqual([
      "action.mode",
      "action.tags",
      "surface.ui",
    ]);
    expect(result.value.features["action.tags"]?.value).toEqual([
      "alpha",
      "beta",
    ]);
    expect(
      result.value.features["action.tags"]?.evidence.map(
        (entry) => entry.evidence_id,
      ),
    ).toEqual([
      "EVD-01J00000000000000000000001",
      "EVD-01J00000000000000000000002",
    ]);
    expect(result.value.features["action.tags"]?.evidence[0]).toMatchObject({
      source_kind: "classifier",
      source_text: "Alpha and beta",
      extractor_id: "test-classifier",
      extractor_version: "2.1.0",
    });
    expect(result.value.features["surface.ui"]?.evidence[0]).toMatchObject({
      source_kind: "brief",
      source_text: null,
      extractor_id: "project-memory.observation",
      extractor_version: "1.0.0",
    });
  });

  it("rejects conflicting values for one feature", () => {
    const result = normalizeFeatureMap([
      observation("action.mode", "string", "implement", "01"),
      observation("action.mode", "string", "assess", "02"),
    ]);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "selection.feature_conflict" }],
    });
  });

  it("rejects values that do not match their declared type", () => {
    const result = normalizeFeatureMap([
      observation("surface.ui", "boolean", "yes", "01"),
    ]);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "selection.feature_type_mismatch" }],
    });
  });
});

function observation(
  id: string,
  valueType: "string" | "number" | "boolean" | "string-set",
  value: string | number | boolean | readonly string[],
  evidenceSuffix: "01" | "02",
) {
  return {
    id,
    valueType,
    value,
    evidenceId: `EVD-01J000000000000000000000${evidenceSuffix}`,
    sourceRef: `brief:${evidenceSuffix}`,
  } as const;
}
