import semver from "semver";

import {
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { validateWithSchema } from "../schema/validate.js";
import { compareUtf8 } from "./catalog-selection-model.js";
import {
  semanticProfileFingerprint,
  semanticProfileJson,
  semanticSetOnlyAdds,
} from "./semantic-profile-value.js";
import { validateProfileDiffIdentities } from "./validate-profile-diff-identities.js";
import {
  ResolvedProfileSchema,
  type ResolvedProfile,
  type RootRelationshipSourceData,
} from "./contracts/index.js";

export type ProfileImpact = "patch" | "minor" | "major";
export type ApprovalKind =
  | "catalog-maintainer"
  | "directional"
  | "relationship"
  | "migration";
export type ProfileChangeCategory =
  | "root"
  | "blueprint"
  | "catalog"
  | "overlay"
  | "component"
  | "domain"
  | "adapter"
  | "rule"
  | "gate"
  | "template"
  | "relationship";
export type ProfileChangeOperation =
  | "added"
  | "removed"
  | "content-changed"
  | "updated"
  | "replaced"
  | "authority-changed";

export interface ProfileChange {
  readonly category: ProfileChangeCategory;
  readonly path: string;
  readonly operation: ProfileChangeOperation;
  readonly impact: ProfileImpact;
  readonly migration_required: boolean;
  readonly before_fingerprint: string | null;
  readonly after_fingerprint: string | null;
  readonly summary: string;
}

export interface ProfileEvolutionDiff {
  readonly impact: ProfileImpact;
  readonly changes: readonly ProfileChange[];
  readonly required_approval_kinds: readonly ApprovalKind[];
  readonly migration_required: boolean;
  readonly writes: readonly [];
}

interface Classification {
  readonly impact: ProfileImpact;
  readonly migration: boolean;
  readonly operation: ProfileChangeOperation;
}

const IMPACT_RANK: Readonly<Record<ProfileImpact, number>> = {
  patch: 0,
  minor: 1,
  major: 2,
};
const APPROVAL_ORDER: readonly ApprovalKind[] = [
  "catalog-maintainer",
  "directional",
  "relationship",
  "migration",
];

function change(
  category: ProfileChangeCategory,
  path: string,
  classification: Classification,
  before: unknown,
  after: unknown,
): ProfileChange {
  return {
    category,
    path,
    operation: classification.operation,
    impact: classification.impact,
    migration_required: classification.migration,
    before_fingerprint: before === null ? null : semanticProfileFingerprint(before),
    after_fingerprint: after === null ? null : semanticProfileFingerprint(after),
    summary: `${category} ${classification.operation} at ${path}`,
  };
}

function maxImpact(values: readonly ProfileImpact[]): ProfileImpact {
  return values.reduce<ProfileImpact>(
    (current, value) =>
      IMPACT_RANK[value] > IMPACT_RANK[current] ? value : current,
    "patch",
  );
}

function versionImpact(before: string, after: string): Classification {
  if (before === after) {
    return { impact: "patch", migration: false, operation: "content-changed" };
  }
  if (!semver.gt(after, before)) {
    return { impact: "major", migration: true, operation: "replaced" };
  }
  const difference = semver.diff(before, after);
  if (difference === "major" || difference === "premajor") {
    return { impact: "major", migration: true, operation: "replaced" };
  }
  if (difference === "minor" || difference === "preminor") {
    return { impact: "minor", migration: false, operation: "updated" };
  }
  return { impact: "patch", migration: false, operation: "content-changed" };
}

function withoutKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
}

function lockedClassification(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  versionKey: string,
  hashKey: string,
  pathKey: string,
): Classification {
  if (semanticProfileJson(before) === semanticProfileJson(after)) {
    return { impact: "patch", migration: false, operation: "content-changed" };
  }
  const beforeWithoutHash = withoutKeys(before, [hashKey]);
  const afterWithoutHash = withoutKeys(after, [hashKey]);
  if (semanticProfileJson(beforeWithoutHash) === semanticProfileJson(afterWithoutHash)) {
    return { impact: "patch", migration: false, operation: "content-changed" };
  }
  const beforeVersion = before[versionKey];
  const afterVersion = after[versionKey];
  const sameExceptVersionAndHash =
    semanticProfileJson(withoutKeys(before, [versionKey, hashKey])) ===
    semanticProfileJson(withoutKeys(after, [versionKey, hashKey]));
  if (
    sameExceptVersionAndHash &&
    typeof beforeVersion === "string" &&
    typeof afterVersion === "string"
  ) {
    return versionImpact(beforeVersion, afterVersion);
  }
  if (before[pathKey] !== after[pathKey]) {
    return { impact: "major", migration: true, operation: "replaced" };
  }
  return { impact: "major", migration: true, operation: "replaced" };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value as Readonly<Record<string, unknown>>;
}

