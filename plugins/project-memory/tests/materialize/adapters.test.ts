import { readFile } from "node:fs/promises";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PlannedWrite } from "../../src/contracts/planned-write.js";
import { validateToolConfigDocument } from "../../src/cli/config.js";

import {
  createProfileArtifactRenderer,
  renderAdapters,
  type TargetByteSnapshot,
} from "../../src/materialize/render-adapters.js";
import { expandResolvedProfile } from "../../src/profile/expand-profile.js";
import type { ProfileArtifactRenderInput } from "../../src/profile/build-profile-mutation-plan.js";
import type {
  ProfileLock,
  ResolvedAdapter,
  ResolvedProfile,
  SelectedCatalogLock,
} from "../../src/profile/contracts/index.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import {
  createCompilerFixture,
  type CompilerFixture,
} from "../helpers/profile-compiler-fixture.js";

const CONFIG_PATH = "tools/project-memory/config.json";
const ROUTER_LINKS = [
  "PROJECT_CONTEXT.md",
  "docs/project-memory/PROTOCOL.md",
  "docs/project-memory/profile.lock.yaml",
] as const;

let fixture: CompilerFixture;

function resolvedProfile(): ResolvedProfile {
  const result = expandResolvedProfile(fixture.selection, fixture.catalog);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function snapshot(
  entries: readonly (readonly [string, Uint8Array])[] = [],
): TargetByteSnapshot {
  return { files: new Map(entries) };
}

function claudeAdapter(): ResolvedAdapter {
  return {
    kind: "agent",
    definition_id: "adapter.claude-code",
    definition_version: "1.0.0",
    definition_target_path:
      "docs/project-memory/catalog/selected/adapters/agent/adapter.claude-code.yaml",
    definition_target_sha256: "d".repeat(64),
  };
}

function withAdapters(
  profile: ResolvedProfile,
  adapters: readonly ResolvedAdapter[],
): ResolvedProfile {
  return { ...profile, adapters: [...adapters] };
}

function artifactInput(profile: ResolvedProfile): ProfileArtifactRenderInput {
  const selectedCatalogLock = {
    schema_version: "1.0.0",
    catalog_release: "1.0.0",
    source_release_hash: "a".repeat(64),
    entries: [],
    lock_hash: "b".repeat(64),
  } as SelectedCatalogLock;
  const profileLock = {
    schema_version: "1.0.0",
    profile_revision: 1,
    root_id: fixture.selection.root.id,
    project_hash: "a".repeat(64),
    selected_catalog_lock_hash: selectedCatalogLock.lock_hash,
    accepted_source_entries: [],
    profile,
    lock_hash: "c".repeat(64),
  } as ProfileLock;
  return {
    selection: fixture.selection,
    sources: fixture.input.accepted_sources,
    profile,
    selected_catalog_lock: selectedCatalogLock,
    profile_lock: profileLock,
  };
}

function findWrite(
  writes: readonly PlannedWrite[],
  path: string,
) {
  return writes.find((write) => write.relative_path === path);
}

function markdownLinks(value: string): string[] {
  return [...value.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1] ?? "");
}

beforeAll(async () => {
  fixture = await createCompilerFixture();
});

beforeEach(() => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
});

afterEach(() => {
  resetSchemaRegistryForTests();
});

