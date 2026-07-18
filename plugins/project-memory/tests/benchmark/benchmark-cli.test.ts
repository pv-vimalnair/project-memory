import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDefaultCommandRegistry } from "../../src/cli/command-registry.js";
import { executeCli } from "../../src/cli/main.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url);

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error("schema fixture registration failed");
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("benchmark CLI", () => {
  it("exposes run and report and returns the deterministic report envelope", async () => {
    const registry = createDefaultCommandRegistry();
    expect(registry.paths()).toContainEqual(["benchmark", "run"]);
    expect(registry.paths()).toContainEqual(["benchmark", "report"]);

    const execution = await executeCli([
      "benchmark",
      "run",
      "--input",
      "benchmarks/briefs",
      "--json",
    ], { registry, current_directory: PACKAGE_ROOT });

    expect(execution.exit_code).toBe(0);
    expect(execution.stderr).toBe("");
    expect(execution.envelope).toMatchObject({
      command: "benchmark run",
      status: "success",
      data: {
        case_count: 150,
        supported_resolution_rate: 1,
        deterministic_gate_passed: true,
        v1_accepted: false,
      },
    });
  });
});
