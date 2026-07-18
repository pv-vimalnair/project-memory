# Project Memory Foundation and Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the dedicated TypeScript repository, deterministic infrastructure, shared result types, schema runtime, filesystem transaction layer, and Git abstractions that every Project Memory subsystem imports.

**Architecture:** One strict TypeScript/ESM package owns shared primitives and executable contract infrastructure. Domain subsystems keep their own schemas, register them through one registry, and emit versioned JSON Schema files. All filesystem writes are path-confined and atomic; time, IDs, Git, and process execution are injected so tests are deterministic.

**Tech Stack:** Node.js 24 LTS, TypeScript 6, ESM, TypeBox, Ajv 2020, YAML, ULID, Vitest, ESLint, Git, PowerShell.

## Global Constraints

- Repository root: `<repository-root>` (or its isolated worktree). Plugin package root: `plugins/project-memory/`. Execute Tasks 2-10 from the Plugin package root; their `src/`, `tests/`, `catalog/`, `schemas/`, `templates/`, `scripts/`, and package-file paths are relative to it.
- Task 1 is the completed historical repository bootstrap at commit `0b3c88f`; do not rerun it. Complete the Plugin scaffold plan before Task 2.
- The approved sources are the repository-root system design and agent Plugin design under `docs/superpowers/specs/`.
- Keep one npm package in v1. Do not introduce npm workspaces, a database, a server, or a framework.
- Treat `src/contracts/**`, `src/core/**`, and `src/schema/**` as foundation-owned, except that the lead integrator alone appends completed explicit registrar references to `src/schema/project-registrars.ts`. Other subsystem workers may import foundation modules but must not duplicate or edit them.
- YAML keys and emitted JSON Schema properties use `snake_case`; TypeScript runtime functions use `camelCase`.
- Every nondeterministic dependency is injected: `Clock`, `IdFactory`, `GitClient`, `CommandRunner`, and filesystem root.
- Every write must first prove that its resolved path remains inside the supplied repository root.
- Never execute a gate through a shell string. The command runner accepts an executable plus an argument array.
- Never claim a gate passed unless the exact command was run and its result captured.
- Public domain operations plus exported parsing, validation, path-safety, schema-emission, and write helpers return `RuntimeResult`; they do not throw for expected operational failures. The narrowly contained injected ports `CommandRunner`, `GitClient`, and `TransactionFileSystem` may reject or throw, and their callers must catch and convert those failures before returning across a public domain boundary. Startup-only schema registration may throw only for programmer/configuration defects before untrusted input is processed.
- Use test-first commits. Each task ends with the specified focused test and a logical commit.

---

## Stable Foundation Interfaces

Create these contracts once and preserve their names across every subsystem:

```ts
export interface RuntimeIssue {
  code: string;
  severity: "error" | "review" | "warning";
  path: string;
  message: string;
  references: readonly string[];
}

export type RuntimeResult<T> =
  | { ok: true; value: T; warnings: readonly RuntimeIssue[] }
  | { ok: false; issues: readonly RuntimeIssue[] };

export interface Clock {
  now(): Date;
}

export interface IdFactory {
  next(prefix: InstancePrefix): string;
}

export interface CommandSpec {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeout_ms: number;
  env_allowlist: Readonly<Record<string, string>>;
}

export interface CommandResult {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  started_at: string;
  finished_at: string;
  timed_out: boolean;
}

export interface CommandRunner {
  run(spec: CommandSpec): Promise<CommandResult>;
}

export type CanonicalMutationKind =
  | "profile.bootstrap"
  | "profile.evolution"
  | "record"
  | "claim"
  | "view"
  | "archive"
  | "work_lifecycle"
  | "administrative"
  | "migration"
  | "import";

export interface CanonicalMutationPlan<
  TMetadata = Readonly<Record<string, unknown>>,
> {
  schema_version: "1.0.0";
  plan_id: string;
  plan_hash: string;
  mutation_kind: CanonicalMutationKind;
  root_id: string;
  target_ref: string;
  expected_head: string;
  profile_lock_hash: string;
  writes: readonly PlannedWrite[];
  record_ids: readonly string[];
  event_ids: readonly string[];
  approval_ids: readonly string[];
  evidence_ids: readonly string[];
  created_by: string;
  created_at: string;
  expires_at: string;
  metadata: TMetadata;
}
```

Foundation exports these entry points:

```ts
canonicalJson(value: unknown): string;
sha256(bytes: string | Uint8Array): string;
canonicalMutationPlanHash<TMetadata>(plan: Omit<CanonicalMutationPlan<TMetadata>, "plan_hash">): string;
resolveInside(root: URL, relativePath: string): Promise<RuntimeResult<URL>>;
writeFileAtomic(root: URL, write: PlannedWrite, dependencies?: FileTransactionDependencies): Promise<RuntimeResult<FileTransactionReport>>;
applyFileTransaction(root: URL, writes: readonly PlannedWrite[], dependencies?: FileTransactionDependencies): Promise<RuntimeResult<FileTransactionReport>>;
readUtf8Document(root: URL, relativePath: string): Promise<RuntimeResult<string>>;
parseYamlDocument(text: string, source: string): RuntimeResult<unknown>;
parseJsonDocument(text: string, source: string): RuntimeResult<unknown>;
emitGeneratedYaml(value: unknown): string;
validateWithSchema<T>(schemaId: SchemaId, value: unknown): RuntimeResult<T>;
registerProjectSchemas(registrars: readonly SchemaRegistrar[]): RuntimeResult<readonly SchemaId[]>;
emitJsonSchemas(outputRoot: URL): Promise<RuntimeResult<readonly URL[]>>;
runCommand(spec: CommandSpec): Promise<RuntimeResult<CommandResult>>;
```

## Task 1 (Completed Baseline): Create the Dedicated Repository and Copy the Approved Planning Baseline

> Historical record only. This task completed at commit `0b3c88f`; retain it for provenance and do not execute it again.

**Files:**

- Create: `README.md`
- Create: `AGENTS.md`
- Create: `docs/superpowers/specs/2026-07-14-project-memory-system-design.md`
- Create: `docs/superpowers/plans/*.md`
- Create: `.gitignore`
- Create: `.gitattributes`

- [ ] Create the dedicated directory and initialize Git.

```powershell
New-Item -ItemType Directory -Force "<repository-root>" | Out-Null
Set-Location "<repository-root>"
git init
git branch -M main
New-Item -ItemType Directory -Force "docs\superpowers\specs", "docs\superpowers\plans" | Out-Null
```

Expected: Git reports an initialized repository and `git branch --show-current` prints `main`.

- [ ] Copy the approved specification and all implementation plans byte-for-byte from the planning workspace.

```powershell
Copy-Item "<planning-workspace>\docs\superpowers\specs\2026-07-14-project-memory-system-design.md" "docs\superpowers\specs\2026-07-14-project-memory-system-design.md"
Copy-Item "<planning-workspace>\docs\superpowers\plans\*.md" "docs\superpowers\plans\"
```

- [ ] Add a repository README with the source-of-truth boundary.

```markdown
# Project Memory System

Tool-neutral, repository-first context and governance for multi-agent projects.

The approved architecture is `docs/superpowers/specs/2026-07-14-project-memory-system-design.md`.
Implementation work follows the dependency order in `docs/superpowers/plans/2026-07-14-project-memory-implementation-roadmap.md`.

This repository owns the compiler, catalog, validator, selector, governance runtime, CLI, and distributable schemas. A target product repository owns its accepted `docs/project-memory/` instance.
```

- [ ] Add the Codex-only bootstrap router. It contains execution instructions and links, never canonical project facts.

```markdown
# Codex Project Instructions

Read `README.md`, then the approved design specification and the implementation roadmap before changing code.
Execute only the active plan task, use an isolated branch/worktree, run its named gates, and submit exact evidence.
Do not edit generated schemas, catalog locks, profile locks, generated views, or append-only history by hand.
This file is a tool adapter, not canonical product truth.
```
- [ ] Add repository hygiene files.

```gitignore
node_modules/
dist/
coverage/
.tmp/
*.log
```

```gitattributes
* text=auto eol=lf
*.md text eol=lf
*.yaml text eol=lf
*.yml text eol=lf
*.json text eol=lf
```

- [ ] Verify the copied baseline and commit it.

```powershell
git diff --check
git status --short
git add README.md AGENTS.md .gitignore .gitattributes docs
git commit -m "docs(architecture): add approved project memory baseline"
```

Expected: one root commit; the source specification and seven plan files are tracked.

## Task 2: Bootstrap the Strict TypeScript Package

**Files:**

- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `tests/smoke/package.test.ts`

- [ ] Write the failing package smoke test.

```ts
import { describe, expect, it } from "vitest";
import { PACKAGE_SCHEMA_VERSION } from "../../src/index.js";

describe("package foundation", () => {
  it("exports the v1 schema version", () => {
    expect(PACKAGE_SCHEMA_VERSION).toBe("1.0.0");
  });
});
```

