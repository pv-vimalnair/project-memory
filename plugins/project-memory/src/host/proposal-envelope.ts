import {
  initPlanHash,
  type InitPlan,
} from "../cli/init/build-init-plan.js";
import { canonicalMutationPlanHash } from "../contracts/canonical-mutation-plan.js";
import { canonicalJson } from "../core/canonical-json.js";
import { sha256 } from "../core/hash.js";
import type {
  GuidedLegacyImportInput,
  PendingLegacyReview,
  ReviewedImportPlan,
} from "../import/contracts.js";
import type { RepositoryUpgradePlan } from "../upgrades/contracts.js";
import {
  LEGACY_REPOSITORY_CONTRACT_VERSION,
  REPOSITORY_CONTRACT_VERSION,
} from "../version.js";

const REVIEW_TTL_MILLISECONDS = 60 * 60 * 1000;
const REVISION_PATTERN = /^[0-9a-f]{40}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

export type StoredProposalEnvelope =
  | {
      readonly kind: "bootstrap";
      readonly root: URL;
      readonly plan: InitPlan;
    }
  | {
      readonly kind: "legacy_review";
      readonly root: URL;
      readonly pending: PendingLegacyReview;
      readonly expected_head: string;
      readonly profile_lock_hash: string;
    }
  | {
      readonly kind: "legacy_import";
      readonly root: URL;
      readonly input: GuidedLegacyImportInput;
      readonly plan: ReviewedImportPlan;
    }
  | {
      readonly kind: "upgrade";
      readonly root: URL;
      readonly adapter_id: string;
      readonly plan: RepositoryUpgradePlan;
    };

export type StoredProposalKind = StoredProposalEnvelope["kind"];
export type StoredBootstrapProposal = Extract<
  StoredProposalEnvelope,
  { readonly kind: "bootstrap" }
>;

export interface StoredProposalEntry {
  readonly value: StoredProposalEnvelope;
  readonly expires_at: string;
}

interface PersistedProposalEnvelopeV2 {
  readonly schema_version: "2.0.0";
  readonly expires_at: string;
  readonly value: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): boolean {
  return Array.isArray(value);
}

function bootstrapValue(root: URL, plan: InitPlan): StoredBootstrapProposal {
  return { kind: "bootstrap", root, plan };
}

export function normalizeProposalIssue(
  valueOrRoot: StoredProposalEnvelope | URL,
  plan: InitPlan | undefined,
): StoredProposalEnvelope | null {
  if (valueOrRoot instanceof URL) {
    return plan === undefined ? null : bootstrapValue(valueOrRoot, plan);
  }
  return plan === undefined ? valueOrRoot : null;
}

export function cloneProposalEnvelope(
  value: StoredProposalEnvelope,
): StoredProposalEnvelope {
  const root = new URL(value.root.href);
  if (value.kind === "bootstrap") {
    return { kind: value.kind, root, plan: structuredClone(value.plan) };
  }
  if (value.kind === "legacy_review") {
    return {
      kind: value.kind,
      root,
      pending: structuredClone(value.pending),
      expected_head: value.expected_head,
      profile_lock_hash: value.profile_lock_hash,
    };
  }
  if (value.kind === "upgrade") {
    return {
      kind: value.kind,
      root,
      adapter_id: value.adapter_id,
      plan: structuredClone(value.plan),
    };
  }
  return {
    kind: value.kind,
    root,
    input: structuredClone(value.input),
    plan: structuredClone(value.plan),
  };
}