function collectionDiff<T>(
  before: readonly T[],
  after: readonly T[],
  category: ProfileChangeCategory,
  keyOf: (value: T) => string,
  classify: (before: T, after: T) => Classification,
  addition: Classification = {
    impact: "minor",
    migration: false,
    operation: "added",
  },
): ProfileChange[] {
  const beforeIndex = new Map(before.map((value) => [keyOf(value), value]));
  const afterIndex = new Map(after.map((value) => [keyOf(value), value]));
  const keys = [...new Set([...beforeIndex.keys(), ...afterIndex.keys()])].sort(
    compareUtf8,
  );
  const changes: ProfileChange[] = [];
  for (const key of keys) {
    const previous = beforeIndex.get(key);
    const next = afterIndex.get(key);
    const path = `/${category}s/${key}`;
    if (previous === undefined && next !== undefined) {
      changes.push(change(category, path, addition, null, next));
    } else if (previous !== undefined && next === undefined) {
      changes.push(
        change(
          category,
          path,
          { impact: "major", migration: true, operation: "removed" },
          previous,
          null,
        ),
      );
    } else if (
      previous !== undefined &&
      next !== undefined &&
      semanticProfileJson(previous) !== semanticProfileJson(next)
    ) {
      changes.push(change(category, path, classify(previous, next), previous, next));
    }
  }
  return changes;
}

function instanceClassification<T extends {
  readonly instance_id: string;
  readonly definition_id: string;
  readonly definition_version: string;
  readonly definition_target_path: string;
  readonly definition_target_sha256: string;
  readonly slug: string;
  readonly required_domains?: readonly string[];
  readonly required_components?: readonly string[];
  readonly rules: readonly { readonly kind: string; readonly id: string }[];
  readonly gates: readonly { readonly id: string }[];
}>(before: T, after: T): Classification {
  const locked = lockedClassification(
    record(before),
    record(after),
    "definition_version",
    "definition_target_sha256",
    "definition_target_path",
  );
  if (locked.impact !== "major") return locked;
  if (
    before.instance_id !== after.instance_id ||
    before.definition_id !== after.definition_id ||
    before.definition_version !== after.definition_version ||
    before.definition_target_path !== after.definition_target_path ||
    before.slug !== after.slug
  ) {
    return locked;
  }
  const sets: readonly (readonly [readonly string[], readonly string[]])[] = [
    [
      before.required_domains ?? before.required_components ?? [],
      after.required_domains ?? after.required_components ?? [],
    ],
    [
      before.rules.map((value) => `${value.kind}:${value.id}`),
      after.rules.map((value) => `${value.kind}:${value.id}`),
    ],
    [
      before.gates.map((value) => value.id),
      after.gates.map((value) => value.id),
    ],
  ];
  const additive = sets.every(([previous, next]) => semanticSetOnlyAdds(previous, next));
  if (!additive) return locked;
  const sameAssignments = sets.every(([previous, next]) =>
    semanticSetOnlyAdds(next, previous),
  );
  return sameAssignments
    ? { impact: "patch", migration: false, operation: "content-changed" }
    : { impact: "minor", migration: false, operation: "updated" };
}

function gateClassification(
  before: ResolvedProfile["gates"][number],
  after: ResolvedProfile["gates"][number],
): Classification {
  const additive = [
    [before.source_definition_ids, after.source_definition_ids],
    [before.commands, after.commands],
    [before.required_evidence, after.required_evidence],
  ].every(([previous, next]) =>
    semanticSetOnlyAdds(previous ?? [], next ?? []),
  );
  return additive
    ? { impact: "minor", migration: false, operation: "updated" }
    : { impact: "major", migration: true, operation: "replaced" };
}

function relationshipOwner(value: RootRelationshipSourceData): string {
  return value.kind === "portfolio-child"
    ? `${value.relationship_owner_root_id}:${value.child_truth_owner_root_id}`
    : value.owner_root_id;
}

function relationshipBoundaryFingerprint(value: RootRelationshipSourceData): string {
  if (value.kind === "shared-platform-provider") {
    return semanticProfileFingerprint([value.provider, value.consumer, value.interface_refs]);
  }
  if (value.kind === "shared-platform-consumer") {
    return semanticProfileFingerprint([
      value.consumer,
      value.provider,
      value.provider_interface_refs,
      value.usage_component_ids,
      value.migration_state,
    ]);
  }
  return semanticProfileFingerprint([
    value.portfolio,
    value.child,
    value.relationship_status,
    value.dependency_kinds,
  ]);
}

function relationshipClassification(
  before: RootRelationshipSourceData,
  after: RootRelationshipSourceData,
): Classification {
  if (before.kind !== after.kind) {
    return { impact: "major", migration: true, operation: "replaced" };
  }
  const boundaryChanged =
    relationshipBoundaryFingerprint(before) !==
    relationshipBoundaryFingerprint(after);
  if (relationshipOwner(before) !== relationshipOwner(after)) {
    return {
      impact: "major",
      migration: boundaryChanged,
      operation: "authority-changed",
    };
  }
  return {
    impact: "major",
    migration: boundaryChanged,
    operation: "replaced",
  };
}

