# Domain kernel

The domain kernel is the part of the engine that decides what a legal state change is. It lives in `packages/core` (`@cge/core`) and is a pure, synchronous, deterministic function: given a game definition, a session state and a batch of actions, it returns either the next state, committed atomically, or an error and no change at all. Every state has a canonical, byte-stable digest.

Nothing in the kernel performs I/O, reads a clock, draws randomness or runs game code. That is what makes replay, forking, conformance testing and cross-process digest comparison possible: the same inputs give the same bytes anywhere.

This page explains what the kernel is for, how to call it, what it guarantees and why it is built the way it is. The exact byte format of digests is in [canonical-json-profile.md](./canonical-json-profile.md); where each folder sits in the workspace is in [workspace-architecture.md](./workspace-architecture.md).

## What it provides

| Capability | Entry points |
|------------|--------------|
| Typed identifiers | `SessionId`, `CardId`, `ZoneId`, `SeatId`, `CounterId`, ... and their guards and constructors |
| Immutable state | `SessionState`, `Snapshot<T>`, `deepFreeze` |
| Starting a session | `createSession(definition, sessionId, roster)` |
| Changing state | `apply(definition, state, batch, options?)` |
| Identity of a state | `stateDigest(definition, state)`, `canonicalize`, `sha256Hex` |
| Randomness as data | `createPrng`, `uniform`, `shufflePermutation` |
| Game data model | `CompiledGameDefinition` and `assertDefinitionStructure` |
| Compiling and identifying a definition | `compileDefinition`, `definitionContentHash`, `hookBundleHash`, `computeDefinitionId` (see [game-definitions.md](./game-definitions.md)) |
| Rule extension points (types only) | `core/spi`: hooks, reducers, effects |
| Infrastructure contracts (types only) | `core/ports`: store, ledger, authorization, lease, publisher, timers, definition registry |
| Helpers | `validateAction`, `maskGates`, `nextZoneId`, `ratioRound` |
| Projecting state for a viewer | `projectView`, `projectDelta`, `projectLogEntry`, `wouldReveal`, `buildRoleRegistry`, `validateViewer` (see [visibility.md](./visibility.md)) |
| Replay packages | `encodePackage`, `decodePackage`, `buildPackage`, `decodeCanonical` (see [replay-package.md](./replay-package.md)) |
| Replaying and forking | `rebuild`, `advance`, `createReplayer`, `forkFromSeq`, `PACKAGE_UPGRADERS`, `assertUpgraderChain` |

The kernel does not parse YAML, run hooks, store anything or talk to a network. It defines the data types and the transition function those layers are built on. The definition compiler (`compileDefinition`) and the identity hashes are part of `@cge/core` because they are pure; reading files, parsing YAML, bundling hooks and loading definitions from disk live in `@cge/config` (see [game-definitions.md](./game-definitions.md)).

## Using it

The examples assume `import { ... } from "@cge/core"` (inside the workspace, tests use relative imports of `src/index.ts`). Ids are branded strings, so they are built with constructors that return a `Result`. The helper below is used throughout; production code branches on `ok` instead.

```ts
import {
  apply, cardId, counterId, createPrng, createSession, seatId, sessionId,
  shufflePermutation, stateDigest, validateAction, zoneId,
} from "@cge/core";
import type { CompiledGameDefinition, Result } from "@cge/core";

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`);
  return result.value;
}
```

### A definition

A `CompiledGameDefinition` is plain data plus three kinds of function-valued members (derived-counter evaluators, meta reducers, a roster reducer). Real definitions come from `compileDefinition` applied to a parsed `game.yaml` ([game-definition-schema.md](./game-definition-schema.md)); the compiler installs the derived-counter evaluators and records reducers only by name (`reducerRef`, `rosterReducerRef`). The examples on this page build a definition in code instead:

```ts
const deck = must(zoneId("deck"));
const hand = must(zoneId("hand"));
const north = must(seatId("north"));
const score = must(counterId("score"));
const cards = ["c1", "c2", "c3"].map((id) => must(cardId(id)));

