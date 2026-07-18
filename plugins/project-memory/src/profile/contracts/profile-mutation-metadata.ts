import { Type, type Static } from "@sinclair/typebox";

import type { CanonicalMutationPlan } from "../../contracts/canonical-mutation-plan.js";
import type { RuntimeResult } from "../../contracts/runtime-result.js";
import {
  ProfileLockValueSchema,
  type ProfileLock,
} from "./profile-lock.js";
import {
  Sha256Schema,
  profileSchema,
  type ApprovalRecordReference,
} from "./project-selection.js";
import {
  ResolvedProfileValueSchema,
  type ResolvedProfile,
} from "./resolved-profile.js";
import {
  SelectedCatalogLockValueSchema,
  type SelectedCatalogLock,
} from "./selected-catalog-lock.js";
import type { AcceptedProfileSourceSet } from "./source-documents.js";

export interface ProfileMutationMetadata {
  readonly project_hash: string;
  readonly profile: ResolvedProfile;
  readonly selected_catalog_lock: SelectedCatalogLock;
  readonly profile_lock: ProfileLock;
}

const ProfileMutationMetadataRuntimeSchema = Type.Object(
  {
    project_hash: Sha256Schema,
    profile: ResolvedProfileValueSchema,
    selected_catalog_lock: SelectedCatalogLockValueSchema,
    profile_lock: ProfileLockValueSchema,
  },
  { additionalProperties: false },
);

export const ProfileMutationMetadataSchema = profileSchema(
  "project-memory/v1/profile-mutation-metadata",
  Type.Unsafe<ProfileMutationMetadata>(ProfileMutationMetadataRuntimeSchema),
);

export type ProfileMutationMetadataDocument = Static<
  typeof ProfileMutationMetadataSchema
>;

export type ProfileMutationKind = "profile.bootstrap" | "profile.evolution";

export type ProfileCanonicalMutationPlan = Omit<
  CanonicalMutationPlan<ProfileMutationMetadata>,
  "mutation_kind"
> & { readonly mutation_kind: ProfileMutationKind };

export interface ProfilePlanInput {
  readonly target_root: URL;
  readonly target_ref: string;
  readonly expected_head: string;
  readonly plan_id: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly project_yaml: Uint8Array;
  readonly accepted_sources: AcceptedProfileSourceSet;
  readonly catalog_release_root: URL;
  readonly previous_profile_lock: ProfileLock | null;
  readonly approval_records: readonly ApprovalRecordReference[];
}

export interface ProfileCompiler {
  plan(
    input: ProfilePlanInput,
  ): Promise<RuntimeResult<ProfileCanonicalMutationPlan>>;
}