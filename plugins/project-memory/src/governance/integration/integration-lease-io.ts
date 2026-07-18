import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  canonicalJson,
  decodeStrictUtf8,
  failure,
  parseJsonDocument,
  sha256,
  success,
  validateWithSchema,
  type Clock,
  type RuntimeIssue,
  type RuntimeResult,
} from "../../index.js";
import type { IntegrationLease } from "../contracts/index.js";

const MUTEX_TTL_MS = 30_000;
const MUTEX_RETRIES = 1_000;
const MUTEX_RETRY_MS = 5;

interface MutexOwner {
  readonly holder_id: string;
  readonly nonce: string;
  readonly acquired_at: string;
  readonly expires_at: string;
}

interface MutexNonceSource {
  nextNonce(): string;
}

export function leaseUrl(commonGitDir: URL): URL {
  return new URL("project-memory/integration-lease.json", commonGitDir);
}

export function mutexUrl(commonGitDir: URL): URL {
  return new URL("project-memory/integration-lease.mutex/", commonGitDir);
}

function projectMemoryUrl(commonGitDir: URL): URL {
  return new URL("project-memory/", commonGitDir);
}

function mutexOwnerUrl(commonGitDir: URL): URL {
  return new URL("owner.json", mutexUrl(commonGitDir));
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

function validateLease(value: unknown, source: string): RuntimeResult<IntegrationLease> {
  const result = validateWithSchema<IntegrationLease>(
    "project-memory/v1/integration-lease",
    value,
  );
  return result.ok
    ? result
    : translatedFailure(
        "lease.schema_invalid",
        "integration lease does not satisfy its registered schema",
        source,
        result.issues,
      );
}

export async function readIntegrationLease(
  commonGitDir: URL,
): Promise<RuntimeResult<IntegrationLease | null>> {
  const target = leaseUrl(commonGitDir);
  let bytes: Uint8Array;
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) {
      return failure(
        "lease.path_unsafe",
        "integration lease must be a regular file",
        target.href,
      );
    }
    bytes = new Uint8Array(await readFile(target));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return success(null);
    return failure(
      "lease.read_failed",
      error instanceof Error ? error.message : String(error),
      target.href,
    );
  }
  const decoded = decodeStrictUtf8(bytes, target.href);
  if (!decoded.ok) return decoded;
  const parsed = parseJsonDocument(decoded.value, target.href);
  if (!parsed.ok) return parsed;
  const lease = validateLease(parsed.value, target.href);
  if (!lease.ok) return lease;
  const canonical = new TextEncoder().encode(canonicalJson(lease.value));
  if (!Buffer.from(bytes).equals(Buffer.from(canonical))) {
    return failure(
      "lease.noncanonical",
      "integration lease bytes must use canonical JSON",
      target.href,
    );
  }
  return success(lease.value);
}

export async function writeIntegrationLease(
  commonGitDir: URL,
  lease: IntegrationLease,
  nonce: string,
): Promise<RuntimeResult<void>> {
  const validated = validateLease(lease, leaseUrl(commonGitDir).href);
  if (!validated.ok) return validated;
  const parent = projectMemoryUrl(commonGitDir);
  const target = leaseUrl(commonGitDir);
  const temporary = new URL(
    `integration-lease.tmp-${sha256(nonce).slice(0, 20)}.json`,
    parent,
  );
  try {
    await mkdir(parent, { recursive: true });
    await writeFile(temporary, canonicalJson(validated.value), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, target);
    return success(undefined);
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined);
    return failure(
      "lease.write_failed",
      error instanceof Error ? error.message : String(error),
      target.href,
    );
  }
}

export async function deleteIntegrationLease(
  commonGitDir: URL,
): Promise<RuntimeResult<void>> {
  try {
    await unlink(leaseUrl(commonGitDir));
    return success(undefined);
  } catch (error: unknown) {
    return failure(
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "lease.not_found"
        : "lease.release_failed",
      error instanceof Error ? error.message : String(error),
      leaseUrl(commonGitDir).href,
    );
  }
}

function validMutexOwner(value: unknown): value is MutexOwner {
  if (typeof value !== "object" || value === null) return false;
  const owner = value as Readonly<Record<string, unknown>>;
  return (
    typeof owner.holder_id === "string" &&
    typeof owner.nonce === "string" &&
    typeof owner.acquired_at === "string" &&
    typeof owner.expires_at === "string" &&
    Number.isFinite(Date.parse(owner.expires_at))
  );
}

