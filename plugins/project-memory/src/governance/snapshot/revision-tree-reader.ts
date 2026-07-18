import {
  failure,
  runCommand,
  success,
  type CommandRunner,
  type RuntimeResult,
} from "../../index.js";

export interface RevisionSource {
  readonly kind: "commit" | "tree";
  readonly object_id: string;
}

export interface RevisionBlob {
  readonly relative_path: string;
  readonly object_id: string;
  readonly bytes: Uint8Array;
}

export interface RevisionTreeReader {
  readCanonicalBlobs(
    root: URL,
    source: RevisionSource,
  ): Promise<RuntimeResult<readonly RevisionBlob[]>>;
}

interface TreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly object_id: string;
  readonly relative_path: string;
}

const OBJECT_ID = /^[0-9a-f]{40}$/;

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function gitEnvironment(): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
  for (const name of ["PATH", "SystemRoot", "HOME", "USERPROFILE"]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

async function git(
  root: URL,
  runner: CommandRunner,
  args: readonly string[],
  maximumBytes = 16_777_216,
): Promise<RuntimeResult<string>> {
  const result = await runCommand(
    {
      executable: "git",
      args,
      cwd: root,
      timeout_ms: 30_000,
      env_allowlist: gitEnvironment(),
      max_output_bytes: maximumBytes,
    },
    runner,
  );
  if (!result.ok) return result;
  if (result.value.timed_out) {
    return failure("snapshot.git_timeout", "Git object read timed out");
  }
  if (result.value.output_truncated) {
    return failure("snapshot.git_output_truncated", "Git object output exceeded its bound");
  }
  if (result.value.exit_code !== 0) {
    return failure(
      "snapshot.git_failed",
      result.value.stderr.trim() ||
        `Git exited with ${String(result.value.exit_code)}`,
      args.join(" "),
    );
  }
  return success(result.value.stdout);
}

export function isForbiddenTruthSource(relativePath: string): boolean {
  return (
    relativePath.startsWith("docs/project-memory/views/") ||
    relativePath.startsWith("docs/project-memory/archive/")
  );
}

export function isCanonicalSnapshotPath(relativePath: string): boolean {
  if (isForbiddenTruthSource(relativePath) || relativePath.endsWith("/.gitkeep")) {
    return false;
  }
  if (
    relativePath === "docs/project-memory/project.yaml" ||
    relativePath === "docs/project-memory/profile.lock.yaml" ||
    relativePath === "docs/project-memory/catalog.lock.json"
  ) {
    return true;
  }
  return [
    "docs/project-memory/source/",
    "docs/project-memory/components/",
    "docs/project-memory/domains/",
    "docs/project-memory/initiatives/",
    "docs/project-memory/workstreams/",
    "docs/project-memory/records/",
    "docs/project-memory/governance/events/",
    "docs/project-memory/governance/claims/",
    "docs/project-memory/governance/integration/",
  ].some((prefix) => relativePath.startsWith(prefix));
}

function parseTreeEntries(value: string): RuntimeResult<readonly TreeEntry[]> {
  const rawEntries = value.split("\0");
  if (rawEntries.at(-1) === "") rawEntries.pop();
  const entries: TreeEntry[] = [];
  const paths = new Set<string>();
  for (const raw of rawEntries) {
    const tab = raw.indexOf("\t");
    if (tab < 0) {
      return failure("snapshot.tree_malformed", "Git ls-tree entry has no path delimiter");
    }
    const header = raw.slice(0, tab).split(" ");
    const [mode, type, objectId] = header;
    const relativePath = raw.slice(tab + 1);
    if (
      header.length !== 3 ||
      mode === undefined ||
      type === undefined ||
      objectId === undefined ||
      !OBJECT_ID.test(objectId) ||
      relativePath.length === 0
    ) {
      return failure(
        "snapshot.tree_malformed",
        "Git ls-tree returned a malformed canonical entry",
        relativePath,
      );
    }
    if (!isCanonicalSnapshotPath(relativePath)) continue;
    if (paths.has(relativePath)) {
      return failure(
        "snapshot.path_duplicate",
        "one Git tree cannot provide a canonical path more than once",
        relativePath,
      );
    }
    paths.add(relativePath);
    entries.push({ mode, type, object_id: objectId, relative_path: relativePath });
  }
  return success(entries.sort((left, right) => compareUtf8(left.relative_path, right.relative_path)));
}

async function verifySource(
  root: URL,
  source: RevisionSource,
  runner: CommandRunner,
): Promise<RuntimeResult<true>> {
  if (!OBJECT_ID.test(source.object_id)) {
    return failure(
      "snapshot.revision_invalid",
      "snapshot object IDs must be exact lowercase SHA-1 values",
      source.object_id,
    );
  }
  const type = await runCommand(
    {
      executable: "git",
      args: ["cat-file", "-t", source.object_id],
      cwd: root,
      timeout_ms: 30_000,
      env_allowlist: gitEnvironment(),
      max_output_bytes: 65_536,
    },
    runner,
  );
  if (!type.ok) return type;
  if (type.value.exit_code === 1 || type.value.exit_code === 128) {
    return failure(
      "snapshot.revision_not_found",
      "the requested Git object does not exist",
      source.object_id,
    );
  }
  if (
    type.value.exit_code !== 0 ||
    type.value.timed_out ||
    type.value.output_truncated
  ) {
    return failure(
      "snapshot.git_failed",
      type.value.stderr.trim() || "could not inspect requested Git object",
      source.object_id,
    );
  }
  if (type.value.stdout.trim() !== source.kind) {
    return failure(
      "snapshot.revision_type_mismatch",
      `requested ${source.kind} object has type ${type.value.stdout.trim()}`,
      source.object_id,
    );
  }
  const exists = await git(root, runner, [
    "cat-file",
    "-e",
    `${source.object_id}^{${source.kind}}`,
  ]);
  return exists.ok ? success(true) : exists;
}

export function createRevisionTreeReader(runner: CommandRunner): RevisionTreeReader {
  return {
    async readCanonicalBlobs(
      root: URL,
      source: RevisionSource,
    ): Promise<RuntimeResult<readonly RevisionBlob[]>> {
      const verified = await verifySource(root, source, runner);
      if (!verified.ok) return verified;
      const listed = await git(root, runner, [
        "ls-tree",
        "-rz",
        "--full-tree",
        source.object_id,
        "--",
        "docs/project-memory",
      ]);
      if (!listed.ok) return listed;
      const entries = parseTreeEntries(listed.value);
      if (!entries.ok) return entries;
      const blobs: RevisionBlob[] = [];
      for (const entry of entries.value) {
        if (entry.type !== "blob" || entry.mode !== "100644") {
          return failure(
            "snapshot.non_blob_entry",
            "canonical snapshot paths must be regular non-executable blobs",
            entry.relative_path,
            [entry.mode, entry.type],
          );
        }
        const content = await git(root, runner, [
          "cat-file",
          "blob",
          entry.object_id,
        ]);
        if (!content.ok) return content;
        blobs.push({
          relative_path: entry.relative_path,
          object_id: entry.object_id,
          bytes: new TextEncoder().encode(content.value),
        });
      }
      return success(blobs);
    },
  };
}
