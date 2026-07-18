import { randomBytes } from "node:crypto";

import type { InitPlan } from "../cli/init/build-init-plan.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";

const MAX_ACTIVE_PROPOSALS = 8;

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

function defaultDependencies(): ProposalStoreDependencies {
  return {
    now: () => new Date(),
    handle: () => `pm-proposal-${randomBytes(16).toString("hex")}`,
  };
}

function cloneProposal(proposal: StoredBootstrapProposal): StoredBootstrapProposal {
  return {
    root: new URL(proposal.root.href),
    plan: structuredClone(proposal.plan),
  };
}

export class InMemoryProposalStore {
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
    const expiresAt = Date.parse(proposal.plan.replay.expires_at);
    return !Number.isFinite(expiresAt) || expiresAt <= this.dependencies.now().getTime();
  }

  private pruneExpired(): void {
    for (const [handle, proposal] of this.#proposals) {
      if (this.expired(proposal)) this.#proposals.delete(handle);
    }
  }
}
