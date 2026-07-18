import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FixedClock,
  PROJECT_SCHEMA_REGISTRARS,
  canonicalJson,
  registerProjectSchemas,
  type IdFactory,
  type InstancePrefix,
} from "../../src/index.js";
import type { CompileWorkstreamInput } from "../../src/planning/types.js";
import { compileWorkstream } from "../../src/selection/compile-workstream.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import { readCompileFixture } from "../helpers/compile-fixture.js";

const NOW = new Date("2026-07-14T12:00:00.000Z");
const FIXTURES = {
  purchase: "lifeof-purchase-security.yaml",
  settings: "lifeof-settings-ux.yaml",
  external: "external-campaign.yaml",
  game: "dinoescape-game-system.yaml",
} as const;

class FixedIds implements IdFactory {
  #counter = 0;

  next(prefix: InstancePrefix): string {
    this.#counter += 1;
    return `${prefix}-01J${String(this.#counter).padStart(23, "0")}`;
  }
}

async function load(name: string): Promise<CompileWorkstreamInput> {
  const result = await readCompileFixture(
    new URL(`../fixtures/selection/${name}`, import.meta.url),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function compile(input: CompileWorkstreamInput) {
  return compileWorkstream(
    input,
    new FixedClock(NOW),
    new FixedIds(),
  );
}

function withoutValuableState(
  input: CompileWorkstreamInput,
): CompileWorkstreamInput {
  const observations = input.observationsByOutcome["outcome.game-anti-cheat"];
  if (observations === undefined) throw new Error("missing anti-cheat evidence");
  return {
    ...input,
    observationsByOutcome: {
      ...input.observationsByOutcome,
      "outcome.game-anti-cheat": observations.map((observation) =>
        observation.id === "game.valuable-state"
          ? { ...observation, value: false }
          : observation,
      ),
    },
  };
}

beforeAll(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

afterAll(() => {
  resetSchemaRegistryForTests();
});

describe("selection and planning golden scenarios", () => {
  it("produces sibling purchase implementation and security assessment", async () => {
    const result = compile(await load(FIXTURES.purchase));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(
      result.value.taskPackets.map((packet) => packet.patterns.primary.id),
    ).toEqual([
      "commerce.payment.implement",
      "security.threat-model.assess",
    ]);
    expect(result.value.workstreams.every((item) => item.canCompleteIndependently)).toBe(true);
  });

  it("keeps settings audit and redesign dependent without implementation", async () => {
    const result = compile(await load(FIXTURES.settings));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const primaryIds = result.value.taskPackets.map(
      (packet) => packet.patterns.primary.id,
    );
    expect(primaryIds).toEqual(["ux.flow.assess", "ux.flow.design"]);
    expect(primaryIds.some((id) => id.endsWith(".implement"))).toBe(false);
    expect(result.value.workstreams[1]?.dependsOnOutcomeIds).toEqual([
      "outcome.settings-audit",
    ]);
  });

  it("keeps an external campaign outside Flutter and Firebase paths", async () => {
    const result = compile(await load(FIXTURES.external));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const packet = result.value.taskPackets[0];
    if (packet === undefined) throw new Error("missing external packet");
    expect(packet.patterns.primary.id).toBe("growth.campaign.release");
    expect(packet.authorization.external_action.allowed).toBe(true);
    expect(
      packet.claim.paths.every(
        (path) => !path.startsWith("lib/") && !path.startsWith("firebase/"),
      ),
    ).toBe(true);
  });

  it("adds Dino Escape system validation and conditional anti-cheat", async () => {
    const input = await load(FIXTURES.game);
    const enabled = compile(input);
    const disabled = compile(withoutValuableState(input));
    if (!enabled.ok) throw new Error(JSON.stringify(enabled.issues));
    if (!disabled.ok) throw new Error(JSON.stringify(disabled.issues));
    expect(
      enabled.value.taskPackets.map((packet) => packet.patterns.primary.id),
    ).toEqual([
      "game.balance.assess",
      "game.telemetry.implement",
      "game.anti-cheat.assess",
      "game.playtest.validate",
      "game.save.validate",
    ]);
    expect(
      disabled.value.taskPackets.some(
        (packet) => packet.patterns.primary.id === "game.anti-cheat.assess",
      ),
    ).toBe(false);
  });

  it("is byte-identical with the same clock and fresh deterministic IDs", async () => {
    for (const name of Object.values(FIXTURES)) {
      const input = await load(name);
      const first = compile(input);
      const second = compile(input);
      if (!first.ok || !second.ok) throw new Error(`compile failed for ${name}`);
      expect(canonicalJson(first.value)).toBe(canonicalJson(second.value));
    }
  });
});
