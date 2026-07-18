export interface PlannedWrite {
  readonly relative_path: string;
  readonly bytes: Uint8Array;
  readonly expected_existing_sha256: string | null;
  readonly mode: "create" | "replace" | "create_or_replace";
}
