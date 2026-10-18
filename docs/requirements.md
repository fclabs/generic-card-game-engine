# Generic Event-Based Card Game Engine — Requirements

**Status:** Draft — requirements refinement  
**Last updated:** 2026-10-17  
**Changelog (this revision):** Applied `docs/requirements_consistency_review.md`: `once` grants consume only on committing outbound projection (FR-152); gate sealing moved after validation/`expected_seq` and sealed submits advance `seq` (§5.6.2 step 6a); `draw`/`zone_merge` are macros; `roster` gains `delegate`/`revoke_delegation`/`set_status`; FR-084 `completed → terminated` is host-exempt from `SESSION_ENDED`; Must early gate close defined without FR-165 (FR-161); receipt rules for every exit; Seat definition and effective subject set (§3); engine-reserved `meta` schemas for gates/grant expiry; counter `supply_role`; NFR-044 promoted to Must; SHALL-in-Should/Could convention; smaller cross-ref and terminology fixes.
**Previous changelog:** Merged second-round gap-closing suggestions (sources not retained): derived counters and fixed-scale rounding (FR-125–126), named control pointers and quiescent advance (FR-135–136), gate quorum/timeout/request-response/nesting (FR-164–167), grant ranges/filters and group grantees (FR-155–156), scoped delegation (FR-173), `carry_over`/`fork_from_seq`/standard `outcome.reason` (FR-184–186), parameterized template zones and `zone_merge` (FR-193–194), NFR-029, NFR-054–059, NFR-063–064; Q16–Q18 resolved (provisional).
**Earlier changelog:** Merged game-verification suggestions (sources not retained): counters (FR-120–124), control state (FR-130–134), projectable `meta` (FR-140–142), dynamic view grants (FR-150–154), sealed submissions (FR-160–163), delegated control (FR-170–172), multi-hand lifecycle/outcomes (FR-180–183), template zones (FR-190–192), FR-032 promoted to Must + FR-033, raised NFR-020, NFR-026/027/028/044/052/053/062, second-tier acceptance games, new non-goals, Q16–Q18.
**Previous revision:** Applied coworker-review **must-fixes**: durable idempotency receipts; genesis card registry + replay reducers; actor↔principal binding; no-op/`seq` semantics; FR-040 vs NFR-071 zone-order; subject matrix reject; publish-after-durable; processing-model order/outcomes; hook cascade semantics; `EMPTY_ZONE`/`draw`; lifecycle transitions; resync via current snapshot; MoSCoW alignment (FR-075/fail-closed); named reference games.

## 1. Purpose

Provide a reusable, event-based engine that can host event-driven card games by representing shared and per-actor card state, applying game-specific rules through hooks, exposing role-scoped state queries, exchanging events asynchronously with remote frontends, and recording every accepted state change as a replayable action log.

Acceptance scope is bounded by the named **reference games** in §1.1. The purpose statement does not imply unbounded support for every conceivable card game without further refinement.

The engine is a library/runtime for game implementations. Players may be geographically distributed. The engine does not render UI, encode strategy, or run audit/compliance product pipelines — but it does supply role-appropriate state views (including for a render engine and an auditor role) and an async event interface that remote client layers can adapt over the network.

### 1.1 Reference games (acceptance)

Until expanded, acceptance of Must requirements is demonstrated against at least these reference games (each with setup, legal action, rejected action, replay, and role-projection scenarios):

| Reference game | Exercises |
|----------------|-----------|
| **War** (2 players) | Hidden draw-order, face-down piles, shuffle permutation, simple win condition |
| **Team trick-taking** (4 players / 2 teams) | Team zones, hidden hands, multi-player concurrent proposals, dealer/control events |

**Second tier (Should)** — added to exercise the non-card primitives of §5.10 so they are not designed in the abstract. Not required for initial Must acceptance, but each SHOULD be demonstrated with the same five scenario types:

| Game | Primitive it proves |
|------|---------------------|
| **Texas Hold'em** (single hand, cash game) | Counters + conservation, control state, hidden hole cards, side-pot hooks |
| **Uno** | Control state with direction, one-shot peer grant (WD4 challenge), projected `meta` (active colour) |
| **Klondike solitaire** | Single-seat play, `system`-driven flips, `outcome` payload |
| **Hearts** | Sealed simultaneous pass, multi-hand lifecycle, counters |
| *Could:* **Bridge**, **Gin Rummy** | Delegated control (dummy) and declared-visibility auction; template-zone melds and top-of-zone grant |

Within Must acceptance, the team trick-taking reference game is expected to be realised as Spades-like (bags/score via plain Must counters, not FR-125 derived counters; Blind Nil via grants) when the corresponding Must requirements are implemented. Full Magic: The Gathering rules are not an acceptance target (§2.2).

## 2. Scope

### 2.1 In scope

- Representation of table, player, and team card state (locations, counts, visibility).
- Unique card instances for the lifetime of a game, declared in immutable initial configuration.
- Common stack/zone concepts (draw piles, discard, hands, table areas, team shared stacks) when configured by the game.
- Hook points that receive a read-only view of game state and return actions that define state changes.
- A state validation hook that can accept or reject a proposed player action without mutating state when rejected.
- Authorization checks for dealer/control/system inbound events equivalent in effect to player validation (reject → zero mutation).
- A query API for the current game state under different **view roles** (player, dealer, auditor, render engine, and extensible roles).
- An asynchronous interface to **produce and consume events** for remote game/player frontends, with inbound idempotency (durable receipts).
- Support for sessions where players are geographically distributed (engine must not assume co-located clients).
- Persistent, ordered storage of actions so an operator can reproduce a complete game from a **replay package** (action log + immutable initial config + resolvable game-definition artifact + idempotency receipts).
- Extension points so each concrete game can define its own characteristics (deck composition, legal moves, phases, win conditions as state outcomes, visibility rules, etc.) without changing the engine core.
- Explicit session lifecycle including terminal states.
- Non-card game state as first-class engine entities: integer **counters** (chips, pots, scores, pegs), engine-managed **control state** (turn/phase/direction/active seats), projectable `meta` state, dynamic **view grants**, sealed simultaneous submissions, delegated control, and template-instantiated zones (§5.10).

### 2.2 Out of scope

- Any graphical representation of the game or card asset rendering (the **render engine** is an external consumer of a state view, not part of this project).
- Game strategy logic or automated playing engines (AI opponents, solvers, recommenders).
- Audit **processing** logic (compliance reporting, billing interpretation, analytics pipelines) — distinct from providing an **auditor view** of state.
- Concrete network transports, protocols, matchmaking, NAT traversal, or hosting infrastructure (WebSocket/gRPC/etc. adapters sit above the engine’s async event API). Delivery guarantees (at-least-once, reconnect streams) are adapter responsibilities; the engine exposes a current snapshot + `seq` for resync.
- Persistence backends beyond the durability contract in NFR-043 (specific DB choice is an implementation concern unless constrained elsewhere).
- Turn timers / AFK policies as first-class engine features — the **host MAY inject** `system` inbound events (e.g. `turn_timeout`) that are authorized and ordered like other transactions.
- Multi-node / clustered session ownership and failover (single writer process per session is assumed; see assumptions).
- Identity unlinkability across hidden reorders (stable instance ids may remain linkable through a shuffle); physical-shuffle anonymity is a documented non-goal unless a game registers opaque reorder projections.
- Full Magic: The Gathering Comprehensive Rules (stack, priority, layers, replacement effects, CR 400.7 identity); MTG is at most a "zones-only subset" and is not an acceptance target. Interrupt protocols are game `meta` + control state.
- Undo (e.g. Klondike); rewind is host-level rebuild-by-replay (FR-075) or `fork_from_seq` (FR-185).
- Duplicate-bridge cross-table scoring and Laws/director irregularities (multi-session).
- Table signals / *señas* (social/UI layer).
- Multi-session tournament structure (poker tournaments, Mus *vacas* across sessions); host orchestration. The engine models a single session and its `outcome` (FR-181).

## 3. Definitions

