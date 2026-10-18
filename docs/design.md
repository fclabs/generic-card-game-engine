# Generic Card Game Engine — Domain Design (DDD)

**Status:** Draft v2 (after peer review — see §9)
**Source:** `docs/requirements.md` (ids written `FR-xxx` / `NFR-xxx`)
**Scope:** Technology-neutral domain model. It states required *properties* (atomic, deterministic, fail-closed); mechanisms such as copy-on-write, hashing or storage layout are implementation choices and are not prescribed.

---

## 1. Strategic design

### 1.1 Domain vision

A reusable engine that hosts event-driven card games. The engine owns *structure and mechanics* (cards, zones, counters, control, visibility, ordering, history). Game implementers own *meaning* (rules, scoring, legal moves) and plug it in through the **Rule SPI** (hooks and reducers).

### 1.2 Subdomains

| Subdomain | Type | Why |
|-----------|------|-----|
| **Session Play** (state, transactions, history of changes) | **Core** | Deterministic, replayable, atomic state change. |
| **Visibility** (entitlements, projections) | **Core** | Hidden information is the hard part of card games; fail-closed by default. |
| **Game Definition** (declarative ruleset + Rule SPI) | **Core (extension seam)** | The only legal way to add behaviour (NFR-030). |
| **Intake** (idempotency, ordering, publication) | Supporting | The edge contract; transport is outside. |
| **Replay & Export** | Supporting | Consumes the history; no rules of its own. |
| **Access** (principals, authorization) | Generic | Host asserts principals; engine only enforces actor binding. |
| **Conformance & helper libraries** | Generic | Outside the core. |

### 1.3 Bounded contexts

| Context | Responsibility | Owns |
|---------|----------------|------|
| **Game Definition** | Describes a game: card registry, zones, templates, counters, schemas, visibility declarations, policies, plus the Rule SPI implementations | `GameDefinition` (immutable value, versioned, content-identified); `RuleSet` SPI |
| **Session Play** | Applies proposals to authoritative state, transactionally | `Session` aggregate (incl. grants, gates, delegations), its event stream (the action log) |
| **Visibility** | Decides what each viewer may see and produces projections | `VisibilityPolicy` (compiled from the definition), `RoleRegistry`, `Projector` |
| **Intake** | One total order per session; idempotent handling of inbound events; publishing outbound events | `IdempotencyLedger` (receipts), `Subscription`, `ProposalResult` |
| **Replay & Export** | Rebuild state at any `seq`, export/import packages, fork | `ReplayPackage`; services only (no aggregate) |
| **Access** | Maps principal → roles/subjects | Host-owned; engine sees a `Principal` value and an `AuthorizationPort` |

### 1.4 Context relationships

```
 game authors ──implement──▶ Rule SPI ◀────────── Game Definition
                                                     │ published language (OHS)
                                                     ▼
┌─────────┐  Proposal   ┌──────────────┐  Snapshot, Grants  ┌────────────┐
│ Intake  │────────────▶│ Session Play │═══════════════════▶│ Visibility │
│         │◀────────────│              │   shared kernel    └─────┬──────┘
└──▲───┬──┘ committed   └──────┬───────┘                          │ projections
   │   │    transactions      │ event stream                      ▼
   │   └──────────────────────┼───────────────────────────▶ subscribers (via Intake)
┌──┴─────┐                    ▼
│ Access │             ┌──────────────┐
│ (port) │             │Replay & Export│
└────────┘             └──────────────┘
```

| Relationship | Pattern | Rationale |
|--------------|---------|-----------|
| Game Definition → all consumers | **Open Host Service + Published Language.** The engine is upstream; game authors conform to its schemas and SPI. | The artifact is the contract; replay, conformance and tooling read its declarative part without running hooks. |
| Intake → Session Play | **Conformist to `Proposal`.** Intake translates wire events into the domain's `Proposal`; wire concepts (`event_id` handling, fingerprints) stop at Intake. | Session Play stays free of transport concerns. |
| Session Play ↔ Visibility | **Shared kernel**: `Snapshot`, `Grant`, entitlement vocabulary. | Both must agree exactly on what a grant and a projection key mean; any divergence is a leak. |
| Access → engine | **Port (anti-corruption)**; the host is the upstream conformist. | The engine never invents identity; it enforces actor binding only. |
| Session Play → Replay | **Customer/supplier** over the event stream. | Replay is a pure consumer. |

