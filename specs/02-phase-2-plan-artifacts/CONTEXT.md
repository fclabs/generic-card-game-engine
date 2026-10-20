# CONTEXT: Phase 2 (updated after Iteration 3)

## Current state
- Phase 0 workspace and Phase 1 domain kernel (`packages/core`) are shipped. Iteration 1 changed the P1 definition types, `createSession`, `assertDefinitionStructure`, reducer dispatch in `apply`, and renamed/extended the definition identity schema (spec §4.6, DFR-060–066). Iteration 2 added the compiler foundation (`id`, `action_schema_version`, `seats`). Iteration 3 compiles `zones`, `cards` (generators), `counters` (incl. derived `zone_size`) and `conservation_groups`; every other section is still accepted-as-absent (see Known gaps). No YAML, registry or config code exists yet; `packages/config` is still the Phase 0 skeleton (`src/index.ts` only, `@cge/core` as its only dependency).
- Every P1 test passes (`pnpm test` count: see the iteration 3 record; 168 in `pnpm test:guardrails`); `golden-vectors.json`, `session/golden-stream.json` and `session/prng-vectors.json` are byte-identical to `3bbdd4a`.
- Docs under `docs/` are NOT yet updated (Iteration 12 owns them); `docs/canonical-json-profile.md` (line ~121) and `docs/domain-kernel.md` still mention `definitionDataSchema` and the three removed flags.

## File map (packages/core/src, P1 as built + Iteration 1)
- `definition/types.ts` — `CompiledGameDefinition` and decl types; `assert.ts` — `assertDefinitionStructure`; `data.ts` — `definitionData`, `DefinitionData`; `index.ts` — exports (all re-exported by the package root via `export *`).
- `definition/definition.testing.ts` — `buildDefinition(overrides)`, `buildFloorDefinition()` (test-only). `definition/identity-schema.test.ts` — VC-253.
- `replay/canonical/{canonicalize,schema,sha256,state-schema,definition-schema}.ts`, `golden-vectors.json` — profile v1 (frozen). `definition-schema.ts` exports `definitionIdentitySchema` (module-level only; not in the package root).
- `session/` — ids, state, snapshot, `create.ts` (`createSession`), `apply/` (`apply.ts`, `primitives/{meta,roster,set-metadata,...}.ts`, `reducer.ts`), `p1-adjustments.test.ts` (VC-250/251/252), `generators.testing.ts` (`buildPropertyDefinition`), `apply/reducers.testing.ts` (`buildReducerDefinition`).
- `definition/compile/` (Iteration 2, pure, relative imports): `errors.ts` (codes, `DefinitionError`, collector), `limits.ts` (`DefinitionLimits`, structural constants), `constants.ts` (`SUPPORTED_ACTION_SCHEMA_VERSIONS`, `GRANTABLE_VIEW_KEYS`), `strict.ts` (readers), `ids.ts` (charset), `foreach.ts` (`{seat}`/`{team}`), `seats.ts` (`compileSeats`), `compile.ts` (`compileDefinition`, `SECTION_ORDER`, `UNIMPLEMENTED_SECTIONS`), tests `compile.test.ts`, `foreach.test.ts`.
- `definition/compile/` (Iteration 3): `zones.ts` (`compileZones`, `readForEach`), `cards.ts` (`compileCards`), `axes.ts` (`readAxes`, `Axis`), `template.ts` (`parseTemplate`, `renderTemplate`, `Segment`), `counters.ts` (`compileCounters`, `OwnerRefs`), `derived.ts` (`zoneSizeEvaluator`), `groups.ts` (`compileConservationGroups`), `fields.ts` (`readFieldMap`, field type/visibility lists), `json-value.ts` (`validateJsonValue`, `JSON_MAX_DEPTH`), `bigint.ts` (`readBigInt`), `visibility.ts` (STUB `compileVisibility`, `VisibilityTarget`); test helper `compile.testing.ts` (`doc`, `deckDoc`, `failure`, `success`, `codePaths`, `STOCK`, `SUIT_RANK_GENERATOR`); tests `zones.test.ts`, `cards.test.ts` (incl. VC-227), `counters.test.ts` (counters, derived, groups).
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