| Term | Meaning |
|------|---------|
| **Card instance** | A uniquely identified physical/logical card in a game; two “identical” face values are still distinct instances. |
| **Card type / template** | Optional game-defined identity shared by multiple instances (e.g. “Ace of Spades”); not a substitute for instance identity. |
| **Zone / stack** | An ordered or unordered collection of card instances owned by the table, a player, or a team (hand, draw pile, discard, play area, etc.). |
| **Face orientation** | Per-card physical orientation: face up or face down. Distinct from **view entitlement** (who may see face/type/metadata). |
| **Visibility / entitlement** | Game-defined rules stating which view roles/subjects may observe face, type, metadata, zone membership, zone order, and related secret fields for a card or zone. |
| **Game state** | Full authoritative snapshot of cards, zones, players, teams, session lifecycle, and engine-managed metadata at a point in time. |
| **Hook** | Game-provided callback that observes read-only state (and optionally an input event) and returns zero or more actions. |
| **Validation hook** | Game-provided callback that judges whether a proposed player action is legal given the current read-only state; rejection MUST leave state unchanged. |
| **Reducer** | Pure function registered in the game-definition artifact that applies a logged `meta` or `roster` action to state during live commit and replay (no hooks). |
| **Authorization hook** | Engine-invoked callback `authorize(principal, op, target) → allow\|deny` registered at session creation (host- or game-provided). Host pre-authorization (NFR-073) remains required; the engine still enforces actor↔principal binding (FR-068). |
| **Principal** | Authenticated caller identity asserted by the trusted host/adapter, including granted roles and optional subject bindings (e.g. player ids the caller may act as). The `authenticated_caller_id` of idempotency receipts is the principal id. |
| **Seat** | A stable table position (seat id) used by `turn_order`, `active_seats`, gates and delegation. A seat is bound to a `player_id` for the tenure of that player (set by `roster` `join`/`substitute`); FR-068 resolves a player proposal's acting `player_id` through this binding. |
| **Effective subject set** | The subjects a principal may act as: host-asserted subject bindings ∪ logged delegations (FR-170) minus revocations. It governs FR-068 only; query/projection entitlements remain FR-042/FR-150 unless a grant says otherwise. |
| **Player action (proposed)** | External intent submitted by the host on behalf of a player (e.g. play/discard/draw request) before it is accepted into the action log. |
| **Action** | Immutable description of a primitive state change; the unit persisted in the action log. |
| **Action log** | Ordered sequence of committed transactions (each a batch of primitive actions) from which the full game can be replayed. |
| **Transaction / step** | One committed proposal that produces a non-empty action batch: validation (if any) succeeded, all resulting actions applied atomically, one gapless `seq` assigned, and outbound outcomes emitted. Empty accepted batches do not form a transaction (FR-052a). |
| **seq** | Gapless, strictly increasing session sequence number identifying a committed non-empty transaction (not raw action-count). Starts at 1. |
| **Idempotency receipt** | Durable record `(authenticated_caller_id, event_id) → (request_fingerprint, outcome, error_code?, seq?)` retained for the session’s export/retention life. |
| **Replay package** | Portable artifact containing the action log, immutable initial configuration (including card-instance registry), resolvable game-definition artifact (or content-addressed reference), content hash, action-schema version, deterministic parameters, and idempotency receipts. |
| **View role** | Named information perspective used when querying state (e.g. player, dealer, auditor, render). Controls which card faces and metadata are visible. |
| **State view** | Read-only projection of game state filtered/redacted for a view role (and optionally a subject id such as a player id). |
| **Event (inbound)** | Message submitted into the engine asynchronously (typically a proposed player action or control message from a remote frontend), carrying a caller-scoped `event_id`. |
| **Event (outbound)** | Message emitted by the engine asynchronously (e.g. state changed, action accepted/rejected, view update notification) for remote consumers. |
| **Operator** | External role that records, stores, or replays games using the replay package (not a player AI). |
| **Counter** | Named, integer-valued, bounded state entity owned by the table, a player, a team, a zone, or a card (chips, pots, scores, pegs). |
| **Control state** | Engine-managed session state: `phase`, `turn_order`, `active_seats`, `direction`, and seat status. |
| **Grant** | Logged, additive view entitlement on a card or zone for named projection keys and a grantee, with an expiry scope. |
| **Gate (collection gate)** | Open collection of sealed per-seat submissions that resolve together as one transaction. |
| **Template zone** | Zone instantiated at runtime from a template declared in the immutable initial configuration. |
| **Working state** | Within a transaction, the tentative state after applying previously collected primitive actions in that transaction, before commit. |

## 4. Actors

| Actor | Description | Engine interaction |
|-------|-------------|--------------------|
| Game implementer | Author of a concrete card game | Registers hooks, reducers, card types, zone layout, visibility rules, and game-specific rules |
| Player (logical) | Participant modeled in state; may be geographically remote | Owns hand/stacks; interacts via inbound/outbound events and player-scoped state queries |
| Player frontend | Remote client UI for a player | Consumes outbound events and player views; produces inbound player events |
| Game remote frontend | Remote client for table/host/dealer operations | Consumes outbound events and privileged views; produces control/dealer events |
| Team | Group of players sharing team-level zones | Owns team stacks; membership defined by the game setup |
| Dealer | Privileged external role (human or system) | Queries dealer view; may submit dealer/control events when authorized |
| Auditor | Privileged read-oriented role | Queries auditor view; does not imply audit-product pipelines inside the engine |
| Render engine | External presentation system | Queries render view / consumes outbound events; typically public/layout data; performs no game-rule logic in this project |
| Host / session controller | Starts, advances, or ends a game session; trusted bridge network ↔ engine | Authenticates callers, asserts principals, authorizes roles/subjects, wires async adapters |
| Operator | Replays or inspects recorded games | Consumes the replay package to reconstruct state |

## 5. Functional Requirements

**Convention:** Each row's Priority governs the whole row. SHALL/MUST inside a Should or Could row is normative only when that feature is implemented; likewise, vocabulary rows and fields in §5.6.3 tied to a Should/Could FR inherit that FR's priority.

### 5.1 Card identity and representation

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-001 | Must | Every card in a game SHALL have a unique instance identifier that is stable for the lifetime of that game. Instance ids SHOULD be opaque (not encoding type or deal order). |
| FR-002 | Must | The engine SHALL allow multiple card instances that share the same game-defined type or face value (duplicate piles). |
| FR-003 | Must | Each card instance SHALL track **face orientation**: face up or face down. Orientation is distinct from view entitlement: a face-down card MAY still be visible to an entitled subject (e.g. owner’s hand) while redacted for others. |
| FR-004a | Should | The engine SHOULD support game-defined card metadata (attributes). |
| FR-004b | Must | **If** metadata is used, each metadata field SHALL be declared `public`, `role/subject-visible`, or `secret`. The engine stores metadata without interpreting game meaning, but SHALL redact it in views/outbound projections per entitlement. Undeclared metadata SHALL be omitted from all external views by default. |
| FR-005 | Must | Moving, flipping, or otherwise mutating a card SHALL preserve its instance identity. |
| FR-006 | Must | Immutable initial configuration SHALL declare the complete **card-instance registry** and all configured zones. At session start (`seq = 0`, before any committed transaction), every declared card SHALL reside in a named zone (typically a table `undealt` / stock zone). Setup and deal SHALL only `move`, `flip`, `shuffle`, or otherwise mutate those pre-registered instances via logged actions — there is no silent bootstrap snapshot outside the package, and no `create_card` primitive in the minimum vocabulary. |

### 5.2 Table / shared state

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-010 | Must | The engine SHALL support zero or more named shared table zones configured by the game (e.g. draw piles, discard, `undealt`). A discard stack is **not** mandatory for every game. |
| FR-011 | Must | The engine SHALL support at least the zone count floor in NFR-020, with no engine-imposed structural limit below that floor. |
| FR-012 | Must | For each zone, the engine SHALL expose card membership and count (subject to view entitlements for membership vs aggregate count). |
| FR-013 | Must | Zones SHALL support ordered stacks where order matters (top/bottom) when the game configures them as ordered. |
| FR-014 | Should | The engine SHOULD support unordered or set-like zones when the game configures them as unordered. |

### 5.3 Player state

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-020 | Must | The engine SHALL represent each player’s hand as a zone of card instances. |
| FR-021 | Must | The engine SHALL support additional per-player stacks/zones beyond the hand (e.g. personal discard, score pile). |
| FR-022 | Must | Player roster and player identifiers SHALL be part of game state and addressable by actions and hooks. Roster changes (join/leave/substitute), when used, SHALL be expressed as logged `roster` actions applied via registered reducers. |

### 5.4 Team state

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-030 | Must | The engine SHALL support teams as first-class state entities with membership (players → team). |
| FR-031 | Must | The engine SHALL support team-level stacks/zones shared by team members. Team-member entitlement to team-zone secrets SHALL be expressible via game-defined visibility rules (no separate built-in `team` view role required). |
| FR-032 | Must | Games with no teams SHALL be representable by an absent team model (War, Uno, Crazy Eights, Go Fish, Rummy, Gin, Poker, Blackjack, solitaire). *(Promoted from Could.)* |
| FR-033 | Must | A one-seat game (solitaire) SHALL be representable: no opponents, no `dealer` required, and a `system` hook MAY advance state (e.g. stock flip) without an inbound player proposal. `system` hooks run only as a cascade of an inbound event or of a host-injected `system` event (FR-102); the engine never self-triggers. |

