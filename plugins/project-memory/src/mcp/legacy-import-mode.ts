import type {
  LegacyFactCategory,
  LegacySourceReviewDraft,
} from "../import/contracts.js";

export const LEGACY_FACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_line_start",
    "source_line_end",
    "category",
    "title",
    "statement",
    "rationale",
    "confidence",
  ],
  properties: {
    source_line_start: { type: "integer", minimum: 1 },
    source_line_end: { type: "integer", minimum: 1 },
    category: {
      enum: [
        "completed_work",
        "current_decision",
        "constraint",
        "next_action",
        "idea",
        "risk",
        "finding",
        "removed",
        "rejected",
        "superseded",
        "lesson",
      ],
    },
    title: { type: "string", minLength: 1 },
    statement: { type: "string", minLength: 1 },
    rationale: { type: "string", minLength: 1 },
    confidence: { enum: ["high", "medium", "low"] },
  },
} as const;

export const LEGACY_SOURCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_path",
    "source_sha256",
    "disposition",
    "rationale",
    "facts",
  ],
  properties: {
    source_path: { type: "string", minLength: 1 },
    source_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
    source_git_revision: {
      type: ["string", "null"],
      pattern: "^[0-9a-f]{40}$",
    },
    disposition: { enum: ["import", "archive", "reject", "unresolved"] },
    rationale: { type: "string", minLength: 1 },
    facts: { type: "array", items: LEGACY_FACT_SCHEMA },
  },
} as const;

const LEGACY_CATEGORIES = new Set<LegacyFactCategory>([
  "completed_work",
  "current_decision",
  "constraint",
  "next_action",
  "idea",
  "risk",
  "finding",
  "removed",
  "rejected",
  "superseded",
  "lesson",
]);
const LEGACY_DISPOSITIONS = new Set<LegacySourceReviewDraft["disposition"]>([
  "import",
  "archive",
  "reject",
  "unresolved",
]);
const LEGACY_CONFIDENCE = new Set(["high", "medium", "low"] as const);

export class LegacyImportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyImportInputError";
  }
}

function invalid(message: string): never {
  throw new LegacyImportInputError(message);
}

function objectValue(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function onlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected !== undefined) invalid(`${label} contains unsupported field ${unexpected}`);
}

function stringValue(value: unknown, label: string): string {
  return typeof value === "string" && value.length > 0
    ? value
    : invalid(`${label} must be a non-empty string`);
}

function integerValue(value: unknown, label: string): number {
  return Number.isInteger(value) && (value as number) >= 1
    ? value as number
    : invalid(`${label} must be a positive integer`);
}

function memberValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string,
): T {
  return typeof value === "string" && allowed.has(value as T)
    ? value as T
    : invalid(`${label} is unsupported`);
}

export function parseLegacySourceReviews(
  value: unknown,
): readonly LegacySourceReviewDraft[] {
  if (!Array.isArray(value)) return invalid("sources must be an array");
  return value.map((rawSource, sourceIndex) => {
    const label = `sources[${String(sourceIndex)}]`;
    const source = objectValue(rawSource, label);
    onlyKeys(source, new Set([
      "source_path",
      "source_sha256",
      "source_git_revision",
      "disposition",
      "rationale",
      "facts",
    ]), label);
    if (!Array.isArray(source.facts)) return invalid(`${label}.facts must be an array`);
    const facts = source.facts.map((rawFact, factIndex) => {
      const factLabel = `${label}.facts[${String(factIndex)}]`;
      const fact = objectValue(rawFact, factLabel);
      onlyKeys(fact, new Set([
        "source_line_start",
        "source_line_end",
        "category",
        "title",
        "statement",
        "rationale",
        "confidence",
      ]), factLabel);
      return {
        source_line_start: integerValue(fact.source_line_start, `${factLabel}.source_line_start`),
        source_line_end: integerValue(fact.source_line_end, `${factLabel}.source_line_end`),
        category: memberValue(fact.category, LEGACY_CATEGORIES, `${factLabel}.category`),
        title: stringValue(fact.title, `${factLabel}.title`),
        statement: stringValue(fact.statement, `${factLabel}.statement`),
        rationale: stringValue(fact.rationale, `${factLabel}.rationale`),
        confidence: memberValue(fact.confidence, LEGACY_CONFIDENCE, `${factLabel}.confidence`),
      };
    });
    const revision = source.source_git_revision;
    if (revision !== undefined && revision !== null && typeof revision !== "string") {
      return invalid(`${label}.source_git_revision must be a string or null`);
    }
    return {
      source_path: stringValue(source.source_path, `${label}.source_path`),
      source_sha256: stringValue(source.source_sha256, `${label}.source_sha256`),
      ...(revision === undefined ? {} : { source_git_revision: revision }),
      disposition: memberValue(
        source.disposition,
        LEGACY_DISPOSITIONS,
        `${label}.disposition`,
      ),
      rationale: stringValue(source.rationale, `${label}.rationale`),
      facts,
    };
  });
}
