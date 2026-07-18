import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";

function comparisonPath(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isSameOrChildPath(rootPath: string, candidatePath: string): boolean {
  const root = comparisonPath(rootPath);
  const candidate = comparisonPath(candidatePath);
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function pathFailure(
  code: "PATH_ESCAPE" | "PATH_INVALID" | "PATH_ROOT_INVALID",
  relativePath: string,
  message: string,
): RuntimeResult<URL> {
  return failure(code, message, relativePath);
}

async function closestExistingAncestor(targetPath: string): Promise<string> {
  let candidate = targetPath;
  for (;;) {
    try {
      await lstat(candidate);
      return candidate;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

async function verifyExistingAncestors(
  rootPath: string,
  targetPath: string,
  relativePath: string,
): Promise<RuntimeResult<URL>> {
  try {
    const [rootRealPath, existingAncestor] = await Promise.all([
      realpath(rootPath),
      closestExistingAncestor(targetPath),
    ]);
    const ancestorRealPath = await realpath(existingAncestor);
    if (!isSameOrChildPath(rootRealPath, ancestorRealPath)) {
      return pathFailure(
        "PATH_ESCAPE",
        relativePath,
        "an existing path ancestor resolves outside the repository root",
      );
    }
    return success(pathToFileURL(targetPath));
  } catch (error: unknown) {
    return pathFailure(
      "PATH_ROOT_INVALID",
      relativePath,
      `could not verify repository path: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function resolveInside(
  root: URL,
  relativePath: string,
): Promise<RuntimeResult<URL>> {
  if (root.protocol !== "file:") {
    return pathFailure("PATH_ROOT_INVALID", relativePath, "root must be a file URL");
  }
  if (
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.isAbsolute(relativePath) ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    /^[A-Za-z]:/.test(relativePath)
  ) {
    return pathFailure(
      "PATH_INVALID",
      relativePath,
      "path must be a non-empty repository-relative path using forward slashes",
    );
  }

  let rootPath: string;
  try {
    rootPath = path.resolve(fileURLToPath(root));
  } catch (error: unknown) {
    return pathFailure(
      "PATH_ROOT_INVALID",
      relativePath,
      error instanceof Error ? error.message : String(error),
    );
  }

  const targetPath = path.resolve(rootPath, relativePath);
  if (!isSameOrChildPath(rootPath, targetPath)) {
    return pathFailure(
      "PATH_ESCAPE",
      relativePath,
      "path resolves outside the repository root",
    );
  }

  return verifyExistingAncestors(rootPath, targetPath, relativePath);
}
