import type { TSchema } from "@sinclair/typebox";

import { registerSchema, type SchemaId } from "../../schema/registry.js";
import { ArchiveManifestSchema } from "./archive-manifest.js";
import { BootstrapAuditManifestSchema } from "./bootstrap-audit.js";
import { CanonicalRecordSchema } from "./canonical-record.js";
import { GateEvidenceSchema } from "./gate-evidence.js";
import { GovernanceEventSchema } from "./governance-event.js";
import { HubFinalizationReceiptSchema } from "./hub-finalization.js";
import { IntegrationLeaseSchema } from "./integration-lease.js";
import { PreparedSatelliteSchema } from "./prepared-satellite.js";
import { GeneratedViewMetadataSchema } from "./view-metadata.js";

const GOVERNANCE_SCHEMAS = Object.freeze([
  ArchiveManifestSchema,
  BootstrapAuditManifestSchema,
  CanonicalRecordSchema,
  GateEvidenceSchema,
  GovernanceEventSchema,
  HubFinalizationReceiptSchema,
  IntegrationLeaseSchema,
  PreparedSatelliteSchema,
  GeneratedViewMetadataSchema,
] as const satisfies readonly TSchema[]);

export const GOVERNANCE_SCHEMA_IDS = Object.freeze([
  "project-memory/v1/archive-manifest",
  "project-memory/v1/bootstrap-audit",
  "project-memory/v1/canonical-record",
  "project-memory/v1/gate-evidence",
  "project-memory/v1/governance-event",
  "project-memory/v1/hub-finalization",
  "project-memory/v1/integration-lease",
  "project-memory/v1/prepared-satellite",
  "project-memory/v1/view-metadata",
] as const satisfies readonly SchemaId[]);

export function registerGovernanceSchemas(): readonly SchemaId[] {
  for (const schema of GOVERNANCE_SCHEMAS) registerSchema(schema);
  return GOVERNANCE_SCHEMA_IDS;
}

export * from "./record-payloads.js";
export * from "./canonical-record.js";
export * from "./bootstrap-audit.js";
export * from "./governance-event.js";
export * from "./view-metadata.js";
export * from "./archive-manifest.js";
export * from "./integration-lease.js";
export * from "./gate-evidence.js";
export * from "./prepared-satellite.js";
export * from "./hub-finalization.js";
