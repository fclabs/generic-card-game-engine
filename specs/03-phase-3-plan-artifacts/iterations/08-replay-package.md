# Iteration 8: `decodeCanonical` and the replay package format

Commit: see `git log` (message "Phase 3 iteration 8: canonical decoder and replay package format").

## Criteria
All commands from the repo root, Node v26 (D-006).
- VC-345 golden package: PASS. `UPDATE_GOLDEN=1 pnpm exec vitest run packages/core/src/replay/package.test.ts` wrote the file; later runs compare `encodePackage` bytes with `golden-package.json` byte for byte (10 421 bytes, sha256 `8533a0a81ebd1ab084ba70601cd0b365dcdebfe2bdad35bd5355e2182e1ebc51`). The Docker half of VC-345 runs in Iteration 12.
- Second process: PASS. `GOLDEN_PACKAGE_OUT=<scratchpad>/golden-package.second.json pnpm exec vitest run packages/core/src/replay/package.test.ts` then `cmp packages/core/src/replay/golden-package.json <that file>` printed IDENTICAL.
- VC-346 (round trips, reformatted/shuffled input), VC-347 (all rejections incl. 65 MiB, 150 -> 100 errors), VC-348 (receipt UTF-16 order, digests none/final/every), VC-349 (decodeCanonical over every P1 golden vector plus bigint 0/negative/10^40): PASS (`pnpm exec vitest run packages/core/src/replay`: 7 files, 204 tests).
- P1/P2 unchanged: `pnpm exec vitest run packages/core/src/replay packages/core/src/definition`: 21 files, 499 tests PASS (golden vectors, identity expectations, state digests untouched); `golden-stream.test.ts` and `privileged-batch.test.ts` PASS.
- `pnpm lint`, `pnpm typecheck`, `pnpm depcheck` (501 modules), `pnpm format:check`, `pnpm test:guardrails` (177 tests): PASS. Visibility properties not run (per instruction; nothing in visibility changed).
- Artifacts (CONTEXT.md, DECISIONS.md D-026..D-030, this record): PASS.

## Files
- Added (`packages/core/src/replay/`): `canonical/decode.ts`, `canonical/decode.test.ts`, `package-schema.ts`, `package.ts`, `package.test.ts`, `replay-error.ts`, `resolved-definition.ts`, `generate-golden-package.testing.ts`, `golden-package.json`, `index.test.ts`; this record.
- Changed: `replay/index.ts` (exports), `.prettierignore` (golden file), `CONTEXT.md`, `DECISIONS.md`.
- Deleted: none. No existing test changed; `canonical/index.ts` untouched.

## Deviations
- `buildPackage(stored, receipts, opts)` has a required `opts.resolved` (D-027): the spec signature cannot supply `gameId` or the definition for digests.
- `decodeCanonical` is exported from `replay/index.ts`, not `replay/canonical/index.ts` (D-028, VC-068 pins that index).
- `ReplayError`/`ResolvedDefinition` were created now (needed by `buildPackage`); Iteration 9 reuses them.
- `.prettierignore` gained the golden file (D-030).

## Gotchas
- Do not run `prettier --write packages/core/src/replay` before the ignore entry exists: it pretty-prints the golden bytes.
- `*.testing.ts` files are excluded from `dist`, so a second-process check must go through vitest (env `GOLDEN_PACKAGE_OUT`).
- `String.fromCharCode(...units)` batches of 8 192 code units keep the UTF-8 decoder stack safe; a 100 000-deep array input is rejected by the tokenizer depth limit (256), not by a stack overflow.
- The `idMap` pair list is order-tolerant on decode but `encodePackage` never reorders `receipts`: an unsorted receipts list round-trips as given (only `buildPackage` sorts).

## For the next iteration (9: Replayer)
- Reuse `buildGoldenPackageSession()` (definition, resolved, stored, states[0..12], package with digests 1..12) and `golden-package.json` (decode it to get a "foreign" package). Seq 12 is `completed`; fork/uptoSeq tests below 12 stay active.
- Import `ReplayError`/`replayError` and `ResolvedDefinition` from this iteration; the Replayer decodes nothing itself (`decodePackage` already gives `ReplayPackage`, unfrozen; freeze `initial` with `deepFreeze` before `apply`).
- `pkg.initial` is not validated against the definition: PFR-042 must `createSession(definition, pkg.sessionId, roster)` from `initial.roster` and compare `stateDigest`; `stateDigest` throws `CanonicalError` when `initial` does not fit the definition's schemas, so catch it and return `REPLAY_INVALID` at seq 0. `initial.id` may differ from `pkg.sessionId` (digest excludes the id).
- Actions in a decoded package may be macros or carry stray fields (D-029): validate with the P1 action validator and reject macros (`PRIMITIVE_KINDS`).
- `buildPackage` has its own fold; `rebuild` may replace it behind the same behaviour. Iteration 10 plugs the upgrader step where the raw JSON is parsed: `parseDocument`/`decodeDocument` in `canonical/decode.ts` are the two phases (an upgrader needs the raw tree, so expose a function that decodes bytes to `JsonValue` via `jsonNode` first).
