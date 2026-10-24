# Iteration 1: role registry, viewer validation, policy

Commit: see `git log` (message "Phase 3 iteration 1: role registry, viewer validation and visibility policy").

## Criteria
All commands run from the repo root.
- VC-300, VC-301, VC-302, VC-303 (+ PBR-008): PASS. `pnpm build && pnpm exec vitest run packages/core/src/visibility packages/core/src/definition` (`visibility/roles.test.ts`).
- VC-304: PASS. Same command (`definition/compile/meta-roles.test.ts`, each built-in id gives `RESERVED_NAME` at `roles[0].id`; `spectator` compiles).
- VC-305 registry half: PASS. Same command (`roles.test.ts`: spectator no subject ok, with subject `SUBJECT_NOT_ALLOWED`, `render` optional; registry frozen).
- VC-306, VC-307, VC-308: PASS. Same command (`visibility/policy.test.ts`).
- Vitest result: 15 files, 328 tests passed.
- `pnpm lint`: PASS (exit 0). `pnpm typecheck`: PASS (exit 0). `pnpm depcheck`: PASS (no violations). `pnpm format:check`: PASS.
- Also run: `pnpm exec vitest run packages/core/src/index.test.ts packages/core/src/purity.test.ts packages/core/src/dist-output.test.ts`: PASS (18 tests).
- Artifacts written: CONTEXT.md, DECISIONS.md (D-001..D-006), this record: PASS.

## Files
- Added: `packages/core/src/visibility/{types,roles,policy,visibility.testing}.ts`, `visibility/{roles,policy}.test.ts`, `specs/03-phase-3-plan-artifacts/{CONTEXT.md,DECISIONS.md,iterations/01-roles-policy.md}`.
- Changed: `visibility/index.ts`, `definition/compile/{roles.ts,errors.ts,meta-roles.test.ts}`.
- Deleted: none.

## Deviations
- None from scope. `src/index.ts` needed no edit: it already does `export * from "./visibility/index.js"`.
- `VisibilityPolicy` shape and the field-visibility accessors are an interpretation (D-003).

## Gotchas
- P2 had `DUPLICATE_ID` for built-in role ids; two P2 assertions in `meta-roles.test.ts` changed to `RESERVED_NAME` (permitted by the plan). Docs stay stale until Iteration 13 (D-005).
- Local Node is v26 (D-006); pnpm prints an engine warning, everything passes.
- `ViewerIdentity.role` is a plain `string`; `subject` is a branded `SeatId`.
- `Object.freeze(obj-literal-with-methods)` loses contextual parameter types: annotate the object first.

## For the next iteration
- Use `buildRoleRegistry` once per definition, `validateViewer(registry, state, viewer)` first in `projectView`, then `buildVisibilityPolicy(def)` + `isEntitled(audience, zoneState.owner, viewer, state)`; get the template name from `state.zones[z].template`.
- `visibility.testing.ts` has a four-seat roster/definition for role tests only; build the trick-taking fixture (hand/trick/discard/stock + derived `stock_size`) as a new `*.testing.ts` in Iteration 2.
- Derived counters: `CounterDecl.visibility` `{}` means "inherit zone_count of the input zone" (PBR-011); `counterAudience` returns `undefined` for it, so Iteration 2 must distinguish declared-empty.
