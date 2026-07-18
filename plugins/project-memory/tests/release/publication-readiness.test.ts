import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// @ts-expect-error -- The JSDoc-checked MJS verifier has no separate declaration file.
import { approvedSpdx as untypedApprovedSpdx, canonicalRepositoryUrls as untypedCanonicalRepositoryUrls, checkPublicationReadiness as untypedCheckPublicationReadiness, evaluatePublicationReadiness as untypedEvaluatePublicationReadiness, lowerReasoningEvidenceComplete as untypedLowerReasoningEvidenceComplete, publicationApprovalsComplete as untypedPublicationApprovalsComplete, semanticVersion as untypedSemanticVersion } from "../../scripts/verify-publication-readiness.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CHECKER = path.join(PACKAGE_ROOT, "scripts", "verify-publication-readiness.mjs");
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PUBLICATION_ROOT = path.join(REPOSITORY_ROOT, "docs", "publication");
const CURRENT_TIME = Date.parse("2026-07-17T10:30:00.000Z");

type JsonRecord = Record<string, unknown>;
const approvedSpdx = untypedApprovedSpdx as (value: unknown) => boolean;
const canonicalRepositoryUrls = untypedCanonicalRepositoryUrls as (
  packageJson: JsonRecord,
) => string | null;
const lowerReasoningEvidenceComplete = untypedLowerReasoningEvidenceComplete as (
  value: unknown,
) => boolean;
const publicationApprovalsComplete = untypedPublicationApprovalsComplete as (
  value: unknown,
  repositoryUrl: string,
  license: string,
  version: string,
  publicAuthor: string,
  now?: number,
) => boolean;
const checkPublicationReadiness = untypedCheckPublicationReadiness as (
  now?: number,
) => Promise<PublicationReadinessReport>;
const evaluatePublicationReadiness = untypedEvaluatePublicationReadiness as (
  packageValue: unknown,
  pluginValue: unknown,
  approvals: unknown,
  trialEvidence: unknown,
  now?: number,
) => PublicationReadinessReport;
const semanticVersion = untypedSemanticVersion as (value: unknown) => boolean;

interface PublicationReadinessReport {
  readonly schema_version: "1.0.0";
  readonly ready: boolean;
  readonly mode: "read_only";
  readonly blockers: readonly {
    readonly code: string;
    readonly path: string;
  }[];
}

interface WorkflowStep {
  readonly uses?: string;
  readonly with?: Readonly<Record<string, unknown>>;
}

interface WorkflowJob {
  readonly permissions?: unknown;
  readonly steps?: readonly WorkflowStep[];
}

