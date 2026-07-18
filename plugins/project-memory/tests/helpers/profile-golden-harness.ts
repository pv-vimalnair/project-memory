import {
  cp,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import { buildCatalogRelease } from "../../src/catalog/manifest/build-catalog-bundle.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../../src/contracts/runtime-result.js";
import { FixedClock } from "../../src/core/clock.js";
import { sha256 } from "../../src/core/hash.js";
import { resolveInside } from "../../src/core/path-safety.js";
import {
  createProfileArtifactRenderer,
  type TargetByteSnapshot,
} from "../../src/materialize/render-adapters.js";
import { acceptedProfileSourceRenderer } from "../../src/materialize/render-project-source.js";
import type {
  ProfileCatalogResolver,
  ProfileTargetReader,
} from "../../src/profile/build-profile-mutation-plan.js";
import {
  CatalogSelectionResolver,
  type ResolvedCatalogSelection,
} from "../../src/profile/catalog-selection-resolver.js";
import type { ProfileCanonicalMutationPlan } from "../../src/profile/contracts/index.js";
import {
  createProfileMaterializer,
  type StagingCapability,
  type StagingCapabilityVerifier,
  type StagingGitInspector,
  type StagingWorktreeDescriptor,
} from "../../src/profile/materialize-to-isolated-staging.js";
import { createProfileCompiler } from "../../src/profile/profile-compiler.js";
import { createProfileVerifier } from "../../src/profile/verify-profile.js";
import {
  buildGoldenInput,
  goldenInstanceId,
  type BuiltGoldenInput,
  type GoldenCaseSpec,
} from "./profile-golden-fixture.js";

export interface GoldenCatalogRelease {
  readonly package_root: URL;
  readonly release_root: URL;
  readonly release_hash: string;
}

export interface GoldenPlannedCase extends BuiltGoldenInput {
  readonly plan: ProfileCanonicalMutationPlan;
  readonly warnings: readonly string[];
}

export interface GoldenMaterialization {
  readonly canonical_ref_before: string;
  readonly canonical_ref_after: string;
  readonly external_reads: readonly [];
}

class NodeTargetReader implements ProfileTargetReader {
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
          "PROFILE_TARGET_UNSAFE",
          "golden planning accepts regular target files only",
          relativePath,
        );
      }
      return success(new Uint8Array(await readFile(resolved.value)));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return success(null);
      }
      return failure(
        "PROFILE_TARGET_READ_FAILED",
        error instanceof Error ? error.message : String(error),
        relativePath,
      );
    }
  }
}

class FixedCatalogResolver implements ProfileCatalogResolver {
  constructor(private readonly value: ResolvedCatalogSelection) {}

  resolve(): Promise<RuntimeResult<ResolvedCatalogSelection>> {
    return Promise.resolve(success(this.value));
  }
}

class ImmutableGitInspector implements StagingGitInspector {
  readonly commit_calls: string[] = [];
  readonly ref_update_calls: string[] = [];

  constructor(
    readonly canonical_ref: string,
    private readonly descriptor: StagingWorktreeDescriptor,
  ) {}

  inspectWorktree(): Promise<RuntimeResult<StagingWorktreeDescriptor>> {
    return Promise.resolve(success(this.descriptor));
  }
}

class AcceptCapability implements StagingCapabilityVerifier {
  verify(): Promise<RuntimeResult<true>> {
    return Promise.resolve(success(true));
  }
}

const temporaryRoots: string[] = [];
const PACKAGE_ROOT = new URL("../../", import.meta.url);

async function temporaryDirectory(prefix: string): Promise<URL> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return pathToFileURL(`${directory}${path.sep}`);
}

export async function cleanupGoldenRoots(): Promise<void> {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
}

export async function buildGoldenCatalogRelease(): Promise<GoldenCatalogRelease> {
  const packageRoot = await temporaryDirectory("project-memory-golden-release-");
  await cp(
    fileURLToPath(new URL("catalog/", PACKAGE_ROOT)),
    fileURLToPath(new URL("catalog/", packageRoot)),
    { recursive: true },
  );
  await cp(
    fileURLToPath(new URL("schemas/", PACKAGE_ROOT)),
    fileURLToPath(new URL("schemas/", packageRoot)),
    { recursive: true },
  );
  const built = await buildCatalogRelease({
    sourceRoot: new URL("catalog/project-memory/v1/", packageRoot),
    outputRoot: packageRoot,
    release: "1.0.0",
  });
  if (!built.ok) throw new Error(JSON.stringify(built.issues));
  return {
    package_root: packageRoot,
    release_root: built.value.artifacts.root,
    release_hash: built.value.lock.release_hash,
  };
}

