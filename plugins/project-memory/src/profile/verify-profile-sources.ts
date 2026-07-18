import { lstat, readFile, readdir } from "node:fs/promises";

import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { canonicalJson } from "../core/canonical-json.js";
import {
  decodeStrictUtf8,
  parseYamlDocument,
} from "../core/document-io.js";
import { sha256 } from "../core/hash.js";
import { resolveInside } from "../core/path-safety.js";
import { parseCanonicalMarkdown } from "../materialize/parse-canonical-markdown.js";
import { renderRootRelationships } from "../materialize/render-root-relationships.js";
import { compareUtf8 } from "./catalog-selection-model.js";
import type {
  AcceptedSourceLockEntry,
  ProfileLock,
  ResolvedProfile,
  RootAddress,
} from "./contracts/index.js";

const PROJECT_SOURCE_PATH = "docs/project-memory/source/PROJECT.md";
const CONSTRAINTS_PATH = "docs/project-memory/source/CONSTRAINTS.md";
const POLICIES_PATH = "docs/project-memory/source/POLICIES.md";
const RELATIONSHIPS_PATH = "docs/project-memory/source/ROOT_RELATIONSHIPS.md";

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

async function requiredBytes(
  root: URL,
  relativePath: string,
): Promise<RuntimeResult<Uint8Array>> {
  const resolved = await resolveInside(root, relativePath);
  if (!resolved.ok) return resolved;
  try {
    const stat = await lstat(resolved.value);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure(
        "PROFILE_TARGET_UNSAFE",
        "accepted profile sources must be regular target files",
        relativePath,
      );
    }
    return success(new Uint8Array(await readFile(resolved.value)));
  } catch (error: unknown) {
    return failure(
      "PROFILE_TARGET_READ_FAILED",
      error instanceof Error ? error.message : String(error),
      relativePath,
    );
  }
}

function splitAcceptedList(
  bytes: Uint8Array,
  relativePath: string,
): RuntimeResult<{ readonly header: Record<string, unknown>; readonly body: string }> {
  const decoded = decodeStrictUtf8(bytes, relativePath);
  if (!decoded.ok) return decoded;
  if (decoded.value.includes("\r") || !decoded.value.endsWith("\n")) {
    return failure(
      "PROFILE_SOURCE_MARKDOWN_INVALID",
      "accepted source Markdown requires LF text with a final newline",
      relativePath,
    );
  }
  const marker = "\n---\n";
  if (!decoded.value.startsWith("---\n")) {
    return failure("PROFILE_SOURCE_MARKDOWN_INVALID", "front matter is missing", relativePath);
  }
  const end = decoded.value.indexOf(marker, 4);
  if (end < 0) {
    return failure("PROFILE_SOURCE_MARKDOWN_INVALID", "front matter is incomplete", relativePath);
  }
  const parsed = parseYamlDocument(decoded.value.slice(4, end + 1), relativePath);
  if (!parsed.ok) return parsed;
  if (typeof parsed.value !== "object" || parsed.value === null || Array.isArray(parsed.value)) {
    return failure("PROFILE_SOURCE_MARKDOWN_INVALID", "front matter must be a map", relativePath);
  }
  const body = decoded.value.slice(end + marker.length);
  return body.trim().length === 0
    ? failure("PROFILE_SOURCE_MARKDOWN_INVALID", "accepted source body is empty", relativePath)
    : success({ header: parsed.value as Record<string, unknown>, body });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson([...left].sort(compareUtf8)) ===
    canonicalJson([...right].sort(compareUtf8));
}

