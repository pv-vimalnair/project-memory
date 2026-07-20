import { createHash } from "node:crypto";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const VERIFIER = path.join(PACKAGE_ROOT, "scripts", "verify-plugin-contents.mjs");
const INSTALL_PARENT = path.join(PACKAGE_ROOT, ".tmp", "plugin-install");
const PLUGIN_ROOT = path.join(INSTALL_PARENT, "project-memory");
const MANIFEST_PATH = path.join(
  INSTALL_PARENT,
  "project-memory.logical-manifest.json",
);
const REPORT_PATH = path.join(
  INSTALL_PARENT,
  "project-memory.execution-report.json",
);
const INSPECTION_ROOT = path.join(PACKAGE_ROOT, ".tmp", "plugin-inspection-cases");

interface LogicalEntry {
  readonly path: string;
  readonly length: number;
  readonly sha256: string;
}

interface LogicalManifest {
  readonly schema_version: "1.0.0";
  readonly plugin: "project-memory";
  readonly entries: readonly LogicalEntry[];
}

interface ExecutionReport {
  readonly schema_version: "1.0.0";
  readonly valid: true;
  readonly plugin_root: "project-memory";
  readonly network: "disabled";
  readonly logical_manifest_sha256: string;
  readonly validators: {
    readonly plugin: "passed";
    readonly skill: "passed";
  };
  readonly launcher: {
    readonly version: "0.1.1";
    readonly agent_start: "bootstrap_review_required";
    readonly node_modules_present: false;
  };
  readonly mcp: {
    readonly initialize: "passed";
    readonly tools: readonly string[];
    readonly upgrade_approval: "confirmed_only";
    readonly ping: "passed";
  };
}

let verification: SpawnSyncReturns<string>;
const APPROVED_LOGO_SHA256 =
  "df1e9be53cb65b6b5abb3db431c708b4ab004cd494a1cf56d0e85c2b1d44cc67";

function runVerifier(arguments_: readonly string[] = []): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [VERIFIER, ...arguments_], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 180_000,
    env: { ...process.env, PROJECT_MEMORY_NETWORK: "disabled" },
  });
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => ordered(item));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, ordered(item)]),
  );
}