- [ ] Create `package.json` with exact scripts and reviewed dependencies.

```json
{
  "name": "@pitaji/project-memory",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.0.0 <25" },
  "bin": { "project-memory": "./dist/cli.js" },
  "exports": { ".": "./dist/index.js" },
  "license": "UNLICENSED",
  "files": ["dist", "schemas", "catalog", "templates", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "schemas:emit": "tsc -p tsconfig.build.json && node dist/schema/emit.js",
    "catalog:validate": "tsc -p tsconfig.build.json && node dist/catalog/commands/build-tool.js validate",
    "catalog:inventory": "tsc -p tsconfig.build.json && node dist/catalog/commands/build-tool.js inventory",
    "catalog:fixtures": "tsc -p tsconfig.build.json && node dist/catalog/commands/build-tool.js fixtures",
    "catalog:lock": "tsc -p tsconfig.build.json && node dist/catalog/commands/build-tool.js lock",
    "catalog:bundle": "tsc -p tsconfig.build.json && node dist/catalog/commands/build-tool.js bundle",
    "check": "npm run typecheck && npm run lint && npm test && npm run build"
  },
  "dependencies": {
    "@sinclair/typebox": "0.34.52",
    "ajv": "8.20.0",
    "ajv-formats": "3.0.1",
    "semver": "7.8.5",
    "ulidx": "2.4.1",
    "yaml": "2.9.0"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/node": "24.13.3",
    "@types/semver": "7.7.1",
    "@vitest/coverage-v8": "4.1.10",
    "esbuild": "0.28.1",
    "eslint": "10.7.0",
    "typescript": "6.0.3",
    "typescript-eslint": "8.64.0",
    "vitest": "4.1.10"
  }
}
```

- [ ] Inspect every direct package before installation. Present the exact package/version/license/engine/dependency report to Pitaji and obtain approval for this new dependency set; do not run `npm install` until that approval is recorded.

```powershell
$packages = @("@sinclair/typebox@0.34.52", "ajv@8.20.0", "ajv-formats@3.0.1", "semver@7.8.5", "ulidx@2.4.1", "yaml@2.9.0", "@eslint/js@10.0.1", "@types/node@24.13.3", "@types/semver@7.7.1", "@vitest/coverage-v8@4.1.10", "esbuild@0.28.1", "eslint@10.7.0", "typescript@6.0.3", "typescript-eslint@8.64.0", "vitest@4.1.10")
foreach ($package in $packages) { npm view $package name version license engines peerDependencies dependencies dist.unpackedSize --json }
```

Expected: one reviewable metadata object per package. Stop this task until Pitaji approves the exact set.

The five `catalog:*` scripts are reserved build-time entry points. They intentionally point to the catalog-owned `src/catalog/commands/build-tool.ts` that is created before the first catalog script is invoked. That build tool is not the distributable `project-memory` CLI: it only parses the fixed catalog build flags documented in the catalog plan and delegates to typed `RuntimeResult` handlers.

- [ ] After the dependency approval is recorded, install from the exact `package.json` and create the lockfile without lifecycle scripts.

```powershell
npm install --ignore-scripts
npm audit --omit=dev
```

Expected: install completes without lifecycle scripts; any high or critical runtime finding stops the task for review.

- [ ] Add strict compiler, lint, test, and package entry files.

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2024"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "rootDir": ".",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

Create `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"],
    "noEmit": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["tests", "dist", "node_modules"]
}
```

Create `eslint.config.mjs`:

```js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "schemas/project-memory/v1/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error"
    },
  },
);
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
```

Create `src/index.ts`:

```ts
export const PACKAGE_SCHEMA_VERSION = "1.0.0" as const;
```

- [ ] Run the focused gate and commit.

```powershell
npm run typecheck
npm run lint
npm test -- tests/smoke/package.test.ts
git add package.json package-lock.json tsconfig*.json eslint.config.mjs vitest.config.ts src/index.ts tests/smoke/package.test.ts
git commit -m "chore(package): bootstrap strict TypeScript runtime"
```

Expected: one test passes; typecheck and lint exit `0`.

## Task 3: Implement Shared Results, IDs, and Deterministic Time

**Files:**

- Create: `src/contracts/runtime-result.ts`
- Create: `src/contracts/ids.ts`
- Create: `src/core/clock.ts`
- Create: `src/core/id-factory.ts`
- Create: `tests/core/id-factory.test.ts`

