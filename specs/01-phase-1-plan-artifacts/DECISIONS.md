# DECISIONS (append-only)

## D-001: Id, error and snapshot API shapes  (Iteration 1)
**Context**: The spec fixes behaviour but not exact names for constructors, `GameRejection`, or how `deepFreeze` treats frozen inputs.
**Decision**: Guards are `isX(v: unknown): v is X`; constructors are lowerCamel `x(v: unknown): Result<X>` (e.g. `cardId`, `seq`) returning `MALFORMED_ACTION` with detail `invalid <Name>: <value>` and no `path`. Brands use a `declare const brand: unique symbol` tag. `GameRejection = {readonly code: string; readonly detail?: string}`. `Result`'s error defaults to `EngineError`; `ok`/`err` return the narrow variant types. `deepFreeze` freezes in place, returns the same reference, is iterative with a visited set (cycle-safe) and always descends, even into already-frozen objects, so a shallow-frozen shell is completed. Callers wanting structural-sharing speed (iteration 6) pass only new objects.
**Rejected**: Making `deepFreeze` skip frozen subtrees (silently leaves unfrozen children); recursion (stack overflow on deep graphs); an opaque brand class for `GameRejection` (no spec need).
**Consequences**: Later iterations validate ids with the guards and convert via the constructors; iteration 4 `createSession` uses `Result`; iteration 6 must freeze only new objects for KNFR-004 performance.

## D-002: Skeleton-purity exemption by path prefix  (Iteration 1)
**Context**: Spec §6.5 exempts `packages/core` only from FR-043 check 4.
**Decision**: `checkSkeletonPurity` filters out files under `<repo>/packages/core/` and checks all other `packages/**` as before. The old VC-074 test now plants code in `packages/app`; a new test shows `packages/core` with code passes. No other guardrail touched.
**Rejected**: Removing the check (spec says it stays for other packages); a configurable allowlist (scope creep).
**Consequences**: A new package that needs code later requires a deliberate guardrail change.

## D-003: Node/pnpm activation on this machine  (Iteration 1)
**Context**: Default node is v26 and pnpm was not on PATH; `.nvmrc` pins 22.23.3 but only 22.18.0 is installed.
**Decision**: Prepend `~/.nvm/versions/node/v22.18.0/bin` to PATH and `corepack enable --install-directory` that dir so the `pnpm@10.15.1` shim resolves. See CONTEXT Commands.
**Rejected**: Using `/usr/local/bin/pnpm` (version not guaranteed to match the pin); installing another Node.
**Consequences**: Every iteration starts with the PATH export; Docker remains the authoritative gate.

## D-004: CanonicalSchema constructors and error surface  (Iteration 2)
**Context**: Spec §6.2 lists node kinds but not constructor names; the plan says the index exports exactly `canonicalize`, `sha256Hex`, `CanonicalError` (+ `stateDigest` later) and types.
**Decision**: `CanonicalSchema` is a plain discriminated union (`kind` tags). Constructors are consts `intNode bigintNode stringNode boolNode nullNode jsonNode` and functions `optionalNode arrayNode idMapNode objectNode`, living in `schema.ts` and not exported from the index (core-internal; iteration 4 imports them directly). `canonicalize` throws `CanonicalError {path}` (it never returns a Result); paths look like `$.a[2]["id"]`.
**Rejected**: Exporting constructors from the index (violates the "exactly" export list); names like `int()`/`null()` (clash with keywords/reads ambiguously); a Result return (spec KFR-070 says "yield a CanonicalError").
**Consequences**: Later phases needing schemas from outside core will need an index change plus a decision; schemas are JSON-serialisable so golden vectors embed them.

## D-005: Strict semantics for optional, null and objects  (Iteration 2)
**Context**: Rule 3 says absent optional fields are omitted yet `undefined` is an error; "null only where declared" needs a declaring node.
**Decision**: Optional is omitted only when the key is absent; a present key with `undefined` is a `CanonicalError`. `nullNode` is the only node accepting `null` (there is no nullable/union node in v1). Objects must be plain; undeclared fields, symbol keys and missing required fields are errors. `optional` outside an object field simply validates its inner node.
**Rejected**: Treating `{k: undefined}` as absent (hides builder bugs and breaks digest determinism); adding a `nullable` node (not in the frozen node list).
**Consequences**: State builders (iteration 4+) must not emit `undefined`-valued keys; a nullable field cannot be expressed in v1 (none is needed in §6.4).

