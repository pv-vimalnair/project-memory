import { readFile } from "node:fs/promises";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseYamlDocument } from "../../src/core/document-io.js";
import { renderRootRelationships } from "../../src/materialize/render-root-relationships.js";
import type {
  PortfolioChildReference,
  RootAddress,
  SharedPlatformConsumerReference,
  SharedPlatformProviderReference,
} from "../../src/profile/contracts/index.js";
import { validateRootRelationships } from "../../src/profile/validate-root-ownership.js";
import { registerProfileSchemas } from "../../src/profile/contracts/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";

const PORTFOLIO_ROOT: RootAddress = {
  namespace: "acme.portfolio",
  root_id: "ROOT-01J00000000000000000000000",
  canonical_repository: "https://github.com/acme/portfolio-memory",
  profile_lock_hash: "a".repeat(64),
};
const CHILD_ROOT: RootAddress = {
  namespace: "lifeof.app",
  root_id: "ROOT-01J00000000000000000000001",
  canonical_repository: "https://github.com/acme/lifeof",
  profile_lock_hash: "b".repeat(64),
};
const PROVIDER_ROOT: RootAddress = {
  namespace: "acme.identity",
  root_id: "ROOT-01J00000000000000000000002",
  canonical_repository: "https://github.com/acme/identity-platform",
  profile_lock_hash: "c".repeat(64),
};
const CONSUMER_ROOT: RootAddress = {
  namespace: "lifeof.app",
  root_id: "ROOT-01J00000000000000000000003",
  canonical_repository: "https://github.com/acme/lifeof",
  profile_lock_hash: "d".repeat(64),
};

let portfolio: PortfolioChildReference;
let portfolioWithCopiedTruth: unknown;
let provider: SharedPlatformProviderReference;
let consumer: SharedPlatformConsumerReference;
let consumerRedefinition: SharedPlatformConsumerReference;

async function loadFixture<T>(name: string): Promise<T> {
  const text = await readFile(
    new URL(`../fixtures/profile/root-relationships/${name}`, import.meta.url),
    "utf8",
  );
  const parsed = parseYamlDocument(text, name);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value as T;
}

beforeAll(async () => {
  [
    portfolio,
    portfolioWithCopiedTruth,
    provider,
    consumer,
    consumerRedefinition,
  ] = await Promise.all([
    loadFixture<PortfolioChildReference>("portfolio-valid.yaml"),
    loadFixture<unknown>("portfolio-copied-child-truth.yaml"),
    loadFixture<SharedPlatformProviderReference>("platform-provider-valid.yaml"),
    loadFixture<SharedPlatformConsumerReference>("platform-consumer-valid.yaml"),
    loadFixture<SharedPlatformConsumerReference>(
      "platform-consumer-redefines-interface.yaml",
    ),
  ]);
});

