import { canonicalJson, type PlannedWrite } from "../../index.js";

import type { CanonicalRecord, RECORD_TYPES } from "../contracts/index.js";

export type CanonicalRecordType = (typeof RECORD_TYPES)[number];

export const RECORD_DIRECTORIES = Object.freeze({
  decision: "decisions",
  idea: "ideas",
  change: "changes",
  finding: "findings",
  risk: "risks",
  evidence: "evidence",
  lesson: "lessons",
  approval: "approvals",
} as const satisfies Record<CanonicalRecordType, string>);

export function canonicalRecordPath(record: CanonicalRecord): string {
  return `docs/project-memory/records/${RECORD_DIRECTORIES[record.type as CanonicalRecordType]}/${record.id}.json`;
}

export function recordWrite(record: CanonicalRecord): PlannedWrite {
  return {
    relative_path: canonicalRecordPath(record),
    bytes: new TextEncoder().encode(canonicalJson(record)),
    expected_existing_sha256: null,
    mode: "create",
  };
}