export async function createGoldenRepositoryCopy(
  spec: GoldenCaseSpec,
): Promise<URL> {
  const root = await temporaryDirectory(`project-memory-golden-${spec.name}-`);
  const fixtureRoot = new URL(
    `../fixtures/profile-golden/${spec.name}/repository/`,
    import.meta.url,
  );
  await cp(fileURLToPath(fixtureRoot), fileURLToPath(root), { recursive: true });
  return root;
}

async function adapterSnapshot(root: URL): Promise<TargetByteSnapshot> {
  const reader = new NodeTargetReader();
  const files = new Map<string, Uint8Array>();
  for (const relativePath of ["AGENTS.md", "CLAUDE.md"]) {
    const current = await reader.read(root, relativePath);
    if (!current.ok) throw new Error(JSON.stringify(current.issues));
    if (current.value !== null) files.set(relativePath, current.value);
  }
  return { files };
}

export async function resolveGoldenCatalog(
  input: BuiltGoldenInput,
): Promise<ResolvedCatalogSelection> {
  const resolved = await new CatalogSelectionResolver().resolve(
    input.selection,
    input.input.catalog_release_root,
  );
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
  return resolved.value;
}

export async function planGoldenCase(
  spec: GoldenCaseSpec,
  targetRoot: URL,
  release: GoldenCatalogRelease,
  resolved?: ResolvedCatalogSelection,
): Promise<GoldenPlannedCase> {
  const built = buildGoldenInput(
    spec,
    targetRoot,
    release.release_root,
    release.release_hash,
  );
  const catalog = resolved ?? (await resolveGoldenCatalog(built));
  const compiler = createProfileCompiler({
    catalog: new FixedCatalogResolver(catalog),
    source_renderer: acceptedProfileSourceRenderer,
    artifact_renderer: createProfileArtifactRenderer(
      await adapterSnapshot(targetRoot),
    ),
    target_reader: new NodeTargetReader(),
  });
  const planned = await compiler.plan(built.input);
  if (!planned.ok) throw new Error(JSON.stringify(planned.issues));
  return {
    ...built,
    plan: planned.value,
    warnings: planned.warnings.map((warning) => warning.code),
  };
}

function exactSnapshotByte(pathValue: string): boolean {
  return !pathValue.startsWith("docs/project-memory/catalog/selected/");
}

export function summarizeGoldenPlan(plan: ProfileCanonicalMutationPlan) {
  const exactBytes = plan.writes
    .filter((write) => exactSnapshotByte(write.relative_path))
    .map((write) => ({
      relative_path: write.relative_path,
      bytes_base64: Buffer.from(write.bytes).toString("base64"),
    }));
  const exactPayload = {
    schema_version: "1.0.0",
    plan_hash: plan.plan_hash,
    exact_bytes: exactBytes,
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(exactPayload));
  return {
    manifest: {
      schema_version: "1.0.0",
      plan_id: plan.plan_id,
      mutation_kind: plan.mutation_kind,
      root_id: plan.root_id,
      target_ref: plan.target_ref,
      expected_head: plan.expected_head,
      plan_hash: plan.plan_hash,
      approval_ids: plan.approval_ids,
      selected_catalog_lock: {
        relative_path: "docs/project-memory/catalog.lock.json",
        lock_hash: plan.metadata.selected_catalog_lock.lock_hash,
      },
      profile_lock: {
        relative_path: "docs/project-memory/profile.lock.yaml",
        lock_hash: plan.metadata.profile_lock.lock_hash,
      },
      writes: plan.writes.map((write) => ({
        relative_path: write.relative_path,
        mode: write.mode,
        expected_existing_sha256: write.expected_existing_sha256,
        final_sha256: sha256(write.bytes),
        byte_length: write.bytes.byteLength,
      })),
      exact_payload: {
        relative_path: "plan.bytes.snapshot.json.gz",
        uncompressed_sha256: sha256(payloadBytes),
        uncompressed_byte_length: payloadBytes.byteLength,
        entries: plan.writes
          .filter((write) => exactSnapshotByte(write.relative_path))
          .map((write) => ({
            relative_path: write.relative_path,
            final_sha256: sha256(write.bytes),
            byte_length: write.bytes.byteLength,
          })),
      },
    },
    exact_payload: exactPayload,
  };
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value);
}

function jsonArrayLines(
  values: readonly unknown[],
  indentation: string,
): string[] {
  return values.map(
    (value, index) =>
      `${indentation}${jsonValue(value)}${index + 1 === values.length ? "" : ","}`,
  );
}

