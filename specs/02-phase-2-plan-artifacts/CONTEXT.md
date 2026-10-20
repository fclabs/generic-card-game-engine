# CONTEXT: Phase 2 (updated after Iteration 5)

## Current state
- Phase 0 workspace and Phase 1 domain kernel (`packages/core`) are shipped. Iteration 1 changed the P1 definition types, `createSession`, `assertDefinitionStructure`, reducer dispatch in `apply`, and the identity schema (DFR-060–066). Iterations 2-4 built the compiler: **`compileDefinition` is now complete** (every section of §7.1, `HookBundleInfo` checks, `ctx.limits`, identity validation and structural assertion before `ok`).
- "ok implies identity valid": a successful compile has been run through `canonicalize(definitionIdentitySchema, definitionData(value))` and `assertDefinitionStructure`, so `definitionContentHash` never throws for it. Iteration 5 added content identity: `definitionContentHash`, `hookBundleHash`, `computeDefinitionId` (core, exported from the package root), with committed expected hashes and a floor-size perf fixture (compile and hash each ~4 ms vs the 250 ms bound).
- No YAML, registry or config code exists yet; `packages/config` is still the Phase 0 skeleton (`src/index.ts`, `@cge/core` only). `packages/core/package.json` has no `dependencies`.
- Every P1 test passes (`pnpm test`: 903 tests; 168 in `pnpm test:guardrails`); `golden-vectors.json`, `session/golden-stream.json`, `session/prng-vectors.json` are byte-identical to `3bbdd4a`.
- Docs under `docs/` are NOT yet updated (Iteration 12 owns them); `docs/canonical-json-profile.md` (line ~121) and `docs/domain-kernel.md` still mention `definitionDataSchema` and the three removed flags.

## File map (packages/core/src, P1 as built + Iteration 1)
- `definition/types.ts` — `CompiledGameDefinition` and decl types; `assert.ts` — `assertDefinitionStructure`; `data.ts` — `definitionData`, `DefinitionData`; `index.ts` — exports (all re-exported by the package root via `export *`).
- `definition/definition.testing.ts` — `buildDefinition(overrides)`, `buildFloorDefinition()` (test-only). `definition/identity-schema.test.ts` — VC-253.
- `replay/canonical/{canonicalize,schema,sha256,state-schema,definition-schema}.ts`, `golden-vectors.json` — profile v1 (frozen). `definition-schema.ts` exports `definitionIdentitySchema` (module-level only; not in the package root).
- `session/` — ids, state, snapshot, `create.ts` (`createSession`), `apply/` (`apply.ts`, `primitives/{meta,roster,set-metadata,...}.ts`, `reducer.ts`), `p1-adjustments.test.ts` (VC-250/251/252), `generators.testing.ts` (`buildPropertyDefinition`), `apply/reducers.testing.ts` (`buildReducerDefinition`).
- `definition/compile/` (Iteration 2, pure, relative imports): `errors.ts` (codes, `DefinitionError`, collector), `limits.ts` (`DefinitionLimits`, structural constants), `constants.ts` (`SUPPORTED_ACTION_SCHEMA_VERSIONS`, `GRANTABLE_VIEW_KEYS`), `strict.ts` (readers), `ids.ts` (charset), `foreach.ts` (`{seat}`/`{team}`), `seats.ts` (`compileSeats`), `compile.ts` (`compileDefinition`, `SECTION_ORDER`, `UNIMPLEMENTED_SECTIONS`), tests `compile.test.ts`, `foreach.test.ts`.
- `definition/compile/` (Iteration 3): `zones.ts` (`compileZones`, `readForEach`), `cards.ts` (`compileCards`), `axes.ts` (`readAxes`, `Axis`), `template.ts` (`parseTemplate`, `renderTemplate`, `Segment`), `counters.ts` (`compileCounters`, `OwnerRefs`), `derived.ts` (`zoneSizeEvaluator`), `groups.ts` (`compileConservationGroups`), `fields.ts` (`readFieldMap`, field type/visibility lists), `json-value.ts` (`validateJsonValue`, `JSON_MAX_DEPTH`), `bigint.ts` (`readBigInt`), `visibility.ts` (STUB `compileVisibility`, `VisibilityTarget`); test helper `compile.testing.ts` (`doc`, `deckDoc`, `failure`, `success`, `codePaths`, `STOCK`, `SUIT_RANK_GENERATOR`); tests `zones.test.ts`, `cards.test.ts` (incl. VC-227), `counters.test.ts` (counters, derived, groups).
- `definition/compile/` (Iteration 4): `roles.ts` (`compileRoles`, `BUILT_IN_ROLES`), `visibility.ts` (real `compileVisibility`, `AUDIENCES`), `control.ts` (`compileControl`), `meta.ts` (`compileMetaSchemas`, `readExportName`, `EXPORT_NAME`), `view-keys.ts`, `hooks.ts` (`compileHooks`), `policies.ts` (`compilePolicies`, `DEFAULT_CASCADE_CAP`), `references.ts` (`HookBundleInfo`, `extractReferences`, `collectHookReferences`, `definitionNeedsBundle`, `checkBundle`), `finalize.ts` (`verifyCompiled`); tests `control.test.ts` (VC-219), `meta-roles.test.ts` (VC-220/221/222), `hooks.test.ts` (VC-223/224/225/237 unit), `complete.test.ts` (VC-210/211/226/228/229); fixture `full-definition.testing.ts` (`FULL_DEFINITION`, `FULL_BUNDLE`).
- `definition/identity.ts` (Iteration 5): `definitionContentHash`, `hookBundleHash`, `computeDefinitionId`, `bundleIdentitySchema`, `idIdentitySchema`; `identity.test.ts` (VC-230 object form + child process, VC-231, VC-232, VC-233, VC-255, VC-215 hash half); `identity-performance.test.ts` (VC-275 compile + hash); `identity-expected.json` (committed expected hashes); `fixtures/floor-definition.json` (floor fixture).
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

