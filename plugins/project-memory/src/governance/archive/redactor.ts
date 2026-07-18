import {
  decodeStrictUtf8,
  failure,
  sha256,
  success,
  type RuntimeResult,
} from "../../index.js";

import { redactCredentialAssignments } from "./credential-assignment-redactor.js";

export interface ArchiveRedactionReport {
  readonly redacted: boolean;
  readonly rule_ids: string[];
  readonly replacement_count: number;
  readonly review_required: false;
}

export interface RedactedArchiveObject {
  readonly bytes: Uint8Array;
  readonly report: ArchiveRedactionReport;
}

interface RedactionState {
  readonly ruleIds: Set<string>;
  replacementCount: number;
}

const PRIVATE_KEY_BLOCK =
  /-----BEGIN ((?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY)-----[\s\S]*?-----END \1-----/gu;
const PRIVATE_KEY_MARKER =
  /-----(?:BEGIN|END) (?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----/u;
const URI_CREDENTIAL =
  /\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/giu;
const BEARER_TOKEN = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]+)/giu;

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function redactionReplacement(ruleId: string, secret: string): string {
  return `[REDACTED:${ruleId}:${sha256(secret).slice(0, 12)}]`;
}

function replaceSecret(
  state: RedactionState,
  ruleId: string,
  secret: string,
): string {
  state.ruleIds.add(ruleId);
  state.replacementCount += 1;
  return redactionReplacement(ruleId, secret);
}

function redactPem(text: string, state: RedactionState): string {
  return text.replace(PRIVATE_KEY_BLOCK, (secret) =>
    replaceSecret(state, "pem-private-key", secret),
  );
}

function redactUriCredentials(text: string, state: RedactionState): string {
  return text.replace(
    URI_CREDENTIAL,
    (_match, prefix: string, secret: string, suffix: string) =>
      `${prefix}${replaceSecret(state, "uri-credential", secret)}${suffix}`,
  );
}

function redactAssignments(text: string, state: RedactionState): string {
  return redactCredentialAssignments(text, (secret) =>
    replaceSecret(state, "credential-value", secret),
  );
}

function redactBearerTokens(text: string, state: RedactionState): string {
  return text.replace(
    BEARER_TOKEN,
    (_match, prefix: string, secret: string) =>
      `${prefix}${replaceSecret(state, "bearer-token", secret)}`,
  );
}

export function redactArchiveBytes(
  bytes: Uint8Array,
): RuntimeResult<RedactedArchiveObject> {
  const decoded = decodeStrictUtf8(bytes, "archive-object");
  if (!decoded.ok) {
    return failure(
      "archive.review_required",
      "archive bytes cannot be safely redacted without valid UTF-8 text",
      "archive-object",
      decoded.issues.map((issue) => issue.code),
    );
  }
  if (decoded.value.includes("\u0000")) {
    return failure(
      "archive.review_required",
      "archive bytes contain binary separators and require explicit review",
      "archive-object",
    );
  }

  const state: RedactionState = { ruleIds: new Set(), replacementCount: 0 };
  let redacted = redactPem(decoded.value, state);
  if (PRIVATE_KEY_MARKER.test(redacted)) {
    return failure(
      "archive.review_required",
      "private-key material could not be bounded without destroying meaning",
      "archive-object",
      ["pem-private-key"],
    );
  }
  redacted = redactUriCredentials(redacted, state);
  redacted = redactAssignments(redacted, state);
  redacted = redactBearerTokens(redacted, state);

  return success({
    bytes: new TextEncoder().encode(redacted),
    report: {
      redacted: state.replacementCount > 0,
      rule_ids: [...state.ruleIds].sort(compareUtf8),
      replacement_count: state.replacementCount,
      review_required: false,
    },
  });
}