function verifyAcceptedList(
  bytes: Uint8Array,
  pathValue: string,
  entries: readonly AcceptedSourceLockEntry[],
  lock: ProfileLock,
): RuntimeResult<true> {
  const parsed = splitAcceptedList(bytes, pathValue);
  if (!parsed.ok) return parsed;
  const expectedType = pathValue === CONSTRAINTS_PATH
    ? "constraints"
    : pathValue === POLICIES_PATH
      ? "policies"
      : "blueprint-document";
  const expectedKind = expectedType === "constraints"
    ? "constraint"
    : expectedType === "policies"
      ? "policy"
      : "blueprint-document";
  const header = parsed.value.header;
  const expectedKeys = expectedType === "blueprint-document"
    ? ["approval_refs", "id", "revision", "root_id", "schema", "type", "version"]
    : ["approval_refs", "root_id", "schema", "type", "version"];
  const actualKeys = Object.keys(header).sort(compareUtf8);
  const projectApprovals = lock.accepted_source_entries.find(
    (entry) => entry.kind === "project",
  )?.approval_refs ?? [];
  const approvals = entries.length === 0
    ? projectApprovals
    : [...new Set(entries.flatMap((entry) => entry.approval_refs))];
  if (
    !sameStrings(actualKeys, expectedKeys) ||
    entries.some((entry) => entry.kind !== expectedKind) ||
    header.schema !== "project-memory/accepted-source-list" ||
    header.type !== expectedType ||
    header.version !== "1.0.0" ||
    header.root_id !== lock.root_id ||
    !Array.isArray(header.approval_refs) ||
    !header.approval_refs.every((value) => typeof value === "string") ||
    !sameStrings(header.approval_refs, approvals)
  ) {
    return failure(
      "PROFILE_SOURCE_ENVELOPE_MISMATCH",
      "accepted source list envelope does not match the profile lock",
      pathValue,
    );
  }
  if (expectedType === "blueprint-document") {
    const first = entries[0];
    if (
      entries.length !== 1 ||
      first === undefined ||
      header.id !== first.source_id ||
      header.revision !== first.revision
    ) {
      return failure(
        "PROFILE_SOURCE_ENVELOPE_MISMATCH",
        "blueprint source identity does not match its profile-lock entry",
        pathValue,
      );
    }
  }
  if (entries.length === 0) {
    const expectedEmpty = expectedType === "constraints"
      ? "# Constraints\n\n_No accepted constraints._\n"
      : "# Policies\n\n_No accepted policies._\n";
    if (parsed.value.body !== expectedEmpty) {
      return failure(
        "PROFILE_SOURCE_HASH_MISMATCH",
        "unlocked empty accepted-source collection has unexpected bytes",
        pathValue,
      );
    }
  }
  return success(true);
}

function verifyCanonicalSource(
  bytes: Uint8Array,
  entry: AcceptedSourceLockEntry,
  rootId: string,
): RuntimeResult<true> {
  const parsed = parseCanonicalMarkdown(bytes);
  if (!parsed.ok) return parsed;
  const envelope = parsed.value.envelope;
  if (
    envelope.type !== entry.kind ||
    envelope.id !== entry.source_id ||
    envelope.revision !== entry.revision ||
    envelope.root_id !== rootId ||
    !sameStrings(envelope.approval_refs, entry.approval_refs)
  ) {
    return failure(
      "PROFILE_SOURCE_ENVELOPE_MISMATCH",
      "canonical source envelope does not match its profile-lock entry",
      entry.target_path,
    );
  }
  return success(true);
}

async function walkFiles(
  root: URL,
  relativeDirectory: string,
): Promise<RuntimeResult<readonly string[]>> {
  const resolved = await resolveInside(root, relativeDirectory);
  if (!resolved.ok) return resolved;
  let entries;
  try {
    entries = await readdir(resolved.value, { withFileTypes: true });
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? success([])
      : failure("PROFILE_SOURCE_NAMESPACE_READ_FAILED", String(error), relativeDirectory);
  }
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => compareUtf8(left.name, right.name))) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      return failure("PROFILE_TARGET_UNSAFE", "symbolic links are forbidden", relativePath);
    }
    if (entry.isDirectory()) {
      const nested = await walkFiles(root, relativePath);
      if (!nested.ok) return nested;
      files.push(...nested.value);
    } else if (entry.isFile()) files.push(relativePath);
    else return failure("PROFILE_TARGET_UNSAFE", "special files are forbidden", relativePath);
  }
  return success(files.sort(compareUtf8));
}