### 1.5 Ubiquitous language

Terms follow requirements §3. Collisions found in review are resolved as follows:

| Term | Meaning (single) | Not to be confused with |
|------|------------------|-------------------------|
| **GameOutcome** | Result of the game (`winner_ids`, `reason`, `carry_over`…); FR-181 | **ProposalResult** — Intake's answer to one inbound event (`accepted(seq)`, `rejected(code)`, `duplicate`) |
| **Snapshot** | Omniscient, read-only state; internal, given to hooks | **View** — projected, role-scoped, the only thing that crosses outward |
| **Action** | A logged primitive fact | **Macro** — unexpanded intent, never logged |
| **Effect** | Non-logged hook output (timer request) | Action |
| **Rule SPI** | Plug-in contract implemented by game authors (hooks, reducers) | Port (infrastructure dependency) |

Action names follow requirements §5.6.3 (`lifecycle`, `meta`, `roster`, …). They are *commands to change state*, distinct from the state they change (`Lifecycle`, `MetaState`, `Roster`).

---

## 2. Tactical design

### 2.1 Game Definition

`GameDefinition` is an **immutable value** identified by its content (no behaviour, no transactional lifecycle, so not an aggregate). "Changing" a game produces a new definition; variants are separate definitions.

```
GameDefinition
├─ identity: DefinitionId, content identity, action-schema version
├─ InitialConfig
│   ├─ card registry: CardId, optional type, metadata schema   (static card facts)
│   ├─ zones, zone templates (owner rule, ordering, visibility, max_instances)
│   ├─ counters (bounds, owner, supply_role, conservation groups, scale/rounding, derived expressions)
│   ├─ seat/team layout; control declarations (phase set, pointer names, enforce_active_seats, out-of-turn kinds)
│   └─ deterministic setup parameters
├─ MetaSchemas  (versioned; per-field public | role/subject-visible | secret)
├─ VisibilityDeclarations  (static rules per projection key; custom role registrations)
├─ Policies  (cascade cap, cost budgets, gate quorum/timeout rules)
└─ RuleSet  (Rule SPI implementations)
```

Invariants: card ids unique; every card has a starting zone; every `meta` schema declares per-field visibility; a reducer exists for each schema; everything replay depends on is covered by the content identity. Engine-reserved `engine.*` schemas are supplied by the engine with fixed visibility (§2.3).

#### Rule SPI (what game authors implement)

| Extension | Input | Output | Runs |
|-----------|-------|--------|------|
| `ValidationHook` (per inbound kind) | Snapshot (gate-masked, §2.2), proposal, `{acting_seat, on_behalf_of?}` | accept \| reject(reason) | live only |
| `ReactionHook` | Working-state Snapshot + inbound event | `Action \| Macro` list, `Effect` list | live only |
| `GateResolveHook` | sealed payloads in seat order + missing seats | `Action \| Macro` list | live only |
| `Reducer` for `meta` / `roster` | the owning partition + payload | typed delta on that partition | **live and replay** |
| `AuthorizationHook` | principal, op, target | allow \| deny | live only |

**Hook routing.** Hooks are registered under a routing key: *inbound event kind*, *phase*, or *named trigger* (`setup`, `gate_resolved:<schema>`, `hand_boundary`). Within one transaction the engine runs hooks sequentially in registration order; a hook runs when its key matches the inbound event or a trigger raised by an action already in the working batch (cascade, FR-053a). Each hook sees the working state and the original event. Klondike's auto-flip is a `system`-kind reaction hook triggered by the host's `system` event; the engine never self-triggers (FR-033).

