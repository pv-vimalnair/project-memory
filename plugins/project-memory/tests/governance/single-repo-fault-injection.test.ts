import { afterAll, describe, expect, it } from "vitest";

import {
  SINGLE_REPO_FAULT_POINTS,
  type SingleRepoFaultPoint,
} from "../../src/governance/integration/single-repo-finalizer.js";
import {
  cleanupSingleRepoHarnesses,
  expectSingleRepoClean,
  git,
  singleRepoHarness,
} from "./single-repo-test-fixture.js";

afterAll(cleanupSingleRepoHarnesses);

describe("single-repository finalization fault isolation", () => {
  it.each(SINGLE_REPO_FAULT_POINTS)(
    "leaves the canonical ref unchanged on %s failure",
    async (faultPoint: SingleRepoFaultPoint) => {
      let injected = false;
      const harness = await singleRepoHarness({
        faults: {
          hit(point) {
            if (point === faultPoint) {
              injected = true;
              throw new Error(`injected:${point}`);
            }
          },
        },
      });
      const before = await git(harness.repo, [
        "rev-parse",
        harness.input.target_ref,
      ]);

      const validated = await harness.finalizer.validate(harness.input);
      const result = validated.ok
        ? await harness.finalizer.finalize(validated.value)
        : validated;

      expect(result.ok).toBe(false);
      expect(injected).toBe(true);
      expect(await git(harness.repo, ["rev-parse", harness.input.target_ref]))
        .toBe(before);
      await expectSingleRepoClean(harness);
    },
    30_000,
  );
});
