import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  FixedClock,
  NodeCommandRunner,
  failure,
  sha256,
  success,
} from "../../src/index.js";
import {
  createGateRunner,
  type ExternalCheckApprovalValidator,
} from "../../src/governance/integration/gate-runner.js";
import type {
  ResolvedGateExecution,
} from "../../src/planning/types.js";

const NOW = new Date("2026-07-15T08:00:00.000Z");
const APPROVAL_ID = "APR-01J00000000000000000000001";
const EVIDENCE_ID = "EVD-01J00000000000000000000001";
const root = new URL("../fixtures/governance/gates/", import.meta.url);
const echoArgsScript = fileURLToPath(new URL(
  "../fixtures/governance/gates/echo-args.mjs",
  import.meta.url,
));
const emitSecretScript = fileURLToPath(new URL(
  "../fixtures/governance/gates/emit-secret.mjs",
  import.meta.url,
));

const commandGateContractExample = {
  id: "gate.regression",
  definition_ref: "adapter.flutter.test@1.0.0",
  type: "test",
  command_or_check: "Run the resolved regression command",
  required: true,
  conflict_sensitive: true,
  evidence_type: "test-result",
  execution: {
    kind: "command",
    executable: process.execPath,
    args: [echoArgsScript],
    cwd: ".",
    timeout_ms: 5_000,
    env_allowlist: {},
  },
} satisfies ResolvedGateExecution;

const externalCheckGateContractExample = {
  id: "gate.release-review",
  definition_ref: "adapter.release.human-review@1.0.0",
  type: "external",
  command_or_check: "Verify the production release checklist",
  required: true,
  conflict_sensitive: true,
  evidence_type: "human-verification",
  execution: {
    kind: "check",
    instruction: "Verify the production release checklist against the prepared commit.",
    verifier_role: "external",
    approval_refs: [APPROVAL_ID],
  },
} satisfies ResolvedGateExecution;

function runner(options: {
  readonly maxOutputBytes?: number;
  readonly approvalValidator?: ExternalCheckApprovalValidator;
} = {}) {
  return createGateRunner({
    clock: new FixedClock(NOW),
    runner: new NodeCommandRunner(),
    ...(options.maxOutputBytes === undefined
      ? {}
      : { max_output_bytes: options.maxOutputBytes }),
    ...(options.approvalValidator === undefined
      ? {}
      : { external_approval_validator: options.approvalValidator }),
  });
}

function commandGate(
  execution: Extract<ResolvedGateExecution["execution"], { kind: "command" }>,
): ResolvedGateExecution {
  return { ...commandGateContractExample, execution };
}

function submittedCheck(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    gate_id: externalCheckGateContractExample.id,
    verifier_role: "external",
    evidence_type: externalCheckGateContractExample.evidence_type,
    status: "passed" as const,
    exact_result: "Release checklist verified",
    evidence_ids: [EVIDENCE_ID],
    approval_refs: [APPROVAL_ID],
    occurred_at: NOW.toISOString(),
    ...overrides,
  };
}

describe("structured command gates", () => {
  it("passes metacharacters as literal arguments without a registry lookup", async () => {
    const result = await runner().run(root, commandGate({
      kind: "command",
      executable: process.execPath,
      args: [echoArgsScript, "a;b", "$HOME", "x&y"],
      cwd: ".",
      timeout_ms: 5_000,
      env_allowlist: {},
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("passed");
      expect(JSON.parse(result.value.stdout_redacted)).toEqual([
        "a;b",
        "$HOME",
        "x&y",
      ]);
      expect(result.value.definition_ref).toBe(
        commandGateContractExample.definition_ref,
      );
    }
  });

  it("times out a long-running command", async () => {
    const result = await runner().run(root, commandGate({
      kind: "command",
      executable: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10_000)"],
      cwd: ".",
      timeout_ms: 50,
      env_allowlist: {},
    }));

    expect(result).toMatchObject({
      ok: true,
      value: { status: "failed", exit_code: null },
    });
  });

  it("bounds persisted output and hashes the exact captured bytes", async () => {
    const result = await runner({ maxOutputBytes: 64 }).run(root, commandGate({
      kind: "command",
      executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(4096))"],
      cwd: ".",
      timeout_ms: 5_000,
      env_allowlist: {},
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Buffer.byteLength(result.value.stdout_redacted)).toBe(64);
      expect(result.value.stdout_sha256).toBe(sha256("x".repeat(64)));
    }
  });

  it("passes only the packet-owned environment allowlist", async () => {
    const result = await runner().run(root, commandGate({
      kind: "command",
      executable: process.execPath,
      args: [
        "-e",
        "process.stdout.write(JSON.stringify({allowed:process.env.GATE_ALLOWED??null,blocked:process.env.GATE_BLOCKED??null}))",
      ],
      cwd: ".",
      timeout_ms: 5_000,
      env_allowlist: { GATE_ALLOWED: "yes" },
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.value.stdout_redacted)).toEqual({
        allowed: "yes",
        blocked: null,
      });
    }
  });

  it("redacts command output while retaining the original result hash", async () => {
    const secret = "synthetic-test-secret";
    const result = await runner().run(root, commandGate({
      kind: "command",
      executable: process.execPath,
      args: [emitSecretScript],
      cwd: ".",
      timeout_ms: 5_000,
      env_allowlist: { GATE_SECRET: secret },
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stdout_redacted).not.toContain(secret);
      expect(result.value.stdout_redacted).toContain(
        "[REDACTED:credential-value:",
      );
      expect(result.value.stdout_sha256).toBe(sha256(`api_key=${secret}\n`));
    }
  });

  it("rejects a command cwd that escapes the repository", async () => {
    const result = await runner().run(root, commandGate({
      kind: "command",
      executable: process.execPath,
      args: [echoArgsScript],
      cwd: "../",
      timeout_ms: 5_000,
      env_allowlist: {},
    }));

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "gate.cwd_invalid" }],
    });
  });
});