## Public interfaces: compiler (Iteration 2; all exported from `core/definition` and the package root)
```ts
compileDefinition(raw: unknown, ctx?: {bundle?: HookBundleInfo; limits?: DefinitionLimits}): CompileResult
type CompileResult = {ok:true; value: CompiledGameDefinition} | {ok:false; errors: readonly DefinitionError[]; truncated: boolean}
interface DefinitionError { code: DefinitionErrorCode; path: string; detail: string; entity?: string }  // root path is ""
DEFINITION_ERROR_CODES (22, runtime list); type DefinitionErrorCode; MAX_DEFINITION_ERRORS = 100
interface DefinitionLimits { cascadeCapMax: number; costBudgetMax?: number }; DEFAULT_DEFINITION_LIMITS = {cascadeCapMax: 256}
SUPPORTED_ACTION_SCHEMA_VERSIONS = [1]; GRANTABLE_VIEW_KEYS = [card_face, zone_membership, zone_count, zone_order]
SECTION_ORDER (14 top-level keys in section order); UNIMPLEMENTED_SECTIONS; HookBundleInfo {hash; exports}
createErrorCollector(max?) / ErrorCollector
```
Not exported from the package root (relative import inside `definition/compile/`): strict readers, `checkId`, `foreach.ts`, `compileSeats`, structural `MAX_*` constants in `limits.ts`.

**Collector API** (`errors.ts`): `c.add(code, path, detail, entity?)`; `c.count` (errors kept, max 100); `c.truncated`; `c.errors()`. Sections call `add` in section order, so collection order is document order; the 101st error only sets `truncated`. Use `c.count` before/after a section to know whether it reported anything.

**Strict readers** (`strict.ts`, all take `c`, the raw value and its `path`; return the value or `undefined` after reporting): `readObject(c, v, path, allowed, required?)` (SCHEMA_TYPE / SCHEMA_UNKNOWN_KEY at the key path / SCHEMA_MISSING at the key path; still returns the object), `readArray`, `readString`, `readBoolean`, `readInteger` (non-number or float -> SCHEMA_TYPE; unsafe -> INVALID_VALUE), `readIntegerInRange(c,v,path,min,max)` (INVALID_VALUE), `readEnum(c,v,path,values)` (non-string SCHEMA_TYPE, unknown INVALID_VALUE), `readStringList`; helpers `has(obj,key)`, `member(obj,key)` (own keys only), `joinPath(base,key)`, `indexPath(base,i)`, `isPlainObject`, `describeType`.

**Ids** (`ids.ts`): `checkId(c, id, path, what, entity = id): boolean` (INVALID_VALUE for the P1 charset, naming `entity`; for generated ids pass the producing path and the generated id); `isValidId`, `isValidGameId`.

**for_each** (`foreach.ts`): `type ForEachKind = 'seat'|'team'`; `ForEachScope {seats: readonly string[]; teams: readonly string[]}`; `expandForEach(c, scope, kind|undefined, path, fields: Record<name, template>, entity?) -> readonly Record<name,string>[] | undefined` (one instance per seat/team in declaration order; errors at `<path>.<name>`, `for_each: team` without teams at `<path>.for_each`; `undefined` kind = one instance, placeholders then error); lower-level `forEachBindings`, `substitutePlaceholders(c, template, binding, path, entity?)`. All failures are `INVALID_VALUE`.

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

## Compiler behaviour as of Iteration 3
`compileDefinition` validates sections in `SECTION_ORDER`; implemented: `id`, `action_schema_version`, `seats`, `zones`, `cards`, `counters`, `conservation_groups`. Section builders (all `compileX(c, raw, path, ...) -> value | undefined`, `undefined` = something was reported; internal, not exported from the package root): `compileSeats`, `compileZones(c, raw, path, scope)`, `compileCards(c, raw, path, zoneIds | undefined)`, `compileCounters(c, raw, path, scope, {zones, cards})`, `compileConservationGroups(c, raw, path, scope, counters | undefined)`. A dependent section receives `undefined` for an upstream set that failed and then skips its reference checks; if `seats` failed, `zones`, `counters` and `conservation_groups` are skipped entirely (no cascade). `compile.ts` replaces each default in the final `value` literal.

**Zones**: fixed `{id, ordering, owner_id?, for_each?, visibility?}` or template `{template, owner, ordering, max_instances, visibility?}` (an entry with a `template` key is a template). `ZoneDecl.owner` only when `owner_id` is given (seat or team). Names: fixed ids and template names share one namespace for clashes (`DUPLICATE_ID` at the later item); template name: no `/`, <= 48, id charset. 1 000 limit counts expanded FIXED zones (`LIMIT_EXCEEDED` at `zones`, once).

