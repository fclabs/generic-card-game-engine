# Generic Card Game Engine — Architecture

**Status:** Draft v1
**Inputs:** `docs/design.md` (domain design), `docs/requirements.md`
**Decisions taken for this document:** TypeScript · fully async (Promise/`async`-`await` coroutines) · YAML for configuration · Docker for running *and* testing · single instance first, multi-instance later.

This document turns the technology-neutral domain design into a deployable system. It is split in two:

- **Part A — Minimal architecture (MVP):** the smallest system that satisfies every *Must* requirement on one instance.
- **Part B — Planned architecture:** what changes to run as a horizontally scalable backend. Part B is built to be *additive*: every item in it is a new adapter behind a port that already exists in Part A (including `LeasePort`, `HookRunner`, `Publisher` and the `epoch`/`outbox` arguments of `SessionStore.commit`, all defined in A6 with single-node adapters). No domain code changes; application-layer changes are limited to the composition root.

---

## 0. Architectural principles

1. **Hexagonal / ports & adapters.** The domain (`Session`, `Projector`, `Replayer`, Rule SPI) has no I/O and no framework imports. Everything outside it (storage, transport, timers, leases, hook execution, auth) is a port with swappable adapters.
2. **Async at the edges, pure at the core.** All ports and all hooks are `async`. The state-transition function `Session.apply(state, batch)` is a **synchronous pure function** over immutable state: it needs no I/O, is trivially deterministic (NFR-001) and is the same code live and in replay. "Full async" is satisfied because every orchestration step (`ProposalHandler`, stores, publisher, hooks, timers, transport) is a coroutine; we deliberately do not make the deterministic kernel async.
3. **One writer per session.** A session is a single-writer actor (design §2.2, FR-106). Concurrency is *between* sessions, never *within* one. This holds in both the minimal and the scaled architecture; scaling means routing a session to exactly one owner, not sharing it.
4. **Event sourcing is the persistence model.** The stream of `Action`s is the truth; state is a fold. Snapshots/checkpoints are an optimisation behind `SessionStore`, verified by `StateDigest`.
5. **Fail closed.** Within a process, types make leaks a compile-time error: `Snapshot` (omniscient) ≠ `View` (projected); `PrivilegedBatch` is an opaque branded type that only `Projector` and `Replayer` can open.
6. **Declarative first.** A game is a YAML definition plus a small TypeScript Rule SPI module for what YAML cannot express (NFR-062).
7. **Same artifact everywhere.** One Docker image runs the server, the tests and the conformance packs.

---

# Part A — Minimal architecture (single instance)

## A1. Scope

In: all *Must* FRs/NFRs, durable commit (NFR-043), idempotency, replay/export, visibility, hooks, gates, grants, delegation, a network API, containerised run + test.

Out (deferred to Part B): multi-instance, external message bus, snapshots, hook process isolation, JWT/OIDC, metrics/tracing backends, admin UI.

## A2. System context

```
 ┌──────────────┐  principal asserted   ┌─────────────────────────────────────────┐
 │ Host app /   │  (trusted API key)    │          engine-server (1 process)      │
 │ game backend │──────────────────────▶│  HTTP + WebSocket/SSE                   │
 │ (auth, lobby)│◀──────────────────────│                                         │
 └──────┬───────┘   results + events    │  ┌───────────────────────────────────┐  │
        │ system events (timers)        │  │ application layer                 │  │
        │                               │  │ ProposalHandler · Publisher ·     │  │
 ┌──────┴───────┐                       │  │ SessionRegistry (actors)          │  │
 │ Frontends    │◀── role-scoped ───────│  └──────────────┬────────────────────┘  │
 │ (web/mobile) │    views & deltas     │  ┌──────────────▼────────────────────┐  │
 └──────────────┘                       │  │ domain core (pure TS)             │  │
                                        │  │ Session · Projector · Replayer    │  │
                                        │  │ GameDefinition · Rule SPI         │  │
                                        │  └──────────────┬────────────────────┘  │
                                        │       ports ────▼──── adapters          │
                                        │  SessionStore · Ledger · Authz · Timer  │
                                        └──────────────────┬──────────────────────┘
                                                           ▼
                                                   SQLite file (volume)
```

Frontends never talk to the engine directly with trusted identity: the **host** authenticates users and asserts a `Principal` (design §2.6). In the minimal setup the host is a trusted caller holding an API key; frontends reach views/events either via the host or via short-lived tokens the host mints (see B4 for the hardened form).

## A3. Repository and package layout

pnpm workspace, TypeScript project references, strict mode, ESM, Node 22 LTS.

```
packages/
  core/            # PURE domain. No node:*, no I/O. Runs in any JS runtime.
    session/       #   Session state, apply(), invariants, macros expansion, housekeeping
    definition/    #   GameDefinition types + compiler (VisibilityPolicy, RoleRegistry)
    visibility/    #   Projector: project_view / project_delta / project_log_entry / would_reveal
    replay/        #   Replayer, Forker, StateDigest, canonical serialisation
    spi/           #   Rule SPI interfaces (ValidationHook, ReactionHook, GateResolveHook, Reducer, AuthorizationHook)
    ports/         #   Port interfaces (SessionStore, IdempotencyLedger, AuthorizationPort, LeasePort, HookRunner, Publisher, TimerPort; no Clock)
    errors/        #   Error taxonomy (design §3.4)
  app/             # Application services (coroutines). Depends on core only.
    proposal-handler/   # 10-step pipeline
    session-registry/   # per-session actor mailbox, lazy load/evict
    publisher/          # post-commit projection + fan-out
    session-factory/
    package/            # export / import / fork / direct-apply services
  config/          # YAML loading, env interpolation, schema validation, content hashing
  adapters/
    store-memory/       # tests + ephemeral use
    store-sqlite/       # durable single-node store (default MVP)
    transport-http/     # Fastify routes (commands, queries, admin)
    transport-ws/       # WebSocket + SSE subscription gateway
    authz-static/       # API-key principal assertion + rule-based AuthorizationPort
    timer-host/         # optional helper: consumes timer Effects, posts `system` events
  server/          # composition root: wires config → adapters → app → transports
  helpers/         # pure helper lib: melds, runs/sets, poker ranking, trick winners (NFR-054)
  conformance/     # harness + scenario packs per game (NFR-052/057/058)
games/
  <game>/          # game.yaml + hooks.ts + conformance pack (one per docs/game_rules/*)
deploy/
  Dockerfile  docker-compose.yml  docker-compose.test.yml
config/
  server.yaml  (sample)
```

