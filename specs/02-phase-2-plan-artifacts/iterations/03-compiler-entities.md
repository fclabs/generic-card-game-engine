# Iteration 3: Compiler entities (zones, cards, counters, derived counters, conservation groups)

Commit: see `git log` (message `Phase 2 iteration 3: compile zones, cards, counters and conservation groups`; SHA reported by the implementing agent).

## Criteria
- VC-214 PASS: `pnpm exec vitest run packages/core/src/definition` (`compile/zones.test.ts`: fixed, template, for_each seat/team, every error case, 1 000/1 001 zones).
- VC-215 PASS: same command (`compile/cards.test.ts`): 52-card order `S1..S13,H1..`, `rank` integer / `suit` string, axis-swap order `S1,H1,D1,C1,S2`, key-order independence, 416 cards, 10 000 cap, undeclared axis, unmatched `{`, template zone, metadata not in schema, `rank:"x"`, duplicate id. The `contentHash` half of the axis-swap check is deferred to iteration 5.
- VC-216 PASS: same command (`compile/counters.test.ts`): bigint bounds, bare `9007199254740992/3` INVALID_VALUE vs quoted exact bigints, owner rules, scale/rounding/supply_role, for_each order.
- VC-217 PASS: same command: `min 0n`, `initial 0n`, no `max`/`supplyRole`, evaluator `52n` then `51n` after a `move`, two compiles equal, error cases.
- VC-218 PASS: same command: literals + `expand`, UNKNOWN_REFERENCE (unknown, derived), DUPLICATE_ID (counter in group, group id).
- VC-227 PASS: same command: fast-check property, 600 runs (card count = product of axis lengths).
- VC-229 PASS (card, zone, counter parts): same command; 128/129-character ids, space in generated ids with entity and producing path.
- Also covered: VC-228 card-metadata part (float, depth 65, lone surrogate, unsafe int), VC-220 card `metadata_schema` visibility part, VC-226 card placement through `createSession`.
- Gates PASS: `pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test` exit 0 (771 tests); `pnpm test:guardrails` 168 pass.
- Artifacts PASS: CONTEXT.md rewritten, DECISIONS.md D-006..D-009, this record.

## Files
- Added (`packages/core/src/definition/compile/`): `zones.ts`, `cards.ts`, `axes.ts`, `template.ts`, `counters.ts`, `derived.ts`, `groups.ts`, `fields.ts`, `json-value.ts`, `bigint.ts`, `visibility.ts` (stub), `compile.testing.ts`, `zones.test.ts`, `cards.test.ts`, `counters.test.ts`.
- Changed: `compile/compile.ts` (sections wired in order, `UNIMPLEMENTED_SECTIONS` shrunk), `CONTEXT.md`, `DECISIONS.md`.
- No P1 file, no `index.ts` export, no dependency touched.

## Deviations
- More modules than the plan names (split to keep files small). `readFieldMap` (card `metadata_schema` visibility) is implemented here, not stubbed, because DFR-014 needs it; iteration 4 reuses it for meta schemas.
- Builders are internal (not exported from the package root).

## Gotchas
- Axis `values` ranges are lazy (`length`, `at(i)`): never materialise a range before the 10 000 check.
- Bare `9007199254740993` in a JS test literal is rounded by the engine (lint `no-loss-of-precision`); tests use `Number("9007199254740993")` for the unsafe bare case.
- `metadataSchema`/`metadataVisibility` objects are shared among the cards of one generator.
- Seats failing skips zones/counters/groups entirely (D-008).
- A test override of `undefined` leaves the key present; `cards.test.ts` `gen()` drops undefined keys.

## For the next iteration
- Replace the body of `compile/visibility.ts#compileVisibility` (same signature); `target.owned` tells whether `owner`/`team` audiences are legal. Zone, template and counter `visibility` currently compile to `{}`.
- Add `roles`, `control`, `meta_schemas` (reuse `readFieldMap(c, raw, path, entity)` for `fields`; reducer/visibility errors follow D-006), `roster_reducer`, `view_keys`, `hooks`, `policies`; remove each from `UNIMPLEMENTED_SECTIONS`; `ctx` (bundle, limits) still unread.
- For identity validation reuse `validateJsonValue` ideas but the authority is `canonicalize(definitionIdentitySchema, definitionData(def))` on the final value; bigint counters and `derivedSpec` already conform.
- Iteration 5 may assume `def.cards` order = declaration order then odometer order (first axis slowest) and that axis-list order, not mapping-key order, decides it.
