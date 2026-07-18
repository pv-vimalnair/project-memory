import {
  failure,
  success,
  validateWithSchema,
  type RuntimeResult,
} from "../../src/index.js";
import type { Approval, TaskPacket } from "../../src/planning/types.js";
import type {
  PrimaryArchetypeValue,
  RootKindValue,
} from "../../src/contracts/vocabulary.js";

type Scalar = string | number | boolean;
type ComponentType =
  | "surface"
  | "service"
  | "data"
  | "platform"
  | "workflow"
  | "content"
  | "shared-system";

export interface RawCompileRoot {
  readonly id: string;
  readonly profile_lock_hash: string;
  readonly catalog_release: string;
  readonly catalog_hash: string;
  readonly kind: RootKindValue;
  readonly primary_archetype: PrimaryArchetypeValue;
  readonly profile_id: string;
  readonly overlay_ids: readonly string[];
}

export interface RawCompileComponent {
  readonly instance_id: string;
  readonly definition_id: string | null;
  readonly type: ComponentType;
  readonly tags: readonly string[];
  readonly dependency_rules: readonly string[];
  readonly paths: readonly string[];
}

export interface RawOutcomeCondition {
  readonly feature: string;
  readonly expected: Scalar;
}

export interface RawCompileOutcome {
  readonly id: string;
  readonly statement: string;
  readonly mode:
    | "assess"
    | "plan"
    | "design"
    | "implement"
    | "change"
    | "validate"
    | "release"
    | "operate"
    | "retire";
  readonly family: string;
  readonly object: string;
  readonly acceptance_criteria: readonly string[];
  readonly authority_class: "automatic-by-rule" | "integrator" | "Pitaji";
  readonly release_fate: "none" | "planned" | "production";
  readonly can_complete_independently: boolean;
  readonly depends_on: readonly string[];
  readonly paths: readonly string[];
  readonly exclusions: readonly string[];
  readonly enabled_when_any?: readonly RawOutcomeCondition[];
}

export interface RawCompileScenario {
  readonly schema_version: "1.0.0";
  readonly scenario_id: string;
  readonly root: RawCompileRoot;
  readonly initiative_id: string | null;
  readonly repository: string;
  readonly original_base_revision: string;
  readonly integrator_id: string;
  readonly worker_id: string;
  readonly artifact_types: readonly string[];
  readonly artifact_refs: readonly string[];
  readonly feature_flags: Readonly<Record<string, Scalar>>;
  readonly components: readonly RawCompileComponent[];
  readonly outcomes: readonly RawCompileOutcome[];
  readonly approvals: readonly Approval[];
  readonly external_authorizations: Readonly<
    Record<string, TaskPacket["authorization"]["external_action"]>
  >;
  readonly accepted_decision_ids: readonly string[];
  readonly proposed_decision_ids: readonly string[];
  readonly claim: {
    readonly ttl_ms: number;
    readonly heartbeat_interval: string;
    readonly renewal_policy: string;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function stringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0) &&
    new Set(value).size === value.length
  );
}