Dependency rule (enforced with `dependency-cruiser` in CI): `core` ← `app` ← `adapters` ← `server`. `core` imports nothing from the others and nothing from `node:`.

## A4. Domain core in TypeScript

### Immutable state and exact arithmetic

- State is an immutable structure (structural sharing via `immer`-style producers or hand-rolled persistent updates). `apply` produces a *new* working state; commit swaps the reference. A failed `apply` discards the working state → atomicity (FR-053, NFR-042) is free.
- Hooks receive a **deep-readonly** `Snapshot` type (`DeepReadonly<T>`, and finished state is **deep-frozen in every build** (immer `autoFreeze`, or freeze once at commit, which is cheap with structural sharing). Hooks always receive finished, non-draft state. This implements NFR-002; the mutation conformance test attempts a cast-away mutation from a hook and asserts that the digest is unchanged and that no exception escaped.
- Counters are `bigint` (NFR-028: exact signed integers, no floats). Fixed-scale amounts (Baccarat commission) use game-declared scale + rounding mode.
- `Seq`, `CardId`, `ZoneId`, `SeatId`… are branded string/number types.

### Canonical serialisation and digest

`StateDigest` = SHA-256 over canonical JSON (**canonical profile v1**: JSON with keys in schema-defined order — not RFC 8785's lexicographic order — `bigint` as decimal strings, no floats, UTF-8, no insignificant whitespace; this profile is normative and must be frozen before any golden digest is committed). Computed per `seq` in conformance/verify mode and on demand; not on the hot path in production. Replay packages use the same canonical JSON (NFR-061, language-agnostic).

### Rule SPI

```ts
interface ValidationHook<K> {
  (ctx: { snapshot: GateMaskedSnapshot; proposal: Proposal<K>;
          actor: { actingSeat: SeatId; onBehalfOf?: SeatId };
          signal: AbortSignal }): Promise<Accept | Reject>;
}
interface ReactionHook { (ctx): Promise<{ actions: (Action|Macro)[]; effects: Effect[] }> }
interface GateResolveHook { (ctx: { sealed: SealedBySeat; missing: SeatId[] }): Promise<(Action|Macro)[]> }
interface Reducer<S> { (partition: Readonly<S>, payload: unknown): S }   // SYNC, pure — runs in replay
interface AuthorizationHook { (principal, op, target): Promise<Allow | Deny> }
```

- Live hooks are `async` (they may legitimately await helper work or, in Part B, a worker pool). **Reducers are synchronous and pure** because they run in replay and must be deterministic.
- Hooks receive an `AbortSignal`. `HOOK_TIMEOUT` (FR-065) is enforced by racing the hook against a timer *and* aborting the signal; because JS cannot pre-empt a synchronous CPU loop, the minimal build documents enforcement as **cooperative** (as FR-065 allows) and combinatorial helpers (meld/deadwood) check a **cost budget** counter (NFR-053/055) and the signal at loop boundaries. Hard pre-emption arrives with worker isolation (B6).
- Hook registration is by routing key (inbound kind | phase | named trigger), run sequentially in registration order inside a transaction (design §2.1).

### Determinism rules (lint-enforced in `core`, `helpers`, `games/*/hooks`)

No `Date`, `Math.random`, `performance.now`, `process.env`, `crypto.*`, timers (`setTimeout`/`setInterval`), `Atomics`/`SharedArrayBuffer`, network or fs in hooks/reducers. Randomness comes from the **seeded PRNG** in the definition's deterministic params; shuffles are logged as explicit permutations (so replay never re-randomises). ESLint custom rules + a test that runs hooks under a frozen-globals harness.

## A5. Application layer (coroutines)

### SessionRegistry — one actor per session

```
         propose(sessionId, event) ──▶ ┌───────────────────────────┐
                                       │ SessionActor (per session)│
 Promise-chained mailbox (FIFO)        │  state: Session (cached)  │
 one message processed at a time ────▶ │  seq, receipts cache      │
                                       └───────────────────────────┘
```

- Implementation: a minimal async mailbox (`queue: Promise<void>` chain or an async-iterator loop) per session. Messages for the same session are strictly serialised → one total order (FR-106). Different sessions run concurrently on the event loop.
- `ArrivalPolicy` (Q13): **FIFO by arrival at the actor** in the minimal build; the strategy interface exists so host-sequence ordering can be added later.
- Lazy load: first message loads from `SessionStore`; idle sessions are evicted (LRU + TTL from config) and rehydrated on demand.
- Backpressure: bounded mailbox per session (config); overflow → transient `OVERLOADED` result (execution category, not domain).

### ProposalHandler — the 10-step pipeline

Exactly design §2.2, implemented as one `async function handle(actor, inbound)` executed *inside* the actor, so steps 1–10 are never interleaved with another proposal of the same session:

```
1 idempotency → 2 lifecycle gate → 3 authz + actor binding → 3a turn enforcement
→ 4 expected_seq → 5 validation hook → 6a gate routing → 6b housekeeping
→ 7 reaction hooks (cascade cap) → 7b macro expansion → 8 Session.apply (sync, pure)
→ 9 empty-batch check → 10 commit (store.commit) → publish
```

Every early exit calls `ledger.record(...)` (FR-112) **before** returning. Hooks (steps 5, 6a, 7) are invoked through the `HookRunner` port, and the actor holds the `Lease` from `LeasePort` (Part A: single-node, epoch `0`). Commit calls `store.commit(sessionId, expectedSeq, epoch, transaction, receipt, outbox[])` atomically, where `outbox[]` holds the `commit` row and one `timer_request` row per timer Effect (an empty accepted batch writes only its `timer_request` rows, with `seq = NULL`, alongside the receipt); on success the actor updates its cached state and **then** hands the committed transaction to the `Publisher` (NFR-043: never publish before durable commit). In Part A the in-process `timer-host` drains the `timer_request` rows.

### Publisher

After commit, in seq order per session: for each authorized `Subscription` → `Projector.project_delta` → `OutboundEvent` → subscription's async sink (WebSocket/SSE channel). Per-subscription bounded async queue; a slow consumer is dropped with a `RESYNC_REQUIRED` marker (client then fetches the resync snapshot, NFR-044) — it never blocks the session actor.

The `Publisher` also has `emitAcceptance` / `emitRejection`, called on every ledger-recorded exit: rejections go only to principals authorized to observe them, and an accepted *empty* batch (no `seq` advance) still publishes its acceptance event (FR-103). In Part A push is **best-effort across a crash** (see A14); clients resync via `GET …/view`.

### Other services

`SessionFactory`, `Replayer`/`Forker`/`PackageExporter/Importer`, `DirectApply`, `StateDigest` verifier: plain async services over the ports.

## A6. Ports and the minimal adapters

| Port | Contract | MVP adapter |
|------|----------|-------------|
| `SessionStore` | `commit(sessionId, expectedSeq, epoch, tx, receipt, outbox[])` atomic (CAS on `seq` and `lease_epoch`); `load(sessionId, atSeq?)`; `list` | **SQLite** (WAL mode) behind an async wrapper (libsql or `better-sqlite3` in a worker). In-memory adapter for unit tests. |
| `IdempotencyLedger` | `record(sessionId, principal, eventId, …)`, `lookup(sessionId, principal, eventId)`; durable before reply | Same SQLite DB, same transaction as commit where a commit exists |
| `AuthorizationPort` | `authorize(principal, op, target)` | Static rules from YAML + game `AuthorizationHook` |
| `DefinitionRegistry` | resolve `DefinitionId` → compiled definition | Filesystem loader (`games/*/game.yaml`) + content hash |
| `TimerPort` (optional) | consume `Effect.timer_request` (read from `outbox` rows of kind `timer_request`), later POST a `system` event | In-process `timer-host` using `setTimeout`, drains `timer_request` outbox rows and is **re-armed on boot from unpublished outbox rows and open gates** (design §2.2) — lives outside the domain; domain never reads a clock |
| `LeasePort` | `acquire(sessionId) → Lease{epoch}`, `renew`, `release` | **Single-node adapter**: always owner, `epoch = 0`. Part B swaps in a Postgres-backed adapter |
| `HookRunner` | `run(hook, ctx, signal) → result`; owns the `HOOK_TIMEOUT` race and `AbortSignal` (A4) | **In-process adapter** (cooperative). Part B swaps in a worker-pool adapter |
| `Publisher` | `publish(committedTx)` per session in `seq` order, post-commit | **In-process adapter** projecting and fanning out to local subscriptions. Part B swaps the source for the bus (B4) |

### Storage schema (SQLite)

```
sessions(id PK, definition_id, definition_hash, schema_version, config_json, created_seq0_json, lifecycle, seq)
actions(session_id, seq, idx, kind, payload_json, PRIMARY KEY(session_id, seq, idx))
transactions(session_id, seq, event_id, principal, committed_at /*metadata only, never read by domain*/,
             PRIMARY KEY(session_id, seq))
outbox(id PK, session_id, seq NULL, kind /* 'commit' | 'timer_request' */, payload_json, published_at NULL)
         /* written in the commit transaction; Part A drains it in-process (see A5/A6), Part B relays it to the bus (B4) */
receipts(session_id, principal, event_id, fingerprint, result_json, error_code, seq, detail_json, privileged,
         PRIMARY KEY(session_id, principal, event_id))
```

- `commit` = one SQL transaction: `INSERT transactions/actions`, `UPDATE sessions SET seq = :new WHERE id = :id AND seq = :expected AND lease_epoch = :epoch` (0 rows ⇒ `STALE_WRITER`, transient), `INSERT receipt`, `INSERT outbox` rows (one `commit` row, plus one `timer_request` row per timer Effect produced by the batch). In Part A the epoch is always `0`. This is NFR-043 by construction.
- `committed_at` is operational metadata only; it never feeds back into state (NFR-023).
- Schema version columns satisfy NFR-032 (detect incompatible logs).

## A7. Transport (minimal)

Four separated API groups (NFR-031):

| Group | Surface | Notes |
|-------|---------|-------|
| **Command** | `POST /v1/sessions/:id/events` | Body = `InboundEvent` (`event_id`, kind, payload, `expected_seq?`). Returns `ProposalResult`. Principal from host headers. |
| **Query** | `GET /v1/sessions/:id/view?role=&subject=` · `GET …/log?role=&from=` | Projector output only; resync snapshot (NFR-044) |
| **Subscribe** | `GET /v1/sessions/:id/events/stream` (WebSocket; SSE fallback) | Authorized subscription → versioned `OutboundEvent`s in `seq` order |
| **Admin / definition** | `POST /v1/sessions`, `POST …/export`, `POST …/fork`, `POST …/direct-apply`, `GET /v1/games` | Host-only; gated by `AuthorizationPort` ops `export`, `direct_apply`, `fork` |

- Fastify + JSON Schema validation at the edge (generated from the same TypeScript types via `zod` → JSON Schema). All handlers are `async`.
- Wire concepts (fingerprint computation, `event_id`) stop in the transport/Intake layer; `Proposal` is what crosses into the actor.
- `ProposalResult` goes only to the caller; rejections are published as events only to principals authorized to observe them (NFR-041/073).
- `timer_request` Effects are also exposed to the host as an `OutboundEvent` (NFR-056). Timers that are not derivable from an open gate are not re-armed by the engine after a restart: the host owns them, or the game must model them as gates.
- Versioned envelope: `{ v: 1, kind, seq, payload }` (NFR-032).

## A8. Configuration (YAML)

Two distinct YAML families, validated with `zod` at startup (fail fast on error):

### 1. Server config — `config/server.yaml`

```yaml
server:
  http: { host: 0.0.0.0, port: 8080 }
  ws:   { max_subscribers_per_session: 200, outbound_queue: 256 }
auth:
  mode: static-api-key
  keys:
    - { id: host-main, secret: ${ENGINE_HOST_KEY}, can: [propose, query, subscribe, export, direct_apply, fork, admin] }
sessions:
  cache: { max_loaded: 5000, idle_ttl: 15m }
  mailbox_limit: 128
store:
  kind: sqlite              # sqlite | memory   (postgres in Part B)
  sqlite: { path: /data/engine.db, journal: wal }
games:
  search_paths: [ /app/games ]
limits:                      # engine-wide ceilings; a game may lower, not exceed
  cascade_cap: { default: 16, max: 256 }
  hook: { timeout: 250ms, cost_budget: 2_000_000 }
logging: { level: info, format: json }
```

`${ENV}` interpolation is the only templating allowed; secrets never live in the file.

### 2. Game definition — `games/<id>/game.yaml`

The declarative half of `GameDefinition` (design §2.1): card registry (or generator spec for 52-card decks, shoes, etc.), zones and zone templates, counters (bounds, supply_role, conservation groups, scale/rounding, derived expressions), seat/team layout, control declarations, `meta` schemas with per-field visibility, visibility declarations and custom roles, policies (cascade cap, cost budgets, gate rules), and the **hook binding table**:

```yaml
id: hearts
action_schema_version: 1
seats: { count: 4, teams: none }
zones:
  - { template: hand, owner: seat, ordering: unordered, visibility: { player: owner } }
  - { id: stock,      ordering: ordered, visibility: { default: hidden } }
meta_schemas:
  - { id: hearts.score, fields: { points: { visibility: public } } }
hooks:
  module: ./hooks.ts
  validation: { play_card: validatePlay }
  reaction:   { phase:trick: onTrickComplete, trigger:setup: setup }
```

- **Content identity** = SHA-256 of the canonicalised YAML (after anchor/alias expansion and default filling) **plus** the SHA-256 of the compiled hook module bundle. A change to either yields a new `DefinitionId` — this is what makes "everything replay depends on is covered by the content identity" hold when hooks are code.
- The YAML is compiled once into `VisibilityPolicy` + `RoleRegistry`; invariants from design §2.1 are checked at load (unique card ids, starting zones, per-field visibility, reducer exists per schema).
- YAML safety: `yaml` library in `core` schema mode (no custom tags, no merge-key surprises beyond anchors), size limit, duplicate-key error.

## A9. Docker — running and testing

One multi-stage `Dockerfile`; targets share the dependency layer so CI and local runs use identical bits.

```
FROM node:22.x.y-alpineM.m AS base   # exact Node patch + Alpine minor (not floating node:22-alpine)
FROM base AS build                   # tsc -b, bundle games, hook bundles hashed
FROM build AS test                   # target: runs vitest + conformance + lint + depcheck
FROM node:22.x.y-alpineM.m AS runtime # non-root, prod deps only, read-only fs except /data
```

```yaml
# deploy/docker-compose.yml  (run)
services:
  engine:
    build: { context: .., target: runtime }
    ports: ["8080:8080"]
    volumes: [ "engine-data:/data", "../config/server.yaml:/app/config/server.yaml:ro" ]
    environment: [ ENGINE_HOST_KEY ]
    healthcheck: { test: ["CMD","wget","-qO-","localhost:8080/healthz"] }
volumes: { engine-data: {} }
```

```yaml
# deploy/docker-compose.test.yml  (test)
services:
  tests:
    build: { context: .., target: test }
    command: pnpm test:all        # unit + property + conformance + api e2e
```

Commands: `docker compose -f deploy/docker-compose.yml up` · `docker compose -f deploy/docker-compose.test.yml run --rm tests`.

Health: `/healthz` (liveness), `/readyz` (store reachable, definitions loaded). Graceful shutdown on `SIGTERM`: stop accepting, drain mailboxes, close subscriptions with `RESYNC_REQUIRED`, close store.

## A10. Testing strategy

| Layer | Tooling | What it proves |
|-------|---------|----------------|
| **Unit (core)** | Vitest, no I/O, no mocks needed | Each invariant 1–10 (design §2.2), macro expansion, projector rules, composition rule |
| **Property-based** | `fast-check` | (a) *replay equivalence*: random legal action streams → `live digest == replay digest` at every seq (NFR-001); (b) *atomicity*: random failing batches leave digest unchanged (NFR-040/042); (c) *no-leak*: for random states/grants, `View`/`Delta` for a role never contains data outside its entitlement; (d) conservation of counters |
| **Mutation guard** | frozen-state harness | Hooks cannot mutate authoritative state (NFR-002) |
| **Conformance packs** | `packages/conformance` | Per game in `docs/game_rules/*`: setup, legal action, rejected action, replay, role projection (NFR-052/057); fixed-pool vs template-zone equivalence (NFR-058) |
| **Golden digests** | committed `*.digest.json` | Cross-version determinism; catches accidental serialisation changes |
| **Adapter contract tests** | one shared suite run against every `SessionStore` | memory, SQLite now; Postgres in Part B passes the *same* suite |
| **API e2e** | Vitest + real server in the `test` container | Idempotency, `STALE`, auth failures, WS ordering, resync, crash-recovery (kill during commit → state is before-or-after, never partial) |
| **Perf baseline** | `tinybench` | Closes Q10/NFR-024/025 (≤5 ms query, ≤2 ms publish overhead at ≤200 cards / ≤20 zones) and NFR-064 extreme corpora |

CI: lint → typecheck → depcheck → `docker compose … run tests` → image build → image scan.

## A11. Observability (minimal)

- `pino` structured JSON logs; one *wide event* per processed proposal (session, seq, kind, result code, hook timings, cascade depth) — satisfies NFR-050.
- Optional `trace` flag keeps applied-action traces for replay-mismatch debugging (NFR-051).
- No metrics backend required; a `/metrics` Prometheus endpoint is cheap and recommended (loaded sessions, mailbox depth, commit latency, hook timeouts).

## A12. Security (minimal)

- Trusted-host model: API key → principal assertion; keys scoped per operation set.
- Hook outputs are untrusted for correctness: all go through `Session.apply` structural validation and reducer re-validation (NFR-070). Hook **code** is trusted for liveness only (NFR-030) — acceptable because only operators deploy game modules.
- Sealed gate payloads and `Receipt.detail` privilege markers are enforced by type and by the Projector; log/exports redact per role.
- Container runs as non-root, read-only root filesystem, only `/data` writable.

## A13. Requirement coverage (Part A)

| Concern | Satisfied by |
|---------|--------------|
| FR-106 total order | Per-session actor, FIFO mailbox, CAS on `seq` |
| NFR-001/026/029 determinism | Pure sync `apply`, seeded PRNG, canonical JSON + digest |
| NFR-022/023 distributed clients, no clock | Network API only; domain has no clock; `committed_at` is metadata |
| NFR-040–043 atomicity/durability | Working-state discard + single SQL transaction commit; publish after commit |
| NFR-044 resync | `GET …/view` returns seq, counters, control, grants, open gates |
| NFR-060/061 library + portable logs | `core` is a publishable library; canonical JSON packages |
| NFR-070–073 leak safety | `Snapshot`/`View` types, `PrivilegedBatch`, `AuthorizationPort` |
| Q1, Q5, Q13 | TypeScript; single-threaded session actor; FIFO arrival policy |

## A14. Known limits of the minimal architecture (by design)

- One process = one failure domain; restart recovers from SQLite (sessions rehydrate lazily, timers re-arm from open gates).
- Throughput bounded by one event loop; CPU-heavy hooks can stall *all* sessions (cooperative budgets only).
- Subscribers and sessions are in-process; no cross-node fan-out.
- SQLite = single node, single writer process.
- Outbound push is best-effort across a crash between commit and publish; clients resync via `GET …/view` (NFR-044). Reliable push is the Part B outbox relay.

These are exactly the five things Part B removes.

---

# Part B — Planned architecture (scalable backend)

## B1. Target topology

```
                        ┌────────────────────┐
   host / frontends ───▶│  Gateway / LB      │  (TLS, authN, rate limits)
                        │  sticky by session │
                        └─────────┬──────────┘
              route by hash(sessionId) via ownership table
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
 ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
 │ engine node │          │ engine node │          │ engine node │   stateless image,
 │  actors for │          │  actors for │          │  actors for │   same as MVP
 │  shard set  │          │  shard set  │          │  shard set  │
 └──┬───────┬──┘          └──┬───────┬──┘          └──┬───────┬──┘
    │       │ hooks          │       │                │       │
    │   ┌───▼──────┐         │   ┌───▼──────┐         │   ┌───▼──────┐
    │   │ hook     │         │   │ hook     │         │   │ hook     │   worker threads /
    │   │ workers  │         │   │ workers  │         │   │ workers  │   isolates (B6)
    │   └──────────┘         │   └──────────┘         │   └──────────┘
    └──────────┬─────────────┴───────────┬────────────┘
               ▼                         ▼
      ┌──────────────────┐      ┌──────────────────────┐
      │ PostgreSQL       │      │ NATS JetStream        │
      │ streams, ledger, │      │ (persistent streams)  │
      │ ownership leases,│      │ commit notifications  │
      │ snapshots        │      └──────────────────────┘
      └──────────────────┘
```

Key idea: **partition by session, not by function.** Every session has exactly one owning node at a time. Nodes are interchangeable; any node can own any session by loading it from the shared store. The domain core is unchanged; the application layer changes only in the composition root (which adapters are wired).

## B2. Session ownership and single-writer guarantee

Two layers of defence, so correctness never depends on perfect coordination:

1. **Routing (performance):** the gateway/LB routes a request to the node that currently owns the session. Ownership table = rendezvous/consistent hash over live nodes, plus explicit leases for stickiness.
2. **Fencing (safety):** the store's `commit(sessionId, expectedSeq, …)` CAS (already in Part A) rejects any writer whose view of `seq` is stale. Add a monotonically increasing **lease epoch** stored with the session row; `commit` also asserts `epoch == owner_epoch`. A node that lost its lease (GC pause, partition) can therefore never commit — split-brain produces `STALE_WRITER`, not corruption.

Lease lifecycle (`LeasePort`, defined in A6; Part A uses the single-node always-owner adapter, Part B the Postgres-backed one):

- Acquire on first request for a session not owned (`INSERT … ON CONFLICT` with epoch+1 and expiry in Postgres; NATS KV is a possible alternative but Postgres keeps the lease in the same transaction domain as the fencing check).
- Renew by heartbeat; lose ⇒ actor stops accepting, drains, evicts.
- Graceful rebalance (deploy, scale in/out): owner flushes in-flight, releases lease; the next request rehydrates on the new owner.
- Cold takeover after crash: lease expires → any node acquires → loads snapshot + tail of the stream → continues. Idempotency ledger in the same store makes client retries safe across the move (FR-110/112).

If a request lands on a non-owner node, it either **forwards** to the owner (internal gRPC/HTTP) or returns a redirect hint; the minimal choice is forwarding, which keeps clients oblivious.

## B3. Storage: PostgreSQL

- `store-postgres` adapter implements the `SessionStore`/`IdempotencyLedger` ports exactly as defined in A6 (including the `epoch` and `outbox` arguments of `commit`) and **must pass the same adapter contract suite** as memory/SQLite.
- Schema is the SQLite schema plus: `owner_node`, `lease_epoch`, `lease_expires_at`, `snapshots(session_id, seq, state_json, digest)`. The `outbox` table already exists in the Part A schema (A6) and moves over unchanged; the migration marks all pre-migration rows published.
- Partitioning: `actions` hash-partitioned by `session_id`; completed sessions archived to object storage as replay packages (same canonical JSON) and dropped from hot tables (retention policy in YAML).
- **Snapshots/checkpoints** (design §8.6): every *N* seq (configurable) the owner writes a snapshot with its digest; load = latest snapshot + tail. Verified in background by replaying from genesis and comparing digests (`StateDigest` verification job).
- Migration from MVP: `export` each SQLite session as a replay package → `import` into Postgres. Because packages are the canonical interchange format, no bespoke migration code is needed.

## B4. Cross-node publish and subscriptions

Problem: subscribers may be connected to node X while the session is owned by node Y.

- **Outbox/commit notification:** inside the commit transaction the owner writes the outbox rows defined in A6: a `commit` row `(session_id, seq)` and one `timer_request` row per timer Effect (payload = the effect). Effects produced by an *empty accepted batch* (FR-052a), which has no `seq`, are written as `timer_request` rows with `seq = NULL` in the same transaction as the receipt. A relay publishes these to the **event bus**, which is **NATS with JetStream persistence** (decision; see Appendix 2). Publication still happens **only after durable commit** (NFR-043) and in `seq` order per session.
  - **Stream:** `ENGINE_COMMITS`, file storage, replicated (R3 in production), limits-based retention (e.g. 24h / size cap) — it is a *notification and catch-up buffer*, not the source of truth; Postgres is.
  - **Subjects:** `engine.commit.<shard>.<sessionId>` (`<shard>` = `hash(sessionId) % N`, stable, never the volatile owner node) for commits; `engine.timer.<sessionId>` for timer effects (published from `timer_request` outbox rows with `Nats-Msg-Id = outbox.id`; the only game-derived data on the bus, and it is the host-facing timer request, never hidden state). Subscribers filter by subject, so an edge node only receives the sessions its clients watch.
  - **Ordering and exclusivity:** writer exclusivity is enforced by the store's epoch-fenced CAS (B2): a stale owner cannot commit, so no stale outbox row can exist, and every committed row is legitimate and must be published. JetStream is an **at-least-once notification channel**. `Nats-Msg-Id = <sessionId>:<seq>` gives best-effort de-duplication inside the stream's `dedup_window`; correctness never depends on it. (`Nats-Expected-Last-Subject-Sequence` is not used: it compares against the stream's own sequence for the subject, which the outbox does not store.)
  - **Consumers:** edge nodes use durable (or ephemeral, per-connection) pull/push consumers with explicit ack; after a node restart a durable consumer resumes from its last ack, and a client that fell behind the retention window gets `RESYNC_REQUIRED`.
  - **Outbox relay:** one relay worker per session, run by the current lease holder (claimed through the lease, so a takeover hands it over). It always drains unpublished rows in `(session_id, seq)` order, publishes with the de-dup id and marks rows published only after the publish ack. Delivery is at-least-once: a crash between publish and mark, or a retry after `dedup_window`, can duplicate a notification. Consumers therefore track `lastProjectedSeq`: `seq <= last` is dropped, `seq > last + 1` triggers a re-read from the store or `RESYNC_REQUIRED`.
  - **Security:** NATS accounts/NKeys or mTLS per node; `commit` notifications carry no game data (payload is `(session, seq, definition_id)` only); `timer_request` messages carry only the timer effect.
- **Edge fan-out nodes** (can be the same engine nodes, or a separate `gateway` role): each subscribes to the bus for the sessions its WebSocket clients watch and runs the **same `Projector.project_delta`** per subscription. `project_delta(pre, post, PrivilegedBatch, viewer)` needs both pre- and post-state, so each edge keeps a **per-session state cache**:
  - **Fill:** on first interest in a session, load the latest snapshot + tail from the store and fold it with the hook-free `Replayer` (needs the pinned definition and its reducers, not its hooks), yielding `post` at seq *N*.
  - **Advance:** on a `commit` notification for `seq = N+1`, read that transaction from the store, take `pre` = cached state, derive `post` by applying the batch with `Session.apply`, project per viewer, then replace the cache entry. `seq <= N` is ignored; a jump or a failed fold drops the entry and sends `RESYNC_REQUIRED`.
  - **Bounds:** LRU + TTL per node like A5; memory is one session state per *watched* session, not per viewer.
  - `PrivilegedBatch` is therefore only ever opened inside the process that also holds the viewer's authorization — it never rides the bus in clear. The bus carries only `(session, seq)`; projection happens at the edge from the store and the cached state.
- Per-subscription gap detection: if a subscriber sees `seq` jump, it re-reads the missing range or asks for `RESYNC_REQUIRED` → `view` snapshot (NFR-044), already part of the MVP contract.
- Identity hardening: the host mints short-lived signed tokens (JWT/PASETO, JWKS in YAML) carrying `principal`, roles and subject bindings, so frontends can connect to edge nodes directly without trusting a network path to the host (NFR-022).

## B5. Control plane and timers

- **Definition registry service:** immutable, content-addressed artifact store (object storage / OCI registry). Nodes pull `DefinitionId` bundles (YAML + hashed hook bundle) on demand and cache locally. Sessions pin a definition id forever (replay needs it); old versions are never deleted while sessions reference them.
- **Timer service (distributed `TimerPort`):** consumes `timer_request` effects from the `engine.timer.*` JetStream subjects (durable consumer, ack after the timer is stored), stores them durably (Postgres table + due index, claimed with `SKIP LOCKED`), and posts the answering `system` event through the normal command API. The delivery path is durable end to end: Effect → `timer_request` outbox row (written in the commit or empty-accept transaction, A6/B4) → relay → JetStream. A reconciliation job that re-derives timers from open gates is a **backstop** for lost messages, not the delivery path. The domain still never reads a clock; the service is the "host" of design §2.2.
- **Session scheduler/admin:** list, inspect, force-release leases, drain a node, run digest verification, export/fork — all via the existing admin API group.

## B6. Hook isolation and CPU protection

Because hook code is the only thing that can block the event loop:

- **Worker pool per node** (`node:worker_threads`, or isolates via `isolated-vm`): validation/reaction/resolve hooks run in workers with the readonly snapshot structured-cloned in; hard pre-emption by terminating a worker upholds `HOOK_TIMEOUT` and the cost budget (NFR-055) *non-cooperatively*.
- The SPI types don't change (hooks were already `async`); only the `HookRunner` port gains a worker-pool adapter. Reducers stay in-process (sync, pure, cheap) because replay needs them.
- Per-game and per-hook concurrency limits in YAML; a runaway game cannot starve other sessions on the node.
- Workers are started with no network access (denied at the container/network-policy level and by the determinism lint rules); hooks never call out.
- Multi-tenant hosting of untrusted game code (if ever required) additionally needs isolate memory limits and a signed-bundle policy — noted, not planned.

## B7. Observability and operations

- **OpenTelemetry** traces: span per proposal with child spans per pipeline step and per hook; trace context propagated through the forward hop and bus.
- Metrics (Prometheus): per-node loaded sessions, mailbox depth, commit latency p50/p99, lease churn, `STALE_WRITER` rate, hook timeout/cost-exceeded counts, subscriber lag, resync rate.
- Alerting SLOs: commit latency, publish lag (commit→edge), query latency vs NFR-024/025 once baselined.
- Runbooks for: node loss, store failover, lease storm, poisoned definition rollout, digest-verification mismatch (treated as a Sev-1: a divergence means determinism was broken).
- Deployment: container image unchanged; Kubernetes (Deployment + PodDisruptionBudget, `terminationGracePeriodSeconds` ≥ drain time) or Nomad/ECS. Config is the same YAML mounted via ConfigMap/secret store; new sections `cluster:`, `lease:`, `bus:`.

```yaml
cluster:
  node_id: ${HOSTNAME}
  lease: { ttl: 10s, renew_every: 3s }
  forwarding: internal-http
store:
  kind: postgres
  postgres: { url: ${DATABASE_URL}, pool: { max: 40 }, snapshot_every: 200 }
bus:
  kind: nats-jetstream
  url: ${NATS_URL}
  stream: { name: ENGINE_COMMITS, storage: file, replicas: 3, max_age: 24h, max_bytes: 10GB, dedup_window: 2m }
  consumer: { ack_wait: 30s, max_deliver: 10 }
hooks:
  runner: worker-pool
  pool: { size: 4, per_game_max: 2 }
auth:
  mode: jwt
  jwks_url: ${JWKS_URL}
```

## B8. Capacity and scaling model

- **Unit of scale = session.** Sessions are small (≤ ~700 cards, ≤ 64 zones at the NFR-020 floor) and low-rate (human turns), so a node can hold thousands of active actors; scale-out is linear in sessions.
- **Hot spots:** (1) one very busy session is still single-writer — acceptable, bounded by game rules; (2) large spectator fan-out — handled by edge nodes projecting once per *distinct viewer identity* and fanning out the byte payload (viewer-identity cache keyed by `(role, subject, seq)`); (3) Postgres write amplification — batch the `actions` insert per transaction (already one statement) and partition.
- **State cache:** active session state kept in memory with LRU; snapshot + tail keeps cold-start bounded regardless of game length.
- Capacity guidance (NFR-064) is produced by the perf baseline in A10 and re-run per release in the cluster profile.

## B9. Migration path (Part A → Part B)

Each step is independently shippable and leaves the system working:

| Step | Change | Domain/app code touched |
|------|--------|-------------------------|
| 1 | Add `store-postgres` adapter; run contract suite; keep single instance | none |
| 2 | Add snapshots + background digest verifier | `SessionStore` impl only |
| 3 | Swap in the Postgres `LeasePort` adapter; `commit` already carries `epoch` (single node still owns all) | composition root, store adapter |
| 4 | Add outbox relay + NATS JetStream bus + edge state cache and projection; the in-process `Publisher` adapter is replaced by a bus-fed one | composition root, adapters |
| 5 | Run 2+ nodes behind gateway with forwarding | composition root, gateway |
| 6 | Worker-pool `HookRunner`; JWT auth; OTel; distributed timer service | adapters only |
| 7 | Definition registry service; retention/archival | adapters + admin |

Rollback at any step = revert config to the previous `store.kind`/`bus.kind`; replay packages remain the portable escape hatch.

## B10. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Split-brain double writers | Lease epoch + `seq` CAS in the same SQL transaction; contract-tested with fault injection (paused owner) |
| Determinism drift across Node versions/architectures | Pin Node in image; canonical JSON; golden digests in CI; background digest verifier in prod |
| Hook cost starving a node | Worker pool, hard timeouts, per-game concurrency caps |
| Operators / edge roles reading sealed data from the store | The trust boundary is all engine roles plus the database (event sourcing needs sealed payloads to replay); keep edge roles backend-only, never internet-facing with DB credentials |
| Leak through the bus or logs | Bus carries `(session, seq)` only; projection at the edge; `PrivilegedBatch` opaque type; no-leak property test runs against edge path too |
| Definition/hook version skew between nodes | Content-addressed bundles, session pins `DefinitionId`; node refuses sessions whose bundle it cannot verify (`REPLAY_MISMATCH`) |
| Postgres as a single point | Managed HA + PITR; replay-package archival; read replicas for log/export queries only (never for the writer path) |

---

## Appendix 1 — Part A vs Part B at a glance

| Concern | Minimal (A) | Planned (B) | Port that changes |
|---------|-------------|-------------|-------------------|
| Instances | 1 | N, session-sharded | `LeasePort` (single-node → Postgres/etcd) |
| Store | SQLite file | PostgreSQL (+ snapshots, archive) | `SessionStore`, `IdempotencyLedger` |
| Publish | in-process, post-commit | outbox → NATS JetStream → edge projection | `Publisher` source |
| Hooks | in-process, cooperative timeout | worker pool, hard timeout | `HookRunner` |
| Timers | in-process `timer-host`, re-armed from state | durable distributed timer service | `TimerPort` |
| Auth | static API keys, trusted host | JWT/JWKS, short-lived viewer tokens | `AuthorizationPort`, edge auth |
| Definitions | filesystem | content-addressed registry | `DefinitionRegistry` |
| Observability | JSON logs, `/metrics` | OTel traces, SLO alerts | logging/tracing adapters |
| Deployment | `docker compose` | orchestrator, rolling deploys | none (same image) |

## Appendix 2 — Decisions

| Decision | Alternative | Why |
|----------|-------------|-----|
| Sync pure `apply`, async everything around it | Async kernel | Determinism and replay equivalence are simpler and faster; no I/O exists in the kernel to await |
| Session actor via promise-chained mailbox | Locks / DB row locks | Matches single-writer aggregate; no lock contention; trivially portable to multi-node ownership |
| SQLite first, Postgres later behind identical contract suite | Postgres from day one | Zero-dependency single container for MVP; the port + shared contract tests make the swap mechanical |
| Replay package as the universal interchange (migration, archive, fork) | Bespoke migration scripts | Already a Must (FR-075); canonical JSON is storage-agnostic |
| Epoch-fenced CAS commit | Trusting leases alone | Leases can lapse unnoticed; the store is the only party that can enforce exclusivity |
| **NATS JetStream** as event bus | Postgres `LISTEN/NOTIFY`; Redis Streams | Decided by the owner. Persistent, replayable streams survive node restarts and let lagging consumers catch up; subject hierarchy gives per-session filtering; publish-side `Msg-Id` de-dup gives best-effort relay idempotency (consumers still track `seq`). `NOTIFY` is lossy when no listener is connected and has payload limits; Redis Streams lacks native subject routing. |
| Projection at the edge from `(session, seq)` notifications | Publishing projected deltas from the owner | One `Projector` implementation per viewer path; privileged batches never leave a trust boundary |
| YAML for declarative definition + server config, TypeScript for hooks | Everything in code / everything in YAML | NFR-062: tooling reads YAML without executing hooks; rules that need logic stay typed code |
| Hooks cooperative first, worker isolation later | Isolation from day one | FR-065 permits cooperative enforcement; isolation is a drop-in `HookRunner` adapter |

## Appendix 3 — Resolved open questions

| Q | Resolution |
|---|-----------|
| Q1 Language | **TypeScript** (Node 22), strict ESM, pnpm workspace |
| Q5 Inbound concurrency | **Single-writer session actor**; concurrency across sessions only |
| Q13 Arrival order | **FIFO at the owning actor**; `ArrivalPolicy` strategy keeps host-sequence ordering open |
| Design §8.6 Snapshots | Part B3, behind `SessionStore`, verified by `StateDigest` |
| Q10 Perf baseline | Produced by A10 perf suite; targets NFR-024/025 pinned after first run |
| Hook network access | **No.** Hooks and reducers (including those in B6 worker pools) have no network, filesystem or clock access; workers run with no network capability. Anything external goes through the host via `system` events. |
| Multi-region engine | **No.** Not planned. Clients may be geographically distributed (NFR-022), but each session is homed in a single region and owned by one node there. |

## Appendix 4 — Still open

1. Q8 schema-evolution policy (how long old `action_schema_version`s are replayable) — needs an upgrader chain in `Replayer`.
2. Q14/Q15 subscription filters and spectator role (custom role registration assumed).
3. JetStream sizing (retention window, replica count, per-shard subject partitioning) — tune with measured fan-out at B9 step 4. *(Bus choice itself is decided: NATS JetStream.)*
