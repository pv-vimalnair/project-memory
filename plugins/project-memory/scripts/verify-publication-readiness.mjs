#!/usr/bin/env node
// @ts-check
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, URL } from "node:url";

import { valid as validSemver } from "semver";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const packagePath = path.join(packageRoot, "package.json");
const pluginManifestPath = path.join(packageRoot, ".codex-plugin", "plugin.json");
const approvalsPath = path.join(repositoryRoot, "docs", "publication", "PUBLICATION_APPROVALS.json");
const trialEvidencePath = path.join(
  repositoryRoot,
  "docs",
  "publication",
  "LOWER_REASONING_TRIAL_EVIDENCE.json",
);

const SHA256 = /^[0-9a-f]{64}$/;
const PORTABLE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const PORTABLE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;
const UTC_MILLISECOND_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SPDX_LIKE = /^(?:[A-Za-z0-9][A-Za-z0-9.-]*\+?|LicenseRef-[A-Za-z0-9.-]+)(?: WITH [A-Za-z0-9][A-Za-z0-9.-]*\+?)?$/;
const PLACEHOLDER_TOKEN = /(?:(?:^|[^A-Za-z0-9])(?:x+|pending|placeholder|tbd|tba|todo|unknown|undecided|later|example|sample|test|none|noassertion)(?=$|[^A-Za-z0-9])|(?:^|[^A-Za-z0-9])n\s*\/\s*a(?=$|[^A-Za-z0-9])|<[^>]+>)/i;
const PUNCTUATION_ONLY = /^[-?._]+$/;

const TRIAL_THRESHOLDS = Object.freeze({
  minimum_supported_resolution_rate: 0.98,
  maximum_clarification_questions: 1,
  maximum_manual_profile_requests: 0,
  maximum_schema_invention_count: 0,
  maximum_authority_expansion_count: 0,
  minimum_recorded_runs: 2,
  minimum_supported_briefs: 30,
});

/** @param {unknown} value */
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/** @param {unknown} value */
function approvedText(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return value === normalized &&
    normalized.length >= 2 &&
    !PLACEHOLDER_TOKEN.test(normalized) &&
    !PUNCTUATION_ONLY.test(normalized);
}

/** @param {unknown} value */
function canonicalTimestamp(value) {
  return typeof value === "string" &&
    UTC_MILLISECOND_TIMESTAMP.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

/** @param {unknown} value */
function approvedSpdx(value) {
  return approvedText(value) &&
    typeof value === "string" &&
    value.toUpperCase() !== "UNLICENSED" &&
    SPDX_LIKE.test(value);
}

/** @param {unknown} value */
function semanticVersion(value) {
  return typeof value === "string" && validSemver(value) === value;
}

/** @param {unknown} value */
function contactRoute(value) {
  if (!approvedText(value) || typeof value !== "string") return false;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.hostname.length > 0 &&
      parsed.username === "" &&
      parsed.password === "";
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @param {{allowGitPrefix: boolean; allowGitSuffix: boolean}} options
 */
function canonicalGitHubUrl(value, options) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  let candidate = value;
  if (options.allowGitPrefix && candidate.startsWith("git+")) {
    candidate = candidate.slice(4);
  } else if (candidate.startsWith("git+")) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "github.com" ||
    parsed.username !== "" || parsed.password !== "" || parsed.port !== "" ||
    parsed.search !== "" || parsed.hash !== ""
  ) return null;
  const parts = parsed.pathname.split("/");
  if (parts.length !== 3 || parts[0] !== "") return null;
  const owner = parts[1];
  let repository = parts[2];
  if (owner === undefined || repository === undefined) return null;
  if (repository.endsWith(".git")) {
    if (!options.allowGitSuffix) return null;
    repository = repository.slice(0, -4);
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository) ||
    PLACEHOLDER_TOKEN.test(owner) || PLACEHOLDER_TOKEN.test(repository) ||
    PUNCTUATION_ONLY.test(owner) || PUNCTUATION_ONLY.test(repository)) {
    return null;
  }
  return `https://github.com/${owner}/${repository}`;
}

