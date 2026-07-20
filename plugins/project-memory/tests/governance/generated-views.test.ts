import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { AGENT_READING_ORDER_PREFIX } from "../../src/agent/index.js";
import {
  PROJECT_SCHEMA_REGISTRARS,
  canonicalMutationPlanHash,
  registerProjectSchemas,
  sha256,
} from "../../src/index.js";
import {
  GENERATED_VIEW_PATHS,
  createViewGenerator,
} from "../../src/governance/views/generate-views.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import {
  CountingClock,
  MutableSnapshotProvider,
  viewSnapshotFixture,
} from "./view-test-fixture.js";

const GENERATED_AT = new Date("2026-07-14T14:00:00.000Z");

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

describe("deterministic generated views", () => {
  it("renders all six replacement-mode views with one clock read", () => {
    const snapshot = viewSnapshotFixture();
    const clock = new CountingClock(GENERATED_AT);
    const result = createViewGenerator({
      clock,
      snapshots: new MutableSnapshotProvider(snapshot),
    }).plan(snapshot);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(clock.calls).toBe(1);
    expect(result.value.writes.map((write) => write.relative_path)).toEqual(
      GENERATED_VIEW_PATHS,
    );
    expect(result.value.writes.every((write) => write.mode === "create_or_replace")).toBe(
      true,
    );
    expect(result.value.metadata.generated_views).toHaveLength(6);
    for (const [index, write] of result.value.writes.entries()) {
      expect(result.value.metadata.generated_views[index]?.content_hash).toBe(
        sha256(write.bytes),
      );
    }
    const { plan_hash: planHash, ...withoutHash } = result.value;
    expect(planHash).toBe(canonicalMutationPlanHash(withoutHash));
  });

  it("matches the six checked-in golden view bytes", async () => {
    const snapshot = viewSnapshotFixture();
    const result = createViewGenerator({
      clock: new CountingClock(GENERATED_AT),
      snapshots: new MutableSnapshotProvider(snapshot),
    }).plan(snapshot);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const fixtureRoot = new URL(
      "../fixtures/governance/views/expected/",
      import.meta.url,
    );
    for (const write of result.value.writes) {
      const fixture = new URL(path.posix.basename(write.relative_path), fixtureRoot);
      if (process.env.UPDATE_VIEW_GOLDENS === "1") {
        await mkdir(fixtureRoot, { recursive: true });
        await writeFile(fixture, write.bytes);
      }
      const expected = await readFile(fixture);
      expect(Buffer.from(write.bytes)).toEqual(expected);
    }
  });

  it("renders the canonical five-file startup prefix in HANDOFF", () => {
    const snapshot = viewSnapshotFixture();
    const result = createViewGenerator({
      clock: new CountingClock(GENERATED_AT),
      snapshots: new MutableSnapshotProvider(snapshot),
    }).plan(snapshot);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const handoff = result.value.writes.find((write) =>
      write.relative_path.endsWith("HANDOFF.md"),
    );
    const rendered = new TextDecoder().decode(handoff?.bytes);
    const continuation = rendered
      .split("## Startup Continuation Set\n\n")[1]
      ?.split("\n\n## Active Work")[0] ?? "";
    expect(
      [...continuation.matchAll(/^\d+\. Read `([^`]+)`\.$/gm)].map(
        (match) => match[1],
      ),
    ).toEqual(AGENT_READING_ORDER_PREFIX);
    expect(continuation).toContain(
      `${String(AGENT_READING_ORDER_PREFIX.length + 1)}. Read the assigned workstream and task packet.`,
    );
  });
  it("is stable when canonical arrays arrive in reverse order", () => {
    const snapshot = viewSnapshotFixture();
    const reversed = {
      ...snapshot,
      records: [...snapshot.records].reverse(),
      effective_records: [...snapshot.effective_records].reverse(),
      workstreams: [...snapshot.workstreams].reverse(),
      tasks: [...snapshot.tasks].reverse(),
      events: [...snapshot.events].reverse(),
    };
    const plan = (value: typeof snapshot) =>
      createViewGenerator({
        clock: new CountingClock(GENERATED_AT),
        snapshots: new MutableSnapshotProvider(value),
      }).plan(value);
    const first = plan(snapshot);
    const second = plan(reversed);
    if (!first.ok || !second.ok) throw new Error("view planning failed");
    expect(second.value.writes).toEqual(first.value.writes);
  });

  it("keeps unvalidated proposed changes out of CHANGELOG", () => {
    const snapshot = viewSnapshotFixture();
    const result = createViewGenerator({
      clock: new CountingClock(GENERATED_AT),
      snapshots: new MutableSnapshotProvider(snapshot),
    }).plan(snapshot);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const changelog = result.value.writes.find((write) =>
      write.relative_path.endsWith("CHANGELOG.md"),
    );
    expect(new TextDecoder().decode(changelog?.bytes)).toContain(
      "Add snapshot and view governance",
    );
    expect(new TextDecoder().decode(changelog?.bytes)).not.toContain(
      "Unvalidated proposed change",
    );
  });
});
