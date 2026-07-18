import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error -- The JSDoc-checked MJS verifier has no separate declaration file.
import { assertRegularRepositoryFile as untypedAssertRegularRepositoryFile, assertSafeOutputRoot as untypedAssertSafeOutputRoot } from "../../scripts/verify-local-marketplace.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const VERIFIER = path.join(PACKAGE_ROOT, "scripts", "verify-local-marketplace.mjs");
const RUNBOOK = path.join(REPOSITORY_ROOT, "docs", "pilots", "CODEX_PLUGIN_INSTALL_PILOT.md");

interface BoundInput {
  readonly role: string;
  readonly path: string;
  readonly kind: "regular_file";
  readonly symlink_free: true;
}

interface BoundOutput {
  readonly role: string;
  readonly path: string;
  readonly kind: "directory_or_absent";
  readonly symlink_free: true;
}

const assertRegularRepositoryFile = untypedAssertRegularRepositoryFile as (
  root: string,
  filename: string,
  role: string,
) => Promise<BoundInput>;

const assertSafeOutputRoot = untypedAssertSafeOutputRoot as (
  root: string,
  dirname: string,
  role: string,
) => Promise<BoundOutput>;

interface ReadinessReport {
  readonly schema_version: "1.0.0";
  readonly valid: true;
  readonly mode: "marketplace_read_only";
  readonly repository_boundary: "realpath_pinned";
  readonly bound_inputs: readonly BoundInput[];
  readonly bound_outputs: readonly BoundOutput[];
  readonly marketplace: {
    readonly name: "project-memory";
    readonly plugin: {
      readonly name: "project-memory";
      readonly source: { readonly source: "local"; readonly path: "./plugins/project-memory" };
      readonly policy: { readonly installation: "AVAILABLE"; readonly authentication: "ON_INSTALL" };
    };
    readonly manifest: { readonly name: "project-memory" };
  };
  readonly clean_plugin: {
    readonly valid: true;
    readonly network: "disabled";
    readonly logical_manifest_sha256: string;
    readonly validators: { readonly plugin: "passed"; readonly skill: "passed" };
  };
  readonly execution: {
    readonly codex_cli_invoked: false;
    readonly wrapper_codex_configuration_write_attempted: false;
    readonly codex_configuration_changed: "not_assessed";
    readonly repository_write_scope: readonly ["plugins/project-memory/.tmp/**", "plugins/project-memory/dist/**"];
    readonly delegated_external_inputs: {
      readonly boundary: "external_not_bound";
      readonly inputs: readonly ["process.execPath", "python", "git", "CODEX_HOME validators"];
    };
  };
  readonly pilot: {
    readonly status: "prepared_not_authorized";
    readonly explicit_install_approval_required: true;
    readonly isolated_scratch_repository_required: true;
    readonly rollback_command: "codex plugin remove project-memory@project-memory";
  };
}

function runVerifier() {
  const verification = spawnSync(process.execPath, [VERIFIER], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 180_000,
    env: { ...process.env, PROJECT_MEMORY_NETWORK: "disabled" },
  });
  expect(verification.status, verification.stderr).toBe(0);
  return verification.stdout;
}