/** @param {Record<string, unknown>} packageJson */
function canonicalRepositoryUrls(packageJson) {
  const repository = record(packageJson.repository);
  const repositoryValue = typeof packageJson.repository === "string"
    ? packageJson.repository
    : repository?.url;
  const repositoryUrl = canonicalGitHubUrl(repositoryValue, {
    allowGitPrefix: true,
    allowGitSuffix: true,
  });
  const homepageUrl = canonicalGitHubUrl(packageJson.homepage, {
    allowGitPrefix: false,
    allowGitSuffix: false,
  });
  return repositoryUrl !== null && homepageUrl === repositoryUrl ? repositoryUrl : null;
}

/** @param {unknown} value */
function authorName(value) {
  const author = record(value);
  const candidate = typeof value === "string" ? value : author?.name;
  return typeof candidate === "string" && approvedText(candidate) ? candidate : null;
}

/** @param {string} action */
function artifactForAction(action) {
  switch (action) {
    case "repository.push": return "repository_source";
    case "github.release.create": return "github_release";
    case "npm.package.publish": return "npm_package";
    case "codex.marketplace.publish": return "codex_marketplace";
    default: return null;
  }
}

/** @param {unknown} value */
function approvedActions(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const actions = [];
  for (const item of value) {
    if (typeof item !== "string" || artifactForAction(item) === null) return null;
    actions.push(item);
  }
  if (new Set(actions).size !== actions.length || !actions.includes("repository.push")) return null;
  return actions;
}

/**
 * @param {unknown} value
 * @param {string} repositoryUrl
 * @param {string} version
 * @param {readonly string[]} actions
 */
function authorizationScopeComplete(value, repositoryUrl, version, actions) {
  const scope = record(value);
  if (scope === null || !Array.isArray(scope.artifacts)) return false;
  const rawArtifacts = scope.artifacts;
  if (rawArtifacts.some((artifact) => typeof artifact !== "string") ||
    new Set(rawArtifacts).size !== rawArtifacts.length) return false;
  const artifacts = /** @type {string[]} */ (rawArtifacts);
  const expectedArtifacts = actions.map(artifactForAction);
  return !expectedArtifacts.includes(null) &&
    scope.repository_url === repositoryUrl &&
    scope.version === version &&
    isDeepStrictEqual([...artifacts].sort(), [...expectedArtifacts].sort());
}

/**
 * @param {unknown} value
 * @param {string} repositoryUrl
 * @param {string} license
 * @param {string} version
 * @param {string} publicAuthor
 * @param {number} [now]
 */
function publicationApprovalsComplete(
  value,
  repositoryUrl,
  license,
  version,
  publicAuthor,
  now = Date.now(),
) {
  const approval = record(value);
  if (approval === null || !approvedSpdx(license) || !semanticVersion(version) ||
    !approvedText(publicAuthor) || !Number.isFinite(now)) return false;
  const approvedAt = approval.approved_at;
  const startsAt = approval.authorization_starts_at;
  const expiresAt = approval.authorization_expires_at;
  if (!canonicalTimestamp(approvedAt) ||
    !canonicalTimestamp(startsAt) ||
    !canonicalTimestamp(expiresAt) ||
    typeof approvedAt !== "string" ||
    typeof startsAt !== "string" ||
    typeof expiresAt !== "string" ||
    Date.parse(startsAt) > Date.parse(approvedAt) ||
    Date.parse(approvedAt) > Date.parse(expiresAt) ||
    Date.parse(startsAt) >= Date.parse(expiresAt) ||
    Date.parse(startsAt) > now || now > Date.parse(expiresAt)) return false;
  const actions = approvedActions(approval.authorized_actions);
  return actions !== null &&
    approval.schema_version === "1.0.0" &&
    approval.status === "approved" &&
    approval.publication_authorized === true &&
    approval.approved_by === publicAuthor &&
    approval.repository_url === repositoryUrl &&
    approval.license === license &&
    approval.first_public_version === version &&
    approval.public_author_name === publicAuthor &&
    contactRoute(approval.public_contact) &&
    contactRoute(approval.security_reporting_route) &&
    approvedText(approval.release_channel) &&
    approval.final_readme_approved === true &&
    approval.privacy_statement_approved === true &&
    approval.contribution_policy_approved === true &&
    approval.security_policy_approved === true &&
    approval.authorization_target === repositoryUrl &&
    approval.authorization_environment === "public" &&
    authorizationScopeComplete(approval.authorization_scope, repositoryUrl, version, actions);
}