**Reducer scope.** A `meta` reducer may write only `MetaState`; a `roster` reducer may write only roster entities (players, teams, seats) and counters/zones its declared template names. Cards, zone membership and control state change only through primitive actions. `delegate`/`revoke_delegation` and zone instantiation are implemented by the engine; the game reducer may only veto. Engine invariants are re-checked after every reducer output, live and in replay, so a reducer cannot bypass structural validation (NFR-070). Failure is `REDUCER_ERROR`.

### 2.2 Session Play (core write model)

#### Aggregate: `Session`

One consistency boundary = one session = one writer (§8; FR-085, FR-106). Splitting by zone/counter was rejected: moves touch two zones, transfers two counters, and a transaction is atomic across all (FR-053).

**Persistence form:** the session is **event-sourced**. Its event stream *is* the action log (same identity as the session): live state is the fold of the stream over genesis. Receipts are a separate ledger (§2.5); the requirement that a batch and its receipt become durable together (NFR-043) is a stated exception to "one aggregate per transaction", imposed by the requirements, not a modelling preference.

```
Session (root)
├─ id, lifecycle (active|completed|terminated), seq
├─ table
│   ├─ cards: mutable card state (orientation, containing zone, metadata values)
│   ├─ zones (ordered / unordered)
│   ├─ zone_ordinals: per (template, owner) next-ordinal counter   ← needed for FR-193 ids
│   ├─ counters (stored) ; derived counters (computed, never stored)
│   └─ meta: MetaState (schema_id → value)
├─ roster: seats, players, teams, seat status
├─ control: phase, turn_order, active_seats, direction, named pointers
├─ gates: open/resolved gates with sealed submissions
├─ delegations
├─ grants
└─ outcome?: GameOutcome
```

Static card identity and metadata schema live in the definition; only mutable card state belongs to the session.

**Entity vs value object**

| Kind | Elements |
|------|----------|
| Entities (identity, mutable) | card state (by `CardId`), `Zone`, `Counter`, `Seat`, `Player`, `Team`, `Gate`, `Delegation`, `Grant` |
| Value objects | `Seq`, `Orientation`, `Lifecycle`, `ControlState`, `GameOutcome`, `Permutation`, `Ratio`, `Owner` (reference), `Submission` (inside `Gate`), `Position`, `Effect` |

**Aggregate invariants** (enforced by the root; FR-054)

1. Every card is in exactly one zone, always.
2. A `move` names a card actually in `from_zone`; positions are in bounds.
3. A `shuffle` permutation is a rearrangement of the zone's membership.
4. Counter values stay in bounds; conservation groups hold except via a `supply_role` member; arithmetic is exact (NFR-028).
5. Lifecycle transitions: `active→completed`, `active→terminated`, `completed→terminated` only. A `lifecycle` action is the **last** action of its batch. On an ended session, the only structurally valid batch is exactly `[lifecycle(terminated)]` (from `completed`); no hooks run for it. Only the transition into `completed` and the transition into `terminated` each emit one notification; the `completed→terminated` one is the final notification.
6. Template zones: destroyed only when empty; `max_instances` respected; ordinals never reused; ids derived from `(template, owner, ordinal)`.
7. A gate accepts submissions only from expected seats while open, else `GATE_CLOSED`.
8. Control values come from the declared phase set; seats exist.
9. Turn enforcement (`NOT_YOUR_TURN`) and the lifecycle gate are aggregate rules, not intake rules.
10. After any reducer, all of the above are re-checked.

**Single write operation:** `apply(batch of Actions) → Result`. The same operation is used live and during replay, so replay equivalence is structural (NFR-001). A failed `apply` leaves no trace: atomicity is a required property (FR-053, NFR-042), however it is achieved.

#### Actions and macros

*Primitives (logged):* `move`, `flip`, `shuffle`, `set_metadata`, `lifecycle`, `counter_adjust`, `counter_transfer`, `control_set`, `control_advance`, `grant_view`, `revoke_view`, `zone_create`, `zone_destroy`, `roster`, `meta` (including reserved `engine.*`).

