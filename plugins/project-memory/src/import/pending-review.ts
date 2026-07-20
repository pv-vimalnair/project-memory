import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { failure, success, type RuntimeResult } from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import { decodeStrictUtf8, parseJsonDocument } from "../core/document-io.js";
import { sha256 } from "../core/hash.js";
import { resolveInside } from "../core/path-safety.js";
import type {
  LegacyScan,
  LegacyScanner,
  PendingLegacyReview,
} from "./contracts.js";
import { proposeLegacyImport } from "./planner.js";
import { createLegacyScanner } from "./scanner.js";

const IMPORT_REPORT_DIRECTORY = "docs/project-memory/governance/imports";
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const RESOLVED_DISPOSITIONS = new Set(["import", "archive", "reject"]);
const VALID_DISPOSITIONS = new Set([...RESOLVED_DISPOSITIONS, "unresolved"]);
const REVIEWABLE_ROLES = new Set([
  "prd",
  "requirements",
  "handoff",
  "changelog",
  "decision-log",
  "task-list",
  "agent-instructions",
  "readme",
]);

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeSourcePath(value: string): boolean {
  return value.length > 0 &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !path.posix.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !/^[A-Za-z]:/u.test(value) &&
    value !== ".." &&
    !value.startsWith("../") &&
    path.posix.normalize(value) === value;
}

function reportFailure<T>(
  code: "LEGACY_REPORT_INVALID" | "LEGACY_REPORT_CONFLICT" |
    "LEGACY_REPORT_DIRECTORY_UNSAFE",
  message: string,
  reportPath = IMPORT_REPORT_DIRECTORY,
): RuntimeResult<T> {
  return failure(code, message, reportPath);
}

async function resolvedSources(
  root: URL,
  rootId: string,
): Promise<RuntimeResult<ReadonlySet<string>>> {
  const resolvedDirectory = await resolveInside(root, IMPORT_REPORT_DIRECTORY);
  if (!resolvedDirectory.ok) {
    return reportFailure(
      "LEGACY_REPORT_DIRECTORY_UNSAFE",
      "legacy import report directory is unsafe",
    );
  }

  let directoryStat;
  try {
    directoryStat = await lstat(resolvedDirectory.value);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return success(new Set());
    return reportFailure(
      "LEGACY_REPORT_DIRECTORY_UNSAFE",
      "legacy import report directory could not be inspected",
    );
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    return reportFailure(
      "LEGACY_REPORT_DIRECTORY_UNSAFE",
      "legacy import report directory must be a real directory",
    );
  }

  const decisions = new Map<string, string>();
  let entries;
  try {
    entries = await readdir(resolvedDirectory.value, { withFileTypes: true });
  } catch {
    return reportFailure(
      "LEGACY_REPORT_DIRECTORY_UNSAFE",
      "legacy import report directory could not be read",
    );
  }
  entries.sort((left, right) => compareUtf8(left.name, right.name));

  for (const entry of entries) {
    if (!entry.name.endsWith(".json")) continue;
    const reportPath = `${IMPORT_REPORT_DIRECTORY}/${entry.name}`;
    const proposalHash = entry.name.slice(0, -".json".length);
    if (!entry.isFile() || entry.isSymbolicLink() || !SHA256_PATTERN.test(proposalHash)) {
      return reportFailure(
        "LEGACY_REPORT_INVALID",
        "legacy import report name or file type is invalid",
        reportPath,
      );
    }
    const resolvedReport = await resolveInside(root, reportPath);
    if (!resolvedReport.ok) {
      return reportFailure("LEGACY_REPORT_INVALID", "legacy import report path is unsafe", reportPath);
    }

    let bytes: Uint8Array;
    try {
      const reportStat = await lstat(resolvedReport.value);
      if (!reportStat.isFile() || reportStat.isSymbolicLink()) {
        return reportFailure("LEGACY_REPORT_INVALID", "legacy import report must be a real file", reportPath);
      }
      bytes = new Uint8Array(await readFile(resolvedReport.value));
    } catch {
      return reportFailure("LEGACY_REPORT_INVALID", "legacy import report could not be read", reportPath);
    }
    const decoded = decodeStrictUtf8(bytes, reportPath);
    if (!decoded.ok) {
      return reportFailure("LEGACY_REPORT_INVALID", "legacy import report must be strict UTF-8", reportPath);
    }
    const parsed = parseJsonDocument(decoded.value, reportPath);
    if (!parsed.ok || !isRecord(parsed.value)) {
      return reportFailure("LEGACY_REPORT_INVALID", "legacy import report must be valid JSON", reportPath);
    }
    const report = parsed.value;
    if (
      report.schema_version !== "1.0.0" ||
      report.root_id !== rootId ||
      report.proposal_hash !== proposalHash ||
      !Array.isArray(report.candidates)
    ) {
      return reportFailure("LEGACY_REPORT_INVALID", "legacy import report identity is invalid", reportPath);
    }

    for (const rawCandidate of report.candidates) {
      if (!isRecord(rawCandidate)) {
        return reportFailure("LEGACY_REPORT_INVALID", "legacy import report candidate is invalid", reportPath);
      }
      const sourcePath = rawCandidate.source_path;
      const sourceHash = rawCandidate.source_sha256;
      const disposition = rawCandidate.disposition;
      if (
        typeof sourcePath !== "string" ||
        !isSafeSourcePath(sourcePath) ||
        typeof sourceHash !== "string" ||
        !SHA256_PATTERN.test(sourceHash) ||
        typeof disposition !== "string" ||
        !VALID_DISPOSITIONS.has(disposition)
      ) {
        return reportFailure("LEGACY_REPORT_INVALID", "legacy import report candidate fields are invalid", reportPath);
      }
      if (!RESOLVED_DISPOSITIONS.has(disposition)) continue;
      const key = `${sourcePath}\0${sourceHash}`;
      const existing = decisions.get(key);
      if (existing !== undefined && existing !== disposition) {
        return reportFailure(
          "LEGACY_REPORT_CONFLICT",
          "legacy import reports contradict one another for the same source revision",
          sourcePath,
        );
      }
      decisions.set(key, disposition);
    }
  }
  return success(new Set(decisions.keys()));
}

export async function findPendingLegacyReview(
  root: URL,
  rootId: string,
  scanner: LegacyScanner = createLegacyScanner(),
): Promise<RuntimeResult<PendingLegacyReview | null>> {
  const resolved = await resolvedSources(root, rootId);
  if (!resolved.ok) return resolved;

  const scanned = await scanner.scan(root, { phase: "post_bootstrap" });
  if (!scanned.ok) return scanned;
  const artifacts = scanned.value.artifacts.filter((artifact) =>
    artifact.detected_roles.some((role) => REVIEWABLE_ROLES.has(role)) &&
    !resolved.value.has(`${artifact.relative_path}\0${artifact.sha256}`)
  );
  if (artifacts.length === 0) return success(null);

  const scanBody = {
    schema_version: "1.0.0" as const,
    root: scanned.value.root,
    artifacts,
  };
  const scan: LegacyScan = {
    ...scanBody,
    scan_hash: sha256(canonicalJson(scanBody)),
  };
  const proposal = proposeLegacyImport(scan, {
    root_id: rootId,
    governing_document: "docs/project-memory/source/PROJECT.md",
  });
  if (!proposal.ok) return proposal;
  return success({ root_id: rootId, scan, proposal: proposal.value });
}