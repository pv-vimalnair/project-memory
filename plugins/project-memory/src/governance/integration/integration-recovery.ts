import {
  canonicalJson,
  failure,
  success,
  validateWithSchema,
  type RuntimeResult,
} from "../../index.js";
import type {
  HubFinalizationReceipt,
  PreparedSatellite,
} from "../contracts/index.js";
import {
  createHubFinalizer,
  type FinalizeHubInput,
  type HubFinalizationArtifact,
  type HubFinalizerDependencies,
} from "./hub-finalizer.js";
import {
  createSatellitePreparer,
  type PrepareSatelliteInput,
  type SatellitePreparerDependencies,
  type VerifySatelliteInput,
} from "./satellite-preparer.js";

export type {
  FinalizeHubInput,
  PrepareSatelliteInput,
  VerifySatelliteInput,
};

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

export interface RecoveryInput {
  readonly hub: URL;
  readonly target_ref?: string;
  readonly prepared: readonly PreparedSatellite[];
}

export interface RecoveryReport {
  readonly state: "prepared_unfinalized" | "finalized" | "partial_reference";
  readonly hub_revision: string;
  readonly requested_manifest_hashes: readonly string[];
  readonly referenced_manifest_hashes: readonly string[];
  readonly missing_manifest_hashes: readonly string[];
  readonly artifact_paths: readonly string[];
}

export interface MultiRepoFinalizer {
  prepareSatellite(input: PrepareSatelliteInput): Promise<RuntimeResult<PreparedSatellite>>;
  finalizeHub(input: FinalizeHubInput): Promise<RuntimeResult<HubFinalizationReceipt>>;
  inspectRecovery(input: RecoveryInput): Promise<RuntimeResult<RecoveryReport>>;
}

export interface MultiRepoFinalizerDependencies
  extends SatellitePreparerDependencies,
    Omit<HubFinalizerDependencies, "satellites"> {}

function parseArtifact(bytes: Uint8Array): HubFinalizationArtifact | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value = JSON.parse(text) as Record<string, unknown>;
    if (
      canonicalJson(value) !== text ||
      value.schema_version !== "1.0.0" ||
      value.evidence_type !== "multi-repository-hub-finalization" ||
      !Array.isArray(value.satellite_manifest_hashes)
    ) return null;
    return value as unknown as HubFinalizationArtifact;
  } catch {
    return null;
  }
}

async function inspect(
  dependencies: MultiRepoFinalizerDependencies,
  input: RecoveryInput,
): Promise<RuntimeResult<RecoveryReport>> {
  if (input.hub.protocol !== "file:" || input.prepared.length === 0) {
    return failure("recovery.input_invalid", "recovery requires a hub and prepared manifests");
  }
  for (const prepared of input.prepared) {
    const valid = validateWithSchema<PreparedSatellite>(
      "project-memory/v1/prepared-satellite",
      prepared,
    );
    if (!valid.ok) return valid;
  }
  const targetRef = input.target_ref ?? "refs/heads/main";
  let revision: string;
  try {
    revision = await dependencies.git.resolveRef(input.hub, targetRef);
  } catch (error: unknown) {
    return failure("recovery.hub_ref_invalid", String(error), targetRef);
  }
  const prefix = "docs/project-memory/governance/integration/hub";
  const paths = await dependencies.git.listTree(input.hub, revision, prefix);
  const artifacts: { readonly path: string; readonly value: HubFinalizationArtifact }[] = [];
  for (const relativePath of [...paths].sort(compareUtf8)) {
    if (!relativePath.endsWith(".json")) continue;
    const bytes = await dependencies.git.readBlob(input.hub, revision, relativePath);
    if (bytes === null) continue;
    const artifact = parseArtifact(bytes);
    if (artifact !== null) artifacts.push({ path: relativePath, value: artifact });
  }
  const requested = unique(input.prepared.map((value) => value.manifest_hash));
  const referencedSet = new Set(artifacts.flatMap((entry) =>
    entry.value.satellite_manifest_hashes));
  const referenced = requested.filter((hash) => referencedSet.has(hash));
  const missing = requested.filter((hash) => !referencedSet.has(hash));
  const state = missing.length === 0
    ? "finalized"
    : referenced.length === 0
      ? "prepared_unfinalized"
      : "partial_reference";
  return success({
    state,
    hub_revision: revision,
    requested_manifest_hashes: requested,
    referenced_manifest_hashes: referenced,
    missing_manifest_hashes: missing,
    artifact_paths: artifacts.map((entry) => entry.path).sort(compareUtf8),
  });
}

export function createMultiRepoFinalizer(
  dependencies: MultiRepoFinalizerDependencies,
): MultiRepoFinalizer {
  const satellites = createSatellitePreparer(dependencies);
  const hub = createHubFinalizer({ ...dependencies, satellites });
  return {
    prepareSatellite: (input) => satellites.prepareSatellite(input),
    finalizeHub: (input) => hub.finalizeHub(input),
    inspectRecovery: (input) => inspect(dependencies, input),
  };
}