*Macros (expanded before logging, never replayed):* `draw`, `zone_merge`, `reset_to_zone`, and `control_advance(mode: until_quiescent)`. The last one is a macro because its stop condition (a run of passes, a closure predicate) needs hook logic that replay never runs; it expands to explicit `steps`.

**Expansion rules.** Macros expand **sequentially over working state**, so a `draw` following a reshuffle in the same hook output sees the reshuffled zone. Expansion failures (`EMPTY_ZONE`) occur before anything is logged. Likewise, the engine normalises `zone_create` by filling in the derived zone id (hooks may ask the engine for the id a creation will receive so they can `move` into it in the same batch, FR-194). The logged action therefore differs from the hook's output only by these defined expansions.

#### Collection gates

Reserved schemas `engine.gate_open | gate_submit | gate_retract | gate_resolve` have engine reducers and **fixed visibility**: a sealed payload is visible only to its submitter and to operator-level raw access, never to other seats or to hooks other than the resolve hook. Whether *who has submitted* is public is declared per gate (`gate_state` key).

- Validation hooks and reaction hooks receive a **gate-masked Snapshot** (sealed payloads removed). Only `GateResolveHook` sees them.
- A non-resolving submit runs validation and commits the sealed submission (its own `seq`) and runs **no** reaction hooks. The resolving submit (or a host `system` close) adds the resolve hook's actions to the *same* batch; for a `system` close the engine appends `engine.gate_resolve` itself.

#### Delegation

Effective subject set is normalised to **seats**, resolved through the roster at check time (so a `substitute` mid-session keeps delegations attached to the seat, not the player). Delegation expiry has no clock: a delegation names a **boundary**, a game-declared `meta` schema or `system` event kind (e.g. `hand_ended`); when such an action appears in a batch, housekeeping (below) adds the logged `revoke_delegation` actions. The validation hook receives `{acting_seat, on_behalf_of}` (FR-171).

#### Domain events (outbound from Session Play)

| Event | Raised when | Notes |
|-------|-------------|-------|
| `TransactionCommitted(seq, PrivilegedBatch)` | non-empty batch committed | `PrivilegedBatch` is an opaque type only Visibility's `Projector` and Replay can open. Nothing else may read or forward it. |
| `SessionEnded(GameOutcome)` | transition to `completed` / `terminated` | See invariant 5. |

Intake-level results (`accepted`, `rejected`, …) are `ProposalResult`s, not Session Play events (§2.5). Timers are `Effect`s (below), not events.

#### Effects and timers

A hook may return `Effect`s next to its actions: currently `timer_request{id, kind, duration_hint}`. Effects are **not logged and not part of state**; the answer to a timer is an ordinary host `system` proposal that *is* logged. Timers that matter for correctness are **derivable from state**: an open gate with a `timeout_policy` implies a pending timer, and the resync snapshot lists open gates, so a host restart can re-arm them.

#### Application-layer procedure: `ProposalHandler`

