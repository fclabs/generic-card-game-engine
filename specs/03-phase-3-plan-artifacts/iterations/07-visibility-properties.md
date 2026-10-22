# Iteration 7: No-leak, completeness and consistency properties

Commit: see `git log` (message "Phase 3 iteration 7: no-leak, completeness and consistency property tests").

## Criteria
All commands from the repo root, Node v26 (D-006).
- VC-340 (no canary), VC-341 (completeness vs oracle), VC-342 (delta consistency, grant-free whole stream and per-step with grants), VC-343 (indistinguishability), VC-344 (mutation guard), VC-376 (error details): PASS. `CGE_VISIBILITY_RUNS=2000 pnpm exec vitest run packages/core/src/visibility/properties.test.ts --reporter=verbose`: 35 tests passed in 93 s.
- Counts (from that run; 4 seeds 20261022..20261025 x 500): VC-340/341/342/343 = 2 000 cases per class for player, render, dealer, auditor, custom (VC-342 twice per class); VC-344 and VC-376 = 500 cases per class (default guard budget). Examples: VC-340 player 32 388 views + 26 388 deltas (and as many log entries), render 43 184 / 35 184, dealer 10 701 / 8 701, auditor 10 754 / 8 754, custom 64 776 / 52 776; 0 leaks; 1.3M to 2.8M withheld canary tokens per class (not vacuous). VC-341 predicted 357k zone, 67k counter, 11k gate, 2k meta, 6k grant facts for player (10 945 only through grants). VC-343 applied 1.0M to 6.3M perturbations per class.
- Properties can fail: (1) with `secret` card fields shown to `player` (`isPrivilegedRole(viewer.role) || viewer.role === "player"` in `projectFace`), VC-340 failed (`leak in View player@s1 state 1: zqv1x`, seed 20261022, after 424 cases) and VC-341, VC-342, VC-343 failed too; (2) with `subject` card fields shown to subject-less viewers VC-340 failed for render, dealer, auditor and custom. Both reverted (not committed; `git diff` of `project-view.ts` holds only the D-024 fix).
- `pnpm exec vitest run packages/core/src/visibility packages/core/src/session/properties.test.ts`: PASS (9 files, 165 tests, 96 s at the default 2 000 runs).
- `pnpm build`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm depcheck` (482 modules): PASS.
- Artifacts (CONTEXT.md, DECISIONS.md D-023..D-025, this record): PASS.

## Files
- Added: `visibility/generators.testing.ts`, `oracle.testing.ts`, `delta-fold.testing.ts`, `property-checks.testing.ts`, `properties.test.ts`, this record.
- Changed: `visibility/project-view.ts` (bug fix D-024), `visibility/project-view-grants.test.ts` (regression test), `session/generators.testing.ts` (optional `rewrite` hook in `GenerateOptions`, default off), `CONTEXT.md`, `DECISIONS.md`.
- Deleted: none.

## Projector bugs found
- D-024: a zone-level `card_face` grant alone listed every member of the zone (ids, orientation, faces, `orderKnown: false`) in `projectView`. Fixed; regression test added. No other bug: the delta, `wouldReveal`, role and policy code survived 2 000 cases per class.

## Deviations
- Oracle is "independent" in code (imports only types) but its few gaps in the spec follow the recorded decisions D-007..D-014 (D-023). VC-342 with grants checks static facts only (D-019 gap); the whole-stream equality runs on grant-free sessions.
- VC-340 allows what a `move` names over the batch's intermediate states, not only pre/post (D-023c).

## Gotchas
- `Tape.pick` throws on `undefined` elements; index with `t.int(n)`.
- Grant ids embed the action index: replaying single actions fails, replay batch prefixes (`chainOf`).
- A failed or empty batch has no transaction (`seq: null`): skip it, `projectDelta` would answer REPLAY_INVALID.
- vitest's 5 s test timeout: the properties pass an explicit timeout; stdout of passing runs only shows with `--reporter=verbose`.
- ESLint (`--fix`) strips `!` assertions its config thinks redundant while `tsc -p tsconfig.test.json` (noUncheckedIndexedAccess) needs them: index records through a helper that throws (`zoneState` in the oracle).

## For the next iteration (8: `decodeCanonical` and the package format)
- Nothing in the replay path depends on this iteration's code. Iteration 9/12 reuse `property-checks.testing.ts`: build a `PropertyInput {def, states, steps, grants}` from `Replayer.advance`-folded batches (`CaseStep = {pre, post, batch, tx}`) and call `checkNoLeak`/`checkIndistinguishable`/`checkConsistency` per role class (`viewersOf(cls, state)`).
- Generators: `buildCase(tape, caseOptions(cls, grants))`, `caseTape`, `ROLE_CLASSES`; oracle: `oracleFacts`, `viewFacts`; knobs `CGE_VISIBILITY_RUNS`, `CGE_VISIBILITY_SEED`, `SEEDS` in `properties.test.ts`.
- VC-376 for replay errors (REPLAY_INVALID/REPLAY_MISMATCH from the Replayer) is still to be written with the Replayer; `checkErrorDetails` covers the projector errors and the batch-mismatch REPLAY_INVALID.
