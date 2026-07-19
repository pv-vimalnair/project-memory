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

import {
  initPlanHash,
  type InitPlan,
} from "../cli/init/build-init-plan.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";

const MAX_ACTIVE_PROPOSALS = 8;
const HANDLE_PATTERN = /^pm-proposal-[0-9a-f]{32}$/u;
const CACHE_FILE_PATTERN = /^(pm-proposal-[0-9a-f]{32})[.]bin$/u;

export interface StoredBootstrapProposal {
  readonly root: URL;
  readonly plan: InitPlan;
}

export interface IssuedProposal {
  readonly handle: string;
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
  issue(root: URL, plan: InitPlan): ProposalStoreResult<IssuedProposal>;
  resolve(handle: string): ProposalStoreResult<StoredBootstrapProposal>;
  consume(handle: string): ProposalStoreResult<StoredBootstrapProposal>;
}

export interface FileProposalStoreDependencies extends ProposalStoreDependencies {
  readonly cache_root: string;
}

interface StoredProposalEnvelope {
  readonly schema_version: "1.0.0";
  readonly root: string;
  readonly plan: InitPlan;
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

function cloneProposal(proposal: StoredBootstrapProposal): StoredBootstrapProposal {
  return {
    root: new URL(proposal.root.href),
    plan: structuredClone(proposal.plan),
  };
}

function validExpiry(plan: InitPlan): number | null {
  const expiresAt = Date.parse(plan.replay.expires_at);
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

function exactPlan(plan: InitPlan): boolean {
  try {
    return initPlanHash(plan) === plan.plan_hash;
  } catch {
    return false;
  }
}

function storedEnvelope(value: unknown): value is StoredProposalEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  const plan = candidate.plan;
  return candidate.schema_version === "1.0.0" &&
    typeof candidate.root === "string" &&
    typeof plan === "object" &&
    plan !== null &&
    typeof (plan as Readonly<Record<string, unknown>>).plan_hash === "string" &&
    typeof (plan as Readonly<Record<string, unknown>>).replay === "object";
}

export class InMemoryProposalStore implements ProposalStore {
  readonly #proposals = new Map<string, StoredBootstrapProposal>();

  constructor(private readonly dependencies: ProposalStoreDependencies = defaultDependencies()) {}

  issue(root: URL, plan: InitPlan): RuntimeResult<IssuedProposal> {
    this.pruneExpired();
    if (this.#proposals.size >= MAX_ACTIVE_PROPOSALS) {
      return failure(
        "HOST_PROPOSAL_CACHE_FULL",
        "proposal cache contains eight active plans",
      );
    }
    const handle = this.dependencies.handle();
    if (this.#proposals.has(handle)) {
      return failure(
        "HOST_PROPOSAL_HANDLE_COLLISION",
        "proposal handle generator returned an active handle",
      );
    }
    this.#proposals.set(handle, cloneProposal({ root, plan }));
    return success({
      handle,
      plan_hash: plan.plan_hash,
      expected_head: plan.expected_head,
      expires_at: plan.replay.expires_at,
    });
  }

  resolve(handle: string): RuntimeResult<StoredBootstrapProposal> {
    const proposal = this.#proposals.get(handle);
    if (proposal === undefined) {
      return failure(
        "HOST_PROPOSAL_NOT_FOUND",
        "proposal handle is unknown or already consumed",
        handle,
      );
    }
    if (this.expired(proposal)) {
      this.#proposals.delete(handle);
      return failure(
        "HOST_PROPOSAL_EXPIRED",
        "proposal handle has expired",
        handle,
      );
    }
    return success(cloneProposal(proposal));
  }

  consume(handle: string): RuntimeResult<StoredBootstrapProposal> {
    const proposal = this.resolve(handle);
    if (!proposal.ok) return proposal;
    this.#proposals.delete(handle);
    return proposal;
  }

  private expired(proposal: StoredBootstrapProposal): boolean {
    const expiresAt = validExpiry(proposal.plan);
    return expiresAt === null || expiresAt <= this.dependencies.now().getTime();
  }

  private pruneExpired(): void {
    for (const [handle, proposal] of this.#proposals) {
      if (this.expired(proposal)) this.#proposals.delete(handle);
    }
  }
}

export class FileProposalStore implements ProposalStore {
  constructor(
    private readonly dependencies: FileProposalStoreDependencies = defaultFileDependencies(),
  ) {}

  async issue(root: URL, plan: InitPlan): Promise<RuntimeResult<IssuedProposal>> {
    const ready = await this.ensureCacheRoot();
    if (!ready.ok) return ready;
    const active = await this.pruneExpired();
    if (!active.ok) return active;
    if (active.value >= MAX_ACTIVE_PROPOSALS) {
      return failure(
        "HOST_PROPOSAL_CACHE_FULL",
        "proposal cache contains eight active plans",
      );
    }
    const expiresAt = validExpiry(plan);
    if (
      root.protocol !== "file:" ||
      expiresAt === null ||
      expiresAt <= this.dependencies.now().getTime() ||
      !exactPlan(plan)
    ) {
      return failure(
        "HOST_PROPOSAL_INVALID",
        "proposal store requires one current exact plan bound to a local repository",
      );
    }
    const handle = this.dependencies.handle();
    if (!HANDLE_PATTERN.test(handle)) {
      return failure(
        "HOST_PROPOSAL_HANDLE_INVALID",
        "proposal handle generator returned an invalid handle",
      );
    }
    const envelope: StoredProposalEnvelope = {
      schema_version: "1.0.0",
      root: root.href,
      plan: structuredClone(plan),
    };
    try {
      await writeFile(this.filePath(handle), serialize(envelope), {
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
    return success({
      handle,
      plan_hash: plan.plan_hash,
      expected_head: plan.expected_head,
      expires_at: plan.replay.expires_at,
    });
  }

  async resolve(handle: string): Promise<RuntimeResult<StoredBootstrapProposal>> {
    if (!HANDLE_PATTERN.test(handle)) return this.notFound(handle);
    const ready = await this.ensureCacheRoot();
    if (!ready.ok) return ready;
    const proposal = await this.readProposal(handle);
    if (!proposal.ok) return proposal;
    const expiresAt = validExpiry(proposal.value.plan);
    if (expiresAt === null || expiresAt <= this.dependencies.now().getTime()) {
      await this.remove(handle);
      return failure(
        "HOST_PROPOSAL_EXPIRED",
        "proposal handle has expired",
        handle,
      );
    }
    return success(cloneProposal(proposal.value));
  }

  async consume(handle: string): Promise<RuntimeResult<StoredBootstrapProposal>> {
    const proposal = await this.resolve(handle);
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

  private async readProposal(
    handle: string,
  ): Promise<RuntimeResult<StoredBootstrapProposal>> {
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
    if (!storedEnvelope(decoded)) {
      return failure(
        "HOST_PROPOSAL_CORRUPT",
        "proposal cache entry has an incompatible shape",
        handle,
      );
    }
    let root: URL;
    try {
      root = new URL(decoded.root);
    } catch {
      return failure(
        "HOST_PROPOSAL_CORRUPT",
        "proposal cache entry contains an invalid repository",
        handle,
      );
    }
    if (root.protocol !== "file:" || !exactPlan(decoded.plan)) {
      return failure(
        "HOST_PROPOSAL_CORRUPT",
        "proposal cache entry does not preserve the exact reviewed plan",
        handle,
      );
    }
    return success({ root, plan: decoded.plan });
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
      const expiresAt = validExpiry(proposal.value.plan);
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
