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
