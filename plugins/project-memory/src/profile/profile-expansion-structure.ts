import type { AdapterDefinition } from "../catalog/contracts/index.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import type { ResolvedCatalogSelection } from "./catalog-selection-resolver.js";
import { compareUtf8 } from "./catalog-selection-model.js";
import type { ProfileCatalogIndex } from "./compatibility.js";
import type {
  LockedDefinition,
  ProjectSelection,
  ResolvedAdapter,
} from "./contracts/index.js";

export function sortedUniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

export function requireProfileLock(
  index: ProfileCatalogIndex,
  kind: LockedDefinition["kind"],
  id: string,
): RuntimeResult<LockedDefinition> {
  const lock = index.locks.get(`${kind}:${id}`);
  return lock === undefined
    ? failure(
        "PROFILE_CATALOG_LOCK_MISSING",
        `selected ${kind} ${id} has no locked target bytes`,
        id,
      )
    : success(lock);
}

function requireActive(
  value: { readonly status: string; readonly id: string },
): RuntimeResult<true> {
  return value.status === "active"
    ? success(true)
    : failure(
        "PROFILE_DEFINITION_NOT_SELECTABLE",
        `${value.id} is ${value.status}`,
        value.id,
      );
}

function rootCompatible(
  definition: {
    readonly compatible_root_kinds: readonly string[];
    readonly compatible_archetypes: readonly string[];
  },
  selection: ProjectSelection,
): boolean {
  return (
    definition.compatible_root_kinds.includes(selection.root.kind) &&
    definition.compatible_archetypes.includes(selection.root.primary_archetype)
  );
}

export function validateStableBindings(
  selection: ProjectSelection,
): RuntimeResult<true> {
  const ids = new Set<string>();
  const scopedSlugs = new Set<string>();
  for (const [scope, bindings] of [
    ["component", selection.components],
    ["domain", selection.domains],
  ] as const) {
    for (const binding of bindings) {
      if (ids.has(binding.instance_id)) {
        return failure(
          "PROFILE_REFERENCE_DUPLICATE",
          `duplicate stable instance ID ${binding.instance_id}`,
          binding.instance_id,
        );
      }
      ids.add(binding.instance_id);
      const slugKey = `${scope}:${binding.slug}`;
      if (scopedSlugs.has(slugKey)) {
        return failure(
          "PROFILE_REFERENCE_DUPLICATE",
          `duplicate ${scope} slug ${binding.slug}`,
          binding.slug,
        );
      }
      scopedSlugs.add(slugKey);
    }
  }
  return success(true);
}

export function resolveProfileOverlays(
  selection: ProjectSelection,
  catalog: ResolvedCatalogSelection,
  index: ProfileCatalogIndex,
): RuntimeResult<LockedDefinition[]> {
  const blueprint = catalog.blueprint;
  const queue = [
    ...blueprint.overlays.baked,
    ...blueprint.overlays.defaults,
    ...selection.overlays,
  ];
  const overlayIds = new Set<string>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    if (id === undefined || overlayIds.has(id)) continue;
    if (blueprint.overlays.forbidden.includes(id)) {
      return failure(
        "PROFILE_OVERLAY_FORBIDDEN",
        `blueprint ${blueprint.id} forbids ${id}`,
        id,
      );
    }
    const definition = index.overlays.get(id);
    if (definition === undefined) {
      return failure(
        "PROFILE_OVERLAY_REQUIRED",
        `required overlay ${id} is absent from the selected catalog`,
        id,
      );
    }
    const active = requireActive(definition);
    if (!active.ok) return active;
    if (!rootCompatible(definition, selection)) {
      return failure(
        "PROFILE_OVERLAY_INCOMPATIBLE",
        `${id} is incompatible with the selected root`,
        id,
      );
    }
    overlayIds.add(id);
    queue.push(...definition.requires_overlays);
  }
  for (const id of overlayIds) {
    const definition = index.overlays.get(id);
    const conflict = definition?.conflicts_with.find((candidate) =>
      overlayIds.has(candidate),
    );
    if (conflict !== undefined) {
      return failure(
        "PROFILE_OVERLAY_CONFLICT",
        `${id} conflicts with ${conflict}`,
        id,
        [conflict],
      );
    }
  }
  const locks: LockedDefinition[] = [];
  for (const id of [...overlayIds].sort(compareUtf8)) {
    const lock = requireProfileLock(index, "overlay", id);
    if (!lock.ok) return lock;
    locks.push(lock.value);
  }
  return success(locks);
}

export interface ResolvedProfileAdapters {
  readonly values: ResolvedAdapter[];
  readonly definitions: AdapterDefinition[];
}