## Public interfaces: iteration 4 (exported from `core/definition` and the package root)
```ts
compileDefinition(raw: unknown, ctx?: {bundle?: HookBundleInfo; limits?: DefinitionLimits}): CompileResult  // final
interface HookBundleInfo { readonly hash: string; readonly exports: readonly string[] }   // type lives in compile/references.ts, re-exported
definitionNeedsBundle(raw: unknown): boolean          // total, pure; true iff hooks.module key present or any reference
collectHookReferences(raw: unknown): string[]         // sorted distinct export names from meta_schemas[].reducer, roster_reducer, hooks.*
```
`ctx.limits` defaults to `DEFAULT_DEFINITION_LIMITS` (`cascadeCapMax 256`, no `costBudgetMax`); `ctx.bundle` is only read for the checks below (its `hash` is not used by the compiler). `extractReferences(raw): {name, path}[]` (internal) is the single source of references and their raw paths.

**Final behaviour of `compileDefinition`**: sections run in order `id, action_schema_version, roles, seats, zones, cards, counters, conservation_groups, control, meta_schemas, roster_reducer, view_keys, hooks, policies`, then bundle checks (all errors of them are appended after the sections), then, only if no error so far, `verifyCompiled` (identity canonicalisation then `assertDefinitionStructure`; failures are `INVALID_VALUE` at the compiled path / root `""`, never thrown). Dependency skips (D-008, D-011): seats failed -> zones/counters/groups skipped; roles failed -> role-key check skipped; control failed -> `phase:` reaction check skipped. `UNIMPLEMENTED_SECTIONS` is now `[]` (kept exported).

**Fixture of VC-210**: `packages/core/src/definition/compile/full-definition.testing.ts` (`FULL_DEFINITION`, the parsed form of the §7.1 YAML with every key; `FULL_BUNDLE` covers its 7 export names). Iterations 5 and 9 may reuse it (e.g. hash goldens, registry fixtures).

