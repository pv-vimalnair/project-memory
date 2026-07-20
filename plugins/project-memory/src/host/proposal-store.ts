import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deserialize, serialize } from "node:v8";

import type { InitPlan } from "../cli/init/build-init-plan.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import {
  cloneProposalEnvelope,
  decodedProposalEntry,
  normalizeProposalIssue,
  parsedProposalTimestamp,
  persistedProposalEntry,
  proposalEntryValid,
  proposalExpiryForIssue,
  proposalIssuedFields,
  type StoredProposalEntry,
  type StoredProposalEnvelope,
  type StoredProposalKind,
} from "./proposal-envelope.js";

export type {
  StoredBootstrapProposal,
  StoredProposalEnvelope,
  StoredProposalKind,
} from "./proposal-envelope.js";

const MAX_ACTIVE_PROPOSALS = 8;
const HANDLE_PATTERN = /^pm-proposal-[0-9a-f]{32}$/u;
const CACHE_FILE_PATTERN = /^(pm-proposal-[0-9a-f]{32})[.]bin$/u;

export interface IssuedProposal {
  readonly handle: string;
  readonly kind: StoredProposalKind;
  readonly plan_hash: string;
  readonly expected_head: string;
  readonly expires_at: string;
}

export interface ProposalStoreDependencies {
  readonly now: () => Date;
  readonly handle: () => string;
}

export type ProposalStoreResult<T> = RuntimeResult<T> | Promise<RuntimeResult<T>>;

export interface ProposalStore {
  issue(value: StoredProposalEnvelope): ProposalStoreResult<IssuedProposal>;
  issue(root: URL, plan: InitPlan): ProposalStoreResult<IssuedProposal>;
  resolve<K extends StoredProposalKind>(
    handle: string,
    expectedKind: K,
  ): ProposalStoreResult<Extract<StoredProposalEnvelope, { readonly kind: K }>>;
  resolve(handle: string): ProposalStoreResult<StoredProposalEnvelope>;
  consume<K extends StoredProposalKind>(
    handle: string,
    expectedKind: K,
  ): ProposalStoreResult<Extract<StoredProposalEnvelope, { readonly kind: K }>>;
  consume(handle: string): ProposalStoreResult<StoredProposalEnvelope>;
}

export interface FileProposalStoreDependencies extends ProposalStoreDependencies {
  readonly cache_root: string;
}

function defaultDependencies(): ProposalStoreDependencies {
  return {
    now: () => new Date(),
    handle: () => `pm-proposal-${randomBytes(16).toString("hex")}`,
  };
}

function defaultFileDependencies(): FileProposalStoreDependencies {
  return {
    ...defaultDependencies(),
    cache_root: path.join(tmpdir(), "project-memory", "proposal-cache-v1"),
  };
}

function issueResult(
  handle: string,
  entry: StoredProposalEntry,
): RuntimeResult<IssuedProposal> {
  return success({
    handle,
    kind: entry.value.kind,
    ...proposalIssuedFields(entry.value),
    expires_at: entry.expires_at,
  });
}

function kindMismatch(
  handle: string,
  expectedKind: StoredProposalKind,
  actualKind: StoredProposalKind,
): RuntimeResult<never> {
  return failure(
    "HOST_PROPOSAL_KIND_MISMATCH",
    `proposal handle contains ${actualKind}, not ${expectedKind}`,
    handle,
  );
}

export class InMemoryProposalStore implements ProposalStore {
  readonly #proposals = new Map<string, StoredProposalEntry>();

  constructor(private readonly dependencies: ProposalStoreDependencies = defaultDependencies()) {}

