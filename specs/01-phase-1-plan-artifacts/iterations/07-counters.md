# Iteration 7 — Counters, ratio rounding and conservation

Commit: `Phase 1.7: exact counter arithmetic, ratio rounding and conservation` (SHA is in `git log`).

## Criteria results (Node 22.18.0 + pnpm 10.15.1)
- VC-035 (min, max, min-1, max+1, 2^65/2^90 exact, derived/unknown counter -> `MALFORMED_ACTION`) — PASS (`apply/counters.test.ts`).
- VC-036 (0, full balance, over balance, negative, into counter at max; sum unchanged) — PASS.
- VC-055 (full table x 3 modes + `scale` variant, transfer 7 @ 1/3 floor and 7 @ 1/2 half_up, missing `remainder_to`, aliasing, `den = 0`, ratio without mode, mode from source) — PASS; `ratioRound` also unit-tested incl. 2^200 (`session/ratio.test.ts`).
- VC-056 (transfers, non-supply adjust, `mint`, transient imbalance) — PASS. The reducer step is NOT here: two adjusts are used; the `meta` no-op variant is added in iteration 9.
- VC-057 (fast-check, 1 000 runs, random legal/illegal batches; sum == initial + logged supply adjusts at every step; failing batch leaves digest unchanged) — PASS.
- VC-004 conservation case (adjusts at indices 0 and 2 -> `actionIndex 2`; trailing non-member adjust does not move it) — PASS.
- VC-058 apply half (derived `hand_size` recomputed after `move`, absent from `counters`, serialised after `counters`) — PASS.
- `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test` — exit 0 (418 tests, 33 files); `pnpm test:guardrails` (168) and `pnpm format:check` green.
- Artifacts: this file, `CONTEXT.md`, `DECISIONS.md` D-020, D-021 — PASS.

## Files
- Added: `session/ratio.ts`, `session/ratio.test.ts`, `session/apply/primitives/counters.ts`, `session/apply/counters.test.ts`, this record.
- Changed: `session/apply/conservation.ts` (real check), `session/apply/primitives/index.ts` (two cases), `session/apply/def-index.ts` (`counter(id)`), `session/index.ts` (exports `ratioRound`), `session/actions.testing.ts` (`A.adjust`, `A.transfer`), `session/apply/primitives.test.ts` (unsupported-kind example now `control_set`), `CONTEXT.md`, `DECISIONS.md`.

## Deviations
- None from scope. `DefIndex.counter` added (needed by handlers). `apply.test.ts` "not yet supported" test already used `control_set`, so unchanged.

## Gotchas
- `remainder = amount - credited` is an integer difference, not a fractional part: 9 @ 1/3 gives remainder 6; use ratio 1/1 for a zero remainder.
- Counter `min` is required in `CounterDecl`; test counters use +-10^40 to be effectively unbounded.
- Conservation recomputes `applied` from the committed action and the definition's rounding mode (the log keeps the original action).

## For the next iteration (8: control, zones, grants, delegations)
- Add `case`s + files in `primitives/` for `control_set/advance`, `zone_*`, `grant_view/revoke_view` and roster `delegate/revoke_delegation`; replace the remaining "not yet supported" branch. `ctx.position` and `ctx.seq` already exist for grant ids.
- The unsupported-kind test in `primitives.test.ts` now uses `control_set`; swap its example (e.g. to `meta`) when 8 lands; `apply.test.ts` VC-027 `control_set` test needs real expectations.
- Reducers (9) must re-check counter bounds after their output (KBR-010); conservation still runs once at batch end in `apply.ts`.
