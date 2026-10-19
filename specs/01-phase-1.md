# Spec: Phase 1 — Domain kernel

**Version:** 0.4 · **Status:** Ready for review · **Last updated:** 2026-10-19
**Source plan:** `docs/implementation_plan.md` §Phase 1 · **Design:** `docs/design.md` §2.2, §3 · **Architecture:** `docs/architecture.md` A4, A6
**Builds on:** `specs/00-phase-0-frozen.md` (shipped workspace, guardrails, Docker `test` target)

**ID scheme.** Requirement IDs from `docs/requirements.md` are cited as `Req FR-nnn` / `Req NFR-nnn`. This spec's own IDs are `KFR-nnn` (functional), `KBR-nnn` (business rule), `KNFR-nnn` (non-functional) and `VC-nnn` (verification), so they never collide with the requirements document or Phase 0's FR-0xx.

---

## 1. Purpose

Phase 1 delivers the **domain kernel** of the Generic Card Game Engine inside `packages/core`: a pure, synchronous, deterministic state-transition function. Given a session state and a batch of actions it either returns the next state, committed atomically, or an error and no change at all. Every state has a canonical, byte-stable digest. Later phases build on it: definitions compile into the kernel's data types (P2), replay and projection reuse `apply` and the canonical module (P3), hooks plug into the SPI types (P4), stores implement the port interfaces (P5), and the application layer orchestrates it (P6).

The beneficiaries are the engineers and AI agents implementing P2–P14. They need one trusted definition of "a legal state change" before any infrastructure exists. Two things must be right now because they are expensive to change later. The **canonical JSON profile** is frozen before any golden digest exists. The **purity and atomicity** guarantees are proven by property tests, not assumed.

## 2. Scope

### In

- Branded id types, the error taxonomy (design §3.4) and `bigint` counter arithmetic with exact semantics.
- Immutable session state, a deep-readonly `Snapshot` type, and deep-freezing of every committed state.
- `Session.apply(state, batch)`: synchronous and pure, enforcing aggregate invariants 1–10, expanding macros and discarding the whole batch on any failure. It applies logged primitives, including `engine.*` housekeeping actions when they are present in the batch.
- Compiled-definition **data types** (`CompiledGameDefinition` and its parts), enough to enforce counter bounds, conservation, the card registry, zone templates, seat layout and policies. Tests build instances in code.
- Rule SPI **types only** in `core/spi`: `ValidationHook`, `ReactionHook`, `GateResolveHook`, `Reducer`, `AuthorizationHook`, `GateMaskedSnapshot`.
- Engine-supplied reducers for the reserved `engine.*` schemas (`gate_open`, `gate_submit`, `gate_retract`, `gate_resolve`, `grant_expire`, `grant_consume`).
- Canonical JSON profile v1, its normative document and golden vectors, and `StateDigest` (SHA-256), under `core/replay/canonical`.
- A seeded PRNG and a shuffle helper that returns an explicit permutation.
- Port **interfaces** in `core/ports`: `SessionStore`, `IdempotencyLedger`, `AuthorizationPort`, `LeasePort`, `HookRunner`, `Publisher`, `TimerPort`.
- Unit and property tests in `packages/core`, running in the Docker `test` target.

### Out (explicitly)

- YAML parsing, definition compilation, content identity (`DefinitionId`), hook-bundle hashing and the `DefinitionRegistry` port: **P2**.
- `Projector`, `View`/`Delta`, `PrivilegedBatch`, `Replayer`, `Forker`, replay package format and the schema-upgrader chain: **P3**. P1 returns committed actions as a plain `readonly Action[]`.
- Hook execution, `HookRunner` implementations, timeouts, cost budgets and `packages/helpers`: **P4**. P1 never calls a hook.
- Deciding which housekeeping actions to emit (step 6b, `would_reveal`), the 10-step pipeline, idempotency, `NOT_READY`, `STALE`, `UNAUTHORIZED`/`FORBIDDEN`, `CASCADE_LIMIT`, `HOOK_*` errors: **P6** (error codes are *declared* here; only structural, lifecycle and aggregate-rule codes are *raised* here).
- Gate quorum, `timeout_policy`, request/response and nested gates (Req FR-164–FR-167), and engine-side defaults for roster `join`/`leave` such as counter instantiation from templates (Req FR-124): later phases. Until then a roster or meta reducer that writes anything outside its own partition (counters, zones) is a `REDUCER_ERROR`.
- Any adapter implementation (`store-*`, transports, timers): P5 and later.
- The `control_advance` macro with `mode: "until_quiescent"` (Req FR-136, *Could*; its expansion needs hook logic). P1 rejects that mode as `MALFORMED_ACTION`.
- Grant target selectors beyond a single card, a single zone and top-of-zone (Req FR-155 ranges and filters, *Should*): P3. In P1 any other selector is `MALFORMED_ACTION` (KFR-040). Giving grants meaning at projection time is P3.
- New workspace packages. All work lands in the existing `packages/core`. No new runtime dependencies are added (Phase 0: runtime `dependencies` are `workspace:*` only).

## 3. Actors

| Actor | Description | Permissions |
|-------|-------------|-------------|
| Kernel consumer (P3, P4, P6 code) | In-repo code calling `apply`, `digest` and the type exports | Call exported pure functions; implement the port interfaces. No access to core internals (enforced by Phase 0 package `exports`). |
| Game author (indirect) | Writes definitions/hooks in P2/P4 | Only sees SPI and definition types. Cannot change `apply` semantics. |
| CI / guardrails | Phase 0 lint, depcheck, typecheck, Docker `test` | Must stay green. Core determinism and no-node rules apply to all new code. |

## 4. Functional Requirements

Priorities use MoSCoW. A *Must* is required for the phase exit criteria.

### 4.1 Types, ids and errors