const definition: CompiledGameDefinition = {
  gameId: "demo",
  roles: [],
  schemaVersion: 1,
  cards: cards.map((id) => ({
    id,
    metadataSchema: {},
    startingZone: deck,
    initialMetadata: {},
    metadataVisibility: {},
  })),
  zones: [
    { id: deck, ordered: true, visibility: {} },
    { id: hand, ordered: true, visibility: {} },
  ],
  zoneTemplates: [],
  counters: [
    { id: score, owner: "table", min: 0n, initial: 0n, visibility: {} },
  ],
  conservationGroups: [],
  seats: [{ id: north }],
  teams: [],
  viewKeys: ["public"],
  control: {
    phases: ["play"],
    initialPhase: "play",
    turnOrder: [north],
    initialActiveSeats: [north],
    pointerNames: [],
    enforceActiveSeats: false,
    outOfTurnKinds: [],
  },
  metaSchemas: [],
  policies: { cascadeCap: 16, costBudgets: {} },
  hookBindings: {},
};
```

`assertDefinitionStructure(definition)` returns the first structural violation (duplicate ids, a card without a starting zone, a counter whose initial value is outside its bounds, a turn order that is not a permutation of the seats, a reserved `engine.` meta schema, and so on). `createSession` runs it first, so a broken definition never reaches `apply`.

### Creating a session and applying a batch

```ts
const start = must(
  createSession(definition, must(sessionId("table-1")), [{ seat: north }]),
);
// start.seq === 0, start.lifecycle === "active", all cards in "deck"

const batch = [
  must(validateAction({ kind: "draw", from_zone: "deck", count: 2, to_zone: "hand" })),
  must(validateAction({ kind: "counter_adjust", counter_id: "score", delta: 5n })),
];
const result = must(apply(definition, start, batch));

