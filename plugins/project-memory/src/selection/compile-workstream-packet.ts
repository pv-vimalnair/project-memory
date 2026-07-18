import {
  failure,
  success,
  type Clock,
  type IdFactory,
  type RuntimeResult,
} from "../index.js";
import { assignTaskPackets } from "../planning/assign-task-packets.js";
import { buildTaskCoverage } from "../planning/build-task-coverage.js";
import { materializeTaskPacket } from "../planning/materialize-task-packet.js";
import type {
  Approval,
  CompileWorkstreamInput,
  CoverageMap,
  OutcomeIntent,
  PatternRef,
  ResolvedImpactPlan,
  TaskAssignment,
  TaskPacket,
  WorkstreamPatternSet,
  WorkstreamRequirement,
} from "../planning/types.js";
import type {
  CompanionClosure,
  NormalizedFeatureMap,
  ResolvedPattern,
  SelectionDecision,
} from "./types.js";

const MUTATION_DUTIES = new Set(["modify", "release", "notify"]);

export interface PacketCompileInput {
  readonly source: CompileWorkstreamInput;
  readonly outcome: OutcomeIntent;
  readonly features: NormalizedFeatureMap;
  readonly decision: SelectionDecision;
  readonly closure: CompanionClosure;
  readonly patterns: readonly ResolvedPattern[];
  readonly impacts: ResolvedImpactPlan;
  readonly workstreamId: string;
  readonly taskId: string;
  readonly evaluatedAt: string;
}

export interface PacketCompileResult {
  readonly patternSet: WorkstreamPatternSet;
  readonly assignments: readonly TaskAssignment[];
  readonly packet: TaskPacket;
  readonly coverage: CoverageMap;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareUtf8);
}

function patternReference(
  id: string,
  version: string,
  provenanceRuleIds: readonly string[],
): PatternRef {
  return { id, version, provenanceRuleIds: unique(provenanceRuleIds) };
}

function lockedPatternSet(input: PacketCompileInput): WorkstreamPatternSet {
  const primaryId = input.closure.primaryPatternIds[0] as string;
  const references = new Map(
    input.closure.patterns.map((reference) => [reference.id, reference]),
  );
  const primary = references.get(primaryId) as (typeof input.closure.patterns)[number];
  return {
    outcomePrimary: patternReference(
      primary.id,
      primary.version,
      primary.provenanceRuleIds,
    ),
    companions: input.closure.companionPatternIds
      .map((id) => references.get(id))
      .filter((item): item is NonNullable<typeof item> => item !== undefined)
      .map((item) =>
        patternReference(item.id, item.version, item.provenanceRuleIds),
      )
      .sort((left, right) => compareUtf8(left.id, right.id)),
  };
}

function requirements(
  input: PacketCompileInput,
  patternSet: WorkstreamPatternSet,
): readonly WorkstreamRequirement[] {
  const primaryId = patternSet.outcomePrimary.id;
  const result: WorkstreamRequirement[] = [];
  const add = (
    pattern: ResolvedPattern,
    kind: WorkstreamRequirement["kind"],
    value: string,
    index: number,
  ) => {
    const sourcePatternIds = unique([primaryId, pattern.id]);
    result.push({
      id: `${input.outcome.id}:${kind}:${pattern.id}:${String(index + 1)}:${value}`,
      kind,
      exclusive:
        (kind === "duty" && MUTATION_DUTIES.has(value)) ||
        (kind === "approval" && value === "external-action"),
      coordinationRequired: false,
      sourcePatternIds,
    });
  };
  for (const pattern of input.patterns) {
    pattern.duties.forEach((value, index) => {
      add(pattern, "duty", value, index);
    });
    pattern.gates.forEach((value, index) => {
      add(pattern, "gate", value, index);
    });
    pattern.evidence.forEach((value, index) => {
      add(pattern, "evidence", value, index);
    });
    pattern.outputs.forEach((value, index) => {
      add(pattern, "output", value, index);
    });
    pattern.memory_updates.forEach((value, index) => {
      add(pattern, "record_update", value, index);
    });
    if (pattern.authorization.mutation === "approval-required") {
      add(pattern, "approval", "mutation", 0);
    }
    if (pattern.authorization.external_action !== "none") {
      add(pattern, "approval", "external-action", 1);
    }
  }
  return result.sort((left, right) => compareUtf8(left.id, right.id));
}