| ID | Pri | Requirement |
|----|-----|-------------|
| KFR-001 | Must | **Given** the `core/session` and `core/errors` modules, **when** a consumer imports the package, **then** it exports branded string types `SessionId`, `DefinitionId`, `CardId`, `ZoneId`, `SeatId`, `PlayerId`, `TeamId`, `CounterId`, `GateId`, `GrantId`, a branded numeric type `Seq`, and constructor/guard functions for each. A string-id guard accepts a string that matches the id charset and length (§6.1) and rejects any other value. The `Seq` guard accepts exactly the integers in `[0, Number.MAX_SAFE_INTEGER]`. Assigning a `CardId` to a `ZoneId` position is a compile error. |
| KFR-002 | Must | **Given** the error taxonomy of design §3.4 plus `STALE_WRITER` (architecture A6), **when** an operation fails, **then** it returns an `EngineError` (§6.4) whose `code` is a member of one exported string-literal union covering exactly these codes: `IDEMPOTENCY_CONFLICT`, `STALE`, `STALE_WRITER`, `UNAUTHORIZED`, `FORBIDDEN`, `UNKNOWN_ROLE`, `UNKNOWN_SUBJECT`, `SUBJECT_NOT_ALLOWED`, `VIEW_DENIED`, `NOT_YOUR_TURN`, `NOT_READY`, `GATE_CLOSED`, `CARD_NOT_IN_ZONE`, `EMPTY_ZONE`, `COUNTER_BOUNDS`, `ZONE_LIMIT`, `REDUCER_ERROR`, `MALFORMED_ACTION`, `SESSION_ENDED`, `REPLAY_INVALID`, `REPLAY_MISMATCH`, `HOOK_ERROR`, `HOOK_TIMEOUT`, `CASCADE_LIMIT`. Game-defined rejections use a separate `GameRejection` type with an opaque code. |
| KFR-003 | Must | **Given** a batch that fails in `apply`, **when** the error is returned, **then** it carries `actionIndex` (zero-based index into the **input** batch), `code`, a human-readable `detail` string and, for `MALFORMED_ACTION`, the offending field `path` where one exists. Errors from operations that have no batch (`createSession`, `createPrng`, `assertDefinitionStructure`) carry no `actionIndex`. The detail string names the offending entity id (card, zone, counter, seat, gate) where one exists (Req NFR-041). For `apply`, `actionIndex` is: the index of the input action (for a macro, the macro's own index, shared by all primitives it expands to); for a `meta`/`roster` reducer failure, the index of that action; for a conservation failure (KBR-011), the index of the last input action whose expansion changed a member of the violated group; for a failure that precedes any action (lifecycle admission, KBR-004/009), `0`. |
| KFR-004 | Must | **Given** `apply` runs on any input, **when** it fails for any reason a caller can trigger, **then** it returns an error result and never throws. Only programmer errors (violated TypeScript preconditions such as an unfrozen state) may throw. |

### 4.2 State, snapshot and immutability

| ID | Pri | Requirement |
|----|-----|-------------|
| KFR-010 | Must | **Given** a `CompiledGameDefinition` and a session id, **when** `createSession(definition, sessionId, roster)` is called, where `roster` is `readonly RosterEntry[]` and `RosterEntry = { seat: SeatId; player?: PlayerId; team?: TeamId }` (deterministic setup params are not a P1 input; they belong to the P6 setup event), **then** it returns `Result<Snapshot<SessionState>>`, the value being deep-frozen (KFR-012) and valid as the first input of `apply`, with `lifecycle = active`, `seq = 0`, every card of the registry in its declared starting zone (Req FR-006), every counter at its initial value, control state at the definition's initial values, `roster.seats` built from the roster entries (each `status = seated`), `control.turnOrder` from the definition, and no gates, grants or delegations. |
| KFR-011 | Must | **Given** a state, **when** it is exposed to a consumer, **then** the exported `Snapshot<T>` type is `DeepReadonly<T>` over the whole state graph (arrays, maps, records, nested objects). A write to any property through a `Snapshot` is a compile error. |
| KFR-012 | Must | **Given** `apply` succeeds, **when** it returns the new state, **then** every object and array reachable from it is frozen (`Object.isFrozen`), in every build mode, and `bigint` values are held as-is. |
| KFR-013 | Should | **Given** a batch that touches only some zones, counters or cards, **when** `apply` succeeds, **then** every zone, counter, card entry and partition of the new state that no committed action wrote is reference-identical (`===`) to that of the input state, and every one that was written has a new reference (structural sharing). |
| KFR-014 | Must | **Given** `createSession` is called with a roster that is not valid for the definition's seat layout (KFR-100), **when** it runs, **then** it returns an `Err` of code `MALFORMED_ACTION` naming the offending id (VC-011). A roster is valid iff: it contains exactly one entry for every declared seat and no other seat; a `team`, when given, equals the team the layout declares for that seat (a seat the layout declares without a team takes no `team`); and no `player` appears twice. |

### 4.3 `apply` contract

| ID | Pri | Requirement |
|----|-----|-------------|
| KFR-020 | Must | **Given** a frozen state `S` and a batch `B`, **when** `apply(definition, S, B)` is called, **then** it is synchronous (returns a plain value, not a `Promise`), performs no I/O, reads no clock and no randomness, and its result is a function of `(definition, S, B, opts)` only (omitted `opts` equals `{}`). |
| KFR-021 | Must | **Given** any batch that fails validation at any action, **when** `apply` returns, **then** the input state `S` is unchanged (same reference, same digest, still frozen) and no partial result is observable (Req FR-053, NFR-040, NFR-042). |
| KFR-022 | Must | **Given** a non-empty batch whose actions are all valid, **when** `apply` succeeds, **then** the new state has `seq = S.seq + 1` and the result lists the committed (post-expansion) primitive actions in order. |
| KFR-023 | Must | **Given** an active session (ended sessions are governed by KBR-004/KBR-009, which run first) and an empty batch (zero actions, or macros that expand to zero primitives), **when** `apply` is called, **then** it succeeds, returns `S` itself (same reference), commits zero actions and does not advance `seq`. |
| KFR-024 | Must | **Given** a batch that applied successfully, **when** `apply` is called twice from the same initial state with the same batch and the same `opts`, **then** both results have identical committed actions and byte-identical digests. |
| KFR-025 | Must | **Given** a batch containing macros, **when** `apply` succeeds, **then** the committed actions contain only primitives. Macros never appear in the result. |
| KFR-026 | Must | **Given** `apply` options carry a `proposal` descriptor `{origin, kind, actingSeat?}`, **when** present, **then** the turn-enforcement and lifecycle rules (KBR-005, KBR-009) are evaluated against it. When absent (replay, host direct apply, hook-produced batches already past step 3a), turn enforcement is skipped and the lifecycle rule still applies. |
| KFR-027 | Must | **Given** `apply` succeeds and the batch contains a `lifecycle` action, **when** the result is returned, **then** it carries one `SessionEnded` notification for the transition into `completed` and one for the transition into `terminated`, each with the action's `outcome`; otherwise it carries none. `SessionEnded` is `{ to: 'completed' | 'terminated'; outcome?: GameOutcome }`, exported from `core/session`. |
| KFR-028 | Must | **Given** any `Action` value reaching `apply`, **when** it is not one of the known primitives or macros, or has missing/extra/ill-typed fields for its kind, **then** `apply` returns `MALFORMED_ACTION` with the action index and the offending field path. Hook output is untrusted input (Req NFR-070). |

### 4.4 Primitive actions

Payload fields follow `docs/requirements.md` §5.6.3. Each row states the *only* behaviour added by that action.

| ID | Pri | Requirement |
|----|-----|-------------|
| KFR-030 | Must | `move{card_id, from_zone, to_zone, to_position?}`. Position 0 is the **top** of an ordered zone (`members[0]`). **Given** the card is in `from_zone` and `to_position` is an integer in `[0, len(to_zone after removing the card)]` (ordered `to_zone`; for a same-zone move the position is interpreted after the removal) or omitted (unordered `to_zone`), **when** applied, **then** the card is removed from `from_zone` and inserted at `to_position` (ordered) or appended to `members` (unordered), keeping its identity (Req FR-005). **Given** the card is not in `from_zone`, **then** `CARD_NOT_IN_ZONE`. **Given** an out-of-bounds, negative or missing position on an ordered zone, a `to_position` on an unordered zone, or an unknown `to_zone`/card, **then** `MALFORMED_ACTION` naming the id (a deliberate deviation from Req §5.6.3, which maps out-of-bounds to `CARD_NOT_IN_ZONE`; recorded in A5). |
| KFR-031 | Must | `flip{card_id, orientation}`. **Given** an existing card, **when** applied, **then** its orientation becomes `orientation`. **Given** an unknown card, **then** `MALFORMED_ACTION` naming the card id. Flipping to the current orientation succeeds, may leave the card record `===`, and still counts as a non-empty action, so `seq` advances. |
| KFR-032 | Must | `shuffle{zone, permutation}`. **Given** the permutation is an exact rearrangement (same multiset, same length, no duplicates) of the zone's current membership and the zone is ordered, **when** applied, **then** the zone's order equals `permutation` exactly. Otherwise `MALFORMED_ACTION` (design invariant 3). |
| KFR-033 | Must | `set_metadata{card_id, fields}`. **Given** an existing card and fields that all match the card's declared metadata schema (name and type), **when** applied, **then** only those fields change. An undeclared field or wrong-typed value yields `MALFORMED_ACTION`. |
| KFR-034 | Must | `counter_adjust{counter_id, delta, ratio?}`. **Given** an existing stored counter, **when** applied, **then** `value += applied`, where `applied = delta` or, with `ratio`, `applied = ratioRound(delta, ratio)` (KFR-061), exact `bigint`, and the result must satisfy the bounds. A bound violation yields `COUNTER_BOUNDS`. A derived counter target yields `MALFORMED_ACTION`. `counter_adjust` credits no rounding remainder in P1 (recorded in A5). |
| KFR-035 | Must | `counter_transfer{from_counter, to_counter, amount, ratio?, remainder_to?}`. **Given** two existing stored counters and `amount ≥ 0`, **when** applied, **then** `from -= amount`, `to += credited` and `remainder_to += (amount − credited)`, where `credited = amount` without `ratio` and `credited = ratioRound(amount, ratio)` with it (KFR-061). If `amount − credited ≠ 0` and `remainder_to` is absent the action yields `MALFORMED_ACTION`. When the named counters alias, the net change per counter is computed first and the bounds are checked on the final values only. A negative amount yields `MALFORMED_ACTION`; a bound violation yields `COUNTER_BOUNDS`. |
| KFR-036 | Must | `control_set{phase?, active_seats?, direction?, pointer?}`. **Given** values within the declared phase set and existing seats, **when** applied, **then** exactly the named fields change; `pointer` is `{name, seat}` and sets `control.pointers[name]` (Req FR-135). A phase outside the set, a non-existent seat or `direction` other than `1`/`-1` yields `MALFORMED_ACTION`. |
| KFR-037 | Must | `control_advance{steps, pointer?}`. **Given** `steps ≥ 1` (integer), **when** applied, **then** the cursor moves along `turn_order` in `direction`, wrapping round, counting only seats whose status is `seated` (Req FR-134; skipped seats do not count as steps; the start seat itself counts only after wrapping). The cursor's start is `active_seats[0]` when `pointer` is absent (an empty `active_seats` yields `MALFORMED_ACTION`) or `control.pointers[pointer]` otherwise (a missing pointer yields `MALFORMED_ACTION`). With `pointer` absent the result replaces `active_seats` with `[newSeat]`; with a named `pointer` only `control.pointers[pointer]` changes and `active_seats` is untouched. If no seat is `seated` the action yields `MALFORMED_ACTION`. A `mode` other than absent yields `MALFORMED_ACTION` (out of scope, §2). |
| KFR-038 | Must | `lifecycle{to_state, outcome?}`. **Given** a legal transition (KBR-004), **when** applied, **then** the session lifecycle becomes `to_state` and `outcome` (if given) is stored in session state. An illegal transition from an active session yields `MALFORMED_ACTION`. |
| KFR-039 | Must | `zone_create{template, owner, zone_id?}` and `zone_destroy{zone_id}`. **Given** a declared template and an owner permitted by the template's owner rule (`seat`, `team`, `player` or `none`; `none` takes no `owner`, every other rule requires one that exists in the session's layout/roster, otherwise `MALFORMED_ACTION` naming the owner), **when** `zone_create` is applied, **then** a new empty zone exists whose id is derived from `(template, ownerToken, ordinal)` (KBR-006), where `ownerToken` is the owner id, or the literal `_` for a `none`-rule template, and the logged action records that derived id. The new zone's `owner` is the owner id, absent for `none`. A caller-supplied `zone_id` that differs from the derived id, a derived id longer than 128 characters, or a derived id that equals an existing zone id yields `MALFORMED_ACTION`. `zone_destroy` of an empty template-instantiated zone removes it; destroying a non-empty or non-template zone yields `MALFORMED_ACTION`. Exceeding `max_instances` yields `ZONE_LIMIT`. |
| KFR-040 | Must | `grant_view{target, keys, grantee, scope}` and `revoke_view{grant_id}`. **Given** a valid target, valid keys, a `grantee` that is a declared seat id, `all_seated` or `team:<id>` of a declared team, and a valid scope, **when** `grant_view` is applied, **then** a grant is stored in state under the id `grant/<seq+1>/<i>`, where `seq+1` is the `seq` this batch commits and `i` is the zero-based index of the action within the batch's committed primitive list; the committed action records that id as `grant_id`. The id is therefore identical on live apply and on replay. **Valid target** is exactly one of `{kind:'card', card_id}`, `{kind:'zone', zone_id}`, `{kind:'top', zone_id}` (ordered zone only), naming an existing card or zone; any other shape (ranges, filters) is `MALFORMED_ACTION`. **Valid keys** is a non-empty list of distinct strings, each a member of the definition's `viewKeys` vocabulary (KFR-100). **Valid scope** is exactly one of `{kind:'until_revoked'}`, `{kind:'until_seq', n}` (`n` a safe integer ≥ the committing `seq`, i.e. ≥ `seq+1`) or `{kind:'once'}`. The target and scope are stored as `json` data (§6.2). A grantee of `dealer`, `auditor`, an unknown seat or an unknown team yields `MALFORMED_ACTION`. `revoke_view` of an existing grant removes it; an unknown id yields `MALFORMED_ACTION`. |
| KFR-041 | Must | `roster{op: delegate, seat_id, grantee_principal, scope?, boundary?}` and `roster{op: revoke_delegation, seat_id, grantee_principal}`. **Given** an existing seat and a `grantee_principal` (a non-empty string of at most 256 UTF-8 bytes, no lone surrogates), **when** `delegate` is applied, **then** a delegation `(seat, principal, scope?, boundary?)` is appended to `delegations`. A delegation is identified by `(seat, principal)`: a second `delegate` with the same pair, or a `revoke_delegation` with no matching pair, yields `MALFORMED_ACTION`; `revoke_delegation` removes the one matching delegation. Subjects are normalised to seats before `apply` (design §2.2; P6), so the payload carries a seat id. Unknown seats yield `MALFORMED_ACTION`. |
| KFR-042 | Must | `roster{op ∈ join, leave, substitute, set_status, ...}` and `meta{schema_id, payload}`. **Given** the definition registers a reducer for the schema/op, **when** applied, **then** the reducer is invoked with the owning partition (`roster` or `meta[schema_id]`) and the payload, and its returned value replaces that partition only (KFR-050). An unregistered `schema_id` yields `MALFORMED_ACTION`. |

