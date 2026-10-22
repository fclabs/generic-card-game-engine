# Iteration 2: `projectView` for zones, cards, counters and engine sections

Commit: see `git log` (message "Phase 3 iteration 2: projectView for zones, cards, counters and engine sections").

## Criteria
All commands from the repo root.
- VC-310, VC-311, VC-312 (grant-free parts), VC-313, VC-314, VC-315, VC-316, VC-321, VC-322: PASS. `pnpm exec vitest run packages/core/src/visibility` (`visibility/project-view.test.ts`, 22 tests).
- VC-377 first sentence (real card ids, no aliasing): PASS, same file.
- Vitest: 3 files, 57 tests passed in `visibility`.
- `pnpm lint`: PASS. `pnpm typecheck`: PASS. `pnpm depcheck`: PASS (458 modules). `pnpm format:check`: PASS.
- Also `pnpm exec vitest run packages/core/src/index.test.ts packages/core/src/purity.test.ts packages/core/src/dist-output.test.ts` with visibility: 6 files, 75 tests PASS.
- Artifacts (CONTEXT.md, DECISIONS.md D-007..D-009, this record): PASS.

## Deferred (need grants, Iteration 3)
- VC-312: a `zone_membership` grant on a hidden ordered zone lists members sorted by id with `orderKnown: false`; a `zone_count` grant alone gives `count` only, no `members`.
- VC-317..320 (meta, gates, grants) are Iteration 3.

## Files
- Added: `visibility/{make-view,entitlement,project-view,fixtures.testing}.ts`, `visibility/project-view.test.ts`, `specs/03-phase-3-plan-artifacts/iterations/02-project-view.md`.
- Changed: `visibility/types.ts` (View types), `visibility/index.ts` (exports), `CONTEXT.md`, `DECISIONS.md`.
- Deleted: none.

## Deviations
- None from scope. Interpretations in D-007 (`orderKnown: true` when static), D-008 (derived "declared"), D-009 (placeholders).

## Gotchas
- A `public` zone shows faces only for face-up cards, even to a registered auditor: tests that need a visible face in an auditor-public hand must flip the card first.
- Cards start face down; `trickTakingState` flips `t1` and `d1`. `move` with `to_position` is rejected for unordered zones.
- `exactOptionalPropertyTypes` is on: build optional members with conditional spreads.
- The fixture's ids and names are relied upon later (see CONTEXT.md).

## For the next iteration
- Wrap `isEntitledToZoneKey(ctx, zone, key, orientation?)` with grants; do not re-derive the static rule. Extend `EntitlementContext` (e.g. with expanded grants) rather than adding parallel helpers.
- Grants/meta/gates fill the `{}` placeholders in `projectView` (`project-view.ts`, the `makeView` call). Keep `makeView` the sole `View` creator.
- For `orderKnown: false`/`count`-only grant cases, change the zone block in `projectZones` (today every entitled zone gets count, members, `orderKnown: true`).
- Use `withAuditor()`-style overrides to register an auditor in fixture tests; `compareIds`/`cloneJson` are exported from `project-view.ts` for reuse.
