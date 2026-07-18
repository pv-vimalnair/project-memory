import semver from "semver";

import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type {
  MigrationDefinition,
  MigrationSummary,
} from "./contracts.js";

export interface MigrationRegistry {
  list(): readonly MigrationSummary[];
  path(fromVersion: string, toVersion: string): RuntimeResult<readonly MigrationDefinition[]>;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function cycle(definitions: readonly MigrationDefinition[]): boolean {
  const edges = new Map<string, string[]>();
  for (const definition of definitions) {
    const targets = edges.get(definition.from_version) ?? [];
    targets.push(definition.to_version);
    edges.set(definition.from_version, targets);
  }
  const active = new Set<string>();
  const complete = new Set<string>();
  function visit(version: string): boolean {
    if (active.has(version)) return true;
    if (complete.has(version)) return false;
    active.add(version);
    for (const target of edges.get(version) ?? []) {
      if (visit(target)) return true;
    }
    active.delete(version);
    complete.add(version);
    return false;
  }
  return [...edges.keys()].some(visit);
}

function summaries(definitions: readonly MigrationDefinition[]): MigrationSummary[] {
  return definitions.map((definition) => ({
    id: definition.id,
    from_version: definition.from_version,
    to_version: definition.to_version,
    affected_artifacts: [...definition.affected_artifacts],
    authority_impact: definition.authority_impact,
  }));
}

export function createMigrationRegistry(
  definitions: readonly MigrationDefinition[],
): RuntimeResult<MigrationRegistry> {
  const ordered = [...definitions].sort((left, right) => compareUtf8(left.id, right.id));
  const ids = new Set<string>();
  const edges = new Set<string>();
  for (const definition of ordered) {
    if (
      definition.id.trim().length === 0 ||
      semver.valid(definition.from_version) === null ||
      semver.valid(definition.to_version) === null ||
      definition.affected_artifacts.length === 0
    ) {
      return failure("MIGRATION_DEFINITION_INVALID", "migration identity, versions, and artifacts must be valid", definition.id);
    }
    if (ids.has(definition.id)) {
      return failure("MIGRATION_ID_DUPLICATE", "migration ID appears more than once", definition.id);
    }
    ids.add(definition.id);
    const edge = `${definition.from_version}\u0000${definition.to_version}`;
    if (edges.has(edge)) {
      return failure("MIGRATION_EDGE_DUPLICATE", "only one migration may own a version edge", edge);
    }
    edges.add(edge);
  }
  if (cycle(ordered)) {
    return failure("MIGRATION_REGISTRY_CYCLE", "migration graph must be acyclic");
  }
  const downgrade = ordered.find((definition) => !semver.lt(definition.from_version, definition.to_version));
  if (downgrade !== undefined) {
    return failure("MIGRATION_DOWNGRADE_FORBIDDEN", "migration edges must move strictly forward", downgrade.id);
  }
  const outgoing = new Map<string, MigrationDefinition[]>();
  for (const definition of ordered) {
    const values = outgoing.get(definition.from_version) ?? [];
    values.push(definition);
    outgoing.set(definition.from_version, values);
  }
  const registry: MigrationRegistry = {
    list: () => summaries(ordered),
    path(fromVersion, toVersion) {
      if (semver.valid(fromVersion) === null || semver.valid(toVersion) === null) {
        return failure("MIGRATION_VERSION_INVALID", "migration path versions must be semantic versions");
      }
      if (semver.gt(fromVersion, toVersion)) {
        return failure("MIGRATION_DOWNGRADE_FORBIDDEN", "migration paths cannot move backward");
      }
      if (fromVersion === toVersion) return success([]);
      const queue: { readonly version: string; readonly steps: readonly MigrationDefinition[] }[] = [
        { version: fromVersion, steps: [] },
      ];
      const bestDepth = new Map<string, number>([[fromVersion, 0]]);
      const matches: (readonly MigrationDefinition[])[] = [];
      let shortest: number | null = null;
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        if (current === undefined || (shortest !== null && current.steps.length >= shortest)) continue;
        for (const edge of outgoing.get(current.version) ?? []) {
          const steps = [...current.steps, edge];
          if (edge.to_version === toVersion) {
            shortest ??= steps.length;
            if (steps.length === shortest) matches.push(steps);
            continue;
          }
          const prior = bestDepth.get(edge.to_version);
          if (prior !== undefined && prior < steps.length) continue;
          bestDepth.set(edge.to_version, steps.length);
          queue.push({ version: edge.to_version, steps });
        }
      }
      if (matches.length === 0) {
        return failure("MIGRATION_PATH_MISSING", `no migration path exists from ${fromVersion} to ${toVersion}`);
      }
      if (matches.length !== 1) {
        return failure("MIGRATION_PATH_AMBIGUOUS", "migration path has more than one shortest route");
      }
      return success(matches[0] ?? []);
    },
  };
  return success(registry);
}