export function parsedProposalTimestamp(value: string): number | null {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function bootstrapExact(plan: InitPlan): boolean {
  try {
    return initPlanHash(plan) === plan.plan_hash;
  } catch {
    return false;
  }
}

function reviewExact(value: Extract<
  StoredProposalEnvelope,
  { readonly kind: "legacy_review" }
>): boolean {
  try {
    const pending = value.pending;
    const scan = pending.scan;
    const proposal = pending.proposal;
    const { scan_hash: boundScanHash, ...scanBody } = scan;
    const { proposal_hash: boundProposalHash, ...proposalBody } = proposal;
    if (
      value.root.protocol !== "file:" ||
      !REVISION_PATTERN.test(value.expected_head) ||
      !HASH_PATTERN.test(value.profile_lock_hash) ||
      !HASH_PATTERN.test(boundScanHash) ||
      !HASH_PATTERN.test(boundProposalHash) ||
      pending.root_id !== proposal.root_id ||
      proposal.root_id.length === 0 ||
      proposal.scan_hash !== scan.scan_hash ||
      sha256(canonicalJson(scanBody)) !== scan.scan_hash ||
      sha256(canonicalJson(proposalBody)) !== proposal.proposal_hash ||
      !isArray(scan.artifacts) ||
      !isArray(proposal.mappings) ||
      scan.artifacts.length !== proposal.mappings.length
    ) return false;
    const artifacts = new Set(scan.artifacts.map((artifact) =>
      `${artifact.relative_path}\0${artifact.sha256}`
    ));
    return proposal.mappings.every((mapping) =>
      HASH_PATTERN.test(mapping.source_sha256) &&
      artifacts.has(`${mapping.source_path}\0${mapping.source_sha256}`)
    );
  } catch {
    return false;
  }
}

function importExact(value: Extract<
  StoredProposalEnvelope,
  { readonly kind: "legacy_import" }
>): boolean {
  try {
    const { plan_hash: boundPlanHash, ...planBody } = value.plan;
    const inputHash = sha256(canonicalJson(value.input));
    return value.root.protocol === "file:" &&
      HASH_PATTERN.test(boundPlanHash) &&
      value.plan.mutation_kind === "import" &&
      canonicalMutationPlanHash(planBody) === value.plan.plan_hash &&
      value.plan.root_id === value.input.root_id &&
      value.plan.target_ref === value.input.target_ref &&
      value.plan.expected_head === value.input.expected_head &&
      value.plan.profile_lock_hash === value.input.profile_lock_hash &&
      value.plan.created_by === value.input.created_by &&
      value.plan.created_at === value.input.created_at &&
      value.plan.expires_at === value.input.expires_at &&
      value.plan.metadata.proposal_hash === value.input.proposal_hash &&
      value.plan.metadata.guided_input_hash === inputHash &&
      REVISION_PATTERN.test(value.input.expected_head) &&
      HASH_PATTERN.test(value.input.profile_lock_hash) &&
      HASH_PATTERN.test(value.input.proposal_hash) &&
      parsedProposalTimestamp(value.input.expires_at) !== null;
  } catch {
    return false;
  }
}

function upgradeExact(value: Extract<
  StoredProposalEnvelope,
  { readonly kind: "upgrade" }
>): boolean {
  try {
    const { plan_hash: boundPlanHash, ...body } = value.plan;
    const metadata = value.plan.metadata as unknown as Readonly<Record<string, unknown>>;
    return value.root.protocol === "file:" &&
      /^adapter[.][a-z][a-z0-9-]*$/u.test(value.adapter_id) &&
      HASH_PATTERN.test(boundPlanHash) &&
      value.plan.mutation_kind === "migration" &&
      metadata.governance_kind === "repository_upgrade" &&
      metadata.migration_id === "project-memory-v1-1" &&
      metadata.from_version === LEGACY_REPOSITORY_CONTRACT_VERSION &&
      metadata.to_version === REPOSITORY_CONTRACT_VERSION &&
      metadata.authority_impact === "none" &&
      canonicalMutationPlanHash(body) === boundPlanHash;
  } catch {
    return false;
  }
}

function validEnvelope(value: StoredProposalEnvelope): boolean {
  if (value.root.protocol !== "file:") return false;
  if (value.kind === "bootstrap") return bootstrapExact(value.plan);
  if (value.kind === "legacy_review") return reviewExact(value);
  if (value.kind === "upgrade") return upgradeExact(value);
  return importExact(value);
}

export function proposalIssuedFields(value: StoredProposalEnvelope) {
  if (value.kind === "bootstrap") {
    return {
      plan_hash: value.plan.plan_hash,
      expected_head: value.plan.expected_head,
    };
  }
  if (value.kind === "legacy_review") {
    return {
      plan_hash: value.pending.proposal.proposal_hash,
      expected_head: value.expected_head,
    };
  }
  if (value.kind === "upgrade") {
    return {
      plan_hash: value.plan.plan_hash,
      expected_head: value.plan.expected_head,
    };
  }
  return {
    plan_hash: value.plan.plan_hash,
    expected_head: value.plan.expected_head,
  };
}

export function proposalExpiryForIssue(
  value: StoredProposalEnvelope,
  now: Date,
): string | null {
  if (value.kind === "bootstrap") {
    return parsedProposalTimestamp(value.plan.replay.expires_at) === null
      ? null
      : value.plan.replay.expires_at;
  }
  if (value.kind === "legacy_import") {
    return parsedProposalTimestamp(value.input.expires_at) === null
      ? null
      : value.input.expires_at;
  }
  if (value.kind === "upgrade") {
    return parsedProposalTimestamp(value.plan.expires_at) === null
      ? null
      : value.plan.expires_at;
  }
  const milliseconds = now.getTime();
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds + REVIEW_TTL_MILLISECONDS).toISOString()
    : null;
}

