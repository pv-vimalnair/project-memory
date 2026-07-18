import {
  failure,
  success,
  type IdFactory,
  type RuntimeResult,
} from "../index.js";
import { mergeImpacts } from "../planning/merge-impacts.js";
import type {
  CompileComponentBinding,
  CompileDomainBinding,
  CompileWorkstreamInput,
  ImpactEntry,
  OutcomeIntent,
  ResolvedImpactPlan,
} from "../planning/types.js";
import type { ResolvedPattern } from "./types.js";

const MUTATION_DUTIES = new Set(["modify", "release", "notify"]);
const PATH_PLACEHOLDERS = new Set([
  "accepted-task-owned-paths",
  "resolved-component-paths",
]);

export interface CompiledImpactPlan {
  readonly plan: ResolvedImpactPlan;
  readonly domains: readonly CompileDomainBinding[];
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareUtf8);
}

function needsMutation(duties: readonly string[]): boolean {
  return duties.some((duty) => MUTATION_DUTIES.has(duty));
}

function writePaths(
  configured: readonly string[],
  owned: readonly string[],
  duties: readonly string[],
): string[] {
  if (!needsMutation(duties)) return [];
  if (
    configured.length === 0 ||
    configured.some((path) => PATH_PLACEHOLDERS.has(path))
  ) {
    return unique(owned);
  }
  return unique(configured);
}

function componentMatches(
  binding: CompileComponentBinding,
  selector: ResolvedPattern["component_impacts"][number]["selector"],
): boolean {
  if ("id" in selector) return binding.definitionId === selector.id;
  if ("type" in selector) return binding.type === selector.type;
  if ("tag" in selector) return binding.tags.includes(selector.tag);
  return binding.dependencyRules.includes(selector.dependency_rule);
}

function domainMatches(
  binding: CompileDomainBinding,
  selector: ResolvedPattern["domain_impacts"][number]["selector"],
): boolean {
  return "id" in selector
    ? binding.definitionId === selector.id
    : binding.tags.includes(selector.tag);
}

function componentEntries(
  pattern: ResolvedPattern,
  components: readonly CompileComponentBinding[],
): RuntimeResult<readonly ImpactEntry[]> {
  const entries: ImpactEntry[] = [];
  for (const impact of pattern.component_impacts) {
    if (impact.requirement === "not_applicable" || impact.condition === false) {
      continue;
    }
    const matches = components.filter((component) =>
      componentMatches(component, impact.selector),
    );
    if (matches.length === 0 && impact.requirement === "required") {
      return failure(
        "compile.required_component_unbound",
        "required pattern component impact has no locked component binding",
        pattern.id,
      );
    }
    for (const binding of matches) {
      entries.push({
        sourceId: pattern.id,
        targetKind: "component",
        targetId: binding.instanceId,
        requirement: "required",
        duties: [...impact.duties],
        readPaths: [...binding.paths],
        writePaths: writePaths(
          impact.write_scope,
          binding.paths,
          impact.duties,
        ),
        requiredEvidenceIds: [...pattern.evidence],
        requiredRecordTypes: [],
        responsibleRole: impact.responsible_role,
      });
    }
  }
  return success(entries);
}

function ensureDomain(
  input: CompileWorkstreamInput,
  selector: ResolvedPattern["domain_impacts"][number]["selector"],
  domains: CompileDomainBinding[],
  authorizedPaths: readonly string[],
  ids: IdFactory,
): RuntimeResult<readonly CompileDomainBinding[]> {
  const matched = domains.filter((domain) => domainMatches(domain, selector));
  if (matched.length > 0 || !("id" in selector)) return success(matched);
  let instanceId: string;
  try {
    instanceId = ids.next("DOM");
  } catch (error: unknown) {
    return failure(
      "compile.id_generation_failed",
      error instanceof Error ? error.message : String(error),
      selector.id,
    );
  }
  const created: CompileDomainBinding = {
    instanceId,
    definitionId: selector.id,
    tags: [],
    paths: [...authorizedPaths],
  };
  domains.push(created);
  return success([created]);
}