The review found the original "Sequencer" was an orchestrator spanning contexts, not domain logic. It is therefore an **application service** (it sits in Intake's seam) that coordinates Intake, Access, Session Play and Rule SPI. Rules that are domain invariants (turn enforcement, lifecycle gate, structural validity) live in `Session`.

Pipeline (each exit records a receipt via the ledger, FR-112):

1. **Idempotency** — look up the receipt; return the stored `ProposalResult`, or `IDEMPOTENCY_CONFLICT` on a fingerprint mismatch.
2. **Lifecycle gate** — `SESSION_ENDED` unless the one allowed exception (invariant 5).
3. **Authorization** via `AuthorizationPort`, then actor↔principal binding against the effective subject set (`FORBIDDEN` vs `UNAUTHORIZED` are distinct). Unauthorized → host-only result, never published.
3a. **Turn enforcement** (`NOT_YOUR_TURN`) when declared.
4. **`expected_seq`** (`STALE`).
5. **Validation hook** (player) or authorization/validation for dealer/control/system.
6a. **Gate routing** — see Collection gates.
6b. **Housekeeping** — the engine appends the actions it owns, deterministically from working state and the batch so far: `until_seq` grant expiry (`engine.grant_expire`), `once` grant consumption (`engine.grant_consume`), delegation expiry at boundaries. This runs **before** the empty check, so a batch containing only housekeeping is non-empty and commits.
7. **Rule hooks** run per the routing rule; cascade cap → `CASCADE_LIMIT`; hook faults → `HOOK_ERROR`/`HOOK_TIMEOUT`.
7b. **Macro expansion** over working state (`EMPTY_ZONE`) and engine normalisation.
8. **Structural validation** by `Session.apply` on a working state; failure → no change.
9. **Empty batch** (after 6b and 7b) → accepted, no `seq` advance, receipt only.
10. **Commit**: append to the stream and persist the receipt together; only then publish.

**Grant consumption rule (deterministic).** `Projector` exposes a pure function `would_reveal(pre, post, actions, grantee)`. A `once` grant is consumed in the first committing transaction after the one that created it for which `would_reveal` is non-empty for the grantee. This is a function of state and batch alone: subscriptions, connected devices and queries never influence the log (FR-092, NFR-001). Until consumed, the grantee's resync snapshot shows the grant. *(Confirmed reading of FR-152's "next outbound projection"; §8.)*

`until_seq(n)` grants: the grant stops applying at the state with `seq ≥ n` for projection purposes (projectors compare `seq`); the logged expiry is the first committing transaction at or after `n`.

#### Repository ports

- `SessionStore.commit(session_id, expected_seq, transaction, receipt)` — atomic by contract (NFR-043); failure yields no receipt, no publication and a transient error; a retry restarts at step 1.
- `SessionStore.load(session_id[, at_seq])`.
- `IdempotencyLedger.record(session_id, receipt)` — durable **before** the result is returned, for every non-committing exit; `lookup(principal, event_id)`.

#### Session creation: `SessionFactory`

Inputs: `GameDefinition` reference, roster/seat layout, deterministic params, optional `carry_over` seed (FR-184), authorization hook, role registrations. Output: a session in `active`, `seq = 0`, every card in its starting zone (FR-006). Setup is **not** automatic: the host sends a setup `system` event that triggers the `setup` hook, so the engine never self-triggers (FR-033). If the game registers a setup gate, player proposals before the first setup transaction are rejected `NOT_READY`.

### 2.3 Visibility (read model)

Pure over `(Snapshot, VisibilityPolicy, active grants, ViewerIdentity)`; never mutates; never appears in the log.

**`ViewerIdentity`** = `(role, subject?)` that Intake has already authorized from the principal. Visibility does not depend on Access.

**`RoleRegistry`** (configuration value compiled from `VisibilityDeclarations`) owns the fail-closed invariant: built-ins `player` (subject required), `dealer` and `auditor` (subject forbidden, denied until registered), `render` (optional subject, public by default), plus custom roles declaring their subject rule. Unknown role/subject → `UNKNOWN_ROLE` / `UNKNOWN_SUBJECT`.

**Projection keys:** card face/type, `meta_field` (FR-141), zone membership, zone count, zone order, `counter_value` (stored and derived), `control_state`, `outcome`, `gate_state`. Defaults per key: no declaration ⇒ omitted, except `control_state` which is public (FR-133) and `counter_value`/`outcome` which follow their declaration. A derived counter is visible to a viewer only if all its inputs are.

**Composition rule.** Effective entitlement = static declared rules for the role ∪ active grants. There is no deny layer: a grant can only add. Defaults apply only where a key has no declaration. Privileged-role defaults are never widened by a grant (FR-151); a grantee of `dealer`/`auditor` is rejected. A grant's existence is visible only to the grantee and to viewers already entitled to the target (FR-154).

**Projector functions** (one implementation serves queries *and* outbound events, FR-094):