### 4.5 Macros

| ID | Pri | Requirement |
|----|-----|-------------|
| KFR-045 | Must | `draw{from_zone, count, to_zone, to_position?}`. **Given** an ordered `from_zone` with ≥ `count` cards and `from_zone ≠ to_zone`, **when** expanded, **then** it becomes `count` explicit `move`s of the top `count` card ids (`members[0]`, `members[1]`, … of the working state) in that order. The i-th move (zero-based) carries `to_position = to_position + i` when the macro gives one, otherwise `len(to_zone) + i` for an ordered `to_zone` (append), and no position for an unordered `to_zone`. **Given** fewer cards, **then** `EMPTY_ZONE` is returned and nothing is logged. `from_zone = to_zone` yields `MALFORMED_ACTION`. `count = 0` expands to nothing. |
| KFR-046 | Must | `zone_merge{src_zone, dst_zone}`. **Given** both zones are template-instantiated, **when** expanded, **then** it becomes one explicit `move` per card of `src` (in `members` order, appended to `dst` with explicit positions as in KFR-045) followed by `zone_destroy(src)`. Non-template zones yield `MALFORMED_ACTION`. |
| KFR-047 | Must | `reset_to_zone{zones, to_zone}`. **Given** existing zones, **when** expanded, **then** it becomes explicit `move`s of every card of each source zone to `to_zone` (in zone order, then in zone-membership order; positions appended as in KFR-045), followed by `flip`s to `face_down` for every card that was face-up when the macro began. |
| KFR-048 | Must | **Given** a batch with macros and primitives interleaved, **when** expanded, **then** expansion runs sequentially over the working state: a macro sees the effect of all earlier actions in the same batch (design §2.2). Expansion errors occur before anything is committed. |
| KFR-049 | Must | **Given** a `zone_create` whose derived id is needed by later actions in the same batch, **when** the batch is applied, **then** an exported pure function `nextZoneId(state, template, owner, pending = 0)` returns the id the creation would receive (Req FR-194), where `pending` is the number of earlier `zone_create`s for the same `(template, owner)` in the same batch that are not yet in `state`; a later `move` into that id in the same batch succeeds. |

### 4.6 Reducers and engine-owned partitions