describe("Codex install pilot readiness", () => {
  it("prepares a bounded, reversible local install pilot without invoking Codex", async () => {
    const first = runVerifier();
    const second = runVerifier();
    expect(second).toBe(first);
    const report = JSON.parse(first) as ReadinessReport;
    const digest = report.clean_plugin.logical_manifest_sha256;
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(report).toStrictEqual({
      schema_version: "1.0.0",
      valid: true,
      mode: "marketplace_read_only",
      repository_boundary: "realpath_pinned",
      bound_inputs: [
        { role: "marketplace", path: ".agents/plugins/marketplace.json", kind: "regular_file", symlink_free: true },
        { role: "plugin_manifest", path: "plugins/project-memory/.codex-plugin/plugin.json", kind: "regular_file", symlink_free: true },
        { role: "pilot_runbook", path: "docs/pilots/CODEX_PLUGIN_INSTALL_PILOT.md", kind: "regular_file", symlink_free: true },
        { role: "clean_plugin_verifier", path: "plugins/project-memory/scripts/verify-plugin-contents.mjs", kind: "regular_file", symlink_free: true },
        { role: "typescript_compiler", path: "plugins/project-memory/node_modules/typescript/bin/tsc", kind: "regular_file", symlink_free: true },
        { role: "plugin_bundle_builder", path: "plugins/project-memory/scripts/build-plugin-bundle.mjs", kind: "regular_file", symlink_free: true },
      ],
      bound_outputs: [
        { role: "plugin_temporary_output", path: "plugins/project-memory/.tmp", kind: "directory_or_absent", symlink_free: true },
        { role: "plugin_dist_output", path: "plugins/project-memory/dist", kind: "directory_or_absent", symlink_free: true },
      ],
      marketplace: {
        name: "project-memory",
        plugin: {
          name: "project-memory",
          source: { source: "local", path: "./plugins/project-memory" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        },
        manifest: { name: "project-memory" },
      },
      clean_plugin: {
        valid: true,
        network: "disabled",
        logical_manifest_sha256: digest,
        validators: { plugin: "passed", skill: "passed" },
      },
      execution: {
        codex_cli_invoked: false,
        wrapper_codex_configuration_write_attempted: false,
        codex_configuration_changed: "not_assessed",
        repository_write_scope: [
          "plugins/project-memory/.tmp/**",
          "plugins/project-memory/dist/**",
        ],
        delegated_external_inputs: {
          boundary: "external_not_bound",
          inputs: ["process.execPath", "python", "git", "CODEX_HOME validators"],
        },
      },
      pilot: {
        status: "prepared_not_authorized",
        explicit_install_approval_required: true,
        isolated_scratch_repository_required: true,
        rollback_command: "codex plugin remove project-memory@project-memory",
      },
    });

    const [runbook, verifierSource] = await Promise.all([
      readFile(RUNBOOK, "utf8"),
      readFile(VERIFIER, "utf8"),
    ]);
    for (const requirement of [
      "PREPARED - NOT AUTHORIZED",
      "expected HEAD",
      "git rev-parse HEAD",
      "explicit Pitaji approval",
      "sanitized scratch repository",
      "codex plugin list",
      "New Codex App task/thread",
      "implicit invocation",
      "one confirmation",
      "no profile picker",
      "deterministic resume",
      "Evidence capture",
      "codex plugin remove project-memory@project-memory",
      "codex plugin --help",
      "access-denied",
      "python plugin-creator/scripts/update_plugin_cachebuster.py plugins/project-memory",
      'codex plugin marketplace add "<repository-root>"',
      "codex plugin add project-memory@project-memory",
      "disposable, isolated source worktree",
      "not executable as written",
      "verified-absolute-cachebuster-script",
      "logical_manifest_sha256",
      "only `version` changed",
      "marketplace-list",
      "not_assessed",
      "plugins/project-memory/.tmp/**",
      "plugins/project-memory/dist/**",
      "external_not_bound",
      "existing isolated source worktree",
      "symlink-free",
      "post-cachebuster hash",
    ]) {
      expect(runbook).toContain(requirement);
    }
    expect(runbook).toMatch(/conditional marketplace removal/i);
    expect(runbook).toMatch(/restore cachebuster/i);
    expect(runbook).toMatch(/pending|do not run/i);

    expect(runbook).not.toContain('"codex_configuration_changed": false');

    expect(verifierSource).toContain("lstat");
    expect(verifierSource).toContain("realpath");
    for (const role of ["marketplace", "plugin_manifest", "pilot_runbook", "clean_plugin_verifier", "typescript_compiler", "plugin_bundle_builder"]) {
      expect(verifierSource).toContain(`, "${role}")`);
    }
    expect(verifierSource).toContain('codex_configuration_changed: "not_assessed"');
    expect(verifierSource).not.toContain("codex_configuration_changed: false");
    expect(verifierSource).toContain('"plugins/project-memory/.tmp/**"');
    expect(verifierSource).toContain('"plugins/project-memory/dist/**"');
    expect(verifierSource).toContain('boundary: "external_not_bound"');
    expect(verifierSource).toContain('assertSafeOutputRoot(repositoryReal, temporaryRoot');
    expect(verifierSource).toContain('assertSafeOutputRoot(repositoryReal, distRoot');
    expect(verifierSource).toContain("process.execPath");
    expect(verifierSource).toContain("shell: false");
    expect(verifierSource).not.toMatch(/\b(?:writeFile|appendFile|rm|cp|rename|unlink)\b/);
    expect(verifierSource).not.toMatch(/spawn(?:Sync)?\(\s*["']codex["']/);
    expect(verifierSource).not.toMatch(/exec(?:File)?(?:Sync)?\(\s*["']codex["']/);
  }, 190_000);

  it("rejects out-of-repository inputs and junction-backed output roots", async () => {
    const repositoryReal = await realpath(REPOSITORY_ROOT);
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "project-memory-marketplace-"));
    const insideParent = path.join(PACKAGE_ROOT, ".tmp");
    await mkdir(insideParent, { recursive: true });
    const insideRoot = await mkdtemp(path.join(insideParent, "marketplace-path-"));
    const outsideFile = path.join(outsideRoot, "outside.json");
    const targetDirectory = path.join(insideRoot, "target");
    const junction = path.join(insideRoot, "junction");

    try {
      await writeFile(outsideFile, "{}\n", "utf8");
      await expect(
        assertRegularRepositoryFile(repositoryReal, outsideFile, "outside"),
      ).rejects.toThrow(/inside the repository/);

      await mkdir(targetDirectory);
      await symlink(targetDirectory, junction, "junction");
      await expect(
        assertSafeOutputRoot(repositoryReal, junction, "unsafe_output"),
      ).rejects.toThrow(/symlink-free repository directory/);
    } finally {
      await Promise.all([
        rm(outsideRoot, { recursive: true, force: true }),
        rm(insideRoot, { recursive: true, force: true }),
      ]);
    }
  });
});
