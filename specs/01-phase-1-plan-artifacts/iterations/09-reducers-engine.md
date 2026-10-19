# Iteration 9 — Reducers, `engine.*` partitions and housekeeping

Commit: `Phase 1.9: reducers, engine.* partitions and housekeeping actions` (SHA is in `git log`).

## Criteria results (Node 22.18.0 + pnpm 10.15.1)
- VC-045 (registered meta reducer changes only its partition, other partitions `===`; unregistered `schema_id` -> `MALFORMED_ACTION`; roster `join`/`set_status` change only `roster`) — PASS (`pnpm exec vitest run packages/core/src/session/apply/reducers.test.ts`).
- VC-051 (float, function, cyclic, bigint, Map, undefined, array, undeclared field, wrong type, throwing getter; thrown Error / string / number; frozen partition/payload mutation; counters mutated through a captured cast; roster output with `counters`/`zones`; state digest unchanged) — PASS.
- VC-052 (every happy and failing path of gate_open/submit/retract/resolve, grant_expire/consume, unknown `engine.nope`) — PASS.
- VC-053 (non-expected seat -> `GATE_CLOSED`, resolved gate -> `GATE_CLOSED`, unknown gate -> `MALFORMED_ACTION`) — PASS; KBR-007 failing-path tests carry the id in their names.
- VC-056 reducer variant (`[adjust(a,-1), meta no-op, adjust(b,+1)]` ok; surviving imbalance still `COUNTER_BOUNDS`) — PASS.
- VC-088 (`[engine.grant_consume, roster revoke_delegation, move]` committed in order, once each; a plain batch commits nothing extra) — PASS.
- VC-004 reducer case (failure at input index 3 -> `actionIndex 3`) — PASS.
- KBR-010 failing paths (cast mutation, roster dropping a seat control uses, direct `findInvariantViolation` cases for KBR-001/006/007/008 and counter bounds) — PASS; names contain `KBR-010`.
- `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test` — exit 0 (514 tests, 35 files); `pnpm test:guardrails` (168) and `pnpm format:check` green.
- Artifacts: this file, `CONTEXT.md`, `DECISIONS.md` D-025..D-027 — PASS.

## Files
- Added: `session/reducer.ts`, `session/apply/{reducer,invariants}.ts`, `session/apply/primitives/{meta,engine}.ts`, `session/apply/reducers.test.ts`, `session/apply/reducers.testing.ts`, this record.
- Changed: `session/apply/primitives/{index,roster}.ts` (meta case, roster reducer path), `definition/types.ts` and `definition/index.ts` (typed reducers, `PartitionReducer` removed), `definition/definition.testing.ts` (generic `identity`), `replay/canonical/state-schema.ts` (exports `rosterNode`, `metaPartitionNode`), `session/index.ts` (type `Reducer`), `session/create.test.ts` (reducer typing), `session/apply/primitives.test.ts` (unsupported example is now a macro), `CONTEXT.md`, `DECISIONS.md`.

## Deviations
- None from scope. The "not yet supported" test now uses a macro (the only unsupported kind left). Interpretations: D-025..D-027.

## Gotchas
- macOS `sed -i` needs `''`; a failed `sed && cat` chain silently skips the rest. Use python or the Edit tool.
- Conservation fixtures: the default `bank` counter is `mint`, so a conservation-neutral adjust pair needs a custom group (the VC-056 test builds counters `a`, `b`).
- `no-unnecessary-type-assertion` flags casts the type checker already accepts; run `eslint --fix` on new test files.
- Reducer output is cloned, so the roster's unchanged entries are new objects (D-026).

## For the next iteration (10: macros)
- Replace the macro branch in `session/apply/expand.ts` (it currently fails "not yet supported"); `makeContext` already gives `ctx.work` for sequential expansion. The unsupported-kind test in `primitives.test.ts` uses `A.draw` and must change when macros land.
- Add the literal `[draw 2, grant, grant]` VC-043 case, VC-004 `[draw 2, ...]` / `EMPTY_ZONE` index cases and VC-024 `[draw count 0]`.
- Iteration 11: `spi` must re-export `Reducer<S>` from `session/reducer.ts` (D-025).
