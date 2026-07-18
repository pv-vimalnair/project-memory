import { describe, expect, it } from "vitest";

import { redactArchiveBytes } from "../../src/governance/archive/redactor.js";

describe("credential assignment redaction", () => {
  it("redacts quoted assignments nested inside a JSON string", () => {
    const secret = "synthetic-test-secret";
    const source = new TextEncoder().encode(JSON.stringify({
      worker_attestation: `Diagnostic api_key="${secret}".`,
    }));

    const result = redactArchiveBytes(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = new TextDecoder().decode(result.value.bytes);
    expect(() => {
      void (JSON.parse(stored) as unknown);
    }).not.toThrow();
    expect(stored).not.toContain(secret);
    expect(stored).toContain("[REDACTED:credential-value:");
    expect(result.value.report).toMatchObject({
      redacted: true,
      rule_ids: ["credential-value"],
      replacement_count: 1,
    });
  });
});
