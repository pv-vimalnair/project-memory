import { beforeEach, describe, expect, it } from "vitest";

import {
  PROJECT_SCHEMA_REGISTRARS,
  registerProjectSchemas,
} from "../../src/index.js";
import { validateCompletionPacket } from "../../src/planning/validate-completion-packet.js";
import type {
  CompletionPacket,
  CompletionValidationContext,
  TaskPacket,
} from "../../src/planning/types.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import {
  makeValidCompletionPacket,
  makeValidTaskPacket,
} from "../fixtures/selection/runtime-fixtures.js";

function context(
  task: TaskPacket,
  overrides: Partial<CompletionValidationContext> = {},
): CompletionValidationContext {
  return {
    currentBaseRevision: task.claim.base_revision,
    availableEvidenceIds: ["EVD-01J00000000000000000000001"],
    approvedExceptionIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

describe("completion packet validation", () => {
  it("accepts a linked factual completion", () => {
    const task = makeValidTaskPacket();
    const completion = makeValidCompletionPacket(task);
    expect(
      validateCompletionPacket(completion, task, context(task)),
    ).toMatchObject({
      ok: true,
      value: {
        checkedGateIds: ["gate.regression"],
        evidenceIds: ["EVD-01J00000000000000000000001"],
      },
    });
  });

  it("does not let a completion packet grant acceptance", () => {
    const task = makeValidTaskPacket();
    const expanded = {
      ...makeValidCompletionPacket(task),
      accepted_decision_ids: ["DEC-01J00000000000000000000001"],
    } as unknown as CompletionPacket;
    expect(
      validateCompletionPacket(expanded, task, context(task)),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "completion.authority_expansion" }],
    });
  });

  it("rejects passed gates whose evidence is unavailable", () => {
    const task = makeValidTaskPacket();
    expect(
      validateCompletionPacket(
        makeValidCompletionPacket(task),
        task,
        context(task, { availableEvidenceIds: [] }),
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "completion.evidence_missing" }],
    });
  });

  it("rejects a failed required gate", () => {
    const task = makeValidTaskPacket();
    const completion = makeValidCompletionPacket(task);
    const check = completion.checks[0];
    if (check === undefined) throw new Error("missing check");
    completion.checks = [
      { ...check, status: "failed", exact_result: "1 test failed" },
    ];
    expect(
      validateCompletionPacket(completion, task, context(task)),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "completion.gate_failed" }],
    });
  });

  it("blocks a not-run required gate without an applicable exception", () => {
    const task = makeValidTaskPacket();
    const completion = makeValidCompletionPacket(task);
    const check = completion.checks[0];
    if (check === undefined) throw new Error("missing check");
    completion.checks = [
      {
        ...check,
        status: "not_run",
        exact_result: "Not run",
        evidence_id: null,
        not_run_reason: "Environment unavailable",
      },
    ];
    expect(
      validateCompletionPacket(completion, task, context(task)),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "completion.required_gate_not_run" }],
    });
  });

  it("allows a not-run required gate only with an explicit exception", () => {
    const task = makeValidTaskPacket();
    const completion = makeValidCompletionPacket(task);
    const check = completion.checks[0];
    if (check === undefined) throw new Error("missing check");
    const exception = "APR-01J00000000000000000000009";
    completion.checks = [
      {
        ...check,
        status: "not_run",
        exact_result: "Not run under approved exception",
        evidence_id: null,
        not_run_reason: `Approved exception ${exception}`,
      },
    ];
    expect(
      validateCompletionPacket(
        completion,
        task,
        context(task, { approvedExceptionIds: [exception] }),
      ).ok,
    ).toBe(true);
  });

  it("rejects changed files outside the exact task scope", () => {
    const task = makeValidTaskPacket();
    const completion = makeValidCompletionPacket(task);
    const change = completion.changes[0];
    if (change === undefined) throw new Error("missing change");
    completion.changes = [{ ...change, files: ["firebase/functions.ts"] }];
    expect(
      validateCompletionPacket(completion, task, context(task)),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "completion.scope_exceeded" }],
    });
  });

  it("rejects missing required outputs", () => {
    const task = makeValidTaskPacket();
    const completion = makeValidCompletionPacket(task);
    completion.outputs = [];
    expect(
      validateCompletionPacket(completion, task, context(task)),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "completion.output_missing" }],
    });
  });
});