export function proposalEntryValid(
  entry: StoredProposalEntry,
  now: Date,
): boolean {
  const expiresAt = parsedProposalTimestamp(entry.expires_at);
  if (expiresAt === null || !validEnvelope(entry.value)) return false;
  if (
    entry.value.kind === "bootstrap" &&
    entry.expires_at !== entry.value.plan.replay.expires_at
  ) return false;
  if (
    entry.value.kind === "legacy_import" &&
    entry.expires_at !== entry.value.input.expires_at
  ) return false;
  if (
    entry.value.kind === "upgrade" &&
    entry.expires_at !== entry.value.plan.expires_at
  ) return false;
  return entry.value.kind !== "legacy_review" ||
    expiresAt <= now.getTime() + REVIEW_TTL_MILLISECONDS;
}

function persistedValue(value: StoredProposalEnvelope): Readonly<Record<string, unknown>> {
  if (value.kind === "bootstrap") {
    return { kind: value.kind, root: value.root.href, plan: value.plan };
  }
  if (value.kind === "legacy_review") {
    return {
      kind: value.kind,
      root: value.root.href,
      pending: value.pending,
      expected_head: value.expected_head,
      profile_lock_hash: value.profile_lock_hash,
    };
  }
  if (value.kind === "upgrade") {
    return {
      kind: value.kind,
      root: value.root.href,
      adapter_id: value.adapter_id,
      plan: value.plan,
    };
  }
  return {
    kind: value.kind,
    root: value.root.href,
    input: value.input,
    plan: value.plan,
  };
}

export function persistedProposalEntry(
  entry: StoredProposalEntry,
): PersistedProposalEnvelopeV2 {
  return {
    schema_version: "2.0.0",
    expires_at: entry.expires_at,
    value: persistedValue(entry.value),
  };
}

function decodeRoot(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const root = new URL(value);
    return root.protocol === "file:" ? root : null;
  } catch {
    return null;
  }
}

export function decodedProposalEntry(
  value: unknown,
  now: Date,
): StoredProposalEntry | null {
  if (!isRecord(value)) return null;

  let entry: StoredProposalEntry | null = null;
  if (value.schema_version === "1.0.0") {
    const root = decodeRoot(value.root);
    if (root !== null && isRecord(value.plan)) {
      const plan = value.plan as unknown as InitPlan;
      entry = {
        value: bootstrapValue(root, plan),
        expires_at: isRecord(plan.replay) && typeof plan.replay.expires_at === "string"
          ? plan.replay.expires_at
          : "",
      };
    }
  } else if (
    value.schema_version === "2.0.0" &&
    typeof value.expires_at === "string" &&
    isRecord(value.value)
  ) {
    const payload = value.value;
    const root = decodeRoot(payload.root);
    if (root === null) return null;
    if (payload.kind === "bootstrap" && isRecord(payload.plan)) {
      entry = {
        value: bootstrapValue(root, payload.plan as unknown as InitPlan),
        expires_at: value.expires_at,
      };
    } else if (
      payload.kind === "legacy_review" &&
      isRecord(payload.pending) &&
      typeof payload.expected_head === "string" &&
      typeof payload.profile_lock_hash === "string"
    ) {
      entry = {
        value: {
          kind: payload.kind,
          root,
          pending: payload.pending as unknown as PendingLegacyReview,
          expected_head: payload.expected_head,
          profile_lock_hash: payload.profile_lock_hash,
        },
        expires_at: value.expires_at,
      };
    } else if (
      payload.kind === "upgrade" &&
      typeof payload.adapter_id === "string" &&
      isRecord(payload.plan)
    ) {
      entry = {
        value: {
          kind: payload.kind,
          root,
          adapter_id: payload.adapter_id,
          plan: payload.plan as unknown as RepositoryUpgradePlan,
        },
        expires_at: value.expires_at,
      };
    } else if (
      payload.kind === "legacy_import" &&
      isRecord(payload.input) &&
      isRecord(payload.plan)
    ) {
      entry = {
        value: {
          kind: payload.kind,
          root,
          input: payload.input as unknown as GuidedLegacyImportInput,
          plan: payload.plan as unknown as ReviewedImportPlan,
        },
        expires_at: value.expires_at,
      };
    }
  }
  return entry !== null && proposalEntryValid(entry, now) ? entry : null;
}