- [ ] Write tests for prefix validation, monotonic IDs, and injected time.

```ts
import { describe, expect, it } from "vitest";
import { MonotonicIdFactory } from "../../src/core/id-factory.js";

describe("MonotonicIdFactory", () => {
  it("creates stable-prefixed ULIDs from an injected clock", () => {
    const factory = new MonotonicIdFactory({ now: () => new Date("2026-07-14T12:00:00.000Z") });
    const first = factory.next("TASK");
    const second = factory.next("TASK");
    expect(first).toMatch(/^TASK-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(second > first).toBe(true);
  });
});
```

- [ ] Define the full instance-prefix union and result helpers.

```ts
export const INSTANCE_PREFIXES = [
  "ROOT", "CMP", "DOM", "INIT", "WS", "TASK", "CLAIM", "PKT",
  "DEC", "IDEA", "CHG", "FIND", "RISK", "EVD", "LESSON", "APR",
] as const;

export type InstancePrefix = (typeof INSTANCE_PREFIXES)[number];
export type RuntimeResult<T> =
  | { ok: true; value: T; warnings: readonly RuntimeIssue[] }
  | { ok: false; issues: readonly RuntimeIssue[] };
```

- [ ] Implement `SystemClock`, `FixedClock`, and `MonotonicIdFactory` without reading global time inside tests.

```ts
export class SystemClock implements Clock {
  now(): Date { return new Date(); }
}

export class FixedClock implements Clock {
  constructor(private readonly value: Date) {}
  now(): Date { return new Date(this.value); }
}
```

- [ ] Run the focused gate and commit.

```powershell
npm test -- tests/core/id-factory.test.ts
npm run typecheck
git add src/contracts src/core/clock.ts src/core/id-factory.ts tests/core/id-factory.test.ts
git commit -m "feat(core): add deterministic runtime primitives"
```

Expected: all prefix and monotonicity cases pass.

## Task 4: Implement Canonical Serialization and Hashing

**Files:**

- Create: `src/core/canonical-json.ts`
- Create: `src/core/hash.ts`
- Create: `tests/core/canonical-json.test.ts`
- Create: `tests/fixtures/canonical-json/*.json`

- [ ] Write failing tests for recursive key order, Unicode preservation, newline normalization, unsupported values, and repeatable SHA-256.

```ts
it("hashes semantically identical objects identically", () => {
  const left = { z: 1, nested: { b: true, a: "é" } };
  const right = { nested: { a: "é", b: true }, z: 1 };
  expect(sha256(canonicalJson(left))).toBe(sha256(canonicalJson(right)));
});
```

- [ ] Implement canonical JSON with lexicographically sorted object keys, preserved array order, UTF-8 output, and one trailing newline.

```ts
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(normalize(value))}\n`;
}
```

- [ ] Implement lowercase hexadecimal SHA-256 over explicit UTF-8 bytes.

```ts
export function sha256(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return createHash("sha256").update(bytes).digest("hex");
}
```

- [ ] Run repeatability tests twice and commit.

```powershell
npm test -- tests/core/canonical-json.test.ts
npm test -- tests/core/canonical-json.test.ts
git add src/core tests/core tests/fixtures/canonical-json
git commit -m "feat(core): add canonical serialization and hashing"
```

Expected: both test runs produce identical snapshots and hashes.

## Task 5: Enforce Repository-Root Path Safety

**Files:**

- Create: `src/core/path-safety.ts`
- Create: `tests/core/path-safety.test.ts`
- Create: `tests/fixtures/path-safety/root/inside.txt`

- [ ] Write failing tests for `..`, absolute paths, alternate separators, case changes on Windows, symlink escape, and a valid nested path.

```ts
it.each(["../outside", "C:\\outside", "/outside", "nested/../../outside"])(
  "rejects escape path %s",
  async (candidate) => expect((await resolveInside(rootUrl, candidate)).ok).toBe(false),
);
```

- [ ] Implement lexical confinement followed by realpath-based ancestor verification for existing ancestors.

```ts
export async function resolveInside(root: URL, relativePath: string): Promise<RuntimeResult<URL>> {
  if (relativePath.length === 0 || path.isAbsolute(relativePath)) return failure("PATH_INVALID", relativePath);
  const rootPath = path.resolve(fileURLToPath(root));
  const targetPath = path.resolve(rootPath, relativePath);
  if (!isSameOrChildPath(rootPath, targetPath)) return failure("PATH_ESCAPE", relativePath);
  return verifyExistingAncestors(rootPath, targetPath);
}
```

- [ ] Add a Windows case-insensitive comparison branch while preserving case-sensitive behavior on Linux and macOS.

- [ ] Run the focused tests and commit.

```powershell
npm test -- tests/core/path-safety.test.ts
npm run typecheck
git add src/core/path-safety.ts tests/core/path-safety.test.ts tests/fixtures/path-safety
git commit -m "feat(core): confine all writes to repository roots"
```

Expected: every escape fixture returns `PATH_ESCAPE`; the nested valid path resolves.

## Task 6: Implement Atomic File Transactions

**Files:**

- Create: `src/core/file-transaction.ts`
- Create: `src/contracts/planned-write.ts`
- Create: `tests/core/file-transaction.test.ts`

- [ ] Write failing tests for successful multi-file commit, duplicate paths, precondition hash mismatch, injected staging failure, injected rename failure, durable-journal recovery, cleanup after failure, and the path-confined single-write helper.

```ts
const fixedClock: Clock = { now: () => new Date("2026-07-14T12:00:00.000Z") };
const fixedIds: IdFactory = {
  next: (prefix) => `${prefix}-01J00000000000000000000001`,
};