| Function | Use |
|----------|-----|
| `project_view(snapshot, viewer) → View` | queries, resync snapshot (carries `seq`, counters, control, active grants, open gates, FR-108/NFR-044) |
| `project_delta(pre, post, PrivilegedBatch, viewer) → Delta` | outbound `state advanced`; moves out of a hidden ordered zone do not reveal card ids or positions the viewer lacks |
| `project_log_entry(state_at_seq, entry, viewer)` | role-filtered log (FR-078); entitlements as of that `seq` |
| `would_reveal(pre, post, batch, grantee)` | grant consumption (above) |

Hooks receive the omniscient `Snapshot`, a different type from `View`; it never crosses outward.

**Accepted side channel.** A commit consisting only of grants/sealed submissions still advances `seq`, so any subscriber learns that *something* happened (FR-103 requires the notification). Non-entitled subscribers receive an empty delta. Timing of the notification is an accepted channel; stated so that it is a decision, not an oversight.

### 2.4 Replay & Export

Services over the event stream; no aggregate.

| Service | Behaviour |
|---------|-----------|
| `Replayer` | `rebuild(package, definition, upto_seq?)`: applies logged primitives through `Session.apply`; game reducers for `meta`/`roster`, engine reducers for `engine.*`; **never runs hooks**; re-checks invariants → `REPLAY_INVALID(seq, action_index)`; refuses a definition mismatch (`REPLAY_MISMATCH`). |
| `PackageExporter/Importer` | Package = `(initial_config, definition ref + identity, action-schema version, deterministic params, log, receipts)`. Import restores state, `seq` and receipts so a writer may resume (FR-083). |
| `Forker` | `fork_from_seq(n)` → new session; original immutable (FR-185). |
| `DirectApply` (host-only) | Apply actions with no hooks; still `apply`'s invariants, a host `event_id`, and a receipt (FR-075). |
| `StateDigest` | Canonical serialization and digest per `seq`, covering counters, grants, gates, control, zone ordinals, derived counters (NFR-001/026/029). A verification service, not a domain concept. |

### 2.5 Intake

| Type | Kind | Notes |
|------|------|-------|
| `InboundEvent` | VO | `event_id`, principal, kind, payload, fingerprint, `expected_seq?` |
| `Proposal` | VO | What Session Play receives after translation |
| `Receipt` | entity of `IdempotencyLedger` (aggregate keyed `(principal, event_id)`) | `fingerprint`, `ProposalResult`, `error_code?`, `seq`, **`detail` with a privilege marker**. Role-filtered exports redact `detail`. |
| `ProposalResult` | VO | `accepted(seq)`, `rejected(code, detail)`, `duplicate(stored)`. Always returned to the host. |
| `OutboundEvent` | VO | Versioned; payload is always a projection for the recipient |
| `Subscription` | entity | `(principal, ViewerIdentity, filter?)`; privileged roles need host authorization |
| `ArrivalPolicy` | strategy | Resolves Q13 without touching the model; yields one total order |

`ProposalResult` is host-only. A rejection is published as an outbound event **only** to principals authorized to observe it, with detail passed through the viewer's rules (FR-061); non-privileged callers get a stable code only (NFR-041). Unauthorized calls produce no event (NFR-073).

**Publisher** (application service): after durable commit only, for each authorized subscription it calls `Projector.project_delta`. Publication order is `seq` order.

### 2.6 Access

`Principal` (id, roles, subject bindings) is asserted by the host. `AuthorizationPort.authorize(principal, op, target)` where `op ∈ {propose:<kind>, query:<role>, subscribe:<role>, export, direct_apply, fork}`. The only rule the engine enforces itself is actor binding to the effective subject set (host bindings ∪ delegations − revocations, normalised to seats).

---

## 3. Cross-cutting decisions

