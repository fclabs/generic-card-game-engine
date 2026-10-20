# Iteration 8 — Control, zone templates, grants and delegations

Commit: `Phase 1.8: control state, template zones, grants and delegations` (SHA is in `git log`).

## Criteria results (Node 22.18.0 + pnpm 10.15.1)
- VC-037 (phase in/out of set, unknown seat, direction 0; only named fields change) — PASS (`apply/control-zones.test.ts`).
- VC-038 (A,B,C with B sitting out: steps 1 -> C, 2 -> A, direction -1 -> C; named pointer changes only the pointer; missing pointer, empty active_seats, no seated seat, `mode`, `steps 0` -> `MALFORMED_ACTION`; plus huge steps, off-order cursor) — PASS.
- VC-041 (max_instances 2 across batches -> third `ZONE_LIMIT`; ids `hand/s1/1`, `/2`; destroy 1 then create -> ordinal 3) — PASS.
- VC-042 (explicit `zone_id` mismatch/match, id > 128 (and exactly 128 ok), collision with a configured zone, injectivity, destroy of non-empty / non-template / unknown, `none`-rule ids `<t>/_/1` with no owner and `zoneOrdinals` key `<t>/_`, seat-rule missing/unknown owner, team/player rules) — PASS.
- VC-043 (three target shapes and scope kinds stored as given; ids `grant/<seq+1>/<i>` with i the committed index; replay of committed list gives same ids and digest; 19 invalid inputs; revoke existing/unknown) — PASS. The `[draw 2, ...]` form uses two `move`s (macros land in 10).
- VC-044 (delegate/revoke, two principals, duplicate, absent, unknown seat, empty / 129-byte principal, seat-attached across player change) — PASS.
- VC-050 (`nextZoneId` equals the created id, `pending`, `[zone_create, zone_create, move into nextZoneId(..,1)]`) — PASS.
- VC-027 `control_set` case: active player changing `active_seats` is admitted, state updated, next batch judged on the new state — PASS.
- KBR-006 failing paths (`max_instances`, id length, collision, non-empty destroy) and KBR-008 (phase/seat) — PASS; test names contain `KBR-006` / `KBR-008`.
- `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test` — exit 0 (470 tests, 34 files); `pnpm test:guardrails` (168) and `pnpm format:check` green.
- Artifacts: this file, `CONTEXT.md`, `DECISIONS.md` D-022..D-024 — PASS.

## Files
- Added: `session/zone-ids.ts`, `session/apply/primitives/{control,zones,grants,roster}.ts`, `session/apply/control-zones.test.ts`, this record.
- Changed: `session/apply/primitives/index.ts` (cases; `roster` non-delegation ops and `meta` still "not yet supported"), `session/index.ts` (exports `nextZoneId`), `session/actions.testing.ts` (builders), `session/apply/primitives.test.ts` (unsupported example now `meta`), `session/apply/apply.test.ts` (VC-027 control_set expectations), `CONTEXT.md`, `DECISIONS.md`.

## Deviations
- None from scope. No change to handler plumbing: `ctx.position`/`ctx.seq` already carried the committed index. Interpretation choices: D-022 (limit per template, live zones), D-023 (`nextZoneId` unvalidated), D-024 (control details).

## Gotchas
- A `.testing.ts` import placed at the bottom of a test file works but is ugly; keep imports on top.
- `ctx.work.zone(id)` is the right collision check (own-key); `Object.values(state.zones)` is used for the live count.
- `no-base-to-string` fires on `String(jsonValue)`; narrow to `string` first.
- Grant ids embed `ctx.seq`, so a state `variant` with a bumped `seq` is the way to test ids at seq > 0.

## For the next iteration (9: meta, roster reducers, engine.*)
- `roster` ops `join leave substitute set_status` and `meta` are the remaining "not yet supported" branches in `primitives/index.ts` (the `roster` case already routes `delegate`/`revoke_delegation` to `roster.ts`; add the reducer path next to it). `engine.grant_expire/grant_consume` should reuse `patch("grants", id, undefined)` as `revoke_view` does.
- Reducers must re-check structural invariants (KBR-001-003, 006-008) and counter bounds (KBR-010); zone/ordinal and control validity helpers are in `zones.ts`/`control.ts` (ids and seat existence via `getOwn`/`hasOwn`).
- VC-056 reducer variant and VC-004 reducer case belong to 9; the macro-dependent VC-043/VC-024 cases to 10.
