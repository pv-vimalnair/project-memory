export const INSTANCE_PREFIXES = [
  "ROOT",
  "CMP",
  "DOM",
  "INIT",
  "WS",
  "TASK",
  "CLAIM",
  "PKT",
  "DEC",
  "IDEA",
  "CHG",
  "FIND",
  "RISK",
  "EVD",
  "LESSON",
  "APR",
] as const;

export type InstancePrefix = (typeof INSTANCE_PREFIXES)[number];

const INSTANCE_PREFIX_SET: ReadonlySet<string> = new Set(INSTANCE_PREFIXES);

export function isInstancePrefix(value: string): value is InstancePrefix {
  return INSTANCE_PREFIX_SET.has(value);
}

export const INSTANCE_ID_PATTERN = new RegExp(
  `^(?:${INSTANCE_PREFIXES.join("|")})-[0-9A-HJKMNP-TV-Z]{26}$`,
);
