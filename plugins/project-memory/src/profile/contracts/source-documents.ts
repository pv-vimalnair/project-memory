import { Type, type Static } from "@sinclair/typebox";

import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import {
  DefinitionIdSchema,
  SemVerSchema,
} from "../../catalog/contracts/common.js";
import {
  InstanceIdSchema,
  NonBlankStringListSchema,
  NonBlankStringSchema,
  RepositoryLocatorSchema,
  SafeRelativePathSchema,
  SlugSchema,
  profileSchema,
  type ApprovalRecordReference,
  type ProjectSelection,
} from "./project-selection.js";
import { RootRelationshipValueSchema } from "./root-relationships.js";

const ApprovalRefsSchema = Type.Array(InstanceIdSchema("APR"), {
  minItems: 1,
  uniqueItems: true,
});

const SourceStatusSchema = Type.Union([
  Type.Literal("planned"),
  Type.Literal("active"),
  Type.Literal("deprecated"),
  Type.Literal("retired"),
  Type.Literal("observed_unclassified"),
]);

const RepositoryBindingSchema = Type.Object(
  {
    repository: RepositoryLocatorSchema,
    paths: Type.Array(SafeRelativePathSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

const SourceLinkSchema = Type.Object(
  {
    label: NonBlankStringSchema,
    href: Type.Union([
      Type.String({ pattern: "^https?://", minLength: 8 }),
      SafeRelativePathSchema,
    ]),
  },
  { additionalProperties: false },
);

const DefinitionReferenceSchema = Type.Object(
  {
    id: DefinitionIdSchema,
    version: SemVerSchema,
  },
  { additionalProperties: false },
);

export const ProjectSourceDataSchema = Type.Object(
  {
    id: InstanceIdSchema("ROOT"),
    revision: Type.Integer({ minimum: 1 }),
    name: NonBlankStringSchema,
    mission: NonBlankStringSchema,
    owners: Type.Array(NonBlankStringSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    stakeholders: NonBlankStringListSchema,
    success_criteria: Type.Array(NonBlankStringSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    included_scope: Type.Array(NonBlankStringSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    excluded_scope: NonBlankStringListSchema,
    approval_refs: ApprovalRefsSchema,
  },
  { additionalProperties: false },
);

export const ConstraintDataSchema = Type.Object(
  {
    id: Type.String({
      pattern: "^constraint[.][a-z][a-z0-9-]*(?:[.][a-z][a-z0-9-]*)*$",
    }),
    revision: Type.Integer({ minimum: 1 }),
    title: NonBlankStringSchema,
    statement: NonBlankStringSchema,
    rationale: NonBlankStringSchema,
    applies_to: NonBlankStringListSchema,
    approval_refs: ApprovalRefsSchema,
  },
  { additionalProperties: false },
);

export const PolicyDataSchema = Type.Object(
  {
    id: Type.String({
      pattern: "^policy[.][a-z][a-z0-9-]*(?:[.][a-z][a-z0-9-]*)*$",
    }),
    revision: Type.Integer({ minimum: 1 }),
    title: NonBlankStringSchema,
    statement: NonBlankStringSchema,
    enforcement: Type.Union([
      Type.Literal("mandatory"),
      Type.Literal("recommended"),
      Type.Literal("prohibited"),
    ]),
    applies_to: NonBlankStringListSchema,
    approval_refs: ApprovalRefsSchema,
  },
  { additionalProperties: false },
);

const BlueprintDocumentSectionSchema = Type.Object(
  {
    heading: NonBlankStringSchema,
    body: NonBlankStringSchema,
  },
  { additionalProperties: false },
);

export const BlueprintSourceDocumentSchema = Type.Object(
  {
    id: Type.String({
      pattern: "^document[.][a-z][a-z0-9-]*(?:[.][a-z][a-z0-9-]*)*$",
    }),
    revision: Type.Integer({ minimum: 1 }),
    relative_path: Type.String({
      format: "safe-relative-path",
      pattern: "[.]md$",
    }),
    title: NonBlankStringSchema,
    purpose: NonBlankStringSchema,
    sections: Type.Array(BlueprintDocumentSectionSchema, { minItems: 1 }),
    approval_refs: ApprovalRefsSchema,
  },
  { additionalProperties: false },
);

export const ComponentInstanceDataSchema = Type.Object(
  {
    id: InstanceIdSchema("CMP"),
    root_id: InstanceIdSchema("ROOT"),
    revision: Type.Integer({ minimum: 1 }),
    definition: DefinitionReferenceSchema,
    slug: SlugSchema,
    name: NonBlankStringSchema,
    purpose: NonBlankStringSchema,
    owners: Type.Array(NonBlankStringSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    status: SourceStatusSchema,
    inclusion_boundary: Type.Array(NonBlankStringSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    exclusion_boundary: NonBlankStringListSchema,
    repositories: Type.Array(RepositoryBindingSchema, { uniqueItems: true }),
    dependencies: Type.Array(InstanceIdSchema("CMP"), { uniqueItems: true }),
    risks: NonBlankStringListSchema,
    links: Type.Array(SourceLinkSchema, { uniqueItems: true }),
    approval_refs: ApprovalRefsSchema,
  },
  { additionalProperties: false },
);

export const DomainInstanceDataSchema = Type.Object(
  {
    id: InstanceIdSchema("DOM"),
    root_id: InstanceIdSchema("ROOT"),
    revision: Type.Integer({ minimum: 1 }),
    definition: DefinitionReferenceSchema,
    slug: SlugSchema,
    name: NonBlankStringSchema,
    purpose: NonBlankStringSchema,
    owners: Type.Array(NonBlankStringSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    status: SourceStatusSchema,
    inclusion_boundary: Type.Array(NonBlankStringSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    exclusion_boundary: NonBlankStringListSchema,
    repositories: Type.Array(RepositoryBindingSchema, { uniqueItems: true }),
    dependencies: Type.Array(InstanceIdSchema("DOM"), { uniqueItems: true }),
    risks: NonBlankStringListSchema,
    links: Type.Array(SourceLinkSchema, { uniqueItems: true }),
    approval_refs: ApprovalRefsSchema,
  },
  { additionalProperties: false },
);

export const AcceptedProfileSourceSetSchema = profileSchema(
  "project-memory/v1/accepted-profile-source-set",
  Type.Object(
    {
      project: ProjectSourceDataSchema,
      constraints: Type.Array(ConstraintDataSchema, { uniqueItems: true }),
      policies: Type.Array(PolicyDataSchema, { uniqueItems: true }),
      blueprint_documents: Type.Array(BlueprintSourceDocumentSchema, {
        uniqueItems: true,
      }),
      components: Type.Array(ComponentInstanceDataSchema, {
        minItems: 1,
        uniqueItems: true,
      }),
      domains: Type.Array(DomainInstanceDataSchema, {
        minItems: 1,
        uniqueItems: true,
      }),
      root_relationships: Type.Array(RootRelationshipValueSchema, {
        uniqueItems: true,
      }),
    },
    { additionalProperties: false },
  ),
);

export type ProjectSourceData = Static<typeof ProjectSourceDataSchema>;
export type ConstraintData = Static<typeof ConstraintDataSchema>;
export type PolicyData = Static<typeof PolicyDataSchema>;
export type BlueprintSourceDocument = Static<
  typeof BlueprintSourceDocumentSchema
>;
export type ComponentInstanceData = Static<typeof ComponentInstanceDataSchema>;
export type DomainInstanceData = Static<typeof DomainInstanceDataSchema>;
export type AcceptedProfileSourceSet = Static<
  typeof AcceptedProfileSourceSetSchema
>;

export interface ValidatedProfileContracts {
  readonly selection: ProjectSelection;
  readonly sources: AcceptedProfileSourceSet;
  readonly approval_records: readonly ApprovalRecordReference[];
}

function duplicate(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

function recordApprovalRefs(
  sources: AcceptedProfileSourceSet,
): readonly (readonly string[])[] {
  return [
    sources.project.approval_refs,
    ...sources.constraints.map((record) => record.approval_refs),
    ...sources.policies.map((record) => record.approval_refs),
    ...sources.blueprint_documents.map((record) => record.approval_refs),
    ...sources.components.map((record) => record.approval_refs),
    ...sources.domains.map((record) => record.approval_refs),
    ...sources.root_relationships.map((record) => record.approval_refs),
  ];
}

function matchesSelection(
  selection: ProjectSelection,
  sources: AcceptedProfileSourceSet,
): boolean {
  if (
    sources.project.id !== selection.root.id ||
    selection.components.length !== sources.components.length ||
    selection.domains.length !== sources.domains.length
  ) {
    return false;
  }
  const components = new Map(sources.components.map((source) => [source.id, source]));
  for (const binding of selection.components) {
    const source = components.get(binding.instance_id);
    if (
      source === undefined ||
      source.root_id !== selection.root.id ||
      source.definition.id !== binding.definition.id ||
      source.definition.version !== binding.definition.version ||
      source.slug !== binding.slug ||
      source.revision !== binding.source_revision
    ) {
      return false;
    }
  }
  const domains = new Map(sources.domains.map((source) => [source.id, source]));
  for (const binding of selection.domains) {
    const source = domains.get(binding.instance_id);
    if (
      source === undefined ||
      source.root_id !== selection.root.id ||
      source.definition.id !== binding.definition.id ||
      source.definition.version !== binding.definition.version ||
      source.slug !== binding.slug ||
      source.revision !== binding.source_revision
    ) {
      return false;
    }
  }
  return true;
}

export function validateProfileContractConsistency(
  selection: ProjectSelection,
  sources: AcceptedProfileSourceSet,
  approvalRecords: readonly ApprovalRecordReference[],
): RuntimeResult<ValidatedProfileContracts> {
  const duplicateId = duplicate([
    ...selection.components.map((binding) => binding.instance_id),
    ...selection.domains.map((binding) => binding.instance_id),
    ...sources.components.map((record) => record.id),
    ...sources.domains.map((record) => record.id),
    ...sources.root_relationships.map((record) => record.relationship_id),
  ]);
  if (duplicateId !== null) {
    const allowedBindingPair =
      selection.components.some((binding) => binding.instance_id === duplicateId) &&
      sources.components.some((record) => record.id === duplicateId) ||
      selection.domains.some((binding) => binding.instance_id === duplicateId) &&
      sources.domains.some((record) => record.id === duplicateId);
    const occurrences = [
      ...selection.components.map((binding) => binding.instance_id),
      ...selection.domains.map((binding) => binding.instance_id),
    ].filter((id) => id === duplicateId).length;
    const sourceOccurrences = [
      ...sources.components.map((record) => record.id),
      ...sources.domains.map((record) => record.id),
      ...sources.root_relationships.map((record) => record.relationship_id),
    ].filter((id) => id === duplicateId).length;
    if (!allowedBindingPair || occurrences !== 1 || sourceOccurrences !== 1) {
      return failure(
        "PROFILE_INSTANCE_ID_DUPLICATE",
        `stable instance ID appears more than once: ${duplicateId}`,
        duplicateId,
      );
    }
  }

  for (const ids of [
    selection.components.map((binding) => binding.instance_id),
    selection.domains.map((binding) => binding.instance_id),
    sources.components.map((record) => record.id),
    sources.domains.map((record) => record.id),
    sources.root_relationships.map((record) => record.relationship_id),
  ]) {
    const repeated = duplicate(ids);
    if (repeated !== null) {
      return failure(
        "PROFILE_INSTANCE_ID_DUPLICATE",
        `stable instance ID appears more than once: ${repeated}`,
        repeated,
      );
    }
  }

  if (!matchesSelection(selection, sources)) {
    return failure(
      "PROFILE_SOURCE_SELECTION_MISMATCH",
      "accepted profile sources do not match the stable selection bindings",
      "/accepted_sources",
    );
  }

  const duplicateApproval = duplicate(approvalRecords.map((record) => record.id));
  if (duplicateApproval !== null) {
    return failure(
      "PROFILE_APPROVAL_DUPLICATE",
      `approval reference appears more than once: ${duplicateApproval}`,
      duplicateApproval,
    );
  }
  const approvals = new Map(approvalRecords.map((record) => [record.id, record]));
  const selectionApproval = approvals.get(selection.acceptance.approval_id);
  if (
    selectionApproval === undefined ||
    selectionApproval.root_id !== selection.root.id ||
    selectionApproval.decision !== "approved" ||
    selectionApproval.approved_at !== selection.acceptance.accepted_at
  ) {
    return failure(
      "PROFILE_APPROVAL_REQUIRED",
      "project selection requires a linked active Pitaji approval",
      selection.acceptance.approval_id,
    );
  }
  for (const refs of recordApprovalRefs(sources)) {
    for (const reference of refs) {
      const approval = approvals.get(reference);
      if (
        approval === undefined ||
        approval.root_id !== selection.root.id ||
        approval.decision !== "approved"
      ) {
        return failure(
          "PROFILE_APPROVAL_REQUIRED",
          "every accepted profile source requires a linked active Pitaji approval",
          reference,
        );
      }
    }
  }

  return success({
    selection,
    sources,
    approval_records: approvalRecords,
  });
}
