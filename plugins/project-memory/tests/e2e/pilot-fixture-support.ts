import { cp, readFile, readdir } from "node:fs/promises";

import type { Approval, TaskPacket } from "../../src/planning/types.js";
import { makeValidTaskPacket } from "../fixtures/selection/runtime-packet-fixtures.js";
import {
  PILOT_EVIDENCE_ID,
  PILOT_EXTERNAL_APPROVAL_ID,
} from "./pilot-records.js";
import type {
  ExternalActionResult,
  PilotProfile,
  ProductRootPilotInput,
} from "./pilot-types.js";

interface TaskPacketBindings {
  readonly root_id: string;
  readonly profile_lock_hash: string;
  readonly base_revision: string;
  readonly now: Date;
  readonly issued_by: string;
}

export interface InspectedPilotFixture {
  readonly paths: readonly string[];
  readonly sensitive_findings: readonly string[];
  readonly profile: PilotProfile;
}

function first<T>(values: readonly T[], label: string): T {
  const value = values[0];
  if (value === undefined) throw new Error(`${label} missing`);
  return value;
}

async function fixturePaths(root: URL, prefix = ""): Promise<string[]> {
  const paths: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) throw new Error(`pilot fixture symlink forbidden: ${entry.name}`);
    const relativePath = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      paths.push(...await fixturePaths(new URL(`${entry.name}/`, root), `${relativePath}/`));
    } else if (entry.isFile()) {
      paths.push(relativePath);
    }
  }
  return paths;
}

export async function inspectPilotFixture(root: URL): Promise<InspectedPilotFixture> {
  const paths = await fixturePaths(root);
  const pattern = /BEGIN (?:RSA |EC )?PRIVATE KEY|api[_-]?key\s*[:=]|password\s*[:=]|(?:sk|AIza)[A-Za-z0-9_-]{16,}/iu;
  const findings: string[] = [];
  for (const relativePath of paths) {
    const text = await readFile(new URL(relativePath, root), "utf8");
    if (pattern.test(text)) findings.push(relativePath);
  }
  return {
    paths,
    sensitive_findings: findings,
    profile: JSON.parse(
      await readFile(new URL("pilot-profile.json", root), "utf8"),
    ) as PilotProfile,
  };
}

export async function copyPilotFixture(source: URL, target: URL): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`pilot fixture symlink forbidden: ${entry.name}`);
    const suffix = entry.isDirectory() ? "/" : "";
    await cp(
      new URL(`${entry.name}${suffix}`, source),
      new URL(`${entry.name}${suffix}`, target),
      { recursive: entry.isDirectory(), errorOnExist: true, force: false },
    );
  }
}

function externalApproval(now: Date): Approval {
  return {
    id: PILOT_EXTERNAL_APPROVAL_ID,
    kind: "external",
    granted_by: "Pitaji",
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60 * 60_000).toISOString(),
    target: "production campaign",
    environment: "production",
    scope: ["campaign.launch"],
    timing: "once",
    invalidation_conditions: ["target-change", "scope-change"],
  };
}

export function createPilotTaskPacket(
  input: ProductRootPilotInput,
  bindings: TaskPacketBindings,
): TaskPacket {
  const packet = makeValidTaskPacket();
  packet.packet_id = input.packet_id;
  packet.root = {
    ...packet.root,
    id: bindings.root_id,
    profile_lock_hash: bindings.profile_lock_hash,
  };
  packet.initiative_id = input.initiative_id;
  packet.workstream_id = input.workstream_id;
  packet.task_id = input.task_id;
  packet.goal = input.goal;
  packet.scope = { inclusions: [input.scope_glob], exclusions: [] };
  packet.assignment = {
    ...packet.assignment,
    issued_by: bindings.issued_by,
    issued_at: bindings.now.toISOString(),
  };
  packet.resolved_inputs = {
    ...packet.resolved_inputs,
    original_base_revision: bindings.base_revision,
  };
  packet.selector = { ...packet.selector, evidence_ids: [PILOT_EVIDENCE_ID] };
  const duty = first(packet.component_duties, "component duty");
  packet.component_duties = [{
    ...duty,
    read_scope: [input.scope_glob],
    write_scope: [input.scope_glob],
    resolution: {
      ...duty.resolution,
      evidence_ids: [PILOT_EVIDENCE_ID],
      evaluated_at: bindings.now.toISOString(),
    },
  }];
  packet.claim = {
    ...packet.claim,
    id: input.claim_id,
    base_revision: bindings.base_revision,
    issued_at: bindings.now.toISOString(),
    expires_at: new Date(bindings.now.getTime() + 15 * 60_000).toISOString(),
    last_heartbeat_at: bindings.now.toISOString(),
    repositories: [input.fixture],
    paths: [input.scope_glob],
  };
  if (input.external_action) {
    const approval = externalApproval(bindings.now);
    packet.approvals = [approval];
    packet.authorization.external_action = {
      allowed: true,
      approval_ids: [approval.id],
      target: approval.target,
      environment: approval.environment,
      scope: [...approval.scope],
      timing: approval.timing,
    };
  } else {
    packet.approvals = [];
    packet.authorization.external_action = {
      allowed: false,
      approval_ids: [],
      target: null,
      environment: null,
      scope: [],
      timing: null,
    };
  }
  return packet;
}

export function externalActionResult(packet: TaskPacket): ExternalActionResult {
  const action = packet.authorization.external_action;
  if (!action.allowed) return { allowed: false, approval_ids: [], executed: false };
  if (
    action.target === null || action.environment === null || action.timing === null ||
    action.approval_ids.length !== 1
  ) {
    throw new Error("external action lacks exact approval bindings");
  }
  return {
    allowed: true,
    approval_ids: action.approval_ids,
    executed: false,
    target: action.target,
    environment: action.environment,
    scope: action.scope,
    timing: action.timing,
  };
}
