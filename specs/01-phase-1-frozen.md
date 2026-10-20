# Frozen: Phase 1 — Domain kernel

Source: `specs/01-phase-1.md` (v0.4)
Status: SHIPPED
Frozen: 2026-10-20
PR / commit: #5 `3bbdd4a`
ID scheme: `KFR`/`KBR`/`KNFR` are this phase's own IDs; `Req FR-nnn`/`Req NFR-nnn` cite `docs/requirements.md`.

## Purpose

Phase 1 delivers the **domain kernel** of the Generic Card Game Engine inside `packages/core`: a pure, synchronous, deterministic state-transition function. Given a session state and a batch of actions it either returns the next state, committed atomically, or an error and no change at all. Every state has a canonical, byte-stable digest. Later phases build on it: definitions compile into the kernel's data types (P2), replay and projection reuse `apply` and the canonical module (P3), hooks plug into the SPI types (P4), stores implement the port interfaces (P5), and the application layer orchestrates it (P6).

The beneficiaries are the engineers and AI agents implementing P2–P14. They need one trusted definition of "a legal state change" before any infrastructure exists. Two things must be right now because they are expensive to change later. The **canonical JSON profile** is frozen before any golden digest exists. The **purity and atomicity** guarantees are proven by property tests, not assumed.

## What it does

