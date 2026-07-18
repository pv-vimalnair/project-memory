# Checkpoint C - Complete v1 Catalog

Date: 2026-07-15
Branch: `feat/project-memory-v1`
Freeze tag: `checkpoint-c-v0.1.0`
Catalog release: `project-memory@1.0.0`

## Locked catalog surface

- Blueprint groups: 11
- Blueprints: 62
- Components: 78
- Permanent domains: 15
- Overlays: 46
- Adapters: 15
- Pattern families: 16
- Pattern core/taxonomy pairs: 257 / 257
- Companion core/taxonomy pairs: 13 / 13
- Missing halves: 0
- Blueprint fixtures: 150

The 150 integrated blueprint cases comprise 62 positive, 62 anti-signal, and 26 boundary cases. All 150 passed through the shared normalizer and scorer.

## Immutable release evidence

The final deterministic release hash is:

`eef3ed80d99a2fb925c8933667d22c118cfca29927187af6c55e11772c0aa030`

The release lock covers 962 catalog source files and verification checked 965 paths with zero invalid entries. A second `catalog:bundle --check-clean` run reported `written=false`, proving the existing bundle, lock, and checksum bytes were identical. Tamper and immutable-rewrite tests also pass.

Generated release artifacts:

- `dist/catalog/project-memory/1.0.0/catalog.bundle.json`
- `dist/catalog/project-memory/1.0.0/catalog.lock.json`
- `dist/catalog/project-memory/1.0.0/SHA256SUMS`

## Schema determinism

Two independent `npm run schemas:emit` runs produced the same schema-index SHA-256:

`316202a4f07bf80d6265e976f5620f855044cc7a0ac50e2bbd976860a3ddc1d8`

## Quality gate

The final `npm run check` passed with:

- TypeScript typecheck: pass
- ESLint: pass
- Vitest: 31 files, 148 tests, all pass
- Production TypeScript build: pass

Additional release gates passed:

- Strict all-scope catalog validation: pass
- Pinned inventory check: pass
- Integrated blueprint fixtures: 150 / 150
- Release lock verification: 965 paths, zero invalid
- Package dry run: 1,240 files; all required catalog, schema, and release artifacts present
- `git diff --check`: pass
- Forbidden changed pattern/companion core scan: zero matches

## Gate correction

The exact release command exposed that `--scope all --strict` reported `strict=false`. A focused regression test first reproduced the defect, then the validator command was corrected to preserve the caller's strict flag. The exact command now reports `strict=true`, and the full suite locks that behavior.