  issue(value: StoredProposalEnvelope): RuntimeResult<IssuedProposal>;
  issue(root: URL, plan: InitPlan): RuntimeResult<IssuedProposal>;
  issue(
    valueOrRoot: StoredProposalEnvelope | URL,
    plan?: InitPlan,
  ): RuntimeResult<IssuedProposal> {
    this.pruneExpired();
    const value = normalizeProposalIssue(valueOrRoot, plan);
    const now = this.dependencies.now();
    const expiresAt = value === null ? null : proposalExpiryForIssue(value, now);
    const expiryMilliseconds =
      expiresAt === null ? null : parsedProposalTimestamp(expiresAt);
    if (
      value === null ||
      expiresAt === null ||
      expiryMilliseconds === null ||
      expiryMilliseconds <= now.getTime()
    ) {
      return failure(
        "HOST_PROPOSAL_INVALID",
        "proposal store requires one current exact envelope bound to a local repository",
      );
    }
    const entry = { value, expires_at: expiresAt };
    if (!proposalEntryValid(entry, now)) {
      return failure(
        "HOST_PROPOSAL_INVALID",
        "proposal store requires one current exact envelope bound to a local repository",
      );
    }
    if (this.#proposals.size >= MAX_ACTIVE_PROPOSALS) {
      return failure(
        "HOST_PROPOSAL_CACHE_FULL",
        "proposal cache contains eight active plans",
      );
    }
    const handle = this.dependencies.handle();
    if (!HANDLE_PATTERN.test(handle)) {
      return failure(
        "HOST_PROPOSAL_HANDLE_INVALID",
        "proposal handle generator returned an invalid handle",
      );
    }
    if (this.#proposals.has(handle)) {
      return failure(
        "HOST_PROPOSAL_HANDLE_COLLISION",
        "proposal handle generator returned an active handle",
      );
    }
    const stored = {
      value: cloneProposalEnvelope(value),
      expires_at: expiresAt,
    };
    this.#proposals.set(handle, stored);
    return issueResult(handle, stored);
  }

  resolve<K extends StoredProposalKind>(
    handle: string,
    expectedKind: K,
  ): RuntimeResult<Extract<StoredProposalEnvelope, { readonly kind: K }>>;
  resolve(handle: string): RuntimeResult<StoredProposalEnvelope>;
  resolve(
    handle: string,
    expectedKind?: StoredProposalKind,
  ): RuntimeResult<StoredProposalEnvelope> {
    const entry = this.#proposals.get(handle);
    if (entry === undefined) return this.notFound(handle);
    const expiresAt = parsedProposalTimestamp(entry.expires_at);
    if (expiresAt === null || expiresAt <= this.dependencies.now().getTime()) {
      this.#proposals.delete(handle);
      return failure("HOST_PROPOSAL_EXPIRED", "proposal handle has expired", handle);
    }
    if (!proposalEntryValid(entry, this.dependencies.now())) {
      return failure("HOST_PROPOSAL_CORRUPT", "proposal cache entry failed validation", handle);
    }
    if (expectedKind !== undefined && entry.value.kind !== expectedKind) {
      return kindMismatch(handle, expectedKind, entry.value.kind);
    }
    return success(cloneProposalEnvelope(entry.value));
  }

  consume<K extends StoredProposalKind>(
    handle: string,
    expectedKind: K,
  ): RuntimeResult<Extract<StoredProposalEnvelope, { readonly kind: K }>>;
  consume(handle: string): RuntimeResult<StoredProposalEnvelope>;
  consume(
    handle: string,
    expectedKind?: StoredProposalKind,
  ): RuntimeResult<StoredProposalEnvelope> {
    const proposal = expectedKind === undefined
      ? this.resolve(handle)
      : this.resolve(handle, expectedKind);
    if (!proposal.ok) return proposal;
    this.#proposals.delete(handle);
    return proposal;
  }

  private notFound(handle: string): RuntimeResult<never> {
    return failure(
      "HOST_PROPOSAL_NOT_FOUND",
      "proposal handle is unknown or already consumed",
      handle,
    );
  }

  private pruneExpired(): void {
    const now = this.dependencies.now().getTime();
    for (const [handle, entry] of this.#proposals) {
      const expiresAt = parsedProposalTimestamp(entry.expires_at);
      if (expiresAt === null || expiresAt <= now) this.#proposals.delete(handle);
    }
  }
}