describe("submitted verifier checks", () => {
  it("blocks a required check when verifier evidence is absent", async () => {
    const result = await runner().run(root, externalCheckGateContractExample);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "gate.required_check_not_run" }],
    });
  });

  it("rejects submitted evidence of the wrong packet-owned evidence type", async () => {
    const result = await runner().run(
      root,
      externalCheckGateContractExample,
      submittedCheck({ evidence_type: "screenshot" }),
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "gate.evidence_type_mismatch" }],
    });
  });

  it("requires the exact packet verifier role and approval refs", async () => {
    const wrongRole = await runner().run(
      root,
      externalCheckGateContractExample,
      submittedCheck({ verifier_role: "worker" }),
    );
    expect(wrongRole).toMatchObject({
      ok: false,
      issues: [{ code: "gate.verifier_role_mismatch" }],
    });

    const wrongApprovals = await runner().run(
      root,
      externalCheckGateContractExample,
      submittedCheck({ approval_refs: [] }),
    );
    expect(wrongApprovals).toMatchObject({
      ok: false,
      issues: [{ code: "gate.approval_refs_mismatch" }],
    });
  });

  it("accepts external evidence only after authority approval validation", async () => {
    const validate = vi.fn(() => Promise.resolve(success([APPROVAL_ID] as const)));
    const approvalValidator: ExternalCheckApprovalValidator = { validate };
    const result = await runner({ approvalValidator }).run(
      root,
      externalCheckGateContractExample,
      submittedCheck(),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "passed",
        verifier_role: "external",
        evidence_type: "human-verification",
        evidence_ids: [EVIDENCE_ID],
        approval_refs: [APPROVAL_ID],
      },
    });
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it("fails closed when external approval authority rejects the evidence", async () => {
    const approvalValidator: ExternalCheckApprovalValidator = {
      validate: () => Promise.resolve(failure(
        "authority.external_approval_required",
        "approval is not current",
      )),
    };
    const result = await runner({ approvalValidator }).run(
      root,
      externalCheckGateContractExample,
      submittedCheck(),
    );

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "authority.external_approval_required" }],
    });
  });

  it("records an optional missing check as not_run with a reason", async () => {
    const optionalGate: ResolvedGateExecution = {
      ...externalCheckGateContractExample,
      required: false,
      execution: {
        ...externalCheckGateContractExample.execution,
        verifier_role: "worker",
        approval_refs: [],
      },
    };
    const result = await runner().run(root, optionalGate);

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "not_run",
        not_run_reason: "submitted verifier evidence was not provided",
      },
    });
  });
  it("validates packet bindings on optional submitted not_run evidence", async () => {
    const optionalGate: ResolvedGateExecution = {
      ...externalCheckGateContractExample,
      required: false,
      execution: {
        ...externalCheckGateContractExample.execution,
        verifier_role: "worker",
        approval_refs: [],
      },
    };
    const result = await runner().run(
      root,
      optionalGate,
      submittedCheck({
        status: "not_run",
        verifier_role: "worker",
        approval_refs: [],
        evidence_type: "screenshot",
        exact_result: "device lab was unavailable",
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "gate.evidence_type_mismatch" }],
    });
  });
});
