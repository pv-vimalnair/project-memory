import { readFile } from "node:fs/promises";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseCanonicalMarkdown } from "../../src/materialize/parse-canonical-markdown.js";
import {
  acceptedProfileSourceRenderer,
  renderAcceptedProfileSources,
} from "../../src/materialize/render-project-source.js";
import {
  createProjectTreeArtifactRenderer,
  renderCompilerOwnedProjectTree,
} from "../../src/materialize/render-project-tree.js";
import { expandResolvedProfile } from "../../src/profile/expand-profile.js";
import type {
  ProfileArtifactRenderInput,
} from "../../src/profile/build-profile-mutation-plan.js";
import type {
  ProfileLock,
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

const COMPONENT_PATH =
  "docs/project-memory/components/CMP-01J00000000000000000000000/COMPONENT.md";
const DOMAIN_PATH =
  "docs/project-memory/domains/DOM-01J00000000000000000000000/DOMAIN.md";
const TEMPLATE_NAMES = [
  "PROTOCOL.md",
  "PROJECT.md",
  "CONSTRAINTS.md",
  "POLICIES.md",
  "ROOT_RELATIONSHIPS.md",
  "COMPONENT.md",
  "DOMAIN.md",
] as const;

let fixture: CompilerFixture;

function resolvedProfile(): ResolvedProfile {
  const result = expandResolvedProfile(fixture.selection, fixture.catalog);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
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

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
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

describe("accepted project tree rendering", () => {
  it("renders accepted profile-source paths from immutable IDs", () => {
    const result = renderAcceptedProfileSources(
      fixture.selection,
      fixture.input.accepted_sources,
      resolvedProfile(),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const paths = result.value.map((write) => write.relative_path);
    expect(paths).toContain("docs/project-memory/source/PROJECT.md");
    expect(paths).toContain("docs/project-memory/source/CONSTRAINTS.md");
    expect(paths).toContain("docs/project-memory/source/POLICIES.md");
    expect(paths).toContain(COMPONENT_PATH);
    expect(paths).toContain(DOMAIN_PATH);
    for (const path of [
      "docs/project-memory/source/PROJECT.md",
      COMPONENT_PATH,
      DOMAIN_PATH,
    ]) {
      const write = result.value.find((candidate) => candidate.relative_path === path);
      expect(write).toBeDefined();
      if (write !== undefined) expect(parseCanonicalMarkdown(write.bytes).ok).toBe(true);
    }
  });

  it("renders accepted facts without catalog prose or generated markers", () => {
    const result = renderAcceptedProfileSources(
      fixture.selection,
      fixture.input.accepted_sources,
      resolvedProfile(),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const allText = result.value.map((write) => text(write.bytes)).join("\n");
    expect(allText).toContain("Prove deterministic profile planning.");
    expect(allText).toContain("Own the accepted mobile fixture boundary.");
    expect(allText).toContain("Own accepted fixture product intent.");
    expect(allText).not.toContain("Define a minimal mobile application profile fixture.");
    expect(allText).not.toContain("UNACCEPTED_SECRET_FACT");
    expect(allText).not.toContain("DO NOT EDIT");
    expect(allText).not.toContain("generated artifact");
  });

  it("leaves dynamic truth and generated views to downstream owners", () => {
    const result = acceptedProfileSourceRenderer.render(
      fixture.selection,
      fixture.input.accepted_sources,
      resolvedProfile(),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(
      result.value.some(
        (write) =>
          write.relative_path.includes("/initiatives/") ||
          write.relative_path.includes("/workstreams/") ||
          write.relative_path.includes("/views/"),
      ),
    ).toBe(false);
  });

  it("omits the relationship document until an accepted relationship exists", () => {
    const result = renderAcceptedProfileSources(
      fixture.selection,
      fixture.input.accepted_sources,
      resolvedProfile(),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(
      result.value.some(
        (write) =>
          write.relative_path ===
          "docs/project-memory/source/ROOT_RELATIONSHIPS.md",
      ),
    ).toBe(false);
  });

  it("renders the fixed startup doorway and tracked empty contract directories", () => {
    const input = artifactInput(resolvedProfile());
    const result = renderCompilerOwnedProjectTree(input);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const paths = result.value.map((write) => write.relative_path);
    expect(paths).toContain("PROJECT_CONTEXT.md");
    expect(paths).toContain("docs/project-memory/PROTOCOL.md");
    expect(paths).toContain("docs/project-memory/records/decisions/.gitkeep");
    expect(paths).toContain("docs/project-memory/governance/claims/.gitkeep");
    expect(paths).toContain("docs/project-memory/archive/sessions/.gitkeep");
    expect(paths).toContain("docs/project-memory/catalog/proposals/.gitkeep");
    expect(paths.some((path) => path.includes("/views/"))).toBe(false);
    const startup = result.value.find(
      (write) => write.relative_path === "PROJECT_CONTEXT.md",
    );
    expect(startup).toBeDefined();
    if (startup === undefined) return;
    const startupText = text(startup.bytes);
    expect(startupText).toContain("GENERATED — DO NOT EDIT");
    expect(startupText).toContain(fixture.selection.root.id);
    expect(startupText).toContain(input.profile_lock.lock_hash);
    expect(startupText).toContain("1. `PROJECT_CONTEXT.md`");
    expect(startupText).toContain("2. `docs/project-memory/profile.lock.yaml`");
    expect(startupText).toContain("3. `docs/project-memory/views/NOW.md`");
    expect(startupText).toContain("Do not edit generated views");
    expect(startupText).not.toContain("Prove deterministic profile planning.");
  });

  it("exposes a production artifact renderer with only a render capability", () => {
    const renderer = createProjectTreeArtifactRenderer();
    const direct = renderCompilerOwnedProjectTree(artifactInput(resolvedProfile()));
    const wrapped = renderer.render(artifactInput(resolvedProfile()));
    expect(wrapped).toEqual(direct);
    expect(Object.keys(renderer)).toEqual(["render"]);
  });

  it("keeps every distributed source template present and non-empty", async () => {
    for (const name of TEMPLATE_NAMES) {
      const template = await readFile(
        new URL(`../../templates/project-memory/${name}`, import.meta.url),
        "utf8",
      );
      expect(template.trim().length).toBeGreaterThan(40);
    }
  });

  it("is byte-stable across repeated renders", () => {
    const profile = resolvedProfile();
    const first = renderAcceptedProfileSources(
      fixture.selection,
      fixture.input.accepted_sources,
      profile,
    );
    const second = renderAcceptedProfileSources(
      fixture.selection,
      fixture.input.accepted_sources,
      profile,
    );
    expect(first).toEqual(second);
    expect(renderCompilerOwnedProjectTree(artifactInput(profile))).toEqual(
      renderCompilerOwnedProjectTree(artifactInput(profile)),
    );
  });
});