function canonical(value: unknown): string {
  return `${JSON.stringify(ordered(value))}\n`;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function maliciousCase(
  slug: string,
  relativePath: string,
  content = "unsafe\n",
): Promise<SpawnSyncReturns<string>> {
  const root = path.join(INSPECTION_ROOT, slug);
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return runVerifier([
    "--inspect",
    path.relative(PACKAGE_ROOT, root).replaceAll(path.sep, "/"),
  ]);
}

beforeAll(async () => {
  await rm(INSPECTION_ROOT, { recursive: true, force: true });
  verification = runVerifier();
}, 190_000);

afterAll(async () => {
  await rm(INSPECTION_ROOT, { recursive: true, force: true });
});

describe("clean installable Project Memory Plugin", () => {
  it("builds the declared allowlist and emits canonical logical artifacts", async () => {
    expect(verification.status, verification.stderr).toBe(0);
    expect(verification.error).toBeUndefined();

    const [manifestText, reportText, packageText] = await Promise.all([
      readFile(MANIFEST_PATH, "utf8"),
      readFile(REPORT_PATH, "utf8"),
      readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
    ]);
    const manifest = JSON.parse(manifestText) as LogicalManifest;
    const report = JSON.parse(reportText) as ExecutionReport;
    const packageDocument = JSON.parse(packageText) as {
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(manifestText).toBe(canonical(manifest));
    expect(reportText).toBe(canonical(report));
    expect(verification.stdout).toBe(reportText);
    expect(packageDocument.scripts["plugin:verify"]).toBe(
      "node scripts/verify-plugin-contents.mjs",
    );

    const paths = manifest.entries.map((entry) => entry.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toEqual(expect.arrayContaining([
      ".codex-plugin/plugin.json",
      "assets/project-memory-logo.png",
      "catalog/project-memory/v1/CHANGELOG.md",
      "catalog/project-memory/v1/fixtures/blueprints/ai-data/ai.analytics-decision-support.positive.yaml",
      "catalog/project-memory/v1/manifest.yaml",
      "skills/project-memory/SKILL.md",
      "skills/project-memory/agents/openai.yaml",
      "skills/project-memory/references/agent-protocol.md",
      "scripts/project-memory.mjs",
      "dist/project-memory.mjs",
      "dist/project-memory.mjs.sha256",
      "dist/project-memory-mcp.mjs",
      "dist/project-memory-mcp.mjs.sha256",
      "dist/catalog/project-memory/1.0.0/catalog.bundle.json",
      "dist/catalog/project-memory/1.0.0/catalog.lock.json",
      "dist/catalog/project-memory/1.0.0/SHA256SUMS",
      "schemas/project-memory/v1/schema-index.json",
      "templates/project-memory/PROJECT.md",
    ]));
    expect(paths.some((value) => value.startsWith("catalog/project-memory/v1/")))
      .toBe(true);
    expect(paths.some((value) => value.startsWith("schemas/project-memory/v1/")))
      .toBe(true);
    expect(paths.some((value) => value.startsWith("templates/project-memory/")))
      .toBe(true);
    expect(paths).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/(?:^|\/)(?:node_modules|coverage|\.git)(?:\/|$)/i),
      expect.stringMatching(/(?:^|\/)tests\/fixtures(?:\/|$)/i),
      expect.stringMatching(/(?:^|\/)\.env/i),
      expect.stringMatching(/^(?!catalog\/project-memory\/v1\/).*(?:credential|secret|raw-model-output|\.log$)/i),
    ]));

    const pluginDocument = JSON.parse(await readFile(
      path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"),
      "utf8",
    )) as {
      readonly interface: {
        readonly logo: string;
        readonly logoDark: string;
      };
    };
    expect(pluginDocument.interface.logo).toBe("./assets/project-memory-logo.png");
    expect(pluginDocument.interface.logoDark).toBe("./assets/project-memory-logo.png");
    const logoBytes = await readFile(path.join(
      PLUGIN_ROOT,
      "assets",
      "project-memory-logo.png",
    ));
    expect(createHash("sha256").update(logoBytes).digest("hex"))
      .toBe(APPROVED_LOGO_SHA256);

    for (const entry of manifest.entries) {
      expect(path.posix.isAbsolute(entry.path)).toBe(false);
      expect(entry.path).not.toContain("\\");
      const bytes = await readFile(path.join(PLUGIN_ROOT, ...entry.path.split("/")));
      expect(bytes.length).toBe(entry.length);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    }
    expect(await exists(path.join(PLUGIN_ROOT, "node_modules"))).toBe(false);
    expect(manifestText + reportText).not.toContain(PACKAGE_ROOT);
    expect(manifestText + reportText).not.toContain(PACKAGE_ROOT.replaceAll("\\", "/"));
  });

  it("runs both official validators and the clean launcher with network disabled", async () => {
    expect(verification.status, verification.stderr).toBe(0);
    const report = JSON.parse(await readFile(REPORT_PATH, "utf8")) as ExecutionReport;
    expect(report).toMatchObject({
      valid: true,
      network: "disabled",
      validators: { plugin: "passed", skill: "passed" },
      launcher: {
        version: "0.1.1",
        agent_start: "bootstrap_review_required",
        node_modules_present: false,
      },
      mcp: {
        tools: ["project_memory_start", "project_memory_read", "project_memory_apply"],
        upgrade_approval: "confirmed_only",
        node_modules_present: false,
      },
    });
    expect(report.logical_manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["dependencies", "node_modules/module.js"],
    ["coverage", "coverage/report.json"],
    ["fixtures", "tests/fixtures/source.json"],
    ["raw-output", "raw-model-output.txt"],
    ["environment", ".env.production"],
    ["credentials", "credentials.json"],
    ["logs", "trace.log"],
    ["nested-git", ".git/config"],
  ] as const)("rejects forbidden %s paths", async (slug, relativePath) => {
    const inspected = await maliciousCase(slug, relativePath);
    expect(inspected.status).toBe(1);
    expect(inspected.stderr).toContain("PLUGIN_CONTENT_FORBIDDEN_PATH");
  });

  it.each([
    ["windows-path", "Local path C:\\Users\\Alice\\private.txt\n"],
    ["posix-path", "Local path /home/alice/private.txt\n"],
    ["private-key", ["-----BEGIN ", "PRIVATE KEY-----\nnot-a-real-key\n"].join("")],
    ["api-key", 'api_key="synthetic-test-secret-value"\n'],
    ["model-output", '{"type":"response_item","role":"assistant"}\n'],
  ] as const)("rejects %s content", async (slug, content) => {
    const inspected = await maliciousCase(
      `content-${slug}`,
      "templates/project-memory/PROJECT.md",
      content,
    );
    expect(inspected.status).toBe(1);
    expect(inspected.stderr).toContain("PLUGIN_CONTENT_FORBIDDEN_CONTENT");
  });

  it("rejects altered Project Memory logo bytes", async () => {
    const inspected = await maliciousCase(
      "altered-logo",
      "assets/project-memory-logo.png",
      "not-the-approved-logo\n",
    );
    expect(inspected.status).toBe(1);
    expect(inspected.stderr).toContain("PLUGIN_CONTENT_HASH_MISMATCH");
  });
});