## Public interfaces: identity (Iteration 5; `core/definition/identity.ts`, the three functions exported from `core/definition` and the package root)
```ts
definitionContentHash(def: CompiledGameDefinition): string      // sha256Hex(canonicalize(definitionIdentitySchema, definitionData(def))); 64 lower-case hex
hookBundleHash(jsBytes: Uint8Array, exports: readonly string[]): string   // sha256Hex(canonicalize(bundleIdentitySchema, {js: sha256Hex(jsBytes), exports: sorted+deduped}))
computeDefinitionId(contentHash: string, bundleHash?: string): DefinitionId  // 'sha256:' + sha256Hex(canonicalize(idIdentitySchema, {contentHash, bundleHash?})); 71 chars
bundleIdentitySchema = object([[js,string],[exports,array(string)]]); idIdentitySchema = object([[contentHash,string],[bundleHash,optional(string)]])  // exported from identity.ts only (not the root)
```
`exports` is sorted (UTF-16 order) and de-duplicated inside `hookBundleHash` (D-015); `bundleHash` is omitted from the canonical object (key absent) when `undefined`, so a no-bundle id never equals an empty-bundle id. `definitionId(unknown)` (P1 validator, `core/session`) is unchanged; both names are on the package root (`pnpm build` proves no clash). `definitionContentHash` throws `CanonicalError` only for hand-built values outside profile v1, never for a `compileDefinition` result. Hash does not depend on `hooks.module`, `HookBundleInfo.hash`, bound functions or YAML key order.

**Committed expected values** (VC-232): `packages/core/src/definition/identity-expected.json` = `{contentHashes: {full, floor}, bundles: [{text, exports, hash}], ids: {noBundle, withBundle}}`. `full` is the hash of `FULL_DEFINITION` (compiled with `FULL_BUNDLE`), `floor` of the floor fixture; bundle inputs are the UTF-8 `text`. If `definitionIdentitySchema` field order, any compiler default or `definitionData` changes, these values change on purpose (and replay packages bind to them): update the file in the same commit and say why. The empty-bundle hash and the no-bundle id were cross-checked against Node `crypto` + `JSON.stringify`.

**Floor fixture** (NFR-020): `packages/core/src/definition/fixtures/floor-definition.json` (raw parsed form, id `floor`: 14 seats, 4 teams, 700 cards = one generator `deck 1..5 x suit x rank 1..35`, 64 zones, 40 counters incl. 2 derived, one conservation group, policies). Read with `readFileSync` in tests. Measured (strict mode, `CGE_PERF_STRICT=1`, Apple dev laptop, Node 26): `compileDefinition` median-of-20 4.19 ms, `definitionContentHash` 3.80 ms (bound 250 ms). Without `CGE_PERF_STRICT`/`/.dockerenv` the test applies a 10x ceiling (same pattern as `session/floor-performance.test.ts`).

**VC-230 child process**: the node script is a string constant inside `identity.test.ts` run with `node --input-type=module -e`, importing `packages/core/dist/index.js` (needs `pnpm build` first, which `pnpm test` does). It lives in the test file because only `*.test.ts` is exempt from the core determinism lint (a `.mjs` under `packages/core` would be linted for `node:fs`/`process`).

