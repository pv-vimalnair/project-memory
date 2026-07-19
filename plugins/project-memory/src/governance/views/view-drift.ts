import { lstat, readFile } from "node:fs/promises";

import {
  decodeStrictUtf8,
  failure,
  normalizeGitTextBytes,
  parseJsonDocument,
  resolveInside,
  success,
  type RuntimeResult,
} from "../../index.js";

import type { CanonicalSnapshot } from "../snapshot/snapshot-contracts.js";
import type { GeneratedViewPlan } from "./generate-views.js";

export interface ViewSnapshotProvider {
  current(root: URL): Promise<RuntimeResult<CanonicalSnapshot>>;
}

export interface ViewTargetReader {
  read(root: URL, relativePath: string): Promise<RuntimeResult<Uint8Array | null>>;
}

export interface ViewDriftReport {
  readonly valid: boolean;
  readonly source_revision: string;
  readonly source_set_hash: string;
  readonly generated_at: string | null;
  readonly checked_paths: readonly string[];
  readonly drifted_paths: readonly string[];
  readonly missing_paths: readonly string[];
  readonly metadata_invalid_paths: readonly string[];
}

export type ViewPlanAt = (
  snapshot: CanonicalSnapshot,
  generatedAt: string,
) => RuntimeResult<GeneratedViewPlan>;

const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function generatedAt(relativePath: string, bytes: Uint8Array): string | null {
  const decoded = decodeStrictUtf8(bytes, relativePath);
  if (!decoded.ok) return null;
  if (relativePath.endsWith(".json")) {
    const parsed = parseJsonDocument(decoded.value, relativePath);
    if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
      return null;
    }
    const metadata = (parsed.value as Record<string, unknown>).metadata;
    if (typeof metadata !== "object" || metadata === null) return null;
    const value = (metadata as Record<string, unknown>).generated_at;
    return typeof value === "string" && UTC_TIMESTAMP.test(value) ? value : null;
  }
  const match = /^<!-- generated_at: ([^\r\n]+) -->$/m.exec(decoded.value);
  const value = match?.[1] ?? null;
  return value !== null && UTC_TIMESTAMP.test(value) ? value : null;
}

export class FilesystemViewTargetReader implements ViewTargetReader {
  async read(
    root: URL,
    relativePath: string,
  ): Promise<RuntimeResult<Uint8Array | null>> {
    const resolved = await resolveInside(root, relativePath);
    if (!resolved.ok) return resolved;
    try {
      const stat = await lstat(resolved.value);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        return failure(
          "view.target_unsafe",
          "generated views must be regular files",
          relativePath,
        );
      }
      return success(normalizeGitTextBytes(
        new Uint8Array(await readFile(resolved.value)),
      ));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return success(null);
      return failure(
        "view.target_read_failed",
        error instanceof Error ? error.message : String(error),
        relativePath,
      );
    }
  }
}

export async function verifyViewDrift(
  root: URL,
  paths: readonly string[],
  snapshots: ViewSnapshotProvider,
  targets: ViewTargetReader,
  planAt: ViewPlanAt,
): Promise<RuntimeResult<ViewDriftReport>> {
  const snapshot = await snapshots.current(root);
  if (!snapshot.ok) return snapshot;
  const existing = new Map<string, Uint8Array | null>();
  const timestamps = new Map<string, string | null>();
  for (const relativePath of paths) {
    const bytes = await targets.read(root, relativePath);
    if (!bytes.ok) return bytes;
    existing.set(relativePath, bytes.value);
    timestamps.set(
      relativePath,
      bytes.value === null ? null : generatedAt(relativePath, bytes.value),
    );
  }
  const commonTimestamp = paths
    .map((relativePath) => timestamps.get(relativePath) ?? null)
    .find((value): value is string => value !== null) ?? null;
  const missing = paths.filter((relativePath) => existing.get(relativePath) === null);
  const invalidMetadata = paths.filter(
    (relativePath) =>
      existing.get(relativePath) !== null && timestamps.get(relativePath) === null,
  );
  if (commonTimestamp === null) {
    return success({
      valid: false,
      source_revision: snapshot.value.source_revision,
      source_set_hash: "",
      generated_at: null,
      checked_paths: [...paths],
      drifted_paths: [...paths],
      missing_paths: missing,
      metadata_invalid_paths: invalidMetadata,
    });
  }
  const planned = planAt(snapshot.value, commonTimestamp);
  if (!planned.ok) return planned;
  const expected = new Map(
    planned.value.writes.map((write) => [write.relative_path, write.bytes]),
  );
  const drifted = paths.filter((relativePath) => {
    const actual = existing.get(relativePath) ?? null;
    const wanted = expected.get(relativePath);
    return actual === null || wanted === undefined || !byteEqual(actual, wanted);
  });
  return success({
    valid: drifted.length === 0,
    source_revision: snapshot.value.source_revision,
    source_set_hash: planned.value.metadata.source_set_hash,
    generated_at: commonTimestamp,
    checked_paths: [...paths],
    drifted_paths: drifted,
    missing_paths: missing,
    metadata_invalid_paths: invalidMetadata,
  });
}
