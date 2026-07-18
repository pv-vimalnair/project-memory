import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type {
  FeatureEvidence,
  NormalizedFeature,
  NormalizedFeatureMap,
} from "./contracts/selection.js";
import type { FeatureScalar } from "./contracts/core.js";
import type { FeatureObservation } from "./types.js";

const FEATURE_ID = /^[a-z][a-z0-9-]*(?:[.][a-z][a-z0-9-]*)+$/;
const EVIDENCE_ID = /^EVD-[0-9A-HJKMNP-TV-Z]{26}$/;
const SOURCE_KINDS = new Set([
  "brief",
  "path",
  "record",
  "profile",
  "classifier",
]);

interface FeatureAccumulator {
  readonly id: string;
  readonly value_type: FeatureObservation["valueType"];
  readonly value: FeatureScalar | string[];
  readonly evidence: Map<string, FeatureEvidence>;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalValue(
  observation: FeatureObservation,
): RuntimeResult<FeatureScalar | string[]> {
  const { value, valueType } = observation;
  if (valueType === "string" && typeof value === "string") {
    return success(value);
  }
  if (valueType === "number" && typeof value === "number" && Number.isFinite(value)) {
    return success(Object.is(value, -0) ? 0 : value);
  }
  if (valueType === "boolean" && typeof value === "boolean") {
    return success(value);
  }
  if (
    valueType === "string-set" &&
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  ) {
    return success([...new Set(value)].sort(compareUtf8));
  }
  return failure(
    "selection.feature_type_mismatch",
    `feature ${observation.id} does not match declared type ${valueType}`,
    observation.id,
    [observation.evidenceId],
  );
}

function featureEvidence(
  observation: FeatureObservation,
): RuntimeResult<FeatureEvidence> {
  if (
    !EVIDENCE_ID.test(observation.evidenceId) ||
    observation.sourceRef.length === 0 ||
    (observation.sourceKind !== undefined &&
      !SOURCE_KINDS.has(observation.sourceKind)) ||
    (observation.extractorId !== undefined && observation.extractorId.length === 0) ||
    (observation.extractorVersion !== undefined &&
      observation.extractorVersion.length === 0)
  ) {
    return failure(
      "selection.observation_invalid",
      `feature ${observation.id} has invalid evidence provenance`,
      observation.id,
      [observation.evidenceId],
    );
  }
  return success({
    evidence_id: observation.evidenceId,
    source_kind: observation.sourceKind ?? "brief",
    source_ref: observation.sourceRef,
    source_text: observation.sourceText ?? null,
    extractor_id: observation.extractorId ?? "project-memory.observation",
    extractor_version: observation.extractorVersion ?? "1.0.0",
  });
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeFeatureMap(
  observations: readonly FeatureObservation[],
): RuntimeResult<NormalizedFeatureMap> {
  const accumulators = new Map<string, FeatureAccumulator>();
  const ordered = [...observations].sort((left, right) => {
    const byId = compareUtf8(left.id, right.id);
    return byId === 0
      ? compareUtf8(left.evidenceId, right.evidenceId)
      : byId;
  });
  for (const observation of ordered) {
    if (!FEATURE_ID.test(observation.id)) {
      return failure(
        "selection.feature_id_invalid",
        `invalid feature ID ${observation.id}`,
        observation.id,
      );
    }
    const value = canonicalValue(observation);
    if (!value.ok) return value;
    const evidence = featureEvidence(observation);
    if (!evidence.ok) return evidence;
    const existing = accumulators.get(observation.id);
    if (existing === undefined) {
      accumulators.set(observation.id, {
        id: observation.id,
        value_type: observation.valueType,
        value: value.value,
        evidence: new Map([[evidence.value.evidence_id, evidence.value]]),
      });
      continue;
    }
    if (
      existing.value_type !== observation.valueType ||
      !sameJsonValue(existing.value, value.value)
    ) {
      return failure(
        "selection.feature_conflict",
        `feature ${observation.id} has conflicting typed values`,
        observation.id,
        [observation.evidenceId],
      );
    }
    const priorEvidence = existing.evidence.get(evidence.value.evidence_id);
    if (
      priorEvidence !== undefined &&
      !sameJsonValue(priorEvidence, evidence.value)
    ) {
      return failure(
        "selection.evidence_conflict",
        `evidence ${evidence.value.evidence_id} has conflicting provenance`,
        observation.id,
        [evidence.value.evidence_id],
      );
    }
    existing.evidence.set(evidence.value.evidence_id, evidence.value);
  }
  const features: Record<string, NormalizedFeature> = {};
  for (const id of [...accumulators.keys()].sort(compareUtf8)) {
    const feature = accumulators.get(id);
    if (feature === undefined) continue;
    features[id] = {
      id: feature.id,
      value_type: feature.value_type,
      value: feature.value,
      evidence: [...feature.evidence.values()].sort((left, right) =>
        compareUtf8(left.evidence_id, right.evidence_id)
      ),
    };
  }
  return success({ schema_version: "1.0.0", features });
}