## Error code -> source (compiler)
| Code | Raised by |
|------|-----------|
| `SCHEMA_UNKNOWN_KEY` / `SCHEMA_TYPE` / `SCHEMA_MISSING` | `strict.ts` readers, everywhere |
| `INVALID_VALUE` | readers (range/enum/unsafe int), `ids.ts#checkId`, `foreach.ts`, `seats.ts`, `cards.ts`/`axes.ts`/`template.ts`, `control.ts`, `meta.ts#readExportName`, `hooks.ts` (module path, reaction key, empty list), `view-keys.ts`, `finalize.ts` |
| `DUPLICATE_ID` | `seats.ts`, `zones.ts`, `cards.ts`, `counters.ts`, `groups.ts`, `roles.ts` (also built-in clash), `control.ts` (phases, pointers, turn order, active seats), `meta.ts`, `view-keys.ts` |
| `UNKNOWN_REFERENCE` | `seats.ts` (team), `zones.ts` (owner), `cards.ts` (zone), `counters.ts` (owner, zone), `groups.ts`, `control.ts` (seats), `hooks.ts` (`phase:<p>`) |
| `INVALID_VISIBILITY` | `fields.ts#readFieldMap` (card and meta fields), `visibility.ts` (role key, audience, owner/team on unowned) |
| `RESERVED_NAME` | `meta.ts` (`engine.` prefix) |
| `MISSING_REDUCER` | `meta.ts` |
| `MISSING_HOOK_MODULE`, `UNKNOWN_HOOK_EXPORT`, `BUNDLE_MISSING` | `references.ts#checkBundle` |
| `UNSUPPORTED_SCHEMA_VERSION` | `compile.ts` |
| `LIMIT_EXCEEDED` | `seats.ts`, `zones.ts`, `cards.ts`, `counters.ts`, `control.ts` (64 phases), `policies.ts` (ceilings) |
Codes raised outside the compiler (YAML, bundle, registry): `YAML_*` (iteration 7), `BUNDLE_INVALID` (8), `GAME_YAML_MISSING`, `GAME_ID_MISMATCH`, `SEARCH_PATH_MISSING` (9).

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

## Compiler behaviour (iterations 2-3 sections; iteration 4 below)
`compileDefinition` validates sections in `SECTION_ORDER`. Section builders (all `compileX(c, raw, path, ...) -> value | undefined`, `undefined` = something was reported; internal, not exported from the package root): `compileSeats`, `compileZones(c, raw, path, scope)`, `compileCards(c, raw, path, zoneIds | undefined)`, `compileCounters(c, raw, path, scope, {zones, cards})`, `compileConservationGroups(c, raw, path, scope, counters | undefined)`. A dependent section receives `undefined` for an upstream set that failed and then skips its reference checks; if `seats` failed, `zones`, `counters` and `conservation_groups` are skipped entirely (no cascade). `compile.ts` replaces each default in the final `value` literal.

**Zones**: fixed `{id, ordering, owner_id?, for_each?, visibility?}` or template `{template, owner, ordering, max_instances, visibility?}` (an entry with a `template` key is a template). `ZoneDecl.owner` only when `owner_id` is given (seat or team). Names: fixed ids and template names share one namespace for clashes (`DUPLICATE_ID` at the later item); template name: no `/`, <= 48, id charset. 1 000 limit counts expanded FIXED zones (`LIMIT_EXCEEDED` at `zones`, once).

**Card generator algorithm** (`cards.ts`): an explicit card is a generator with zero axes (no placeholder parsing: braces are literal and rejected by the id charset). For a generator: (1) read `axes` (ordered list of `{name, values}`; `values` = list of strings/safe ints or `{range:[lo,hi]}`, ranges are lazy: `length`, `at(i)`); (2) parse `id`, `type`, `zone` and each top-level string `metadata` value into segments of literals and `{axisName}` refs (`parseTemplate`; unknown axis, unmatched `{`/`}` are `INVALID_VALUE` at the field path, entity = the id template); a metadata value that is exactly one placeholder is a "lone" plan (keeps the axis value's type), a string with placeholders is a "mixed" plan (always string), anything else is a literal; (3) type-check metadata against `metadata_schema` ONCE per entry (literal vs declared type; lone placeholder vs the axis's value kinds; mixed needs `string`/`json`); (4) product of axis lengths vs the 10 000 total (`LIMIT_EXCEEDED` at the entry path: `cards[i]` or `cards[i].generate`); (5) odometer expansion, LAST axis fastest, FIRST axis slowest, appending cards in that order; per card: `checkId` (once, producing path `...id`, entity = generated id), duplicate id across the whole `cards` list (`DUPLICATE_ID`), zone must be in the declared fixed zone set (`UNKNOWN_REFERENCE` at `...zone`, entity = card id); the first failure aborts that entry. `CardDecl` = `{id, type?, metadataSchema, startingZone, initialMetadata, metadataVisibility}`; `metadataSchema`/`metadataVisibility` objects are SHARED by all cards of one entry (never mutate them), `initialMetadata` is a fresh object per card (json values deep-cloned). **Order guarantee for iteration 5**: `def.cards` is exactly declaration order, then expansion order above; the axis list order (not mapping-key order) decides it; permuting generator mapping keys does not change the output.

