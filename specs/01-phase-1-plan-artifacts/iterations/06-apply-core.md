# Iteration 6 — `apply` core and structural primitives

Commit: `Phase 1.6: apply pipeline with atomic commit and structural primitives` (SHA is in `git log`).

## Criteria results (Node 22.18.0 + pnpm 10.15.1)
- VC-004 first two cases (`[move, move(card not in zone)]` -> `CARD_NOT_IN_ZONE`, index 1, card id in detail; malformed carries `$[i].field` path) — PASS (`apply.test.ts`). Remaining cases: draw/`EMPTY_ZONE` (10), reducer (9), conservation (7).
- VC-005 (1 000 corrupted actions + 1 000 `fc.anything()` junk batches + 500 junk batch values -> `Err`, no throw) — PASS.
- VC-013 post-apply freeze walk (state, nested metadata, outcome, committed, notifications, result) — PASS. Caller's action objects are never frozen/retained — PASS.
- VC-015 (64-zone floor state: 1 move -> 62 zones, `counters` and all other members `===`; 20 moves in 4 zones -> 60 zones `===`, untouched cards `===`) — PASS.
- VC-020, VC-021 (throwing stubs for `Date` incl. `new Date`, `Math.random`, `performance.now`), VC-023, VC-024 (`[]` case; `[draw 0]` case waits for 10), VC-025 (same 7-batch stream twice, digest + committed text after every step), VC-027 (all cases except the real `control_set` one, which waits for 8; admission is shown not to reject it), VC-028, VC-029 — PASS.
- VC-030, VC-031 (incl. same-zone vectors `[A,B,C,D]`), VC-032, VC-033, VC-034, VC-039, VC-040 (full ended-session table, state unchanged) — PASS (`primitives.test.ts`, `apply.test.ts`).
- VC-072 (shuffle with the PRNG module mocked to throw; plus a source scan that nothing under `session/apply` imports the PRNG) — PASS (`shuffle-no-prng.test.ts`).
- Failing batches leave input reference + digest unchanged (spot test) — PASS.
- `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test` — exit 0 (376 tests, 31 files); `pnpm test:guardrails` (168) and `pnpm format:check` green.
- Artifacts: this file, `CONTEXT.md` (file map, interfaces, handler API), `DECISIONS.md` D-014..D-019 — PASS.

## Files
- Added: `session/{actions,action-validate,records}.ts`, `session/actions.testing.ts`, `session/{action-validate,records}.test.ts`, `session/apply/{index,apply,admission,validate-batch,expand,conservation,commit,working-state,context,def-index,types}.ts`, `session/apply/primitives/{index,move,flip,shuffle,set-metadata,lifecycle}.ts`, `session/apply/{apply,invariants}.testing.ts`, `session/apply/{apply,primitives,shuffle-no-prng}.test.ts`, this record.
- Changed: `session/index.ts` (exports), `session/create.ts` and `session/mask-gates.ts` (own-key writes, D-018), `CONTEXT.md`, `DECISIONS.md`.

## Deviations
- None from scope. Interpretation choices: D-014 (wire types, roster op tables, bigint amounts, committed actions are copies), D-017 (freeze-at-put), D-018 (`__proto__` guard, includes touching `create.ts`/`mask-gates.ts`), D-019 (check order, placeholders).
- VC-025 uses a bigint-aware JSON text for "canonical bytes": P1 has no action canonical schema.

## Gotchas
- `Mutable`/`variant` edits need branded keys (`d.zones[zoneId("deck")]`), not string literals.
- Branded-key records are not assignable to `Record<string, V>`; `WorkingState` keeps a loosely typed `slots` alias of its draft.
- Spread with computed keys and `Object.fromEntries` create own `__proto__` data properties; plain assignment does not.
- `fc.assert` fuzz needs "never valid" corruptions (Symbols, functions): `{}` is a valid JSON payload for several fields.
- Lint: no unused `_args` (the conservation hook has a scoped eslint-disable until iteration 7); `no-unnecessary-type-assertion` fires on casts the compiler already accepts.

## For the next iteration (7: counters)
- Implement `counter_adjust`/`counter_transfer` as `primitives/counters.ts` plus two `case`s in `primitives/index.ts` (replace the "not yet supported" branch); write via `ctx.work.patch("counters", id, value)`; bigint amounts/ratio are already in the wire types and `ratio.den > 0n` is already validated. Add `ratioRound`.
- Fill `checkConservation(def, base, final, committed)` in `apply/conservation.ts` (committed entries carry `inputIndex`, so KFR-003's "last input action that changed a group member" is the max `inputIndex` over entries touching a member). Its failure must carry `actionIndex`.
- Update the "not yet supported" expectations in `primitives.test.ts` / `apply.test.ts` (they use `counter_adjust` as the example) when a kind lands.