function relationshipRoot(profile: ResolvedProfile): RootAddress | null {
  const record = profile.root_relationships[0];
  if (record === undefined) return null;
  return record.kind === "portfolio-child"
    ? record.portfolio
    : record.kind === "shared-platform-provider"
      ? record.provider
      : record.consumer;
}

function requiredProfilePaths(lock: ProfileLock): RuntimeResult<readonly string[]> {
  const required = [
    PROJECT_SOURCE_PATH,
    ...lock.profile.components.map(
      (component) =>
        `docs/project-memory/components/${component.instance_id}/COMPONENT.md`,
    ),
    ...lock.profile.domains.map(
      (domain) => `docs/project-memory/domains/${domain.instance_id}/DOMAIN.md`,
    ),
    ...(lock.profile.root_relationships.length === 0 ? [] : [RELATIONSHIPS_PATH]),
  ];
  for (const pathValue of required) {
    if (!lock.accepted_source_entries.some((entry) => entry.target_path === pathValue)) {
      return failure(
        "PROFILE_SOURCE_LOCK_ENTRY_MISSING",
        "resolved profile source has no profile-lock entry",
        pathValue,
      );
    }
  }
  return success(required);
}

export async function verifyProfileSources(
  root: URL,
  lock: ProfileLock,
): Promise<RuntimeResult<readonly string[]>> {
  const required = requiredProfilePaths(lock);
  if (!required.ok) return required;
  const grouped = new Map<string, AcceptedSourceLockEntry[]>();
  for (const entry of lock.accepted_source_entries) {
    const values = grouped.get(entry.target_path) ?? [];
    values.push(entry);
    grouped.set(entry.target_path, values);
  }
  const expected = new Set([
    ...required.value,
    CONSTRAINTS_PATH,
    POLICIES_PATH,
    ...grouped.keys(),
  ]);
  const checked: string[] = [];
  for (const pathValue of [...expected].sort(compareUtf8)) {
    const bytes = await requiredBytes(root, pathValue);
    if (!bytes.ok) return bytes;
    const entries = grouped.get(pathValue) ?? [];
    if (entries.length > 0) {
      const hashes = new Set(entries.map((entry) => entry.sha256));
      if (hashes.size !== 1 || !hashes.has(sha256(bytes.value))) {
        return failure(
          "PROFILE_SOURCE_HASH_MISMATCH",
          "accepted source bytes do not match all profile-lock entries",
          pathValue,
        );
      }
    }
    const first = entries[0];
    if (first !== undefined && ["project", "component", "domain"].includes(first.kind)) {
      for (const entry of entries) {
        const verified = verifyCanonicalSource(bytes.value, entry, lock.root_id);
        if (!verified.ok) return verified;
      }
    } else if (pathValue === RELATIONSHIPS_PATH) {
      if (entries.some((entry) => entry.kind !== "root-relationship")) {
        return failure("PROFILE_SOURCE_ENVELOPE_MISMATCH", "relationship entry kind is invalid", pathValue);
      }
      const local = relationshipRoot(lock.profile);
      if (local === null) {
        return failure("PROFILE_SOURCE_ENVELOPE_MISMATCH", "relationship root is missing", pathValue);
      }
      const rendered = renderRootRelationships(local, lock.profile.root_relationships);
      if (!rendered.ok) return rendered;
      if (rendered.value === null || !byteEqual(rendered.value, bytes.value)) {
        return failure("PROFILE_SOURCE_HASH_MISMATCH", "relationship source is inconsistent", pathValue);
      }
    } else {
      const verified = verifyAcceptedList(bytes.value, pathValue, entries, lock);
      if (!verified.ok) return verified;
    }
    checked.push(pathValue);
  }
  for (const directory of [
    "docs/project-memory/source",
    "docs/project-memory/components",
    "docs/project-memory/domains",
  ]) {
    const files = await walkFiles(root, directory);
    if (!files.ok) return files;
    for (const pathValue of files.value) {
      if (!expected.has(pathValue)) {
        return failure(
          "PROFILE_SOURCE_UNLISTED_TARGET",
          "compiler-owned accepted-source namespace contains an unlisted file",
          pathValue,
        );
      }
    }
  }
  return success(checked.sort(compareUtf8));
}