1. **Event sourcing.** Actions are facts (persisted, replayable); outbound events are notifications derived from them. They are different types so the log holds no presentation and notifications never carry raw facts.
2. **No clocks in the domain.** Grant expiry, gate timeouts, delegation expiry and timer answers depend only on `seq`, logged boundary events or host `system` events (NFR-023).
3. **Closed world.** All cards exist at `seq = 0`; there is no `create_card`; "spawn" is a `move` from a reserve zone (FR-192).
4. **Error taxonomy** (domain-visible only; execution faults are a separate category):
   - Intake: `IDEMPOTENCY_CONFLICT`, `STALE`
   - Access: `UNAUTHORIZED`, `FORBIDDEN`, `UNKNOWN_ROLE`, `UNKNOWN_SUBJECT`, `SUBJECT_NOT_ALLOWED`, `ViewDenied`
   - Rule: game rejection (opaque code), `NOT_YOUR_TURN`, `NOT_READY`, `GATE_CLOSED`
   - Structural: `CARD_NOT_IN_ZONE`, `EMPTY_ZONE`, `COUNTER_BOUNDS`, `ZONE_LIMIT`, `REDUCER_ERROR`, malformed action
   - Lifecycle: `SESSION_ENDED`
   - Replay: `REPLAY_INVALID`, `REPLAY_MISMATCH`
   - Execution (engine-operational, not domain language): `HOOK_ERROR`, `HOOK_TIMEOUT`, `CASCADE_LIMIT`

---

## 4. Requirements traceability

| Requirements | Where |
|--------------|-------|
| FR-001–006 | Session (card state, closed world); GameDefinition (registry) |
| FR-010–033 | Session: zones, roster, seats |
| FR-040–049, 090–094 | Visibility: `Projector`, `RoleRegistry`, `VisibilityPolicy` |
| FR-050–056, 064–066, §5.6.2 | `ProposalHandler`, Rule SPI, `Session.apply` |
| FR-057–063, 067–068 | Validation hook; step 3/5; `FORBIDDEN` |
| FR-070–079 | Event stream, Replay & Export, reducers (§2.1) |
| FR-075 | `DirectApply` |
| FR-080–085 | `SessionFactory`, lifecycle invariants |
| FR-100–106, 108, 110–112 | Intake, `IdempotencyLedger`, resync snapshot |
| FR-107, 109 | `Subscription` filter; delta projection (`project_delta`) |
| FR-120–123 | Counters, conservation (Session invariants) |
| FR-124 | `roster join` + template counters (reducer scope, §2.1) |
| FR-125–126 | Derived counters (computed, in digest); `ratio` + rounding |
| FR-130–136 | `ControlState`; `until_quiescent` macro |
| FR-140–142 | `MetaSchemas`; `meta_field` key |
| FR-150–156 | `Grant` (Session) + `Projector` (Visibility); consumption rule |
| FR-154 | Composition rule (§2.3) |
| FR-160–167 | Collection gates |
| FR-170–173 | Delegation, boundary expiry |
| FR-180–186 | `GameOutcome`, macros, `Forker` |
| FR-190–194 | Template zones, `zone_ordinals` |
| NFR-001, 026, 029 | `StateDigest`, single `apply` |
| NFR-020, 027, 028 | Definition policies; exact integer arithmetic |
| NFR-030–032 | Rule SPI as only seam; separated APIs; versioned schemas |
| NFR-040–044 | Atomic `apply`, `SessionStore.commit`, resync snapshot |
| NFR-050–059, 062 | Outside the core: conformance harness, helper library, timers (`Effect` + `system` event) |
| NFR-070–073 | Snapshot/View split, `PrivilegedBatch`, `AuthorizationPort` |

---

## 5. Worked scenarios

**Legal play (team trick-taking).** Frontend submits `play_card(seat 2, c17)`; host asserts principal. Handler: no receipt → active → principal bound to seat 2 → seat 2 active → `expected_seq` ok. Validation (omniscient, gate-masked snapshot): follows suit → accept. Reaction hooks emit `move`, `flip`; trick complete → `control_advance`, `move` trick to winners' zone, `counter_adjust`. Housekeeping adds nothing. `apply` validates; commit `seq n` with receipt. Publisher projects the delta per subscriber; the auditor receives nothing unless registered.

**Rejected play.** Validation rejects; receipt (with detail, privilege-marked) recorded via the ledger; no transaction; the proposer alone gets the detail. A retry with the same `event_id` returns the stored result.

