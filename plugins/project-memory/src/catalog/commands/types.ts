export interface CatalogCommandOptions {
  readonly root: URL;
  readonly output_root?: URL;
  readonly scope?: string;
  readonly strict?: boolean;
  readonly check?: boolean;
  readonly schema_only?: boolean;
  readonly taxonomy_only?: boolean;
  readonly integrated?: boolean;
  readonly suite?: string;
  readonly release?: string;
  readonly check_clean?: boolean;
}

export interface CatalogCommandReport {
  readonly command: "validate" | "inventory" | "fixtures" | "lock" | "bundle";
  readonly valid: boolean;
  readonly counts: Readonly<Record<string, number>>;
  readonly checked_ids: readonly string[];
  readonly details: Readonly<Record<string, unknown>>;
}
