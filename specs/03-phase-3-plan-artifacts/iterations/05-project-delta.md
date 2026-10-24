# Iteration 5: `projectDelta` and `projectLogEntry`

Commit: see `git log` (message "Phase 3 iteration 5: projectDelta and projectLogEntry with per-key redaction").

## Criteria
All commands from the repo root.
- VC-325 (stock to owner hand), VC-326 (hand to public discard, positions), VC-327 (flip, set_metadata, zone_create/destroy), VC-328 (shuffle: hidden, auditor, public, membership-only grant), VC-329 (counter transfer, control-only batch), VC-330 (grant-only and gate-submit batches), VC-331 (30 random batches, `projectLogEntry` equals `projectDelta`, no event id/principal), VC-334 (invalid viewers, mismatched batch): PASS. `pnpm build && pnpm exec vitest run packages/core/src/visibility/project-delta.test.ts` (23 tests).
- Earlier visibility and definition tests: PASS. `pnpm exec vitest run packages/core/src/visibility packages/core/src/definition` (19 files, 406 tests).
- `pnpm exec vitest run --config vitest.guardrails.config.ts`: PASS (3 files, 177 tests).
- `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm depcheck` (473 modules), `pnpm format:check`: PASS.
- Artifacts (CONTEXT.md, DECISIONS.md D-017..D-020, this record): PASS.

## Files
- Added: `visibility/make-delta.ts`, `visibility/project-delta.ts`, `visibility/project-delta.test.ts`, this record.
- Changed: `visibility/project-view.ts` (extracted/exported shared projections, no behaviour change), `visibility/index.ts` (exports `projectDelta`, `projectLogEntry`, `DELTA_SECTION_ORDER`), `.dependency-cruiser.cjs` (opener rule also exempts `dist`, D-020), `CONTEXT.md`, `DECISIONS.md`.
- Deleted: none.

## Deviations
- `.dependency-cruiser.cjs` touched (D-020): required for `pnpm depcheck` once a visibility module imports `open-batch` (dist is cruised).
- VC-330 "empty delta" for a gate submit: non-entitled viewers still get the public `submitted` list under `gates` (no payload), see D-019.

## Gotchas
- Subject-visibility fields (`own`) appear in faces for any viewer with a subject; test expectations include them.
- Template zone ids are `<template>/<owner or _>/<n>` (e.g. `pile/_/1`).
- Fixture phases are `setup|play|end`; `control_set` rejects unknown phases.
- Use `sed -i ''` (BSD) or python for edits; lint flags `as Seq`/`as Action` casts that change nothing.

## For the next iteration (6: wouldReveal)
- Use `buildDeltaContexts(def, pre, post, viewer, {exclude: grantId})` and `deltaFor(compileLookups(def), ctxs, seq, tx.actions)` (both in `project-delta.ts`, not in the index) to compare the delta of each seat (role `player`) with and without a grant; compare with `JSON.stringify` (deterministic key order). `mergeGrants` gives the union. Open the batch with `openBatch` from `./open-batch.js`.
- The `exclude` option drops the grant from the union, so a grant consumed by the batch is evaluated like any other. A grant created by the batch must be skipped by iterating `pre.grants` only with scope kind `once`.
- Test helper `step`/`withPrivileged` live inside `project-delta.test.ts`; copy or lift them into a `*.testing.ts` if needed.