| ID | Pri | Requirement |
|----|-----|-------------|
| KFR-050 | Must | **Given** a `meta` or `roster` reducer returns a new partition, **when** `apply` handles it, **then** the kernel validates the output: it must be serialisable under the partition's canonical schema (KFR-070) and conform to the partition's shape (§6.4), may only change its own partition, and after it the structural invariants (KBR-001–KBR-003, KBR-006–KBR-008) and counter bounds are re-checked (KBR-010). A thrown exception, a non-serialisable or ill-shaped return or an invariant violation yields `REDUCER_ERROR`. |
| KFR-051 | Must | **Given** a `meta` action with a reserved `engine.*` schema, **when** applied, **then** the engine reducer (not the definition's) handles it, with these exhaustive payloads and rules (`schema_id` and submission `payload` are opaque canonical JSON in P1; no schema validation): `engine.gate_open{gate_id, schema_id, expected_seats}` opens a gate; `expected_seats` must be a non-empty list of distinct existing seats and `gate_id` unused in both `open` and `resolved`, else `MALFORMED_ACTION`. `engine.gate_submit{gate_id, seat, payload}` stores a sealed submission, replacing any earlier submission by the same seat; an unknown `gate_id` yields `MALFORMED_ACTION`, a resolved gate or a seat not in `expected_seats` yields `GATE_CLOSED`. `engine.gate_retract{gate_id, seat}` removes the seat's submission; an unknown gate or a seat with no submission yields `MALFORMED_ACTION`, a resolved gate yields `GATE_CLOSED`. `engine.gate_resolve{gate_id}` closes the gate and moves its record, with submissions, to the resolved set; an unknown gate yields `MALFORMED_ACTION`, an already-resolved gate `GATE_CLOSED`. `engine.grant_expire{grant_id}` and `engine.grant_consume{grant_id}` remove the named grant; an unknown id yields `MALFORMED_ACTION`. An unknown `engine.*` name yields `MALFORMED_ACTION`. |
| KFR-052 | Must | **Given** a definition declares a reducer for a schema id beginning with `engine.`, **when** the definition is used with `createSession` or `apply`, **then** it is rejected with `MALFORMED_ACTION` (reserved namespace). |

### 4.7 Counters

| ID | Pri | Requirement |
|----|-----|-------------|
| KFR-060 | Must | **Given** a counter declared with `min`, optional `max`, initial value and owner (table, player, team, zone or card), **when** any action changes it, **then** the result is checked against `min` and `max` inclusive, and the arithmetic is exact `bigint`. Values never become `number` anywhere in state. |
| KFR-061 | Must | **Given** a counter declares a rounding mode (`floor`, `half_up`, `half_even`) and an action carries `ratio {num, den}` (integers, `den > 0`), **when** applied, **then** `ratioRound(x, ratio) = round(x × num / den)` using integer arithmetic only: `floor` rounds toward −∞; `half_up` rounds to nearest with ties **away from zero**; `half_even` rounds to nearest with ties to the even quotient. Counter values are integers in the counter's smallest unit; the declared `scale` is descriptive metadata and never enters the arithmetic. The mode of a `counter_transfer` is that of the **source** (`from_counter`) counter; a `ratio` on an action whose governing counter has no declared mode, or with `den ≤ 0`, yields `MALFORMED_ACTION`. |
| KFR-062 | Must | **Given** a conservation group (set of counter ids) and counters carrying `supply_role: mint|burn`, **when** a batch is applied, **then** the group's sum after the whole batch equals the sum before, except for the net `applied` amounts (KFR-034) contributed by `counter_adjust` on members with a `supply_role`. Any other net change yields `COUNTER_BOUNDS`. The check runs once at the end of the batch (a transient imbalance between actions is legal). |
| KFR-063 | Must | **Given** a derived counter declared with a pure evaluator `(snapshot) → bigint`, **when** a state is digested or read, **then** its value is computed on demand, never stored in state, and included in the digest (Req NFR-026, NFR-029). |

### 4.8 Canonical JSON and digest

| ID | Pri | Requirement |
|----|-----|-------------|
| KFR-070 | Must | **Given** any value of the kernel's state, action or definition-data types and a `CanonicalSchema` describing it (§6.2 rule 2), **when** `canonicalize(schema, value)` is called, **then** it returns a `Uint8Array` of UTF-8 bytes following **canonical profile v1** (§6.2). Function-valued members of a definition (reducers, derived evaluators) are not data and are never canonicalized. Values outside the profile or the schema (floats, `NaN`, `±Infinity`, `-0`, `undefined`, functions, symbols, cyclic structures, `Map`/`Set`/`Date` instances) yield a `CanonicalError` identifying the path. |
| KFR-071 | Must | **Given** a state, **when** `stateDigest(definition, state)` is called, **then** it builds the canonical state schema from `definition`, serialises the state with it, and returns the lower-case hex SHA-256 of those bytes. The serialisation includes, in the field order of §6.4: lifecycle, `seq`, cards (zone, orientation, metadata), zones (membership and order), zone ordinals, stored counters, `derivedCounters` (id and value of every derived counter, computed on demand), `meta`, roster, control, gates (open and resolved, with sealed submissions), delegations, grants and outcome (Req NFR-001, NFR-026, NFR-029). The session `id` is **excluded**, so a fork or re-keyed copy with identical content has the same digest. |
| KFR-072 | Must | **Given** the digest functions run inside `packages/core`, **when** they compute SHA-256, **then** they use a pure-TypeScript implementation inside core (no `node:crypto`, no `crypto.*` global, no new dependency) verified against the NIST FIPS 180-4 test vectors. |
| KFR-073 | Must | **Given** the profile, **when** this phase exits, **then** `docs/canonical-json-profile.md` states every rule of §6.2 normatively, marks the profile "frozen" and lists the golden vectors file path. Golden vectors (≥ 25 inputs, each with its schema, expected bytes and expected digest `sha256Hex(bytes)`) are committed as `packages/core/src/replay/canonical/golden-vectors.json` and asserted by a unit test. |
| KFR-074 | Must | **Given** the canonical module, **when** consumers import it, **then** it exports `canonicalize`, `stateDigest`, `sha256Hex` (taking a `Uint8Array`) and `CanonicalError` from `core/replay/canonical` (plus the types `CanonicalSchema` etc.; re-exported by `core/replay` and the package root). No consumer code in core serialises state any other way for identity purposes. |

### 4.9 Seeded PRNG and shuffles

| ID | Pri | Requirement |
|----|-----|-------------|
| KFR-080 | Must | **Given** a deterministic seed (string up to 256 UTF-8 bytes), **when** `createPrng(seed)` is called, **then** it returns `Result<Prng>` where `Prng` is an immutable `Uint32Stream` (below) of the algorithm specified in §6.3, producing a stable sequence per seed, verified by golden vectors. `interface Uint32Stream { readonly nextUint32: () => { readonly value: number; readonly next: Uint32Stream } }`, `value` being an unsigned 32-bit integer; `Prng` is a `Uint32Stream`. `core/session` also exports `uniform(stream, n) → { value, next }` (§6.3 step 3, `1 ≤ n ≤ 2^32` integer, otherwise a programmer error that throws), so tests can drive it with a scripted `Uint32Stream`. No `Math.random` and no clock. A seed over 256 UTF-8 bytes, or containing a lone surrogate, yields an `Err` of code `MALFORMED_ACTION` (no dedicated code exists). |
| KFR-081 | Must | **Given** a `Uint32Stream` (any, including a `Prng`) and an ordered list of card ids, **when** `shufflePermutation(stream, ids)` is called, **then** it returns `{permutation, next}` where `permutation` is a rearrangement of `ids` (Fisher–Yates with rejection sampling, no modulo bias) and applying `shuffle{zone, permutation}` yields exactly that order. The same seed and input give the same permutation. |
| KFR-082 | Must | **Given** `apply` processes a `shuffle` action, **when** it runs, **then** it uses only the permutation in the action and never consults the PRNG, so replay never re-randomises (Req FR-074). |

### 4.10 Rule SPI types

| ID | Pri | Requirement |
|----|-----|-------------|
| KFR-090 | Must | **Given** `core/spi`, **when** it is imported, **then** it exports the types in architecture A4 — `ValidationHook<K>`, `ReactionHook`, `GateResolveHook`, `Reducer<S>`, `AuthorizationHook`, `Accept`, `Reject`, `Allow`, `Deny`, `Effect` (with `timer_request{id, kind, duration_hint}`), `Proposal<K>`, `GateMaskedSnapshot`, `SealedBySeat`, `Action`, `Macro`. `Reducer<S>` is `(partition: Snapshot<S>, payload: unknown) => S` and is **not** asynchronous. Because core compiles with `types: []` (A2), cancellation uses a core-owned structural type `AbortSignalLike { readonly aborted: boolean; addEventListener(type: 'abort', listener: () => void): void; removeEventListener(type: 'abort', listener: () => void): void }` wherever architecture A4/A6 write `AbortSignal`; the host's `AbortSignal` is assignable to it. |
| KFR-091 | Must | **Given** `core/spi` is built, **when** its emitted JavaScript is inspected, **then** it contains no runtime code that executes hooks, no timers and no I/O (types and pure constant tables only). |
| KFR-092 | Must | **Given** a `Snapshot` of a session that has one open gate with sealed submissions, **when** `maskGates(snapshot)` (a pure function exported from `core/session`, not from `core/spi`, so KFR-091 holds) is called, **then** it returns a `GateMaskedSnapshot` (§6.4) equal to the input except that each **open** gate is replaced by `{ schemaId, expectedSeats, submitted }`, where `submitted` is the list of seats (in `expectedSeats` order) that currently hold a submission and no payload remains. Resolved gates are unchanged (their submissions are revealed by resolution; who may see them is P3's projection). The masked value is deep-readonly. |

### 4.11 Compiled-definition data types

| ID | Pri | Requirement |
|----|-----|-------------|
| KFR-100 | Must | **Given** `core/definition`, **when** imported, **then** it exports the pure-data type `CompiledGameDefinition` (and constructors for tests) holding at least: `schemaVersion` (action-schema version), card registry (id, optional type, metadata schema, starting zone), zones, zone templates (owner rule `seat|team|player|none`, ordering, `max_instances`), counters (owner, min, max?, initial, scale?, rounding?, supply_role?, derived evaluator?), conservation groups, seat/team layout (`seats: {id, team?}[]` in turn order, `teams: TeamId[]`), `viewKeys` (the vocabulary valid in `grant_view.keys`), control declarations (phase set, initial phase, turn order as a permutation of the declared seats, initial active seats, pointer names, `enforce_active_seats`, out-of-turn kinds), meta schemas (field names/types and reducer ref), roster reducer, policies (cascade cap default 16, cost budgets) and the hook binding table (key → hook ids, data only). Reducers and derived evaluators are function-valued members (the rest is plain data); they are excluded from canonicalization (KFR-070) and resolved by `apply`/`stateDigest` from the definition value they are given. |
| KFR-101 | Must | **Given** a definition value, **when** `assertDefinitionStructure(def)` is called, **then** it returns the first violation of: duplicate card ids, a card without a starting zone, a starting zone that does not exist, duplicate zone/counter/seat ids, a conservation group naming an unknown counter, a counter whose `initial` is outside its bounds, a meta schema without a reducer, a reserved `engine.` meta schema, a zone-template name that contains `/` or exceeds 48 characters, a turn order that is not a permutation of the declared seats, an initial phase outside the phase set, an initial active seat that is not declared, a seat naming an undeclared team, or an empty / duplicate `viewKeys` entry. P2's compiler adds the user-facing load-time errors; this check protects the kernel. |
| KFR-102 | Must | **Given** the kernel supports the floors of Req NFR-020, **when** a definition with 14 seats, 4 teams, 700 cards and 64 zones is created and a 20-move batch is applied, **then** no structural limit is hit. The kernel has no hard-coded limit below these floors. |

### 4.12 Port interfaces

| ID | Pri | Requirement |
|----|-----|-------------|
| KFR-110 | Must | **Given** `core/ports`, **when** imported, **then** it exports interface-only declarations (no classes, no implementation, no runtime values beyond constants) for: `SessionStore` (`commit(sessionId, expectedSeq, epoch, tx, receipt, outbox[]) → Promise<CommitResult>`, `load(sessionId, atSeq?)`, `list()`), `IdempotencyLedger` (`record(sessionId, principal, eventId, entry)`, `lookup(sessionId, principal, eventId)`), `AuthorizationPort` (`authorize(principal, op, target) → Promise<Allow|Deny>`), `LeasePort` (`acquire`, `renew`, `release`), `HookRunner` (`run(hook, ctx, signal: AbortSignalLike) → Promise<result>`), `Publisher` (`publish(committedTx) → Promise<void>`), `TimerPort` (`consume(outboxRow) → Promise<void>`). |
| KFR-111 | Must | **Given** `SessionStore.commit`, **when** specified in its TSDoc and types, **then** the contract states: atomic over actions, receipt and outbox rows; fails with `STALE_WRITER` when `expectedSeq` or `epoch` does not match; supports an empty-accepted-batch commit with `seq = null` (receipt and outbox only). The types `Transaction`, `Receipt`, `OutboxRow` (`kind: 'commit' | 'timer_request'`), `Lease` and `CommitResult` are exported. |
| KFR-112 | Must | **Given** `ops` for `AuthorizationPort`, **when** typed, **then** `op` is the union `propose:<kind> | query:<role> | subscribe:<role> | export | direct_apply | fork`. |

### 4.13 Housekeeping actions

| ID | Pri | Requirement |
|----|-----|-------------|
| KFR-120 | Must | **Given** a batch that contains `engine.grant_expire`, `engine.grant_consume` or a `roster{op: revoke_delegation}` placed by the P6 pipeline, **when** `apply` runs, **then** they are applied exactly like any other logged action, in order. `apply` never *generates* housekeeping actions itself (that is P6 step 6b). |

## 5. Business Rules

Design §2.2 invariants 1–10 are the **aggregate invariants**. They are re-stated here under stable IDs. Each rule is checked against exactly one of three things: **admission** rules (KBR-004, KBR-005, KBR-009) are checked against the *input* state and the proposal descriptor before any action is validated; **structural** rules (KBR-001–KBR-003, KBR-006–KBR-008) and counter bounds are checked on the working state after each primitive and after each reducer; **conservation** (KBR-011) is checked once, on the working state at the end of the batch. The order inside `apply` is: admission, expansion and primitive validation, end-of-batch checks, commit.

| ID | Rule | Rationale | Exceptions |
|----|------|-----------|------------|
| KBR-001 | Every card is in exactly one zone, always (invariant 1). | Cards are never duplicated or lost; closed world (design §3.3). | None. |
| KBR-002 | A `move` names a card actually in `from_zone`; positions are in bounds (invariant 2). | Prevents silent reorderings from hooks' mistakes. | Unordered zones take no position. |
| KBR-003 | A `shuffle` permutation is a rearrangement of the zone's membership (invariant 3). | Replay depends on logged permutations being valid. | Zero- or one-card zones: identity permutation is valid. |
| KBR-004 | Lifecycle transitions are `active→completed`, `active→terminated`, `completed→terminated` only. A `lifecycle` action is the **last** action of its batch (a violation on an active session is `MALFORMED_ACTION`). Admission on the raw input batch, before expansion and before the empty-batch rule: (1) on a `terminated` session every batch, including `[]`, fails `SESSION_ENDED`; (2) on a `completed` session the only admitted batch is exactly `[lifecycle(terminated)]`, and every other batch, including `[]` and any other lifecycle target, fails `SESSION_ENDED`; (3) on an active session the batch proceeds, and an illegal transition (e.g. `active→active`) is `MALFORMED_ACTION` (invariant 5). | Req FR-084. | None. |
| KBR-005 | Turn enforcement (invariant 9, turn half): when `enforce_active_seats` is `true`, a `player`-origin proposal whose acting seat is not in the **input** state's `active_seats` fails with `NOT_YOUR_TURN`, unless its kind is declared out-of-turn permitted (Req FR-132). A batch that itself changes `active_seats` is judged on the input state. | Aggregate rule, not an intake rule. | Dealer/control/system origins; absent `proposal` descriptor. |
| KBR-006 | Template zones are destroyed only when empty; `max_instances` is respected; ordinals are never reused; ids are derived from `(template, owner, ordinal)` as `<template>/<ownerToken>/<ordinal>` (`ownerToken` = owner id, or `_` for an ownerless template) (invariant 6; Req FR-193). Template names contain no `/` (KFR-101), which makes the derivation injective; a derived id over 128 characters or equal to an existing zone id is rejected (KFR-039). | Deterministic ids across replay. | None. |
| KBR-007 | A gate accepts submissions only from expected seats while open, otherwise `GATE_CLOSED` (invariant 7). | Req FR-160–FR-162. | A host `system` close is the P6 pipeline's step; kernel only applies `engine.gate_resolve`. |
| KBR-008 | Control values come from the declared phase set and existing seats (invariant 8). | Keeps control state valid for turn logic. | None. |
| KBR-009 | Lifecycle gate (invariant 9, lifecycle half): any batch on a `completed` or `terminated` session other than the one in KBR-004 fails with `SESSION_ENDED`. This is the same admission step as KBR-004 and runs before the empty-batch rule (KFR-023). | Req FR-084. | The single exception in KBR-004. |
| KBR-010 | After any reducer output the structural rules (KBR-001–KBR-003, KBR-006–KBR-008) and the counter bounds of KBR-011 are re-checked (invariant 10); conservation is still checked once at batch end. | A reducer cannot bypass structural validation (Req NFR-070). | None. |
| KBR-011 | Counter values stay within bounds; conservation groups hold except via a `supply_role` member; arithmetic is exact `bigint` (invariant 4; Req NFR-028). | Chip/score integrity. | `supply_role` members. |
| KBR-012 | The kernel imports nothing from other `@cge/*` packages and no `node:*` module, uses none of `Date`, `Math.random`, `performance.now`, `process.env`, `crypto.*`, timers, `Atomics`, `SharedArrayBuffer` (enforced by Phase 0 lint/depcruise). | Determinism and portability. | Test files may use Node types and APIs. |
| KBR-013 | `committed_at` or any wall-clock value never appears in `SessionState` or in `apply` inputs and outputs. `Effect.timer_request.duration_hint` is a host hint: effects are not logged and not state (design §2.2), and `apply` never reads, stores or digests them. | Req NFR-023 (correctness independent of client clocks). | None. |

## 6. Data & Interfaces

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

## 7. Non-Functional Requirements

| ID | Requirement (measurable) |
|----|--------------------------|
| KNFR-001 | **Determinism.** The same `(definition, initial state, batch stream)` yields identical digests in two runs in the same process, in two separate processes and in the Docker `test` image. |
| KNFR-002 | **Atomicity.** Over ≥ 1 000 fast-check runs per property, a failing batch leaves the input digest unchanged (Req NFR-040/042). |
| KNFR-003 | **Smoke performance** at the Req NFR-020 floor (14 seats, 4 teams, 700 cards, 64 zones): applying a 20-`move` batch takes ≤ 50 ms and `stateDigest` ≤ 250 ms, each measured as the median of 20 runs after 3 discarded warm-up runs inside the Docker `test` target. These are regression smoke bounds, not the NFR-010/024 targets; P9 pins those. |
| KNFR-004 | **Structural sharing** (KFR-013). At the same floor, after a 20-`move` batch whose moves touch only 4 of the 64 zones, the 60 untouched zones, the `counters` record and every untouched card entry are `===` to the input's, and each touched zone has a new reference. |
| KNFR-005 | **No new runtime dependencies** in `packages/core/package.json`; no `devDependency` added without an exact version pin (Phase 0 invariants stay green). |
| KNFR-006 | **Coverage.** Line coverage of `packages/core/src/{session,replay/canonical}` ≥ 95 % via `pnpm test:coverage`; every `KBR` other than KBR-012/KBR-013 has at least one failing-path test; KBR-012 and KBR-013 are covered by the static checks VC-065, VC-105 and VC-094. |
| KNFR-007 | **Guardrails stay green.** `docker compose -f deploy/docker-compose.test.yml run --rm tests` exits 0 with lint, typecheck, depcheck, `test` and `test:guardrails` passing. |

## 8. Verification Criteria

Unless stated otherwise, every VC is an automated test in `packages/core/**` run by `pnpm test` inside the Docker `test` target.

### Types, ids, errors

- VC-001: Guard of each **string** id type given `""`, a 129-char string, a string containing a space, and `"seat-1"` → rejects the first three, accepts the last. The `Seq` guard accepts `0` and `Number.MAX_SAFE_INTEGER`, and rejects `-1`, `1.5`, `2**53` and `"1"`. *(KFR-001)*
- VC-002: Type-level test (`expectTypeOf` / `@ts-expect-error`) assigns a `CardId` to a `ZoneId` variable → compile error asserted. *(KFR-001)*
- VC-003: A compile-time exhaustive `switch` over `ErrorCode` handles exactly the 24 codes of KFR-002, and a test iterates the exported runtime list and compares it to that set → equal. *(KFR-002)*
- VC-004: Batch `[move(valid), move(card not in zone)]` → `ok:false`, `code = CARD_NOT_IN_ZONE`, `actionIndex = 1`, `detail` contains the card id. A batch `[draw 2, move(card not in zone)]` → `actionIndex = 1`; a `draw` that fails with `EMPTY_ZONE` at input index 2 → `actionIndex = 2`; a reducer failure at input index 3 → `actionIndex = 3`; a conservation failure caused by two adjusts at input indices 0 and 2 → `actionIndex = 2`; `MALFORMED_ACTION` carries the field `path`; a `createSession` error has `actionIndex === undefined`. A type test asserts the `EngineError` shape of §6.4. *(KFR-003)*
- VC-005: Fuzz 1 000 random malformed objects (wrong kinds, missing fields, extra fields, `null`, arrays) → `apply` returns an `Err` for each and never throws. *(KFR-004, KFR-028)*

### State, snapshot and immutability

- VC-010: `createSession` on a 10-card fixture → `seq = 0`, `lifecycle = active`, each card's zone equals its declared starting zone, counters equal initial values, no gates, grants or delegations; the returned state passes the VC-013 freeze walk and is accepted by `apply` without throwing. *(KFR-010)*
- VC-011: `createSession` with an undeclared seat, a declared seat missing from the roster, a duplicate seat, a team that differs from the layout's, a `team` on a seat the layout declares without one, and a duplicate player → each `Err` `MALFORMED_ACTION` naming the offending id, with no `actionIndex`; a valid roster → ok. *(KFR-014, KFR-003)*
- VC-012: `@ts-expect-error` test: assigning to `snapshot.zones[z].members[0]`, `snapshot.counters[c]` and `snapshot.control.phase` → compile errors. *(KFR-011)*
- VC-013: After a successful `apply`, recursively walk the new state → every object/array is frozen, including nested metadata and gate submissions. *(KFR-012)*
- VC-014: Mutation guard: cast the state to a mutable type and attempt `push`, assignment and `delete` inside `try/catch` → each throws in strict mode (frozen), and `stateDigest` is unchanged afterwards. *(KFR-012, Phase 1 exit "mutation-guard")*
- VC-015: `apply` of one `move` on a 64-zone state → the 62 untouched zones are `===` to the input's; the two touched zones differ; untouched `counters` object is `===`. A 20-`move` batch confined to 4 zones → the other 60 zones are `===`. *(KFR-013, KNFR-004)*

### `apply` contract

- VC-020: `apply` called on a fixture → return value is not thenable (`typeof value.then !== 'function'`); a static test asserts `apply.constructor.name !== 'AsyncFunction'`. *(KFR-020)*
- VC-021: Run `apply` with `Date`, `Math.random` and `performance.now` replaced by throwing stubs → still succeeds. *(KFR-020, KBR-012)*
- VC-022: Property: for random valid states and random batches that fail somewhere, the input digest and input reference are unchanged after the call. *(KFR-021, KNFR-002)*
- VC-023: Valid 3-action batch → `seq` goes from n to n+1 and `committed` has 3 actions in order. *(KFR-022)*
- VC-024: Batch `[]` and batch `[draw count 0]` → `ok`, returned state `===` input, `committed = []`, `seq` unchanged. *(KFR-023)*
- VC-025: Apply the same stream twice from `createSession` → identical `committed` arrays (canonical bytes) and identical digest after every step. *(KFR-024, KNFR-001, Phase 1 exit "same stream twice")*
- VC-026: Batch with `draw`, `zone_merge` and `reset_to_zone` → `committed` contains no action whose kind is a macro. *(KFR-025)*
- VC-027: Player proposal from a seat not in `active_seats` with `enforce_active_seats = true` → `NOT_YOUR_TURN`; same proposal for an out-of-turn kind → ok; same proposal with `origin = 'dealer'` → ok; same proposal with no descriptor → ok. A player in `active_seats` proposing `[control_set{active_seats:[other]}]` → ok (judged on the input state). Same input, `opts` differing only in `proposal` → results may differ; same `opts` → identical. *(KFR-020, KFR-026, KBR-005)*
- VC-028: Batch ending with `lifecycle(completed, outcome)` → result has one `SessionEnded` with that outcome; then `lifecycle(terminated)` → one more; a batch with no lifecycle action → none. *(KFR-027)*
- VC-029: Action objects with an unknown `kind`, a missing `card_id`, an extra field, `count: 1.5` and `steps: 0` → each `MALFORMED_ACTION` with the field path in `detail`. *(KFR-028)*

### Primitive actions

- VC-030: `move` into position 0, middle, end of an ordered zone; into an unordered zone (appended) → membership and order exactly as expected, `card.zone` updated. *(KFR-030)*
- VC-031: `move` with the card in another zone → `CARD_NOT_IN_ZONE`; position `len+1` → `MALFORMED_ACTION`; negative position → `MALFORMED_ACTION`; missing position on an ordered zone → `MALFORMED_ACTION`; `to_position` on an unordered zone → `MALFORMED_ACTION`; unknown `to_zone` → `MALFORMED_ACTION`. Same-zone vector on `[A,B,C,D]`: `move D→index 1` → `[A,D,B,C]`; `move A→index 3` → `[B,C,D,A]` (post-removal length 3, so 3 is append); `move A→index 4` → `MALFORMED_ACTION`. *(KFR-030, KBR-002)*
- VC-032: `flip` to each orientation; flip to current orientation → ok with unchanged state but `seq` still advances; unknown card → `MALFORMED_ACTION`. *(KFR-031)*
- VC-033: `shuffle` with a valid permutation → zone order equals it; with a missing id, a duplicate id, an extra id, a different length, or on an unordered zone → `MALFORMED_ACTION`; one-card zone with identity → ok. *(KFR-032, KBR-003)*
- VC-034: `set_metadata` valid field changes only that field; undeclared field and wrong-typed value → `MALFORMED_ACTION`. *(KFR-033)*
- VC-035: `counter_adjust` to exactly `min`, exactly `max`, `min−1`, `max+1`; amounts above 2^64 within bounds → boundary values succeed, outside values `COUNTER_BOUNDS`, big values exact. Adjusting a derived counter → `MALFORMED_ACTION`. *(KFR-034, KFR-060, KBR-011)*
- VC-036: `counter_transfer` of 0, of the full source balance, of more than the balance (source would go below `min`), negative amount, transfer to a counter at `max` → `ok`, `ok`, `COUNTER_BOUNDS`, `MALFORMED_ACTION`, `COUNTER_BOUNDS` respectively; sum of the two is unchanged on success. *(KFR-035)*
- VC-037: `control_set` with a phase inside and outside the set, an unknown seat, `direction` 0 → ok, `MALFORMED_ACTION`, `MALFORMED_ACTION`, `MALFORMED_ACTION`. Only the named fields change. *(KFR-036, KBR-008)*
- VC-038: `turn_order [A,B,C]`, `active_seats [A]`, B `sitting_out`, `control_advance` steps 1, direction +1 → `active_seats [C]`; steps 2 → `[A]` (wraps); direction −1, steps 1 from A → `[C]`; `control_advance{pointer:"button"}` from `pointers.button = A` → only `pointers.button` changes, `active_seats` unchanged; missing pointer or empty `active_seats` → `MALFORMED_ACTION`; all seats not `seated` → `MALFORMED_ACTION`; `mode: until_quiescent` → `MALFORMED_ACTION`; `steps: 0` → `MALFORMED_ACTION`. *(KFR-037)*
- VC-039: On an **active** session: `lifecycle` legal (`active→completed`, `active→terminated`) → ok; `active→active` → `MALFORMED_ACTION`; a `lifecycle` action followed by another action in the same batch → `MALFORMED_ACTION`. *(KFR-038, KBR-004)*
- VC-040: Ended-session admission (before expansion and the empty-batch rule): on `completed`, batch `[lifecycle(terminated)]` → ok; on `completed`, batch `[move]` → `SESSION_ENDED`; on `completed`, batch `[]` and `[draw count 0]` → `SESSION_ENDED`; on `completed`, `[lifecycle(active)]` and `[lifecycle(completed)]` → `SESSION_ENDED`; on `completed`, batch `[lifecycle(terminated), move]` → `SESSION_ENDED`; on `terminated`, any batch including `[]` and `[lifecycle(terminated)]` → `SESSION_ENDED`; in all failing cases state is unchanged. *(KBR-004, KBR-009, KFR-023)*
- VC-041: `zone_create` for template with `max_instances = 2` three times in sequence across batches → third fails `ZONE_LIMIT`; created ids equal `<template>/<owner>/<ordinal>` with ordinals 1, 2; destroy ordinal 1 then create again → new ordinal is 3, never 1. *(KFR-039, KBR-006)*
- VC-042: `zone_create` with an explicit `zone_id` that differs from the derived one → `MALFORMED_ACTION`; matching one → ok. A derived id over 128 characters → `MALFORMED_ACTION`; a derived id equal to an existing configured zone id → `MALFORMED_ACTION`; two distinct `(template, owner)` pairs never derive the same id (templates may not contain `/`). `zone_destroy` of a non-empty zone, a non-template zone, an unknown zone → each `MALFORMED_ACTION`. A `none`-rule template: `zone_create` without owner → id `<template>/_/1`, owner absent, `zoneOrdinals` key `<template>/_`; with an owner → `MALFORMED_ACTION`; a `seat`-rule template with no owner or an owner not in the layout → `MALFORMED_ACTION`. *(KFR-039, KFR-101, KBR-006)*
- VC-043: `grant_view` with valid targets/grantees and each scope → stored with distinct ids of the form `grant/<seq+1>/<i>`; batch `[draw 2, grant_view, grant_view]` at seq n → ids `grant/<n+1>/2` and `grant/<n+1>/3`, and replaying the committed actions as one batch yields the same ids; grantee role `dealer` or `auditor`, unknown seat or team, a key outside `viewKeys`, empty or duplicate keys, a `top` target on an unordered zone, a range/filter target, `until_seq` with `n < seq+1`, an unknown scope kind → each `MALFORMED_ACTION`; the three valid target shapes and three scope kinds are stored as given; `revoke_view` of an existing and of an unknown id → ok / `MALFORMED_ACTION`. *(KFR-040)*
- VC-044: `delegate` then `revoke_delegation` of `(S, P)` → delegation present, then absent; two delegations `(S, P1)`, `(S, P2)` and revoking `(S, P1)` leaves only `(S, P2)`; a duplicate `delegate (S, P)`, a revoke of an absent pair, an unknown seat, an empty or over-256-byte principal → `MALFORMED_ACTION`; substituting the player on S keeps the delegation attached to S. *(KFR-041)*
- VC-045: `meta` with a registered reducer → only that partition changes to the reducer's output; unregistered `schema_id` → `MALFORMED_ACTION`; a `roster` `join` handled by the roster reducer → only `roster` changes. *(KFR-042)*

### Macros

- VC-046: `draw` 3 from a 5-card ordered zone `[c1..c5]` into an ordered `to_zone` holding 2 cards → `committed` is exactly `move(c1, …, to_position 2)`, `move(c2, …, 3)`, `move(c3, …, 4)`; with macro `to_position: 0` → positions 0, 1, 2; into an unordered zone → moves carry no position; 6 from a 5-card zone → `EMPTY_ZONE`, nothing committed; `count 0` → empty; `from_zone = to_zone` → `MALFORMED_ACTION`. *(KFR-045)*
- VC-047: `zone_merge` of two template zones → one `move` per card in `src` (in `members` order, appended with explicit positions) followed by `zone_destroy(src)`; with a non-template zone → `MALFORMED_ACTION`; with an empty `src` → just the `zone_destroy`. *(KFR-046)*
- VC-048: `reset_to_zone` from three zones of which one is empty → `move`s ordered as specified (appended positions) followed by `flip` for exactly the cards that were face-up at the start. *(KFR-047)*
- VC-049: Batch `[shuffle zone Z, draw 2 from Z]` → the draw's expansion uses the shuffled order; batch `[draw 5 from a zone with 3 cards after a preceding move of 2 more into it]` → succeeds, proving sequential expansion. *(KFR-048)*
- VC-050: `nextZoneId` returns the id that the following `zone_create` produces; a batch `[zone_create(t, o), zone_create(t, o), move into nextZoneId(state, t, o, 1)]` → ok, and `nextZoneId(state, t, o, 0)` names the first created zone. *(KFR-049)*

### Reducers and engine partitions

- VC-051: A reducer that returns a value containing a float, a function or a cyclic object → `REDUCER_ERROR`; a reducer that throws → `REDUCER_ERROR`; a reducer whose output leaves a counter out of bounds because it also mutated counters through a cast → `REDUCER_ERROR` or rejected by the freeze (state unchanged either way). *(KFR-050, KBR-010)*
- VC-052: Each `engine.*` action on valid input → expected state change (gate opened with expected seats; sealed submission stored; a second submit by the same seat replaces it; retract removes it; resolve moves gate to `resolved`; expire/consume remove the grant); unknown `engine.nope` → `MALFORMED_ACTION`. Failing paths: `gate_open` with a duplicate `gate_id`, empty `expected_seats`, duplicate or unknown seats → `MALFORMED_ACTION`; `gate_retract` of an absent submission or unknown gate → `MALFORMED_ACTION`; `gate_resolve` of an unknown gate → `MALFORMED_ACTION`, of a resolved gate → `GATE_CLOSED`; `grant_expire`/`grant_consume` of an unknown id → `MALFORMED_ACTION`. *(KFR-051)*
- VC-053: `engine.gate_submit` from a seat not expected, to a resolved gate, and to an unknown gate → `GATE_CLOSED`, `GATE_CLOSED`, `MALFORMED_ACTION`. *(KBR-007)*
- VC-054: A definition that declares a reducer for `engine.custom` → `assertDefinitionStructure` returns an error and `createSession` fails. *(KFR-052, KFR-101)*

### Counters

- VC-055: `counter_adjust` `applied` table (floor / half_up / half_even): `delta 5, 1/3` → 1 / 2 / 2; `5, 1/2` → 2 / 3 / 2; `-5, 1/2` → −3 / −3 / −2; `7, 1/2` → 3 / 4 / 4; `3, 3/2` → 4 / 5 / 4; `100, 5/100` → 5 / 5 / 5. `counter_transfer` amount 7, ratio 1/3, `floor` → `from −= 7`, `to += 2`, `remainder_to += 5`, group sum unchanged; amount 7, ratio 1/2, `half_up` → `to += 4`, `remainder_to += 3`; a non-zero remainder with no `remainder_to` → `MALFORMED_ACTION`; `remainder_to` equal to `from_counter` → net change computed first, bounds on the final value. `ratio` with `den = 0` → `MALFORMED_ACTION`; `ratio` on a counter with no rounding mode → `MALFORMED_ACTION`; `scale` set on a counter changes no arithmetic result. *(KFR-034, KFR-035, KFR-061)*
- VC-056: Conservation group `{pot, a, b}` with `counter_transfer` among them → sum unchanged, ok; `counter_adjust` on a non-supply member that changes the sum → `COUNTER_BOUNDS`; `counter_adjust` on a `mint` member → ok; batch `[adjust(a,−1), meta(no-op reducer), adjust(b,+1)]` → ok (conservation holds at batch end although the intermediate state is imbalanced). *(KFR-062, KBR-010)*
- VC-057: Property (fast-check, ≥ 1 000 runs): random sequences of legal and illegal counter batches over a conservation group → at every step the group sum equals the initial sum plus the logged supply-role adjustments. *(KFR-062, KBR-011, Phase 1 exit "conservation")*
- VC-058: Derived counter `hand_size` over a zone → value is recomputed after a `move`, is not present in `state.counters`, and appears in the canonical state serialisation under `derivedCounters`, immediately after `counters`. *(KFR-063, KFR-071)*

### Canonical JSON and digest

- VC-060: `canonicalize(schema, value)` on each golden vector (≥ 25, each file entry naming its schema: empty object, nested arrays, bigint 0/−1/2^200, strings with quotes/backslashes/control chars/U+007F/U+2028/astral characters/non-ASCII, booleans, null where declared, `idMap`s with keys differing by case and by code point order, a `json` node with unsorted keys, etc.) → bytes equal the committed expected bytes **and** `sha256Hex(bytes)` equals the committed expected digest. *(KFR-070, KFR-073)*
- VC-061: `canonicalize` (with a fitting schema) of `1.5`, `NaN`, `Infinity`, `-0`, `2^53`, `undefined`, a function, a cyclic object, a `Map`, a `Date`, a lone surrogate string, a meta payload with an undeclared field, and a `bigint` inside a `json` node → `CanonicalError` with the offending path in each case. *(KFR-070)*
- VC-062: Two states reaching the same logical content by different insertion orders of map keys → identical bytes and digest. *(KFR-070, KFR-071)*
- VC-063: `stateDigest` changes when each of the following changes alone: lifecycle, seq, card orientation, card metadata, zone order, zone membership, zone ordinal, stored counter, derived counter input, meta, roster, control, open gate, sealed submission, resolved gate, delegation, grant, outcome. One test per field. *(KFR-071, Req NFR-026/029)*
- VC-064: `sha256Hex` on the NIST FIPS 180-4 vectors (`""`, `"abc"`, the 448-bit message, one million `a`) → expected digests; plus agreement with `node:crypto` on 200 random byte strings in a **test** file. *(KFR-072)*
- VC-065: Static check (existing guardrail lint plus a grep test) that no **non-test** file (excluding `**/*.test.ts`) under `packages/core/src` has an import specifier starting `node:` or `crypto`, or an identifier `crypto`/`globalThis.crypto` → none found (comments are ignored). *(KFR-072, KBR-012)*
- VC-066: `docs/canonical-json-profile.md` exists, contains the words "frozen" and the path `packages/core/src/replay/canonical/golden-vectors.json`, and a test asserts each numbered rule 1–8 of §6.2 is present as a heading or list entry. *(KFR-073)*
- VC-067: A golden-digest test applies a committed fixed stream of 30 batches (covering every primitive kind) to a fixture definition and asserts the expected digest at seq 0, 10, 20 and 30 against committed values. *(KFR-071, golden-vector exit criterion)*
- VC-068: `core/replay/canonical` public runtime exports are exactly `canonicalize`, `stateDigest`, `sha256Hex`, `CanonicalError` (plus types), asserted by an export-list test on that module's namespace; the package root re-exports each of the four (containment, not equality, since the root also exports ids, errors, `apply`, …). *(KFR-074)*

### PRNG and shuffles

- VC-070: `createPrng("seed-a")` (a `Result`) produces the committed first 10 values (generated from the §6.3 algorithm, with the intermediate seed words also committed); `"seed-a"` twice → identical; `"seed-b"` → different; the empty string and a 256-byte seed → work; a 257-byte seed and a seed with a lone surrogate → `Err` `MALFORMED_ACTION`. *(KFR-080)*
- VC-071: `shufflePermutation` over 0, 1, 2 and 52 ids → output is a rearrangement of the input; same seed → same permutation; over 10 000 shuffles of 3 ids with different seeds → each of the 6 arrangements appears 1 667 ± 150 times (sanity check only; it cannot detect modulo bias at this size). Rejection sampling is verified with a scripted `Uint32Stream` over outputs `[0xFFFFFFFF, 7, 9]`: `uniform(stream, 3)` discards the first (≥ `limit = 4294967295`) and returns `value = 7 mod 3 = 1`, consuming exactly two draws, and the returned `next` stream yields `9` next. `uniform(stream, 0)` and `uniform(stream, 2**32 + 1)` throw (programmer error). *(KFR-081)*
- VC-072: Apply `shuffle` with a given permutation while the `Prng` module is stubbed to throw → succeeds and result equals the permutation. *(KFR-082)*

### SPI, definition, ports

- VC-080: Type-level tests assert the exported SPI types accept the architecture A4 shapes and that `Reducer<S>` returns `S`, not `Promise<S>`. *(KFR-090)*
- VC-081: Compiled `core/spi` JavaScript has only type-erased and constant exports (every runtime export is a frozen constant; no function is exported from `core/spi`); no `setTimeout`, `import(`, or `await` appears in the emitted output. *(KFR-091)*
- VC-082: `maskGates` (imported from `core/session`) on a state with two open gates, three sealed submissions and one resolved gate with a submission → open gates become `{schemaId, expectedSeats, submitted}` with `submitted` listing exactly the submitting seats and no payload anywhere in them; the resolved gate is unchanged; everything else `===` the input; result deep-frozen; a type test asserts the `GateMaskedSnapshot` shape. *(KFR-092)*
- VC-083: `assertDefinitionStructure` on fixtures with a duplicate card id, a missing starting zone, an unknown starting zone, duplicate zone/counter/seat ids, a conservation group with an unknown counter, `initial` out of bounds, a meta schema with no reducer → returns an error naming the entity for each; a valid fixture → no error. *(KFR-101)*
- VC-084: Floor test: a 14-seat/4-team/700-card/64-zone definition → `createSession` ok; a 20-move batch ok; digest computed. *(KFR-102)*
- VC-085: A test file declares in-memory objects implementing every port interface using only the exported types; it compiles under `tsc -p tsconfig.test.json`. The ports module's emitted JavaScript exports no class and no function. *(KFR-110)*
- VC-086: Type test: `SessionStore.commit` accepts `seq: null` empty-batch transactions, its TSDoc contains `STALE_WRITER`, and `OutboxRow['kind']` equals `'commit' | 'timer_request'`. *(KFR-111)*
- VC-087: Type test: `AuthorizationPort.authorize` rejects an `op` string outside the union at compile time. *(KFR-112)*
- VC-088: Batch `[engine.grant_consume(g), roster revoke_delegation, move]` is committed in the same order, with each applied exactly once; `apply` of a batch without them produces none. *(KFR-120)*
- VC-089: A type/shape test builds a `CompiledGameDefinition` using every component listed in KFR-100 (including a derived evaluator, a reducer and a hook binding table), and `canonicalize` of its data portion succeeds while the function-valued members are not serialised. *(KFR-100, KFR-070)*
- VC-094: Static test: no file under `packages/core/src` (excluding tests) declares `committed_at` or any timestamp-typed field in `SessionState`, `ApplySuccess` or `ApplyOptions`; a fixture that adds one makes the test fail; `apply` is unaffected by an `Effect.timer_request` value (never read). *(KBR-013)*
- VC-095: Type test (in `tsconfig.test.json`, which provides Node/DOM types): a host `AbortSignal` is assignable to `AbortSignalLike`; the production `tsconfig.json` (`types: []`) compiles SPI and ports without referencing `AbortSignal`. *(KFR-090, KFR-110)*

### Invariants and properties (phase exit criteria)

- VC-090: Property: random states and batches built from all primitives; for each failing batch the digest is unchanged (atomicity); ≥ 1 000 runs. *(KBR-001–KBR-011, KNFR-002, exit: atomicity)*
- VC-091: Property: after any successful batch, every card appears in exactly one zone's `members` and `cards[c].zone` equals that zone. ≥ 1 000 runs. *(KBR-001)*
- VC-092: Property: replaying the committed actions of any successful stream from `createSession` with `apply` reaches the same digest at every step as the live run. *(KFR-024, preview of Req NFR-001)*
- VC-093: Mutation-guard test of the Phase 1 exit criteria is VC-014. Conservation property is VC-057. Atomicity property is VC-022/VC-090. Same-stream-twice is VC-025. Golden vectors are VC-060/VC-067. *(Exit-criteria index)*

### Non-functional and phase gates

- VC-100: Performance smoke at the NFR-020 floor: median of 20 runs (after 3 warm-ups) of a 20-`move` batch ≤ 50 ms and of `stateDigest` ≤ 250 ms in the Docker `test` target; structural sharing check VC-015 (including its 4-zone 20-move case) at the same size. *(KNFR-003, KNFR-004)*
- VC-101: `git diff` against Phase 0 shows no change to guardrail tests except the explicit `packages/core` exemption in the skeleton-purity check (the check still fails for a non-core package that contains code); `pnpm test:guardrails` passes. *(§6.5, KNFR-007)*
- VC-102: `packages/core/package.json` has no `dependencies` and the same `devDependencies` as before (or exact pins); Phase 0 repo invariants 1–7 pass. *(KNFR-005)*
- VC-103: `pnpm test:coverage` reports ≥ 95 % lines for `packages/core/src/session` and `packages/core/src/replay/canonical`; a script lists each `KBR` with at least one failing-path test name containing its id. *(KNFR-006)*
- VC-104: `docker compose -f deploy/docker-compose.test.yml run --rm tests` exits 0 on a clean checkout; running it twice produces identical golden-digest test results. *(KNFR-001, KNFR-007)*
- VC-105: Seeding a forbidden import (`import 'node:fs'` in `packages/core/src/session`) and a forbidden global (`Date.now()`) in a scratch branch/fixture → the Phase 0 guardrail suite still reports them (fixture-based; no real file is committed). *(KBR-012)*

## 9. Open Questions

None. Decisions taken on 2026-10-19 are folded into the normative sections: `Seq` is a safe-integer `number` (§6.2 rule 5, A8); roster `join`/`leave` have no engine-side default (KFR-042, Scope/Out); gate quorum, timeout and nested gates (Req FR-164–FR-167) are out of P1 (Scope/Out); the id charset of §6.1 stands.

## 10. Assumptions

- A1. Node 22.23.3 / TypeScript 6.0.3 / Vitest 5.0.5 / fast-check 4.10.2 as pinned in Phase 0. No immer; immutability is hand-rolled (structural sharing by hand), since core takes no runtime dependencies.
- A2. `packages/core` sources compile with `types: []`; neither `TextEncoder` nor `Buffer` is available, so UTF-8 encoding is implemented in core.
- A3. Compiled definitions are built in code in tests (a builder lives under `packages/core/src/**/*.testing.ts`, excluded from package exports and from the production `tsconfig.json` via its `exclude`, and compiled only by `tsconfig.test.json`); the YAML compiler arrives in P2.
- A4. The P2 compiler will output exactly `CompiledGameDefinition`; if P2 needs a change, P1's types change in P2 with a regression test here, not a fork.
- A5. `Action` and `Macro` payload schemas follow `docs/requirements.md` §5.6.3 and design §2.2 exactly; any deviation is recorded in the golden-vector document. Deliberate P1 deviations: (a) an out-of-bounds `move` position is `MALFORMED_ACTION`, not `CARD_NOT_IN_ZONE` (KFR-030); (b) `counter_adjust` credits no rounding remainder (KFR-034; Req FR-126 mentions one, deferred); (c) `half_up` rounds ties away from zero (KFR-061).
- A6. A game with `enforce_active_seats = false` (default) never sees `NOT_YOUR_TURN` from the kernel.
- A7. Hooks and the ProposalHandler never run inside `apply`; the batch they pass in is already the full output of steps 5–7b.
- A8. Sessions never exceed `Number.MAX_SAFE_INTEGER` (2^53 − 1) transactions, so `Seq` is a safe-integer `number`; `apply` treats a commit that would exceed it as a violated precondition (it may throw).

## 11. Changelog

- 0.4 (2026-10-19): applied the `/review-spec` MUST items. Defined `EngineError` (§6.4, `actionIndex` optional, `path`); concrete `GateMaskedSnapshot`/`MaskedGate`/`SealedBySeat` and resolved-gate behaviour (KFR-092); ownerless zone templates and owner validation via `ownerToken` `_` (KFR-039, KBR-006); delegation identity `(seat, principal)` (KFR-041); concrete grant target/keys/scope shapes and `viewKeys` vocabulary (KFR-040, KFR-100); typed `RosterEntry`, seat-layout and roster validity, `params` dropped from `createSession` (KFR-010/014/100/101); `Uint32Stream` + exported `uniform` so rejection sampling is testable (KFR-080/081, VC-071).
- 0.3 (2026-10-19): applied the cross-agent review (Codex, Cursor; arbiter-triaged). Ordered lifecycle admission (KBR-004/009) and per-rule "checked against" semantics (§5); schema-aware `canonicalize(schema, value) → Uint8Array` and normative state shapes with `derivedCounters` (§6.2, §6.4, `id` excluded from the digest); ratio/remainder accounting and tie rules (KFR-034/035/061); `GrantId = grant/<seq+1>/<i>`; complete gate payload and error table; move/draw position semantics and `nextZoneId(…, pending)`; control cursor model; zone-id injectivity and length; normative PRNG algorithm; `AbortSignalLike`; `maskGates` moved to `core/session`; KFR-039/040/062/063 promoted to Must (they gate VC-067/VC-057); KNFR-004 rewritten; new VC-089/094/095; assorted VC fixes.
- 0.2 (2026-10-19): open questions resolved and folded into Scope/Assumptions.
- 0.1 (2026-10-19): initial draft from `docs/implementation_plan.md` Phase 1.