async function mutexOwner(commonGitDir: URL): Promise<RuntimeResult<MutexOwner>> {
  try {
    const parsed = JSON.parse(await readFile(mutexOwnerUrl(commonGitDir), "utf8")) as unknown;
    if (validMutexOwner(parsed)) return success(parsed);
  } catch {
    // A contender can observe owner.json while its winning writer is still
    // flushing. Treat missing or partial metadata as an active unknown owner.
  }
  try {
    const info = await stat(mutexUrl(commonGitDir));
    const acquiredAt = info.mtime.toISOString();
    return success({
      holder_id: "unknown-crashed-holder",
      nonce: "unknown-crashed-nonce".padEnd(32, "-"),
      acquired_at: acquiredAt,
      expires_at: new Date(info.mtimeMs + MUTEX_TTL_MS).toISOString(),
    });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return failure(
        "lease.mutex_disappeared",
        "integration mutex disappeared during inspection",
        mutexUrl(commonGitDir).href,
      );
    }
    return failure(
      "lease.mutex_owner_read_failed",
      error instanceof Error ? error.message : String(error),
      mutexUrl(commonGitDir).href,
    );
  }
}
async function recoverExpiredMutex(
  commonGitDir: URL,
  now: Date,
  nonce: string,
): Promise<RuntimeResult<boolean>> {
  const mutex = mutexUrl(commonGitDir);
  try {
    const info = await lstat(mutex);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      return failure(
        "lease.mutex_unsafe",
        "integration mutex must be a real directory",
        mutex.href,
      );
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return success(true);
    return failure(
      "lease.mutex_read_failed",
      error instanceof Error ? error.message : String(error),
      mutex.href,
    );
  }
  const owner = await mutexOwner(commonGitDir);
  if (!owner.ok) {
    return owner.issues[0]?.code === "lease.mutex_disappeared" ? success(true) : owner;
  }
  if (Date.parse(owner.value.expires_at) > now.getTime()) return success(false);
  const quarantine = new URL(
    `integration-lease.mutex.quarantine-${sha256(nonce).slice(0, 20)}/`,
    projectMemoryUrl(commonGitDir),
  );
  try {
    await rename(mutex, quarantine);
    await rm(quarantine, { recursive: true, force: true });
    return success(true);
  } catch (error: unknown) {
    if (["ENOENT", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      return success(true);
    }
    return failure(
      "lease.mutex_recovery_failed",
      error instanceof Error ? error.message : String(error),
      mutex.href,
    );
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function releaseMutex(commonGitDir: URL, nonce: string): Promise<void> {
  const owner = await mutexOwner(commonGitDir);
  if (owner.ok && owner.value.nonce === nonce) {
    await rm(mutexUrl(commonGitDir), { recursive: true, force: true });
  }
}

export async function withIntegrationMutex<T>(
  commonGitDir: URL,
  holderId: string,
  clock: Clock,
  nonces: MutexNonceSource,
  operation: () => Promise<RuntimeResult<T>>,
): Promise<RuntimeResult<T>> {
  const ownerNonce = nonces.nextNonce();
  for (let attempt = 0; attempt < MUTEX_RETRIES; attempt += 1) {
    const now = clock.now();
    if (!Number.isFinite(now.getTime())) {
      return failure("lease.clock_invalid", "integration lease clock must be valid");
    }
    try {
      await mkdir(projectMemoryUrl(commonGitDir), { recursive: true });
      await mkdir(mutexUrl(commonGitDir));
      const owner: MutexOwner = {
        holder_id: holderId,
        nonce: ownerNonce,
        acquired_at: now.toISOString(),
        expires_at: new Date(now.getTime() + MUTEX_TTL_MS).toISOString(),
      };
      await writeFile(mutexOwnerUrl(commonGitDir), canonicalJson(owner), {
        encoding: "utf8",
        flag: "wx",
      });
      try {
        return await operation();
      } finally {
        await releaseMutex(commonGitDir, ownerNonce);
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        await releaseMutex(commonGitDir, ownerNonce);
        return failure(
          "lease.mutex_failed",
          error instanceof Error ? error.message : String(error),
          mutexUrl(commonGitDir).href,
        );
      }
      const recovered = await recoverExpiredMutex(commonGitDir, now, ownerNonce);
      if (!recovered.ok) return recovered;
      if (!recovered.value) await delay(MUTEX_RETRY_MS);
    }
  }
  return failure(
    "lease.mutex_timeout",
    "timed out waiting for integration lease mutex",
    mutexUrl(commonGitDir).href,
  );
}
