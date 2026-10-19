# CONTEXT — Phase 1 domain kernel (as of Iteration 4)

## Current state
- Iterations 1-4 of 13 done: toolchain, skeleton-purity exemption (`packages/core` only), branded ids, error taxonomy, `Snapshot`/`deepFreeze`, canonical JSON profile v1 + SHA-256, `CompiledGameDefinition` types with `assertDefinitionStructure`, `definitionData` and test builders, `SessionState` types, `createSession`, `stateDigest`, `maskGates`.
- No runtime dependencies added; `packages/core/package.json` is unchanged.
- Gate: `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test && pnpm test:guardrails` all green.

## File map (`packages/core/src`)
| Path | Contents |
|------|----------|
| `index.ts` | re-exports `session definition visibility replay spi ports errors` indexes |
| `index.test.ts` | placeholder tests + root-export check for iteration-1 names |
| `errors/codes.ts` | `ERROR_CODES`, `ErrorCode` |
| `errors/result.ts` | `EngineError`, `GameRejection`, `Result`, `ok`, `err` |
| `errors/index.ts` | re-exports the above |
| `errors/errors.test.ts` | VC-003 + Result tests |
| `session/ids.ts` | branded ids, `Seq`, guards, constructors |
| `session/ids.test.ts` | VC-001, VC-002 |
| `session/snapshot.ts` | `DeepReadonly`, `Snapshot`, `deepFreeze` |
| `session/snapshot.testing.ts` | `isDeepFrozen` (test-only; NOT exported from any index) |
| `session/snapshot.test.ts` | VC-012 (writes through `Snapshot<SessionState>`), VC-013 (helper part) |
| `session/state.ts` | all §6.4 state types, `JsonValue`, `RosterEntry` |
| `session/state.testing.ts` | test-only `variant(state, edit)`, `cloneData`, `Mutable<T>` |
| `session/create.ts`, `create.test.ts` | `createSession`; VC-010, 011, 013 (initial), 014, 054 (create half) |
| `session/mask-gates.ts`, `mask-gates.test.ts` | `maskGates`; VC-082 |
| `util/utf8.ts`, `util/utf8.test.ts` | internal `encodeUtf8` (not exported from any index) |
| `replay/index.ts` | `export * from "./canonical/index.js"` |
| `replay/canonical/{canonicalize,schema,sha256}.ts` | profile v1 implementation (+ `*.test.ts` beside each; `index.test.ts` = VC-068 partial) |
| `replay/canonical/index.ts` | exports exactly `canonicalize`, `CanonicalError`, `sha256Hex`, `stateDigest`, type `CanonicalSchema` |
| `replay/canonical/state-schema.ts` | `buildStateSchema(def)`, `canonicalStateBytes(def, state)` (core-internal), `stateDigest` |
| `replay/canonical/definition-schema.ts` | `definitionDataSchema` (core-internal; schema of `DefinitionData`) |
| `replay/canonical/state-digest.test.ts` | VC-058, 062, 063, 084 (floor), 089 (canonicalize half) |
| `replay/canonical/generate-golden-vectors.testing.ts` | vector sources, `buildGoldenVectors`, `encodeInput`/`reviveInput`, `toHex` (pure, test-only) |
| `replay/canonical/golden-vectors.json`, `golden-vectors.test.ts` | 35 committed vectors; VC-060 |
| `purity.test.ts` | VC-065 scan of non-test sources under `packages/core/src` |
| `definition/types.ts` | `CompiledGameDefinition` and part types (data + 3 function-valued kinds) |
| `definition/assert.ts` | `assertDefinitionStructure` |
| `definition/data.ts` | `definitionData(def)`, `DefinitionData`, `CounterData`, `MetaSchemaData` |
| `definition/definition.testing.ts` | `buildDefinition(overrides?)`, `buildFloorDefinition()` (test-only; not exported from the index) |
| `definition/definition.test.ts` | VC-083, VC-054 (definition half), VC-089 (shape half), floor shape |
| `definition/index.ts` | re-exports types, `assertDefinitionStructure`, `definitionData` |
| `session/index.ts` | `export * from ids`, `deepFreeze`, `DeepReadonly`, `Snapshot`, state types, `createSession`, `maskGates` |
Other changes: `packages/core/tsconfig.json` excludes `src/**/*.testing.ts`; `tools/guardrails/repo-invariants.ts` `checkSkeletonPurity` skips `packages/core/`.