beforeEach(() => {
  resetSchemaRegistryForTests();
  registerProfileSchemas();
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("root relationship ownership", () => {
  it("accepts each reference-only relationship contract", () => {
    expect(validateRootRelationships(PORTFOLIO_ROOT, [portfolio])).toMatchObject({
      ok: true,
    });
    expect(validateRootRelationships(PROVIDER_ROOT, [provider])).toMatchObject({
      ok: true,
    });
    expect(validateRootRelationships(CONSUMER_ROOT, [consumer])).toMatchObject({
      ok: true,
    });
  });

  it("rejects copied child truth in a portfolio root", () => {
    expect(
      validateRootRelationships(PORTFOLIO_ROOT, [portfolioWithCopiedTruth]),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "ROOT_RELATIONSHIP_CHILD_TRUTH_FORBIDDEN" }],
    });
  });

  it("rejects a consumer-owned redefinition of a provider interface", () => {
    expect(
      validateRootRelationships(CONSUMER_ROOT, [consumerRedefinition]),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "ROOT_RELATIONSHIP_INTERFACE_OWNER_MISMATCH" }],
    });
  });

  it("rejects invalid namespace syntax", () => {
    const invalid = {
      ...portfolio,
      child: { ...portfolio.child, namespace: "LifeOf App" },
    };
    expect(validateRootRelationships(PORTFOLIO_ROOT, [invalid])).toMatchObject({
      ok: false,
      issues: [{ code: "ROOT_RELATIONSHIP_SCHEMA_INVALID" }],
    });
  });

  it("rejects a conflicting duplicate durable root address", () => {
    const duplicate = {
      ...portfolio,
      relationship_id: "relationship.portfolio.lifeof-conflict",
      child: {
        ...portfolio.child,
        canonical_repository: "https://github.com/acme/not-lifeof",
      },
    };
    expect(
      validateRootRelationships(PORTFOLIO_ROOT, [portfolio, duplicate]),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "ROOT_RELATIONSHIP_ADDRESS_DUPLICATE" }],
    });
  });

  it("rejects local-root and relationship-owner mismatches", () => {
    expect(validateRootRelationships(CHILD_ROOT, [portfolio])).toMatchObject({
      ok: false,
      issues: [{ code: "ROOT_RELATIONSHIP_LOCAL_ROOT_MISMATCH" }],
    });
    expect(
      validateRootRelationships(PORTFOLIO_ROOT, [
        { ...portfolio, relationship_owner_root_id: portfolio.child.root_id },
      ]),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "ROOT_RELATIONSHIP_OWNER_MISMATCH" }],
    });
  });

  it("requires an exact remote profile-lock hash", () => {
    const missing = {
      ...portfolio,
      child: { ...portfolio.child, profile_lock_hash: "" },
    };
    expect(validateRootRelationships(PORTFOLIO_ROOT, [missing])).toMatchObject({
      ok: false,
      issues: [{ code: "ROOT_RELATIONSHIP_REMOTE_LOCK_REQUIRED" }],
    });
  });

  it("rejects a portfolio child self-reference", () => {
    const selfReference = {
      ...portfolio,
      child: portfolio.portfolio,
      child_truth_owner_root_id: portfolio.portfolio.root_id,
    };
    expect(
      validateRootRelationships(PORTFOLIO_ROOT, [selfReference]),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "ROOT_RELATIONSHIP_SELF_REFERENCE" }],
    });
  });

  it("rejects cross-namespace dependency cycles", () => {
    const reverseDependency: SharedPlatformConsumerReference = {
      ...consumer,
      relationship_id: "relationship.platform.reverse-dependency",
      consumer: provider.provider,
      provider: provider.consumer,
      owner_root_id: provider.provider.root_id,
      provider_interface_refs: [
        {
          root: provider.consumer,
          relative_path: "docs/project-memory/source/INTERFACES.md",
          revision: 4,
          sha256: "f".repeat(64),
        },
      ],
    };
    expect(
      validateRootRelationships(PROVIDER_ROOT, [provider, reverseDependency]),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "ROOT_RELATIONSHIP_CYCLE" }],
    });
  });

  it("renders only validated records in deterministic order", () => {
    const second: PortfolioChildReference = {
      ...portfolio,
      relationship_id: "relationship.portfolio.second-product",
      revision: 2,
      child: {
        namespace: "second.app",
        root_id: "ROOT-01J00000000000000000000004",
        canonical_repository: "https://github.com/acme/second-product",
        profile_lock_hash: "f".repeat(64),
      },
      child_truth_owner_root_id: "ROOT-01J00000000000000000000004",
      approval_refs: ["APR-01J00000000000000000000003"],
    };
    const firstRender = renderRootRelationships(PORTFOLIO_ROOT, [second, portfolio]);
    const secondRender = renderRootRelationships(PORTFOLIO_ROOT, [portfolio, second]);
    if (!firstRender.ok) throw new Error(JSON.stringify(firstRender.issues));
    if (!secondRender.ok) throw new Error(JSON.stringify(secondRender.issues));
    expect(firstRender.value).not.toBeNull();
    expect(firstRender.value).toEqual(secondRender.value);
    const text = new TextDecoder().decode(firstRender.value);
    expect(text).toContain("schema: project-memory/root-relationships");
    expect(text).toContain("APR-01J00000000000000000000000");
    expect(text).toContain("APR-01J00000000000000000000003");
    expect(text.indexOf(portfolio.relationship_id)).toBeLessThan(
      text.indexOf(second.relationship_id),
    );
  });

  it("plans no relationship source document for an empty accepted set", () => {
    expect(renderRootRelationships(PORTFOLIO_ROOT, [])).toMatchObject({
      ok: true,
      value: null,
    });
  });
});