it("leaves prior files unchanged when the second staged write fails", async () => {
  const fs = new FaultInjectingFileSystem({ fail_on_write_number: 2 });
  const result = await applyFileTransaction(root, writes, {
    fs,
    clock: fixedClock,
    ids: fixedIds,
  });
  expect(result.ok).toBe(false);
  expect(await readUtf8(existing)).toBe("before\n");
  expect(await findTransactionTemps(root)).toEqual([]);
});

it("uses the transaction protocol for one atomic write", async () => {
  const fs = new InMemoryTransactionFileSystem();
  const result = await writeFileAtomic(root, writes[0]!, {
    fs,
    clock: fixedClock,
    ids: fixedIds,
  });
  expect(result.ok && result.value.writes).toHaveLength(1);
});
```

- [ ] Define explicit write and precondition contracts.

```ts
export interface PlannedWrite {
  relative_path: string;
  bytes: Uint8Array;
  expected_existing_sha256: string | null;
  mode: "create" | "replace" | "create_or_replace";
}

export interface FileTransactionReport {
  transaction_id: string;
  recovered_prior_attempt: boolean;
  writes: readonly {
    relative_path: string;
    previous_sha256: string | null;
    next_sha256: string;
  }[];
}

export interface FileTransactionDependencies {
  fs: TransactionFileSystem;
  clock: Clock;
  ids: IdFactory;
}
```

- [ ] Stage writes under `.tmp/project-memory-transactions/<transaction-id>/`, fsync staged bytes, record expected/pre-image hashes in a durable journal, create rollback copies for replacements, and begin target renames only after every stage and precondition succeeds. Implement `writeFileAtomic(root, write, dependencies)` as the one-entry delegate to `applyFileTransaction`; it must use the same confinement, precondition, journal, fsync, rollback, and `RuntimeResult` behavior and must not introduce a second write path.

- [ ] On any reported failure, roll back renamed targets from verified pre-images before returning. On startup, recover an incomplete durable journal to either the complete new set or the complete prior set, then remove only the validated transaction directory; never delete a non-transaction path. Document that cross-file crash atomicity is recovered transactionally, while canonical Git ref atomicity is provided later by the integration coordinator.

- [ ] Run fault-injection tests and commit.

```powershell
npm test -- tests/core/file-transaction.test.ts
npm run typecheck
git add src/core/file-transaction.ts src/contracts/planned-write.ts tests/core/file-transaction.test.ts
git commit -m "feat(core): add atomic file transactions"
```

Expected: injected failures preserve all pre-transaction bytes, and `writeFileAtomic` proves one path-confined write uses the same transaction journal and returns a one-entry report.

## Task 7: Build the Executable Schema Registry

**Files:**

- Create: `src/schema/registry.ts`
- Create: `src/schema/validate.ts`
- Create: `src/schema/formats.ts`
- Create: `src/schema/registrars.ts`
- Create: `src/schema/project-registrars.ts`
- Create: `src/schema/emit.ts`
- Create: `src/schema/index.ts`
- Create: `tests/schema/registry.test.ts`
- Create: `schemas/project-memory/v1/.gitkeep`

- [ ] Write failing tests for duplicate schema IDs, unknown properties, ID formats, timestamps, semantic versions, path-aware errors, registrar ordering, registrar failure conversion, and proof that emission sees every schema registered by the supplied project registrar list.

```ts
it("rejects unknown keys with a stable issue path", () => {
  const result = validateWithSchema("project-memory/v1/root-reference", {
    id: "ROOT-01J2W...",
    unexpected: true,
  });
  expect(result).toMatchObject({ ok: false, issues: [{ code: "SCHEMA_ADDITIONAL_PROPERTY" }] });
});
```

- [ ] Register custom formats for definition IDs, prefixed instance IDs, RFC 3339 UTC timestamps, SHA-256, semantic versions, Git revisions, and safe relative paths.

```ts
export type SchemaId = `project-memory/v1/${string}`;

