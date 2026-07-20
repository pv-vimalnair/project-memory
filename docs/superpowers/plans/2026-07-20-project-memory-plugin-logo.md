# Project Memory Plugin Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package and install the approved Project Memory pixel logo so Codex renders it instead of the generic fallback symbol.

**Architecture:** Keep the repository-level logo as the immutable artwork source and copy it byte-for-byte into the installable plugin root. Declare the packaged file through `interface.logo` and `interface.logoDark`, then extend the existing fail-closed verifier with one exact-path, exact-hash binary allowance.

**Tech Stack:** Codex plugin manifest, PNG, Node.js, TypeScript, Vitest, Git, Codex CLI

## Global Constraints

- The approved source is `assets/brand/project-memory-logo.png` with SHA-256 `DF1E9BE53CB65B6B5ABB3DB431C708B4AB004CD494A1CF56D0E85C2B1D44CC67`.
- Keep Project Memory base version `0.1.1`; use exactly one helper-generated `+codex.<cachebuster>` build suffix for the local reinstall, and do not modify or retag v0.1.0.
- Use the same transparent PNG for `interface.logo` and `interface.logoDark`.
- Do not add `composerIcon`, redraw artwork, add dependencies, publish, or push.
- The verifier must reject any logo bytes that do not match the approved SHA-256.

---

### Task 1: Lock the plugin logo contract with failing tests

**Files:**
- Modify: `plugins/project-memory/tests/release/plugin-contents.test.ts`
- Test: `plugins/project-memory/tests/release/plugin-contents.test.ts`

**Interfaces:**
- Consumes: clean plugin copy under `.tmp/plugin-install/project-memory`.
- Produces: assertions for the packaged path, manifest references, approved hash, and altered-byte rejection.

- [ ] **Step 1: Add the clean-package logo assertions**

Extend the first clean-install test with:

```ts
const APPROVED_LOGO_SHA256 =
  "df1e9be53cb65b6b5abb3db431c708b4ab004cd494a1cf56d0e85c2b1d44cc67";

expect(paths).toContain("assets/project-memory-logo.png");
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
```

- [ ] **Step 2: Add altered-logo rejection coverage**

```ts
it("rejects altered Project Memory logo bytes", async () => {
  const inspected = await maliciousCase(
    "altered-logo",
    "assets/project-memory-logo.png",
    "not-the-approved-logo\n",
  );
  expect(inspected.status).toBe(1);
  expect(inspected.stderr).toContain("PLUGIN_CONTENT_HASH_MISMATCH");
});
```

- [ ] **Step 3: Run the focused test and verify it fails for the missing contract**

```powershell
npx vitest run tests/release/plugin-contents.test.ts --maxWorkers=1
```

Run from: `plugins/project-memory`

Expected: FAIL because the asset, manifest fields, and exact-hash verifier allowance do not exist yet.

### Task 2: Package and verify the approved logo

**Files:**
- Create: `plugins/project-memory/assets/project-memory-logo.png`
- Modify: `plugins/project-memory/.codex-plugin/plugin.json`
- Modify: `plugins/project-memory/scripts/verify-plugin-contents.mjs`
- Test: `plugins/project-memory/tests/release/plugin-contents.test.ts`

**Interfaces:**
- Consumes: the approved repository asset and its locked SHA-256.
- Produces: a self-contained plugin whose manifest references an exact-hash verified PNG.

- [ ] **Step 1: Copy the approved artwork byte-for-byte**

```powershell
New-Item -ItemType Directory -Force plugins/project-memory/assets
Copy-Item -LiteralPath assets/brand/project-memory-logo.png -Destination plugins/project-memory/assets/project-memory-logo.png
```

Expected: source and destination SHA-256 values are both `DF1E9BE53CB65B6B5ABB3DB431C708B4AB004CD494A1CF56D0E85C2B1D44CC67`.

- [ ] **Step 2: Declare the light and dark logo paths**

Add to `interface` in `.codex-plugin/plugin.json`:

```json
"logo": "./assets/project-memory-logo.png",
"logoDark": "./assets/project-memory-logo.png"
```

- [ ] **Step 3: Add the exact binary allowlist contract**

In `verify-plugin-contents.mjs`, add:

```js
const APPROVED_BINARY_FILES = new Map([
  [
    "assets/project-memory-logo.png",
    "df1e9be53cb65b6b5abb3db431c708b4ab004cd494a1cf56d0e85c2b1d44cc67",
  ],
]);
```

Add `assets/project-memory-logo.png` to `REQUIRED_FILES`, add `assets` to `copyRuntimeAllowlist()`, and accept `APPROVED_BINARY_FILES.has(relativePath)` in `allowlistedPath()`.

At the beginning of `assertSafeContent()`, enforce:

```js
const approvedHash = APPROVED_BINARY_FILES.get(relativePath);
if (approvedHash !== undefined) {
  const actualHash = sha256(bytes);
  if (actualHash !== approvedHash) {
    throw new PluginVerificationError(
      "PLUGIN_CONTENT_HASH_MISMATCH",
      `${relativePath}: approved binary hash mismatch`,
    );
  }
  return;
}
```

- [ ] **Step 4: Run the focused test and plugin verifier**

```powershell
npx vitest run tests/release/plugin-contents.test.ts --maxWorkers=1
npm run plugin:verify
```

Expected: the focused test passes and plugin verification reports `"valid":true` with `assets/project-memory-logo.png` in the logical manifest.

- [ ] **Step 5: Commit the bounded implementation**

```powershell
git add plugins/project-memory/assets/project-memory-logo.png plugins/project-memory/.codex-plugin/plugin.json plugins/project-memory/scripts/verify-plugin-contents.mjs plugins/project-memory/tests/release/plugin-contents.test.ts
git diff --cached --check
git commit -m "feat(plugin): display Project Memory logo"
```

### Task 3: Refresh, validate, merge, and reinstall v0.1.1

**Files:**
- Verify: `plugins/project-memory/.codex-plugin/plugin.json`
- Verify: `plugins/project-memory/assets/project-memory-logo.png`
- Verify installed copy under `C:/Users/Pv Vimal Nair/.codex/plugins/cache/project-memory/project-memory/`

**Interfaces:**
- Consumes: the committed feature branch, configured `project-memory` marketplace, and Codex CLI.
- Produces: clean local `main` and an installed v0.1.1 plugin with the approved logo bytes.

- [ ] **Step 1: Refresh the local-install cachebuster through the official helper**

```powershell
python "C:\Users\Pv Vimal Nair\.codex\skills\.system\plugin-creator\scripts\update_plugin_cachebuster.py" "C:\tmp\pm\plugins\project-memory"
python "C:\Users\Pv Vimal Nair\.codex\skills\.system\plugin-creator\scripts\read_marketplace_name.py" --marketplace-path "C:\Users\Pv Vimal Nair\project-memory\.agents\plugins\marketplace.json"
git diff -- plugins/project-memory/.codex-plugin/plugin.json
git add plugins/project-memory/.codex-plugin/plugin.json
git diff --cached --check
git commit -m "chore(plugin): refresh Codex cachebuster"
```

Expected: the manifest version has base `0.1.1` and exactly one `+codex.<timestamp>` suffix; the marketplace helper prints `project-memory`; no marketplace/config file changes.

- [ ] **Step 2: Run proportionate source and package gates**

```powershell
npm run typecheck
npm run lint
npm run plugin:verify
npm run package:verify
git diff --check
git status --short --branch
```

Run npm commands from: `plugins/project-memory`

Expected: every gate exits `0` and the feature worktree is clean.

- [ ] **Step 3: Fast-forward local main**

```powershell
git -C "C:\Users\Pv Vimal Nair\project-memory" status --porcelain
git -C "C:\Users\Pv Vimal Nair\project-memory" merge --ff-only codex/project-memory-logo-icon
```

Expected: main is clean before the merge and fast-forwards without rewriting history.

- [ ] **Step 4: Install the newer plugin from the configured marketplace**

```powershell
& "C:\Users\Pv Vimal Nair\AppData\Local\OpenAI\Codex\bin\5dee10576ec7a5b8\codex.exe" plugin add project-memory@project-memory --json
& "C:\Users\Pv Vimal Nair\AppData\Local\OpenAI\Codex\bin\5dee10576ec7a5b8\codex.exe" plugin list
```

Expected: `project-memory@project-memory` is installed and enabled at `0.1.1+codex.<cachebuster>`. If the add command refuses to upgrade an installed plugin, stop and diagnose before removing anything.

- [ ] **Step 5: Verify installed metadata and bytes**

Resolve the v0.1.1 installed cache directory reported by Codex, then verify:

```powershell
$installed = Get-ChildItem -LiteralPath "C:\Users\Pv Vimal Nair\.codex\plugins\cache\project-memory\project-memory" -Directory |
  Where-Object Name -Like "0.1.1+codex.*" |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1
$manifest = Get-Content -Raw -LiteralPath "$($installed.FullName)\.codex-plugin\plugin.json" | ConvertFrom-Json
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath "$($installed.FullName)\assets\project-memory-logo.png").Hash
$manifest.interface.logo
$manifest.interface.logoDark
$hash
```

Expected: both manifest paths are `./assets/project-memory-logo.png` and the hash is `DF1E9BE53CB65B6B5ABB3DB431C708B4AB004CD494A1CF56D0E85C2B1D44CC67`.

- [ ] **Step 6: Record the restart boundary**

Expected: report that installation is complete but the currently running Codex app may retain its old sidebar cache until Pitaji restarts it. Do not claim visual success before that restart.
