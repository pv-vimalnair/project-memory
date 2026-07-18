import { lstat, readFile, readdir } from "node:fs/promises";

import {
  canonicalJson,
  decodeStrictUtf8,
  failure,
  parseJsonDocument,
  resolveInside,
  success,
  validateWithSchema,
  type PlannedWrite,
  type RuntimeIssue,
  type RuntimeResult,
} from "../../index.js";
import type { Claim } from "../../planning/types.js";

const CLAIM_ID = /^CLAIM-[0-9A-HJKMNP-TV-Z]{26}$/;
const CLAIM_DIRECTORY = "docs/project-memory/governance/claims";

export interface ClaimStore {
  planCreate(root: URL, claim: Claim): Promise<RuntimeResult<PlannedWrite>>;
  get(root: URL, claimId: string): Promise<RuntimeResult<Claim>>;
  list(root: URL): Promise<RuntimeResult<readonly Claim[]>>;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function translatedFailure<T>(
  code: string,
  message: string,
  path: string,
  issues: readonly RuntimeIssue[],
): RuntimeResult<T> {
  return failure(
    code,
    message,
    path,
    issues.map((issue) => `${issue.code}:${issue.path}`),
  );
}

export function claimPath(claimId: string): string {
  if (!CLAIM_ID.test(claimId)) throw new TypeError("claim ID is invalid");
  return `${CLAIM_DIRECTORY}/${claimId}.json`;
}

function validateClaim(value: unknown, source: string): RuntimeResult<Claim> {
  const result = validateWithSchema<Claim>("project-memory/v1/claim", value);
  return result.ok
    ? result
    : translatedFailure(
        "claim.schema_invalid",
        "claim does not satisfy its registered schema",
        source,
        result.issues,
      );
}

async function readClaim(
  root: URL,
  claimId: string,
): Promise<RuntimeResult<Claim | null>> {
  let relativePath: string;
  try {
    relativePath = claimPath(claimId);
  } catch (error: unknown) {
    return failure(
      "claim.id_invalid",
      error instanceof Error ? error.message : String(error),
      claimId,
    );
  }
  const target = await resolveInside(root, relativePath);
  if (!target.ok) return target;
  let bytes: Uint8Array;
  try {
    const stat = await lstat(target.value);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure(
        "claim.path_unsafe",
        "immutable claims must be regular files",
        relativePath,
      );
    }
    bytes = new Uint8Array(await readFile(target.value));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return success(null);
    return failure(
      "claim.read_failed",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
  const decoded = decodeStrictUtf8(bytes, relativePath);
  if (!decoded.ok) return decoded;
  const parsed = parseJsonDocument(decoded.value, relativePath);
  if (!parsed.ok) return parsed;
  const claim = validateClaim(parsed.value, relativePath);
  if (!claim.ok) return claim;
  if (claim.value.id !== claimId) {
    return failure(
      "claim.id_mismatch",
      "claim ID must match its immutable filename",
      relativePath,
      [claim.value.id],
    );
  }
  const canonical = new TextEncoder().encode(canonicalJson(claim.value));
  if (!Buffer.from(bytes).equals(Buffer.from(canonical))) {
    return failure(
      "claim.noncanonical",
      "immutable claim bytes must use canonical JSON",
      relativePath,
    );
  }
  return success(claim.value);
}

async function listClaims(root: URL): Promise<RuntimeResult<readonly Claim[]>> {
  const directory = await resolveInside(root, CLAIM_DIRECTORY);
  if (!directory.ok) return directory;
  let entries;
  try {
    const stat = await lstat(directory.value);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return failure(
        "claim.directory_unsafe",
        "claim directory must be a real directory",
        CLAIM_DIRECTORY,
      );
    }
    entries = await readdir(directory.value, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return success([]);
    return failure(
      "claim.directory_read_failed",
      error instanceof Error ? error.message : String(error),
      CLAIM_DIRECTORY,
    );
  }
  const claims: Claim[] = [];
  for (const entry of entries.sort((left, right) => compareUtf8(left.name, right.name))) {
    if (entry.name === ".gitkeep" && entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
      return failure(
        "claim.directory_entry_unsafe",
        "claim directories may contain immutable JSON files only",
        `${CLAIM_DIRECTORY}/${entry.name}`,
      );
    }
    const value = await readClaim(root, entry.name.slice(0, -5));
    if (!value.ok) return value;
    if (value.value !== null) claims.push(value.value);
  }
  return success(claims.sort((left, right) => compareUtf8(left.id, right.id)));
}

export function createClaimStore(): ClaimStore {
  return {
    async planCreate(root, claim) {
      const validated = validateClaim(claim, claim.id);
      if (!validated.ok) return validated;
      const existing = await readClaim(root, claim.id);
      if (!existing.ok) return existing;
      if (existing.value !== null) {
        return failure(
          "claim.id_exists",
          "immutable claim IDs cannot be replaced or reused",
          claim.id,
        );
      }
      const relativePath = claimPath(claim.id);
      const confined = await resolveInside(root, relativePath);
      return confined.ok
        ? success({
            relative_path: relativePath,
            bytes: new TextEncoder().encode(canonicalJson(validated.value)),
            expected_existing_sha256: null,
            mode: "create",
          })
        : confined;
    },
    async get(root, claimId) {
      const claim = await readClaim(root, claimId);
      if (!claim.ok) return claim;
      return claim.value === null
        ? failure("claim.not_found", "immutable claim does not exist", claimId)
        : success(claim.value);
    },
    list: listClaims,
  };
}