### 5.5 Visibility and information views

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-040 | Must | In views not entitled to a card’s face/type, that card SHALL remain identifiable only by instance id; face, type, and secret metadata SHALL be redacted. Zone **position** SHALL be included only when the view is entitled to that zone’s ordering (`zone_order`). Otherwise the projection SHALL omit ordering and MAY expose only an authorized aggregate/count (`zone_membership` / count entitlements). |
| FR-041 | Must | When a view is entitled to a card’s face/type, the view SHALL expose that face/type data (subject to metadata entitlement rules). |
| FR-042 | Must | The engine SHALL produce **role-scoped read-only state views** that hide information the caller is not entitled to see, subject to game-defined visibility rules. Absent a registered rule for a privileged role, the engine SHALL **fail closed** (deny the view) rather than grant omniscient access. Built-in projection keys SHALL include at least: card face/type, metadata field, zone membership, zone count, zone order, `counter_value` (FR-120), `control_state` (FR-130), `outcome` (FR-181) and `gate_state` (FR-160). |
| FR-043 | Must | Hooks that decide state changes SHALL receive a read-only state view; they MUST NOT mutate state in place. Unless the game registers a narrower hook view, state-changing and validation hooks SHALL receive an omniscient (full) read-only snapshot so rules can inspect hidden information; that snapshot MUST NOT be returned to external callers. |
| FR-044 | Must | Built-in view roles SHALL include at least: **player** (scoped to a player id), **dealer**, **auditor**, and **render**. |
| FR-045 | Must | A **player** view SHALL reveal that player’s entitled information (e.g. own hand faces) and redact other players’ hidden information per game rules. Default when the game registers no custom player rule: own hand faces + cards in zones configured as public that are face-up. Face-up orientation inside another player’s private zone is **not** public unless that zone (or card) is configured public. |
| FR-046 | Must | Until the game registers dealer entitlements, dealer queries SHALL be denied (fail closed). When registered, a **dealer** view SHALL expose only the information declared for that role (exact entitlements are game-defined; may exceed any single player’s view). |
| FR-047 | Must | Until the game registers auditor entitlements, auditor queries SHALL be denied (fail closed). When registered, an **auditor** view SHALL expose only the information declared for that role (often omniscient or near-omniscient). The engine does not detect log tampering; auditor conclusions are only as trustworthy as the storage of the replay package. |
| FR-048 | Must | A **render** view SHALL expose presentation-oriented **public** (and role-allowed) layout data suitable for an external render engine, without mutation rights. Render is **not** privileged by default; default entitlement is public face-up / layout data only. Games MAY configure a more privileged render role explicitly. |
| FR-049 | Should | Games SHOULD be able to register additional named view roles beyond the built-ins. |

#### Role × subject matrix

| View role | Subject id | Notes |
|-----------|------------|-------|
| `player` | **Required** (player id) | Unknown player id → reject (FR-093). |
| `dealer` | **Forbidden** | If a subject id is supplied → reject `SUBJECT_NOT_ALLOWED`. Privileged; host-authorized. |
| `auditor` | **Forbidden** | If a subject id is supplied → reject `SUBJECT_NOT_ALLOWED`. Privileged; host-authorized. |
| `render` | Optional (e.g. camera/layout id) | Public by default; not privileged unless game configures otherwise. |
| Custom roles | Per registration | Registration MUST declare whether a subject is required or forbidden. |

### 5.5.1 State query API

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-090 | Must | The engine SHALL expose an API to query the **current** game state as a read-only view for a specified view role (and subject id when required per the role × subject matrix). Every query call SHALL carry a host-asserted **principal**. |
| FR-091 | Must | Query results SHALL reflect the authoritative state as of the current committed `seq` (gapless transaction sequence; `0` if no transactions yet), returned with the view. |
| FR-092 | Must | Querying state SHALL NOT mutate authoritative state or append to the action log. |
| FR-093 | Must | The query API SHALL reject or hard-fail requests for unknown roles, unknown required subjects, forbidden subjects when supplied, or principals not authorized for the requested role/subject, rather than silently returning an over-privileged view. |
| FR-094 | Must | The same view-role semantics used for queries SHALL be used when projecting outbound events (so remote clients are not sent data their role cannot see). |

### 5.6 Hooks and customization

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-050 | Must | The engine SHALL provide hook points so a game can customize characteristics such as setup, dealing, legal transitions, phase changes, and reactions to player/engine inputs. |
| FR-051 | Must | Hooks that produce state changes SHALL receive a read-only game state (see FR-043 and FR-053a) and return a list of **primitive** actions describing the intended state change. |
| FR-052 | Must | Returning an empty action list from a state-changing hook SHALL be a valid no-op outcome. |
| FR-052a | Must | A proposal accepted with an **empty** action batch SHALL NOT advance `seq`, SHALL NOT append to the action log, and SHALL NOT emit a “state advanced” outbound event. The outcome SHALL carry the current `seq` (pre-proposal). `expected_seq` (FR-111) compares against that pre-proposal `seq`. An idempotency receipt is still recorded (FR-112). |
| FR-053 | Must | Within a single proposal **transaction**, all actions produced by the hook chain SHALL commit atomically as one step (all succeed, or none apply). Partial application across hooks in the same transaction MUST NOT occur. |
| FR-053a | Must | Within a transaction, state-changing hooks execute **sequentially**. Each subsequent hook (including cascaded reaction hooks) SHALL receive a read-only view of **working state** after applying all previously collected actions in that transaction, plus a view of the original inbound event. Cascade-triggered reaction hooks SHALL NOT re-enter the game validation hook; they are subject only to structural validation (FR-054). Cascade depth SHALL be capped at a configurable `N` with default **16** (per-game configurable up to at least 256, NFR-027); exceeding it aborts with `CASCADE_LIMIT` and leaves state and log unchanged. |
| FR-054 | Must | Before committing a batch, the engine SHALL validate that actions are structurally well-formed and preserve engine invariants: existing entity references, unique card membership across zones, valid zone ownership/order operations, orientation legality, and position bounds. A `move` whose `card_id` is not in `from_zone` SHALL fail with `CARD_NOT_IN_ZONE`. A `draw` (or helper that selects top-N without naming cards) from an empty or insufficient zone SHALL fail with `EMPTY_ZONE` **before** producing logged actions. |
| FR-055 | Must | Invalid action batches SHALL leave state unchanged and surface a clear error to the caller. |
| FR-056 | Must | Game-specific win/loss or end-of-game conditions SHALL be expressible via hooks (engine does not hardcode a particular game’s scoring). A hook MAY emit a completion transition action that moves the session to a terminal lifecycle state (FR-084). |
| FR-064 | Must | A hook that throws / returns an error SHALL abort the current transaction with `HOOK_ERROR`, leaving authoritative state and the action log unchanged. |
| FR-065 | Should | A hook exceeding a configurable time budget SHOULD be treated as `HOOK_TIMEOUT` with the same abort semantics; document that enforcement may be cooperative depending on language. |
| FR-066 | Should | Hooks SHOULD be pure functions of `(view, input)`. Randomness SHALL be obtained only through engine-provided logged actions (e.g. shuffle with recorded permutation). |

### 5.6.1 State validation hook

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-057 | Must | The engine SHALL support a **state validation hook** registered by the game implementer. |
| FR-058 | Must | Before applying state changes derived from a proposed **player** action, the engine SHALL invoke the validation hook with: (a) a read-only view of the current game state, and (b) the proposed player action. Validation is always a **separate** step that runs before any state-changing hook for that proposal. |
| FR-059 | Must | The validation hook SHALL be able to **reject** the proposed player action. |
| FR-060 | Must | When the validation hook rejects a proposed player action, the engine MUST NOT change authoritative game state and MUST NOT append state-changing actions to the action log for that proposal. |
| FR-061 | Must | A rejection SHALL be returned to the proposing principal / host with a game-defined reason (opaque message or structured code). Rejection detail projected on outbound events SHALL pass view-role rules for that principal (no privileged oracle to other subscribers). |
| FR-062 | Must | When the validation hook **accepts** a proposed player action, the engine SHALL invoke the registered state-changing hook(s) for that proposal and, on success, commit the resulting action batch as one transaction (unless empty — FR-052a). |
| FR-063 | Should | Structural/engine validation (FR-054) and game-rule validation (FR-057–FR-062) SHOULD be distinguishable in the error surfaced to the caller. |
| FR-067 | Must | Dealer, control, and host-injected `system` inbound events SHALL pass an **authorization** check (and a game validation hook when the game registers one for that event kind) before any state change; rejection MUST leave state and log unchanged. |
| FR-068 | Must | For `player` proposals, the engine SHALL reject with `FORBIDDEN` any proposal whose acting player id is not among the principal’s bound subjects, **before** invoking the validation hook. |

### 5.6.2 Processing model

For each inbound proposal the session sequencer SHALL:

1. Reject duplicates of an already-processed `event_id` for that authenticated caller by returning the stored idempotency receipt outcome without re-application (FR-110, FR-112). Same `event_id` with a different request fingerprint → `IDEMPOTENCY_CONFLICT` (no mutation).
2. If session lifecycle is `completed` or `terminated` → `SESSION_ENDED` for state-changing events (FR-084), except a host-authorized `lifecycle` event with `to_state: terminated` while `completed`; record receipt; no mutation.
3. Authorize the principal for the event kind / actor (authorization hook and/or host-asserted entitlements). Unauthorized → record receipt; outcome to host only; **no** outbound projected event (NFR-073). For player proposals also enforce FR-068 (against the effective subject set, §3 / FR-170).
3a. If the game declares `enforce_active_seats` and the event kind is not out-of-turn permitted, reject a player proposal from a seat outside `active_seats` with `NOT_YOUR_TURN` (FR-132) before validation; record receipt.
4. Optionally enforce `expected_seq` if present: mismatch → `STALE` without validation or mutation (compares to current committed `seq`); record receipt. A retry with the same `event_id` returns the stored `STALE`; the caller must use a new `event_id` to retry against the newer `seq`.
5. For player proposals: run the **validation hook** (FR-058). On reject → record idempotency receipt, return rejection outcome (with current `seq`), project outbound rejection only to authorized principals, stop.
6. For dealer/control/system: run optional game validation when registered (FR-067). On reject → same receipt/outcome rules as step 5.
6a. If the proposal targets an open collection gate, then — only after steps 4–6 succeed — the validated payload becomes a **sealed** one-action batch (`engine.gate_submit`, FR-162) that proceeds through steps 8–10 like any committing batch: it is subject to `expected_seq` and advances `seq`. If that submission satisfies the gate's quorum, or the proposal is a host `system` close (FR-161), the resolve hook runs in step 7 of the same transaction and its actions join the batch (one `seq`).
7. Invoke state-changing hook(s); collect primitive actions per FR-053a. Exceeding cascade depth → `CASCADE_LIMIT`; hook error → `HOOK_ERROR`; hook time budget exceeded → `HOOK_TIMEOUT` (FR-064/065). Each aborts with no mutation; record receipt.
8. Run structural/invariant validation (FR-054). On failure → no mutation; record receipt; outcome to host.
9. If the collected batch is **empty**: apply FR-052a (no `seq` advance, no log append, no state-advanced event); durably record the acceptance receipt with current `seq`; then publish the acceptance outbound event (FR-103; no state-advanced event) and return the outcome; stop.
10. **Commit** atomically: append the non-empty batch to the action log, advance `seq`, persist the idempotency receipt, and — **when durable storage is configured** — durable-commit the batch + receipt **before** publishing any outbound events for that `seq` (NFR-043). Then publish versioned outbound events (acceptance + state advanced) to authorized subscribers.
11. On any failure or early exit in steps 2–8 (including `SESSION_ENDED`, unauthorized, `NOT_YOUR_TURN`, `STALE`, rejections, structural failures and hook/cascade aborts): leave authoritative state and the action log unchanged, and record a durable receipt (FR-112). Return an outcome to the host echoing `event_id`. Outbound projection of failures/rejections occurs only for principals authorized to observe that outcome; unauthorized callers receive host-only errors with no projected event.

**Replay:** Replay SHALL apply logged primitive actions from the replay package using engine builtins for `move` / `flip` / `shuffle` / `set_metadata` / `lifecycle` / `counter_adjust` / `counter_transfer` / `control_set` / `control_advance` / `grant_view` / `revoke_view` / `zone_create` / `zone_destroy` (`draw` and `zone_merge` are macros and never appear in the log), engine-supplied reducers for the reserved `engine.*` `meta` schemas (gate lifecycle, grant expiry/consumption), and game-registered pure **reducers** for all other `meta` and for `roster`. Replay SHALL NOT invoke validation or state-changing hooks. Replay depends on the package contents **plus** the declared resolvable game-definition artifact (verified by content hash / schema version). Replay SHALL re-check FR-054 invariants on each action and abort with `REPLAY_INVALID(seq, action_index)` on violation.

**Setup / deal:** Session creation SHALL place all configured cards into their configured starting zones (FR-006). Initial deal and further setup state changes SHALL be expressed as logged actions (typically driven by a setup/`system` hook). Until the first setup transaction commits, player proposals MAY be rejected with `NOT_READY` if the game registers a setup gate; otherwise the game’s validation hook decides legality.

### 5.6.3 Minimum action vocabulary

Until a fuller vocabulary is frozen, the engine SHALL support at least these **primitive** logged actions (macros expand to primitives **before** logging; rows marked *macro* are never logged or replayed as such):

| Action | Payload (normative fields) | Preconditions (normative) |
|--------|----------------------------|---------------------------|
| `move` | `card_id`, `from_zone`, `to_zone`, `to_position` (if ordered) | Card is in `from_zone`; destination position in bounds; else `CARD_NOT_IN_ZONE` |
| `draw` *(macro)* | `from_zone`, `count`, `to_zone`, `to_position?` | `from_zone` has ≥ `count` cards (ordered zones draw from top); else `EMPTY_ZONE`. Expands to explicit `move`s of concrete `card_id`s **before** logging |
| `flip` | `card_id`, `orientation` (`face_up` \| `face_down`) | Card exists |
| `shuffle` | `zone`, `permutation` (ordered list of card ids) | Permutation is a rearrangement of the zone’s current membership |
| `set_metadata` | `card_id`, `fields` | Card exists; fields match declared schema |
| `lifecycle` | `to_state` (`completed` \| `terminated`), optional `outcome` (FR-181) | Legal transition per FR-084 |
| `counter_adjust` | `counter_id`, `delta`, optional `ratio` (`num`, `den`; FR-126) | Counter exists; result within `min`/`max` and any conservation group (FR-122–123); else `COUNTER_BOUNDS` |
| `counter_transfer` | `from_counter`, `to_counter`, `amount`, optional `ratio` (`num`, `den`) and `remainder_to` (FR-126) | As above; sum of a conservation group is unchanged (rounding remainder credited to `remainder_to`) |
| `control_set` | `phase?`, `active_seats?`, `direction?`, `pointer?` (FR-135) | Values within game-declared phase set; seats exist |
| `control_advance` | `steps`, optional `pointer` (FR-135), optional `mode` (`until_quiescent`, FR-136) | Honors `direction`; skips seats not `seated` (FR-134) |
| `grant_view` | `target` (card, zone, top-of-zone, range or filter, FR-153/155), `keys`, `grantee` (seat/subject id, `all_seated` or `team:<id>`, FR-156), `scope` | Target exists; keys valid; never widens privileged defaults (FR-151); a grantee of `dealer`/`auditor` is rejected |
| `revoke_view` | `grant_id` | Grant exists |
| `zone_create` | `template`, `owner`; `zone_id` is engine-derived per FR-193 and recorded in the log (a caller-supplied id, if any, MUST equal it) | Template declared; `max_instances` not exceeded, else `ZONE_LIMIT` |
| `zone_destroy` | `zone_id` | Zone is template-instantiated and empty |
| `zone_merge` *(macro)* | `src_zone`, `dst_zone` | Both template-instantiated (FR-194); expands to explicit `move`s of every card in `src` plus `zone_destroy(src)` in one transaction |
| `roster` | `op` (`join` \| `leave` \| `substitute` \| `set_status` \| `delegate` \| `revoke_delegation`), `player_id` (join/leave/substitute) or `seat_id` (set_status), optional `team_id`, optional `zones_to_create` (names declared templates only, FR-190), `status` (set_status), `subject`/`grantee_principal`, optional `scope` and `expires_at` (delegate/revoke_delegation, FR-170–173) | Player/team/seat ids valid; reducer creates/removes entities as declared; `leave` fails if the leaver's zones are non-empty unless the game declares a card disposition |
| `meta` | `schema_id`, opaque payload | Named versioned reducer present in the game-definition artifact, or a reserved `engine.*` schema (`engine.gate_open`, `engine.gate_submit`, `engine.gate_retract`, `engine.gate_resolve`, `engine.grant_expire`, `engine.grant_consume`) whose reducer is supplied by the engine |

Each log entry SHALL include at least: `seq`, `proposal_event_id` (when derived from an inbound event), `actor_id` / principal id, `on_behalf_of` (when acting for a seat the principal does not own, FR-171), action type, and payload.

### 5.7 Actions and replay

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-070 | Must | Every **accepted** non-empty state change SHALL be recorded as one or more **primitive** actions in an ordered action log, grouped under a committed `seq`. |
| FR-071 | Must | A **replay package** SHALL be sufficient, together with its resolvable game-definition artifact, for an operator to reproduce the complete game state at any `seq` by replaying from the packaged initial setup. |
| FR-072 | Must | Actions SHALL be serializable to a stable, portable representation (e.g. structured data) suitable for storage outside the process. |
| FR-073 | Must | Replaying the same replay package with the matching game-definition artifact SHALL yield the same final state (deterministic replay). Replay SHALL reject a package when the required game definition is unavailable or its content hash / action-schema version does not match. The hash/version bind is required so replay can load the correct reducers, schemas, and visibility registrations — not hooks. |
| FR-074 | Must | Non-deterministic operations (notably shuffle) SHALL record the **resulting permutation** (ordered card ids) in the log. A seed MAY also be recorded for diagnostics but MUST NOT be the sole replay input. |
| FR-075 | Must | The engine SHALL expose APIs to: read the log, rebuild state at `seq` *n*, export/import a replay package (including idempotency receipts), and — as a privileged host-only operation — apply actions directly. Direct apply still enforces FR-054 and NFR-043, runs no hooks, and requires a host-supplied `event_id` so a receipt is recorded (FR-112); it is not a bypass of the processing model's authorization. |
| FR-076 | Must | Rejected player actions (FR-059–FR-060) SHALL NOT appear as state-changing entries in the action log; replay of the log alone SHALL NOT depend on rejected attempts. Rejection outcomes SHALL still be retained in idempotency receipts (FR-112). |
| FR-077 | Must | A replay package SHALL contain: the ordered action log; an immutable serialized initial configuration (including the complete card-instance registry and zones); a game-definition identifier, content hash, and either an embedded executable artifact or a content-addressed reference resolvable by the replay environment (containing every reducer needed for `meta`/`roster`); action-schema version; any deterministic parameters required for setup; and the session’s idempotency receipts. |
| FR-078 | Must | The raw action log is a **privileged** operator artifact. Any role-filtered log or event stream exposed to non-operator principals SHALL redact hidden payloads per view-role rules (including shuffle permutations and metadata when not entitled). |
| FR-079 | Must | `meta` actions SHALL name a versioned reducer contained in the game-definition artifact (or be expanded into engine-defined primitives before logging). `roster` actions SHALL be applied only through a registered pure roster reducer. Reserved `engine.*` `meta` schemas are exempt from the game-artifact requirement; their reducers ship with the engine and are covered by the action-schema version. |

