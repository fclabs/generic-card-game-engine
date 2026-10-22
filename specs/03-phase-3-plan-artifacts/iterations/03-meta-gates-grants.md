# Iteration 3: `projectView` meta, gates and additive grants

Commit: see `git log` (message "Phase 3 iteration 3: meta, gates and additive grants in projectView").

## Criteria
All commands from the repo root.
- VC-317, VC-318, VC-319, VC-320: PASS. `pnpm exec vitest run packages/core/src/visibility` (`visibility/project-view-grants.test.ts`).
- VC-312 deferred bullets (`zone_membership` grant gives sorted members with `orderKnown: false`; `zone_count` grant alone gives `count` only): PASS, same file.
- VC-305 projection half (spectator view, subject rejected): PASS, same file.
- VC-321 and VC-322 rerun (`project-view.test.ts`, plus a grants/meta/gates JSON/determinism check): PASS.
- Vitest: 4 files, 84 tests passed in `visibility`; with `index.test.ts`, `purity.test.ts`, `dist-output.test.ts`: 7 files, 102 tests PASS.
- `pnpm lint`: PASS. `pnpm typecheck`: PASS. `pnpm depcheck`: PASS (459 modules). `pnpm format:check`: PASS.
- Artifacts (CONTEXT.md, DECISIONS.md D-010..D-014, this record): PASS.

## Files
- Added: `visibility/project-view-grants.test.ts`, this record.
- Changed: `visibility/entitlement.ts` (composition), `visibility/project-view.ts` (zones, meta, gates, grants), `visibility/index.ts` (exports), `CONTEXT.md`, `DECISIONS.md`.
- Deleted: none.

## Deviations
- None from scope. Interpretations in D-010..D-014 (subject-field omission, `all_seated`-only status filter, where grant content appears, grant listing ignores expiry, helper takes `policy` first).

## Gotchas
- Default `buildDefinition` `viewKeys` is `["hand","public"]`; grant tests need the four zone keys.
- A `public` zone (or auditor-`public` hand) shows faces only for face-up cards, so VC-320's auditor case flips the card first; a face-down card is not statically face-entitled (D-013).
- Cards placed in the same batch as `trickTakingState` flips get grant ids `grant/1/<2+i>`; read ids from `state.grants` instead of hard-coding.
- Roster `set_status` in tests needs `defaultRosterReducer` as `rosterReducer`.
- `m.id as string` on a branded id is flagged by lint; use `String(m.id)`.

## For the next iteration (4: fail-closed types)
- `makeView` is still the only `View` creator; brand there. `View` shape did not change; `GateView`/`GrantView` fields are final.
- Delta/wouldReveal (5, 6): build contexts with `buildEntitlementContext(policy, state, viewer, {grants, exclude})`; union grants for deltas by merging `pre.grants` and `post.grants` records; reuse `isEntitledToCardKey`, `isEntitledToZoneKey`, `isStaticallyEntitledToGrant`, `isGrantee`. `projectMeta`/`projectGates`/`projectGrants` in `project-view.ts` are module-private: export or extract them when Iteration 5 needs the per-section projections.
