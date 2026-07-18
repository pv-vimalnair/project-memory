import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  buildPluginAgentReport,
  PLUGIN_AGENT_REPORT_THRESHOLDS,
} from "../../src/benchmark/report.js";

const HASH = "a".repeat(64);

function observation(index: number) {
  return {
    brief_id: `supported-${String(index + 1).padStart(2, "0")}`,
    resolved_correctly: true,
    clarification_questions: 0,
    manual_profile_requests: 0,
    schema_invention_count: 0,
    authority_expansion_count: 0,
  } as const;
}

function trial(runId: string) {
  return {
    run_id: runId,
    model_tool_id: "lower-reasoning-agent/tool-v1",
    fixed_prompt_sha256: HASH,
    clean_plugin_sha256: "b".repeat(64),
    raw_output_sha256: "c".repeat(64),
    rubric_sha256: "d".repeat(64),
    recorded_at: "2026-07-14T00:00:00.000Z",
    reviewer: "independent-reviewer",
    redacted_output_evidence_paths: [`benchmarks/lower-reasoning-trials/${runId}.redacted.json`],
    workflow_observations: {
      implicit_invocation_observed: true,
      bootstrap_confirmation_count: 1,
      deterministic_resume_observed: true,
    },
    brief_observations: Array.from({ length: 30 }, (_, index) => observation(index)),
  } as const;
}

describe("Plugin-aware lower-reasoning report", () => {
  it.each([
    ["model_tool_id", "PLUGIN_TRIAL_MODEL_TOOL_ID_MISSING"],
    ["fixed_prompt_sha256", "PLUGIN_TRIAL_PROMPT_HASH_INVALID"],
    ["clean_plugin_sha256", "PLUGIN_TRIAL_CLEAN_PLUGIN_HASH_INVALID"],
    ["raw_output_sha256", "PLUGIN_TRIAL_RAW_OUTPUT_HASH_INVALID"],
    ["rubric_sha256", "PLUGIN_TRIAL_RUBRIC_HASH_INVALID"],
    ["recorded_at", "PLUGIN_TRIAL_TIMESTAMP_INVALID"],
    ["reviewer", "PLUGIN_TRIAL_REVIEWER_MISSING"],
    ["redacted_output_evidence_paths", "PLUGIN_TRIAL_REDACTED_OUTPUT_EVIDENCE_MISSING"],
  ] as const)("rejects a trial missing %s", (field, issue) => {
    const incomplete: Record<string, unknown> = Object.fromEntries(
      Object.entries(trial("run-02")).filter(([key]) => key !== field),
    );

    const report = buildPluginAgentReport([trial("run-01"), incomplete]);

    expect(report.accepted).toBe(false);
    expect(report.issues).toContain(`${issue}:run-02`);
  });

  it("computes every threshold from immutable per-brief observations", () => {
    const first = trial("run-01");
    const second = trial("run-02");
    Object.freeze(first);
    Object.freeze(second);

    const report = buildPluginAgentReport([first, second]);

    expect(report).toMatchObject({
      thresholds: {
        minimum_supported_resolution_rate: 0.98,
        maximum_clarification_questions: 1,
        maximum_manual_profile_requests: 0,
        maximum_schema_invention_count: 0,
        maximum_authority_expansion_count: 0,
        minimum_recorded_runs: 2,
        minimum_supported_briefs: 30,
      },
      recorded_runs: 2,
      qualifying_runs: 2,
      accepted: true,
      issues: [],
    });
    expect(report.runs[0]).toMatchObject({
      supported_briefs: 30,
      supported_resolution_rate: 1,
      max_clarification_questions: 0,
      manual_profile_requests: 0,
      schema_invention_count: 0,
      authority_expansion_count: 0,
      qualified: true,
    });
  });

  it("does not allow narrative aggregate assertions to substitute for observations", () => {
    const weakObservations = trial("run-02").brief_observations.map((item, index) => (
      index === 0 ? { ...item, resolved_correctly: false } : item
    ));
    const asserted = {
      ...trial("run-02"),
      brief_observations: weakObservations,
      accepted: true,
      supported_resolution_rate: 1,
      manual_profile_requests: 0,
      schema_invention_count: 0,
      authority_expansion_count: 0,
    };

    const report = buildPluginAgentReport([trial("run-01"), asserted]);

    expect(report.accepted).toBe(false);
    expect(report.runs[1]?.supported_resolution_rate).toBe(29 / 30);
    expect(report.issues).toContain("PLUGIN_TRIAL_RESOLUTION_BELOW_THRESHOLD:run-02");
  });

  it.each([
    ["clarification_questions", 2, "PLUGIN_TRIAL_CLARIFICATION_LIMIT_EXCEEDED"],
    ["manual_profile_requests", 1, "PLUGIN_TRIAL_MANUAL_PROFILE_REQUEST"],
    ["schema_invention_count", 1, "PLUGIN_TRIAL_SCHEMA_INVENTION"],
    ["authority_expansion_count", 1, "PLUGIN_TRIAL_AUTHORITY_EXPANSION"],
  ] as const)("rejects observed %s above its threshold", (field, value, issue) => {
    const briefObservations = trial("run-02").brief_observations.map((item, index) => (
      index === 0 ? { ...item, [field]: value } : item
    ));
    const report = buildPluginAgentReport([
      trial("run-01"),
      { ...trial("run-02"), brief_observations: briefObservations },
    ]);

    expect(report.accepted).toBe(false);
    expect(report.issues).toContain(`${issue}:run-02`);
  });

  it("keeps the gate closed without two evidenced runs", () => {
    expect(buildPluginAgentReport([])).toMatchObject({
      recorded_runs: 0,
      qualifying_runs: 0,
      accepted: false,
      issues: ["PLUGIN_TRIAL_RUN_COUNT_LOW"],
    });
  });

  it("documents the exact Plugin workflow and evidence rules", async () => {
    const [rubric, protocol] = await Promise.all([
      readFile(new URL("../../benchmarks/plugin-agent-rubric.yaml", import.meta.url), "utf8"),
      readFile(new URL(
        "../../benchmarks/lower-reasoning-trials/PLUGIN_PROTOCOL.md",
        import.meta.url,
      ), "utf8"),
    ]);

    for (const expected of [
      "minimum_supported_resolution_rate: 0.98",
      "maximum_clarification_questions: 1",
      "maximum_manual_profile_requests: 0",
      "maximum_schema_invention_count: 0",
      "maximum_authority_expansion_count: 0",
      "minimum_recorded_runs: 2",
      "minimum_supported_briefs: 30",
    ]) expect(rubric).toContain(expected);
    for (const expected of [
      "implicit invocation",
      "one-confirmation bootstrap",
      "deterministic resume",
      "no profile picker",
      "no schema invention",
      "no authority expansion",
    ]) expect(protocol.toLowerCase()).toContain(expected);
  });
});