function evidenceIds(features: NormalizedFeatureMap): string[] {
  return unique(
    Object.values(features.features).flatMap((feature) =>
      feature.evidence.map((evidence) => evidence.evidence_id),
    ),
  );
}

function requirementEvidence(input: PacketCompileInput): string[] {
  const ruleEvidence = input.closure.appliedRuleIds.flatMap((id) =>
    input.source.catalog.companionRules.get(id)?.require_evidence ?? [],
  );
  return unique([
    ...input.patterns.flatMap((pattern) => pattern.evidence),
    ...input.impacts.impacts.flatMap((impact) => impact.requiredEvidenceIds),
    ...ruleEvidence,
  ]);
}

function gateType(text: string): TaskPacket["gates"][number]["type"] {
  const normalized = text.toLowerCase();
  if (normalized.includes("lint")) return "lint";
  if (normalized.includes("build")) return "build";
  if (normalized.includes("render") || normalized.includes("visual")) return "render";
  if (normalized.includes("test")) return "test";
  if (normalized.includes("policy") || normalized.includes("authority")) return "policy";
  return "review";
}

function externalAuthorization(
  input: PacketCompileInput,
): RuntimeResult<TaskPacket["authorization"]["external_action"]> {
  const required = input.patterns.some(
    (pattern) => pattern.authorization.external_action !== "none",
  );
  const configured = input.source.externalAuthorizationByOutcome[input.outcome.id];
  if (required && (configured === undefined || !configured.allowed)) {
    return failure(
      "compile.external_authorization_missing",
      "external-action patterns require an exact approved authorization envelope",
      input.outcome.id,
    );
  }
  if (!required && configured?.allowed === true) {
    return failure(
      "compile.external_authorization_unexpected",
      "external authorization cannot be attached to a non-external workstream",
      input.outcome.id,
    );
  }
  return success(
    configured ?? {
      allowed: false,
      approval_ids: [],
      target: null,
      environment: null,
      scope: [],
      timing: null,
    },
  );
}

function gates(
  input: PacketCompileInput,
  external: TaskPacket["authorization"]["external_action"],
): TaskPacket["gates"] {
  const result: TaskPacket["gates"][number][] = [];
  for (const pattern of input.patterns) {
    pattern.gates.forEach((instruction, index) => {
      result.push({
        id: `gate:${input.outcome.id}:${pattern.id}:${String(index + 1)}`,
        definition_ref: `${pattern.id}@${pattern.version}`,
        type: gateType(instruction),
        command_or_check: instruction,
        required: true,
        conflict_sensitive: pattern.authorization.mutation !== "none",
        evidence_type: "verification-result",
        execution: {
          kind: "check",
          instruction,
          verifier_role: "worker",
          approval_refs: [],
        },
      });
    });
  }
  if (external.allowed) {
    const primary = input.patterns.find(
      (pattern) => pattern.id === input.closure.primaryPatternIds[0],
    ) as ResolvedPattern;
    const instruction = `Verify approved external action for ${external.target as string} in ${external.environment as string}`;
    result.push({
      id: `gate:${input.outcome.id}:external-action`,
      definition_ref: `${primary.id}@${primary.version}`,
      type: "external",
      command_or_check: instruction,
      required: true,
      conflict_sensitive: true,
      evidence_type: "external-verification",
      execution: {
        kind: "check",
        instruction,
        verifier_role: "external",
        approval_refs: [...external.approval_ids],
      },
    });
  }
  return result.sort((left, right) => compareUtf8(left.id, right.id));
}