### 5.8 Lifecycle and session

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-080 | Must | The engine SHALL support creating a new game session from a game definition (zones, players, teams, hooks, reducers, initial card registry). New sessions start in lifecycle state `active` with `seq = 0` and all cards in their configured starting zones (FR-006). |
| FR-081 | Must | The engine SHALL support advancing an `active` session by dispatching external inputs through authorization, validation (for player proposals), and state-changing hooks per the processing model (§5.6.2). |
| FR-082 | Must | The engine SHALL support querying current state via the multi-role query API (FR-090–FR-094) and exposing the current `seq`. |
| FR-083 | Must | The engine SHALL support exporting and importing a replay package (FR-077) sufficient to fully replay a session or resume a session writer from the package (import restores state, log, `seq`, and idempotency receipts). There is no separate `paused` lifecycle state; “pause” means export and stop the writer. |
| FR-084 | Must | A session SHALL have lifecycle states `active`, `completed`, and `terminated`. Legal transitions: `active → completed`, `active → terminated`, `completed → terminated`. No other transitions (including any transition *to* `active`) are legal. After `completed` or `terminated`, the engine SHALL reject state-changing inbound events with `SESSION_ENDED`, except a host-authorized `lifecycle` event with `to_state: terminated` while the session is `completed`, preserve query and replay access, and emit a final versioned outbound notification. |
| FR-085 | Must | Session ids SHALL isolate state, log, subscriptions, idempotency receipts, and `seq` spaces from other sessions. |

### 5.9 Asynchronous event interface

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-100 | Must | The engine SHALL provide an **asynchronous interface to consume inbound events** (produce into the engine from external callers). |
| FR-101 | Must | The engine SHALL provide an **asynchronous interface to produce outbound events** (emit from the engine to external subscribers/consumers). |
| FR-102 | Must | Inbound events SHALL support at least proposed player actions, dealer/control events, and host-injected `system` events, each routed through authorization and validation per §5.6.2 before any state change. |
| FR-103 | Must | Outbound events SHALL include at least: acceptance or rejection of an inbound proposal (echoing `event_id` and the outcome’s `seq`), and notification that authoritative state has advanced (with `seq`) for non-empty commits only. |
| FR-104 | Must | Outbound event payloads intended for a given consumer role SHALL be projected through the same view-role rules as the query API (FR-094). |
| FR-105 | Must | The async interfaces SHALL be usable by adapters for **player frontends** and a **game remote frontend** without requiring those clients to share a process or machine with the engine. |
| FR-106 | Must | The engine SHALL treat the session as authoritative: when geographically distributed clients submit concurrent inbound events, the engine SHALL impose a single total order on accepted transactions. Accepted non-empty transactions SHALL receive gapless, strictly increasing `seq` values starting at 1. Ordering policy for arrival (FIFO vs host sequence) remains an open question (Q13) but MUST yield one total order. |
| FR-107 | Should | Subscribers SHOULD be able to filter outbound events by role/subject (e.g. only player P’s stream). Privileged subscriptions require host authorization of the principal (NFR-073). |
| FR-108 | Must | The async API SHALL be transport-agnostic (in-process queues, callbacks, or streamed messages) so concrete network protocols remain outside the engine. Network delivery, backpressure, and reconnect streams are adapter responsibilities; adapters MAY implement resync by querying a **current** role-scoped snapshot together with its current `seq` and comparing against the client’s last-seen `seq`. |
| FR-109 | Could | The engine MAY emit compact “delta” outbound events in addition to full view snapshots. Deltas SHALL carry `seq` and SHALL obey the same entitlement rules as full views (FR-104). |
| FR-110 | Must | Every inbound event SHALL carry a caller-scoped `event_id` and a request fingerprint (hash of the normalized payload). Repeated delivery of the same authenticated caller + `event_id` with the **same** fingerprint SHALL return the original acceptance/rejection and `seq` without reapplying actions. Same `event_id` with a **different** fingerprint SHALL return `IDEMPOTENCY_CONFLICT`. |
| FR-111 | Must | Inbound proposals MAY carry `expected_seq`. On mismatch the engine SHALL reject with `STALE` without running validation or mutating state (after authorization per §5.6.2). |
| FR-112 | Must | The session SHALL durably retain an **idempotency receipt** for every processed `(authenticated_caller_id, event_id)` for at least the session’s export/retention lifetime (included in the replay package). A receipt contains request fingerprint, outcome, error code (if any), and committed `seq` when a non-empty transaction committed (otherwise the current `seq` at decision time). Receipts for accepted non-empty commits SHALL be persisted atomically with the batch (NFR-043). Rejection and empty-accept receipts SHALL also be durable so FR-110 holds across restart/resume. |

### 5.10 Non-card state and session primitives

Added from the game-rule verification (`docs/game_verifications.md`). These generic primitives replace per-game use of opaque `meta` for scores, chips, turn order, temporary reveals and simultaneous answers. All new actions are primitive, logged, and replayed by engine builtins (§5.6.3) unless noted.

