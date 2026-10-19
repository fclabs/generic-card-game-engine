# Iteration 10 — Macros and sequential expansion

Commit: `Phase 1.10: macros with sequential expansion over working state` (SHA is in `git log`).

## Criteria results (Node 22.18.0 + pnpm 10.15.1)
- VC-024 `[draw count 0]` and VC-026 (no macro kinds committed) — PASS (`pnpm exec vitest run packages/core/src/session/apply/macros.test.ts`).
- VC-046, VC-047, VC-048, VC-049, VC-050 — PASS (same file).
- VC-004 (`[draw 2, bad move]` -> index 1; `EMPTY_ZONE` at index 2) — PASS.
- VC-043 literal `[draw 2, grant, grant]` (ids `grant/<n+1>/2`, `/3`, replay identical) — PASS.
- Plan-level edge cases (draw unordered, merge src = dst, reset with `to_zone` in `zones`) — PASS.
- `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test` — exit 0 (537 tests, 36 files); `pnpm test:guardrails` (168) and `pnpm format:check` green.
- Artifacts: this file, `CONTEXT.md`, `DECISIONS.md` D-028..D-030 — PASS.

## Files
- Added: `session/apply/macros.ts`, `session/apply/macros.test.ts`, this record.
- Changed: `session/apply/expand.ts` (macro dispatch), `session/actions.testing.ts` (`A.zoneMerge`, `A.reset`), `session/apply/primitives.test.ts` (unsupported-kind test removed: no unsupported kind remains), `CONTEXT.md`, `DECISIONS.md`. `apply.ts` unchanged (its loop already expanded and applied per input action).

## Deviations
- None from scope. Fixture note: the default deck has 6 cards, so the VC-046 "5-card zone, 2 in to_zone" case uses a 4-card deck after moving two cards to `discard` (same semantics). Interpretations: D-028..D-030.

## Gotchas
- `SESSION_ENDED` from admission carries `actionIndex 0` (existing behavior), not undefined.
- The default `pile` template is ordered (max 4), `hand` allows 1 instance; unordered merge targets need a custom `zoneTemplates` override.
- Python/Edit over `sed -i` on macOS (needs `''`).

## For the next iteration (11: SPI/ports types)
- `spi` must re-export `Reducer<S>` from `session/reducer.ts` (D-025) and `Action`/`Macro` from `session`.
- Expansion-stage API (`expand(ctx, action): Result<readonly Action[]>`) and macro validator shapes are unchanged.
- Iteration 12 generators should include macros; macro failures are `MALFORMED_ACTION`/`EMPTY_ZONE`/`CARD_NOT_IN_ZONE` at the macro's input index.