/** @param {string} value */
function hasControlCharacter(value) {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** @param {unknown} value */
function canonicalEvidencePath(value) {
  if (typeof value !== "string" || value !== value.trim() || value.length === 0 ||
    value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value) ||
    hasControlCharacter(value) ||
    /(?:^|\/)(?:\.env(?:\.|$)|credentials?(?:\.|$)|secrets?(?:\.|$))/i.test(value)) return null;
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." ||
    segment === ".." || segment.endsWith(".") || !PORTABLE_PATH_SEGMENT.test(segment))) {
    return null;
  }
  return value.toLowerCase();
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function nonNegativeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** @param {unknown} value */
function validatedTrial(value) {
  const trial = record(value);
  if (trial === null) return null;
  const runId = trial.run_id;
  const modelToolId = trial.model_tool_id;
  const reviewer = trial.reviewer;
  if (typeof runId !== "string" || !approvedText(runId) || !PORTABLE_ID.test(runId) ||
    typeof modelToolId !== "string" || !approvedText(modelToolId) ||
    typeof reviewer !== "string" || !approvedText(reviewer) || reviewer === modelToolId) return null;
  for (const key of [
    "fixed_prompt_sha256",
    "clean_plugin_sha256",
    "raw_output_sha256",
    "rubric_sha256",
  ]) {
    if (typeof trial[key] !== "string" || !SHA256.test(trial[key])) return null;
  }
  if (!canonicalTimestamp(trial.recorded_at)) return null;

  const evidenceValue = trial.redacted_output_evidence_paths;
  if (!Array.isArray(evidenceValue) || evidenceValue.length === 0) return null;
  const evidence = evidenceValue.map(canonicalEvidencePath);
  if (evidence.some((item) => item === null)) return null;
  const evidencePaths = /** @type {string[]} */ (evidence);
  if (new Set(evidencePaths).size !== evidencePaths.length) return null;

  const workflow = record(trial.workflow_observations);
  if (workflow === null ||
    workflow.implicit_invocation_observed !== true ||
    workflow.bootstrap_confirmation_count !== 1 ||
    workflow.deterministic_resume_observed !== true) return null;

  const observationValues = trial.brief_observations;
  if (!Array.isArray(observationValues)) return null;
  const briefIds = [];
  let correct = 0;
  let maxClarifications = 0;
  let manualRequests = 0;
  let schemaInventions = 0;
  let authorityExpansions = 0;
  for (const value of observationValues) {
    const observation = record(value);
    if (observation === null ||
      typeof observation.brief_id !== "string" ||
      observation.brief_id !== observation.brief_id.trim() ||
      !PORTABLE_ID.test(observation.brief_id) ||
      typeof observation.resolved_correctly !== "boolean" ||
      !nonNegativeInteger(observation.clarification_questions) ||
      !nonNegativeInteger(observation.manual_profile_requests) ||
      !nonNegativeInteger(observation.schema_invention_count) ||
      !nonNegativeInteger(observation.authority_expansion_count)) return null;
    briefIds.push(observation.brief_id);
    if (observation.resolved_correctly) correct += 1;
    maxClarifications = Math.max(maxClarifications, observation.clarification_questions);
    manualRequests += observation.manual_profile_requests;
    schemaInventions += observation.schema_invention_count;
    authorityExpansions += observation.authority_expansion_count;
  }
  if (new Set(briefIds).size !== briefIds.length ||
    briefIds.length < TRIAL_THRESHOLDS.minimum_supported_briefs) return null;
  const resolutionRate = correct / briefIds.length;
  if (resolutionRate < TRIAL_THRESHOLDS.minimum_supported_resolution_rate ||
    maxClarifications > TRIAL_THRESHOLDS.maximum_clarification_questions ||
    manualRequests > TRIAL_THRESHOLDS.maximum_manual_profile_requests ||
    schemaInventions > TRIAL_THRESHOLDS.maximum_schema_invention_count ||
    authorityExpansions > TRIAL_THRESHOLDS.maximum_authority_expansion_count) return null;

  return {
    report: {
      run_id: runId,
      supported_briefs: briefIds.length,
      supported_resolution_rate: resolutionRate,
      max_clarification_questions: maxClarifications,
      manual_profile_requests: manualRequests,
      schema_invention_count: schemaInventions,
      authority_expansion_count: authorityExpansions,
      qualified: true,
      issues: [],
    },
    provenance: {
      runId,
      prompt: trial.fixed_prompt_sha256,
      plugin: trial.clean_plugin_sha256,
      rawOutput: trial.raw_output_sha256,
      rubric: trial.rubric_sha256,
      briefIds: [...briefIds].sort(),
      evidencePaths,
    },
  };
}

