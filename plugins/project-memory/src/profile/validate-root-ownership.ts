import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { compareUtf8 } from "./catalog-selection-model.js";
import {
  RootRelationshipSourceDataSchema,
  type RootAddress,
  type RootRelationshipSourceData,
} from "./contracts/index.js";
import { validateWithSchema } from "../schema/validate.js";

const NAMESPACE_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const ROOT_ID_PATTERN = /^ROOT-[0-9A-HJKMNP-TV-Z]{26}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CHILD_TRUTH_KEYS = new Set([
  "child_name",
  "child_mission",
  "child_prd",
  "child_scope",
  "child_decisions",
  "child_components",
  "child_records",
  "name",
  "mission",
  "prd",
  "scope",
  "decisions",
  "components",
  "records",
]);
const CONSUMER_INTERFACE_TRUTH_KEYS = new Set([
  "interface_refs",
  "interface_contract",
  "interface_version",
  "interface_deprecation",
]);

export interface ValidatedRootRelationships {
  readonly local_root: RootAddress;
  readonly records: RootRelationshipSourceData[];
  readonly approval_refs: string[];
}

interface RelationshipEdge {
  readonly from: RootAddress;
  readonly to: RootAddress;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addressKey(address: RootAddress): string {
  return `${address.namespace}\u0000${address.root_id}`;
}

function sameDurableAddress(left: RootAddress, right: RootAddress): boolean {
  return addressKey(left) === addressKey(right);
}

function sameExactAddress(left: RootAddress, right: RootAddress): boolean {
  return (
    sameDurableAddress(left, right) &&
    left.canonical_repository === right.canonical_repository &&
    left.profile_lock_hash === right.profile_lock_hash
  );
}

function validRootAddress(address: RootAddress): boolean {
  return (
    NAMESPACE_PATTERN.test(address.namespace) &&
    address.namespace.length >= 3 &&
    address.namespace.length <= 160 &&
    ROOT_ID_PATTERN.test(address.root_id) &&
    address.canonical_repository.trim().length > 0 &&
    !/^(?:[A-Za-z]:[\\/]|\/|file:)/.test(address.canonical_repository) &&
    SHA256_PATTERN.test(address.profile_lock_hash)
  );
}

function forbiddenCopiedTruth(
  value: unknown,
  index: number,
): RuntimeResult<true> {
  if (!isRecord(value)) return success(true);
  const kind = value.kind;
  const forbidden =
    kind === "portfolio-child"
      ? CHILD_TRUTH_KEYS
      : kind === "shared-platform-consumer"
        ? CONSUMER_INTERFACE_TRUTH_KEYS
        : null;
  if (forbidden === null) return success(true);
  const key = Object.keys(value).find((candidate) => forbidden.has(candidate));
  if (key === undefined) return success(true);
  return kind === "portfolio-child"
    ? failure(
        "ROOT_RELATIONSHIP_CHILD_TRUTH_FORBIDDEN",
        `portfolio relationship cannot copy child-owned truth in ${key}`,
        `/${String(index)}/${key}`,
      )
    : failure(
        "ROOT_RELATIONSHIP_INTERFACE_OWNER_MISMATCH",
        `consumer relationship cannot define provider interface truth in ${key}`,
        `/${String(index)}/${key}`,
      );
}

function remoteAddressCandidate(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const key =
    value.kind === "portfolio-child"
      ? "child"
      : value.kind === "shared-platform-provider"
        ? "consumer"
        : value.kind === "shared-platform-consumer"
          ? "provider"
          : null;
  if (key === null) return null;
  const candidate = value[key];
  return isRecord(candidate) ? candidate : null;
}

function requireRemoteLock(value: unknown, index: number): RuntimeResult<true> {
  const remote = remoteAddressCandidate(value);
  if (remote === null) return success(true);
  if (
    typeof remote.profile_lock_hash !== "string" ||
    remote.profile_lock_hash.length === 0
  ) {
    return failure(
      "ROOT_RELATIONSHIP_REMOTE_LOCK_REQUIRED",
      "remote root reference requires an exact profile-lock hash",
      `/${String(index)}/profile_lock_hash`,
    );
  }
  return success(true);
}

function schemaValidateRecord(
  value: unknown,
  index: number,
): RuntimeResult<RootRelationshipSourceData> {
  const validated = validateWithSchema<RootRelationshipSourceData>(
    RootRelationshipSourceDataSchema.$id,
    value,
  );
  if (validated.ok) return validated;
  const first = validated.issues[0];
  const suffix = first?.path === "/" ? "" : (first?.path ?? "");
  return failure(
    "ROOT_RELATIONSHIP_SCHEMA_INVALID",
    "root relationship source record does not match its strict contract",
    `/${String(index)}${suffix}`,
    validated.issues.map((issue) => `${issue.code}:${issue.path}`),
  );
}

function localAndRemote(record: RootRelationshipSourceData): {
  readonly local: RootAddress;
  readonly remote: RootAddress;
} {
  switch (record.kind) {
    case "portfolio-child":
      return { local: record.portfolio, remote: record.child };
    case "shared-platform-provider":
      return { local: record.provider, remote: record.consumer };
    case "shared-platform-consumer":
      return { local: record.consumer, remote: record.provider };
  }
}

function validateRecordOwnership(
  localRoot: RootAddress,
  record: RootRelationshipSourceData,
): RuntimeResult<RelationshipEdge> {
  const addresses = localAndRemote(record);
  if (!sameExactAddress(addresses.local, localRoot)) {
    return failure(
      "ROOT_RELATIONSHIP_LOCAL_ROOT_MISMATCH",
      `${record.relationship_id} is not owned by the selected local root`,
      record.relationship_id,
    );
  }
  if (sameDurableAddress(addresses.local, addresses.remote)) {
    return failure(
      "ROOT_RELATIONSHIP_SELF_REFERENCE",
      `${record.relationship_id} references its own durable root address`,
      record.relationship_id,
    );
  }

  if (record.kind === "portfolio-child") {
    if (
      record.relationship_owner_root_id !== record.portfolio.root_id ||
      record.child_truth_owner_root_id !== record.child.root_id
    ) {
      return failure(
        "ROOT_RELATIONSHIP_OWNER_MISMATCH",
        "portfolio relationship and child truth must retain separate owners",
        record.relationship_id,
      );
    }
    return success({ from: record.portfolio, to: record.child });
  }
  if (record.kind === "shared-platform-provider") {
    if (record.owner_root_id !== record.provider.root_id) {
      return failure(
        "ROOT_RELATIONSHIP_OWNER_MISMATCH",
        "provider relationship must be owned by the provider root",
        record.relationship_id,
      );
    }
    const invalid = record.interface_refs.find(
      (reference) => !sameExactAddress(reference.root, record.provider),
    );
    if (invalid !== undefined) {
      return failure(
        "ROOT_RELATIONSHIP_INTERFACE_OWNER_MISMATCH",
        "provider interface reference must resolve to provider-owned truth",
        record.relationship_id,
      );
    }
    return success({ from: record.consumer, to: record.provider });
  }
  if (record.owner_root_id !== record.consumer.root_id) {
    return failure(
      "ROOT_RELATIONSHIP_OWNER_MISMATCH",
      "consumer relationship must be owned by the consumer root",
      record.relationship_id,
    );
  }
  const invalid = record.provider_interface_refs.find(
    (reference) => !sameExactAddress(reference.root, record.provider),
  );
  if (invalid !== undefined) {
    return failure(
      "ROOT_RELATIONSHIP_INTERFACE_OWNER_MISMATCH",
      "consumer may only reference exact provider-owned interface artifacts",
      record.relationship_id,
    );
  }
  return success({ from: record.consumer, to: record.provider });
}

function allAddresses(record: RootRelationshipSourceData): RootAddress[] {
  switch (record.kind) {
    case "portfolio-child":
      return [record.portfolio, record.child];
    case "shared-platform-provider":
      return [
        record.provider,
        record.consumer,
        ...record.interface_refs.map((reference) => reference.root),
      ];
    case "shared-platform-consumer":
      return [
        record.consumer,
        record.provider,
        ...record.provider_interface_refs.map((reference) => reference.root),
      ];
  }
}

function validateAddressConsistency(
  records: readonly RootRelationshipSourceData[],
): RuntimeResult<true> {
  const seen = new Map<string, RootAddress>();
  for (const record of records) {
    for (const address of allAddresses(record)) {
      const key = addressKey(address);
      const previous = seen.get(key);
      if (previous !== undefined && !sameExactAddress(previous, address)) {
        return failure(
          "ROOT_RELATIONSHIP_ADDRESS_DUPLICATE",
          "durable root address appears with conflicting repository or lock data",
          key,
        );
      }
      seen.set(key, address);
    }
  }
  return success(true);
}

function detectCrossNamespaceCycle(
  edges: readonly RelationshipEdge[],
): RuntimeResult<true> {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    const from = addressKey(edge.from);
    const to = addressKey(edge.to);
    graph.set(from, new Set([...(graph.get(from) ?? []), to]));
    if (!graph.has(to)) graph.set(to, new Set());
  }
  const states = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    if (states.get(node) === "visiting") {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (states.get(node) === "visited") return null;
    states.set(node, "visiting");
    stack.push(node);
    for (const next of [...(graph.get(node) ?? [])].sort(compareUtf8)) {
      const cycle = visit(next);
      if (cycle !== null) return cycle;
    }
    stack.pop();
    states.set(node, "visited");
    return null;
  };
  for (const node of [...graph.keys()].sort(compareUtf8)) {
    const cycle = visit(node);
    if (cycle === null) continue;
    const namespaces = new Set(cycle.map((item) => item.split("\u0000")[0]));
    return failure(
      "ROOT_RELATIONSHIP_CYCLE",
      namespaces.size > 1
        ? "cross-namespace root relationships form a dependency cycle"
        : "root relationships form a dependency cycle",
      cycle[0] ?? "",
      cycle,
    );
  }
  return success(true);
}