## Public interfaces
- ids (`core/session`): types `SessionId DefinitionId CardId ZoneId SeatId PlayerId TeamId CounterId GateId GrantId` (`string & {[brand]: Name}`), `Seq` (`number & brand`). Guards `isSessionId … isGrantId (v: unknown): v is X` and `isSeq`. Constructors `sessionId definitionId cardId zoneId seatId playerId teamId counterId gateId grantId seq (v: unknown): Result<X>`; failure is `{code: 'MALFORMED_ACTION', detail: 'invalid <Name>: <value>'}` with no `path`/`actionIndex`. String id rule: `^[A-Za-z0-9_.:/-]{1,128}$`; `Seq`: safe integer >= 0.
- errors (`core/errors`): `ERROR_CODES` (readonly tuple of 24), `ErrorCode`, `EngineError {code; detail; actionIndex?; path?}`, `GameRejection {readonly code: string; readonly detail?: string}`, `Result<T, E = EngineError> = {ok:true;value:T}|{ok:false;error:E}`, `ok(value)`, `err(error)`.
- snapshot (`core/session`): `DeepReadonly<T>` (primitives/bigint/functions untouched, arrays -> `readonly`, objects -> readonly mapped), `Snapshot<T> = DeepReadonly<T>`, `deepFreeze<T>(v: T): Snapshot<T>` (iterative, cycle-safe, always descends into frozen shells, freezes in place and returns the same reference).
- state (`core/session`, re-exported from root; all fields `readonly`; spec snake_case record -> `Readonly<Record<Id, X>>`):
  - `JsonValue = string|number|boolean|null|readonly JsonValue[]|{readonly [k:string]: JsonValue}`; `GameOutcome = JsonValue`.
  - `SessionState {id: SessionId; lifecycle: 'active'|'completed'|'terminated'; seq: Seq; cards: Record<CardId, CardState>; zones: Record<ZoneId, ZoneState>; zoneOrdinals: Record<string, number>; counters: Record<CounterId, bigint>; meta: Record<string, JsonValue>; roster: RosterState; control: ControlState; gates: GatesState; delegations: readonly Delegation[]; grants: Record<GrantId, Grant>; outcome?: GameOutcome}`.
  - `CardState {zone; orientation: 'face_up'|'face_down'; metadata: Record<string, JsonValue>}`; `ZoneState {template?: string; owner?: SeatId|TeamId|PlayerId; members: readonly CardId[]}`; `RosterState {seats: Record<SeatId, RosterSeat>}`, `RosterSeat {status: 'seated'|'sitting_out'|'eliminated'; player?; team?}`; `ControlState {phase; turnOrder; activeSeats; direction: 1|-1; pointers: Record<string, SeatId>}`; `GatesState {open: Record<GateId, Gate>; resolved: Record<GateId, ResolvedGate>}`; `Gate`/`ResolvedGate {schemaId; expectedSeats; submissions: Record<SeatId, JsonValue>}`; `Delegation {seat; principal; scope?: JsonValue; boundary?: string}`; `Grant {target: JsonValue; keys: readonly string[]; grantee: string; scope: JsonValue}`; `RosterEntry {seat; player?; team?}`; `MaskedGate {schemaId; expectedSeats; submitted}`; `SealedBySeat = readonly SeatId[]`; `GateMaskedSnapshot` (Snapshot of state with masked open gates); `SessionEnded {to: 'completed'|'terminated'; outcome?}`.
