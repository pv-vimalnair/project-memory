import { describe, expect, it } from "vitest";

import { INSTANCE_PREFIXES } from "../../src/contracts/ids.js";
import { FixedClock } from "../../src/core/clock.js";
import { MonotonicIdFactory } from "../../src/core/id-factory.js";

describe("MonotonicIdFactory", () => {
  it("creates stable-prefixed monotonic ULIDs from an injected clock", () => {
    const factory = new MonotonicIdFactory({
      now: () => new Date("2026-07-14T12:00:00.000Z"),
    });

    const first = factory.next("TASK");
    const second = factory.next("TASK");

    expect(first).toMatch(/^TASK-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(second > first).toBe(true);
  });

  it.each(INSTANCE_PREFIXES)("supports the %s instance prefix", (prefix) => {
    const factory = new MonotonicIdFactory(
      new FixedClock(new Date("2026-07-14T12:00:00.000Z")),
    );

    expect(factory.next(prefix)).toMatch(
      new RegExp(`^${prefix}-[0-9A-HJKMNP-TV-Z]{26}$`),
    );
  });

  it("rejects an unknown runtime prefix", () => {
    const factory = new MonotonicIdFactory(
      new FixedClock(new Date("2026-07-14T12:00:00.000Z")),
    );

    expect(() => factory.next("UNKNOWN" as never)).toThrow(/instance prefix/i);
  });

  it("returns a defensive copy of fixed time", () => {
    const clock = new FixedClock(new Date("2026-07-14T12:00:00.000Z"));
    const first = clock.now();
    first.setUTCFullYear(2030);

    expect(clock.now().toISOString()).toBe("2026-07-14T12:00:00.000Z");
  });
});
