import type {
  ComponentDefinition,
  DomainDefinition,
} from "../catalog/contracts/index.js";
import {
  failure,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { validateWithSchema } from "../schema/validate.js";
import type { ResolvedCatalogSelection } from "./catalog-selection-resolver.js";
import { compareUtf8 } from "./catalog-selection-model.js";
import {
  componentImpactMatches,
  domainImpactMatches,
  indexResolvedCatalogSelection,
  type ProfileCatalogIndex,
} from "./compatibility.js";
import {
  ResolvedProfileSchema,
  type ProjectSelection,
  type ResolvedComponentInstance,
  type ResolvedDomainInstance,
  type ResolvedGateExecution,
  type ResolvedProfile,
  type ResolvedRule,
} from "./contracts/index.js";
import {
  buildProfileGates,
  resolveProfileRules,
  type ResolvedProfileRules,
} from "./profile-expansion-rules.js";
import {
  requireProfileLock,
  resolveProfileAdapters,
  resolveProfileOverlays,
  resolveRequiredProfileDefinitions,
  sortedUniqueStrings,
  validateStableBindings,
} from "./profile-expansion-structure.js";

interface InstanceBindings {
  readonly components: ReadonlyMap<string, string[]>;
  readonly domains: ReadonlyMap<string, string[]>;
}

function indexInstanceBindings(selection: ProjectSelection): InstanceBindings {
  const components = new Map<string, string[]>();
  for (const binding of selection.components) {
    components.set(binding.definition.id, [
      ...(components.get(binding.definition.id) ?? []),
      binding.instance_id,
    ]);
  }
  const domains = new Map<string, string[]>();
  for (const binding of selection.domains) {
    domains.set(binding.definition.id, [
      ...(domains.get(binding.definition.id) ?? []),
      binding.instance_id,
    ]);
  }
  return { components, domains };
}

function rulesForComponent(
  definition: ComponentDefinition,
  rules: ResolvedProfileRules,
): ResolvedRule[] {
  return rules.values.filter((rule) => {
    const taxonomy =
      rule.kind === "pattern"
        ? rules.pattern_taxonomy.get(rule.id)
        : rules.companion_taxonomy.get(rule.id);
    return (
      taxonomy?.component_impacts.some((impact) =>
        componentImpactMatches(impact, definition),
      ) ?? false
    );
  });
}

function rulesForDomain(
  definition: DomainDefinition,
  rules: ResolvedProfileRules,
): ResolvedRule[] {
  return rules.values.filter((rule) => {
    const taxonomy =
      rule.kind === "pattern"
        ? rules.pattern_taxonomy.get(rule.id)
        : rules.companion_taxonomy.get(rule.id);
    return (
      taxonomy?.domain_impacts.some((impact) =>
        domainImpactMatches(impact, definition),
      ) ?? false
    );
  });
}

function materializeComponents(
  selection: ProjectSelection,
  index: ProfileCatalogIndex,
  requiredIds: ReadonlySet<string>,
  bindings: InstanceBindings,
  rules: ResolvedProfileRules,
  gates: readonly ResolvedGateExecution[],
): RuntimeResult<ResolvedComponentInstance[]> {
  const values: ResolvedComponentInstance[] = [];
  for (const binding of selection.components) {
    if (!requiredIds.has(binding.definition.id)) continue;
    const definition = index.components.get(binding.definition.id);
    if (definition === undefined) {
      return failure(
        "PROFILE_COMPONENT_REQUIRED",
        "component source is missing",
        binding.definition.id,
      );
    }
    const lock = requireProfileLock(index, "component", binding.definition.id);
    if (!lock.ok) return { ok: false, issues: lock.issues };
    if (
      binding.definition.version !== definition.version ||
      binding.definition.version !== lock.value.version
    ) {
      return failure(
        "PROFILE_DEFINITION_VERSION_CONFLICT",
        `component ${binding.definition.id} version does not match its lock`,
        binding.definition.id,
      );
    }
    values.push({
      instance_id: binding.instance_id,
      definition_id: definition.id,
      definition_version: lock.value.version,
      definition_target_path: lock.value.target_path,
      definition_target_sha256: lock.value.target_sha256,
      slug: binding.slug,
      required_domains: sortedUniqueStrings(
        definition.default_domains.flatMap(
          (id) => bindings.domains.get(id) ?? [],
        ),
      ),
      rules: rulesForComponent(definition, rules),
      gates: [...gates],
    });
  }
  return {
    ok: true,
    value: values.sort((left, right) =>
      compareUtf8(left.instance_id, right.instance_id),
    ),
    warnings: [],
  };
}

function materializeDomains(
  selection: ProjectSelection,
  index: ProfileCatalogIndex,
  requiredIds: ReadonlySet<string>,
  bindings: InstanceBindings,
  rules: ResolvedProfileRules,
  gates: readonly ResolvedGateExecution[],
): RuntimeResult<ResolvedDomainInstance[]> {
  const values: ResolvedDomainInstance[] = [];
  for (const binding of selection.domains) {
    if (!requiredIds.has(binding.definition.id)) continue;
    const definition = index.domains.get(binding.definition.id);
    if (definition === undefined) {
      return failure(
        "PROFILE_DOMAIN_REQUIRED",
        "domain source is missing",
        binding.definition.id,
      );
    }
    const lock = requireProfileLock(index, "domain", binding.definition.id);
    if (!lock.ok) return { ok: false, issues: lock.issues };
    if (
      binding.definition.version !== definition.version ||
      binding.definition.version !== lock.value.version
    ) {
      return failure(
        "PROFILE_DEFINITION_VERSION_CONFLICT",
        `domain ${binding.definition.id} version does not match its lock`,
        binding.definition.id,
      );
    }
    values.push({
      instance_id: binding.instance_id,
      definition_id: definition.id,
      definition_version: lock.value.version,
      definition_target_path: lock.value.target_path,
      definition_target_sha256: lock.value.target_sha256,
      slug: binding.slug,
      required_components: sortedUniqueStrings(
        definition.default_components.flatMap(
          (id) => bindings.components.get(id) ?? [],
        ),
      ),
      rules: rulesForDomain(definition, rules),
      gates: [...gates],
    });
  }
  return {
    ok: true,
    value: values.sort((left, right) =>
      compareUtf8(left.instance_id, right.instance_id),
    ),
    warnings: [],
  };
}

function validateSelectionIdentity(
  selection: ProjectSelection,
  catalog: ResolvedCatalogSelection,
): RuntimeResult<true> {
  const blueprint = catalog.blueprint;
  if (!blueprint.allowed_root_kinds.includes(selection.root.kind)) {
    return failure(
      "PROFILE_ROOT_KIND_INCOMPATIBLE",
      `${blueprint.id} does not allow root kind ${selection.root.kind}`,
      selection.root.kind,
    );
  }
  if (blueprint.primary_archetype !== selection.root.primary_archetype) {
    return failure(
      "PROFILE_ARCHETYPE_INCOMPATIBLE",
      `${blueprint.id} requires ${blueprint.primary_archetype}`,
      selection.root.primary_archetype,
    );
  }
  if (
    blueprint.id !== selection.root.blueprint.id ||
    blueprint.version !== selection.root.blueprint.version
  ) {
    return failure(
      "PROFILE_BLUEPRINT_MISMATCH",
      "selected blueprint identity does not match the resolved catalog",
      selection.root.blueprint.id,
    );
  }
  if (
    catalog.release !== selection.catalog.release ||
    catalog.release_hash !== selection.catalog.catalog_hash
  ) {
    return failure(
      "PROFILE_CATALOG_SELECTION_MISMATCH",
      "selected catalog release does not match the resolved closure",
      selection.catalog.release,
    );
  }
  return { ok: true, value: true, warnings: [] };
}

export function expandResolvedProfile(
  selection: ProjectSelection,
  catalog: ResolvedCatalogSelection,
): RuntimeResult<ResolvedProfile> {
  const identity = validateSelectionIdentity(selection, catalog);
  if (!identity.ok) return { ok: false, issues: identity.issues };
  const indexed = indexResolvedCatalogSelection(catalog);
  if (!indexed.ok) return { ok: false, issues: indexed.issues };
  const stableBindings = validateStableBindings(selection);
  if (!stableBindings.ok) {
    return { ok: false, issues: stableBindings.issues };
  }
  const blueprintLock = requireProfileLock(
    indexed.value,
    "blueprint",
    catalog.blueprint.id,
  );
  if (!blueprintLock.ok) return { ok: false, issues: blueprintLock.issues };
  const overlays = resolveProfileOverlays(selection, catalog, indexed.value);
  if (!overlays.ok) return { ok: false, issues: overlays.issues };
  const adapters = resolveProfileAdapters(selection, catalog, indexed.value);
  if (!adapters.ok) return { ok: false, issues: adapters.issues };
  const required = resolveRequiredProfileDefinitions(
    selection,
    catalog,
    indexed.value,
    overlays.value,
    adapters.value.definitions,
  );
  if (!required.ok) return { ok: false, issues: required.issues };
  const rules = resolveProfileRules(selection, indexed.value, overlays.value);
  if (!rules.ok) return { ok: false, issues: rules.issues };
  const gates = buildProfileGates(
    catalog.blueprint.id,
    catalog.blueprint.validation_gates,
    adapters.value.definitions,
    indexed.value,
    rules.value.values,
  );
  if (!gates.ok) return { ok: false, issues: gates.issues };

  const instanceBindings = indexInstanceBindings(selection);
  const components = materializeComponents(
    selection,
    indexed.value,
    required.value.component_ids,
    instanceBindings,
    rules.value,
    gates.value,
  );
  if (!components.ok) return { ok: false, issues: components.issues };
  const domains = materializeDomains(
    selection,
    indexed.value,
    required.value.domain_ids,
    instanceBindings,
    rules.value,
    gates.value,
  );
  if (!domains.ok) return { ok: false, issues: domains.issues };

  const profile: ResolvedProfile = {
    schema_version: "1.0.0",
    root: {
      id: selection.root.id,
      namespace: selection.root.namespace,
      kind: selection.root.kind,
      primary_archetype: selection.root.primary_archetype,
      lifecycle: selection.root.lifecycle,
    },
    blueprint: blueprintLock.value,
    overlays: [...overlays.value],
    components: components.value,
    domains: domains.value,
    adapters: [...adapters.value.values],
    rules: [...rules.value.values],
    gates: [...gates.value],
    templates: [],
    root_relationships: [],
    catalog: {
      release: catalog.release,
      release_hash: catalog.release_hash,
    },
  };
  return validateWithSchema<ResolvedProfile>(ResolvedProfileSchema.$id, profile);
}