- `createSession(definition, sessionId, roster: readonly RosterEntry[]): Result<Snapshot<SessionState>>`: runs `assertDefinitionStructure` first (error passed through unchanged), then roster validation (all `MALFORMED_ACTION`, detail names the id, no `actionIndex`: undeclared seat, duplicate seat, team on teamless seat, team mismatch, duplicate player, missing declared seat, in that per-entry order then missing). Initial state: `lifecycle active`, `seq 0`, cards in starting zones in declaration order with `orientation 'face_down'` and `metadata {}`, zones `{members}` only (no template/owner), `zoneOrdinals {}`, `counters` = stored (non-derived) counters at `initial`, `meta` = `{[schemaId]: {}}` per declared meta schema, roster seats `{status:'seated', player?, team?}` copied from entries, control `{phase: initialPhase, turnOrder, activeSeats: initialActiveSeats, direction 1, pointers {}}`, `gates {open:{},resolved:{}}`, `delegations []`, `grants {}`, no `outcome` key. Everything is freshly built (never shares arrays with the definition) and deep-frozen.
- `maskGates(snapshot: Snapshot<SessionState>): GateMaskedSnapshot`: open gates become `{schemaId, expectedSeats (same ref), submitted}` (`expectedSeats` order, seats with an own `submissions` key); resolved gates and all other members are the input's references; only the new objects are frozen.
- Digest field order (`buildStateSchema(def)`; `id` excluded): `lifecycle, seq, cards, zones, zoneOrdinals, counters, derivedCounters, meta, roster, control, gates, delegations, grants, outcome?`. Nested: `cards` idMap of `{zone, orientation, metadata}`; `zones` idMap of `{template?, owner?, members}`; `roster {seats: idMap {status, player?, team?}}`; `control {phase, turnOrder, activeSeats, direction, pointers: idMap}`; `gates {open, resolved}` each idMap of `{schemaId, expectedSeats, submissions: idMap json}`; `delegations` array of `{seat, principal, scope?, boundary?}`; `grants` idMap of `{target json, keys, grantee, scope json}`; `outcome` optional `json`. Enums (lifecycle, orientation, status) are plain `string` nodes. `metadata` and each `meta` partition use ONE object node = union of the declared field names across all card metadata schemas / all meta schemas (names sorted, each optional; a name declared with differing types becomes `json`, byte-identical for scalars); undeclared fields are a `CanonicalError`. `derivedCounters` = idMap of derived counter id -> bigint computed on demand; an evaluator that throws or returns a non-bigint makes `stateDigest` throw a plain `Error`. See D-009, D-010.
- Test helper (`session/state.testing.ts`): `variant(state, edit: (draft: Mutable<SessionState>) => void): Snapshot<SessionState>` (clone, edit, deep-freeze), `cloneData`, `Mutable<T>`.
- `definitionDataSchema` (`replay/canonical/definition-schema.ts`, core-internal): schema of `DefinitionData`; `canonicalize(definitionDataSchema, definitionData(def))` works for any valid definition.
- Test helper: `isDeepFrozen(v: unknown): boolean` in `session/snapshot.testing.ts`.

- canonical (`core/replay/canonical`, also re-exported by `core/replay` and the root): `canonicalize(schema: CanonicalSchema, value: unknown): Uint8Array` (throws `CanonicalError`), `class CanonicalError extends Error {readonly path: string}` (path syntax `$`, `.field`, `[3]`, `["idMapKey"]`), `sha256Hex(bytes): string` (lower-case, 64 chars), type `CanonicalSchema`. `stateDigest(definition: CompiledGameDefinition, state: Snapshot<SessionState>): string` (iteration 4; lower-case hex SHA-256).
- Schema constructors live in `replay/canonical/schema.ts` and are NOT exported from the index (import them from `./schema.js` inside core): consts `intNode bigintNode stringNode boolNode nullNode jsonNode`; functions `optionalNode(of)`, `arrayNode(of)`, `idMapNode(of)`, `objectNode(fields: readonly (readonly [string, CanonicalSchema])[])`. `CanonicalSchema` is a plain JSON-serialisable tree `{kind: 'int'|'bigint'|'string'|'bool'|'null'|'json'} | {kind:'optional'|'array'|'idMap', of} | {kind:'object', fields}`. `JSON_MAX_DEPTH = 64` is exported from `canonicalize.ts` only.
- Semantics fixed in iteration 2: `optional` only omits when the key is absent (own property); a present key holding `undefined` is an error; `null` is accepted only by `nullNode`; objects must be plain (Object.prototype or null prototype), undeclared or symbol keys are errors, missing required fields are errors; `idMap`/`json` keys sorted with default `Array.prototype.sort` (UTF-16 code units); `json` node: depth of the node's value is 1, containers deeper than 64 and cycles are errors; ints reject -0/unsafe/non-number.
- `util/utf8.ts` (internal): `encodeUtf8(text): Result<Uint8Array, {index: number}>`; `err({index})` is the code-unit offset of a lone surrogate.

