import { lstat } from "node:fs/promises";

import {
  CONFIG_RELATIVE_PATH,
  readToolConfigDocument,
  validateToolConfigDocument,
} from "../cli/config.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { NodeCommandRunner } from "../core/command-runner.js";
import {
  currentGitBranchRef,
  GitCliClient,
} from "../core/git-cli-client.js";
import { sha256 } from "../core/hash.js";
import { resolveInside } from "../core/path-safety.js";
import { IntegrationGitCliClient } from "../governance/integration/integration-git-client.js";
import { createCanonicalSnapshotBuilder } from "../governance/snapshot/canonical-snapshot-builder.js";
import { createRevisionTreeReader } from "../governance/snapshot/revision-tree-reader.js";
import { PROJECT_CONTEXT_PATH } from "../materialize/render-startup-context.js";
import { createProjectMemoryMigrationRegistry } from "../migrations/v1/project-memory-v1-1.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../schema/project-registrars.js";
import {
  getSchemaValidator,
  registerProjectSchemas,
} from "../schema/registry.js";
import { REPOSITORY_CONTRACT_VERSION } from "../version.js";
import type {
  RepositoryUpgradePlan,
  RepositoryUpgradeReplay,
} from "./contracts.js";
import { buildRepositoryUpgradePlan } from "./plan-repository-upgrade.js";

const PROJECT_SELECTION_SCHEMA_ID = "project-memory/v1/project-selection";
const ONE_HOUR_MS = 60 * 60 * 1000;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printableVersion(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return value === null ? "null" : "invalid";
}

async function readCommittedRegularFile(
  root: URL,
  revision: string,
  relativePath: string,
  git: IntegrationGitCliClient,
): Promise<RuntimeResult<Uint8Array>> {
  const resolved = await resolveInside(root, relativePath);
  if (!resolved.ok) return resolved;
  try {
    const stat = await lstat(resolved.value);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure(
        "UPGRADE_INPUT_UNSAFE",
        "repository upgrade inputs must be regular files",
        relativePath,
      );
    }
    const committed = await git.readBlob(root, revision, relativePath);
    return committed === null
      ? failure(
          "UPGRADE_INPUT_READ_FAILED",
          "repository upgrade input is absent from the expected Git revision",
          relativePath,
        )
      : success(new Uint8Array(committed));
  } catch (error: unknown) {
    return failure(
      "UPGRADE_INPUT_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
}

function ensureProjectSchemas(): RuntimeResult<true> {
  if (getSchemaValidator(PROJECT_SELECTION_SCHEMA_ID) !== undefined) {
    return success(true);
  }
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  return registered.ok ? success(true, registered.warnings) : registered;
}

function freshReplay(now: () => Date): RuntimeResult<RepositoryUpgradeReplay> {
  try {
    const created = now();
    if (!Number.isFinite(created.getTime())) {
      return failure("UPGRADE_CLOCK_INVALID", "repository upgrade clock must be valid");
    }
    return success({
      created_at: created.toISOString(),
      expires_at: new Date(created.getTime() + ONE_HOUR_MS).toISOString(),
    });
  } catch {
    return failure("UPGRADE_CLOCK_FAILED", "repository upgrade clock failed");
  }
}

export interface NodeRepositoryUpgradePlanner {
  plan(
    root: URL,
    replay?: RepositoryUpgradeReplay,
  ): Promise<RuntimeResult<RepositoryUpgradePlan | null>>;
}

export function createNodeRepositoryUpgradePlanner(
  now: () => Date = () => new Date(),
): NodeRepositoryUpgradePlanner {
  const runner = new NodeCommandRunner();
  const git = new GitCliClient(runner);
  const revisionGit = new IntegrationGitCliClient(runner);
  const snapshots = createCanonicalSnapshotBuilder(createRevisionTreeReader(runner));

  return {
    async plan(root, replay) {
      const document = await readToolConfigDocument(root);
      if (!document.ok) return document;
      const rawVersion = isRecord(document.value)
        ? document.value.repository_contract_version
        : undefined;
      if (rawVersion === REPOSITORY_CONTRACT_VERSION) {
        return success(null, document.warnings);
      }
      if (rawVersion !== undefined) {
        return failure(
          "REPOSITORY_CONTRACT_UNSUPPORTED",
          `repository contract ${printableVersion(rawVersion)} is not supported by this plugin`,
          CONFIG_RELATIVE_PATH,
          [REPOSITORY_CONTRACT_VERSION],
        );
      }

      const config = validateToolConfigDocument(document.value);
      if (!config.ok) return config;
      let status;
      try {
        status = await git.statusPorcelain(root);
      } catch (error: unknown) {
        return failure(
          "GIT_STATUS_FAILED",
          error instanceof Error ? error.message : String(error),
          root.href,
        );
      }
      if (status.length > 0) {
        return failure(
          "GIT_DIRTY_ROOT",
          "repository upgrade requires a clean local checkout; no files were changed",
          root.href,
        );
      }

      const targetRef = await currentGitBranchRef(root, runner);
      if (!targetRef.ok) return targetRef;
      let head: string;
      try {
        head = await git.head(root);
      } catch (error: unknown) {
        return failure(
          "GIT_HEAD_FAILED",
          error instanceof Error ? error.message : String(error),
          root.href,
        );
      }
      if (!/^[0-9a-f]{40}$/u.test(head)) {
        return failure(
          "GIT_HEAD_INVALID",
          "repository upgrade requires an exact Git commit HEAD",
          root.href,
        );
      }

      const schemas = ensureProjectSchemas();
      if (!schemas.ok) return schemas;
      const snapshot = await snapshots.build(root, {
        kind: "commit",
        object_id: head,
      });
      if (!snapshot.ok) return snapshot;

      const configBytes = await readCommittedRegularFile(
        root,
        head,
        CONFIG_RELATIVE_PATH,
        revisionGit,
      );
      if (!configBytes.ok) return configBytes;
      const doorwayBytes = await readCommittedRegularFile(
        root,
        head,
        PROJECT_CONTEXT_PATH,
        revisionGit,
      );
      if (!doorwayBytes.ok) return doorwayBytes;
      const stableReplay = replay === undefined ? freshReplay(now) : success(replay);
      if (!stableReplay.ok) return stableReplay;

      const registry = createProjectMemoryMigrationRegistry();
      if (!registry.ok) return registry;
      const planned = buildRepositoryUpgradePlan({
        snapshot: snapshot.value,
        target_ref: targetRef.value,
        expected_head: head,
        config_bytes: configBytes.value,
        config_sha256: sha256(configBytes.value),
        doorway_bytes: doorwayBytes.value,
        doorway_sha256: sha256(doorwayBytes.value),
        created_at: stableReplay.value.created_at,
        expires_at: stableReplay.value.expires_at,
      }, registry.value);
      return planned.ok
        ? success(planned.value, [
            ...document.warnings,
            ...config.warnings,
            ...targetRef.warnings,
            ...schemas.warnings,
            ...snapshot.warnings,
            ...configBytes.warnings,
            ...doorwayBytes.warnings,
            ...stableReplay.warnings,
            ...registry.warnings,
            ...planned.warnings,
          ])
        : planned;
    },
  };
}
