import type {
  CanonicalMarkdownDocument,
  ProfileLock,
  ProjectSelection,
  RuntimeResult,
} from "../../index.js";

import type { CanonicalRecord, GovernanceEvent } from "../contracts/index.js";
import type { RevisionSource } from "./revision-tree-reader.js";

export interface SnapshotTextDocument {
  readonly relative_path: string;
  readonly text: string;
}

export interface SnapshotJsonDocument {
  readonly relative_path: string;
  readonly value: Readonly<Record<string, unknown>>;
}

export interface CanonicalSnapshot {
  readonly source_revision: string;
  readonly source_kind: RevisionSource["kind"];
  readonly root_id: string;
  readonly profile_revision: number;
  readonly profile_lock_hash: string;
  readonly selected_catalog_lock_hash: string;
  readonly catalog_versions: readonly string[];
  readonly source_paths: readonly string[];
  readonly source_hashes: Readonly<Record<string, string>>;
  readonly blob_object_ids: Readonly<Record<string, string>>;
  readonly project: ProjectSelection;
  readonly profile_lock: ProfileLock;
  readonly source_documents: readonly SnapshotTextDocument[];
  readonly components: readonly CanonicalMarkdownDocument[];
  readonly domains: readonly CanonicalMarkdownDocument[];
  readonly initiatives: readonly CanonicalMarkdownDocument[];
  readonly workstreams: readonly CanonicalMarkdownDocument[];
  readonly tasks: readonly CanonicalMarkdownDocument[];
  readonly records: readonly CanonicalRecord[];
  readonly effective_records: readonly CanonicalRecord[];
  readonly evidence: readonly CanonicalRecord[];
  readonly risks: readonly CanonicalRecord[];
  readonly approvals: readonly CanonicalRecord[];
  readonly claims: readonly SnapshotJsonDocument[];
  readonly events: readonly GovernanceEvent[];
}

export interface CanonicalSnapshotBuilder {
  build(
    root: URL,
    source: RevisionSource,
  ): Promise<RuntimeResult<CanonicalSnapshot>>;
}
