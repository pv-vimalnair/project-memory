import { afterEach, beforeEach, expect, it } from "vitest";

import {
  CATALOG_SCHEMA_IDS,
  registerCatalogSchemas,
} from "../../src/catalog/contracts/index.js";
import {
  CLI_SCHEMA_IDS,
  registerCliSchemas,
} from "../../src/cli/config.js";
import {
  GOVERNANCE_SCHEMA_IDS,
  registerGovernanceSchemas,
} from "../../src/governance/contracts/index.js";
import {
  PLANNING_SCHEMA_IDS,
  registerPlanningSchemas,
} from "../../src/planning/contracts.js";
import {
  PROFILE_SCHEMA_IDS,
  registerProfileSchemas,
} from "../../src/profile/contracts/index.js";
import {
  SELECTION_SCHEMA_IDS,
  registerSelectionSchemas,
} from "../../src/selection/contracts/index.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import {
  FOUNDATION_SCHEMA_IDS,
  registerFoundationSchemas,
} from "../../src/schema/registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

beforeEach(() => {
  resetSchemaRegistryForTests();
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

it("explicitly wires every registrar and exactly 50 schemas", () => {
  expect(PROJECT_SCHEMA_REGISTRARS).toEqual([
    registerCatalogSchemas,
    registerCliSchemas,
    registerFoundationSchemas,
    registerGovernanceSchemas,
    registerPlanningSchemas,
    registerProfileSchemas,
    registerSelectionSchemas,
  ]);
  const result = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const expected = [
    ...CATALOG_SCHEMA_IDS,
    ...CLI_SCHEMA_IDS,
    ...FOUNDATION_SCHEMA_IDS,
    ...GOVERNANCE_SCHEMA_IDS,
    ...PLANNING_SCHEMA_IDS,
    ...PROFILE_SCHEMA_IDS,
    ...SELECTION_SCHEMA_IDS,
  ].sort();
  expect(result.value).toEqual(expected);
  expect(result.value).toHaveLength(50);
});