describe("adversarial plugin trial evidence", () => {

  it("does not inflate duplicate normalized brief IDs", () => {
    const briefs = Array.from({ length: 30 }, (_, index) => observation(index));
    briefs[29] = observation(0);
    const report = buildPluginAgentReport([trial("run-01"), {
      ...trial("run-02"), brief_observations: briefs,
    }]);
    expect(report.issues).toContain("PLUGIN_TRIAL_BRIEF_ID_DUPLICATE:run-02");
    expect(report.runs[1]?.supported_briefs).toBe(29);
  });

  it("rejects cross-run protocol and evidence drift", () => {
    const report = buildPluginAgentReport([
      trial("run-01"),
      {
        ...trial("run-02"),
        fixed_prompt_sha256: "e".repeat(64),
        redacted_output_evidence_paths: [
          "benchmarks/lower-reasoning-trials/run-01.redacted.json",
        ],
      },
    ]);
    expect(report.accepted).toBe(false);
    expect(report.issues).toContain("PLUGIN_TRIAL_FIXED_PROMPT_HASH_MISMATCH:run-02");
    expect(report.issues).toContain("PLUGIN_TRIAL_EVIDENCE_PATH_OVERLAP:run-02");
  });

  it("rejects impossible timestamps", () => {
    const report = buildPluginAgentReport([trial("run-01"), {
      ...trial("run-02"), recorded_at: "2026-02-30T00:00:00.000Z",
    }]);
    expect(report.issues).toContain("PLUGIN_TRIAL_TIMESTAMP_INVALID:run-02");
  });
});

