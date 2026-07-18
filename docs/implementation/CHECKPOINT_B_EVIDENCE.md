# Checkpoint B — Catalog and Selection Contracts

Date: 2026-07-14
Branch: `feat/project-memory-v1`
Freeze tag: `checkpoint-b-v0.1.0`

## Integrated surface

- Foundation schemas: 3
- Catalog schemas: 12
- Selection schemas: 6
- Planning and packet schemas: 7
- Total registered and emitted schemas: 28
- Root kinds: 5
- Primary archetypes: 11
- Pattern modes: 9
- Pattern families: 16
- Selection dispositions: 3

The catalog loader, half assemblers, validators, feature normalizer, eight predicate operators, and shared scoring engine are executable. Full catalog content is deliberately deferred to Checkpoint C.

## Determinism evidence

Two independent `npm run schemas:emit` runs produced the same schema-index SHA-256:

`43E63148821ECE357D2F95C02E3BF7608DFD1E9A12D15EAD073318B6A3AE2D19`

Both indexes contained exactly 28 schema entries.

## Quality gate

`npm run check` passed with:

- TypeScript typecheck: pass
- ESLint strict rules: pass
- Vitest: 24 files, 133 tests, all pass
- Production TypeScript build: pass

## Integration correction

Wiring all registrars exposed an ESM cycle: subsystem schema modules imported the public schema barrel, while that barrel exports the lead-integrator registrar list. Internal imports now target `schema/registry` and `schema/validate` directly. The public barrel remains the external aggregation surface without participating in subsystem initialization.

The contract vocabulary is centralized in `src/contracts/vocabulary.ts`, and cross-contract tests lock YAML wrapper keys, TypeScript vocabulary types, schema IDs, family/mode restrictions, and selection dispositions.
