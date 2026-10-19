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
