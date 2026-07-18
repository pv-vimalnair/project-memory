import path from "node:path";

import type {
  LegacyDocumentRole,
  SensitivityFinding,
} from "./contracts.js";

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

export function classifyLegacyDocument(relativePath: string): readonly LegacyDocumentRole[] {
  const name = path.posix.basename(relativePath).toUpperCase();
  const roles = new Set<LegacyDocumentRole>();
  if (name.includes("PRD")) roles.add("prd");
  if (name.includes("REQUIREMENT")) roles.add("requirements");
  if (name.includes("HANDOFF")) roles.add("handoff");
  if (name.includes("CHANGELOG")) roles.add("changelog");
  if (name.includes("DECISION") || name.includes("ADR")) roles.add("decision-log");
  if (name.includes("TODO") || name.includes("TASK")) roles.add("task-list");
  if (name === "AGENTS.MD" || name === "CLAUDE.MD") roles.add("agent-instructions");
  if (name === "README.MD") roles.add("readme");
  if (roles.size === 0) roles.add("unknown");
  return [...roles].sort(compareUtf8);
}

export function findSensitivity(text: string): readonly SensitivityFinding[] {
  const findings: SensitivityFinding[] = [];
  const patterns = [
    { kind: "credential-pattern" as const, pattern: /AKIA[0-9A-Z]{16}/, message: "AWS-style access key pattern" },
    { kind: "private-key" as const, pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, message: "private key header" },
    { kind: "personal-data" as const, pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, message: "email address" },
  ];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const candidate of patterns) {
      if (candidate.pattern.test(line)) {
        findings.push({ kind: candidate.kind, line: index + 1, message: candidate.message });
      }
    }
  }
  return findings;
}