- definition (`core/definition`, re-exported from root): `assertDefinitionStructure(def): Result<void>`; every violation is `{code: 'MALFORMED_ACTION', detail}` (no `actionIndex`/`path`), detail names the entity, checks run in KFR-101 order (first violation wins): duplicate card id, card with no/unknown starting zone, duplicate zone/counter/seat id, conservation group with unknown or derived counter, counter `initial` outside `[min,max]`, meta schema without function `reducer`, meta schema id starting `engine.`, template name containing `/` or > 48 chars, turn order not a permutation of seats (repeat / undeclared / omitted seat), initial phase not in `phases`, undeclared initial active seat, seat naming undeclared team, `viewKeys` empty / empty-string entry / duplicate.
- `definitionData(def): DefinitionData`: data-vs-function rule. The ONLY function-valued members are `counters[].derived`, `metaSchemas[].reducer` and `rosterReducer`; `definitionData` replaces them with booleans `derived`, `hasReducer`, `hasRosterReducer` (all other members pass through; no `undefined`-valued keys emitted). Reducers/evaluators are always resolved from the definition value, never from the data.
- Definition TS names (spec snake_case -> camelCase), all `readonly`: `CompiledGameDefinition {schemaVersion: number; cards: CardDecl[]; zones: ZoneDecl[]; zoneTemplates: ZoneTemplateDecl[]; counters: CounterDecl[]; conservationGroups: ConservationGroupDecl[]; seats: SeatDecl[]; teams: TeamId[]; viewKeys: string[]; control: ControlDecl; metaSchemas: MetaSchemaDecl[]; rosterReducer?: PartitionReducer; policies: PolicyDecl; hookBindings: HookBindingTable}`.
  - `CardDecl {id; type?; metadataSchema: FieldSchema; startingZone}`; `ZoneDecl {id; ordered}`; `ZoneTemplateDecl {name; ownerRule: 'seat'|'team'|'player'|'none'; ordered; maxInstances}`.
  - `CounterDecl {id; owner: 'table'|'player'|'team'|'zone'|'card'; min: bigint; max?: bigint; initial: bigint; scale?: number; rounding?: 'floor'|'half_up'|'half_even'; supplyRole?: 'mint'|'burn'; derived?: DerivedEvaluator}`; `ConservationGroupDecl {id: string; counters: CounterId[]}`.
  - `SeatDecl {id; team?}`; `ControlDecl {phases; initialPhase; turnOrder: SeatId[]; initialActiveSeats; pointerNames; enforceActiveSeats; outOfTurnKinds}`; `MetaSchemaDecl {id; fields: FieldSchema; reducer?: PartitionReducer}`; `PolicyDecl {cascadeCap; costBudgets: Record<string, number>}`; `HookBindingTable = Record<routingKey, hookId[]>`.
  - `FieldType = 'string'|'int'|'bool'|'json'`; `FieldSchema = Record<string, FieldType>`. Spec term -> name: `max_instances`->`maxInstances`, `supply_role`->`supplyRole`, `enforce_active_seats`->`enforceActiveSeats`, `out-of-turn kinds`->`outOfTurnKinds`, `initial active seats`->`initialActiveSeats`, `pointer names`->`pointerNames`, `starting zone`->`startingZone`, `metadata schema`->`metadataSchema`, `hook binding table`->`hookBindings`, `cascade cap`->`cascadeCap`, `cost budgets`->`costBudgets`, `phase set`->`control.phases`.
  - Function types: `DerivedEvaluator = (snapshot: Snapshot<SessionState>) => bigint` (typed in iteration 4); placeholder `PartitionReducer = (partition: never, payload: unknown) => unknown` (`never` so any typed function is assignable; iteration 11 aligns it with SPI `Reducer<S>`).
