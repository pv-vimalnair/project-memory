import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { failure, success, type RuntimeResult } from "../contracts/runtime-result.js";
import { runCommand } from "../core/command-runner.js";
import { NodeCommandRunner } from "../core/command-runner.js";
import { decodeStrictUtf8 } from "../core/document-io.js";
import { sha256 } from "../core/hash.js";
import { canonicalJson } from "../core/canonical-json.js";
import {
  classifyLegacyDocument,
  findSensitivity,
} from "./classifiers.js";
import type {
  LegacyScan,
  LegacyScanner,
  LegacySourceArtifact,
} from "./contracts.js";

export interface LegacyScannerDependencies {
  readonly git_revision?: (root: URL, relativePath: string) => Promise<string | null>;
}

const ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".yaml", ".yml", ".json"]);
const MAX_FILE_BYTES = 1_048_576;

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function inside(root: string, candidate: string): boolean {
  const normalizedRoot = `${path.resolve(root)}${path.sep}`.toLowerCase();
  return path.resolve(candidate).toLowerCase().startsWith(normalizedRoot);
}

async function defaultGitRevision(root: URL, relativePath: string): Promise<string | null> {
  const result = await runCommand({
    executable: "git",
    args: ["log", "-n", "1", "--format=%H", "--", relativePath],
    cwd: root,
    timeout_ms: 10_000,
    env_allowlist: { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", PATH: process.env.PATH ?? "" },
    max_output_bytes: 65_536,
  }, new NodeCommandRunner());
  if (!result.ok || result.value.exit_code !== 0) return null;
  const revision = result.value.stdout.trim();
  return /^[0-9a-f]{40}$/.test(revision) ? revision : null;
}

export function createLegacyScanner(
  dependencies: LegacyScannerDependencies = {},
): LegacyScanner {
  const gitRevision = dependencies.git_revision ?? defaultGitRevision;
  return {
    async scan(root): Promise<RuntimeResult<LegacyScan>> {
      if (root.protocol !== "file:") {
        return failure("LEGACY_ROOT_INVALID", "legacy scan root must be a file URL");
      }
      const rootPath = await realpath(fileURLToPath(root));
      const files: string[] = [];
      async function visit(directory: string): Promise<RuntimeResult<true>> {
        const entries = await readdir(directory, { withFileTypes: true });
        entries.sort((left, right) => compareUtf8(left.name, right.name));
        for (const entry of entries) {
          if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "build") continue;
          const absolute = path.join(directory, entry.name);
          const stat = await lstat(absolute);
          if (stat.isSymbolicLink()) {
            const target = await realpath(absolute);
            if (!inside(rootPath, target)) {
              return failure("LEGACY_SYMLINK_ESCAPE", "legacy scan symlink escapes the root", absolute);
            }
            continue;
          }
          if (stat.isDirectory()) {
            const nested = await visit(absolute);
            if (!nested.ok) return nested;
          } else if (stat.isFile() && ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            if (stat.size > MAX_FILE_BYTES) {
              return failure("LEGACY_FILE_TOO_LARGE", "legacy source exceeds the scan byte bound", absolute);
            }
            files.push(absolute);
          }
        }
        return success(true);
      }
      try {
        const visited = await visit(rootPath);
        if (!visited.ok) return visited;
        const artifacts: LegacySourceArtifact[] = [];
        for (const absolute of files) {
          const relativePath = path.relative(rootPath, absolute).split(path.sep).join("/");
          const bytes = new Uint8Array(await readFile(absolute));
          const decoded = decodeStrictUtf8(bytes, relativePath);
          if (!decoded.ok) {
            return failure("LEGACY_ENCODING_INVALID", "legacy source must be strict UTF-8", relativePath);
          }
          artifacts.push({
            relative_path: relativePath,
            sha256: sha256(bytes),
            byte_length: bytes.byteLength,
            git_revision: await gitRevision(root, relativePath),
            detected_roles: classifyLegacyDocument(relativePath),
            sensitivity_findings: findSensitivity(decoded.value),
          });
        }
        artifacts.sort((left, right) => compareUtf8(left.relative_path, right.relative_path));
        const body = { schema_version: "1.0.0" as const, root: root.href, artifacts };
        return success({ ...body, scan_hash: sha256(canonicalJson(body)) });
      } catch (error: unknown) {
        return failure("LEGACY_SCAN_FAILED", error instanceof Error ? error.message : String(error));
      }
    },
  };
}
