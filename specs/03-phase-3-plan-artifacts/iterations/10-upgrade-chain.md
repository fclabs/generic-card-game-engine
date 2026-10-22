# Iteration 10: Schema-evolution policy and upgrader chain

Commit: see `git log` (message "Phase 3 iteration 10: schema-evolution policy and package upgrader chain").

## Criteria
All commands from the repo root, Node v26 (D-006).
- VC-361 (injected `{current 2, supported [1,2]}`, test upgrader 1->2, committed legacy v1 package replays via bytes and raw JSON to the golden digests, input unchanged): PASS. `pnpm exec vitest run packages/core/src/replay/upgrade.test.ts`.
- VC-362 (three-step chain order; gap, duplicate, `to != from+1`, missing upgrader, others -> first violation naming the version): PASS (same file).
- VC-363 (versions 0, 99, -1, 2 with supported [1] -> `REPLAY_MISMATCH unsupported action_schema_version n`; upgrader error string -> `REPLAY_INVALID` seq 0 with that string; throw / non-object also): PASS (same file).
- VC-364 (golden per supported version, `assertUpgraderChain(real constants)` is `null`, v1 replays unchanged through the default replayer as decoded/bytes/raw): PASS (same file, 29 tests).
- Iteration 8/9 tests: PASS. `pnpm exec vitest run packages/core/src/definition packages/core/src/replay` (24 files, 574 tests); `pnpm exec vitest run --exclude '**/visibility/properties.test.ts'` (84 files, 1 393 tests). Visibility properties not run (nothing in visibility changed).
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm depcheck` (512 modules), `pnpm build`, `pnpm exec vitest run --config vitest.guardrails.config.ts` (177 tests): PASS.
- Artifacts (CONTEXT.md with the version-bump checklist, DECISIONS.md D-038..D-042, this record): PASS.

## Files
- Added (`packages/core/src/replay/`): `upgrade.ts`, `upgrade.test.ts`, `fixtures/test-upgrader.testing.ts`, `fixtures/legacy-v1-package.json`; this record.
- Changed: `replayer.ts` (`PackageUpgrader` moved to `upgrade.ts`; `RawPackage`; raw path in `rebuild`; default replayer uses the real constants), `replay/index.ts` (new exports; root re-exports through `src/index.ts`), `canonical/decode.ts` (`documentToJson`), `.prettierignore` (legacy fixture), `CONTEXT.md`, `DECISIONS.md`.
- Deleted: none. No existing test changed.

## Deviations
- `createReplayer` does not validate the chain (D-040): the Iteration 9 test uses `{2, [1,2]}` with no upgraders.
- The version binding uses the recorded (pre-upgrade) version (D-039); the decoded-path unsupported-version detail keeps the field name `actionSchemaVersion` (an Iteration 9 test asserts it).
- `buildPackage` verification does not run upgraders (it only builds current-version packages from stored sessions).

## Gotchas
- A decoded `ReplayPackage` cannot be upgraded; callers with older packages must pass bytes or `{raw}`.
- The legacy fixture is one line and must stay out of Prettier (`.prettierignore`).
- `no-unsafe-assignment` trips on spreading `Array.isArray(x) ? x : []` of a `JsonValue`; cast to `readonly JsonValue[]`.

## For the next iteration (11: Forker)
- `forkFromSeq` can call `replayer.rebuild(resolved, pkg, {uptoSeq: n})` (decoded or raw input both work); the rebuilt state's `id` is the package's `sessionId`.
- The fork's `actionSchemaVersion` must be current (upgrade raw input first with `upgradeToCurrent` if the forker accepts raw packages).
- Reuse `buildGoldenPackageSession` (12 transactions, lifecycle completes at seq 12) and `buildLiveSession`.