function mutationAuthorization(
  patterns: readonly ResolvedPattern[],
): TaskPacket["authorization"]["mutation"] {
  const rank = { none: 0, "task-scoped": 1, "approval-required": 2 } as const;
  return patterns
    .map((pattern) => pattern.authorization.mutation)
    .sort((left, right) => rank[right] - rank[left])[0] ?? "none";
}

function activationAuthority(input: PacketCompileInput) {
  const rank = { "automatic-by-rule": 0, integrator: 1, Pitaji: 2 } as const;
  return [
    input.outcome.authorityClass,
    ...input.patterns.map((pattern) => pattern.authorization.workstream_activation),
  ].sort((left, right) => rank[right] - rank[left])[0] as OutcomeIntent["authorityClass"];
}

function relevantApprovals(
  input: PacketCompileInput,
  external: TaskPacket["authorization"]["external_action"],
  mutation: TaskPacket["authorization"]["mutation"],
): readonly Approval[] {
  const externalIds = new Set(external.approval_ids);
  return input.source.approvals.filter((approval) => {
    if (externalIds.has(approval.id)) return true;
    return (
      mutation === "approval-required" &&
      approval.kind === "mutation" &&
      (approval.target === null || approval.target === input.outcome.id) &&
      input.impacts.mutationPaths.every((path) => approval.scope.includes(path))
    );
  });
}

function componentDuties(input: PacketCompileInput, evidence: readonly string[]) {
  return input.impacts.impacts
    .filter((impact) => impact.targetKind === "component")
    .map((impact) => ({
      component_id: impact.targetId,
      duties: [...impact.duties],
      requirement: "required" as const,
      reason: `Resolved impacts from ${impact.sourceIds.join(", ")}`,
      read_scope: [...impact.readPaths],
      write_scope: [...impact.writePaths],
      responsible_role: impact.responsibleRole,
      resolution: {
        source_impact_ids: [...impact.sourceIds],
        predicate_ids: [...(input.decision.winner?.matched_positive_ids ?? [])],
        result: true as const,
        evidence_ids: [...evidence],
        evaluated_by: "validator.selection",
        evaluated_at: input.evaluatedAt,
      },
    }));
}

function domainDuties(input: PacketCompileInput, evidence: readonly string[]) {
  return input.impacts.impacts
    .filter((impact) => impact.targetKind === "domain")
    .map((impact) => ({
      domain_id: impact.targetId,
      duties: [...impact.duties],
      requirement: "required" as const,
      reason: `Resolved impacts from ${impact.sourceIds.join(", ")}`,
      write_scope: [...impact.writePaths],
      required_records: [...impact.requiredRecordTypes],
      responsible_role: impact.responsibleRole,
      resolution: {
        source_impact_ids: [...impact.sourceIds],
        predicate_ids: [...(input.decision.winner?.matched_positive_ids ?? [])],
        result: true as const,
        evidence_ids: [...evidence],
        evaluated_by: "validator.selection",
        evaluated_at: input.evaluatedAt,
      },
    }));
}