function domainEntries(
  input: CompileWorkstreamInput,
  pattern: ResolvedPattern,
  domains: CompileDomainBinding[],
  authorizedPaths: readonly string[],
  ids: IdFactory,
): RuntimeResult<readonly ImpactEntry[]> {
  const entries: ImpactEntry[] = [];
  for (const impact of pattern.domain_impacts) {
    if (impact.requirement === "not_applicable" || impact.condition === false) {
      continue;
    }
    const matched = ensureDomain(
      input,
      impact.selector,
      domains,
      authorizedPaths,
      ids,
    );
    if (!matched.ok) return matched;
    if (matched.value.length === 0 && impact.requirement === "required") {
      return failure(
        "compile.required_domain_unbound",
        "required pattern domain impact has no locked domain binding",
        pattern.id,
      );
    }
    for (const binding of matched.value) {
      entries.push({
        sourceId: pattern.id,
        targetKind: "domain",
        targetId: binding.instanceId,
        requirement: "required",
        duties: [...impact.duties],
        readPaths: [...binding.paths],
        writePaths: writePaths(
          impact.write_scope,
          binding.paths,
          impact.duties,
        ),
        requiredEvidenceIds: [...pattern.evidence],
        requiredRecordTypes: [...impact.required_records],
        responsibleRole: impact.responsible_role,
      });
    }
  }
  return success(entries);
}

export function resolveCompiledImpacts(
  input: CompileWorkstreamInput,
  outcome: OutcomeIntent,
  patterns: readonly ResolvedPattern[],
  ids: IdFactory,
): RuntimeResult<CompiledImpactPlan> {
  const authorizedPaths = input.authorizedPathsByOutcome[outcome.id];
  if (authorizedPaths === undefined || authorizedPaths.length === 0) {
    return failure(
      "compile.authorized_paths_missing",
      "every compiled outcome requires explicit authorized paths",
      outcome.id,
    );
  }
  const domains = input.domains.map((domain) => ({ ...domain }));
  const entries: ImpactEntry[] = [];
  for (const pattern of [...patterns].sort((left, right) =>
    compareUtf8(left.id, right.id),
  )) {
    const components = componentEntries(pattern, input.components);
    if (!components.ok) return components;
    entries.push(...components.value);
    const domain = domainEntries(
      input,
      pattern,
      domains,
      authorizedPaths,
      ids,
    );
    if (!domain.ok) return domain;
    entries.push(...domain.value);
  }
  const usedTargetIds = new Set(entries.map((entry) => entry.targetId));
  const ownedPathsByTarget: Record<string, readonly string[]> = {};
  for (const component of input.components) {
    if (usedTargetIds.has(component.instanceId)) {
      ownedPathsByTarget[component.instanceId] = [...component.paths];
    }
  }
  for (const domain of domains) {
    if (usedTargetIds.has(domain.instanceId)) {
      ownedPathsByTarget[domain.instanceId] = [...domain.paths];
    }
  }
  const approvalRequired = patterns.some(
    (pattern) => pattern.authorization.mutation === "approval-required",
  );
  const approvalScopes = input.approvals
    .filter((approval) => approval.kind === "mutation")
    .map((approval) => approval.scope);
  const merged = mergeImpacts({
    immutableImpacts: [],
    rootPolicyImpacts: [],
    overlayImpacts: [],
    patternImpacts: entries,
    ownedPathsByTarget,
    claimCandidatePaths: authorizedPaths,
    acceptedDecisionScopes: [authorizedPaths],
    approvalScopes,
    approvalRequired,
    coordinatedTargetIds: [],
    dependencyEdges: [],
  });
  return merged.ok
    ? success({ plan: merged.value, domains })
    : merged;
}
