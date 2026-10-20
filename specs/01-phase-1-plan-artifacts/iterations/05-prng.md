# Iteration 5 — Seeded PRNG and shuffles

Commit: `Phase 1.5: seeded PRNG, uniform sampling and shuffle permutation` (SHA is in `git log`).

## Criteria results (Node 22.18.0 + pnpm 10.15.1)
- VC-070 (`prng.test.ts`: seed-a words + 10 values, determinism, seed-b differs, empty/256-byte OK, 257-byte and lone surrogates -> `MALFORMED_ACTION`) — PASS (`pnpm test`).
- Golden vectors: 5 seed classes (short ASCII x2, empty, 256-byte, non-ASCII), 10 values + 4 seed words each; generator output == committed JSON == implementation; also matched by eye against a Python reference — PASS.
- VC-071 (permutation properties over 0/1/2/52 ids, 10 000-shuffle distribution 1667 +/- 150, scripted `[0xFFFFFFFF, 7, 9]` -> value 1, 2 draws, next yields 9, `uniform` throws for 0 and 2**32+1) — PASS.
- `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test` — exit 0 (299 tests, 26 files); `pnpm test:guardrails` and `pnpm format:check` green; purity test (VC-065) covers the new module.
- Artifacts: this file, `CONTEXT.md`, `DECISIONS.md` D-013 — PASS.

## Files
- Added: `session/prng.ts`, `prng.testing.ts`, `prng.test.ts`, `generate-prng-vectors.testing.ts`, `prng-vectors.json`, this record.
- Changed: `session/index.ts` (+PRNG exports), `CONTEXT.md`, `DECISIONS.md`.

## Deviations
- None. `shufflePermutation` is generic (`T`) rather than fixed to `CardId` (D-013). VC-072 stub test is iteration 6.

## Gotchas
- States/words are kept as int32 (`| 0`) inside `prng.ts`; `seedWords` converts to unsigned for display.
- `uniform(n = 2**32)` has `limit = 2**32`, so it never rejects and returns the raw draw.
- A 22-byte non-ASCII seed: count UTF-8 bytes, not characters, when writing seed fixtures (the generator checks `seedBytes`).

## For the next iteration
- Import from `session/prng.js` (or the index) only in proposal-side code; `apply` must not import it (add the VC-072 stub test in iteration 6).
- `scriptedStream` in `session/prng.testing.ts` is available for tests driving `uniform`/`shufflePermutation`.
