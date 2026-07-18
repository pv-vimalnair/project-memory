import { Type, type Static } from "@sinclair/typebox";

import {
  InstanceIdSchema,
  NonBlankStringSchema,
  profileSchema,
} from "./project-selection.js";

export const CanonicalArtifactTypeSchema = Type.Union([
  Type.Literal("project"),
  Type.Literal("component"),
  Type.Literal("domain"),
  Type.Literal("initiative"),
  Type.Literal("workstream"),
  Type.Literal("task"),
]);

export const CanonicalMarkdownEnvelopeSchema = profileSchema(
  "project-memory/v1/canonical-markdown-envelope",
  Type.Object(
    {
      schema: Type.Literal("project-memory/canonical-markdown"),
      type: CanonicalArtifactTypeSchema,
      version: Type.Literal("1.0.0"),
      id: NonBlankStringSchema,
      revision: Type.Integer({ minimum: 1 }),
      root_id: InstanceIdSchema("ROOT"),
      approval_refs: Type.Array(InstanceIdSchema("APR"), {
        minItems: 1,
        uniqueItems: true,
      }),
    },
    { additionalProperties: false },
  ),
);

export type CanonicalArtifactType = Static<
  typeof CanonicalArtifactTypeSchema
>;

export interface CanonicalMarkdownEnvelope {
  readonly schema: "project-memory/canonical-markdown";
  readonly type: CanonicalArtifactType;
  readonly version: "1.0.0";
  readonly id: string;
  readonly revision: number;
  readonly root_id: string;
  readonly approval_refs: readonly string[];
}

export interface CanonicalMarkdownDocument {
  readonly envelope: CanonicalMarkdownEnvelope;
  readonly body: string;
}