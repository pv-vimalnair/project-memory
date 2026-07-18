const CREDENTIAL_KEY =
  "(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|secret|password|passwd|pwd)";

const DOUBLE_QUOTED_ASSIGNMENT = new RegExp(
  `((?:^|[^A-Za-z0-9_-])["']?${CREDENTIAL_KEY}["']?\\s*[:=]\\s*)"((?!\\[REDACTED:)(?:\\\\.|[^"\\\\])+)"`,
  "gimu",
);

const SINGLE_QUOTED_ASSIGNMENT = new RegExp(
  `((?:^|[^A-Za-z0-9_-])["']?${CREDENTIAL_KEY}["']?\\s*[:=]\\s*)'((?!\\[REDACTED:)(?:\\\\.|[^'\\\\])+)'`,
  "gimu",
);

const ESCAPED_DOUBLE_QUOTED_ASSIGNMENT = new RegExp(
  String.raw`((?:^|[^A-Za-z0-9_-])["']?${CREDENTIAL_KEY}["']?\s*[:=]\s*)\\"((?!\[REDACTED:)(?:(?!\\").)+)\\"`,
  "gimu",
);

const UNQUOTED_ASSIGNMENT = new RegExp(
  String.raw`((?:^|[^A-Za-z0-9_-])["']?${CREDENTIAL_KEY}["']?\s*[:=]\s*)((?!\[REDACTED:)[^\s,;}\]"'\\]+)`,
  "gimu",
);

type SecretReplacement = (secret: string) => string;

export function redactCredentialAssignments(
  text: string,
  replacement: SecretReplacement,
): string {
  let redacted = text.replace(
    ESCAPED_DOUBLE_QUOTED_ASSIGNMENT,
    (_match, prefix: string, secret: string) =>
      `${prefix}\\"${replacement(secret)}\\"`,
  );
  redacted = redacted.replace(
    DOUBLE_QUOTED_ASSIGNMENT,
    (_match, prefix: string, secret: string) =>
      `${prefix}"${replacement(secret)}"`,
  );
  redacted = redacted.replace(
    SINGLE_QUOTED_ASSIGNMENT,
    (_match, prefix: string, secret: string) =>
      `${prefix}'${replacement(secret)}'`,
  );
  return redacted.replace(
    UNQUOTED_ASSIGNMENT,
    (_match, prefix: string, secret: string) => `${prefix}${replacement(secret)}`,
  );
}