function renderGoldenManifest(
  manifest: ReturnType<typeof summarizeGoldenPlan>["manifest"],
): string {
  return [
    "{",
    `  "schema_version": ${jsonValue(manifest.schema_version)},`,
    `  "plan_id": ${jsonValue(manifest.plan_id)},`,
    `  "mutation_kind": ${jsonValue(manifest.mutation_kind)},`,
    `  "root_id": ${jsonValue(manifest.root_id)},`,
    `  "target_ref": ${jsonValue(manifest.target_ref)},`,
    `  "expected_head": ${jsonValue(manifest.expected_head)},`,
    `  "plan_hash": ${jsonValue(manifest.plan_hash)},`,
    `  "approval_ids": ${jsonValue(manifest.approval_ids)},`,
    `  "selected_catalog_lock": ${jsonValue(manifest.selected_catalog_lock)},`,
    `  "profile_lock": ${jsonValue(manifest.profile_lock)},`,
    '  "writes": [',
    ...jsonArrayLines(manifest.writes, "    "),
    "  ],",
    '  "exact_payload": {',
    `    "relative_path": ${jsonValue(manifest.exact_payload.relative_path)},`,
    `    "uncompressed_sha256": ${jsonValue(manifest.exact_payload.uncompressed_sha256)},`,
    `    "uncompressed_byte_length": ${jsonValue(manifest.exact_payload.uncompressed_byte_length)},`,
    '    "entries": [',
    ...jsonArrayLines(manifest.exact_payload.entries, "      "),
    "    ]",
    "  }",
    "}",
    "",
  ].join("\n");
}

export async function loadOrUpdateGoldenSnapshot(
  name: string,
  current: ReturnType<typeof summarizeGoldenPlan>,
): Promise<ReturnType<typeof summarizeGoldenPlan>> {
  const fixtureRoot = new URL(`../fixtures/profile-golden/${name}/`, import.meta.url);
  const manifestUrl = new URL("plan.snapshot.json", fixtureRoot);
  const payloadUrl = new URL("plan.bytes.snapshot.json.gz", fixtureRoot);
  if (process.env.UPDATE_PROFILE_GOLDENS === "1") {
    await writeFile(
      manifestUrl,
      renderGoldenManifest(current.manifest),
    );
    await writeFile(
      payloadUrl,
      gzipSync(Buffer.from(JSON.stringify(current.exact_payload), "utf8"), {
        level: 9,
      }),
    );
  }
  const manifest = JSON.parse(
    await readFile(manifestUrl, "utf8"),
  ) as ReturnType<typeof summarizeGoldenPlan>["manifest"];
  const exactPayload = JSON.parse(
    gunzipSync(await readFile(payloadUrl)).toString("utf8"),
  ) as ReturnType<typeof summarizeGoldenPlan>["exact_payload"];
  return { manifest, exact_payload: exactPayload };
}
export async function materializeGoldenCase(
  planned: GoldenPlannedCase,
): Promise<GoldenMaterialization> {
  const descriptor: StagingWorktreeDescriptor = {
    root: planned.input.target_root.href,
    head: planned.plan.expected_head,
    linked_worktree: true,
    detached: true,
    coordinator_created: true,
    clean: true,
    dirty_paths: [],
  };
  const git = new ImmutableGitInspector(planned.plan.expected_head, descriptor);
  const capability: StagingCapability = {
    capability_id: goldenInstanceId("CAP", planned.spec.case_number, 0),
    authority: "integration-coordinator",
    plan_id: planned.plan.plan_id,
    plan_hash: planned.plan.plan_hash,
    staging_root: planned.input.target_root.href,
    expires_at: "2026-07-15T05:30:00.000Z",
    proof: "golden-fixture-capability-proof",
  };
  const before = git.canonical_ref;
  const result = await createProfileMaterializer({
    git,
    capabilities: new AcceptCapability(),
    verifier: createProfileVerifier(),
    clock: new FixedClock(new Date("2026-07-15T04:30:00.000Z")),
  }).materializeToIsolatedStaging({
    staging_root: planned.input.target_root,
    expected_staging_head: planned.plan.expected_head,
    capability,
    plan: planned.plan,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  if (git.commit_calls.length > 0 || git.ref_update_calls.length > 0) {
    throw new Error("profile materializer obtained canonical mutation authority");
  }
  return {
    canonical_ref_before: before,
    canonical_ref_after: git.canonical_ref,
    external_reads: result.value.verification.external_reads,
  };
}