**Card generator algorithm** (`cards.ts`): an explicit card is a generator with zero axes (no placeholder parsing: braces are literal and rejected by the id charset). For a generator: (1) read `axes` (ordered list of `{name, values}`; `values` = list of strings/safe ints or `{range:[lo,hi]}`, ranges are lazy: `length`, `at(i)`); (2) parse `id`, `type`, `zone` and each top-level string `metadata` value into segments of literals and `{axisName}` refs (`parseTemplate`; unknown axis, unmatched `{`/`}` are `INVALID_VALUE` at the field path, entity = the id template); a metadata value that is exactly one placeholder is a "lone" plan (keeps the axis value's type), a string with placeholders is a "mixed" plan (always string), anything else is a literal; (3) type-check metadata against `metadata_schema` ONCE per entry (literal vs declared type; lone placeholder vs the axis's value kinds; mixed needs `string`/`json`); (4) product of axis lengths vs the 10 000 total (`LIMIT_EXCEEDED` at the entry path: `cards[i]` or `cards[i].generate`); (5) odometer expansion, LAST axis fastest, FIRST axis slowest, appending cards in that order; per card: `checkId` (once, producing path `...id`, entity = generated id), duplicate id across the whole `cards` list (`DUPLICATE_ID`), zone must be in the declared fixed zone set (`UNKNOWN_REFERENCE` at `...zone`, entity = card id); the first failure aborts that entry. `CardDecl` = `{id, type?, metadataSchema, startingZone, initialMetadata, metadataVisibility}`; `metadataSchema`/`metadataVisibility` objects are SHARED by all cards of one entry (never mutate them), `initialMetadata` is a fresh object per card (json values deep-cloned). **Order guarantee for iteration 5**: `def.cards` is exactly declaration order, then expansion order above; the axis list order (not mapping-key order) decides it; permuting generator mapping keys does not change the output.

**Counters**: `compileCounters` per item: stored needs `owner`, `min`, `initial`; derived (`derived: {zone_size: <fixed zone>}`) needs none, `owner` defaults to `table`, and `min`/`max`/`initial`/`supply_role` are `INVALID_VALUE`. Integers via `readBigInt` (safe-integer bare YAML ints or decimal strings `-?(0|[1-9]\d*)`). `owner_id`: forbidden for `table` (`INVALID_VALUE`), else required (`SCHEMA_MISSING`), checked against seats (`player`), teams, fixed zones, cards (`UNKNOWN_REFERENCE`). `for_each` replaces `{seat}`/`{team}` in `id` and `owner_id`. **Derived evaluator** (`derived.ts`): `zoneSizeEvaluator(zone)` returns `(snapshot) => BigInt(getOwn(snapshot.zones, zone)?.members.length ?? 0)`; a fresh pure closure per counter; compiled counter has `min 0n`, `initial 0n`, `derived`, `derivedSpec {kind:'zone_size', zone}`, no `max`/`supplyRole`.

**Conservation groups**: `{id, counters: [id | {expand, for_each}]}`; members resolved against the compiled stored counters (`UNKNOWN_REFERENCE` for unknown or derived, naming the counter), duplicates inside a group and duplicate group ids are `DUPLICATE_ID`.

**Visibility stub**: `compileVisibility(c, raw, path, {kind: 'zone'|'template'|'counter', entity, owned})` in `visibility.ts` is called for every present `visibility` key and returns `{}` without reading the block. Iteration 4 replaces the body (same signature; `owned` says whether `owner`/`team` audiences are legal). Card metadata field visibility (`metadata_schema.<f>.visibility`) is NOT a stub: `readFieldMap` validates it (`INVALID_VISIBILITY`), reusable for `meta_schemas[].fields`.

## Known gaps
- Compiler sections not yet implemented (accepted as absent; present content is NOT read; compiled to defaults: `roles []`, `metaSchemas []`, control defaults of DFR-019 from the seat order, `viewKeys` all four, `policies {cascadeCap 16, costBudgets {}}`, `hookBindings {}`): `roles`, `control`, `meta_schemas`, `roster_reducer`, `view_keys`, `hooks`, `policies`, plus bundle/limits checks (Iteration 4). Also Iteration 4: replace the `compileVisibility` stub (zone/template/counter visibility compile to `{}` until then), validate identity data against `definitionIdentitySchema` before `ok` (DFR-010; json depth/surrogate/unsafe checks for card metadata already run in `validateJsonValue`), run `assertDefinitionStructure` on `ok`. `ctx` is still unused (`void ctx`).
- Identity hashing (`definitionContentHash`, bundle hash, `computeDefinitionId`) and the hash half of the axis-swap check (VC-215) — Iteration 5. `definitionIdentitySchema` is not yet exported from the package root.
- Registry port, config deps/guardrails (6), YAML, bundle, registry, server config, Docker, docs — Iterations 6–12.
- Stale docs listed under Current state — Iteration 12.