export class FileProposalStore implements ProposalStore {
  constructor(
    private readonly dependencies: FileProposalStoreDependencies = defaultFileDependencies(),
  ) {}

  issue(value: StoredProposalEnvelope): Promise<RuntimeResult<IssuedProposal>>;
  issue(root: URL, plan: InitPlan): Promise<RuntimeResult<IssuedProposal>>;
  async issue(
    valueOrRoot: StoredProposalEnvelope | URL,
    plan?: InitPlan,
  ): Promise<RuntimeResult<IssuedProposal>> {
    const ready = await this.ensureCacheRoot();
    if (!ready.ok) return ready;
    const active = await this.pruneExpired();
    if (!active.ok) return active;
    const value = normalizeProposalIssue(valueOrRoot, plan);
    const now = this.dependencies.now();
    const expiresAt = value === null ? null : proposalExpiryForIssue(value, now);
    const expiryMilliseconds =
      expiresAt === null ? null : parsedProposalTimestamp(expiresAt);
    if (
      value === null ||
      expiresAt === null ||
      expiryMilliseconds === null ||
      expiryMilliseconds <= now.getTime()
    ) {
      return failure(
        "HOST_PROPOSAL_INVALID",
        "proposal store requires one current exact envelope bound to a local repository",
      );
    }
    const entry = { value, expires_at: expiresAt };
    if (!proposalEntryValid(entry, now)) {
      return failure(
        "HOST_PROPOSAL_INVALID",
        "proposal store requires one current exact envelope bound to a local repository",
      );
    }
    if (active.value >= MAX_ACTIVE_PROPOSALS) {
      return failure(
        "HOST_PROPOSAL_CACHE_FULL",
        "proposal cache contains eight active plans",
      );
    }
    const handle = this.dependencies.handle();
    if (!HANDLE_PATTERN.test(handle)) {
      return failure(
        "HOST_PROPOSAL_HANDLE_INVALID",
        "proposal handle generator returned an invalid handle",
      );
    }
    const stored = {
      value: cloneProposalEnvelope(value),
      expires_at: expiresAt,
    };
    try {
      await writeFile(this.filePath(handle), serialize(persistedProposalEntry(stored)), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error: unknown) {
      return failure(
        (error as NodeJS.ErrnoException).code === "EEXIST"
          ? "HOST_PROPOSAL_HANDLE_COLLISION"
          : "HOST_PROPOSAL_STORE_UNAVAILABLE",
        error instanceof Error ? error.message : String(error),
        handle,
      );
    }
    return issueResult(handle, stored);
  }

  resolve<K extends StoredProposalKind>(
    handle: string,
    expectedKind: K,
  ): Promise<RuntimeResult<Extract<StoredProposalEnvelope, { readonly kind: K }>>>;
  resolve(handle: string): Promise<RuntimeResult<StoredProposalEnvelope>>;
  async resolve(
    handle: string,
    expectedKind?: StoredProposalKind,
  ): Promise<RuntimeResult<StoredProposalEnvelope>> {
    if (!HANDLE_PATTERN.test(handle)) return this.notFound(handle);
    const ready = await this.ensureCacheRoot();
    if (!ready.ok) return ready;
    const entry = await this.readProposal(handle);
    if (!entry.ok) return entry;
    const expiresAt = parsedProposalTimestamp(entry.value.expires_at);
    if (expiresAt === null || expiresAt <= this.dependencies.now().getTime()) {
      await this.remove(handle);
      return failure("HOST_PROPOSAL_EXPIRED", "proposal handle has expired", handle);
    }
    if (expectedKind !== undefined && entry.value.value.kind !== expectedKind) {
      return kindMismatch(handle, expectedKind, entry.value.value.kind);
    }
    return success(cloneProposalEnvelope(entry.value.value));
  }

  consume<K extends StoredProposalKind>(
    handle: string,
    expectedKind: K,
  ): Promise<RuntimeResult<Extract<StoredProposalEnvelope, { readonly kind: K }>>>;
  consume(handle: string): Promise<RuntimeResult<StoredProposalEnvelope>>;
  async consume(
    handle: string,
    expectedKind?: StoredProposalKind,
  ): Promise<RuntimeResult<StoredProposalEnvelope>> {
    const proposal = expectedKind === undefined
      ? await this.resolve(handle)
      : await this.resolve(handle, expectedKind);
    if (!proposal.ok) return proposal;
    const removed = await this.remove(handle);
    return removed.ok ? proposal : removed;
  }

  private filePath(handle: string): string {
    return path.join(this.dependencies.cache_root, `${handle}.bin`);
  }

  private notFound(handle: string): RuntimeResult<never> {
    return failure(
      "HOST_PROPOSAL_NOT_FOUND",
      "proposal handle is unknown or already consumed",
      handle,
    );
  }

  private async ensureCacheRoot(): Promise<RuntimeResult<true>> {
    try {
      await mkdir(this.dependencies.cache_root, { recursive: true, mode: 0o700 });
      const stat = await lstat(this.dependencies.cache_root);
      return !stat.isSymbolicLink() && stat.isDirectory()
        ? success(true)
        : failure(
            "HOST_PROPOSAL_STORE_UNSAFE",
            "proposal cache root must be a regular directory",
            this.dependencies.cache_root,
          );
    } catch (error: unknown) {
      return failure(
        "HOST_PROPOSAL_STORE_UNAVAILABLE",
        error instanceof Error ? error.message : String(error),
        this.dependencies.cache_root,
      );
    }
  }

  private async readProposal(handle: string): Promise<RuntimeResult<StoredProposalEntry>> {
    const target = this.filePath(handle);
    let bytes: Buffer;
    try {
      const stat = await lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        return failure(
          "HOST_PROPOSAL_STORE_UNSAFE",
          "proposal cache entry must be a regular file",
          handle,
        );
      }
      bytes = await readFile(target);
    } catch (error: unknown) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? this.notFound(handle)
        : failure(
            "HOST_PROPOSAL_STORE_UNAVAILABLE",
            error instanceof Error ? error.message : String(error),
            handle,
          );
    }
    let decoded: unknown;
    try {
      decoded = deserialize(bytes);
    } catch {
      return failure(
        "HOST_PROPOSAL_CORRUPT",
        "proposal cache entry could not be decoded",
        handle,
      );
    }
    const entry = decodedProposalEntry(decoded, this.dependencies.now());
    return entry === null
      ? failure(
          "HOST_PROPOSAL_CORRUPT",
          "proposal cache entry has an invalid shape or binding",
          handle,
        )
      : success(entry);
  }

  private async remove(handle: string): Promise<RuntimeResult<true>> {
    try {
      await unlink(this.filePath(handle));
      return success(true);
    } catch (error: unknown) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? this.notFound(handle)
        : failure(
            "HOST_PROPOSAL_STORE_UNAVAILABLE",
            error instanceof Error ? error.message : String(error),
            handle,
          );
    }
  }

  private async pruneExpired(): Promise<RuntimeResult<number>> {
    let entries;
    try {
      entries = await readdir(this.dependencies.cache_root, { withFileTypes: true });
    } catch (error: unknown) {
      return failure(
        "HOST_PROPOSAL_STORE_UNAVAILABLE",
        error instanceof Error ? error.message : String(error),
        this.dependencies.cache_root,
      );
    }
    let active = 0;
    for (const entry of entries) {
      const matched = CACHE_FILE_PATTERN.exec(entry.name);
      if (matched === null) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) {
        return failure(
          "HOST_PROPOSAL_STORE_UNSAFE",
          "proposal cache entries must be regular files",
          entry.name,
        );
      }
      const handle = matched[1];
      if (handle === undefined) continue;
      const proposal = await this.readProposal(handle);
      if (!proposal.ok) return proposal;
      const expiresAt = parsedProposalTimestamp(proposal.value.expires_at);
      if (expiresAt === null || expiresAt <= this.dependencies.now().getTime()) {
        const removed = await this.remove(handle);
        if (!removed.ok) return removed;
      } else {
        active += 1;
      }
    }
    return success(active);
  }
}
