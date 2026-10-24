# Iteration 9: Replayer, `advance`, digest verification

Commit: see `git log` (message "Phase 3 iteration 9: hook-free Replayer with digest verification and advance").

## Criteria
All commands from the repo root, Node v26 (D-006).
- VC-350 (600 random sessions, 8 135 transactions, 1-40 each, live digest == replay digest at every seq, final state deep-equal; half via encode/decode): PASS. `pnpm exec vitest run packages/core/src/replay/replay-properties.test.ts --reporter=verbose` (about 2 s).
- VC-351, VC-352, VC-353, VC-354, VC-355 (sentinel hooks + static source scan), VC-356, VC-357, VC-358, VC-359, VC-360: PASS. `pnpm exec vitest run packages/core/src/replay` (all replay files, `replayer.test.ts` 39 tests).
- Earlier suites: `pnpm exec vitest run --exclude '**/visibility/properties.test.ts'`: 83 files, 1 358 tests PASS (golden vectors, golden package, P1/P2 definition and session suites untouched). Visibility properties not run (nothing in visibility changed).
- `pnpm lint`, `pnpm typecheck`, `pnpm depcheck` (507 modules), `pnpm format:check`, `pnpm build`, `pnpm exec vitest run --config vitest.guardrails.config.ts` (177 tests): PASS.
- Artifacts (CONTEXT.md, DECISIONS.md D-031..D-037, this record): PASS.

## Files
- Added (`packages/core/src/replay/`): `replayer.ts`, `replayer.test.ts`, `replay-properties.test.ts`, `live-session.testing.ts`; this record.
- Changed: `replay/index.ts` (exports; `src/index.ts` re-exports it), `CONTEXT.md`, `DECISIONS.md`.
- Deleted: none. No existing test changed.

## Deviations
- PFR-042 "a seat without a player is invalid" is not applied (D-031): it contradicts the golden fixture.
- `onStep` returns `Result<void, ReplayError>` (D-033). `createReplayer` throws `RangeError` on a bad `versions` (D-034).
- "Random definitions" in VC-350 = random sessions over the property definition (D-035). VC-355 sentinel hooks live outside the definition (D-036).
- `buildPackage`'s fold was not replaced (D-037).

## Gotchas
- The first `meta` action in the golden log (seq 7) is an `engine.*` one; the first definition-reducer meta is at seq 9.
- `fc.assert` is typed as possibly async when the property callback has bare `return;` statements, which trips `no-floating-promises`; throw instead.
- `sed -i` on macOS needs a suffix argument; use a script (python) for in-place edits.
- A tx whose actions all no-op would leave `apply` at the old seq: `replayStep` rejects it (`committed no change`).

## For the next iteration (10: schema evolution)
- Plug `upgradeToCurrent(raw)` before decode; `rebuild` takes a decoded `ReplayPackage`, so the upgrade runs where bytes become a package (expose a bytes -> `JsonValue` step, see `parseDocument`/`decodeDocument` in `canonical/decode.ts`).
- `PackageUpgrader` is currently declared in `replayer.ts` (`upgrade(raw: JsonValue)`); move it to `upgrade.ts` and re-export it from `replay/index.ts`. `createReplayer` already validates `current in supported`; the default `replayer` is `{1, [1]}` (replace with `CURRENT_ACTION_SCHEMA_VERSION` / `PACKAGE_UPGRADERS`).
- Reuse `buildLiveSession` (live states + digests + package) and `buildGoldenPackageSession`; `edit`/`rebind` helpers in `replayer.test.ts` are local.
- Forker (Iteration 11) can fold with `replayer.rebuild(..., {uptoSeq})`; the rebuilt state's `id` is the package's `sessionId`.
