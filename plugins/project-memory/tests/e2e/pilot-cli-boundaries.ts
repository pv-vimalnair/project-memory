import { readFile } from "node:fs/promises";

import { CommandRegistry } from "../../src/cli/command-registry.js";
import { createImportCommands } from "../../src/cli/commands/import.js";
import { createMigrateCommands } from "../../src/cli/commands/migrate.js";
import { executeCli } from "../../src/cli/main.js";
import {
  canonicalJson,
  canonicalMutationPlanHash,
  failure,
  sha256,
  success,
  type CanonicalMutationPlan,
  type RuntimeResult,
} from "../../src/index.js";
import { planReviewedImport, type ReviewedImportPlanInput } from "../../src/import/index.js";
import {
  createMigrationRegistry,
  createMigrationService,
  type MigrationDefinition,
  type MigrationPlanInput,
  type MigrationService,
} from "../../src/migrations/index.js";
import { git } from "../governance/bootstrap-test-fixture.js";
import type {
  CliBoundaryResult,
  ImportBoundaryResult,
  PilotCliDependencies,
} from "./pilot-types.js";

function must<T>(result: RuntimeResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

const normalizeLegacySource: MigrationDefinition = {
  id: "pilot-normalize-legacy",
  from_version: "1.0.0",
  to_version: "1.0.1",
  affected_artifacts: ["canonical-source"],
  authority_impact: "none",
  transform(input) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
    } catch (error: unknown) {
      return failure(
        "PILOT_MIGRATION_UTF8_INVALID",
        error instanceof Error ? error.message : String(error),
        input.relative_path,
      );
    }
    const normalized = text.replace(/^# Legacy/u, "# Normalized legacy");
    if (normalized === text) {
      return failure(
        "PILOT_MIGRATION_MARKER_MISSING",
        "sanitized legacy source lacks its reviewed marker",
        input.relative_path,
      );
    }
    return success({
      bytes: new TextEncoder().encode(normalized),
      semantic_diff: [{ path: "/heading", before: "Legacy", after: "Normalized legacy" }],
    });
  },
};

function migrationService(): MigrationService {
  const registry = must(createMigrationRegistry([normalizeLegacySource]));
  return createMigrationService(registry);
}

async function migrationInput(
  dependencies: PilotCliDependencies,
): Promise<MigrationPlanInput> {
  const bytes = new Uint8Array(await readFile(new URL("LEGACY_PRD.md", dependencies.root)));
  return {
    root_id: dependencies.root_id,
    target_ref: dependencies.target_ref,
    expected_head: await dependencies.current_head(),
    profile_lock_hash: dependencies.profile_lock_hash,
    artifact: {
      kind: "canonical-source",
      relative_path: "LEGACY_PRD.md",
      bytes,
      sha256: sha256(bytes),
    },
    from_version: "1.0.0",
    to_version: "1.0.1",
    created_by: dependencies.actor_id,
    created_at: dependencies.now.toISOString(),
    expires_at: new Date(dependencies.now.getTime() + 5 * 60_000).toISOString(),
    approval_ids: [],
  };
}

export async function runMigrationBoundary(
  dependencies: PilotCliDependencies,
): Promise<CliBoundaryResult> {
  const base = migrationService();
  let planCalls = 0;
  const service: MigrationService = {
    list: () => base.list(),
    plan(input) {
      planCalls += 1;
      return base.plan(input);
    },
  };
  const reviewed = must(await service.plan(await migrationInput(dependencies)));
  planCalls = 0;
  const before = dependencies.receipts.length;
  const arguments_ = [
    "migrate", "apply", "--input", "migration.json",
    "--expected-plan-hash", reviewed.plan_hash,
    "--expected-head", reviewed.expected_head,
  ];
  const execution = await executeCli(arguments_, {
    registry: new CommandRegistry(createMigrateCommands({
      service,
      coordinator: dependencies.coordinator,
      read_input: async () => success(await migrationInput(dependencies)),
    })),
    current_directory: dependencies.root,
  });
  if (execution.exit_code !== 0) throw new Error(execution.stderr || execution.stdout);
  return {
    exit_code: execution.exit_code,
    plan_calls: planCalls,
    finalize_calls: dependencies.receipts.length - before,
    used_cli_lease_argument: arguments_.some((value) => value.includes("lease")),
    subsystem_has_direct_writer: "apply" in service || "write" in service,
  };
}

const IMPORT_TARGET_PATH = "docs/project-memory/source/PILOT_IMPORT.md";