describe("explicit adapter rendering", () => {
  it("renders no tool router when no adapter is explicitly resolved", () => {
    const profile = withAdapters(resolvedProfile(), []);
    const result = renderAdapters(profile, snapshot());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.map((write) => write.relative_path)).toEqual([
      CONFIG_PATH,
    ]);
  });

  it("does not infer Claude Code from model-like text", () => {
    const profile = {
      ...withAdapters(resolvedProfile(), []),
      model_name: "Claude",
    } as ResolvedProfile;
    const result = renderAdapters(profile, snapshot());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(findWrite(result.value, "CLAUDE.md")).toBeUndefined();
  });

  it("renders only thin routers for explicitly resolved agent adapters", () => {
    const base = resolvedProfile();
    const profile = withAdapters(base, [...base.adapters, claudeAdapter()]);
    const result = renderAdapters(profile, snapshot());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));

    for (const path of ["AGENTS.md", "CLAUDE.md"] as const) {
      const write = findWrite(result.value, path);
      expect(write?.mode).toBe("create");
      expect(write).toBeDefined();
      if (write === undefined) continue;
      const router = text(write.bytes);
      expect(markdownLinks(router)).toEqual(ROUTER_LINKS);
      expect(router).not.toContain("Prove deterministic profile planning.");
      expect(router).not.toMatch(/\b(status|history|changelog|prd)\b/i);
    }
  });

  it("preserves an existing AGENTS.md and emits a deterministic review proposal", async () => {
    const existing = new Uint8Array(
      await readFile(
        new URL("../fixtures/materialize/existing-agents.md", import.meta.url),
      ),
    );
    const result = renderAdapters(
      resolvedProfile(),
      snapshot([["AGENTS.md", existing]]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));

    expect(findWrite(result.value, "AGENTS.md")).toBeUndefined();
    const proposal = result.value.find((write) =>
      write.relative_path.startsWith(
        "docs/project-memory/catalog/proposals/adapter-existing-file-agents-",
      ),
    );
    expect(proposal?.mode).toBe("create_or_replace");
    expect(text(proposal?.bytes ?? new Uint8Array())).not.toContain(text(existing));
    const warning = result.warnings.find(
      (candidate) => candidate.code === "ADAPTER_EXISTING_FILE_REVIEW",
    );
    expect(warning).toMatchObject({
      severity: "review",
      path: "AGENTS.md",
    });
    expect(warning?.references).toContain(proposal?.relative_path);
  });

  it("preserves an existing CLAUDE.md under the same review protocol", async () => {
    const base = resolvedProfile();
    const existing = new Uint8Array(
      await readFile(
        new URL("../fixtures/materialize/existing-claude.md", import.meta.url),
      ),
    );
    const profile = withAdapters(base, [...base.adapters, claudeAdapter()]);
    const result = renderAdapters(
      profile,
      snapshot([["CLAUDE.md", existing]]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(findWrite(result.value, "CLAUDE.md")).toBeUndefined();
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ADAPTER_EXISTING_FILE_REVIEW",
          severity: "review",
          path: "CLAUDE.md",
        }),
      ]),
    );
  });

  it("omits an already-current generated router", () => {
    const first = renderAdapters(resolvedProfile(), snapshot());
    if (!first.ok) throw new Error(JSON.stringify(first.issues));
    const generated = findWrite(first.value, "AGENTS.md");
    expect(generated).toBeDefined();
    if (generated === undefined) return;

    const second = renderAdapters(
      resolvedProfile(),
      snapshot([["agents.md", generated.bytes]]),
    );
    if (!second.ok) throw new Error(JSON.stringify(second.issues));
    expect(findWrite(second.value, "AGENTS.md")).toBeUndefined();
    expect(second.warnings).toEqual([]);
  });

  it("emits byte-stable sorted configuration with flattened gates and commands", () => {
    const base = resolvedProfile();
    const profile = withAdapters(base, [...base.adapters, claudeAdapter()]);
    const reversed: ResolvedProfile = {
      ...profile,
      adapters: [...profile.adapters].reverse(),
      gates: [...profile.gates].reverse().map((gate) => ({
        ...gate,
        source_definition_ids: [...gate.source_definition_ids].reverse(),
        commands: [...gate.commands].reverse(),
        required_evidence: [...gate.required_evidence].reverse(),
      })),
    };
    const first = renderAdapters(profile, snapshot());
    const second = renderAdapters(reversed, snapshot());
    if (!first.ok) throw new Error(JSON.stringify(first.issues));
    if (!second.ok) throw new Error(JSON.stringify(second.issues));
    const firstConfig = findWrite(first.value, CONFIG_PATH);
    const secondConfig = findWrite(second.value, CONFIG_PATH);
    expect(firstConfig?.bytes).toEqual(secondConfig?.bytes);
    const config = JSON.parse(text(firstConfig?.bytes ?? new Uint8Array())) as {
      adapters: readonly { definition_id: string }[];
      commands: readonly string[];
      gates: readonly {
        id: string;
        commands: readonly string[];
        source_definition_ids: readonly string[];
        required_evidence: readonly string[];
      }[];
    };
    expect(validateToolConfigDocument(config).ok).toBe(true);
    expect(config.adapters.map((adapter) => adapter.definition_id)).toEqual([
      "adapter.claude-code",
      "adapter.codex",
    ]);
    expect(config.commands).toEqual(
      [...new Set(profile.gates.flatMap((gate) => gate.commands))].sort(),
    );
    expect(config.gates).toEqual(
      [...config.gates].sort((left, right) => left.id.localeCompare(right.id)),
    );
  });

  it("composes project-tree and adapter artifacts behind one render capability", () => {
    const renderer = createProfileArtifactRenderer(snapshot());
    const result = renderer.render(artifactInput(resolvedProfile()));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const paths = result.value.map((write) => write.relative_path);
    expect(paths).toContain("PROJECT_CONTEXT.md");
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain(CONFIG_PATH);
    expect(Object.keys(renderer)).toEqual(["render"]);
  });
});