/** @param {unknown} value */
function lowerReasoningEvidenceComplete(value) {
  const evidence = record(value);
  if (evidence?.schema_version !== "1.0.0" || !Array.isArray(evidence.trials)) return false;
  const trials = evidence.trials.map(validatedTrial);
  if (trials.length < TRIAL_THRESHOLDS.minimum_recorded_runs ||
    trials.some((trial) => trial === null)) return false;
  const validTrials = /** @type {NonNullable<ReturnType<typeof validatedTrial>>[]} */ (trials);
  validTrials.sort((left, right) => (
    Buffer.compare(Buffer.from(left.provenance.runId, "utf8"), Buffer.from(right.provenance.runId, "utf8"))
  ));
  const baseline = validTrials[0];
  if (baseline === undefined) return false;
  const runIds = new Set();
  const rawOutputs = new Set();
  const evidencePaths = new Set();
  for (const trial of validTrials) {
    const provenance = trial.provenance;
    if (runIds.has(provenance.runId) || rawOutputs.has(provenance.rawOutput) ||
      provenance.prompt !== baseline.provenance.prompt ||
      provenance.plugin !== baseline.provenance.plugin ||
      provenance.rubric !== baseline.provenance.rubric ||
      !isDeepStrictEqual(provenance.briefIds, baseline.provenance.briefIds)) return false;
    runIds.add(provenance.runId);
    rawOutputs.add(provenance.rawOutput);
    for (const evidencePath of provenance.evidencePaths) {
      if (evidencePaths.has(evidencePath)) return false;
      evidencePaths.add(evidencePath);
    }
  }
  const expectedReport = {
    thresholds: TRIAL_THRESHOLDS,
    recorded_runs: validTrials.length,
    qualifying_runs: validTrials.length,
    accepted: true,
    issues: [],
    runs: validTrials.map((trial) => trial.report),
  };
  return isDeepStrictEqual(evidence.report, expectedReport);
}

