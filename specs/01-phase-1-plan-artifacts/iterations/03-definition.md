# Iteration 3 — Compiled-definition types and structural check

Commit: `Phase 1.3: CompiledGameDefinition types, structure check and test builders` (SHA is in `git log`).

## Criteria results (Node 22.18.0 + pnpm 10.15.1)
- VC-083: `pnpm exec vitest run packages/core/src/definition` — PASS (23 invalid fixtures each assert code, no actionIndex, entity-naming detail; valid fixtures `ok`).
- VC-054 (definition half): `engine.custom` reducer fixture fails with the reserved-namespace error — PASS.
- VC-089 (shape half): `definition.test.ts` uses every KFR-100 component (derived evaluator, supply role, reducer, roster reducer, hook table, pointers, policies); `definitionData` contains no function and no `undefined` — PASS; type-checked by `pnpm typecheck`.
- `buildFloorDefinition()` = 14 seats / 4 teams / 700 cards / 64 zones and passes `assertDefinitionStructure` — PASS.
- `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test` — exit 0 (226 tests); `pnpm test:guardrails` (168) and `pnpm format:check` also green.
- Artifacts: this file, `CONTEXT.md`, `DECISIONS.md` D-007, D-008 — PASS.

## Files
- Added: `packages/core/src/definition/{types,assert,data,definition.test,definition.testing}.ts`, this record.
- Changed: `packages/core/src/definition/index.ts`, `CONTEXT.md`, `DECISIONS.md`.

## Deviations
- None from scope. Added `definitionData` + `DefinitionData` types (the plan allowed "a helper `definitionData(def)`"). Choices in D-007/D-008.

## Gotchas
- `exactOptionalPropertyTypes` is on: `Partial<CompiledGameDefinition>` cannot be given `undefined` for an optional member; destructure to omit.
- Tests construct "missing starting zone" with a cast; the type requires `startingZone`.
- Prettier reformats `*.testing.ts` too; run `pnpm exec prettier --write` before `format:check`.

## For the next iteration
- Iteration 4: import types from `definition/`; `createSession` calls `assertDefinitionStructure` first and returns its error as-is (VC-054 create half). Tighten `DerivedEvaluator` to take `Snapshot<SessionState>`. Build a `CanonicalSchema` for `DefinitionData` if canonicalizing it (VC-089 canonicalize half): bigints via `bigintNode`, optional fields (`type`, `max`, `scale`, `rounding`, `supplyRole`, `team`) via `optionalNode`, `hookBindings`/`costBudgets`/`metadataSchema` via `idMapNode` (keys are free strings; idMap sorting is by code unit).
- Builders are in `definition.testing.ts`; floor ids are in CONTEXT.md.