export function validateRootRelationships(
  localRoot: RootAddress,
  values: readonly unknown[],
): RuntimeResult<ValidatedRootRelationships> {
  if (!validRootAddress(localRoot)) {
    return failure(
      "ROOT_RELATIONSHIP_LOCAL_ROOT_INVALID",
      "local root address is invalid",
      "/local_root",
    );
  }
  const records: RootRelationshipSourceData[] = [];
  const ids = new Set<string>();
  const edges: RelationshipEdge[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const copiedTruth = forbiddenCopiedTruth(value, index);
    if (!copiedTruth.ok) return copiedTruth;
    const remoteLock = requireRemoteLock(value, index);
    if (!remoteLock.ok) return remoteLock;
    const validated = schemaValidateRecord(value, index);
    if (!validated.ok) return validated;
    if (ids.has(validated.value.relationship_id)) {
      return failure(
        "ROOT_RELATIONSHIP_ID_DUPLICATE",
        `relationship ID is repeated: ${validated.value.relationship_id}`,
        validated.value.relationship_id,
      );
    }
    ids.add(validated.value.relationship_id);
    const ownership = validateRecordOwnership(localRoot, validated.value);
    if (!ownership.ok) return ownership;
    edges.push(ownership.value);
    records.push(validated.value);
  }
  const addresses = validateAddressConsistency(records);
  if (!addresses.ok) return addresses;
  const cycles = detectCrossNamespaceCycle(edges);
  if (!cycles.ok) return cycles;
  records.sort((left, right) =>
    compareUtf8(
      `${left.relationship_id}:${left.kind}`,
      `${right.relationship_id}:${right.kind}`,
    ),
  );
  const approvalRefs = [
    ...new Set(records.flatMap((record) => record.approval_refs)),
  ].sort(compareUtf8);
  return success({
    local_root: localRoot,
    records,
    approval_refs: approvalRefs,
  });
}
