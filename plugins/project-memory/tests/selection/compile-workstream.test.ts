import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FixedClock,
  PROJECT_SCHEMA_REGISTRARS,
  registerProjectSchemas,
  type IdFactory,
  type InstancePrefix,
} from "../../src/index.js";
import { compileWorkstream } from "../../src/selection/compile-workstream.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import { readCompileFixture } from "../helpers/compile-fixture.js";

const NOW = new Date("2026-07-14T12:00:00.000Z");

class FixedIds implements IdFactory {
  #counter = 0;

  next(prefix: InstancePrefix): string {
    this.#counter += 1;
    return `${prefix}-01J${String(this.#counter).padStart(23, "0")}`;
  }
}

beforeAll(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

afterAll(() => {
  resetSchemaRegistryForTests();
});

describe("compile workstream pipeline", () => {
  it("compiles an in-app LifeOf referral launch", async () => {
    const loaded = await readCompileFixture(
      new URL("../fixtures/selection/lifeof-referral.yaml", import.meta.url),
    );
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
    const result = compileWorkstream(
      loaded.value,
      new FixedClock(NOW),
      new FixedIds(),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));

    expect(result.value.workstreams).toHaveLength(1);
    expect(
      result.value.taskPackets.map((packet) => packet.patterns.primary.id),
    ).toContain("growth.campaign.release");
    expect(result.value.coverage.unassignedRequirementIds).toEqual([]);
    expect(result.value.coverage.duplicateExclusiveRequirementIds).toEqual(
      [],
    );
  });
});