export function resolveProfileAdapters(
  selection: ProjectSelection,
  catalog: ResolvedCatalogSelection,
  index: ProfileCatalogIndex,
): RuntimeResult<ResolvedProfileAdapters> {
  const slots = ["agent", "runtime", "workflow"] as const;
  for (const requiredSlot of catalog.blueprint.adapter_slots) {
    if (
      !slots.includes(requiredSlot as (typeof slots)[number]) ||
      selection.adapters[requiredSlot as (typeof slots)[number]].length === 0
    ) {
      return failure(
        "PROFILE_ADAPTER_REQUIRED",
        `blueprint requires an accepted ${requiredSlot} adapter`,
        requiredSlot,
      );
    }
  }
  const seen = new Set<string>();
  const values: ResolvedAdapter[] = [];
  const definitions: AdapterDefinition[] = [];
  for (const slot of slots) {
    for (const reference of selection.adapters[slot]) {
      if (seen.has(reference.id)) {
        return failure(
          "PROFILE_REFERENCE_DUPLICATE",
          `adapter ${reference.id} is selected more than once`,
          reference.id,
        );
      }
      seen.add(reference.id);
      const definition = index.adapters.get(reference.id);
      if (definition === undefined) {
        return failure(
          "PROFILE_ADAPTER_REQUIRED",
          `selected adapter ${reference.id} has no source definition`,
          reference.id,
        );
      }
      const active = requireActive(definition);
      if (!active.ok) return active;
      if (definition.kind !== slot) {
        return failure(
          "PROFILE_ADAPTER_KIND_MISMATCH",
          `${reference.id} is ${definition.kind}, not ${slot}`,
          reference.id,
        );
      }
      if (!rootCompatible(definition, selection)) {
        return failure(
          "PROFILE_ADAPTER_INCOMPATIBLE",
          `${reference.id} is incompatible with the selected root`,
          reference.id,
        );
      }
      const lock = requireProfileLock(index, "adapter", reference.id);
      if (!lock.ok) return lock;
      if (
        reference.version !== definition.version ||
        reference.version !== lock.value.version
      ) {
        return failure(
          "PROFILE_DEFINITION_VERSION_CONFLICT",
          `selected adapter ${reference.id} version does not match its lock`,
          reference.id,
        );
      }
      definitions.push(definition);
      values.push({
        kind: slot,
        definition_id: reference.id,
        definition_version: lock.value.version,
        definition_target_path: lock.value.target_path,
        definition_target_sha256: lock.value.target_sha256,
      });
    }
  }
  return success({
    values: values.sort((left, right) =>
      compareUtf8(
        `${left.kind}:${left.definition_id}`,
        `${right.kind}:${right.definition_id}`,
      ),
    ),
    definitions: definitions.sort((left, right) => compareUtf8(left.id, right.id)),
  });
}

export interface RequiredProfileDefinitions {
  readonly component_ids: ReadonlySet<string>;
  readonly domain_ids: ReadonlySet<string>;
}

export function resolveRequiredProfileDefinitions(
  selection: ProjectSelection,
  catalog: ResolvedCatalogSelection,
  index: ProfileCatalogIndex,
  overlays: readonly LockedDefinition[],
  adapters: readonly AdapterDefinition[],
): RuntimeResult<RequiredProfileDefinitions> {
  const componentIds = new Set([
    ...catalog.blueprint.default_components,
    ...selection.components.map((binding) => binding.definition.id),
  ]);
  const domainIds = new Set([
    ...catalog.blueprint.default_domains,
    ...selection.domains.map((binding) => binding.definition.id),
  ]);
  for (const overlay of overlays) {
    const definition = index.overlays.get(overlay.id);
    definition?.default_components.forEach((id) => componentIds.add(id));
    definition?.default_domains.forEach((id) => domainIds.add(id));
  }
  for (const adapter of adapters) {
    adapter.default_components.forEach((id) => componentIds.add(id));
    adapter.default_domains.forEach((id) => domainIds.add(id));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...componentIds]) {
      const definition = index.components.get(id);
      if (definition === undefined) {
        return failure(
          "PROFILE_COMPONENT_REQUIRED",
          `required component definition ${id} is missing`,
          id,
        );
      }
      const active = requireActive(definition);
      if (!active.ok) return active;
      for (const domainId of definition.default_domains) {
        const before = domainIds.size;
        domainIds.add(domainId);
        changed ||= domainIds.size !== before;
      }
    }
    for (const id of [...domainIds]) {
      const definition = index.domains.get(id);
      if (definition === undefined) {
        return failure(
          "PROFILE_DOMAIN_REQUIRED",
          `required domain definition ${id} is missing`,
          id,
        );
      }
      const active = requireActive(definition);
      if (!active.ok) return active;
      if (!rootCompatible(definition, selection)) {
        return failure(
          "PROFILE_DOMAIN_INCOMPATIBLE",
          `${id} is incompatible with the selected root`,
          id,
        );
      }
      for (const componentId of definition.default_components) {
        const before = componentIds.size;
        componentIds.add(componentId);
        changed ||= componentIds.size !== before;
      }
    }
  }
  for (const id of componentIds) {
    if (!selection.components.some((binding) => binding.definition.id === id)) {
      return failure(
        "PROFILE_COMPONENT_REQUIRED",
        `required component ${id} has no accepted instance binding`,
        id,
      );
    }
  }
  for (const id of domainIds) {
    if (!selection.domains.some((binding) => binding.definition.id === id)) {
      return failure(
        "PROFILE_DOMAIN_REQUIRED",
        `required domain ${id} has no accepted instance binding`,
        id,
      );
    }
  }
  return success({ component_ids: componentIds, domain_ids: domainIds });
}
