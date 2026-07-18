import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDefaultDoctorDependencies, inspectRepository } from "../cli/commands/doctor.js";
import { buildInitPlan } from "../cli/init/build-init-plan.js";
import {
  failure,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { resolveInside } from "../core/path-safety.js";
import { currentGitBranchRef } from "../core/git-cli-client.js";
import {
  createLegacyImporter,
  type LegacyDocumentRole,
} from "../import/index.js";
import { createProfileVerifier } from "../profile/verify-profile.js";
import type { AgentStartDependencies } from "./contracts.js";
import { inferRepositoryBrief } from "./infer-repository-brief.js";
import { createNodeViewVerifier } from "./node-view-verifier.js";

const REVIEWABLE_LEGACY_ROLES = new Set<LegacyDocumentRole>([
  "prd",
  "requirements",
  "handoff",
  "changelog",
  "decision-log",
  "task-list",
  "agent-instructions",
]);

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

async function catalogBundleUrl(): Promise<RuntimeResult<URL>> {
  const candidates = [
    new URL("../catalog/project-memory/1.0.0/catalog.bundle.json", import.meta.url),
    new URL("../../dist/catalog/project-memory/1.0.0/catalog.bundle.json", import.meta.url),
    new URL("./catalog/project-memory/1.0.0/catalog.bundle.json", import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      const stat = await lstat(candidate);
      if (!stat.isSymbolicLink() && stat.isFile()) return success(candidate);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return failure(
          "AGENT_CATALOG_READ_FAILED",
          error instanceof Error ? error.message : String(error),
          candidate.href,
        );
      }
    }
  }
  return failure(
    "AGENT_CATALOG_BUNDLE_MISSING",
    "the bundled Project Memory catalog release is unavailable",
    "dist/catalog/project-memory/1.0.0/catalog.bundle.json",
  );
}

function warningIssues(
  report: Awaited<ReturnType<typeof inspectRepository>>,
): readonly RuntimeIssue[] {
  return report.checks.flatMap((check) =>
    check.status === "warning" && check.issue !== null ? [check.issue] : [],
  );
}

async function findAssignedTaskPackets(
  root: URL,
): Promise<RuntimeResult<readonly string[]>> {
  const workstreams = await resolveInside(root, "docs/project-memory/workstreams");
  if (!workstreams.ok) return workstreams;
  let rootStat;
  try {
    rootStat = await lstat(workstreams.value);
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? success([])
      : failure(
          "AGENT_TASK_PACKET_SCAN_FAILED",
          error instanceof Error ? error.message : String(error),
          "docs/project-memory/workstreams",
        );
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return failure(
      "AGENT_TASK_PACKET_ROOT_UNSAFE",
      "workstream task root must be a regular directory",
      "docs/project-memory/workstreams",
    );
  }
  const rootPath = fileURLToPath(root);
  const pending = [fileURLToPath(workstreams.value)];
  const packets: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error: unknown) {
      return failure(
        "AGENT_TASK_PACKET_SCAN_FAILED",
        error instanceof Error ? error.message : String(error),
        path.relative(rootPath, current).replaceAll(path.sep, "/"),
      );
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      const relative = path.relative(rootPath, target).replaceAll(path.sep, "/");
      if (entry.isSymbolicLink()) {
        return failure(
          "AGENT_TASK_PACKET_PATH_UNSAFE",
          "task packet scan cannot follow symlinks",
          relative,
        );
      }
      if (entry.isDirectory()) pending.push(target);
      if (entry.isFile() && entry.name === "TASK.md") packets.push(relative);
    }
  }
  return success(packets.sort(compareUtf8));
}

export function createNodeAgentStartDependencies(
  now: () => Date = () => new Date(),
): AgentStartDependencies {
  const profiles = createProfileVerifier();
  const importer = createLegacyImporter();
  const views = createNodeViewVerifier();
  const doctorDependencies = {
    ...createDefaultDoctorDependencies(),
    async views(root: URL) {
      const report = await views.verify(root);
      return report.ok
        ? success({
            valid: report.value.valid,
            drifted_paths: [...new Set([
              ...report.value.drifted_paths,
              ...report.value.missing_paths,
              ...report.value.metadata_invalid_paths,
            ])].sort(compareUtf8),
          }, report.warnings)
        : report;
    },
  };
  return {
    async doctor(input) {
      const report = await inspectRepository(input.root, doctorDependencies);
      return success(report, warningIssues(report));
    },
    async planInitialization(input) {
      const catalog = await catalogBundleUrl();
      if (!catalog.ok) return catalog;
      const created = now();
      if (!Number.isFinite(created.getTime())) {
        return failure("AGENT_CLOCK_INVALID", "agent startup clock must be valid");
      }
      const targetRef = await currentGitBranchRef(input.root);
      if (!targetRef.ok) return targetRef;
      let briefPath: string;
      let briefText: string | undefined;
      if (input.brief_path === null) {
        const inferred = await inferRepositoryBrief(input.root);
        if (!inferred.ok) return inferred;
        briefPath = inferred.value.brief_path;
        briefText = inferred.value.brief_text;
      } else {
        briefPath = input.brief_path;
      }
      return buildInitPlan({
        root: input.root.href,
        brief_path: briefPath,
        ...(briefText === undefined ? {} : { brief_text: briefText }),
        catalog_bundle_path: catalog.value.href,
        agent_adapter: input.adapter_id,
        target_ref: targetRef.value,
        created_at: created.toISOString(),
        expires_at: new Date(created.getTime() + 60 * 60 * 1000).toISOString(),
      });
    },
    verifyProfile: (root) => profiles.verify(root),
    verifyViews: (root) => views.verify(root),
    findAssignedTaskPackets,
    async proposeLegacyImport(input) {
      const scan = await importer.scan(input.root);
      if (!scan.ok) return scan;
      const reviewable = scan.value.artifacts.some((artifact) =>
        artifact.detected_roles.some((role) => REVIEWABLE_LEGACY_ROLES.has(role)));
      if (!reviewable) return success(null, scan.warnings);
      const proposal = importer.propose(scan.value, {
        root_id: input.root_id,
        governing_document: "docs/project-memory/source/PROJECT.md",
      });
      return proposal.ok
        ? success(proposal.value, [...scan.warnings, ...proposal.warnings])
        : proposal;
    },
  };
}