interface WorkflowDocument {
  readonly permissions?: unknown;
  readonly jobs?: Readonly<Record<string, WorkflowJob>>;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing test fixture value: ${label}`);
  return value;
}

function observation(index: number) {
  return {
    brief_id: `supported-${String(index + 1).padStart(2, "0")}`,
    resolved_correctly: true,
    clarification_questions: 0,
    manual_profile_requests: 0,
    schema_invention_count: 0,
    authority_expansion_count: 0,
  };
}

function trial(runId: "run-01" | "run-02") {
  return {
    run_id: runId,
    model_tool_id: "lower-reasoning-agent/tool-v1",
    fixed_prompt_sha256: "a".repeat(64),
    clean_plugin_sha256: "b".repeat(64),
    raw_output_sha256: (runId === "run-01" ? "c" : "e").repeat(64),
    rubric_sha256: "d".repeat(64),
    recorded_at: runId === "run-01"
      ? "2026-07-14T00:00:00.000Z"
      : "2026-07-14T00:01:00.000Z",
    reviewer: "independent-reviewer",
    redacted_output_evidence_paths: [
      `benchmarks/lower-reasoning-trials/${runId}.redacted.json`,
    ],
    workflow_observations: {
      implicit_invocation_observed: true,
      bootstrap_confirmation_count: 1,
      deterministic_resume_observed: true,
    },
    brief_observations: Array.from({ length: 30 }, (_, index) => observation(index)),
  };
}

function validTrialEvidence() {
  const trials = [trial("run-01"), trial("run-02")];
  return {
    schema_version: "1.0.0",
    trials,
    report: {
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
      runs: trials.map((item) => ({
        run_id: item.run_id,
        supported_briefs: 30,
        supported_resolution_rate: 1,
        max_clarification_questions: 0,
        manual_profile_requests: 0,
        schema_invention_count: 0,
        authority_expansion_count: 0,
        qualified: true,
        issues: [],
      })),
    },
  };
}

function validPackageMetadata() {
  return {
    name: "@pitaji/project-memory",
    version: "1.0.0",
    license: "MIT",
    author: { name: "Pv Vimal Nair" },
    repository: { url: "git+https://github.com/pitaji/project-memory.git" },
    homepage: "https://github.com/pitaji/project-memory",
  };
}

function validPluginMetadata() {
  return {
    name: "project-memory",
    version: "1.0.0",
    license: "MIT",
    author: { name: "Pv Vimal Nair" },
    interface: { developerName: "Pv Vimal Nair" },
  };
}

function validApproval(repositoryUrl: string) {
  return {
    schema_version: "1.0.0",
    status: "approved",
    publication_authorized: true,
    approved_by: "Pv Vimal Nair",
    approved_at: "2026-07-17T10:00:00.000Z",
    repository_url: repositoryUrl,
    license: "MIT",
    first_public_version: "1.0.0",
    public_author_name: "Pv Vimal Nair",
    public_contact: "hello@pitaji.dev",
    security_reporting_route: "security@pitaji.dev",
    release_channel: "GitHub release and npm package",
    final_readme_approved: true,
    privacy_statement_approved: true,
    contribution_policy_approved: true,
    security_policy_approved: true,
    authorization_target: repositoryUrl,
    authorization_environment: "public",
    authorized_actions: ["repository.push", "github.release.create", "npm.package.publish"],
    authorization_scope: {
      repository_url: repositoryUrl,
      version: "1.0.0",
      artifacts: ["repository_source", "github_release", "npm_package"],
    },
    authorization_starts_at: "2026-07-17T09:00:00.000Z",
    authorization_expires_at: "2026-07-18T09:00:00.000Z",
  };
}

async function publicationSnapshot() {
  const entries = (await readdir(PUBLICATION_ROOT)).sort();
  const documents = await Promise.all(entries.map(async (entry) => ({
    entry,
    content: await readFile(path.join(PUBLICATION_ROOT, entry), "utf8"),
  })));
  return {
    packageContent: await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
    pluginContent: await readFile(
      path.join(PACKAGE_ROOT, ".codex-plugin", "plugin.json"),
      "utf8",
    ),
    entries,
    documents,
  };
}

describe("publication readiness", () => {
  it("opens the approved release gate reproducibly and performs no writes", async () => {
    const before = await publicationSnapshot();
    const approval = JSON.parse(await readFile(
      path.join(PUBLICATION_ROOT, "PUBLICATION_APPROVALS.json"),
      "utf8",
    )) as { approved_at: string };
    const approvedAt = Date.parse(approval.approved_at);
    const first = await checkPublicationReadiness(approvedAt);
    const second = await checkPublicationReadiness(approvedAt);
    const after = await publicationSnapshot();

    expect(second).toEqual(first);
    expect(after).toEqual(before);
    expect(first).toEqual({
      schema_version: "1.0.0",
      ready: true,
      mode: "read_only",
      blockers: [],
    });
  });

  it("recomputes the Task 9 report from raw immutable trial records", () => {
    const evidence = validTrialEvidence();
    expect(lowerReasoningEvidenceComplete(evidence)).toBe(true);
    expect(lowerReasoningEvidenceComplete({
      schema_version: "1.0.0",
      report: evidence.report,
    })).toBe(false);

    const overlapping = structuredClone(evidence);
    const firstTrial = required(overlapping.trials[0], "first trial");
    const secondTrial = required(overlapping.trials[1], "second trial");
    secondTrial.redacted_output_evidence_paths = [
      required(firstTrial.redacted_output_evidence_paths[0], "first evidence path"),
    ];
    expect(lowerReasoningEvidenceComplete(overlapping)).toBe(false);

    const invented = structuredClone(evidence);
    const inventedObservation = required(
      required(invented.trials[1], "second invented trial").brief_observations[0],
      "invented observation",
    );
    inventedObservation.schema_invention_count = 1;
    expect(lowerReasoningEvidenceComplete(invented)).toBe(false);
    inventedObservation.schema_invention_count = 0;
    expect(lowerReasoningEvidenceComplete(invented)).toBe(true);

    const driftedReport = structuredClone(evidence);
    driftedReport.report.qualifying_runs = 3;
    expect(lowerReasoningEvidenceComplete(driftedReport)).toBe(false);

    for (const identity of [
      { model_tool_id: "TBD model" },
      { model_tool_id: "example agent" },
      { reviewer: "pending reviewer" },
      { reviewer: "TODO choose reviewer" },
    ]) {
      const placeholder = structuredClone(evidence);
      Object.assign(required(placeholder.trials[1], "placeholder trial"), identity);
      expect(lowerReasoningEvidenceComplete(placeholder)).toBe(false);
    }
  });

  it("requires canonical repository metadata and current owner-bound approval", () => {
    const packageJson = validPackageMetadata();
    const repositoryUrl = canonicalRepositoryUrls(packageJson);
    expect(repositoryUrl).toBe("https://github.com/pitaji/project-memory");
    if (repositoryUrl === null) throw new Error("Expected canonical repository URL");
    expect(publicationApprovalsComplete(
      validApproval(repositoryUrl),
      repositoryUrl,
      "MIT",
      "1.0.0",
      "Pv Vimal Nair",
      CURRENT_TIME,
    )).toBe(true);

    expect(canonicalRepositoryUrls({
      repository: "https://github.com/",
      homepage: "https://github.com/",
    })).toBeNull();
    for (const placeholderUrl of [
      "https://github.com/example/sample",
      "https://github.com/pitaji/sample_repo",
      "https://github.com/pitaji/xxx_repo",
    ]) {
      expect(canonicalRepositoryUrls({
        repository: placeholderUrl,
        homepage: placeholderUrl,
      })).toBeNull();
    }
    expect(canonicalRepositoryUrls({
      ...packageJson,
      homepage: "https://github.com/pitaji/project-memory?draft=true",
    })).toBeNull();

    const weakApprovals = [
      { ...validApproval(repositoryUrl), approved_at: "0" },
      { ...validApproval(repositoryUrl), approved_by: "pending owner" },
      { ...validApproval(repositoryUrl), approved_by: "Another Owner" },
      { ...validApproval(repositoryUrl), public_author_name: "TODO owner" },
      { ...validApproval(repositoryUrl), public_contact: "security@example.com" },
      { ...validApproval(repositoryUrl), release_channel: "TBD channel" },
      { ...validApproval(repositoryUrl), security_policy_approved: false },
      { ...validApproval(repositoryUrl), authorization_target: "https://github.com/x/y" },
      { ...validApproval(repositoryUrl), authorized_actions: ["repository.push", "TODO action"] },
      { ...validApproval(repositoryUrl), authorization_scope: "arbitrary prose" },
      { ...validApproval(repositoryUrl), authorization_expires_at: "2026-07-17T10:29:59.999Z" },
      {
        ...validApproval(repositoryUrl),
        approved_at: "2026-07-17T10:31:00.000Z",
        authorization_starts_at: "2026-07-17T10:31:00.000Z",
      },
    ];
    for (const approval of weakApprovals) {
      expect(publicationApprovalsComplete(
        approval,
        repositoryUrl,
        "MIT",
        "1.0.0",
        "Pv Vimal Nair",
        CURRENT_TIME,
      )).toBe(false);
    }

    const startsNow = {
      ...validApproval(repositoryUrl),
      approved_at: "2026-07-17T10:30:00.000Z",
      authorization_starts_at: "2026-07-17T10:30:00.000Z",
    };
    const expiresNow = {
      ...validApproval(repositoryUrl),
      authorization_expires_at: "2026-07-17T10:30:00.000Z",
    };
    for (const approval of [startsNow, expiresNow]) {
      expect(publicationApprovalsComplete(
        approval,
        repositoryUrl,
        "MIT",
        "1.0.0",
        "Pv Vimal Nair",
        CURRENT_TIME,
      )).toBe(true);
    }
    expect(publicationApprovalsComplete(
      { ...validApproval(repositoryUrl), license: "LicenseRef-Pending" },
      repositoryUrl,
      "LicenseRef-Pending",
      "1.0.0",
      "Pv Vimal Nair",
      CURRENT_TIME,
    )).toBe(false);
  });

  it("opens only from aligned current metadata, approval, and raw trial evidence", () => {
    const packageJson = validPackageMetadata();
    const plugin = validPluginMetadata();
    const repositoryUrl = canonicalRepositoryUrls(packageJson);
    if (repositoryUrl === null) throw new Error("Expected canonical repository URL");
    const approval = validApproval(repositoryUrl);
    const evidence = validTrialEvidence();

    expect(evaluatePublicationReadiness(
      packageJson,
      plugin,
      approval,
      evidence,
      CURRENT_TIME,
    )).toEqual({ schema_version: "1.0.0", ready: true, mode: "read_only", blockers: [] });

    const placeholderRepositoryUrl = "https://github.com/example/sample";
    const placeholderRepositoryApproval = {
      ...approval,
      repository_url: placeholderRepositoryUrl,
      authorization_target: placeholderRepositoryUrl,
      authorization_scope: {
        ...approval.authorization_scope,
        repository_url: placeholderRepositoryUrl,
      },
    };
    const cases: readonly [string, PublicationReadinessReport][] = [
      ["license", evaluatePublicationReadiness(
        { ...packageJson, license: "UNLICENSED" }, plugin, approval, evidence, CURRENT_TIME,
      )],
      ["repository", evaluatePublicationReadiness(
        { ...packageJson, repository: undefined, homepage: undefined },
        plugin,
        approval,
        evidence,
        CURRENT_TIME,
      )],
      ["approval", evaluatePublicationReadiness(
        packageJson,
        plugin,
        { ...approval, approved_by: "pending owner" },
        evidence,
        CURRENT_TIME,
      )],
      ["trial evidence", evaluatePublicationReadiness(
        packageJson,
        plugin,
        approval,
        { schema_version: "1.0.0", report: evidence.report },
        CURRENT_TIME,
      )],
      ["placeholder license", evaluatePublicationReadiness(
        { ...packageJson, license: "XXX" },
        { ...plugin, license: "XXX" },
        { ...approval, license: "XXX" },
        evidence,
        CURRENT_TIME,
      )],
      ["placeholder repository", evaluatePublicationReadiness(
        {
          ...packageJson,
          repository: { url: "git+https://github.com/example/sample.git" },
          homepage: placeholderRepositoryUrl,
        },
        plugin,
        placeholderRepositoryApproval,
        evidence,
        CURRENT_TIME,
      )],
      ["underscore placeholder repository", evaluatePublicationReadiness(
        {
          ...packageJson,
          repository: { url: "git+https://github.com/pitaji/sample_repo.git" },
          homepage: "https://github.com/pitaji/sample_repo",
        },
        plugin,
        {
          ...approval,
          repository_url: "https://github.com/pitaji/sample_repo",
          authorization_target: "https://github.com/pitaji/sample_repo",
          authorization_scope: {
            ...approval.authorization_scope,
            repository_url: "https://github.com/pitaji/sample_repo",
          },
        },
        evidence,
        CURRENT_TIME,
      )],
      ["plugin license", evaluatePublicationReadiness(
        packageJson,
        { ...plugin, license: "TBA" },
        approval,
        evidence,
        CURRENT_TIME,
      )],
      ["plugin version", evaluatePublicationReadiness(
        packageJson,
        { ...plugin, version: "2.0.0" },
        approval,
        evidence,
        CURRENT_TIME,
      )],
      ["plugin author", evaluatePublicationReadiness(
        packageJson,
        { ...plugin, author: { name: "Another Owner" } },
        approval,
        evidence,
        CURRENT_TIME,
      )],
    ];
    for (const [label, report] of cases) {
      expect(report.ready, label).toBe(false);
      expect(report.blockers.length, label).toBeGreaterThan(0);
    }
  });

  it.each([
    ["MIT", true],
    ["Apache-2.0", true],
    ["UNLICENSED", false],
    ["unlicensed", false],
    ["TBA", false],
    ["LicenseRef-Pending", false],
    ["LicenseRef-Acme", true],
    ["x", false],
    ["XXX", false],
  ] as const)("validates the license candidate %s", (candidate, expected) => {
    expect(approvedSpdx(candidate)).toBe(expected);
  });

  it.each([
    ["1.0.0", true],
    ["1.0.0-rc.1", true],
    ["01.0.0", false],
    ["1.0.0-01", false],
    ["1.0", false],
    ["TBA", false],
  ] as const)("validates the semantic version candidate %s", (candidate, expected) => {
    expect(semanticVersion(candidate)).toBe(expected);
  });

  it("documents the approved public release identity and policies", async () => {
    const [checker, checklist, security, contributing, readme, privacy, approvalsText, packageText] = await Promise.all([
      readFile(CHECKER, "utf8"),
      readFile(path.join(PUBLICATION_ROOT, "PUBLICATION_CHECKLIST.md"), "utf8"),
      readFile(path.join(REPOSITORY_ROOT, "SECURITY.md"), "utf8"),
      readFile(path.join(REPOSITORY_ROOT, "CONTRIBUTING.md"), "utf8"),
      readFile(path.join(REPOSITORY_ROOT, "README.md"), "utf8"),
      readFile(path.join(REPOSITORY_ROOT, "PRIVACY.md"), "utf8"),
      readFile(path.join(PUBLICATION_ROOT, "PUBLICATION_APPROVALS.json"), "utf8"),
      readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
    ]);

    expect(checker).not.toMatch(
      /\b(?:writeFile|appendFile|rm|cp|rename|unlink|spawn|exec|createWriteStream)\b/,
    );
    expect(checklist).toContain("AUTHORIZED FOR v0.1.0 PUBLICATION");
    expect(security).toContain("security/advisories/new");
    expect(contributing).toContain("MIT License");
    for (const expected of [
      "## Technical readiness",
      "## Approved public identity",
      "PUBLICATION_APPROVALS.json",
      "LOWER_REASONING_TRIAL_EVIDENCE.json",
    ]) expect(checklist).toContain(expected);
    expect(checklist).toMatch(/immutable trial records.*exact recomputed report/is);
    expect(readme).toContain("docs/publication/PUBLICATION_CHECKLIST.md");
    expect(readme).toContain("codex plugin add project-memory@project-memory");
    expect(privacy).toMatch(/offline.*no hosted/is);

    const packageJson = JSON.parse(packageText) as {
      readonly license?: unknown;
      readonly homepage?: unknown;
      readonly scripts?: Readonly<Record<string, unknown>>;
    };
    const approvals = JSON.parse(approvalsText) as Record<string, unknown>;
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.homepage).toBe("https://github.com/pv-vimalnair/project-memory");
    expect(approvals.publication_authorized).toBe(true);
    expect(approvals.authorized_actions).toEqual(["repository.push", "github.release.create"]);
    expect(packageJson.scripts?.["publication:check"]).toBe(
      "node scripts/verify-publication-readiness.mjs",
    );
  });

  it("keeps every release-candidate job read-only and non-publishing", async () => {
    const workflowText = await readFile(
      path.join(REPOSITORY_ROOT, ".github", "workflows", "release-candidate.yml"),
      "utf8",
    );
    const workflow = parse(workflowText) as WorkflowDocument;
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs).toBeDefined();
    for (const job of Object.values(workflow.jobs ?? {})) {
      expect(job.permissions ?? workflow.permissions).toEqual({ contents: "read" });
      for (const step of job.steps ?? []) {
        if (step.uses?.toLowerCase().startsWith("actions/checkout@")) {
          expect(step.with?.["persist-credentials"]).toBe(false);
        }
      }
    }
    expect(workflowText).toContain("actions/upload-artifact@v4");
    expect(workflowText).not.toMatch(
      /(?:\bgit\s+push\b|\bnpm\s+publish\b|\bpnpm\s+publish\b|\byarn\s+npm\s+publish\b|\bgh\s+(?:release|repo)\b|\bdocker\s+push\b|\btwine\s+upload\b|\bcargo\s+publish\b|\bnuget\s+push\b|action-gh-release|create-release|release-action|contents:\s*write|packages:\s*write|id-token:\s*write|\bsecrets\.|\bGITHUB_TOKEN\b)/i,
    );
  });
});
