# Iteration 11: Forker

Commit: see `git log` (message "Phase 3 iteration 11: Forker (fork from seq)").

## Criteria
All commands from the repo root, Node v26 (D-006).
- VC-365 (fork at n of the 12-transaction golden package and a live random session: truncated log/digests, `receipts` empty, `forkedFrom`, rebuild reproduces digests `<= n`, state digest equals the original's at n despite the new id): PASS. `pnpm exec vitest run packages/core/src/replay/forker.test.ts` (17 tests).
- VC-366 (deep-frozen and unfrozen source unchanged before/after; `continueFork` at `n + 1` leaves the original package bytes and digests unchanged; the extended fork re-exports (`encodePackage`) and rebuilds with `verify: 'every'`): PASS (same file). Note: the golden package has 12 transactions, not 20 (VC-365 wording); a live session covers a longer log.
- VC-367 (n = 0, n = lastSeq, `lastSeq + 1`, -1, 1.5, NaN, Infinity; same id; bad charset; 129 chars; 128 chars OK): PASS (same file).
- VC-368 (fork before the completing seq is `active`, at it `completed`): PASS (same file).
- All replay and definition tests: PASS. `pnpm exec vitest run packages/core/src/definition packages/core/src/replay` (25 files, 591 tests). Visibility properties not run.
- `pnpm build`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm depcheck` (517 modules), `pnpm exec vitest run --config vitest.guardrails.config.ts` (177 tests): PASS.
- Artifacts (CONTEXT.md, DECISIONS.md D-043, D-044, this record): PASS.

## Files
- Added (`packages/core/src/replay/`): `forker.ts`, `forker.test.ts`, `forker.testing.ts`; this record.
- Changed: `replay/index.ts` (exports `forkFromSeq`, `ForkResult`; root re-exports via `src/index.ts`), `replayer.test.ts` (VC-355 static test also asserts `forker.ts` is scanned), `CONTEXT.md`, `DECISIONS.md`.
- Deleted: none.

## Deviations
- None from the plan. The forker accepts a decoded package only (D-043).

## Gotchas
- Session ids match `^[A-Za-z0-9_.:/-]{1,128}$` (so `a/b` is valid).
- The golden definition's counters conserve a `chips` group: `A.adjust("pot", 1n)` fails `COUNTER_BOUNDS`; transfer instead.
- `golden.package.initial` is already frozen (it is a `createSession` state), so "source is unfrozen" assertions apply to `log` and similar.

## For the next iteration (12: end-to-end, edge path, performance, coverage, regression)
- `forkFromSeq(resolved, pkg, n, {sessionId}, replayer?) -> Result<{package, state}, ReplayError>`; result is deep-frozen. `continueFork(resolved, fork, actions, eventId?, principal?)` in `replay/forker.testing.ts` extends a fork by one transaction and re-digests.
- Fork verification costs one `rebuild` up to `n` (digests verified at recorded seqs and the final one); include it in the performance test if forking large logs.
