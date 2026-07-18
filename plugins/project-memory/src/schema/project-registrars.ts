import {
  CATALOG_SCHEMA_IDS,
  registerCatalogSchemas,
} from "../catalog/contracts/index.js";
import {
  CLI_SCHEMA_IDS,
  registerCliSchemas,
} from "../cli/config.js";
import {
  GOVERNANCE_SCHEMA_IDS,
  registerGovernanceSchemas,
} from "../governance/contracts/index.js";
import {
  PLANNING_SCHEMA_IDS,
  registerPlanningSchemas,
} from "../planning/contracts.js";
import {
  PROFILE_SCHEMA_IDS,
  registerProfileSchemas,
} from "../profile/contracts/index.js";
import {
  SELECTION_SCHEMA_IDS,
  registerSelectionSchemas,
} from "../selection/contracts/index.js";
import {
  FOUNDATION_SCHEMA_IDS,
  registerFoundationSchemas,
} from "./registrars.js";
import type { SchemaId, SchemaRegistrar } from "./registry.js";

export const PROJECT_SCHEMA_IDS = Object.freeze([
  ...CATALOG_SCHEMA_IDS,
  ...CLI_SCHEMA_IDS,
  ...FOUNDATION_SCHEMA_IDS,
  ...GOVERNANCE_SCHEMA_IDS,
  ...PLANNING_SCHEMA_IDS,
  ...PROFILE_SCHEMA_IDS,
  ...SELECTION_SCHEMA_IDS,
].sort()) as readonly SchemaId[];

export const PROJECT_SCHEMA_REGISTRARS: readonly SchemaRegistrar[] = [
  registerCatalogSchemas,
  registerCliSchemas,
  registerFoundationSchemas,
  registerGovernanceSchemas,
  registerPlanningSchemas,
  registerProfileSchemas,
  registerSelectionSchemas,
];