**Counters**: `compileCounters` per item: stored needs `owner`, `min`, `initial`; derived (`derived: {zone_size: <fixed zone>}`) needs none, `owner` defaults to `table`, and `min`/`max`/`initial`/`supply_role` are `INVALID_VALUE`. Integers via `readBigInt` (safe-integer bare YAML ints or decimal strings `-?(0|[1-9]\d*)`). `owner_id`: forbidden for `table` (`INVALID_VALUE`), else required (`SCHEMA_MISSING`), checked against seats (`player`), teams, fixed zones, cards (`UNKNOWN_REFERENCE`). `for_each` replaces `{seat}`/`{team}` in `id` and `owner_id`. **Derived evaluator** (`derived.ts`): `zoneSizeEvaluator(zone)` returns `(snapshot) => BigInt(getOwn(snapshot.zones, zone)?.members.length ?? 0)`; a fresh pure closure per counter; compiled counter has `min 0n`, `initial 0n`, `derived`, `derivedSpec {kind:'zone_size', zone}`, no `max`/`supplyRole`.

**Conservation groups**: `{id, counters: [id | {expand, for_each}]}`; members resolved against the compiled stored counters (`UNKNOWN_REFERENCE` for unknown or derived, naming the counter), duplicates inside a group and duplicate group ids are `DUPLICATE_ID`.

**Iteration 4 sections** (details in D-010..D-014). `roles`: `{id, subject}`, ids checked, built-ins `player|dealer|auditor|render`. `ForEachScope` gained optional `roles` (built-ins + declared) which zones/counters pass to `compileVisibility(c, raw, path, {kind, entity, owned, roles})`; the block is a map of `default`|role -> `public|hidden|owner|team`, compiled in declaration order, `{}` when it reported anything or is absent. `control`: absent = `{}` = defaults; `turn_order` default = seat order; active seats default = first of the (given) turn order; omitted seat -> `INVALID_VALUE` at `control.turn_order`. `meta_schemas[]` `{id, reducer, fields?}` (fields default `{}`, via `readFieldMap`); `roster_reducer`, `hooks.*` values are export names validated against `EXPORT_NAME` (`^[A-Za-z_$][A-Za-z0-9_$]*$`). `hooks`: keys compile to `validation:<kind>`, `reaction:<key>`, `gate_resolve:<id>`, `authorization:default` (each value a non-empty list); `module` must match `^\./[A-Za-z0-9_.@-]+(/...)*\.(ts|js)$` without `..`; it is returned by `compileHooks` but never stored. `policies`: `cascade_cap` default 16 (not checked against the ceiling when absent), `cost_budgets` keys `validation|reaction|gate_resolve|authorization` (unknown key = `SCHEMA_UNKNOWN_KEY`).

## Known gaps
- VC-230 on YAML text (anchors, key order, comments, whitespace, explicit defaults, child process on a `.yaml` file) is **deferred to iteration 7**: until `parseYaml` exists, VC-230 is asserted on JS objects (key-order reversal, shared object references standing in for anchors, explicit defaults, child process on JSON). Iteration 7 must add the YAML-text variants (including `hooks.module`-independent and comment-only edits) and may reuse `identity-expected.json` values.
- VC-275 parse half (1 MiB parse+compile, 1 MiB+1 byte rejection) — Iteration 7. DNFR-002 in the Docker `test` target is measured in iteration 12. `definitionIdentitySchema` is not exported from the package root (relative import from `core/definition`/`replay/canonical`).
- VC-237 hash part (leftover `dist`), registry port, config deps/guardrails (6), YAML, bundle, registry, server config, Docker, docs — Iterations 6–12.
- Stale docs listed under Current state — Iteration 12.
