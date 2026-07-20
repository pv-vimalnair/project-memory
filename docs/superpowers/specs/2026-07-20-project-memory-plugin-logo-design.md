# Project Memory Plugin Logo Design

## Goal

Display the approved Project Memory pixel logo in Codex instead of the generic fallback document/folder icon.

## Cause

The Project Memory plugin manifest does not declare `interface.logo` or `interface.logoDark`, and the installable plugin package contains no logo asset. Codex therefore has no Project Memory artwork to render and falls back to its generic symbol.

## Considered approaches

1. **Package the approved logo and declare it in the plugin manifest (selected).** This follows the installed Codex plugin contract and keeps the plugin self-contained.
2. **Reference the repository-level logo directly.** Rejected because `assets/brand/project-memory-logo.png` sits outside the installable plugin root and would be missing from installed copies.
3. **Generate or redraw a plugin-specific icon.** Rejected because Pitaji approved the existing logo and requested that exact artwork.

## Approved design

- Treat `assets/brand/project-memory-logo.png` as the immutable artwork source.
- Copy it byte-for-byte into `plugins/project-memory/assets/project-memory-logo.png`.
- Set both `interface.logo` and `interface.logoDark` to `./assets/project-memory-logo.png` so the same approved transparent PNG is used in light and dark themes.
- Keep `composerIcon` outside this change because the reported defect is the plugin/sidebar logo and no separate compact monochrome asset was approved.
- Keep Project Memory at v0.1.1; do not modify, retag, or republish v0.1.0.
- Extend package verification so a missing, altered, or unreferenced logo fails closed.
- Rebuild and verify the v0.1.1 plugin, then reinstall the local Codex plugin from the verified source.

## Validation

- Confirm the packaged logo SHA-256 equals the approved source SHA-256: `DF1E9BE53CB65B6B5ABB3DB431C708B4AB004CD494A1CF56D0E85C2B1D44CC67`.
- Confirm the manifest resolves both logo fields to an existing packaged file.
- Run focused manifest/package tests, typecheck, lint, plugin verification, and package verification.
- Reinstall v0.1.1 and confirm the installed manifest and logo hash match the verified source.
- Restart Codex before visually checking the sidebar because the current process may cache plugin metadata.

## Boundaries

- **Keep:** the approved logo pixels, v0.1.0 history, v0.1.1 behavior, and all unrelated plugin metadata.
- **Add:** one packaged PNG, two manifest fields, and focused validation coverage.
- **Remove:** nothing.