result.state.seq;                        // 1: one batch, one sequence step
result.committed.map((a) => a.kind);     // ["move", "move", "counter_adjust"]
result.state.zones[hand]?.members;       // ["c1", "c2"]
```

Three things to notice:

- The roster is validated against the definition's seat layout: exactly one entry per declared seat, matching teams, no duplicate players.
- The batch is a list of **actions and macros**. `draw` is a macro; the committed list contains only the primitives it expanded to (`move`, `move`), never the macro. Replay applies the committed list.
- `validateAction` turns an untrusted object into a typed, normalised action or a `MALFORMED_ACTION` error with the offending field `path`. `apply` re-validates every action it receives, so passing hook output or wire data straight in is safe.

A state is exposed as `Snapshot<SessionState>`: a deep-readonly type, and also deep-frozen at runtime. Writing through it is a compile error, and a cast-away write throws in strict mode.

### The digest

```ts
stateDigest(definition, start);          // 64 lower-case hex characters
stateDigest(definition, result.state);   // differs from the line above
```

The digest covers the whole logical state, including counters computed by derived-counter evaluators, and excludes the session `id`. Two states with the same content have the same digest regardless of how their records were built. It is the identity used for replay comparison, idempotent snapshots and fork checks.

### Failure and atomicity

```ts
const tooMany = apply(definition, result.state, [
  must(validateAction({ kind: "draw", from_zone: "deck", count: 5, to_zone: "hand" })),
]);
// { ok: false, error: { code: "EMPTY_ZONE", detail: "zone deck holds 1 cards, cannot draw 5",
//                       actionIndex: 0, path: "$[0].count" } }
```

When any action in a batch fails, the whole batch is discarded: the input state is the same reference, with the same digest, still frozen, and no partial result is observable.

### Randomness is data

`apply` never draws random numbers. A shuffle is an ordinary action that carries the permutation it produces; the permutation is computed by the proposing side from a seeded PRNG and logged. Replay therefore never re-randomises.

```ts
const prng = must(createPrng("seed-a"));
const { permutation, next } = shufflePermutation(prng, cards);   // next: stream for later draws
const shuffled = must(
  apply(definition, start, [{ kind: "shuffle", zone: deck, permutation }]),
);
shuffled.state.zones[deck]?.members;     // equals `permutation`
```

A `Prng` is an immutable `Uint32Stream`: every draw returns `{ value, next }` and leaves the original untouched, so a stream can be forked and replayed. `createPrng(seed)` accepts any string up to 256 UTF-8 bytes (an over-long seed or one with a lone surrogate is a `MALFORMED_ACTION` error). `uniform(stream, n)` returns an unbiased integer in `[0, n)` using rejection sampling; `n` must be an integer in `[1, 2^32]`, otherwise it throws (a programmer error). `shufflePermutation` is a Fisher-Yates shuffle over `uniform`. The algorithm (128-bit FNV-1a seed mix, then sfc32 with 12 discarded outputs) is fixed and covered by committed vectors in `packages/core/src/session/prng-vectors.json`; changing it would change shuffles, though never replay.

### Proposal options

`apply` takes an optional fourth argument describing where the batch came from, used for admission rules:

```ts
apply(definition, state, batch, {
  proposal: { origin: "player", kind: "move", actingSeat: north },
});
```

With a `proposal`, the turn rule applies: when the definition sets `enforceActiveSeats`, a `player` proposal whose acting seat is not among the input state's active seats fails with `NOT_YOUR_TURN`, unless its kind is listed in `outOfTurnKinds`. A `player` proposal without an `actingSeat` is also `NOT_YOUR_TURN`. Without a `proposal` (replay, direct host application, hook-produced batches) turn enforcement is skipped; the lifecycle rule always applies.

## The action set

Primitives (these are what the log contains): `move`, `flip`, `shuffle`, `set_metadata`, `lifecycle`, `counter_adjust`, `counter_transfer`, `control_set`, `control_advance`, `zone_create`, `zone_destroy`, `grant_view`, `revoke_view`, `roster` (`join`, `leave`, `substitute`, `set_status`, `delegate`, `revoke_delegation`) and `meta`.

Macros (expanded before commit): `draw`, `zone_merge`, `reset_to_zone`. Expansion is sequential over a working copy of the state, so a macro sees everything earlier actions in the same batch did.

`meta` actions with a schema id starting `engine.` are handled by the engine's own reducers: `engine.gate_open`, `engine.gate_submit`, `engine.gate_retract`, `engine.gate_resolve`, `engine.grant_expire`, `engine.grant_consume`. The `engine.` namespace is reserved: a definition that registers a reducer for it is rejected. Housekeeping actions such as `engine.grant_expire` are applied like any other logged action; `apply` never generates them.

Behaviours worth knowing before writing a caller:

- **Positions.** Position 0 is the top of an ordered zone (`members[0]`). A same-zone `move` reads its position after the card is removed. Unordered zones append and take no position.
- **Counters** are exact `bigint`s checked against `min` and `max` inclusive. With a `ratio`, amounts are rounded with the counter's declared mode (`floor`, `half_up`, `half_even`). `scale` is descriptive and never enters arithmetic. `counter_transfer` credits the target and sends any rounding remainder to `remainder_to`; a transfer between counters that alias computes the net change first and checks bounds on the final values.
- **Conservation groups** are checked once at the end of the batch, so a transient imbalance between two actions is legal. A group's sum may change only through `counter_adjust` on a member with a `supply_role`. The direction of mint and burn is not enforced.
- **Zone templates.** Zone ids are derived as `<template>/<ownerToken>/<ordinal>` (`ownerToken` is the owner id, or `_` for an ownerless template) and are never reused. `maxInstances` counts the live zones of a template across all owners. `nextZoneId(state, template, owner, pending)` returns the id a `zone_create` will receive, so later actions in the same batch can target it.
- **Grants** get the id `grant/<seq+1>/<i>`, where `i` is the index in the committed primitive list; replaying the committed list as one batch reproduces ids. The kernel stores and expires grants; what a grant reveals is decided when a view is projected (see [Projection](#projection)). Only single-card, single-zone and top-of-zone targets are accepted.
- **Roster reducers.** `join`, `leave`, `substitute` and `set_status` are handled by a reducer the definition supplies; the kernel validates its output. A roster reducer receives the whole `roster` action as its payload and may only return a new `roster` partition. Without a roster reducer these four operations are `MALFORMED_ACTION`, unless the definition declares one by name (`rosterReducerRef`) that is not bound yet, which is `REDUCER_ERROR`. `delegate` and `revoke_delegation` need no reducer.
- **Control.** `control_advance` walks the turn order, counting only seats whose status is `seated`; `mode: "until_quiescent"` is not supported. `control_set` validates phase and seats but does not check pointer names against the declared names.
- **Lifecycle.** `active -> completed`, `active -> terminated` and `completed -> terminated` are the only transitions. A `lifecycle` action must be the last action of its batch. On a `completed` session the only admitted batch is exactly `[lifecycle(terminated)]`; on a `terminated` session every batch, including `[]`, fails with `SESSION_ENDED`. A successful result carries one `SessionEnded` notification per lifecycle action; the final outcome is also readable from `state.outcome`.
- **Empty batches.** On an active session, `[]` (or macros that expand to nothing) succeeds, returns the input state itself and does not advance `seq`.

## The error model

Every failure is an `EngineError`: `{ code, detail, actionIndex?, path? }`, returned in a `Result`, never thrown for anything a caller can trigger.

| Field | Meaning |
|-------|---------|
| `code` | One of 24 codes in the exported union `ErrorCode` (runtime list `ERROR_CODES`) |
| `detail` | A human-readable message that names the offending entity id where one exists |
| `actionIndex` | Zero-based index into the **input** batch. Present on `apply` errors only |
| `path` | The offending field of a malformed action, such as `$[2].to_position`; also repeated in `detail` |

`actionIndex` rules:

- It is the index of the input action that failed. A macro's primitives all report the macro's own index.
- A `meta` or `roster` reducer failure reports the index of that action.
- A conservation failure (checked at the end of the batch) reports the last input action whose expansion changed a member of the violated group.
- Failures that precede any action (ended-session admission, turn enforcement) report `0`.
- Errors from `createSession`, `createPrng`, `assertDefinitionStructure` and the id constructors have no `actionIndex`.

Codes the kernel raises: `MALFORMED_ACTION` (bad shape, unknown id, illegal parameter), `CARD_NOT_IN_ZONE`, `EMPTY_ZONE`, `COUNTER_BOUNDS` (also for a broken conservation group), `ZONE_LIMIT`, `GATE_CLOSED`, `REDUCER_ERROR`, `NOT_YOUR_TURN`, `SESSION_ENDED`. The remaining codes (`IDEMPOTENCY_CONFLICT`, `STALE`, `STALE_WRITER`, `UNAUTHORIZED`, `FORBIDDEN`, `UNKNOWN_ROLE`, `UNKNOWN_SUBJECT`, `SUBJECT_NOT_ALLOWED`, `VIEW_DENIED`, `NOT_READY`, `REPLAY_INVALID`, `REPLAY_MISMATCH`, `HOOK_ERROR`, `HOOK_TIMEOUT`, `CASCADE_LIMIT`) are declared so the layers above can use one taxonomy; the kernel never raises them. Game-defined rejections use `GameRejection { code: string; detail? }`, a separate type with an opaque code.

What can still throw is limited to programmer errors: an invalid argument to `uniform`, a `den <= 0` ratio passed straight to `ratioRound`, a derived-counter evaluator that throws or returns a non-`bigint` while a state is digested, and a session whose `seq` would pass `Number.MAX_SAFE_INTEGER`.

## Guarantees

**Purity.** The result of `apply` is a function of `(definition, state, batch, options)`. It does not read the clock, randomness, the environment or the network; `Date`, `Math.random` and `performance.now` can be replaced by throwing stubs without effect. No wall-clock value appears in a state or in `apply`'s inputs and outputs.

**Atomicity.** A failing batch leaves the input untouched (same reference, same digest, still frozen). This is exercised by property tests over random legal and illegal batches covering every primitive, macro and `engine.*` action.

**Immutability.** Every object and array reachable from a committed state is frozen, in every build mode. `bigint` values are held as they are. The caller's own action objects are never frozen or retained; committed actions are fresh copies.

**Structural sharing.** `apply` copies only the path that changed. Every zone, card, counter record and partition that no committed action wrote is the same reference (`===`) as in the input state; every one that was written has a new reference. Unwritten data is therefore cheap to compare and share.

**Determinism.** Applying the same stream twice, from the same definition and initial state, gives identical committed actions and identical digests at every step, in the same process, in two processes and in the Docker `test` image. Replaying the committed lists of a successful run reaches the same digest at every step as the live run.

**Invariants.** After every action the structural rules hold: every card is in exactly one zone; moves name a card actually in its source zone with an in-bounds position; shuffles are exact rearrangements; template zones are destroyed only when empty and respect their limit; gates take submissions only from expected seats while open; control values come from the declared phases and existing seats; counters stay within bounds. After a reducer returns, the whole state is re-checked, so a reducer cannot bypass validation.

**Scale.** The kernel has no hard-coded limit below 14 seats, 4 teams, 700 cards and 64 zones. At that size a 20-move batch applies in well under a millisecond and a digest takes a few milliseconds on a developer machine, far below the regression bounds the test suite enforces (50 ms and 250 ms under Docker).

## Architecture

### Package layout

`packages/core/src` is organised by concern, and every folder re-exports through its `index.ts` and the package root:

| Folder | Role |
|--------|------|
| `errors/` | `ErrorCode`, `EngineError`, `GameRejection`, `Result` |
| `session/` | ids, snapshots, state types, `createSession`, `apply`, PRNG, action validation, `maskGates`, `nextZoneId`, `ratioRound` |
| `definition/` | `CompiledGameDefinition`, `assertDefinitionStructure`, `definitionData`, the compiler (`compileDefinition`, `definitionNeedsBundle`, error codes and limits) and the identity hashes |
| `replay/canonical/` | canonical JSON, `decodeCanonical`, schemas, SHA-256, `stateDigest`, golden vectors |
| `replay/` | the replay package, `Replayer`, `Forker`, the version upgrade chain |
| `visibility/` | roles, visibility policy, `projectView`, `projectDelta`, `wouldReveal`, the branded `View`/`Delta` and opaque `PrivilegedBatch` |
| `spi/` | rule SPI types |
| `ports/` | port interfaces |
| `util/` | internal helpers (UTF-8 encoder), not exported |

### Projection

`apply` works on the omniscient state. Nobody outside the engine receives it: `core/visibility` turns it into role-scoped values. The full reference, with the entitlement model and worked examples, is [visibility.md](./visibility.md); the shape of it is:

- `projectView(def, state, viewer)` returns a `View`, `projectDelta(def, pre, post, batch, viewer)` the `Delta` one committed transaction means for that viewer, `projectLogEntry` the same value for the role-filtered log, and `wouldReveal(def, pre, post, batch, grantee?)` the `once` grants that transaction consumes. A viewer is `{role, subject?}`; unknown roles and subjects, and privileged roles (`dealer`, `auditor`) the definition does not register, are errors, never a default view.
- **Fail closed.** An absent `visibility` declaration hides the entity. Grants only add entitlement. The types back this up: a `Snapshot` cannot be passed where a `View` is expected (both `View` and `Delta` are branded and only the projector makes them), and a transaction crosses into projection as an opaque `PrivilegedBatch` that only the projector and the replayer can open, enforced by a dependency rule.
- Projection is pure and total over valid input: no clock, no randomness, no I/O, no mutation. Edge nodes that fold the log with `advance` produce exactly the views the committing node does.
- **Derived counters.** A derived counter that declares its own visibility is governed by it even over a hidden input zone; one that declares none inherits the `zone_count` entitlement of its input zone.

### Replay

`core/replay` rebuilds states from a recorded log and never runs a hook. The reference is [replay-package.md](./replay-package.md); in short:

- A **replay package** (canonical JSON, language-agnostic) carries the definition binding, the initial state, the log of committed primitive transactions, the receipts and optional digests. `encodePackage` and `decodePackage` write and read it; `buildPackage` assembles one from a stored session.
- `rebuild(resolved, pkg, opts?)` binds the package to the definition (`REPLAY_MISMATCH` on any difference), checks the initial state, folds the log through `apply` without a proposal and verifies recorded digests. `uptoSeq` replays a prefix; `verify: "every"` reports a digest per step. Shuffles use their logged permutation, so replay never consults the PRNG. A reducer that is not bound is `REPLAY_INVALID`, never skipped. The live digest equals the replay digest at every `seq`; that is the property the kernel's determinism exists to make true.
- `advance(resolved, state, batch)` is one step of `rebuild` for edge caches; `forkFromSeq(resolved, pkg, n, {sessionId})` makes a new session from the first `n` transactions. A fork and its original share a digest at every common `seq` because the digest excludes the session id.
- **Old packages keep replaying.** A package recorded under an older `action_schema_version` is upgraded over its raw JSON by an ordered, append-only chain of `PackageUpgrader`s; an unsupported version is `REPLAY_MISMATCH`, never silently misread.

### The `apply` pipeline

`apply` runs five stages and any failure returns before the next one:

1. **Admission** on the input state: the ended-session table (`SESSION_ENDED`), then turn enforcement (`NOT_YOUR_TURN`). These look only at the input state and the proposal.
2. **Shape validation** of every input action, whole batch first. Malformed input is reported with its index before any state work. This is also where payload depth is capped (64 levels) and the lifecycle-must-be-last rule is checked.
3. **Expansion and application**, one input action at a time over a **working state**: macros expand against the working state (so they see earlier effects), then each resulting primitive is validated and applied. Reducers run here, and their output is validated and re-checked.
4. **End-of-batch conservation** over the working state, once.
5. **Commit**: `seq + 1`, freeze the new objects, build the committed list and notifications.

The working state is copy-on-write over the frozen input. Anything written into it is frozen immediately; containers copied along the way are shallow-frozen at commit. No stage walks the whole state, which keeps unchanged data shared and the cost proportional to what changed.

Handlers are small functions `(context, action) -> Result<Action>` returning the primitive to log. Each primitive lives in its own file under `session/apply/primitives/`; the table of known fields per action kind (`FIELDS` in `action-validate.ts`) is the single source of truth for shapes.

Keyed collections in state are plain records, not `Map`/`Set`, so canonicalisation is total. Ids such as `__proto__` are valid under the id charset, so the kernel reads and writes records only through own-property helpers (`hasOwn`, `getOwn`, `setOwn`). Code that reads a keyed record by a caller-supplied id must do the same.

### Reducers

A reducer is `(partition, payload) => S`, synchronous. A compiled definition names its reducers (`reducerRef` on each meta schema, `rosterReducerRef`) and the function itself is bound onto the definition value before `apply`; a `meta` action for a declared schema whose function is not bound, and a `roster` operation when `rosterReducerRef` is declared but unbound, fail with `REDUCER_ERROR` (`reducer not bound: <ref>`), while an undeclared `schema_id` stays `MALFORMED_ACTION`. A `meta` reducer owns `state.meta[schema_id]` and receives the action's payload; the roster reducer owns `state.roster` and receives the whole action. The kernel deep-freezes the payload, calls the reducer inside a try/catch, copies the return value into detached plain data, canonicalizes it under the partition's schema (floats, functions, cycles, `Map`/`Date`, undeclared fields and wrong types all fail), checks the partition's shape, verifies that nothing outside the partition changed, writes it and then re-checks the whole state. Any failure is `REDUCER_ERROR`. A roster reducer's output is a detached copy, so unchanged seat entries are new objects (the `roster` member is always a new reference after a roster action).

### Why the canonical order is schema-defined

A digest must not depend on how an object was built. Sorting every key lexicographically would make the byte format depend on field names, and would give no way to place a computed member such as `derivedCounters` at a fixed position. Instead the schema lists fields in a fixed order, and only record-like collections (`idMap`) are sorted, by UTF-16 code unit, which is how JavaScript compares strings by default and so is cheap and unambiguous for any implementation. The schema is plain data, so the same description drives the golden vectors and can be reimplemented in another language. The format is frozen; see [canonical-json-profile.md](./canonical-json-profile.md).

Digests rebuild their schema on every call. That was measured to be cheap enough at the floor size that no cache (hidden state) was added; a future phase with far larger states can revisit with a per-definition cache.

### Why SHA-256 is implemented in pure TypeScript

The kernel must not import `node:*` modules or use the host's `crypto`: it has to run unchanged in any JavaScript runtime and must stay inside the determinism rules the workspace enforces (see [workspace-architecture.md](./workspace-architecture.md)). Core also compiles with `types: []`, so there is no `Buffer` or `TextEncoder` either; UTF-8 encoding is implemented in core too. The SHA-256 is checked against the NIST FIPS 180-4 vectors and, in tests only, against `node:crypto` on random inputs.

### Decisions that bind readers

These are choices the kernel makes where the surrounding documents left room. Callers should rely on them:

- A `player` proposal with no `actingSeat` while turns are enforced is `NOT_YOUR_TURN`; hosts must always supply the acting seat.
- `draw` from an unordered zone, `draw`/`zone_merge` between the same zone, `zone_merge` of non-template zones, and `reset_to_zone` that lists its own target or repeats a zone are `MALFORMED_ACTION`. `reset_to_zone` flips to `face_down` only the cards it moved that were face up when the macro began. `EMPTY_ZONE` reports the path `$[i].count`.
- Every macro move into an ordered zone carries an explicit position; an unordered target takes none and ignores the macro's `to_position`.
- A transfer whose rounded credit exceeds the amount produces a negative remainder, applied as is.
- `lifecycle` with an outcome stores it; `completed -> terminated` without one keeps the stored outcome. `null` is a real outcome.
- Unordered-zone membership keeps insertion order, and that order is part of the digest.
- Derived counters may not appear in conservation groups, and a derived counter cannot be adjusted or transferred.
- A roster that omits a declared seat is accepted from a reducer only if nothing (control, delegations, gates) still names that seat.
- Engine payloads (`engine.*`) must carry exactly the documented fields. `engine.gate_submit` from a seat outside `expectedSeats` is `GATE_CLOSED`, including a seat that does not exist.
- Initial state: cards start `face_down` with the metadata of their `initialMetadata` (empty unless the definition declares some), zones take their `owner` from the definition, `meta` partitions start as `{}`, control pointers are empty and the direction is `1`. A definition that wants face-up cards flips them with setup actions.
- `createSession` copies every array it takes; it never freezes or aliases the definition's data.
- Hook and port payloads carry no timestamps. `Effect.timer_request.duration_hint` is a host hint: effects are not state, are never logged and are never read by `apply`.
- Rule hooks receive a `GateMaskedSnapshot` (`maskGates` output), never the raw state, so sealed submissions are not exposed to hook code.

### SPI and ports

`core/spi` and `core/ports` are types only; their emitted JavaScript is empty. They are the contracts the later layers implement.

- **SPI**: `ValidationHook<K>`, `ReactionHook`, `GateResolveHook`, `AuthorizationHook` (all asynchronous), `Reducer<S>` (synchronous), the verdict types `Accept`/`Reject` (rejection is a `GameRejection`) and `Allow`/`Deny`, `Effect` (`timer_request`), `Proposal<K>`, `GateMaskedSnapshot`, `SealedBySeat`, and `AbortSignalLike`, a structural stand-in for the host's `AbortSignal` (core has no DOM or Node types, and a real `AbortSignal` is assignable to it).
- **Ports**: `SessionStore` (`commit`, `load`, `list`), `IdempotencyLedger`, `AuthorizationPort` (with the `AuthOp` union), `LeasePort`, `HookRunner`, `Publisher`, `TimerPort`, and the payload types `Transaction`, `Receipt`, `OutboxRow`, `Lease`, `CommitResult`, `StoredSession`, `SessionSummary`, `CommittedTransaction`. `commit` is atomic over actions, receipt and outbox rows, fails with `STALE_WRITER` when the expected sequence or epoch does not match (returned as a value; infrastructure faults reject the promise), and supports an empty accepted batch with `seq = null`. `load` returns the initial state plus a log, so replay is `initial` plus `log`. Receipts and outbox rows carry no `committed_at` or `published_at`; adapters own operational metadata. There is no session-creation method. `core/ports` also holds `DefinitionRegistry` (`resolve(DefinitionId)`), implemented by the filesystem adapter in `@cge/config` (see [game-definitions.md](./game-definitions.md#the-registry)).

## Limits and troubleshooting

### Known limits

- **No batch cap.** The kernel accepts batches of any length. Callers that face untrusted input should bound batch size before calling `apply`. Payload nesting is capped at 64 levels; array lengths and string sizes are not capped.
- **Derived-counter evaluators are trusted code.** An evaluator must be pure, return a `bigint` and tolerate any valid state. `apply` never evaluates derived counters; `stateDigest` does, and an evaluator that throws or returns something else makes it throw a plain `Error` (not a `CanonicalError`). Evaluators receive the whole snapshot, including `id`.
- **`apply` does not verify that its input state is frozen.** A state not produced by `createSession` or `apply` (a hand-built object) is a programmer error and its behaviour is undefined. Build test states by cloning and re-freezing.
- **`seq` is a safe integer.** A commit that would pass `Number.MAX_SAFE_INTEGER` throws a `RangeError`.
- **Definition checks are structural.** `assertDefinitionStructure` does not check duplicate zone-template names, duplicate meta schema ids or conservation group ids, or sensible `maxInstances`. A definition from `compileDefinition` has had those checks made with paths; a hand-built one has not. Its identity is `definitionContentHash` / `DefinitionId`, computed from the data and the hook bundle, not stored in the definition.
- **Pointer names are not enforced.** `control_set` accepts any pointer name, and duplicate or empty `active_seats` lists are not rejected beyond seat existence.
- **No gate quorum, timeouts or nested gates.** Gates are open, submit, retract, resolve. Submission payloads are opaque canonical JSON.
- **No engine-side roster defaults.** `join` and `leave` do not instantiate counters or zones; a roster reducer that writes anything outside the roster is a `REDUCER_ERROR`.
- **Actions have no canonical byte form.** Committed actions are compared structurally; digests cover state only.
- **Grant selectors are limited** to a single card, a single zone or the top of an ordered zone (no ranges or filters).
- **`control_advance` supports no `mode`.**

### What later phases add

| Phase | Builds on the kernel by |
|-------|-------------------------|
| P2 (shipped) | Compiling YAML into `CompiledGameDefinition`, content identity, the definition registry port and filesystem adapter, load-time errors, server configuration: see [game-definitions.md](./game-definitions.md). Deciding whether to enforce pointer names is still open |
| P3 (shipped) | Projecting state into role-specific views, deltas and log entries, the replay package format, hook-free replay, fork and the schema-evolution upgrade chain: see [visibility.md](./visibility.md) and [replay-package.md](./replay-package.md) |
| P4 | Running hooks behind the SPI types, with timeouts and cost budgets |
| P5 | Implementing the store, ledger and related ports |
| P6 | The application pipeline: proposals, idempotency, authorization, choosing which housekeeping actions to emit, cascade limits, and the host-level error codes the kernel only declares |

### Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `MALFORMED_ACTION` with a `path` like `$[3].to_position` | The shape or a parameter of the action at that input index is wrong; the path names the field. For macros the path points at the macro's own input index |
| `CARD_NOT_IN_ZONE` | The card is not in `from_zone` at that point in the batch (earlier actions are visible to later ones), or `from_zone` does not exist |
| `EMPTY_ZONE` from `draw` | The source zone holds fewer than `count` cards in the working state |
| `COUNTER_BOUNDS` with a group named in `detail` | The batch changed a conservation group's sum without a `supply_role` adjust; the `actionIndex` is the last action that touched a member |
| `NOT_YOUR_TURN` with no obvious cause | A `player` proposal lacks `actingSeat`, or the acting seat is not in the **input** state's `activeSeats` (a batch that changes `active_seats` is judged on the state before it) |
| `SESSION_ENDED` on `[]` | The session is `completed` or `terminated`; admission runs before the empty-batch rule |
| `REDUCER_ERROR` | The reducer threw, returned a float, function, cycle or undeclared field, changed something outside its partition, or left a seat that control or gates still reference. `detail` names the partition |
| `TypeError: Cannot assign to read only property` | Code is mutating a state, a committed action or a reducer payload; all of these are frozen |
| `stateDigest` throws `Error: derived counter ...` | A derived-counter evaluator threw or returned a non-`bigint` |
| `CanonicalError` from `stateDigest` | A state holds a value outside the profile or a field no schema declares (a hand-built state); `path` locates it |
| Digests differ between two runs | Something non-deterministic entered a definition (a reducer or evaluator that reads a clock or random source), or the golden digests were regenerated after a profile or fixture change |
| Tests that read `dist` fail with "run `pnpm build` first" | `packages/core/dist` is missing; `pnpm test` builds first, plain `vitest run` does not |

### Working on the kernel

Commands (from the repository root, under Node 22 as described in [dev-setup.md](./dev-setup.md)):

```sh
pnpm test                                    # builds, then all unit and property tests
pnpm exec vitest run packages/core           # only the kernel
pnpm test:coverage                           # V8 coverage; session, visibility and replay stay above 95 % lines
pnpm test:guardrails                         # determinism, layering and repository invariants
docker compose -f deploy/docker-compose.test.yml run --rm tests
```

The golden stream (a committed 30-batch run covering every primitive, with digests at sequence 0, 10, 20 and 30) lives in `packages/core/src/session/golden-stream.testing.ts` and `golden-stream.json`. Digests change only with a deliberate change to the stream, the fixture definition, the initial state or the canonical profile; regenerate with `UPDATE_GOLDEN=1 pnpm exec vitest run packages/core/src/session/golden-stream.test.ts`, then review the states by hand. The performance smoke test enforces its bounds strictly under Docker or with `CGE_PERF_STRICT=1`, and uses a 10x ceiling elsewhere so busy laptops do not flake.

Rules for kernel code: no `node:*` imports, `Date`, `Math.random`, `performance.now`, `process.env`, `crypto`, timers, `Atomics` or `SharedArrayBuffer` in non-test files (lint and a source-scan test enforce this); test files (`*.test.ts`) may use Node APIs; shared test builders live in `*.testing.ts` files, which are determinism-linted too and never exported from an index. Every new action kind needs an entry in the shape table, a handler, a generator case for the property tests and a failing-path test.