**Sealed simultaneous pass (Hearts).** Setup hook emits `engine.gate_open`. Each seat's proposal is validated on a masked snapshot, then committed as a sealed `engine.gate_submit` (own `seq`, no reaction hooks). The final submit adds the resolve hook's `move`s to its own batch. Replay reconstructs sealed data from the log.

**Peer reveal (Uno WD4).** Hook emits `grant_view(hand, face, challenger, once)`. The grantee sees it in the snapshot immediately. The first later committing transaction whose delta reveals it to the challenger also carries `engine.grant_consume`. Queries in between consume nothing.

**Replay.** `Replayer` verifies definition identity, folds the stream through `Session.apply`, never running hooks, and checks the digest per `seq`.

---

## 6. Decisions and rejected alternatives

| Decision | Alternative | Why |
|----------|-------------|-----|
| One `Session` aggregate | Aggregate per zone/counter | Transactions are multi-entity and atomic. |
| Event-sourced session; log is its stream | Separate `ActionLog` aggregate | Review: two aggregates plus a joint commit blurred which is authoritative. |
| `IdempotencyLedger` separate | Receipts inside the log | Receipts exist for rejections with no `seq`. |
| Same `apply` live and replay | Separate replay interpreter | No drift. |
| `Snapshot` vs `View` types; `PrivilegedBatch` opaque | One state type with a filter | Leakage is a type error, including for outbound batches. |
| Engine-injected housekeeping step | Projection-triggered consumption | Log must not depend on subscribers. |
| Reducers limited to their partition | Reducers with whole-state write | Would bypass structural validation. |
| Macros expand sequentially over working state | Expand independently | Draw-after-reshuffle correctness. |
| `until_quiescent` as macro | Logged with `mode` | Replay cannot run its predicate. |
| `ProposalHandler` outside the domain | Domain "Sequencer" | It orchestrates across contexts. |
| `GameDefinition` as value | Aggregate | No lifecycle or behaviour. |

## 7. Out of the model

Storage, serialization format, transport, hook sandboxing, concrete scheduling and language — implementation choices outside this design.

## 8. Open design questions

1. **`once` grant semantics — Resolved (confirmed by requirements owner).** A `once` grant is consumed by the first later committing transaction that reveals something to the grantee (§2.2).
2. **Engine-reserved schemas.** This design assumes fixed visibility for `engine.gate_*`, `engine.grant_*` and logged delegation expiry via `revoke_delegation` at a game-declared boundary. FR-173's "named lifecycle boundary" should be defined accordingly.
3. **Timers — Resolved (confirmed by requirements owner).** Timer requests are non-logged `Effect`s; only the host's `system` answer is logged. NFR-056's "logged and replayed" applies to that answer.
4. **Gate nesting (FR-167)** may warrant `Gate` as its own aggregate if adopted.
5. **Spectator (Q15)** is a custom role registration; confirm.
6. Snapshots/checkpointing are an implementation concern behind `SessionStore`, verified by `StateDigest`.

## 9. Review log

Three independent reviewers (DDD quality, correctness/leakage, coverage/implementability) examined v1.

**Applied (high confidence or unanimous):** grant ownership moved to Session Play (Visibility only reads); deterministic grant consumption and a housekeeping step before the empty check; macro expansion step; ended-session rule; receipts moved to a ledger with a non-commit write path and privilege-marked detail; split of `ProposalHandler` from the domain; corrected context-relationship patterns; explicit event sourcing; reducer scope and `REDUCER_ERROR`; projector functions for deltas and log entries plus `PrivilegedBatch`; zone ordinals state; gate masking and system-close branch; `until_quiescent` as macro; delegation normalised to seats with boundary expiry; hook routing; session creation flow; visibility composition rule and `meta_field`/derived keys; name collisions (`GameOutcome`, `ProposalResult`); entity/value reshuffle; technology-neutral wording; expanded traceability; authorization op vocabulary and error codes.

**Deferred / flagged (medium confidence or needs the requirements owner):** items in §8. Not applied: promoting timer requests to logged actions (conflicts with NFR-056 wording), making `Gate` its own aggregate (premature).
