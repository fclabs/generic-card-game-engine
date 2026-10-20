# Iteration 1: Phase 1 adjustments and artifact scaffolding

Commit: see `git log` (message `Phase 2 iteration 1: P1 definition type adjustments (initial metadata, owners, reducer refs, identity schema)`; SHA reported by the implementing agent).

## Criteria
- VC-250 PASS: `pnpm exec vitest run packages/core/src/session packages/core/src/definition` (tests in `session/p1-adjustments.test.ts`, VC-010 in `create.test.ts`).
- VC-251 PASS: same command; zone owner seeded, no `owner` key otherwise, digests of owner-less definitions unchanged (golden-stream VC-067 still passes).
- VC-252 PASS: same command; meta/roster unbound -> `REDUCER_ERROR` `reducer not bound: <ref>`, bound applies, absent ref/undeclared -> `MALFORMED_ACTION`, `engine.custom` rejected.
- VC-253 PASS: `pnpm exec vitest run packages/core/src/definition` (`identity-schema.test.ts`: new fields, no flags, `canonicalize(definitionIdentitySchema, ...)`, exhaustive-keys).
- VC-254 PASS: `git diff 3bbdd4a -- packages/core/src/replay/canonical/golden-vectors.json packages/core/src/session/prng-vectors.json packages/core/src/session/golden-stream.json` is empty; edited P1 tests listed below.
- Gates PASS: `pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test && pnpm test:guardrails` exit 0 (655 + 168 tests).
- Artifacts PASS: CONTEXT.md, DECISIONS.md (D-001..D-003), this record.

## Files
- Added: `packages/core/src/session/p1-adjustments.test.ts`, `packages/core/src/definition/identity-schema.test.ts`, `specs/02-phase-2-plan-artifacts/{CONTEXT.md,DECISIONS.md,iterations/01-p1-adjustments.md}`, `specs/02-phase-2.md`, `specs/02-phase-2-plan.md`.
- Changed (code): `definition/{types,assert,data,index}.ts`, `replay/canonical/definition-schema.ts`, `session/create.ts`, `session/apply/primitives/{meta,roster}.ts`.
- Changed (P1 tests/fixtures) and why:
  - `create.test.ts`: VC-010 asserts metadata equals `initialMetadata` (card 0 seeded `{rank: 7}`) (DFR-061); VC-054 fixture gains `reducerRef`.
  - `apply/reducers.test.ts`: VC-045 unbound meta and roster cases now `REDUCER_ERROR` (DFR-065); VC-056 inline counter gains `visibility`.
  - `definition/definition.test.ts`: VC-083 "no reducer" case -> `reducerRef: ""` and new message; VC-054 fixture; `definitionData` assertions on the flags replaced by `reducerRef`/`rosterReducerRef`/absence checks (DFR-066); inline counters/templates gain `visibility`.
  - `replay/canonical/state-digest.test.ts` (NOT named by DBR-010): VC-089 imports `definitionIdentitySchema` and asserts `derivedSpec`/`reducerRef`/`rosterReducerRef` instead of the three flags. Same flag assertion as DBR-010's `definition.test.ts` item, necessarily edited with the rename.
  - Fixture-only (new fields, neutral values): `definition.testing.ts` (also `gameId`, `roles`, `rosterReducerRef`, `derivedSpec` on `total`), `generators.testing.ts`, `reducers.testing.ts`, `apply.test.ts`, `control-zones.test.ts`, `counters.test.ts`, `macros.test.ts`.
- Deleted: none.

## Deviations
- `state-digest.test.ts` edit (above); otherwise none. Docs untouched (rule 6), so `docs/canonical-json-profile.md` still names the removed flags until Iteration 12.

## Gotchas
- `pnpm typecheck` compiles tests; run it, not just `pnpm build`, after type changes.
- `exactOptionalPropertyTypes` is on: optional members must be omitted, not set to `undefined` (`definitionData` omits `rosterReducerRef`).
- The reducer-unbound `REDUCER_ERROR` carries path `$[i].schema_id` (meta) / `$[i].op` (roster) and `actionIndex` i.

## For the next iteration
- Compiler must output the new required fields: `gameId`, `roles`, per-card `initialMetadata`/`metadataVisibility`, per-zone `owner?`/`visibility`, template `visibility`, counter `ownerId?`/`visibility`/`derivedSpec?` (derived counters: `min 0n`, `initial 0n`, `derived` evaluator), meta `reducerRef`/`fieldVisibility`, `rosterReducerRef?`. Omit absent optionals (no `undefined` values).
- Use `definitionIdentitySchema` via relative import `../replay/canonical/definition-schema.js` for DFR-010 validation; it is not exported from the package root.
- Reuse `buildDefinition` neutral defaults for compiler-vs-hand-built comparisons.