## D-006: Golden-vector generation runs through vitest  (Iteration 2)
**Context**: No `tsx`/ts-node in the repo and no new dependencies allowed; `.testing.ts` files are linted by the determinism rules (no `node:*`).
**Decision**: Vectors are defined in pure `generate-golden-vectors.testing.ts` with hand-written expected text; `golden-vectors.test.ts` writes the JSON when `UPDATE_GOLDEN=1` and always asserts file == generator output and bytes/digest (also against `node:crypto`).
**Rejected**: A standalone node script (needs a TS runner); computing expectations only from the implementation (self-confirming).
**Consequences**: Regeneration command is in CONTEXT.md; any diff to the JSON must be hand-reviewed.

## D-007: Definition field names and function-valued members  (Iteration 3)
**Context**: KFR-100 lists components in prose/snake_case; the data-vs-function rule must be usable by iteration 4's schema/digest.
**Decision**: camelCase names (mapping in CONTEXT.md). Function-valued members are exactly `CounterDecl.derived`, `MetaSchemaDecl.reducer` and `CompiledGameDefinition.rosterReducer`. `definitionData(def)` returns the data portion with `derived`/`hasReducer`/`hasRosterReducer` booleans and no `undefined` keys (canonicalize rejects them, D-005). Reducers/derived evaluators are typed with `never` parameters (`PartitionReducer`, `DerivedEvaluator`) as placeholders; `reducer` is optional in the type so "meta schema without a reducer" is representable and checkable. Counter `owner` is the kind only (`table|player|team|zone|card`); counter `min` is required, `max` optional.
**Rejected**: `unknown` parameters (typed functions would not be assignable under strictFunctionTypes); `any` (lint); a static zone `owner` field and a definition `id` (not in KFR-100's list; P2 can add).
**Consequences**: Iteration 4 types the evaluator snapshot and builds the definition-data canonical schema; iteration 11 aligns reducer types with SPI `Reducer<S>`; adding fields later is a conscious change.

## D-008: Interpretation of KFR-101 checks  (Iteration 3)
**Context**: Several KFR-101 items are ambiguous or leave edge cases.
**Decision**: All violations are `MALFORMED_ACTION` (KFR-052 names it for the reserved namespace) with a detail naming the entity and no `actionIndex`. Checks run in KFR-101 order, one full pass per item (first violation wins). "Turn order not a permutation" is split into repeated / undeclared / omitted seat. "Empty / duplicate viewKeys entry" = empty list, empty-string entry or duplicate. Derived counters in conservation groups are rejected (plan-level decision). A meta schema with an `engine.` id is rejected even when it has a reducer; the no-reducer check comes first per the spec order.
**Rejected**: Extra checks beyond KFR-101 (duplicate template names/meta ids/group ids): scope creep, listed in Known gaps.
**Consequences**: Iteration 4 `createSession` maps the `assertDefinitionStructure` error through unchanged.

## D-009: Heterogeneous idMap values use unioned field nodes  (Iteration 4)
**Context**: Card metadata schemas differ per card and meta partitions per schema id, yet `idMap` has a single value node and the node list is frozen (§6.2).
**Decision**: `buildStateSchema` builds one object node per use: the union of declared field names (sorted by code unit, each `optional`); a name declared with different types becomes `json` (same bytes as string/int/bool). `cards` and `meta` stay `idMap`s (`[key, value]` pairs), as §6.2 requires. Enum-like strings (lifecycle, orientation, status) are plain `string` nodes. Delegations are an `array` in insertion order, `outcome` an optional `json` last.
**Rejected**: Per-card/per-partition `object` nodes keyed by id (changes the frozen idMap output shape and bloats the schema to 700 entries); a new union node kind (profile is frozen).
**Consequences**: The digest rejects only fields declared by no card/meta schema; per-card type strictness is `apply`'s job (KFR-033, iterations 6/9). Iteration 13's profile doc must describe this.

## D-010: Initial-state choices not fixed by the spec  (Iteration 4)
**Context**: KFR-010 fixes lifecycle, seq, card zones, counters, roster, control, but not card orientation, metadata or meta partitions.
**Decision**: Cards start `face_down` with `metadata: {}`; `meta` has an empty partition `{}` for every declared meta schema (so reducers never see `undefined`); `roster.seats` copy `player`/`team` from the entries only when given (the layout's team is not back-filled); stored counters exclude derived ones; control `pointers` start empty and `direction` is `1`. Roster errors are checked per entry (undeclared seat, duplicate seat, team on teamless seat, team mismatch, duplicate player), then missing seats. `createSession` copies all arrays (never freezes the definition's).
**Rejected**: Omitting meta partitions until first write (reducers need a partition); back-filling team from the layout (spec says roster is built from the entries).
**Consequences**: Iterations 6-10 rely on these initial shapes; a game wanting face-up cards flips them via `setup` actions.

## D-011: Digest internals and derived-counter evaluation  (Iteration 4)
**Context**: Spec fixes `stateDigest(definition, state)`; evaluators need a typed snapshot.
**Decision**: `DerivedEvaluator` takes `Snapshot<SessionState>` (the whole state, including `id`). `stateDigest` builds a view `{lifecycle…, derivedCounters, …}` (omitting `outcome` when absent, never emitting `undefined`) and canonicalizes it with `buildStateSchema(def)`; evaluator throw or non-bigint is a plain `Error` (cause kept), schema misfit is `CanonicalError`. `canonicalStateBytes`, `buildStateSchema` and `definitionDataSchema` stay core-internal (not in the index), keeping the VC-068 export list exact. Meta partition/derived schemas are rebuilt per call (no caching; revisit in iteration 12 performance if needed).
**Rejected**: Exporting the schema builders (breaks VC-068 "exactly"); caching schemas in module state (hidden state).
**Consequences**: Iteration 12 KNFR-003 measures the uncached cost at the floor.

## D-012: maskGates freezes only what it creates  (Iteration 4)
**Context**: `maskGates` runs on already-frozen snapshots and should not walk the whole state.
**Decision**: It builds new `open` gates, `gates` and result objects and `Object.freeze`s just those; everything else is shared by reference (`===`), including `expectedSeats` of open gates and the resolved record.
**Rejected**: `deepFreeze` of the result (needless full walk).
**Consequences**: Callers must pass a fully frozen state (a programmer error otherwise).

## D-013: PRNG module shape and vector generation  (Iteration 5)
**Context**: §6.3 fixes the algorithm; the API surface, error detail and vector tooling were open (no TS runner, no new deps).
**Decision**: `session/prng.ts` exports `Uint32Stream`, `Prng` (alias of `Uint32Stream`), `createPrng`, `uniform`, `shufflePermutation<T>` (generic over the element type, so it works with `CardId`s and plain strings); `seedWords` is exported from the module for the vectors but not from the index. `Prng` is a frozen class instance whose draws return a new instance; the 12 discarded outputs are consumed in `createPrng`. `uniform` throws `RangeError` for non-integer or out-of-range `n`. Seed errors are `MALFORMED_ACTION` with a descriptive `detail` (lone-surrogate index or byte count). Vectors: `generate-prng-vectors.testing.ts` reimplements the algorithm independently (16-bit-limb FNV, modular arithmetic, own UTF-8) and writes `prng-vectors.json` under `UPDATE_GOLDEN=1` (same pattern as D-006); values were also cross-checked once against a Python reference, and `seed-a` is hard-coded in the test.
**Rejected**: Bigint in the generator (would share the technique with the implementation); a standalone script (no TS runner); exposing `seedWords` publicly (not in KFR-080).
**Consequences**: Changing the algorithm changes shuffles (spec §6.3 note) and requires regenerating and re-reviewing the JSON. Iteration 6 may import `shufflePermutation` only from the proposal-side code, never from `apply` (VC-072).

## D-014: Action wire types and validator conventions  (Iteration 6)
**Context**: KFR rows and requirements §5.6.3 fix field names but not numeric types, optional recorded ids, roster op payloads or error paths.
**Decision**: `session/actions.ts` holds snake_case readonly types. Counter `delta`, `amount` and `ratio.num/den` are `bigint` (exact, VC-035 needs > 2^64). `grant_view.grant_id?` and `zone_create.zone_id?` exist so a committed action can record the derived id and replay can feed it back. `control_advance.mode?` accepts only `'until_quiescent'` at shape level (the applier rejects it, iteration 8). `roster` has per-op field tables (`join {player_id, seat_id?, team_id?, zones_to_create?}`, `leave {player_id, seat_id?}`, `substitute {player_id, seat_id?, team_id?}`, `set_status {seat_id, status}`, `delegate {seat_id, grantee_principal, scope?, boundary?}`, `revoke_delegation {seat_id, grantee_principal}`); fields of another op are "unexpected". `lifecycle.to_state` accepts `active|completed|terminated` at shape level so `active->active` is a semantic `MALFORMED_ACTION`. `validateAction(raw, path = '$')` returns a FRESH normalised copy (known fields, JSON payloads cloned) and fails with `path` (`$.field`, `$[i].field` from apply) repeated in `detail`. JSON payloads: safe integers only (no floats/-0/NaN), no lone surrogates in strings or keys, plain objects only, containers deeper than 64 -> `MALFORMED_ACTION` (plan-level decision), counted from each JSON field's own root. Validation reads own data properties only (no getters, no symbol keys).
**Rejected**: numeric `delta` (loses exactness); one permissive roster shape (hides typos); reusing the caller's action objects (would freeze them / alias mutable input).
**Consequences**: Iterations 7-10 implement semantics only; shape is complete for all 15 primitives and 3 macros. `ratio.den > 0` is already a shape rule. Committed actions are copies, never the caller's objects.

## D-015: Player proposal without actingSeat  (Iteration 6)
**Context**: KBR-005 does not say what a `player` proposal with no `actingSeat` means while turns are enforced.
**Decision**: `NOT_YOUR_TURN` (plan-level default), `actionIndex 0`, detail says no acting seat. With `enforceActiveSeats` false nothing is checked. Turn admission runs after lifecycle admission and before shape validation, on the input state.
**Rejected**: Treating a missing seat as "skip enforcement" (a player-origin proposal would bypass turns).
**Consequences**: P6 must always supply `actingSeat` for player proposals.

## D-016: Lifecycle outcome retention and notifications  (Iteration 6)
**Context**: `completed -> terminated` may or may not carry an outcome.
**Decision**: A `lifecycle` with `outcome` stores it (overwriting, `null` is a real outcome); without it the stored outcome is kept and none is added. `SessionEnded.outcome` is the action's own outcome only (absent if the action had none), one notification per committed lifecycle action, `to` = target state. "Lifecycle must be last" is checked on the validated input batch (before any state work), failure at the lifecycle action's index.
**Rejected**: Clearing the outcome on `terminated`; echoing the stored outcome into the notification.
**Consequences**: Hosts reading the final outcome use `state.outcome`; notifications mirror the action.

## D-017: `apply` pipeline structure and working-state API  (Iteration 6)
**Context**: Plan fixes the five stages; file layout, handler contract and freezing strategy were open.
**Decision**: `session/apply/`: `admission` -> `validate-batch` -> `expand` (hook) -> `primitives/index.ts` (`applyPrimitive` switch) -> `conservation` (hook) -> `commit`, orchestrated by `apply.ts`. `WorkingState` is copy-on-write: `card(id)/zone(id)` (own-key reads), `patch(recordKey, id, value|undefined)`, `putCard/putZone`, `replace(member, value)`, `state` view, `commit(seq)`. Everything passed to a write method is `deepFreeze`d immediately (it is new data); the containers the working state copied (top level, each patched record) get a shallow `Object.freeze` at commit, so untouched zones/cards/records keep input references and no full-state walk happens. A handler is `(ctx: ApplyContext, action) => Result<Action>` returning the action to log; `ctx` has `def`, `index` (lazy lookups, `isOrdered`), `work`, `inputIndex`, `position` (slot in the committed list), `seq` (committing seq), `fail(code, detail, path?)` (adds `actionIndex`), `path(suffix)`. Committed entries are `{action, inputIndex}`. Committed `actions` and the result object are deep-frozen; macros expand against `ctx.work` in `expand`.
**Rejected**: Freezing the whole new state with `deepFreeze` (walks reused subtrees, kills KNFR-004); an immer-style proxy (dependency, spec A1); throwing for failures.
**Consequences**: Iteration 7 fills `checkConservation(def, base, final, committed)`; iterations 8-10 add a `case` + file in `primitives/` and replace `expand`'s macro branch. A seq beyond the safe range throws `RangeError` (spec A8).

## D-018: Records keyed by ids such as `__proto__`  (Iteration 6)
**Context**: `__proto__` (and `constructor`, ...) match the id charset; assignment and inherited reads on plain records misbehave (carry-over gap from iteration 4).
**Decision**: Ids stay valid (spec §6.1). Records are guarded instead: `session/records.ts` has `hasOwn`, `getOwn`, `setOwn` (`defineProperty`). All reads of keyed state in `apply` go through own-key lookups; writes use spread with computed keys / `setOwn`, both of which create own data properties. `createSession` and `maskGates` were patched to use `setOwn`. The validator builds JSON objects with `Object.fromEntries`. Tests cover a card and zone named `__proto__` end to end plus unknown `constructor`/`toString` ids.
**Rejected**: Rejecting `__proto__` as an id (deviates from the spec charset); null-prototype records (canonicalize and `toEqual` fixtures expect plain objects).
**Consequences**: New code that reads a keyed record by a caller-supplied id must use `getOwn`/`hasOwn`; direct `record[id] = x` is forbidden for caller ids.

## D-019: `move` check order and unsupported kinds  (Iteration 6)
**Context**: KFR-030 does not order its error cases or cover an unknown `from_zone`.
**Decision**: Order: unknown card (`MALFORMED_ACTION`) -> unknown `to_zone` (`MALFORMED_ACTION`) -> card not in `from_zone`, including an unknown `from_zone` (`CARD_NOT_IN_ZONE`) -> position rules (`MALFORMED_ACTION`, path `.to_position`). A same-zone move to the unchanged slot, an unordered same-zone move (card goes to the end), a `flip` to the current orientation (card `===`) and `set_metadata` with empty `fields` (no write) are valid committed actions. Until their iteration, the kinds `counter_*`, `control_*`, `grant_view`, `revoke_view`, `zone_*`, `roster`, `meta` and the macros fail `MALFORMED_ACTION` "not yet supported" at the input index, after validation.
**Rejected**: `MALFORMED_ACTION` for an unknown `from_zone` (the card is literally not in it; matches requirements §5.6.3).
**Consequences**: Iterations 7-10 replace those placeholders; the "not yet supported" tests in `primitives.test.ts` and `apply.test.ts` must be updated as kinds land.

## D-020: Counter handler semantics  (Iteration 7)
**Context**: KFR-034/035/061 leave order of checks, the shape of errors, `credited > amount` and zero remainders open.
**Decision**: Handlers live in `apply/primitives/counters.ts`; counter lookups use a new lazy `DefIndex.counter(id)`. `counter_transfer` computes the net change per counter id first (aliasing), checks bounds on the final values and writes only if all pass; with `ratio`, `credited = ratioRound(amount, ratio, source mode)` and `remainder = amount - credited`, which is negative when `credited > amount` and is applied as-is (bounds on final values). A zero remainder needs no `remainder_to`; a given `remainder_to` is still validated (exists, not derived). Order: negative amount, endpoints (from, to, remainder_to: unknown or derived), ratio mode, remainder rule, bounds. A ratio on a counter without `rounding` is `MALFORMED_ACTION` at `.ratio`. `counter_adjust`/`counter_transfer` log the original action (replay recomputes `applied`).
**Rejected**: Writing each counter sequentially (transient bound failures on aliasing); logging the computed `applied` (changes the wire shape, KFR-025 wants the action as given).
**Consequences**: Reducers (iteration 9) must re-check bounds themselves; conservation recomputes `applied` with the same helpers (`adjustApplied`, `transferChanges`).

## D-021: Conservation check and supply direction  (Iteration 7)
**Context**: KFR-062 allows net `applied` of supply-role adjusts; it does not say mint must increase or burn decrease.
**Decision**: Per group, `after == before + sum(applied of counter_adjust on members with a supply_role)`; the sign of the adjust is not checked (`mint` may decrease, `burn` may increase) in P1. `counter_transfer` is never supply. `actionIndex` = last input action with a non-zero net change on a group member (zero-delta actions do not count). Runs once, after all actions, only when something was committed.
**Rejected**: Enforcing direction (not required by spec, plan-level decision); counting any touch (a no-op adjust is not a change).
**Consequences**: A later phase can tighten direction without changing the pipeline hook.

## D-022: `max_instances` counts live zones per template  (Iteration 8)
**Context**: KFR-039/Req FR-191 say "a template's `max_instances`"; it is unclear whether the cap is per template or per `(template, owner)`, and whether destroyed instances count.
**Decision**: `ZONE_LIMIT` when the number of LIVE zones whose `template` equals the template (all owners together) is already `>= maxInstances`. Destroyed zones stop counting (VC-041: after destroying ordinal 1 the next create succeeds as ordinal 3). Check order in `zone_create`: template, owner, `zone_id`, id length, collision (all `MALFORMED_ACTION`), then limit. An over-long derived id is reported at `.owner`, a collision at `.template`.
**Rejected**: Per `(template, owner)` cap (not what "a template's" says; can be adopted later without touching ordinals); counting ordinals ever issued (contradicts VC-041).
**Consequences**: The default fixture `hand` (seat rule, max 1) allows one hand in total. P2 compiler docs should state the cap is per template.

## D-023: `nextZoneId` signature and committed index for grants  (Iteration 8)
**Context**: KFR-049 gives `nextZoneId(state, template, owner, pending = 0)`; owner is absent for `none` templates and the id may be too long. Grant ids need the committed-list index.
**Decision**: `nextZoneId(state, template, owner?, pending = 0): ZoneId` lives in `session/zone-ids.ts` with `deriveZoneId`/`ordinalKey`/`ownerToken`; only `nextZoneId` is exported. It validates nothing (unknown template/owner, length > 128 are left to `zone_create`). Handlers read the committed index from the existing `ctx.position` (no new API) and the committing seq from `ctx.seq`; grant id = `grant/${seq}/${position}`. `ordinalKey` is `<template>/<ownerToken>`.
**Rejected**: `Result<ZoneId>` return (VC-050 uses the plain id inside a batch literal); a separate committed-index parameter on handlers (already in context).
**Consequences**: Replaying a committed list as ONE batch reproduces grant ids (positions are identical); replaying it split across batches would not.

## D-024: Control validation details  (Iteration 8)
**Context**: KFR-036/037 leave pointer-name validation, duplicate active seats and an off-order cursor open.
**Decision**: `control_set` does not check `pointer.name` against `control.pointerNames`, does not reject duplicate or empty `active_seats` (only existence), and a `control_set` with no named field is a valid no-op that logs the action. `control_advance` rejects a cursor seat that is not in `turnOrder` (`MALFORMED_ACTION`). `direction` stays a shape-level rule (enum `1|-1`). A seat "exists" when it is a key of `state.roster.seats`.
**Rejected**: Enforcing `pointerNames` (spec names no error for it; tests use `button` while the fixture declares `dealer`); rejecting duplicate active seats (not in KBR-008).
**Consequences**: Tighten in P2/P6 if the compiler wants pointer-name enforcement.

## D-025: `Reducer<S>` home and definition reducer types  (Iteration 9)
**Context**: Iteration 3 typed reducers with a `never`-parameter placeholder; iteration 11 must export the SPI `Reducer<S>` without duplicating it.
**Decision**: `type Reducer<S> = (partition: Snapshot<S>, payload: unknown) => S` lives in `session/reducer.ts` and is exported (type) from `core/session`; iteration 11's `spi` re-exports it. `MetaSchemaDecl.reducer?: Reducer<JsonValue>` and `rosterReducer?: Reducer<RosterState>`; `PartitionReducer` is deleted. A meta reducer's payload is the action `payload`; a roster reducer's payload is the whole roster action (it needs `op`).
**Rejected**: A per-schema generic on the definition (a single heterogeneous list needs one value type); passing only `payload` fields to the roster reducer (loses the op).
**Consequences**: Builders in tests must give typed reducers (`<S>(p: S) => p`); the SPI must not redeclare the type.

## D-026: Reducer validation pipeline and roster output shape  (Iteration 9)
**Context**: KFR-050 lists the checks but not their mechanics; a reducer only receives its partition, so "writing elsewhere" can only happen through casts or captured references.
**Decision**: `invokeReducer` (1) deep-freezes the payload, (2) calls the reducer in try/catch (any thrown value is `REDUCER_ERROR`), (3) copies the return into detached plain data (cycles, depth > 80, accessors read once), (4) `canonicalize`s the copy under the partition's canonical schema (meta: declared fields via `metaPartitionNode`; roster: `rosterNode`, both exported from `state-schema.ts`), (5) runs a shape check (roster: declared seats only, valid status, unique players, declared teams), (6) compares every other top-level member of the working state by reference, (7) deep-freezes the copy. The caller writes it and runs `recheck`. Frozen inputs make casts that mutate state throw, which is `REDUCER_ERROR`. A roster that omits a declared seat is allowed unless control/delegations/gates still name it (KBR-008).
**Rejected**: Freezing the reducer's own object in place (aliasing and getters); requiring every declared seat in the roster output (not in KFR-014 for reducers).
**Consequences**: An unchanged seat entry returned by a roster reducer is re-created (no `===` inside the roster); the `roster` member is always a new reference after a roster op.

## D-027: Whole-state invariant re-check and engine action rules  (Iteration 9)
**Context**: KBR-010 requires structural rules and counter bounds after every reducer; KFR-051 gives an error table with open edge cases.
**Decision**: `findInvariantViolation(def, state)` walks the whole state (KBR-001, KBR-006 template/owner rule/max, KBR-007, KBR-008 incl. every seat named by control, delegations and gates, stored-counter bounds) and runs only after reducer outputs, not after primitives (their handlers keep the invariants by construction). Engine payloads must have exactly the listed fields. Order: unknown gate `MALFORMED_ACTION`, then resolved `GATE_CLOSED`, then (submit) seat not in `expectedSeats` `GATE_CLOSED` (also for a non-existent seat) or (retract) no submission `MALFORMED_ACTION`. `gate_open` with an id already open or resolved, or an invalid GateId, is `MALFORMED_ACTION`. `engine.*` always goes to the engine reducers even if a definition registered the name (structure check normally prevents it).
**Rejected**: Running the whole-state check after every primitive (KNFR-003 cost); `GATE_CLOSED` for retract of a never-submitted seat (spec says `MALFORMED_ACTION`).
**Consequences**: A reducer can never leave a state that fails `findInvariantViolation`; iteration 12 properties can reuse it.

## D-028: Macro position semantics and unordered targets  (Iteration 10)
**Context**: KFR-045 says an unordered `to_zone` gets no position but `draw` may carry `to_position`; zone_merge/reset_to_zone say "positions as draw".
**Decision**: Every macro move into an ordered `to_zone` carries `base + i` (`base` = macro `to_position` for `draw`, else the working length of `to_zone` at expansion time; `reset_to_zone` continues the running index across source zones). For an unordered `to_zone` no move carries a position and a macro `to_position` is ignored. An out-of-range `to_position` fails in the generated `move` as `MALFORMED_ACTION` at the macro's input index with path `$[i].to_position`. `EMPTY_ZONE` is reported with path `$[i].count`.
**Rejected**: Rejecting `to_position` for an unordered target (the spec only says no position is emitted); validating bounds in the expander (single source of truth is `move`).
**Consequences**: Macro expansion is a pure read of the working state; all placement checks stay in `move`.

## D-029: Macro edge-case rejections  (Iteration 10)
**Context**: The plan fixes draw-unordered, merge src = dst and reset with `to_zone` in `zones`; unknown zones and duplicate `zones` entries are unspecified.
**Decision**: Unknown zones, `draw` from an unordered zone, `draw`/`zone_merge` with equal zones, non-template `zone_merge` zones, `reset_to_zone` listing `to_zone` or a repeated zone are `MALFORMED_ACTION` with the offending field path (`zones[i]` for lists), checked in that order (unknown, same-zone, kind rules) and before `count`/`EMPTY_ZONE`. `draw count 0` still validates zones first. An empty `zones` list is a valid no-op.
**Rejected**: Silently deduplicating `zones` (hides caller bugs; a repeat would otherwise fail later with a confusing `CARD_NOT_IN_ZONE`).
**Consequences**: A malformed macro never reaches `move`.

## D-030: `reset_to_zone` flips and `zone_merge` ordering  (Iteration 10)
**Context**: KFR-047 flips "every card face-up at the start"; the plan limits it to cards the macro moved.
**Decision**: Orientation is read from the working state at expansion time; flips (to `face_down`, in move order) are emitted only for moved cards that were `face_up`; cards already in `to_zone` are neither moved nor flipped. `zone_merge` emits moves in `src` membership order then `zone_destroy(src)`; it does not require src/dst to share a template or owner.
**Rejected**: Flipping every face-up card of the zones including `to_zone` residents.
**Consequences**: All primitives of a macro share the macro's input index; the committed list never contains macro kinds.

## D-031: SPI verdict, effect and proposal shapes  (Iteration 11)
**Context**: A4 names `Accept`, `Reject`, `Allow`, `Deny`, `Effect`, `Proposal<K>` but gives no fields; KFR-090 fixes only `Effect.timer_request{id, kind, duration_hint}`.
**Decision**: `Accept {accepted: true}`; `Reject {accepted: false; rejection: GameRejection}`; `Allow {allowed: true}`; `Deny {allowed: false; code: ErrorCode; detail?}`; `Effect = {type: 'timer_request'; id: string; kind: string; duration_hint: number}` (milliseconds, a host hint; discriminant is `type` because `kind` is taken by the timer kind); `Proposal<K extends string> {kind: K; payload: unknown}`. `Principal = string`; `AuthOp` is the KFR-112 template-literal union; `AuthTarget {sessionId; seat?}`. These live in `spi` so `AuthorizationHook` and `AuthorizationPort` share them (`ports` imports `spi`, never the reverse).
**Rejected**: `ok`/`error` discriminants (clash with `Result`); a branded `Principal` (no id grammar in the spec); more effect kinds (spec lists only `timer_request`).
**Consequences**: Games and adapters narrow on `accepted`/`allowed`/`type`. Adding an effect kind later is a union extension.

## D-032: Hook context shapes  (Iteration 11)
**Context**: A4 gives the `ValidationHook` ctx and the `GateResolveHook` ctx exactly, but `ReactionHook` takes an unnamed `ctx`.
**Decision**: `ValidationContext<K> {snapshot: GateMaskedSnapshot; proposal; actor {actingSeat; onBehalfOf?}; signal: AbortSignalLike}` and `GateResolveContext {sealed; missing}` follow A4 verbatim (no `signal` in the latter; the runner receives it separately). `ReactionContext {snapshot: GateMaskedSnapshot; committed: readonly Action[]; signal}`; `ReactionResult {actions: readonly (Action|Macro)[]; effects: readonly Effect[]}`. Hook result arrays are `readonly`.
**Rejected**: Giving reaction hooks the unmasked `SessionState` (would expose sealed submissions); adding `signal` to the gate ctx (departs from A4).
**Consequences**: Iteration 12/phase 2 hook runners build contexts from `maskGates` output.

## D-033: SPI re-exports and where the types live  (Iteration 11)
**Context**: `Reducer<S>` (D-025), `Action`, `Macro`, `GateMaskedSnapshot`, `SealedBySeat` are defined in `session`.
**Decision**: `spi/index.ts` re-exports them with `export type {…} from "../session/index.js"` (no redefinition); the new types are in `spi/types.ts`. The iteration-9 reducer step already used `Reducer<S>` from `session/reducer.ts`, so nothing changed there. Root `export *` of both `session` and `spi` is allowed because both names resolve to one declaration.
**Rejected**: Moving `Action`/`Macro` into `spi` (session needs them, and `spi` would then be imported by `session`).
**Consequences**: `spi` depends on `session`, `errors` only; the emitted `spi` JS is `export {};` per file.

## D-034: Port payload types  (Iteration 11)
**Context**: KFR-110/111 name `Transaction`, `Receipt`, `OutboxRow`, `Lease`, `CommitResult` but leave fields open; A6 gives the SQL columns.
**Decision**: `Transaction {seq: Seq|null; eventId; principal; actions: readonly Action[]}` (the `transactions` + `actions` rows; `seq = null` is the empty accepted batch, `actions` empty). `Receipt {fingerprint; result: JsonValue|null; errorCode: ErrorCode|null; seq: Seq|null; detail: JsonValue|null; privileged: boolean}` (the `receipts` columns minus the key `(sessionId, principal, eventId)`, which `commit`, `record` and `lookup` pass separately). `OutboxRow {id; sessionId; seq: Seq|null; kind: 'commit'|'timer_request'; payload: JsonValue}`; `id` is chosen by the caller. `Lease {sessionId; epoch: number}`. `CommitResult = Result<{seq: Seq|null}, StaleWriterError>` with `StaleWriterError = EngineError & {code: 'STALE_WRITER'}`: a stale writer is a returned value, infrastructure faults reject the promise. `committed_at` and `published_at` are deliberately absent (KBR-013; adapters own operational metadata, and VC-094's static check stays trivially true).
**Rejected**: Putting the key into `Receipt` (duplicate source of truth); `Promise<void>` plus a thrown error for `STALE_WRITER` (the spec calls it transient and typed).
**Consequences**: An SQLite adapter maps these 1:1 to the A6 schema; `OutboxRow` drain bookkeeping is the adapter's.

## D-035: `load`, `list`, `HookRunner` and `Publisher` payloads  (Iteration 11)
**Context**: KFR-110 gives only the call shapes of `load(sessionId, atSeq?)`, `list()`, `run(hook, ctx, signal) → result`, `publish(committedTx)`.
**Decision**: `load` resolves `StoredSession {sessionId; definitionId; definitionHash; schemaVersion; initial: Snapshot<SessionState>; seq; log: readonly Transaction[]}` or `null` for an unknown session; `initial` is the `createSession` state at seq 0 and `log` is truncated to `atSeq` (replay = `initial` + `log`). `list` resolves `readonly SessionSummary[] {sessionId; definitionId; lifecycle; seq}`. `HookRunner.run<C, R>(hook: (ctx: C) => Promise<R>, ctx: C, signal): Promise<Result<R>>`; failures are `HOOK_ERROR`/`HOOK_TIMEOUT` values. `Publisher.publish(CommittedTransaction {sessionId; transaction})`. `commit`'s `expectedSeq` is `Seq` (a stored session always exists at seq 0); there is no creation method in P1.
**Rejected**: A `config` blob in `StoredSession` (`createSession` takes no params, spec 0.4); returning `Result` from `load` (absence is not an error).
**Consequences**: Session creation and a `DefinitionRegistry` port are left to the adapter/application phase.

## D-036: How the dist-reading tests get a build  (Iteration 11)
**Context**: VC-081/085/095 inspect `packages/core/dist`, which is not committed.
**Decision**: One test file, `src/dist-output.test.ts`, reads `dist/{spi,ports}` (`.js` and `.d.ts`) with `node:fs` (allowed in `*.test.ts`). `pnpm test` already runs `pnpm build` first; if dist is missing the file throws "run `pnpm build` first" at collection time (a failing, not skipped, suite). Comments are stripped before token checks because tsc keeps TSDoc in the output.
**Rejected**: A vitest `globalSetup` that shells out to `tsc` (second build path, spawns a process from tests); skipping when dist is absent (silent pass).
**Consequences**: Plain `pnpm exec vitest run` needs a prior `pnpm build`.
