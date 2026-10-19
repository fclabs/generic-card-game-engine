# Iteration 4 — Session state, createSession, digest, maskGates

Commit: `Phase 1.4: SessionState, createSession, stateDigest and maskGates` (SHA is in `git log`).

## Criteria results (Node 22.18.0 + pnpm 10.15.1)
- VC-010 (`create.test.ts`, 10-card fixture, state as specified, freeze walk, accepted shape) — PASS (`pnpm test`).
- VC-011 (six roster error cases + valid rosters; `MALFORMED_ACTION`, id named, no `actionIndex`) — PASS.
- VC-012 (`@ts-expect-error` writes via `Snapshot<SessionState>` in `snapshot.test.ts`) — PASS (`pnpm typecheck`).
- VC-013 initial half, VC-014 mutation guard (push/assign/delete throw, digest unchanged) — PASS.
- VC-054 both halves (`engine.custom` rejected by `assertDefinitionStructure` and identically by `createSession`) — PASS.
- VC-058 derived counter recomputed (0 -> 2), absent from `counters`, serialised right after `counters` — PASS.
- VC-062 digest half (reversed insertion order) — PASS. VC-063: 18 cases (one per listed field, derived input included) — PASS.
- VC-068 (exports exactly `CanonicalError canonicalize sha256Hex stateDigest`; root re-exports each) — PASS.
- VC-082 `maskGates` (two open gates, three sealed submissions, resolved unchanged, `===` elsewhere, frozen, type test) — PASS.
- VC-089 canonicalize half (`definitionDataSchema`, no function serialised, floor def too) — PASS.
- VC-084 create/digest half (floor def: 700 cards / 64 zones, digest computed) — PASS.
- `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test` — exit 0 (271 tests); `pnpm test:guardrails` (168) and `pnpm format:check` green.
- Artifacts: this file, `CONTEXT.md`, `DECISIONS.md` D-009..D-012 — PASS.

## Files
- Added: `session/{state,create,mask-gates}.ts`, `session/state.testing.ts`, `session/{create,mask-gates}.test.ts`, `replay/canonical/{state-schema,definition-schema}.ts`, `replay/canonical/state-digest.test.ts`, this record.
- Changed: `session/index.ts`, `session/snapshot.test.ts` (re-pointed at `SessionState`), `definition/types.ts` (`DerivedEvaluator` typed), `replay/canonical/index.ts` (+`stateDigest`), `replay/canonical/index.test.ts`, `index.test.ts`, `CONTEXT.md`, `DECISIONS.md`.

## Deviations
- None from scope. Interpretation choices in D-009 (unioned idMap value nodes), D-010 (initial state), D-011, D-012. `buildStateSchema`/`canonicalStateBytes`/`definitionDataSchema` are core-internal (not in any index).

## Gotchas
- `idMap` has one value node, so heterogeneous card metadata/meta partitions use a unioned optional-field object (D-009).
- Evaluators receive the full state; an evaluator reading `state.cards` etc. is fine because the state is a `Snapshot`.
- `definition/types.ts` now imports session state types (type-only); depcruise is clean.
- `exactOptionalPropertyTypes`: build optional keys with conditional spreads, never `key: undefined`.
- Lint flags needless `as` casts in tests/code; `cloneData(snapshot)` is assignable to the mutable type without a cast.

## For the next iteration
- Iteration 5 (PRNG) is independent of state. Iteration 6 (`apply`) starts from `createSession` output; copy-on-write the working state and freeze only new objects (`deepFreeze` always descends — D-001). Use `variant` from `session/state.testing.ts` to hand-build states in tests.
- Records are plain objects keyed by ids; beware `__proto__`-like keys when writing (see CONTEXT Known gaps).
- `stateDigest(def, state)` is the identity function for atomicity/replay tests (VC-022/025/092).