type VersionedSchema = TSchema & { $id: SchemaId };
const schemas = new Map<SchemaId, VersionedSchema>();

export function registerSchema<T extends VersionedSchema>(schema: T): T {
  if (schemas.has(schema.$id)) throw new Error(`duplicate schema id: ${schema.$id}`);
  schemas.set(schema.$id, schema);
  ajv.addSchema(schema);
  return schema;
}

export type SchemaRegistrar = () => readonly SchemaId[];

export function registerProjectSchemas(
  registrars: readonly SchemaRegistrar[],
): RuntimeResult<readonly SchemaId[]>;
```

`src/schema/project-registrars.ts` exports the ordered `PROJECT_SCHEMA_REGISTRARS` array. Foundation initializes it with only `registerFoundationSchemas`. A downstream registrar is never discovered dynamically: the lead integrator must add its explicit import and function reference before asking the emitter to include that subsystem. `registerProjectSchemas` invokes the supplied functions in stable registrar-name order, catches startup registration defects, rejects duplicate IDs across registrars, and returns the sorted registered IDs as `RuntimeResult`.

- [ ] Configure Ajv with `allErrors: true`, `strict: true`, `removeAdditional: false`, and no coercion or defaults.

- [ ] Emit byte-stable Draft 2020-12 JSON Schema files sorted by `$id`; fail if checked-in bytes differ. `src/schema/emit.ts` must first call `registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS)`, then call the `RuntimeResult`-returning `emitJsonSchemas`. It formats and throws one top-level error on failure so Node exits naturally; it must not call `process.exit` or assign `process.exitCode`.

- [ ] Run schema tests, emit twice, compare hashes, and commit.

```powershell
npm test -- tests/schema/registry.test.ts
npm run build
npm run schemas:emit
$first = Get-FileHash "schemas\project-memory\v1\schema-index.json" -Algorithm SHA256
npm run schemas:emit
$second = Get-FileHash "schemas\project-memory\v1\schema-index.json" -Algorithm SHA256
if ($first.Hash -ne $second.Hash) { throw "Schema emission is nondeterministic" }
git add src/schema tests/schema schemas/project-memory/v1
git commit -m "feat(schema): add strict executable schema registry"
```

Expected: both schema-index hashes match; registrar aggregation proves every explicit registrar ran before emission; duplicate or failed registrars return stable issues; invalid fixtures return stable issue paths.

## Task 8: Add Safe YAML and UTF-8 Document I/O

**Files:**

- Create: `src/core/document-io.ts`
- Create: `tests/core/document-io.test.ts`
- Create: `tests/fixtures/documents/*.yaml`
- Create: `tests/fixtures/documents/*.json`

- [ ] Write failing tests for path escape, duplicate YAML keys, aliases, merge aliases, custom or unknown tags, explicit timestamp/binary/set tags, non-string mapping keys, non-finite numbers, multi-document streams, duplicate JSON keys, a leading UTF-8 BOM, malformed UTF-8, and valid JSON-compatible YAML scalars (`null`, booleans, finite numbers, strings, arrays, and objects).

- [ ] Implement `readUtf8Document(root, relativePath)` by awaiting `resolveInside` and reading bytes without following an escaping link. Before constructing or calling `TextDecoder`, inspect the leading bytes and return `UTF8_BOM_FORBIDDEN` for `EF BB BF`; only BOM-free bytes reach `new TextDecoder("utf-8", { fatal: true })`. Decode failures return `UTF8_INVALID` through `RuntimeResult`.

- [ ] Parse YAML 1.2 with the core schema so catalog booleans, finite numbers, and null retain their JSON types. Configure `schema: "core"`, `version: "1.2"`, `merge: false`, `customTags: []`, `resolveKnownTags: false`, `uniqueKeys: true`, and `prettyErrors: false`; require exactly one document. Reject parser warnings as well as errors, recursively reject every alias node before conversion, allow only core map/sequence/string/null/boolean/integer/float tags, require string mapping keys, and recursively reject every converted value that is not JSON-compatible or is a non-finite number. Do not use a scalar-string-only schema because it converts booleans and numbers into strings.

```ts
export function parseYamlDocument(text: string, source: string): RuntimeResult<unknown> {
  const documents = parseAllDocuments(text, {
    schema: "core",
    version: "1.2",
    merge: false,
    customTags: [],
    resolveKnownTags: false,
    uniqueKeys: true,
    prettyErrors: false,
  });
  if (documents.length !== 1) {
    return { ok: false, issues: [{
      code: "YAML_DOCUMENT_COUNT",
      severity: "error",
      path: source,
      message: `expected one YAML document, found ${documents.length}`,
      references: [],
    }] };
  }
  const document = documents[0];
  if (
    document === undefined
    || document.errors.length > 0
    || document.warnings.length > 0
  ) {
    return yamlFailure(source, [
      ...(document?.errors ?? []),
      ...(document?.warnings ?? []),
    ]);
  }
  const safeNodes = validateJsonCompatibleYamlNodes(document.contents, source);
  if (!safeNodes.ok) return safeNodes;
  try {
    const value = document.toJS({ maxAliasCount: 0, mapAsMap: false });
    return validateJsonValue(value, source);
  } catch (error: unknown) {
    return yamlFailure(source, [error]);
  }
}
```

`validateJsonCompatibleYamlNodes` traverses the YAML AST, returning `YAML_ALIAS_FORBIDDEN`, `YAML_TAG_FORBIDDEN`, or `YAML_NON_STRING_KEY` before `toJS`. `validateJsonValue` returns `YAML_NON_JSON_VALUE` for `Date`, `Buffer`, `Map`, `Set`, `bigint`, `undefined`, functions, symbols, custom prototypes, `NaN`, or infinities. Both helpers return `RuntimeResult` with path-aware issues.

- [ ] Implement strict JSON parsing with duplicate-key detection and path-aware errors. Normalize emitted line endings to LF without changing user-owned source documents.

- [ ] Implement `emitGeneratedYaml` for generated locks only with sorted keys, no aliases, explicit quoting where needed, and one trailing LF; canonical hashes use canonical JSON, never YAML presentation bytes.

- [ ] Run tests and commit.

```powershell
npm test -- tests/core/document-io.test.ts
npm run typecheck
git add src/core/document-io.ts tests/core/document-io.test.ts tests/fixtures/documents
git commit -m "feat(core): add strict YAML and UTF-8 document IO"
```

Expected: core-schema booleans, finite numbers, and null preserve their JSON types; BOMs, aliases, duplicate keys, unknown/custom or non-JSON tags and values, non-string keys, non-finite numbers, unsafe YAML features, and malformed bytes fail closed with stable issues.

## Task 9: Add Git and Shell-Free Command Abstractions

**Files:**

- Create: `src/contracts/git-client.ts`
- Create: `src/contracts/command-runner.ts`
- Create: `src/core/git-cli-client.ts`
- Create: `src/core/command-runner.ts`
- Create: `tests/core/command-runner.test.ts`
- Create: `tests/core/git-cli-client.test.ts`

- [ ] Write tests proving arguments containing spaces, semicolons, dollar signs, and ampersands remain literal arguments. Add a default-wrapper test proving an injected spawn rejection becomes a stable `COMMAND_RUNNER_FAILURE` `RuntimeResult` issue rather than escaping.

```ts
it("does not interpret gate arguments through a shell", async () => {
  const result = await runner.run({
    executable: process.execPath,
    args: [fixtureScript, "a;b", "$HOME", "x&y"],
    cwd: fixtureRoot,
    timeout_ms: 5_000,
    env_allowlist: {},
  });
  expect(JSON.parse(result.stdout)).toEqual(["a;b", "$HOME", "x&y"]);
});
```

- [ ] Implement the contained injected port `CommandRunner.run(spec: CommandSpec): Promise<CommandResult>` with `spawn`, `shell: false`, bounded stdout/stderr capture, timeout termination, and an explicit environment allowlist. The port may reject; the exported default-wrapper `runCommand(spec): Promise<RuntimeResult<CommandResult>>` must catch every rejection and return a stable issue. Domain code must consume the wrapper or catch and convert an injected port failure before returning.

- [ ] Implement Git methods for head, status, common Git directory, merge base, changed paths, object existence, and worktree creation/removal behind the exact `GitClient` contract below.

```ts
export interface GitClient {
  head(repo: URL): Promise<string>;
  statusPorcelain(repo: URL): Promise<readonly GitStatusEntry[]>;
  commonGitDir(repo: URL): Promise<URL>;
  mergeBase(repo: URL, left: string, right: string): Promise<string>;
  changedPaths(repo: URL, base: string, head: string): Promise<readonly string[]>;
  createDetachedWorktree(repo: URL, revision: string, destination: URL): Promise<void>;
  removeWorktree(repo: URL, destination: URL): Promise<void>;
}
```

- [ ] Reject dirty canonical roots for operations that declare `requires_clean_tree: true`.

- [ ] Run tests and commit.

```powershell
npm test -- tests/core/command-runner.test.ts tests/core/git-cli-client.test.ts
npm run typecheck
git add src/contracts src/core/command-runner.ts src/core/git-cli-client.ts tests/core
git commit -m "feat(core): add safe command and Git boundaries"
```

Expected: metacharacters remain literal and no test launches a shell.

## Task 10: Establish Cross-Subsystem Contract Fixtures and the Foundation Gate

**Files:**

- Create: `src/contracts/canonical-mutation-plan.ts`
- Create: `tests/contracts/runtime-result.contract.test.ts`
- Create: `tests/contracts/schema-index.contract.test.ts`
- Create: `tests/contracts/canonical-mutation-plan.contract.test.ts`
- Create: `tests/fixtures/repositories/minimal/.gitkeep`
- Modify: `src/index.ts`
- Modify: `README.md`

- [ ] Export foundation interfaces only through `src/index.ts`; prevent deep imports from becoming public API.

```ts
export * from "./contracts/runtime-result.js";
export * from "./contracts/ids.js";
export * from "./contracts/planned-write.js";
export * from "./contracts/canonical-mutation-plan.js";
export * from "./contracts/command-runner.js";
export * from "./contracts/git-client.js";
export * from "./core/clock.js";
export * from "./core/id-factory.js";
export * from "./core/canonical-json.js";
export * from "./core/hash.js";
export * from "./core/path-safety.js";
export * from "./core/document-io.js";
export * from "./core/file-transaction.js";
export * from "./core/command-runner.js";
export * from "./core/git-cli-client.js";
export * from "./schema/index.js";
```

- [ ] Implement `CanonicalMutationPlan`, `CanonicalMutationKind`, and `canonicalMutationPlanHash` only in `src/contracts/canonical-mutation-plan.ts`. The hash is SHA-256 over canonical JSON with `plan_hash` omitted and writes projected to `relative_path`, `mode`, `expected_existing_sha256`, and `bytes_sha256`, sorted by UTF-8 path bytes. Domain plans may define only their metadata type or a narrowed mutation-kind alias; they import the shared plan and hash from the package root and never redefine either one.

- [ ] Add contract tests proving write input order does not change `canonicalMutationPlanHash`, any byte or stable-field change does change it, every registered schema has a unique versioned ID, and every public domain operation plus exported path, parse, validation, schema-emission, command-wrapper, and write helper uses `RuntimeResult`. The test explicitly permits only startup `registerSchema` programmer/configuration failures and the injected `CommandRunner`, `GitClient`, and `TransactionFileSystem` ports to reject or throw; it also proves callers convert those port failures before crossing a public domain boundary.

- [ ] Document the invariant that subsystems return issues instead of calling `process.exit`. Exactly two executable entrypoints may map `RuntimeResult` issues to an explicit process exit code: the distributable `src/cli.ts` and the internal build-only `src/catalog/commands/build-tool.ts`. `src/schema/emit.ts` may throw one formatted top-level error after a failed result so Node exits naturally, but it must not call `process.exit` or assign `process.exitCode`.

- [ ] Run the full foundation gate.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run schemas:emit
git diff --check
git status --short
```

Expected: all commands exit `0`; only deliberate generated schema files appear as changes.

- [ ] Commit the foundation release point.

```powershell
git add src tests schemas README.md
git commit -m "test(foundation): lock shared subsystem contracts"
git tag foundation-v0.1.0
```

## Foundation Completion Gate

Before a downstream plan starts, verify:

- [ ] `npm run check` exits `0`.
- [ ] Schema emission is byte-for-byte deterministic across two runs.
- [ ] All path-escape fixtures fail closed.
- [ ] Injected transaction failures leave previous bytes unchanged.
- [ ] Command tests prove `shell: false` behavior.
- [ ] `git diff --check` produces no output.
- [ ] `git status --short` is empty after the final commit.

