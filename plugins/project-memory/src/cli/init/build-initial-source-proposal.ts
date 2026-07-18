import { canonicalJson } from "../../core/canonical-json.js";
import { parseYamlDocument } from "../../core/document-io.js";
import { sha256 } from "../../core/hash.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const REQUIRED_FACTS = [
  "name",
  "mission",
  "namespace",
  "lifecycle",
  "owners",
  "runtime_adapters",
  "workflow_adapters",
  "success_criteria",
  "included_scope",
] as const;
const OPTIONAL_FACTS = ["excluded_scope"] as const;

export type InitialFactValue = string | readonly string[];

export interface InitialFactEvidence {
  readonly evidence_id: string;
  readonly source_kind: "brief" | "path";
  readonly source_ref: string;
  readonly source_sha256: string;
  readonly pointer: string;
  readonly source_text: string;
}

export type InitialSourceFact =
  | {
      readonly status: "evidenced";
      readonly value: InitialFactValue;
      readonly evidence: InitialFactEvidence;
    }
  | {
      readonly status: "unresolved";
      readonly value: null;
      readonly evidence: null;
    };

export interface InitialClarification {
  readonly kind: "required_facts";
  readonly question: string;
  readonly fields: readonly string[];
}

export interface InitialSourceProposal {
  readonly schema_version: "1.0.0";
  readonly facts: Readonly<Record<string, InitialSourceFact>>;
  readonly unresolved_required_facts: readonly string[];
  readonly clarification: InitialClarification | null;
}

export interface BuildInitialSourceProposalInput {
  readonly root: URL;
  readonly brief_path: string;
  readonly brief_text: string;
  readonly observable_paths?: readonly string[];
}

export function deterministicInstanceId(prefix: string, seed: string): string {
  let value = BigInt(`0x${sha256(seed).slice(0, 32)}`);
  let encoded = "";
  for (let index = 0; index < 26; index += 1) {
    encoded = `${CROCKFORD[Number(value & 31n)] ?? "0"}${encoded}`;
    value >>= 5n;
  }
  return `${prefix}-${encoded}`;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function factValue(value: unknown): InitialFactValue | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  ) {
    return [...new Set(value.map((item) => (item as string).trim()))];
  }
  return null;
}

function sourceText(value: InitialFactValue): string {
  return typeof value === "string" ? value : canonicalJson(value);
}

export function buildInitialSourceProposal(
  input: BuildInitialSourceProposalInput,
): RuntimeResult<InitialSourceProposal> {
  if (input.root.protocol !== "file:") {
    return failure("INIT_ROOT_INVALID", "initialization root must be a file URL");
  }
  const parsed = parseYamlDocument(input.brief_text, input.brief_path);
  if (!parsed.ok) return parsed;
  const brief = record(parsed.value);
  if (brief === null) {
    return failure("INIT_BRIEF_INVALID", "initialization brief must contain an object", input.brief_path);
  }
  const digest = sha256(new TextEncoder().encode(input.brief_text));
  const facts: Record<string, InitialSourceFact> = {};
  for (const name of [...REQUIRED_FACTS, ...OPTIONAL_FACTS]) {
    const value = factValue(brief[name]);
    if (value === null) {
      facts[name] = { status: "unresolved", value: null, evidence: null };
      continue;
    }
    facts[name] = {
      status: "evidenced",
      value,
      evidence: {
        evidence_id: deterministicInstanceId("EVD", `${input.root.href}\u0000${input.brief_path}\u0000${name}\u0000${digest}`),
        source_kind: "brief",
        source_ref: input.brief_path,
        source_sha256: digest,
        pointer: `/${name}`,
        source_text: sourceText(value),
      },
    };
  }
  const unresolved = REQUIRED_FACTS.filter((name) => facts[name]?.status === "unresolved");
  return success({
    schema_version: "1.0.0",
    facts,
    unresolved_required_facts: unresolved,
    clarification: unresolved.length === 0
      ? null
      : {
          kind: "required_facts",
          question: `Please provide the missing initialization facts together: ${unresolved.join(", ")}.`,
          fields: unresolved,
        },
  });
}