function scalar(value: unknown): value is Scalar {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function validRoot(value: unknown): value is RawCompileRoot {
  const item = record(value);
  if (
    item === null ||
    !exactKeys(item, [
      "id",
      "profile_lock_hash",
      "catalog_release",
      "catalog_hash",
      "kind",
      "primary_archetype",
      "profile_id",
      "overlay_ids",
    ])
  ) {
    return false;
  }
  return (
    typeof item.id === "string" &&
    typeof item.profile_lock_hash === "string" &&
    typeof item.catalog_release === "string" &&
    typeof item.catalog_hash === "string" &&
    typeof item.kind === "string" &&
    typeof item.primary_archetype === "string" &&
    typeof item.profile_id === "string" &&
    stringList(item.overlay_ids)
  );
}

function validComponent(value: unknown): value is RawCompileComponent {
  const item = record(value);
  if (
    item === null ||
    !exactKeys(item, [
      "instance_id",
      "definition_id",
      "type",
      "tags",
      "dependency_rules",
      "paths",
    ])
  ) {
    return false;
  }
  const types = new Set<ComponentType>([
    "surface",
    "service",
    "data",
    "platform",
    "workflow",
    "content",
    "shared-system",
  ]);
  return (
    typeof item.instance_id === "string" &&
    (item.definition_id === null || typeof item.definition_id === "string") &&
    typeof item.type === "string" &&
    types.has(item.type as ComponentType) &&
    stringList(item.tags) &&
    stringList(item.dependency_rules) &&
    stringList(item.paths)
  );
}

function validCondition(value: unknown): value is RawOutcomeCondition {
  const item = record(value);
  return (
    item !== null &&
    exactKeys(item, ["feature", "expected"]) &&
    typeof item.feature === "string" &&
    scalar(item.expected)
  );
}

function validOutcome(value: unknown): value is RawCompileOutcome {
  const item = record(value);
  if (
    item === null ||
    !exactKeys(
      item,
      [
        "id",
        "statement",
        "mode",
        "family",
        "object",
        "acceptance_criteria",
        "authority_class",
        "release_fate",
        "can_complete_independently",
        "depends_on",
        "paths",
        "exclusions",
      ],
      ["enabled_when_any"],
    )
  ) {
    return false;
  }
  const modes = new Set([
    "assess",
    "plan",
    "design",
    "implement",
    "change",
    "validate",
    "release",
    "operate",
    "retire",
  ]);
  const conditions = item.enabled_when_any;
  return (
    typeof item.id === "string" &&
    typeof item.statement === "string" &&
    typeof item.mode === "string" &&
    modes.has(item.mode) &&
    typeof item.family === "string" &&
    typeof item.object === "string" &&
    stringList(item.acceptance_criteria) &&
    (item.authority_class === "automatic-by-rule" ||
      item.authority_class === "integrator" ||
      item.authority_class === "Pitaji") &&
    (item.release_fate === "none" ||
      item.release_fate === "planned" ||
      item.release_fate === "production") &&
    typeof item.can_complete_independently === "boolean" &&
    stringList(item.depends_on) &&
    stringList(item.paths) &&
    stringList(item.exclusions) &&
    (conditions === undefined ||
      (Array.isArray(conditions) && conditions.every(validCondition)))
  );
}

function validExternal(value: unknown): boolean {
  const item = record(value);
  return (
    item !== null &&
    exactKeys(item, [
      "allowed",
      "approval_ids",
      "target",
      "environment",
      "scope",
      "timing",
    ]) &&
    typeof item.allowed === "boolean" &&
    stringList(item.approval_ids) &&
    (item.target === null || typeof item.target === "string") &&
    (item.environment === null || typeof item.environment === "string") &&
    stringList(item.scope) &&
    (item.timing === null || typeof item.timing === "string")
  );
}

function validClaim(value: unknown): boolean {
  const item = record(value);
  return (
    item !== null &&
    exactKeys(item, ["ttl_ms", "heartbeat_interval", "renewal_policy"]) &&
    Number.isSafeInteger(item.ttl_ms) &&
    Number(item.ttl_ms) > 0 &&
    typeof item.heartbeat_interval === "string" &&
    typeof item.renewal_policy === "string"
  );
}

export function parseCompileScenario(
  value: unknown,
  source: string,
): RuntimeResult<RawCompileScenario> {
  const item = record(value);
  const required = [
    "schema_version",
    "scenario_id",
    "root",
    "initiative_id",
    "repository",
    "original_base_revision",
    "integrator_id",
    "worker_id",
    "artifact_types",
    "artifact_refs",
    "feature_flags",
    "components",
    "outcomes",
    "approvals",
    "external_authorizations",
    "accepted_decision_ids",
    "proposed_decision_ids",
    "claim",
  ];
  if (item === null || !exactKeys(item, required)) {
    return failure(
      "compile.fixture_shape_invalid",
      "compile fixture requires exact top-level keys",
      source,
    );
  }
  const flags = record(item.feature_flags);
  const external = record(item.external_authorizations);
  if (
    item.schema_version !== "1.0.0" ||
    typeof item.scenario_id !== "string" ||
    !validRoot(item.root) ||
    (item.initiative_id !== null && typeof item.initiative_id !== "string") ||
    typeof item.repository !== "string" ||
    typeof item.original_base_revision !== "string" ||
    typeof item.integrator_id !== "string" ||
    typeof item.worker_id !== "string" ||
    !stringList(item.artifact_types) ||
    !stringList(item.artifact_refs) ||
    flags === null ||
    !Object.values(flags).every(scalar) ||
    !Array.isArray(item.components) ||
    !item.components.every(validComponent) ||
    !Array.isArray(item.outcomes) ||
    item.outcomes.length === 0 ||
    !item.outcomes.every(validOutcome) ||
    !Array.isArray(item.approvals) ||
    external === null ||
    !Object.values(external).every(validExternal) ||
    !stringList(item.accepted_decision_ids) ||
    !stringList(item.proposed_decision_ids) ||
    !validClaim(item.claim)
  ) {
    return failure(
      "compile.fixture_value_invalid",
      "compile fixture contains an invalid nested value",
      source,
    );
  }
  for (const approval of item.approvals) {
    const validated = validateWithSchema<Approval>(
      "project-memory/v1/approval",
      approval,
    );
    if (!validated.ok) {
      return failure(
        "compile.fixture_approval_invalid",
        "compile fixture approval failed registered schema validation",
        source,
        validated.issues.map((issue) => `${issue.code}:${issue.path}`),
      );
    }
  }
  return success(item as unknown as RawCompileScenario);
}
