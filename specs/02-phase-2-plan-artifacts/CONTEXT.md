# CONTEXT: Phase 2 (updated after Iteration 1)

## Current state
- Phase 0 workspace and Phase 1 domain kernel (`packages/core`) are shipped. Iteration 1 changed the P1 definition types, `createSession`, `assertDefinitionStructure`, reducer dispatch in `apply`, and renamed/extended the definition identity schema (spec §4.6, DFR-060–066). No compiler, YAML, registry or config code exists yet; `packages/config` is still the Phase 0 skeleton (`src/index.ts` only, `@cge/core` as its only dependency).
- Every P1 test passes (655 tests in `pnpm test`, 168 in `pnpm test:guardrails`); `golden-vectors.json`, `session/golden-stream.json` and `session/prng-vectors.json` are byte-identical to `3bbdd4a`.
- Docs under `docs/` are NOT yet updated (Iteration 12 owns them); `docs/canonical-json-profile.md` (line ~121) and `docs/domain-kernel.md` still mention `definitionDataSchema` and the three removed flags.

## File map (packages/core/src, P1 as built + Iteration 1)
- `definition/types.ts` — `CompiledGameDefinition` and decl types; `assert.ts` — `assertDefinitionStructure`; `data.ts` — `definitionData`, `DefinitionData`; `index.ts` — exports (all re-exported by the package root via `export *`).
- `definition/definition.testing.ts` — `buildDefinition(overrides)`, `buildFloorDefinition()` (test-only). `definition/identity-schema.test.ts` — VC-253.
- `replay/canonical/{canonicalize,schema,sha256,state-schema,definition-schema}.ts`, `golden-vectors.json` — profile v1 (frozen). `definition-schema.ts` exports `definitionIdentitySchema` (module-level only; not in the package root).
- `session/` — ids, state, snapshot, `create.ts` (`createSession`), `apply/` (`apply.ts`, `primitives/{meta,roster,set-metadata,...}.ts`, `reducer.ts`), `p1-adjustments.test.ts` (VC-250/251/252), `generators.testing.ts` (`buildPropertyDefinition`), `apply/reducers.testing.ts` (`buildReducerDefinition`).
- `ports/`, `spi/`, `errors/`, `visibility/` (empty barrel), `util/`.

## Public interfaces (as committed)
New exported types from `core/definition` and the package root: `FieldVisibility = 'public'|'subject'|'secret'`; `Audience = 'public'|'hidden'|'owner'|'team'`; `VisibilityRules = Readonly<Record<string, Audience>>`; `RoleDecl {id; subject: 'required'|'optional'|'forbidden'}`; `DerivedSpec = {kind:'zone_size'; zone: ZoneId}`.

Changed types (all `readonly`; everything else unchanged):
```ts
CompiledGameDefinition += { gameId: string; roles: readonly RoleDecl[]; rosterReducerRef?: string }  // rosterReducer? stays, bound by P4
CardDecl          += { initialMetadata: Readonly<Record<string, JsonValue>>; metadataVisibility: Readonly<Record<string, FieldVisibility>> }
ZoneDecl          += { owner?: SeatId | TeamId; visibility: VisibilityRules }
ZoneTemplateDecl  += { visibility: VisibilityRules }
CounterDecl       += { ownerId?: string; visibility: VisibilityRules; derivedSpec?: DerivedSpec }  // derived? evaluator stays
MetaSchemaDecl    += { reducerRef: string; fieldVisibility: Readonly<Record<string, FieldVisibility>> }  // reducer? stays, bound by P4
```
`DefinitionData` (from `definitionData(def)`): `gameId, roles, schemaVersion, cards, zones, zoneTemplates, counters, conservationGroups, seats, teams, viewKeys, control, metaSchemas, rosterReducerRef?, policies, hookBindings`. `CounterData = Omit<CounterDecl,'derived'>`, `MetaSchemaData = Omit<MetaSchemaDecl,'reducer'>`; `rosterReducerRef` is omitted (key absent) when undefined. Flags `derived` (boolean), `hasReducer`, `hasRosterReducer` no longer exist.

`definitionIdentitySchema: CanonicalSchema` (`replay/canonical/definition-schema.ts`) covers every field above (D-001 field order). `definitionDataSchema` no longer exists. Exhaustive-keys test: `definition/identity-schema.test.ts` (per-type `Record<keyof T, true>` lists compared with the schema's object fields).

Behaviour changes: `createSession` seeds `cards[c].metadata = {...initialMetadata}` and `zones[z].owner` only when `ZoneDecl.owner` is set. `assertDefinitionStructure` rule "reducerRef is a non-empty string" -> `meta schema <id> has no reducer reference`; `initialMetadata` conformance (D-003). `apply` dispatch: D-002. All structural errors stay `MALFORMED_ACTION`.

## Conventions & invariants
- Neutral fixture defaults (§4.6): `gameId: 'test'`, `roles: []`, `visibility: {}`, `initialMetadata: {}`, `metadataVisibility: {}`, `fieldVisibility: {}`, `reducerRef` = name of the registered function (`"identity"`, `"notesReducer"`, `"scoreReducer"`, `"blobReducer"`), `rosterReducerRef` = `"identity"` / `"rosterReducer"`; the base derived counter `total` has `derivedSpec {kind:'zone_size', zone:'deck'}`.
- Strict ESM TS; `./….js` relative imports; explicit `vitest` imports; tests beside sources; test-only builders `*.testing.ts`; `packages/core` has `types: []`, no `node:*`, no Date/Math.random/performance.now/process.env/crypto.*/timers.
- `pnpm typecheck` also type-checks tests (`tsconfig.test.json` per package); a fixture missing a new required field fails there, not in `pnpm build`.
- Git: never `git add -A`; user-owned deletions of `specs/01-phase-1-plan*` stay untouched.
- P1 test exceptions (DBR-010) edited in Iteration 1: `definition.test.ts` (VC-083 reducer rule, flag assertions, fixtures), `create.test.ts` (VC-010 seeding, VC-054 fixture), `apply/reducers.test.ts` (VC-045 unbound cases; VC-056 inline counter), `replay/canonical/state-digest.test.ts` (VC-089 flag assertions + import rename; see record), fixture-only edits: `definition.testing.ts`, `generators.testing.ts`, `apply/reducers.testing.ts`, `apply/{apply,control-zones,counters,macros}.test.ts`.

## Commands
```
pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test && pnpm test:guardrails
pnpm build && pnpm exec vitest run packages/core/src/session packages/core/src/definition
git diff 3bbdd4a -- packages/core/src/replay/canonical/golden-vectors.json   # must be empty
```
(Node 26 here warns about engines `>=22 <23`; harmless.)

## Known gaps
- No compiler, errors, limits, identity hashing (`definitionContentHash`, bundle hash, `computeDefinitionId`) — Iterations 2–5. `definitionIdentitySchema` is not yet exported from the package root.
- Registry port, config deps/guardrails (6), YAML, bundle, registry, server config, Docker, docs — Iterations 6–12.
- Stale docs listed under Current state — Iteration 12.