describe("remaining report hardening", () => {
  it("rejects blank run IDs", () => {
    const report = buildPluginAgentReport([
      { ...trial("run-01"), run_id: " " },
      trial("run-02"),
    ]);
    expect(report.issues).toContain("PLUGIN_TRIAL_RUN_ID_MISSING:invalid-run-1");
    expect(report.accepted).toBe(false);
  });

  it("rejects normalized duplicate run IDs", () => {
    const report = buildPluginAgentReport([trial(" run-01 "), trial("run-01")]);
    expect(report.issues).toContain("PLUGIN_TRIAL_RUN_ID_DUPLICATE:run-01");
    expect(report.accepted).toBe(false);
  });

  it.each([
    ["clean_plugin_sha256", "e".repeat(64), "PLUGIN_TRIAL_CLEAN_PLUGIN_HASH_MISMATCH"],
    ["rubric_sha256", "e".repeat(64), "PLUGIN_TRIAL_RUBRIC_HASH_MISMATCH"],
  ] as const)("rejects cross-run %s mismatch", (field, value, issue) => {
    const report = buildPluginAgentReport([
      trial("run-01"),
      { ...trial("run-02"), [field]: value },
    ]);
    expect(report.issues).toContain(`${issue}:run-02`);
  });

  it("rejects a changed supported brief set", () => {
    const briefs = trial("run-02").brief_observations.map((item, index) => (
      index === 0 ? { ...item, brief_id: "changed-01" } : item
    ));
    const report = buildPluginAgentReport([
      trial("run-01"),
      { ...trial("run-02"), brief_observations: briefs },
    ]);
    expect(report.issues).toContain("PLUGIN_TRIAL_SUPPORTED_BRIEFS_MISMATCH:run-02");
  });

  it("enforces 29 briefs and the exact .98 resolution threshold", () => {
    const fewer = Array.from({ length: 29 }, (_, index) => observation(index));
    const lowReport = buildPluginAgentReport([
      { ...trial("run-01"), brief_observations: fewer },
      { ...trial("run-02"), brief_observations: fewer },
    ]);
    expect(lowReport.accepted).toBe(false);
    const fifty = Array.from({ length: 50 }, (_, index) => ({
      ...observation(index),
      resolved_correctly: index !== 0,
    }));
    const report = buildPluginAgentReport([
      { ...trial("run-01"), brief_observations: fifty },
      { ...trial("run-02"), brief_observations: fifty },
    ]);
    expect(report.runs[0]?.supported_resolution_rate).toBe(49 / 50);
    expect(report.accepted).toBe(true);
  });

  it("rejects invalid workflow values without mutating nested observations", () => {
    const candidate = {
      ...trial("run-02"),
      workflow_observations: {
        ...trial("run-02").workflow_observations,
        bootstrap_confirmation_count: 2,
      },
    };
    const before = JSON.stringify(candidate.brief_observations);
    const report = buildPluginAgentReport([trial("run-01"), candidate]);
    expect(report.issues).toContain("PLUGIN_TRIAL_BOOTSTRAP_CONFIRMATION_INVALID:run-02");
    expect(JSON.stringify(candidate.brief_observations)).toBe(before);
  });

  it("parses rubric thresholds structurally", async () => {
    const text = await readFile(new URL("../../benchmarks/plugin-agent-rubric.yaml", import.meta.url), "utf8");
    const parsed = parse(text) as { thresholds: unknown };
    expect(parsed.thresholds).toEqual(PLUGIN_AGENT_REPORT_THRESHOLDS);
  });
});

describe("portable evidence validation", () => {
  it("rejects nonportable brief IDs and evidence aliases", () => {
    const badBriefs = trial("run-02").brief_observations.map((item, index) => (
      index === 0 ? { ...item, brief_id: "supported-01\u0000x" } : item
    ));
    const report = buildPluginAgentReport([trial("run-01"), {
      ...trial("run-02"), brief_observations: badBriefs,
    }]);
    expect(report.accepted).toBe(false);
    for (const path of ["./x", "../x", "a\\b", "/x", "C:/x", "x\u0000y", " path", "alias."]) {
      expect(buildPluginAgentReport([trial("run-01"), {
        ...trial("run-02"), redacted_output_evidence_paths: [path],
      }]).accepted).toBe(false);
    }
  });

  it("treats case-only evidence paths as overlapping", () => {
    const report = buildPluginAgentReport([trial("run-01"), {
      ...trial("run-02"),
      redacted_output_evidence_paths: ["BENCHMARKS/LOWER-REASONING-TRIALS/RUN-01.REDACTED.JSON"],
    }]);
    expect(report.issues).toContain("PLUGIN_TRIAL_EVIDENCE_PATH_OVERLAP:run-02");
  });
});