function rootChanges(before: ResolvedProfile, after: ResolvedProfile): ProfileChange[] {
  const changes: ProfileChange[] = [];
  for (const key of [
    "id",
    "namespace",
    "kind",
    "primary_archetype",
    "lifecycle",
  ] as const) {
    if (before.root[key] !== after.root[key]) {
      changes.push(
        change(
          "root",
          `/root/${key}`,
          { impact: "major", migration: true, operation: "replaced" },
          before.root[key],
          after.root[key],
        ),
      );
    }
  }
  return changes;
}

function singleLockedDiff(
  before: ResolvedProfile["blueprint"],
  after: ResolvedProfile["blueprint"],
): ProfileChange[] {
  if (semanticProfileJson(before) === semanticProfileJson(after)) return [];
  const classification = before.id === after.id
    ? lockedClassification(record(before), record(after), "version", "target_sha256", "target_path")
    : { impact: "major" as const, migration: true, operation: "replaced" as const };
  return [change("blueprint", "/blueprint", classification, before, after)];
}

function catalogDiff(before: ResolvedProfile, after: ResolvedProfile): ProfileChange[] {
  if (semanticProfileJson(before.catalog) === semanticProfileJson(after.catalog)) return [];
  const classification = versionImpact(before.catalog.release, after.catalog.release);
  return [
    change("catalog", "/catalog", classification, before.catalog, after.catalog),
  ];
}

function collectChanges(before: ResolvedProfile, after: ResolvedProfile): ProfileChange[] {
  const locked = (
    previous: unknown,
    next: unknown,
    version = "version",
    hash = "target_sha256",
    path = "target_path",
  ) => lockedClassification(record(previous), record(next), version, hash, path);
  return [
    ...rootChanges(before, after),
    ...singleLockedDiff(before.blueprint, after.blueprint),
    ...catalogDiff(before, after),
    ...collectionDiff(before.overlays, after.overlays, "overlay", (value) => value.id, locked),
    ...collectionDiff(
      before.components,
      after.components,
      "component",
      (value) => value.instance_id,
      instanceClassification,
    ),
    ...collectionDiff(
      before.domains,
      after.domains,
      "domain",
      (value) => value.instance_id,
      instanceClassification,
    ),
    ...collectionDiff(
      before.adapters,
      after.adapters,
      "adapter",
      (value) => `${value.kind}:${value.definition_id}`,
      (previous, next) =>
        locked(previous, next, "definition_version", "definition_target_sha256", "definition_target_path"),
    ),
    ...collectionDiff(
      before.rules,
      after.rules,
      "rule",
      (value) => `${value.kind}:${value.id}`,
      locked,
    ),
    ...collectionDiff(before.gates, after.gates, "gate", (value) => value.id, gateClassification),
    ...collectionDiff(before.templates, after.templates, "template", (value) => value.id, locked),
    ...collectionDiff(
      before.root_relationships,
      after.root_relationships,
      "relationship",
      (value) => value.relationship_id,
      relationshipClassification,
      { impact: "major", migration: false, operation: "added" },
    ),
  ].sort((left, right) => compareUtf8(`${left.path}:${left.operation}`, `${right.path}:${right.operation}`));
}

function approvalKinds(changes: readonly ProfileChange[]): ApprovalKind[] {
  const values = new Set<ApprovalKind>();
  if (
    changes.some(
      (item) => item.impact === "patch" && item.category !== "root" && item.category !== "relationship",
    )
  ) {
    values.add("catalog-maintainer");
  }
  if (changes.some((item) => item.impact !== "patch")) values.add("directional");
  if (changes.some((item) => item.category === "relationship")) {
    values.add("relationship");
  }
  if (changes.some((item) => item.migration_required)) values.add("migration");
  return APPROVAL_ORDER.filter((value) => values.has(value));
}

export function diffProfiles(
  before: ResolvedProfile,
  after: ResolvedProfile,
): RuntimeResult<ProfileEvolutionDiff> {
  const validBefore = validateWithSchema<ResolvedProfile>(
    ResolvedProfileSchema.$id,
    before,
  );
  if (!validBefore.ok) return validBefore;
  const validAfter = validateWithSchema<ResolvedProfile>(
    ResolvedProfileSchema.$id,
    after,
  );
  if (!validAfter.ok) return validAfter;
  const uniqueBefore = validateProfileDiffIdentities(validBefore.value);
  if (!uniqueBefore.ok) return uniqueBefore;
  const uniqueAfter = validateProfileDiffIdentities(validAfter.value);
  if (!uniqueAfter.ok) return uniqueAfter;
  const changes = collectChanges(validBefore.value, validAfter.value);
  return success({
    impact: maxImpact(changes.map((item) => item.impact)),
    changes,
    required_approval_kinds: approvalKinds(changes),
    migration_required: changes.some((item) => item.migration_required),
    writes: [],
  });
}
