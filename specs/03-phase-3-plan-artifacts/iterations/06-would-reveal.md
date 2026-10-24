# Iteration 6: `wouldReveal`

Commit: see `git log` (message "Phase 3 iteration 6: wouldReveal grant-consumption predicate").

## Criteria
All commands from the repo root.
- VC-332 (every bullet: hand card out -> `[g]`; discard-only batch -> `[]`; `revoke_view(g)` plus hand move -> `[g]`; batch-created once grant -> `[]`; non-once (until_revoked, until_seq) never; two grants ascending and `grantee` restriction; plus team/all_seated, redundant grants, already-entitled grantee, mismatched batch, purity): PASS. `pnpm build && pnpm exec vitest run packages/core/src/visibility/would-reveal.test.ts` (11 tests).
- VC-333 (real `engine.grant_consume` through `apply`: east's delta keeps the revealed face and `grants: {g: null}`; later `projectView` has no grants, no hand-north; next batch reveals nothing): PASS, same file.
- `pnpm exec vitest run packages/core/src/visibility`: PASS (7 files, 124 tests).
- `pnpm exec vitest run --config vitest.guardrails.config.ts`: PASS (177 tests).
- `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm depcheck` (477 modules), `pnpm format:check`: PASS.
- Artifacts (CONTEXT.md, DECISIONS.md D-021, D-022, this record): PASS.

## Files
- Added: `visibility/would-reveal.ts`, `visibility/would-reveal.test.ts`, this record.
- Changed: `visibility/index.ts` (export `wouldReveal`), `CONTEXT.md`, `DECISIONS.md`.
- Deleted: none. No guardrail or dependency-rule change.

## Deviations
- None. The `step` test helper is local to the new test (not lifted), so `project-delta.test.ts` is untouched.

## Gotchas
- `until_seq` scope field is `n` (not `seq`); `once` scope is `{kind: "once"}`.
- A zone-level grant does not cover a card once it has left the zone: use a card-level `card_face` grant to observe a face in a delta after a move.
- A `card_face` zone grant reveals faces of face-down cards in a public zone, so flipping such a card counts as a reveal.
- Test fixtures need `viewKeys` = the four zone keys for grants.

## For the next iteration (7: properties)
- `wouldReveal(def, pre, post, batch, grantee?)` complexity is `O(seats + onceGrants * seatsPerGrant)` delta evaluations; PNFR-004's 5-grant bound is checked in Iteration 12.
- A property for `wouldReveal` could check: a flagged grant's consumption never changes any other seat's delta (consumption only drops it from `post`; deltas use the union).
- Only `would-reveal.test.ts` creates `once` grants in fixtures (plus one case in `project-delta.test.ts`).
