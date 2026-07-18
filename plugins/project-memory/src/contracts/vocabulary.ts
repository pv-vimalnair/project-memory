export const ROOT_KIND_VALUES = Object.freeze([
  "product",
  "shared-system",
  "program",
  "portfolio",
  "engagement",
] as const);

export const PRIMARY_ARCHETYPE_VALUES = Object.freeze([
  "application-service",
  "developer-platform",
  "game-interactive",
  "ai-data",
  "commerce-network",
  "content-learning",
  "brand-design",
  "research-knowledge",
  "operations-automation",
  "portfolio",
  "engagement",
] as const);

export const PATTERN_MODE_VALUES = Object.freeze([
  "assess",
  "plan",
  "design",
  "implement",
  "change",
  "validate",
  "release",
  "operate",
  "retire",
] as const);

export const PATTERN_FAMILY_IDS = Object.freeze([
  "governance",
  "product",
  "engineering",
  "ux",
  "security",
  "qa",
  "data",
  "growth",
  "content",
  "research",
  "release",
  "support",
  "game",
  "ai",
  "commerce",
  "enterprise",
] as const);

export const SELECTION_DISPOSITION_VALUES = Object.freeze([
  "automatic",
  "integrator_review",
  "clarification_required",
] as const);

export const PATTERN_ID_PATTERN = `^(?:${PATTERN_FAMILY_IDS.join("|")})[.][a-z][a-z0-9-]*[.](?:${PATTERN_MODE_VALUES.join("|")})$`;

export type RootKindValue = (typeof ROOT_KIND_VALUES)[number];
export type PrimaryArchetypeValue = (typeof PRIMARY_ARCHETYPE_VALUES)[number];
export type PatternModeValue = (typeof PATTERN_MODE_VALUES)[number];
export type PatternFamilyId = (typeof PATTERN_FAMILY_IDS)[number];
export type SelectionDispositionValue =
  (typeof SELECTION_DISPOSITION_VALUES)[number];