async function ensureImportTarget(
  dependencies: PilotCliDependencies,
): Promise<void> {
  try {
    await readFile(new URL(IMPORT_TARGET_PATH, dependencies.root));
    return;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const body: Omit<CanonicalMutationPlan<unknown>, "plan_hash"> = {
    schema_version: "1.0.0",
    plan_id: `pilot.import-target:${dependencies.slug}`,
    mutation_kind: "administrative",
    root_id: dependencies.root_id,
    target_ref: dependencies.target_ref,
    expected_head: await dependencies.current_head(),
    profile_lock_hash: dependencies.profile_lock_hash,
    writes: [{
      relative_path: IMPORT_TARGET_PATH,
      bytes: new TextEncoder().encode(
        `# ${dependencies.slug} pilot import target\n\nNo reviewed legacy source has been accepted.\n`,
      ),
      expected_existing_sha256: null,
      mode: "create",
    }],
    record_ids: [],
    event_ids: [],
    approval_ids: [],
    evidence_ids: [],
    created_by: dependencies.actor_id,
    created_at: dependencies.now.toISOString(),
    expires_at: new Date(dependencies.now.getTime() + 5 * 60_000).toISOString(),
    metadata: {
      governance_kind: "administrative",
      operation: "create_pilot_import_target",
    },
  };
  must(await dependencies.coordinator.finalizeMutation({
    ...body,
    plan_hash: canonicalMutationPlanHash(body),
  }));
}

async function reviewedImportInput(
  dependencies: PilotCliDependencies,
): Promise<ReviewedImportPlanInput> {
  const source = new Uint8Array(await readFile(new URL("LEGACY_PRD.md", dependencies.root)));
  const project = new Uint8Array(await readFile(
    new URL(IMPORT_TARGET_PATH, dependencies.root),
  ));
  const projectText = new TextDecoder("utf-8", { fatal: true }).decode(project);
  const replacement = new TextEncoder().encode(
    `${projectText.trimEnd()}\n\nImported pilot review: ${dependencies.slug}.\n`,
  );
  return {
    root_id: dependencies.root_id,
    target_ref: dependencies.target_ref,
    expected_head: await dependencies.current_head(),
    profile_lock_hash: dependencies.profile_lock_hash,
    proposal_hash: sha256(canonicalJson({
      slug: dependencies.slug,
      source_sha256: sha256(source),
    })),
    created_by: dependencies.actor_id,
    created_at: dependencies.now.toISOString(),
    expires_at: new Date(dependencies.now.getTime() + 5 * 60_000).toISOString(),
    approval_ids: [dependencies.approval_id],
    candidates: [{
      candidate_id: `candidate.${dependencies.slug}`,
      source_path: "LEGACY_PRD.md",
      source_bytes: source,
      expected_source_sha256: sha256(source),
      sensitivity_findings: [],
      redacted_bytes: null,
      decision: {
        candidate_id: `candidate.${dependencies.slug}`,
        disposition: "import",
        destination: {
          kind: "canonical_document_patch",
          document_path: "docs/project-memory/source/PILOT_IMPORT.md",
          patch: {
            expected_existing_sha256: sha256(project),
            replacement_bytes: replacement,
          },
          approval_id: dependencies.approval_id,
        },
        rationale: "Pitaji approved this sanitized pilot source-document patch.",
      },
    }],
  };
}

export async function runImportBoundary(
  dependencies: PilotCliDependencies,
): Promise<ImportBoundaryResult> {
  await ensureImportTarget(dependencies);
  let planCalls = 0;
  const planner = {
    plan(input: ReviewedImportPlanInput) {
      planCalls += 1;
      return planReviewedImport(input);
    },
  };
  const reviewed = must(planner.plan(await reviewedImportInput(dependencies)));
  planCalls = 0;
  const before = dependencies.receipts.length;
  const arguments_ = [
    "import", "apply", "--input", "reviewed-import.json",
    "--expected-plan-hash", reviewed.plan_hash,
    "--expected-head", reviewed.expected_head,
  ];
  const execution = await executeCli(arguments_, {
    registry: new CommandRegistry(createImportCommands({
      planner,
      coordinator: dependencies.coordinator,
      read_input: async () => success(await reviewedImportInput(dependencies)),
    })),
    current_directory: dependencies.root,
  });
  if (execution.exit_code !== 0) throw new Error(execution.stderr || execution.stdout);
  const receipt = dependencies.receipts.at(-1);
  if (receipt === undefined) throw new Error("import receipt missing");
  const paths = (await git(dependencies.root, [
    "show", "--pretty=format:", "--name-only", receipt.commit_revision,
  ])).split(/\r?\n/u).filter((value) => value.length > 0);
  const originalArchivePath = reviewed.metadata.original_archive_paths[0];
  const auditPath = Object.keys(receipt.audit_artifact_hashes)[0];
  if (originalArchivePath === undefined || auditPath === undefined) {
    throw new Error("import atomic effects are incomplete");
  }
  return {
    exit_code: execution.exit_code,
    plan_calls: planCalls,
    finalize_calls: dependencies.receipts.length - before,
    used_cli_lease_argument: arguments_.some((value) => value.includes("lease")),
    subsystem_has_direct_writer: "apply" in planner || "write" in planner,
    commit_paths: paths,
    original_archive_path: originalArchivePath,
    report_path: reviewed.metadata.import_report_path,
    audit_path: auditPath,
  };
}