#### 5.10.1 Counters

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-120 | Must | The engine SHALL support **counters**: named integer-valued entities owned by the table, a player, a team, a zone, or a card, declared in the immutable initial configuration with `owner`, `min`, optional `max`, initial value, a visibility declaration (projection key `counter_value`), and optional `supply_role` (FR-123). |
| FR-121 | Must | The action vocabulary SHALL include `counter_adjust` and `counter_transfer` (§5.6.3). |
| FR-122 | Must | Structural validation (FR-054) SHALL enforce counter bounds; a violating action fails with `COUNTER_BOUNDS` and leaves state unchanged. |
| FR-123 | Should | The configuration MAY declare a **conservation group** (a set of counters whose sum is invariant under `counter_transfer`, e.g. chip stacks plus pots). A counter declaration (FR-120) MAY carry `supply_role: mint \| burn`. The engine SHALL reject any batch that changes the group sum except via `counter_adjust` on a member whose `supply_role` is set. |
| FR-124 | Should | Counters SHOULD be instantiable from a template when a `roster` `join` action adds a player or team. |
| FR-125 | Should | A counter MAY be declared **derived**: a read-only value computed from a declared expression over zone counts, other counters, or `meta` fields (e.g. hand size, a team's bags). Derived counters are projectable under `counter_value` with the same visibility as their inputs and are not valid `counter_adjust`/`counter_transfer` targets. |
| FR-126 | Should | A counter or conservation group MAY declare a **fixed scale** and **rounding mode** (`floor`, `half_up`, `half_even`). `counter_transfer`/`counter_adjust` MAY take a rational `ratio` applied under that rounding; the rounding remainder is credited to a game-named counter (house/rake) so FR-123 conservation still holds (Baccarat 5 % commission, Blackjack 3:2, Poker odd chip). |

#### 5.10.2 Control state (turn / phase)

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-130 | Must | The session SHALL carry engine-managed **control state**: `phase` (opaque string from a game-declared set), `turn_order` (ordered seat ids), `active_seats` (set of seats allowed to act now, possibly several), and `direction` (`+1`/`-1`). |
| FR-131 | Must | The action vocabulary SHALL include `control_set` and `control_advance` (§5.6.3). |
| FR-132 | Should | If the game declares `enforce_active_seats: true`, a `player` proposal from a seat not in `active_seats` SHALL be rejected with `NOT_YOUR_TURN` before the validation hook, except for event kinds the game declares **out-of-turn permitted** (e.g. Truco Envido, Uno call). Default is `false` so hook-only designs remain valid. |
| FR-133 | Must | Control state SHALL be projected to all view roles by default; games MAY redact it via visibility declarations (projection key `control_state`, FR-042). |
| FR-134 | Should | Seats SHALL carry status `seated`, `sitting_out`, or `eliminated`, set by the `roster` `set_status` op; `control_advance` SHALL skip non-`seated` seats (Euchre alone, busted Poker players). |
| FR-135 | Should | Control state SHOULD allow additional **named pointers** into `turn_order` (e.g. `dealer`, `lead`, `button`, `contract_holder`) set and advanced independently of `active_seats` (Poker button/blinds, dealer rotation in Bridge/Cribbage/Gin). |
| FR-136 | Could | `control_advance` MAY accept `mode: "until_quiescent"`: cycle through `active_seats`, stopping when a full cycle contains only `pass` results or a game-declared closure predicate holds (Poker betting-round close, MTG-subset priority, Truco call chains). |

#### 5.10.3 Projectable `meta` state

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-140 | Must | Every `meta` schema registered in the game-definition artifact SHALL declare, per field, `public`, `role/subject-visible`, or `secret` (same default as FR-004b: undeclared fields are omitted from every external view). |
| FR-141 | Must | Reducer-owned `meta` state SHALL be part of the state view, query API, and outbound projection under FR-042, FR-094 and NFR-071, so games need no parallel host state to show scores, bids, trump or colour. |
| FR-142 | Should | A `meta` schema MAY name an advisory **standard shape** (e.g. `bid`, `contract`, `score_sheet`, `pending_call`) for frontend/tooling reuse; it does not change core semantics. |

#### 5.10.4 Dynamic view grants

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-150 | Must | The engine SHALL support `grant_view` and `revoke_view` (§5.6.3): logged, replayed by builtins, applied on top of the game's static visibility rules. |
| FR-151 | Must | A grant SHALL be additive and fail-closed: it may extend a grantee's entitlement for named keys on named targets but SHALL NOT widen the privileged-role defaults of FR-046/FR-047. |
| FR-152 | Must | `scope` SHALL be `until_revoked`, `until_seq` (`n`), or `once`. A `once` grant is consumed only by the next **outbound** projection to the grantee made inside a committing transaction; consumption is logged in that transaction (`engine.grant_consume`). Read-only queries (FR-092) never consume a grant and never log. `until_seq` expiry is logged (`engine.grant_expire`) in the first committing transaction at or after `n`. All expiry and consumption are logged actions so replay stays byte-identical (NFR-001). |
| FR-154 | Must | A grant's existence SHALL be visible only to the grantee and to roles already entitled to see the target (no side channel). |
| FR-153 | Should | A **top-of-zone** target selector SHOULD grant entitlements to whichever card is currently on top (discard-top-only). |
| FR-155 | Should | A grant target selector MAY also be a **range** (`top_n`, `bottom_n`) or a **filter** over card `meta` (e.g. all cards of rank 8), re-evaluated at each projection. Resolved: predicate targets are permitted (Q17). |
| FR-156 | Should | `grant_view` SHOULD accept `grantee: "all_seated"` and `grantee: "team:<id>"` in addition to a single seat/subject id (show-down reveals, meld shows). |

#### 5.10.5 Sealed simultaneous submissions

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-160 | Must | The engine SHALL support a **collection gate**: a game opens a gate naming expected seats and a `schema_id`. Each seat's proposal is validated and recorded but **sealed** (not projected to any non-entitled role, including other expected seats) until resolution. |
| FR-161 | Must | A gate resolves when every expected seat has submitted, or when the host injects a `system` event (e.g. timeout) that closes it. Resolution invokes a game-registered resolve hook with all sealed payloads in seat order **plus the list of seats that did not submit**, as part of one transaction with one `seq`. Without FR-165, missing seats are simply absent from the payload list (no defaults are substituted). |
| FR-162 | Must | Gate lifecycle (open, submit, retract, resolve) SHALL be logged as reserved engine `meta` actions (`engine.gate_open`, `engine.gate_submit`, `engine.gate_retract`, `engine.gate_resolve`; §5.6.3) with engine-supplied reducers. Sealed submissions SHALL be durable, carry `secret` payloads (FR-078 redaction applies), and be reconstructible on replay. Each per-seat submission is a committing transaction (§5.6.2 step 6a) and advances `seq`. |
| FR-163 | Should | A seat SHOULD be able to retract or replace its sealed submission before resolution if the game permits; each retraction is a logged action. |
| FR-164 | Should | A gate MAY declare a **quorum**: `all` (default, FR-161), `any`, or `n_of`, optionally per team (e.g. "either partner answers"). The first satisfying submission resolves the gate; later submissions are rejected with `GATE_CLOSED`. |
| FR-165 | Should | A gate MAY declare a `timeout_policy`: the `system` event kind that closes it and the **default payload** substituted for each missing seat (overriding the FR-161 missing-seat list). The engine holds no clock (§2.2); the host fires the event (Q18). |
| FR-166 | Should | A gate MAY be **request/response** typed: one seat opens it addressed to named seats with a declared response schema (`accept`/`decline`/`counter`), the first-class form of the advisory `pending_call` shape (FR-142) (Canasta "may I go out?", Bridge claim, Truco/Envido chains). |
| FR-167 | Could | A gate MAY open **nested** within another gate or out-of-turn play, up to a game-declared maximum depth (Truco Truco→Retruco→Vale cuatro). |

#### 5.10.6 Delegated control

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-170 | Must | FR-068 actor↔principal binding SHALL evaluate against the principal's **effective subject set** (§3: host-asserted bindings ∪ logged delegations); the `roster` ops `delegate` and `revoke_delegation` (§5.6.3) add or remove subjects (e.g. "may act as seat S") via logged actions. |
| FR-171 | Must | For a proposal made on behalf of a seat the principal does not own, the validation hook SHALL receive both seats, and the log entry SHALL record `actor_id` and `on_behalf_of`. |
| FR-172 | Should | Delegations SHOULD be revocable via logged `roster` `revoke_delegation` actions, including as part of hand end. |
| FR-173 | Should | A delegation MAY declare a **scope** (event kinds and/or zones) and an **auto-expiry** at a named lifecycle boundary, so e.g. dummy control lapses at hand end without a separate revoke action. |

#### 5.10.7 Multi-hand lifecycle and outcomes

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-180 | Must | Hand, deal, round, coup and rubber boundaries are **game-level events**. Session lifecycle stays `active` across them and moves to `completed` only when the game declares the match finished (FR-084). |
| FR-181 | Must | The `lifecycle` action SHALL accept an optional structured `outcome` (e.g. `winner_ids`, `ranking`, `reason`, `final_scores`), logged and projected under FR-042. |
| FR-182 | Should | The engine SHOULD provide a `reset_to_zone` macro that expands to primitive `move`/`flip` actions returning a set of zones to a source zone (e.g. collect cards to `undealt` after a hand). |
| FR-183 | Should | `outcome.reason` SHOULD support draw/stalemate values (blocked Crazy Eights, War turn cap, Klondike no moves) so these end as `completed`, not `terminated`. |
| FR-184 | Should | `outcome` MAY include a `carry_over` payload (final counters/`meta` designated by the game). A new session's initial configuration MAY accept it as seed data. The engine still models one session; the host sequences sessions (§2.2). |
| FR-185 | Should | The engine SHOULD expose a privileged host-level `fork_from_seq(n)` that rebuilds state from the log up to `n` into a **new** session/branch, leaving the original log immutable; per-game policy-gated. It formalizes the FR-075 rebuild-by-replay workaround (Klondike take-back) and is not an in-core undo stack. |
| FR-186 | Should | `outcome.reason` SHOULD use a standard vocabulary: `win`, `draw`, `stalemate`, `turn_cap`, `resigned`, `abandoned`, `adjusted` (a host/director ruling applied via `system` + `meta`). Extends FR-183. |

#### 5.10.8 Template zones

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-190 | Should | The engine SHOULD support `zone_create` / `zone_destroy` (destroy only when empty) for zones instantiated from **templates declared in the initial configuration**, preserving the closed-world rule of FR-006 (Rummy/Canasta melds, Blackjack split hands). |
| FR-191 | Should | Template-instantiated zones SHALL count against the NFR-020 zone floor; creation beyond a template's `max_instances` fails with `ZONE_LIMIT`. |
| FR-192 | Could | A **reserve pool** zone MAY hold pre-registered spare instances (tokens, copies) so "spawn" is a `move` from reserve; this is the sanctioned substitute for `create_card`. |
| FR-193 | Should | Template zones SHOULD be **parameterized** (owner seat/team, label, ordering, visibility inherited from the template) and receive a stable generated id derived from `(template, owner, ordinal)`, deterministic across replay. Ordinals are never reused within a session, even after `zone_destroy`. |
| FR-194 | Should | The vocabulary SHOULD include `zone_merge(src, dst)` (§5.6.3) and allow `zone_create` + `move` in a single atomic batch (Canasta meld extension, Blackjack split, Rummy lay-off consolidation). |

## 6. Non-Functional Requirements

### 6.1 Correctness and determinism

| ID | Priority | Requirement |
|----|----------|-------------|
| NFR-001 | Must | Given an identical replay package and matching game-definition artifact, two independent replays SHALL produce **byte-identical** canonical serialization of state (schema-defined key order and number format). A digest (e.g. SHA-256) of that serialization after each `seq` SHALL match across replays. |
| NFR-002 | Must | Read-only state views passed to hooks SHALL not allow mutation of the authoritative state (enforced by API contract and, where the language allows, by type/immutability guarantees). After language selection (Q1), a conformance test SHALL verify that attempted mutations leave the authoritative digest unchanged. |

### 6.2 Performance

Performance NFRs below are **provisional** until open question 10 pins a reference machine, runtime, warmup, and percentile policy.

| ID | Priority | Requirement |
|----|----------|-------------|
| NFR-010 | Should | *(Provisional)* Applying a single typical action batch (≤ 20 card moves/flips) on a game with ≤ 200 card instances and ≤ 20 zones SHOULD complete in ≤ 5 ms on the pinned reference machine. |
| NFR-011 | Should | *(Provisional)* Full replay of a game with ≤ 10 000 actions under the same size bounds SHOULD complete in ≤ 2 s on the same reference machine. |
| NFR-012 | Should | State queries (zone listing, hand listing) SHOULD be O(size of result) and not require full log replay on every query after the session is live. |

### 6.3 Scalability and distribution

| ID | Priority | Requirement |
|----|----------|-------------|
| NFR-020 | Must | A single session SHALL support at least **14 seats**, 4 teams, **700** card instances, and **64** zones (including template-instantiated zones, FR-191) without engine structural limits below those floors. *(Raised from 8 / 500 / 32 for Baccarat, 8-deck shoes, MTG-with-tokens, and meld zones.)* |
| NFR-026 | Must | Counters, grants, sealed submissions, open gates and control state SHALL be included in the canonical serialization and per-`seq` digest of NFR-001. |
| NFR-029 | Should | Derived counters (FR-125), quorum gates (FR-164) and parameterized zone ids (FR-193) SHALL be included in the canonical serialization and per-`seq` digest (extends NFR-026). |
| NFR-027 | Should | The cascade cap (FR-053a) SHALL be per-game configurable up to at least 256; default remains 16. |
| NFR-028 | Must | Counter arithmetic SHALL be exact signed integer (arbitrary precision or at least 64-bit); no floats. Overflow fails with `COUNTER_BOUNDS`. Fractional amounts (e.g. Baccarat 5 % commission) require a game-declared fixed scale. |
| NFR-021 | Should | Soft targets: up to 16 players and 2 000 card instances for stress testing; degradation beyond that may be acceptable if documented. Performance targets at the NFR-020 floor SHOULD be documented when Q10 is resolved (current provisional timings use ≤200 cards / ≤20 zones). |
| NFR-022 | Must | The engine SHALL NOT require players or frontends to be co-located with the engine process; geographic distribution of clients is a supported deployment assumption. |
| NFR-023 | Must | Correctness of accepted state transitions SHALL NOT depend on client wall-clock synchronization (no reliance on synchronized client clocks for ordering). |
| NFR-024 | Should | *(Provisional)* Role-scoped state query for a typical session (≤ 200 cards, ≤ 20 zones) SHOULD complete in ≤ 5 ms on the reference machine, excluding network transport time. |
| NFR-025 | Should | *(Provisional)* Emitting an outbound event to local async subscribers after an accepted batch SHOULD add ≤ 2 ms overhead on the reference machine, excluding network fan-out. |

### 6.4 API and extensibility

| ID | Priority | Requirement |
|----|----------|-------------|
| NFR-030 | Must | Game-specific behavior SHALL be injectable only through documented hooks, reducers, and configuration — not by forking engine internals. Hook code is trusted for **liveness** of the process; hook **outputs** remain untrusted for correctness and are subject to structural validation (NFR-070). |
| NFR-031 | Must | The public API SHALL separate: (a) multi-role state query, (b) async event produce/consume, (c) action application/replay, (d) hook/reducer registration/game definition. |
| NFR-032 | Should | Action, event, and state-view schemas SHOULD be versioned so older logs/clients can be detected as incompatible rather than silently misread. |

### 6.5 Reliability and error handling

| ID | Priority | Requirement |
|----|----------|-------------|
| NFR-040 | Must | Failed engine/structural validation of an action batch, rejection by the state validation hook (FR-059–FR-060), authorization failure, hook abort (FR-064), `HOOK_TIMEOUT`, `CASCADE_LIMIT`, `STALE`, and `SESSION_ENDED` MUST leave authoritative state and the action log unchanged. |
| NFR-041 | Must | Errors SHALL identify the failing action and the reason (unknown card id, illegal zone, `EMPTY_ZONE`, `CARD_NOT_IN_ZONE`, etc.) at a level useful to game implementers. Detail returned to non-privileged principals SHOULD be limited to stable error codes; full detail goes to engine diagnostics (NFR-050) and privileged principals. |
| NFR-042 | Must | Partial application of a transaction MUST NOT occur (all-or-nothing) — same semantics as FR-053. |
| NFR-044 | Must | The current snapshot used for resync (FR-108) SHALL include counters, control state, active grants and open gates visible to the requesting role, so reconnecting clients need not replay events. (Derived counters, quorum and parameterized-zone extras follow their own Should FRs.) |
| NFR-043 | Must | **When** the host enables durable storage: for an accepted non-empty transaction, persistence of the complete ordered batch, its idempotency receipt, and publication of its `seq` SHALL be atomic with respect to recovery — after a crash, recovery SHALL yield either the state before the batch or the state after replaying the complete batch, never a partial batch; outbound events for `seq` *n* SHALL NOT be published until that durable commit succeeds. If the host runs the engine without durable storage, that limitation SHALL be documented; crash recovery is then out of scope for the engine (in-memory receipts still apply for the process lifetime). |

### 6.6 Observability (engine-level only)

| ID | Priority | Requirement |
|----|----------|-------------|
| NFR-050 | Should | The engine SHOULD emit structured diagnostics for rejected batches and hook failures (no requirement for product analytics/audit pipelines). |
| NFR-051 | Could | Optional trace of applied actions for debugging replay mismatches. |
| NFR-052 | Should | The engine SHOULD ship a conformance harness running the five scenario types of §1.1 (setup, legal action, rejected action, replay, role projection) for any registered game definition. |
| NFR-053 | Should | Hook execution SHOULD expose a cost budget in addition to the FR-065 time budget (meld/deadwood/show evaluation is combinatorial). A shared pure helper library (set/run detection, subset enumeration) MAY be provided outside the core. |
| NFR-054 | Should | A **pure helper library** outside the core SHOULD ship: set/run detection, meld/deadwood optimization, 15-count and pairs, poker hand ranking, follow-suit and trick-winner helpers, with golden tests and the NFR-053 cost budget. |
| NFR-055 | Should | Hook cost budgets (NFR-053) SHOULD be configurable per hook kind with documented defaults so a combinatorial `show`/`meld` hook cannot starve a session. |
| NFR-056 | Should | The engine SHOULD support a **host-driven timer protocol** (no engine clocks): the game emits an advisory `timer_request{id, kind, duration_hint}` outbound event; the host answers with a `system` event. Timer events are logged and replayed like any other (Uno call window, gate timeouts FR-165). |
| NFR-057 | Should | Conformance packs (NFR-052) SHOULD include one scenario pack per game in `docs/game_rules/` (setup, legal, rejected, replay, projection). MTG is tagged **subset** and SHALL NOT claim Comprehensive Rules compliance. |
| NFR-058 | Should | Conformance SHOULD include a **fixed-pool vs template-zone equivalence test**: the same Rummy/Gin/Blackjack definition built both ways yields equivalent outcomes for a given seed. |
| NFR-059 | Should | For games with fractional payouts, the exact scale and rounding mode (FR-126) SHALL be part of the game-definition artifact and covered by the log digest. |

### 6.7 Portability and packaging

| ID | Priority | Requirement |
|----|----------|-------------|
| NFR-060 | Must | The engine SHALL be consumable as a library (language/runtime TBD — see open questions). |
| NFR-061 | Should | Serialized action logs / replay packages SHOULD be language-agnostic (e.g. JSON or similar) to allow operators to store and inspect them outside the runtime. |
| NFR-062 | Should | Game definitions SHOULD be declaratively describable (zones, counters, visibility, schemas), with hooks reserved for rules, so the same artifact can drive tooling, docs and the conformance harness. |

### 6.8 Security / trust boundary

| ID | Priority | Requirement |
|----|----------|-------------|
| NFR-070 | Must | The engine SHALL treat hook **outputs** and inbound events as untrusted input subject to validation before state mutation. |
| NFR-071 | Must | A query or outbound projection for view role R MUST NOT include face, type, **metadata**, hidden zone-order details, or other fields that R is not entitled to see under the game’s visibility rules. |
| NFR-072 | Must | Callers MUST specify the view role used for a query or subscription. The engine MUST NOT default any caller to dealer, auditor, or other privileged views. |
| NFR-073 | Must | For every query, inbound event, and subscription, the trusted **host/adapter SHALL authenticate** the caller and **authorize** the requested role and subject against a session entitlement mapping before invoking the engine. An unauthorized role/subject request SHALL be rejected and SHALL produce no view or projected event. The engine API is a **trusted-caller** surface: principals are asserted by the host, not chosen unilaterally by remote clients. The engine additionally enforces FR-068 and may invoke a registered authorization hook. |
| NFR-063 | Should | When published (§11 item 1a), the implementer cookbook SHALL document each workaround in use while its Should is unimplemented (fixed meld-zone pool, orientation for discard-top, `meta` for partner consultation). |
| NFR-064 | Could | Capacity guidance SHOULD cover corpus extremes (8-deck Baccarat shoe, double-deck Pinochle, 4-deck + jokers Canasta, 14-seat table) with measured timings at the NFR-020 floor, closing the provisional status of NFR-024/025 (Q10). |
| NFR-074 | Could | Cryptographic integrity of logs and event channels is out of scope unless later required; operators/adapters may wrap them externally. |

## 7. Constraints and design principles

1. **Event/action sourced truth** — authoritative history is the action log; live state is a projection. Genesis is immutable config (full card registry in starting zones) + **logged** setup/deal actions (no silent bootstrap snapshot outside the package).
2. **Instance uniqueness** — identity is per card instance, never only per face/type.
3. **Rules live in hooks; opaque ops in reducers** — the engine provides structure and application mechanics; games provide meaning via hooks (live) and pure reducers (live + replay).
4. **Validate before mutate** — illegal player actions are rejected by a **separate** validation hook with no state change and no action-log append; dealer/control/system events are authorized equivalently; actor↔principal binding is enforced in-engine.
5. **Role-scoped information** — every external observation of state (query or outbound event) is through an explicit view role; privileged roles fail closed by default; zone order is a separate entitlement.
6. **Transport-agnostic async edge** — engine speaks async events; network protocols and delivery live in adapters.
7. **No UI / no AI / no audit product logic** — keep those layers outside this project (auditor *view* is in; audit *pipelines* are out).
8. **Replayability over convenience** — prefer explicit, logged results (permutations, targets) over hidden randomness or seed-only replay.
9. **Trusted host boundary** — remote clients never supply their own authorization; the host asserts principals.
10. **Durable idempotency** — acceptance and rejection outcomes are recoverable across resume via receipts, not only via the action log.

## 8. Assumptions

- A “game definition” (hooks + reducers + initial configuration schemas/visibility) is provided by the game implementer; its identifier, content hash, and resolvable artifact are bound into every replay package.
- Player and game frontends are often remote and geographically distributed; a host/adapter layer authenticates callers, asserts principals (including subject bindings), and bridges network transport to the engine’s async event API.
- A **single writer process** owns each session and is the authority for ordering accepted transactions; clients are not trusted for global ordering. Multi-node failover is out of scope unless later required.
- Teams are optional per game but the data model supports them when used.
- “Operator reproduce the complete game” means reconstruct successive states from the replay package + game-definition artifact, not re-run human decision-making.
- Exact card-face entitlements for dealer / auditor are game-defined and fail closed until registered; render defaults to public layout data.
- Network reconnect and at-least-once delivery are implemented by adapters using current snapshot + `seq` queries (FR-108).

## 9. Open questions (refinement backlog)

Status values: **Open** | **Resolved** | **Resolved (provisional)**.

| # | Status | Question |
|---|--------|----------|
| 1 | Open | **Implementation language / runtime** — Python, TypeScript, other? Multi-language bindings needed? |
| 2 | **Resolved (provisional)** | **Action granularity** — log **primitives** only; macros expand before logging. Minimum set in §5.6.3 (`draw` and `zone_merge` are macros that expand to logged `move`s); fuller vocabulary still to be expanded in implementation notes. |
| 3 | **Resolved (provisional)** | **Zone ordering model** — ordered lists plus unordered zones (FR-013/014) and template zones (FR-190); bags/maps not first-class. |
| 4 | **Resolved (provisional)** | **Visibility rule authoring** — declarative visibility (FR-042 keys, FR-140 `meta` fields) plus logged dynamic grants (FR-150–154) for temporary/peer reveals; hook-computed redaction not required. |
| 5 | Open | **Inbound concurrency** — single-threaded session actor only, or concurrent callers with internal queueing? (Must still present one total order / `seq`.) |
| 6 | **Resolved** | **Initial deal** — dealing/setup SHALL be expressed as logged actions from a pre-registered card registry (FR-006). |
| 7 | **Resolved** | **Default entitlements** — player: own hand + public face-up; render: public layout; dealer/auditor: **denied until registered** (fail closed). |
| 8 | Open | **Schema evolution** — how strictly to version actions/events/views from day one? |
| 9 | **Resolved (provisional)** | **Reference games** — War + team trick-taking for Must acceptance (§1.1). Further games optional. |
| 10 | Open | **Performance reference machine** — pin NFR-010/011/024/025 (machine, runtime, warmup, percentile). |
| 11a | **Resolved** | **Outbound rejection events** — yes, emit per FR-103; projection/redaction per FR-061 and FR-094. |
| 11b | **Resolved** | **Persist rejections outside the action log** — yes, as durable idempotency receipts (FR-112), included in the replay package. |
| 12 | **Resolved** | **Validation vs apply** — validation is always a **separate** hook before state-changing hooks; rejection remains zero-mutation. |
| 13 | Open | **Total-order arrival policy** — FIFO arrival at engine, explicit logical clocks, or host-assigned sequence numbers on inbound events? (Committed `seq` is always gapless regardless.) |
| 14 | Open | **Subscription model** — push callbacks, async iterators/streams, or both? |
| 15 | Open | **Spectator role** — distinct from auditor/render, or covered by those? |
| 16 | **Resolved (provisional)** | **Derived counters** — yes, read-only derived counters may be declared (FR-125). |
| 17 | **Resolved (provisional)** | **Grant cardinality** — ranges and `meta` filters are allowed in addition to explicit targets and top-of-zone (FR-155). |
| 18 | **Resolved (provisional)** | **Gate timeout** — always a host `system` event; a gate declares the event kind and default payload (FR-165, NFR-056); without FR-165 the Must close behavior is FR-161 (missing-seat list). No `seq`-based deadlines. |

## 10. Candidate capability checklist (common for similar engines)

Use during refinement workshops; promote items into FRs/NFRs or explicitly reject them.

| Capability | Proposed disposition |
|------------|----------------------|
| Unique card instance IDs | In — FR-001 |
| Genesis card registry / `undealt` | In — FR-006 |
| Face up / face down (+ entitlement separate) | In — FR-003, FR-040–FR-049 |
| Hands, draw, discard, arbitrary zones | In — FR-010–FR-021, `draw` in §5.6.3 |
| Team zones | In — FR-030–FR-031 |
| Hook → actions pipeline + processing model | In — FR-050–FR-056, FR-053a, §5.6.2 |
| State validation hook (reject, no mutation) | In — FR-057–FR-062, FR-067–FR-068 |
| Minimum primitive action vocabulary | In — §5.6.3 |
| Action log + deterministic replay package + reducers | In — FR-070–FR-079 |
| Shuffle records permutation | In — FR-074 |
| Multi-role state views (player/dealer/auditor/render) | In — FR-042–FR-049, FR-090–FR-094 |
| Host/adapter authz of principals + actor binding | In — NFR-073, FR-068 |
| Async produce/consume + durable idempotent `event_id` | In — FR-100–FR-112 |
| Session lifecycle (`active`/`completed`/`terminated`) | In — FR-080–FR-085 |
| Geographically distributed players | In — NFR-022–NFR-023 |
| Turn/phase control state in core | In — FR-130–FR-136 (enforcement optional, FR-132) |
| Counters / chips / scores with conservation | In — FR-120–FR-126 |
| Projectable `meta` state | In — FR-140–FR-142 |
| Dynamic view grants (peer / temporary reveal) | In — FR-150–FR-156 |
| Sealed simultaneous submissions (gates) | In — FR-160–FR-167 |
| Delegated control (dummy hand) | In — FR-170–FR-173 |
| Multi-hand lifecycle + `outcome` | In — FR-180–FR-186 |
| Template zones / reserve pool | In — FR-190–FR-194 |
| Timing / priority / stack (MtG-like) | Out of core — host may inject `system` events |
| Concrete network transport / matchmaking | Out — adapters above async API |
| Card/UI rendering implementation | Out — render *view* in; render *engine* out |
| Bot / strategy | Out |
| Audit/analytics product pipelines | Out — auditor *view* in |
| Physical-shuffle anonymity / id re-keying | Out — documented non-goal (§2.2) |
| Undo via log truncate/branch | In (host-level, Should) — `fork_from_seq`, FR-185; no in-core undo stack |
| Time-travel debugger UI | Out (operators may build externally) |
| Multi-node session failover | Out — single writer assumed |

## 11. Next refinement steps

1. Resolve remaining open questions **1, 5, 8, 10, 13–15** (language, concurrency, schema evolution, perf baseline, ordering arrival, subscriptions, spectator).
1a. Write an implementer **cookbook** for patterns that need no new requirement (Left Bower effective suit, cut card as a registered card, Cribbage pegs as counters, Canasta freeze as `meta` flag, Uno call via `system` timeout, variants as separate content-hashed game definitions) and for each workaround listed in NFR-063.
2. Expand the **action vocabulary** beyond the §5.6.3 minimum and freeze the **inbound/outbound event vocabulary** (`event_id`, fingerprint, outcomes, deltas).
3. Implement acceptance scenarios for War and team trick-taking (§1.1) against these FRs to find gaps.
4. Promote or cut checklist items; then split this document into a formal implementation spec if/when needed.
5. After Q1 (language), add the NFR-002 mutation conformance test and pin provisional performance NFRs (Q10).