- Builders (`definition.testing.ts`): `buildDefinition(overrides?: Partial<CompiledGameDefinition>)` (shallow override). Default fixture ids: seats `s1`(team `t1`) `s2`(`t2`); zones `deck`(ordered) `discard`(ordered) `table`(unordered); cards `c1..c6` all starting in `deck`, metadata `{rank:int, suit:string}`; templates `hand` (seat, unordered, max 1) and `pile` (none, ordered, max 4); counters `pot` (table, >=0, 0), `bank` (table, 0..1000, initial 100, supplyRole mint, rounding half_even, scale 2), `total` (derived, `() => 0n`); group `chips` = [pot, bank]; meta schema `notes {text: string}` with reducer; roster reducer; phases `setup|play|end`, initial `play`, turn order [s1,s2], active [s1], pointer `dealer`, enforce true, out-of-turn `chat`; viewKeys `hand`,`public`; policies `{cascadeCap:16, costBudgets:{hooks:100}}`; hookBindings `move`->[`on-move`], `phase:play`->[`on-play`]. `buildFloorDefinition()`: seats `seat-01..seat-14` (team `team-1..4` by `i % 4`), 64 zones `zone-00..zone-63` (even index ordered), 700 cards `card-000..card-699` (starting zone `zone-(i % 64)`, metadata `{rank:int}`), otherwise default counters/meta/templates; control turn order = all seats, active = first seat.

## Conventions & invariants
- Determinism rules (no `node:*`, `Date`, `Math.random`, `performance.now`, `process.env`, `crypto`, timers, `Atomics`, `SharedArrayBuffer`; core compiles with `types: []`) apply to all non-test code under `packages/core/src`.
- Tests: `*.test.ts` beside source; shared test builders/helpers `*.testing.ts` (compiled only by `tsconfig.test.json`; never exported from an index).
- Skeleton-purity exemption covers `packages/core` only; every other package must stay `export {}`/re-exports.
- Type-level tests: `@ts-expect-error` and `expectTypeOf` run under `pnpm typecheck` (tsconfig.test.json); vitest does not typecheck.
- No `!`/casts that eslint flags as unnecessary; `noUncheckedIndexedAccess` is not tripped by branded-key records.

## Commands (run from the worktree root)
```
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"   # Node 22.18.0 (default node is v26, wrong)
corepack enable --install-directory "$HOME/.nvm/versions/node/v22.18.0/bin"   # once; makes pnpm 10.15.1 resolve
hash -r; node -v; pnpm -v        # expect v22.18.0 and 10.15.1
pnpm install --frozen-lockfile
pnpm typecheck | pnpm lint | pnpm depcheck | pnpm test | pnpm test:guardrails | pnpm test:all | pnpm format:check
pnpm exec vitest run <path>      # single test file
pnpm exec prettier --write <paths>
```
Note: `.nvmrc` says 22.23.3 but only 22.18.0 is installed locally; it satisfies `>=22 <23`. Docker target (iterations 12, 13): `docker compose -f deploy/docker-compose.test.yml run --rm tests`. Shell is zsh on macOS: `sed -i` needs a suffix; use the Edit tool.

## Golden vectors
- Source of truth: `GOLDEN_SOURCES` in `generate-golden-vectors.testing.ts`; each has a hand-written `expectedText` that the generator cross-checks against `canonicalize` (and an independent UTF-8 encoding) before writing.
- Regenerate: `UPDATE_GOLDEN=1 pnpm exec vitest run packages/core/src/replay/canonical/golden-vectors.test.ts`, then `pnpm exec prettier --write packages/core/src/replay/canonical/golden-vectors.json` and review the diff by hand. Verify: `pnpm exec vitest run packages/core/src/replay/canonical`.
- JSON entry: `{name, description, schema, input, expectedText, expectedHex, expectedDigest}`; `input` is schema-directed encoded (bigint positions hold decimal strings; `reviveInput(schema, input)` inverts). The profile is frozen: changing any expected byte/digest means a profile change and needs a logged decision.

## Known gaps
- `docs/canonical-json-profile.md` and its test (VC-066): iteration 13. PRNG: 5. `apply`: 6-10 (it must deep-freeze only new objects; `stateDigest` and `maskGates` already accept any frozen state). SPI/ports types: 11.
- Definition gaps: duplicate zone-template names, duplicate meta schema ids, duplicate conservation group ids and `maxInstances` sanity are NOT checked (not in KFR-101); no definition `id`/content identity field (P2).
- State gaps decided in iteration 4 (D-010): initial card orientation `face_down`, initial metadata `{}`, initial `meta` partitions `{}`; per-card metadata strictness is only checked by `apply` (KFR-033), the digest schema is the union of declared fields. Record keys such as `__proto__` are not guarded (valid id charset; assignment into plain records would misbehave) — revisit when `apply` builds records.
- `GameRejection` shape (`code` + optional `detail`) is a plan-level choice (D-001); revisit in iteration 11/12 if the SPI needs more.