**Types, errors, state**
- Exports branded ids (`SessionId`, `DefinitionId`, `CardId`, `ZoneId`, `SeatId`, `PlayerId`, `TeamId`, `CounterId`, `GateId`, `GrantId`), numeric `Seq`, and a guard/constructor for each.
- Returns failures as `EngineError` with a code from the 24-code union (design §3.4 + `STALE_WRITER`), `actionIndex` (input-batch index; macro primitives share the macro's index; conservation failures use the last input action that touched the group; pre-action admission failures use `0`), `detail` naming the entity, and `path` for `MALFORMED_ACTION`. Game rejections use a separate `GameRejection` with an opaque code.
- `apply` never throws for caller-triggerable failures; only violated TypeScript preconditions throw.
- `createSession(definition, sessionId, roster)` returns a deep-frozen `Snapshot<SessionState>` at `seq = 0`, `active`, cards in starting zones, counters at initial values; the roster must have exactly one entry per declared seat, matching teams, no duplicate player (else `MALFORMED_ACTION`).
- `Snapshot<T>` is `DeepReadonly<T>`; every committed state is deep-frozen; untouched zones, counters, card entries and partitions keep reference identity.

**`apply(def, state, batch, opts?)`**
- Is synchronous, I/O-free, clock-free, random-free; the result depends only on `(def, state, batch, opts)`.
- Is atomic: any failure leaves the input state unchanged (same reference and digest).
- Success on a non-empty batch yields `seq + 1` and the committed post-expansion primitives; an empty batch (or macros expanding to nothing) on an active session returns the same state, commits nothing, and does not advance `seq`.
- Commits only primitives; macros are expanded sequentially over the working state, so later actions see earlier ones.
- Rejects any unknown, missing-field, extra-field or ill-typed action with `MALFORMED_ACTION` and field path (hook output is untrusted).
- With `opts.proposal`, enforces turn rules (judged on the input state); without it, turn enforcement is skipped but the lifecycle rule still applies.
- Emits one `SessionEnded` notification per lifecycle transition in the batch.
- Applies housekeeping actions (`engine.grant_expire`, `engine.grant_consume`, `roster revoke_delegation`) like any other action and never generates them.

**Primitives**
- `move`: position 0 is the top of an ordered zone; out-of-bounds, negative or missing positions, or a position on an unordered zone, are `MALFORMED_ACTION` (deviation from Req §5.6.3); a card not in `from_zone` is `CARD_NOT_IN_ZONE`; same-zone positions are post-removal.
- `flip`: sets orientation; flipping to the current orientation still counts and advances `seq`.
- `shuffle`: the permutation must be an exact rearrangement of an ordered zone.
- `set_metadata`: only declared fields, typed.
- `counter_adjust` / `counter_transfer`: exact `bigint`, inclusive bounds (`COUNTER_BOUNDS`), `ratio` rounding, remainder to `remainder_to` (transfer only), aliased counters judged on net final values; derived counters can't be targeted.
- `control_set` / `control_advance`: values must come from the phase set and existing seats; advance counts only `seated` seats, wraps, supports a named pointer; `mode: until_quiescent` is rejected.
- `lifecycle`: only `active→completed`, `active→terminated`, `completed→terminated`; it must be the last action of its batch.
- `zone_create` / `zone_destroy`: ids are derived as `<template>/<ownerToken>/<ordinal>`; ordinals are never reused; `max_instances` gives `ZONE_LIMIT`; only empty template zones can be destroyed.
- `grant_view` / `revoke_view`: grant ids are `grant/<seq+1>/<i>` (identical live and on replay); targets are only card, zone or top-of-ordered-zone; keys come from `viewKeys`; scopes are `until_revoked`, `until_seq`, `once`; grantees are a declared seat, `all_seated` or `team:<id>`.
- `roster delegate` / `revoke_delegation`: a delegation is identified by `(seat, principal)`.
- `roster` ops and `meta`: dispatch to the definition's reducer, which replaces only its own partition.

**Macros:** `draw` (explicit `move`s from the top, `EMPTY_ZONE` if short), `zone_merge`, `reset_to_zone` (moves then `face_down` flips for cards that were face-up). Exported `nextZoneId(state, template, owner, pending = 0)` predicts derived zone ids within a batch.

**Reducers and engine partitions**
- Reducer outputs are validated (canonically serialisable, correct shape, own partition only), then structural invariants and counter bounds are re-checked; throw, bad shape or violation gives `REDUCER_ERROR`.
- Engine reducers own the reserved `engine.*` schemas (`gate_open`, `gate_submit`, `gate_retract`, `gate_resolve`, `grant_expire`, `grant_consume`); a definition declaring an `engine.*` reducer is rejected.
- Gates accept submissions only from expected seats while open (`GATE_CLOSED` otherwise).

**Counters:** `bigint` throughout; `floor` / `half_up` (ties away from zero) / `half_even` rounding with integer arithmetic only; `scale` is descriptive; conservation groups are checked once at batch end (only `supply_role` mint/burn `counter_adjust` may change the sum); derived counters are computed on demand, never stored, and digested.

**Canonical JSON and digest:** `canonicalize(schema, value) → Uint8Array` follows profile v1; `stateDigest(def, state)` is lower-case hex SHA-256 over the canonical state (the session `id` is excluded). SHA-256 is pure TypeScript inside core. `docs/canonical-json-profile.md` is the normative copy; golden vectors are in `packages/core/src/replay/canonical/golden-vectors.json`.

**PRNG:** `createPrng(seed)` returns an immutable `Uint32Stream` (FNV-1a-128 seed mix → sfc32); `uniform(stream, n)` uses rejection sampling; `shufflePermutation(stream, ids)` is Fisher–Yates and returns `{permutation, next}`. `apply` never consults the PRNG.

**SPI, definition, ports**
- `core/spi` exports types only (`ValidationHook`, `ReactionHook`, `GateResolveHook`, `Reducer<S>` synchronous, `AuthorizationHook`, `Effect`, `Proposal`, `GateMaskedSnapshot`, `SealedBySeat`, …) plus `AbortSignalLike`; no runtime hook execution.
- `maskGates(snapshot)` (exported from `core/session`) replaces each open gate with `{schemaId, expectedSeats, submitted}`.
- `CompiledGameDefinition` is plain data plus function members (reducers, derived evaluators) that are not canonicalised; `assertDefinitionStructure(def)` returns the first structural violation.
- `core/ports` exports interfaces only (`SessionStore`, `IdempotencyLedger`, `AuthorizationPort`, `LeasePort`, `HookRunner`, `Publisher`, `TimerPort`) and `Transaction`, `Receipt`, `OutboxRow`, `Lease`, `CommitResult`. `SessionStore.commit` is atomic over actions, receipt and outbox, fails with `STALE_WRITER` on `expectedSeq`/`epoch` mismatch, and allows `seq = null` empty-accepted-batch commits. `AuthorizationPort` ops: `propose:<kind> | query:<role> | subscribe:<role> | export | direct_apply | fork`.

## Public interfaces / data

### 6.1 Identifier charset

Every branded string id (all of KFR-001 except `Seq`) is a string of 1–128 characters matching `^[A-Za-z0-9_.:/-]+$`. `Seq` is a non-negative safe integer (§6.2 rule 5). Strings elsewhere (metadata values, payloads) are arbitrary UTF-8 and are compared and serialised byte-for-byte; no Unicode normalisation is performed.

### 6.2 Canonical JSON profile v1 (normative, frozen at phase exit)

1. Output is UTF-8, no BOM, no insignificant whitespace, no trailing newline.
2. **Key order is schema-defined**, not lexicographic. `canonicalize` takes a `CanonicalSchema`, a plain data tree with node kinds `int`, `bigint`, `string`, `bool`, `null`, `optional(node)`, `array(node)`, `object([[field, node], …])` (fixed field order), `idMap(node)` and `json`. Each state/action/definition type has a fixed schema listed in `docs/canonical-json-profile.md`; `stateDigest` builds the state schema from the definition (meta partitions and card metadata use the schemas the definition declares). `idMap` values (cards, zones, zone ordinals, counters, derived counters, seats, gates, grants, meta partitions) are emitted as arrays of `[key, value]` pairs sorted by ascending UTF-16 code-unit order of `key`; delegations are a plain array in insertion order. An object field absent from its schema, or a value that does not fit its node, is a `CanonicalError`. The `json` node is used only for payloads with no declared schema (sealed gate submissions, grant selectors, outcomes): its objects are emitted with keys sorted by UTF-16 code-unit order, and it admits only strings, safe integers, booleans, `null`, arrays and objects (no `bigint`, no floats).
3. Optional fields that are absent are omitted. `null` is allowed only where a type declares it. `undefined` is an error.
4. `bigint` is emitted as a JSON **string** of its base-10 digits with a leading `-` only for negatives, no leading zeros, `"0"` for zero.
5. Safe-range integers (`seq`, positions, ordinals, `count`, `steps`) are JSON numbers in base-10 without exponent or fraction. Any non-integer or unsafe-integer `number` is a `CanonicalError`.
6. Strings use JSON escaping limited to `"` → `\"`, `\` → `\\`, and U+0000–U+001F as `\b \t \n \f \r` where defined, else `\u00xx` with lower-case hex. All other characters, including non-ASCII and U+007F, are emitted raw. Lone surrogates are a `CanonicalError`.
7. Booleans are `true`/`false`. Arrays keep their order.
8. `StateDigest = lower-case hex SHA-256` over the output bytes.

### 6.3 PRNG

Normative algorithm (the committed golden vectors, ≥ 10 per seed class, are generated from exactly this):

1. **Seed mix.** `h` = 128-bit FNV-1a over the seed's UTF-8 bytes: start at offset `0x6c62272e07bb014262b821756295c58d`; for each byte, `h ^= byte; h = (h × 0x0000000001000000000000000000013b) mod 2^128`. Split `h` big-endian into four 32-bit words `a, b, c, d`.
2. **sfc32.** Step on `uint32` words: `t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0; output t >>> 0`. Discard the first 12 outputs.
3. **uniform(n)**, `1 ≤ n ≤ 2^32`: `limit = floor(2^32 / n) × n`; draw outputs until `x < limit`; return `x mod n`. Rejected draws are consumed. The returned `next` is the stream after the last consumed draw.
4. **Shuffle.** Fisher–Yates over the input order: for `i` from `len−1` down to `1`: `j = uniform(i + 1)`; swap positions `i` and `j`.

(This choice is final for P1; changing it later changes shuffles but not replay, since replay uses logged permutations.)

### 6.4 Core types (normative field names and order)

Field names and order below are the canonical-profile field order for state (§6.2 rule 2); `docs/canonical-json-profile.md` copies them. Types only: no field here is optional unless marked `?`.

```ts
type Result<T, E = EngineError> = { ok: true; value: T } | { ok: false; error: E };

interface SessionState {                // always deep-frozen; digest field order = declaration order, `id` excluded
  id: SessionId; lifecycle: 'active' | 'completed' | 'terminated'; seq: Seq;
  cards: record<CardId, { zone: ZoneId; orientation: 'face_up'|'face_down'; metadata: Record<string, JsonValue> }>;
  zones: record<ZoneId, { template?: string; owner?: SeatId|TeamId|PlayerId /* absent for `none`-rule templates */; members: readonly CardId[] }>;
  zoneOrdinals: record<string /* `<template>/<ownerToken>` */, number>;
  counters: record<CounterId, bigint>;              // stored counters only
  // derivedCounters: record<CounterId, bigint> is computed, never stored; emitted in the digest right after `counters`
  meta: record<string /* schema_id */, JsonValue>;
  roster: RosterState; control: ControlState;
  gates: { open: record<GateId, Gate>; resolved: record<GateId, ResolvedGate> };
  delegations: readonly Delegation[]; grants: record<GrantId, Grant>;
  outcome?: GameOutcome;
}
interface RosterState { seats: record<SeatId, { status: 'seated'|'sitting_out'|'eliminated'; player?: PlayerId; team?: TeamId }> }
interface ControlState { phase: string; turnOrder: readonly SeatId[]; activeSeats: readonly SeatId[]; direction: 1 | -1; pointers: record<string, SeatId> }
interface Gate { schemaId: string; expectedSeats: readonly SeatId[]; submissions: record<SeatId, JsonValue> }
interface ResolvedGate { schemaId: string; expectedSeats: readonly SeatId[]; submissions: record<SeatId, JsonValue> }
interface Delegation { seat: SeatId; principal: string; scope?: JsonValue; boundary?: string }
interface Grant { target: JsonValue /* KFR-040 shapes */; keys: readonly string[]; grantee: string; scope: JsonValue /* KFR-040 shapes */ }
interface MaskedGate { schemaId: string; expectedSeats: readonly SeatId[]; submitted: readonly SeatId[] }
type GateMaskedSnapshot = Snapshot<Omit<SessionState, 'gates'> & { gates: { open: record<GateId, MaskedGate>; resolved: record<GateId, ResolvedGate> } }>;
type SealedBySeat = readonly SeatId[];  // the `submitted` list
type ErrorCode = /* the 24 codes of KFR-002 */ string;
interface EngineError { code: ErrorCode; detail: string; actionIndex?: number /* apply only */; path?: string /* MALFORMED_ACTION field path */ }
type GameOutcome = JsonValue;           // opaque `json` node
interface SessionEnded { to: 'completed' | 'terminated'; outcome?: GameOutcome }

interface ApplyOptions { proposal?: { origin: 'player'|'dealer'|'control'|'system'; kind: string; actingSeat?: SeatId } }
interface ApplySuccess { state: Snapshot<SessionState>; committed: readonly Action[]; notifications: readonly SessionEnded[] }
function apply(def: CompiledGameDefinition, state: Snapshot<SessionState>, batch: readonly (Action | Macro)[], opts?: ApplyOptions): Result<ApplySuccess>;
```

Keyed collections are plain frozen records (not `Map`/`Set`) so the canonicalisation of §6.2 rule 2 is total. Action payload field names are those of `docs/requirements.md` §5.6.3 (snake_case on the wire, as written in the KFR rows).

### 6.5 Files this phase adds or changes

- `packages/core/src/{session,errors,spi,ports,definition,replay}/…` (existing sub-folders; `replay/canonical/` is new; all re-exported through `src/<sub>/index.ts` and `src/index.ts`).
- `docs/canonical-json-profile.md` (new), `docs/workspace-architecture.md` (core sub-folder contents), `docs/dev-setup.md` only if a command changes (none expected).
- Phase 0 sources that contained only `export {};` now contain real code; the guardrail check "skeleton purity" (FR-043 check 4 of Phase 0) must be updated to exempt `packages/core` only; the check stays in force for every other package. (`specs/00-phase-0-frozen.md` says Phase 1 "removes" it; this narrower exemption is the deliberate refinement and the frozen note is updated when P1 ships.) This is the only Phase 0 guardrail change allowed (VC-101).

## Key decisions

- Canonical key order is schema-defined, not lexicographic: field order is part of the contract and digests stay stable under insertion-order differences. `idMap` keys sort by UTF-16 code unit.
- `bigint` serialises as a JSON string and floats are banned: exact arithmetic and a total, unambiguous encoding.
- The session `id` is excluded from the digest, so forks and re-keyed copies with identical content share a digest.
- Derived counters are computed on demand and digested but never stored, so they can't drift from their inputs.
- SHA-256 and UTF-8 encoding are implemented in pure TypeScript in core (`types: []`, no `node:crypto`), keeping core portable and dependency-free.
- `shuffle` logs an explicit permutation and `apply` never touches the PRNG: replay never re-randomises. Changing the PRNG later changes new shuffles only.
- Grant ids are derived from `(seq+1, index)` so live and replay agree without a counter.
- Zone ids are derived `<template>/<ownerToken>/<ordinal>` (template names contain no `/`, so derivation is injective); ordinals are never reused.
- Admission rules (lifecycle, turn) run on the input state before expansion; structural rules after each primitive and reducer; conservation once at batch end, so transient imbalance is legal.
- `Seq` is a safe-integer `number` (sessions never exceed 2^53−1 transactions); counters and `bigint` stay `bigint` everywhere in state.
- Out-of-bounds `move` is `MALFORMED_ACTION` (not `CARD_NOT_IN_ZONE`); `counter_adjust` credits no rounding remainder; `half_up` rounds ties away from zero (deliberate deviations from Req).
- Reducers and derived evaluators are function-valued members of a definition: excluded from canonicalisation, resolved from the definition value passed in.
- Roster/meta reducers may change only their own partition; engine-supplied reducers own the reserved `engine.*` namespace.
- `maskGates` lives in `core/session`, not `core/spi`, so SPI stays runtime-free.
- Core defines `AbortSignalLike` structurally because it compiles with `types: []`.
- Immutability is hand-rolled (no immer): core has no runtime dependencies.
- The Phase 0 skeleton-purity guardrail is exempted for `packages/core` only.

## Known limits (still true at freeze)

- Smoke bounds at the NFR-020 floor (14 seats, 4 teams, 700 cards, 64 zones): a 20-`move` batch ≤ 50 ms, `stateDigest` ≤ 250 ms. These are regression bounds, not the NFR-010/024 targets (P9).
- Core has no hard-coded structural limit below that floor.
- Ids are 1–128 chars of `[A-Za-z0-9_.:/-]`; seeds ≤ 256 UTF-8 bytes; delegation principals ≤ 256 UTF-8 bytes; template names ≤ 48 chars with no `/`; derived zone ids ≤ 128 chars.
- Reserved `engine.` schema prefix cannot be used by definitions.
- Grant targets are limited to card, zone or top-of-ordered-zone. Roster `join`/`leave` have no engine-side default, and a roster or meta reducer writing outside its partition is `REDUCER_ERROR`.
- Error codes beyond structural, lifecycle and aggregate-rule codes (`NOT_READY`, `STALE`, `UNAUTHORIZED`/`FORBIDDEN`, `CASCADE_LIMIT`, `HOOK_*`, …) are declared but not raised by the kernel.
- No new runtime dependencies in `packages/core`; devDependencies need exact pins.
- The kernel imports no other `@cge/*` package and no `node:*`; no `Date`, `Math.random`, `performance.now`, `process.env`, `crypto.*`, timers or `Atomics`.
- No wall-clock value appears in state or in `apply` inputs or outputs.
- Same stream gives identical digests across runs, processes and the Docker `test` image; changing the canonical profile after freeze invalidates every golden digest.

## Deliberately excluded

- YAML parsing, definition compilation, `DefinitionId` content hashing and the `DefinitionRegistry` (P2); projection, `View`/`Delta`, `Replayer`, `Forker`, replay package format and schema upgraders (P3); hook execution, `HookRunner` implementations and `packages/helpers` (P4); store, transport and timer adapters (P5+).
- The 10-step pipeline, idempotency, housekeeping-action generation, `would_reveal`, authorization and cascade limits (P6).
- Gate quorum, timeout policy, request/response and nested gates; `control_advance` `until_quiescent`; grant range/filter selectors.
