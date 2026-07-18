import { afterAll, describe, expect, it } from "vitest";

import {
  BOOTSTRAP_FAULT_POINTS,
  type BootstrapFaultPoint,
} from "../../src/governance/integration/bootstrap-transaction.js";
import {
  bootstrapHarness,
  cleanupBootstrapHarnesses,
  expectCoordinationClean,
} from "./bootstrap-test-fixture.js";

afterAll(cleanupBootstrapHarnesses);

describe("bootstrap fault isolation", () => {
  it.each(BOOTSTRAP_FAULT_POINTS)(
    "leaves the target ref unchanged on bootstrap fault %s",
    async (faultPoint: BootstrapFaultPoint) => {
      let injected = false;
      const harness = await bootstrapHarness({
        hit(point) {
          if (point === faultPoint) {
            injected = true;
            throw new Error(`injected:${point}`);
          }
        },
      });
      const before = await harness.git_client.resolveRef(
        harness.repo,
        harness.input.target_ref,
      );

      const result = await harness.finalizer.bootstrap(harness.input);

      expect(result.ok).toBe(false);
      expect(injected).toBe(true);
      expect(harness.coordinator_calls.value).toBe(1);
      expect(
        await harness.git_client.resolveRef(harness.repo, harness.input.target_ref),
      ).toBe(before);
      await expectCoordinationClean(harness);
    },
    30_000,
  );
});
