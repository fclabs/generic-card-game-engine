# CONTEXT — Phase 1 domain kernel (as of Iteration 3)

## Current state
- Iterations 1-3 of 13 done: toolchain, skeleton-purity exemption (`packages/core` only), branded ids, error taxonomy, `Snapshot`/`deepFreeze`, canonical JSON profile v1 + SHA-256, `CompiledGameDefinition` types with `assertDefinitionStructure`, `definitionData` and test builders.
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
| `session/snapshot.test.ts` | VC-012 (type part, local sample type), VC-013 (helper part) |
| `util/utf8.ts`, `util/utf8.test.ts` | internal `encodeUtf8` (not exported from any index) |
| `replay/index.ts` | `export * from "./canonical/index.js"` |
| `replay/canonical/{canonicalize,schema,sha256}.ts` | profile v1 implementation (+ `*.test.ts` beside each; `index.test.ts` = VC-068 partial) |
| `replay/canonical/index.ts` | exports exactly `canonicalize`, `CanonicalError`, `sha256Hex`, type `CanonicalSchema` |
| `replay/canonical/generate-golden-vectors.testing.ts` | vector sources, `buildGoldenVectors`, `encodeInput`/`reviveInput`, `toHex` (pure, test-only) |
| `replay/canonical/golden-vectors.json`, `golden-vectors.test.ts` | 35 committed vectors; VC-060 |
| `purity.test.ts` | VC-065 scan of non-test sources under `packages/core/src` |
| `definition/types.ts` | `CompiledGameDefinition` and part types (data + 3 function-valued kinds) |
| `definition/assert.ts` | `assertDefinitionStructure` |
| `definition/data.ts` | `definitionData(def)`, `DefinitionData`, `CounterData`, `MetaSchemaData` |
| `definition/definition.testing.ts` | `buildDefinition(overrides?)`, `buildFloorDefinition()` (test-only; not exported from the index) |
| `definition/definition.test.ts` | VC-083, VC-054 (definition half), VC-089 (shape half), floor shape |
| `definition/index.ts` | re-exports types, `assertDefinitionStructure`, `definitionData` |
| `session/index.ts` | `export * from ids`, `deepFreeze`, `DeepReadonly`, `Snapshot` |
Other changes: `packages/core/tsconfig.json` excludes `src/**/*.testing.ts`; `tools/guardrails/repo-invariants.ts` `checkSkeletonPurity` skips `packages/core/`.

## Public interfaces
- ids (`core/session`): types `SessionId DefinitionId CardId ZoneId SeatId PlayerId TeamId CounterId GateId GrantId` (`string & {[brand]: Name}`), `Seq` (`number & brand`). Guards `isSessionId … isGrantId (v: unknown): v is X` and `isSeq`. Constructors `sessionId definitionId cardId zoneId seatId playerId teamId counterId gateId grantId seq (v: unknown): Result<X>`; failure is `{code: 'MALFORMED_ACTION', detail: 'invalid <Name>: <value>'}` with no `path`/`actionIndex`. String id rule: `^[A-Za-z0-9_.:/-]{1,128}$`; `Seq`: safe integer >= 0.
- errors (`core/errors`): `ERROR_CODES` (readonly tuple of 24), `ErrorCode`, `EngineError {code; detail; actionIndex?; path?}`, `GameRejection {readonly code: string; readonly detail?: string}`, `Result<T, E = EngineError> = {ok:true;value:T}|{ok:false;error:E}`, `ok(value)`, `err(error)`.
- snapshot (`core/session`): `DeepReadonly<T>` (primitives/bigint/functions untouched, arrays -> `readonly`, objects -> readonly mapped), `Snapshot<T> = DeepReadonly<T>`, `deepFreeze<T>(v: T): Snapshot<T>` (iterative, cycle-safe, always descends into frozen shells, freezes in place and returns the same reference).
- Test helper: `isDeepFrozen(v: unknown): boolean` in `session/snapshot.testing.ts`.

- canonical (`core/replay/canonical`, also re-exported by `core/replay` and the root): `canonicalize(schema: CanonicalSchema, value: unknown): Uint8Array` (throws `CanonicalError`), `class CanonicalError extends Error {readonly path: string}` (path syntax `$`, `.field`, `[3]`, `["idMapKey"]`), `sha256Hex(bytes): string` (lower-case, 64 chars), type `CanonicalSchema`. `stateDigest` lands in iteration 4.
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
  - Placeholder function types (to be tightened): `PartitionReducer = (partition: never, payload: unknown) => unknown`, `DerivedEvaluator = (snapshot: never) => bigint` (`never` parameters so any typed function is assignable; iteration 4 types the snapshot as `Snapshot<SessionState>`, iteration 11 aligns reducers with SPI `Reducer<S>`).
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
- `SessionState` and all §6.4 state types: iteration 4 (re-point `snapshot.test.ts` sample at `SessionState`).
- `stateDigest` and the state schema builder: iteration 4 (add to canonical `index.ts`, update `index.test.ts` and VC-068 to four exports). `docs/canonical-json-profile.md` and its test (VC-066): iteration 13. PRNG: 5. Definition gaps: duplicate zone-template names, duplicate meta schema ids, duplicate conservation group ids and `maxInstances` sanity are NOT checked (not in KFR-101); no definition `id`/content identity field (P2). `apply`: 6-10.
- `createSession` half of VC-054 and the `canonicalize`-of-`definitionData` half of VC-089: iteration 4 (needs a schema for `DefinitionData`). `GameRejection` shape (`code` + optional `detail`) is a plan-level choice (D-001); revisit in iteration 11/12 if the SPI needs more.