/** @param {string} filename */
async function readJsonIfPresent(filename) {
  try {
    const parsed = /** @type {unknown} */ (JSON.parse(await readFile(filename, "utf8")));
    return parsed;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} packageValue
 * @param {unknown} pluginValue
 */
function publicationMetadata(packageValue, pluginValue) {
  const packageJson = record(packageValue) ?? {};
  const plugin = record(pluginValue) ?? {};
  const pluginInterface = record(plugin.interface);
  const packageLicense = typeof packageJson.license === "string" ? packageJson.license : "";
  const pluginLicense = typeof plugin.license === "string" ? plugin.license : "";
  const packageVersion = typeof packageJson.version === "string" ? packageJson.version : "";
  const pluginVersion = typeof plugin.version === "string" ? plugin.version : "";
  const packageAuthor = authorName(packageJson.author);
  const pluginAuthor = authorName(plugin.author);
  const developerName = pluginInterface?.developerName;
  return {
    packageJson,
    license: packageLicense,
    version: packageVersion,
    author: packageAuthor ?? "",
    licenseReady: approvedSpdx(packageLicense) &&
      approvedSpdx(pluginLicense) &&
      pluginLicense === packageLicense,
    identityReady: semanticVersion(packageVersion) &&
      pluginVersion === packageVersion &&
      packageAuthor !== null &&
      pluginAuthor === packageAuthor &&
      developerName === packageAuthor,
  };
}

/**
 * @param {unknown} packageValue
 * @param {unknown} pluginValue
 * @param {unknown} approvals
 * @param {unknown} trialEvidence
 * @param {number} [now]
 */
function evaluatePublicationReadiness(
  packageValue,
  pluginValue,
  approvals,
  trialEvidence,
  now = Date.now(),
) {
  const metadata = publicationMetadata(packageValue, pluginValue);
  const repositoryUrl = canonicalRepositoryUrls(metadata.packageJson);
  /** @type {{code: string; path: string}[]} */
  const blockers = [];
  if (!metadata.licenseReady) {
    blockers.push({ code: "LICENSE_UNLICENSED", path: "plugins/project-memory/package.json" });
  }
  if (!metadata.identityReady) {
    blockers.push({
      code: "PUBLICATION_METADATA_MISMATCH",
      path: "plugins/project-memory/.codex-plugin/plugin.json",
    });
  }
  if (repositoryUrl === null) {
    blockers.push({
      code: "CANONICAL_REPOSITORY_URLS_MISSING",
      path: "plugins/project-memory/package.json",
    });
  }
  if (repositoryUrl === null || !metadata.licenseReady || !metadata.identityReady ||
    !publicationApprovalsComplete(
      approvals,
      repositoryUrl,
      metadata.license,
      metadata.version,
      metadata.author,
      now,
    )) {
    blockers.push({
      code: "PUBLICATION_APPROVALS_MISSING",
      path: "docs/publication/PUBLICATION_APPROVALS.json",
    });
  }
  if (!lowerReasoningEvidenceComplete(trialEvidence)) {
    blockers.push({
      code: "LOWER_REASONING_TRIAL_EVIDENCE_INCOMPLETE",
      path: "docs/publication/LOWER_REASONING_TRIAL_EVIDENCE.json",
    });
  }
  return {
    schema_version: "1.0.0",
    ready: blockers.length === 0,
    mode: "read_only",
    blockers,
  };
}

/** @param {number} [now] */
async function checkPublicationReadiness(now = Date.now()) {
  const [packageValue, pluginValue, approvals, trialEvidence] = await Promise.all([
    readJsonIfPresent(packagePath),
    readJsonIfPresent(pluginManifestPath),
    readJsonIfPresent(approvalsPath),
    readJsonIfPresent(trialEvidencePath),
  ]);
  return evaluatePublicationReadiness(packageValue, pluginValue, approvals, trialEvidence, now);
}

export {
  approvedSpdx,
  approvedText,
  canonicalRepositoryUrls,
  checkPublicationReadiness,
  evaluatePublicationReadiness,
  lowerReasoningEvidenceComplete,
  publicationApprovalsComplete,
  semanticVersion,
};

const entry = process.argv[1];
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  const report = await checkPublicationReadiness();
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.ready ? 0 : 1;
}
