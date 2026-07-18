import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import { validateWithSchema } from "../schema/validate.js";
import { compareUtf8 } from "./catalog-selection-model.js";
import { semanticProfileFingerprint } from "./semantic-profile-value.js";
import {
  ResolvedProfileSchema,
  type ResolvedProfile,
} from "./contracts/index.js";

export type ProfileObservationKind =
  | "component"
  | "domain"
  | "adapter"
  | "overlay"
  | "rule"
  | "root-relationship"
  | "repository-capability";

export interface ObservedProfileEvidence {
  readonly observation_id: string;
  readonly kind: ProfileObservationKind;
  readonly observed_id: string;
  readonly summary: string;
  readonly evidence_refs: readonly string[];
}

export interface ProfileDriftProposal {
  readonly proposal_id: string;
  readonly observation_id: string;
  readonly kind: ProfileObservationKind;
  readonly observed_id: string;
  readonly status: "observed_unclassified";
  readonly summary: string;
  readonly evidence_refs: readonly string[];
  readonly observation_fingerprint: string;
  readonly required_action: "review-accepted-profile";
}

export interface AcceptedProfileObservation {
  readonly observation_id: string;
  readonly kind: ProfileObservationKind;
  readonly observed_id: string;
  readonly status: "accepted_match";
  readonly evidence_refs: readonly string[];
  readonly observation_fingerprint: string;
}

export interface ProfileDriftReport {
  readonly accepted_profile_fingerprint: string;
  readonly proposals: readonly ProfileDriftProposal[];
  readonly accepted_matches: readonly AcceptedProfileObservation[];
  readonly writes: readonly [];
}

const OBSERVATION_KINDS = new Set<ProfileObservationKind>([
  "component",
  "domain",
  "adapter",
  "overlay",
  "rule",
  "root-relationship",
  "repository-capability",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEvidenceList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(
    (reference: unknown) =>
      typeof reference === "string" && reference.trim().length > 0,
  );
}

function normalizeObservation(
  value: unknown,
): RuntimeResult<ObservedProfileEvidence> {
  if (!isRecord(value)) {
    return failure(
      "PROFILE_DRIFT_OBSERVATION_INVALID",
      "profile drift observation must be an object",
    );
  }
  const keys = Object.keys(value).sort(compareUtf8);
  const expectedKeys = [
    "evidence_refs",
    "kind",
    "observation_id",
    "observed_id",
    "summary",
  ];
  if (
    canonicalJson(keys) !== canonicalJson(expectedKeys) ||
    typeof value.observation_id !== "string" ||
    !/^observation[.][a-z0-9.-]+$/.test(value.observation_id) ||
    typeof value.kind !== "string" ||
    !OBSERVATION_KINDS.has(value.kind as ProfileObservationKind) ||
    typeof value.observed_id !== "string" ||
    value.observed_id.trim().length === 0 ||
    typeof value.summary !== "string" ||
    value.summary.trim().length === 0 ||
    !isEvidenceList(value.evidence_refs)
  ) {
    return failure(
      "PROFILE_DRIFT_OBSERVATION_INVALID",
      "profile drift observation has invalid or unknown fields",
      typeof value.observation_id === "string" ? value.observation_id : "",
    );
  }
  if (value.evidence_refs.length === 0) {
    return failure(
      "PROFILE_DRIFT_EVIDENCE_REQUIRED",
      "profile drift observations require at least one exact evidence reference",
      value.observation_id,
    );
  }
  const evidenceRefs = [...value.evidence_refs].sort(compareUtf8);
  if (new Set(evidenceRefs).size !== evidenceRefs.length) {
    return failure(
      "PROFILE_DRIFT_EVIDENCE_DUPLICATE",
      "profile drift evidence references must be unique",
      value.observation_id,
    );
  }
  return success({
    observation_id: value.observation_id,
    kind: value.kind as ProfileObservationKind,
    observed_id: value.observed_id,
    summary: value.summary,
    evidence_refs: evidenceRefs,
  });
}

function acceptedIdentities(
  profile: ResolvedProfile,
): ReadonlyMap<ProfileObservationKind, ReadonlySet<string>> {
  return new Map([
    [
      "component",
      new Set(
        profile.components.flatMap((value) => [
          value.instance_id,
          value.definition_id,
          value.slug,
        ]),
      ),
    ],
    [
      "domain",
      new Set(
        profile.domains.flatMap((value) => [
          value.instance_id,
          value.definition_id,
          value.slug,
        ]),
      ),
    ],
    ["adapter", new Set(profile.adapters.map((value) => value.definition_id))],
    ["overlay", new Set(profile.overlays.map((value) => value.id))],
    ["rule", new Set(profile.rules.map((value) => value.id))],
    [
      "root-relationship",
      new Set(profile.root_relationships.map((value) => value.relationship_id)),
    ],
    ["repository-capability", new Set<string>()],
  ] as const);
}

function observationFingerprint(value: ObservedProfileEvidence): string {
  return sha256(canonicalJson(value));
}

function proposal(value: ObservedProfileEvidence): ProfileDriftProposal {
  const observationHash = observationFingerprint(value);
  return {
    proposal_id: `drift.${observationHash.slice(0, 24)}`,
    observation_id: value.observation_id,
    kind: value.kind,
    observed_id: value.observed_id,
    status: "observed_unclassified",
    summary: value.summary,
    evidence_refs: value.evidence_refs,
    observation_fingerprint: observationHash,
    required_action: "review-accepted-profile",
  };
}

function acceptedMatch(
  value: ObservedProfileEvidence,
): AcceptedProfileObservation {
  return {
    observation_id: value.observation_id,
    kind: value.kind,
    observed_id: value.observed_id,
    status: "accepted_match",
    evidence_refs: value.evidence_refs,
    observation_fingerprint: observationFingerprint(value),
  };
}

export function inspectProfileDrift(
  acceptedProfile: ResolvedProfile,
  evidence: ObservedProfileEvidence | readonly ObservedProfileEvidence[],
): RuntimeResult<ProfileDriftReport> {
  const validProfile = validateWithSchema<ResolvedProfile>(
    ResolvedProfileSchema.$id,
    acceptedProfile,
  );
  if (!validProfile.ok) return validProfile;
  const observations = Array.isArray(evidence) ? evidence : [evidence];
  const normalized: ObservedProfileEvidence[] = [];
  const ids = new Set<string>();
  for (const candidate of observations) {
    const result = normalizeObservation(candidate);
    if (!result.ok) return result;
    if (ids.has(result.value.observation_id)) {
      return failure(
        "PROFILE_DRIFT_OBSERVATION_DUPLICATE",
        "profile drift observation identity is repeated",
        result.value.observation_id,
      );
    }
    ids.add(result.value.observation_id);
    normalized.push(result.value);
  }
  normalized.sort((left, right) =>
    compareUtf8(left.observation_id, right.observation_id),
  );
  const identities = acceptedIdentities(validProfile.value);
  const proposals: ProfileDriftProposal[] = [];
  const acceptedMatches: AcceptedProfileObservation[] = [];
  for (const observation of normalized) {
    if (identities.get(observation.kind)?.has(observation.observed_id) === true) {
      acceptedMatches.push(acceptedMatch(observation));
    } else {
      proposals.push(proposal(observation));
    }
  }
  return success({
    accepted_profile_fingerprint: semanticProfileFingerprint(validProfile.value),
    proposals,
    accepted_matches: acceptedMatches,
    writes: [],
  });
}