export function compileTaskPacket(
  input: PacketCompileInput,
  clock: Clock,
  ids: IdFactory,
): RuntimeResult<PacketCompileResult> {
  const patternSet = lockedPatternSet(input);
  const workstreamRequirements = requirements(input, patternSet);
  const authorizedPaths = input.source.authorizedPathsByOutcome[input.outcome.id] ?? [];
  const assigned = assignTaskPackets({
    patternSet,
    requirements: workstreamRequirements,
    taskCandidates: [{
      taskId: input.taskId,
      primaryPatternId: patternSet.outcomePrimary.id,
      requestedRequirementIds: workstreamRequirements.map((item) => item.id),
      claimedPaths: authorizedPaths,
      coordinationIds: [],
    }],
    authorizedPaths,
  });
  if (!assigned.ok) return assigned;
  const coverage = buildTaskCoverage(patternSet, workstreamRequirements, assigned.value);
  if (!coverage.ok) return coverage;
  const external = externalAuthorization(input);
  if (!external.ok) return external;
  const mutation = mutationAuthorization(input.patterns);
  const evidence = evidenceIds(input.features);
  const requiredEvidence = requirementEvidence(input);
  const approvals = relevantApprovals(input, external.value, mutation);
  const packet = materializeTaskPacket({
    packet: {
      schema_version: "1.0.0",
      root: input.source.root,
      initiative_id: input.source.initiativeId,
      workstream_id: input.workstreamId,
      task_id: input.taskId,
      assignment: {
        assignee_id: input.source.workerId,
        issued_by: input.source.integratorId,
        issued_at: input.evaluatedAt,
      },
      patterns: {
        primary: { id: patternSet.outcomePrimary.id, version: patternSet.outcomePrimary.version },
        companions: patternSet.companions.map(({ id, version }) => ({ id, version })),
      },
      selector: {
        score: input.decision.winner?.score ?? 0,
        runner_up_score: input.decision.runner_up?.score ?? null,
        margin: input.decision.margin ?? 0,
        matched_signal_ids: [...(input.decision.winner?.matched_positive_ids ?? [])],
        evidence_ids: evidence,
      },
      goal: input.outcome.statement,
      scope: {
        inclusions: [...authorizedPaths],
        exclusions: [...(input.source.exclusionsByOutcome[input.outcome.id] ?? [])],
      },
      resolved_inputs: {
        record_ids: [...input.source.acceptedDecisionIds],
        artifact_refs: [...input.source.artifactRefs],
        original_base_revision: input.source.originalBaseRevision,
      },
      component_duties: componentDuties(input, evidence),
      domain_duties: domainDuties(input, evidence),
      decisions: {
        accepted_record_ids: [...input.source.acceptedDecisionIds],
        proposed_record_ids: [...input.source.proposedDecisionIds],
      },
      authorization: {
        mutation,
        task_result_submission: "worker",
        factual_integration: "integrator",
        workstream_activation: activationAuthority(input),
        directional_acceptance: "Pitaji",
        external_action: external.value,
      },
      approvals: approvals.map((approval) => structuredClone(approval)),
      required_outputs: unique(input.patterns.flatMap((pattern) => pattern.outputs)),
      required_evidence: requiredEvidence,
      gates: gates(input, external.value),
      memory_updates: {
        create_record_types: unique([
          ...input.patterns.flatMap((pattern) => pattern.memory_updates),
          ...input.impacts.impacts.flatMap((impact) => impact.requiredRecordTypes),
        ]),
        update_record_ids: [],
      },
      completion_conditions: unique([
        ...input.outcome.acceptanceCriteria,
        ...input.patterns.flatMap((pattern) => pattern.completion_conditions),
      ]),
      fallback_and_escalation: {
        triggers: unique(input.patterns.flatMap((pattern) => pattern.fallback_and_escalation)),
        owner: "integrator",
        allowed_fallbacks: ["submit-partial-completion", "request-scope-review"],
      },
    },
    claim: {
      issuer: input.source.integratorId,
      assignee_id: input.source.workerId,
      base_revision: input.source.originalBaseRevision,
      heartbeat_interval: input.source.heartbeatInterval,
      renewal_policy: input.source.renewalPolicy,
      status: "active",
      components: componentDuties(input, evidence).map((duty) => duty.component_id),
      repositories: [input.source.repository],
      paths: [...authorizedPaths],
      duties: unique(input.impacts.impacts.flatMap((impact) => impact.duties)),
      required_evidence: requiredEvidence,
      coordination_exception_approval_id: null,
    },
    claim_ttl_ms: input.source.claimTtlMs,
  }, clock, ids);
  return packet.ok
    ? success({ patternSet, assignments: assigned.value, packet: packet.value, coverage: coverage.value })
    : packet;
}
