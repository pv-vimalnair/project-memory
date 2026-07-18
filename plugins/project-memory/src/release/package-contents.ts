import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";

export const REQUIRED_PACKAGE_PATHS = Object.freeze([
  "package/package.json",
  "package/README.md",
  "package/dist/cli.js",
  "package/dist/index.js",
  "package/schemas/project-memory/v1/schema-index.json",
  "package/catalog/project-memory/v1/manifest.yaml",
  "package/templates/project-memory/PROTOCOL.md",
] as const);

export interface PackageContentReport {
  readonly file_count: number;
  readonly required_paths: typeof REQUIRED_PACKAGE_PATHS;
}

export interface LogicalManifestEntry {
  readonly path: string;
  readonly length: number;
  readonly sha256: string;
}

export interface LogicalManifest {
  readonly schema_version: "1.0.0";
  readonly entries: readonly LogicalManifestEntry[];
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function forbiddenPackagePath(value: string): boolean {
  return value.includes("\\") ||
    value.startsWith("/") ||
    /(?:^|\/)(?:src|node_modules|\.git)(?:\/|$)/i.test(value) ||
    /^package\/tests(?:\/|$)/i.test(value) ||
    /(?:^|\/)(?:\.env(?:\.|$)|credentials?(?:\.|$)|secrets?(?:\.|$))/i.test(value) ||
    /\.(?:log|pem|p12|pfx|key)$/i.test(value);
}

export function validatePackageContents(
  paths: readonly string[],
): RuntimeResult<PackageContentReport> {
  const unique = new Set(paths);
  for (const required of REQUIRED_PACKAGE_PATHS) {
    if (!unique.has(required)) {
      return failure(
        "PACKAGE_CONTENT_REQUIRED_MISSING",
        `required package artifact is missing: ${required}`,
        required,
      );
    }
  }
  for (const entry of [...unique].sort(compareUtf8)) {
    if (forbiddenPackagePath(entry)) {
      return failure(
        "PACKAGE_CONTENT_FORBIDDEN",
        `forbidden package content: ${entry}`,
        entry,
      );
    }
  }
  return success({
    file_count: unique.size,
    required_paths: REQUIRED_PACKAGE_PATHS,
  });
}

export function buildLogicalManifest(
  entries: readonly LogicalManifestEntry[],
): LogicalManifest {
  const paths = new Set<string>();
  for (const entry of entries) {
    if (
      entry.path.length === 0 || entry.path.includes("\\") || entry.path.startsWith("/") ||
      !Number.isSafeInteger(entry.length) || entry.length < 0 ||
      !/^[0-9a-f]{64}$/.test(entry.sha256) || paths.has(entry.path)
    ) {
      throw new TypeError(`invalid logical manifest entry: ${entry.path}`);
    }
    paths.add(entry.path);
  }
  return {
    schema_version: "1.0.0",
    entries: [...entries].sort((left, right) => compareUtf8(left.path, right.path)),
  };
}
