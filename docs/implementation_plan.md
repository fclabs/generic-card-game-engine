# Generic Card Game Engine — Implementation Plan

**Status:** Draft v1
**Source:** `docs/architecture.md` (Part A = MVP, Part B = scalable backend)
**Purpose:** Break the architecture into ordered phases. Each phase becomes one spec (written separately, later). This document defines only the **goal, scope, deliverables, dependencies and exit criteria** of each phase.

---

## 1. How to read this plan

- **Phases 0–9** deliver Part A (single-instance MVP). When Phase 9 exits, every *Must* requirement is satisfied and the system runs in Docker.
- **Phases 10–14** deliver Part B. Each is additive: a new adapter behind a port that already exists. No domain code changes.
- Phases 0 and 1 are complete; their as-built notes are in their sections. Phase 0's as-built deviations are recorded in its section and apply to every later phase (notably: new packages must be added to the dependency matrix and `docs/dev-setup.md`, which a guardrail checks).
- Each phase leaves the repo in a working state: it builds, tests pass and the previous behaviour is preserved. Phase 8b is the one exception to "ordered": it runs off the critical path after 8a.
- A phase's **exit criteria** are the acceptance bar for its spec. A phase is not done until they pass inside the Docker `test` target.

### Phase map

```
Part A (MVP)
  P0 Foundation ──▶ P1 Kernel ─┬─▶ P2 Definitions ─┬─▶ P3 Visibility & Replay ─┐
                               │                   └─▶ P4 Rule SPI & Hooks ────┼─▶ P6 Application ─┬─▶ P7 Transport & Server ──┐
                               └─▶ P5 Storage ─────────────────────────────────┘                   └─▶ P8a Harness + Must games ┴─▶ P9 MVP Hardening
                                                                                                         └─▶ P8b Remaining games (off critical path)
Part B (Scale)
  P10 Postgres & Snapshots ─▶ P11 Leases & Multi-node ─▶ P12 Bus & Edge Projection ─▶ P13 Isolation, Auth, Timers, Telemetry ─▶ P14 Registry & Retention
```

P2 and P5 depend only on P1 and may run in parallel. P3 and P4 each need only P2 and may run in parallel. P6 needs P3, P4 and P5. P7 and P8a need P6 and may run in parallel. P9 needs P7 and P8a.

For this graph to hold, P1 owns the Rule SPI types (including `Reducer`) and the compiled-definition data types, and P2 owns hook-bundle hashing. P3 (replay) and P4 (hook execution) then consume those without depending on each other.

---

# Part A — MVP

## Phase 0 — Foundation and tooling

**Status:** Done (as built; see [dev-setup.md](./dev-setup.md) and [workspace-architecture.md](./workspace-architecture.md)).

**Goal:** A buildable, testable, containerised empty workspace with the architectural rules enforced from the first commit, so no later phase can violate them.

**Scope (as built)**
- pnpm workspace with 13 `@cge/*` members: `core`, `app`, `config`, `helpers`, `conformance`, `server`, six adapters (`store-memory`, `store-sqlite`, `transport-http`, `transport-ws`, `authz-static`, `timer-host`) and `tools/guardrails` (`@cge/guardrails`, tooling only: no `src/`, no `exports`, not in the root solution build). `games/` is empty (`.gitkeep`) and `config/` has no `server.yaml` yet.
- Strict ESM TypeScript project references; the full package reference and `workspace:*` dependency matrix is declared up front even though no source imports across packages. `core` sub-folders (`session`, `errors`, `spi`, `ports`, `definition`, `visibility`, `replay`) and `app` sub-folders (`session-registry`, `proposal-handler`, `publisher`, `session-factory`, `package`) live at `src/<sub>/index.ts` and are re-exported from the package `src/index.ts`. Package sources use `types: []`; only test projects (`tsconfig.test.json`) add `node` types. Intra-package imports are relative `./….js`.
- Exact pins: Node `22.23.3` (`.nvmrc`; `engines` `>=22 <23`), pnpm `10.15.1`, TypeScript `6.0.3` (held below 7 because `typescript-eslint` does not yet support it), Vitest `5.0.5`, `fast-check` `4.10.2`, ESLint `10.13.0`, Prettier `3.9.10`, `dependency-cruiser` `18.6.0`. All `devDependencies` are exact versions; runtime `dependencies` are `workspace:*` only.
- Vitest: unit and property placeholders per package. `pnpm test` runs `packages/**` and `games/**`; the guardrail suite runs separately (`pnpm test:guardrails`, own config); `pnpm test:all` runs both. Tests use explicit `vitest` imports (no globals).
- ESLint (flat config, type-aware) with a local `cge` plugin (`eslint/`, not a workspace member): `cge/no-nondeterministic-globals` and `cge/no-nondeterministic-imports` scoped to `packages/core/**`, `packages/helpers/**`, `games/*/hooks/**`. Prettier with a fixed `.prettierignore`.
- `dependency-cruiser` rules (`.dependency-cruiser.cjs`): `layer-core-imports-nothing`, `core-no-node`, `layer-helpers-core-only`, `layer-config-core-only`, `layer-app-core-only`, `layer-adapters-no-server`, `layer-adapters-no-adapters`, `layer-adapters-allowed-only`, `layer-server-no-conformance`, `layer-conformance-leaf`, `no-circular`, `no-undeclared-deps`. Layering: `core` ← `app` ← `adapters` ← `server`. There is **no** `games/**` isolation rule yet (P8a adds it).
- Guardrail suite in `tools/guardrails` (167 tests): data-driven lint fixtures and depcruise fixture trees (inert for the real lint/format/build/typecheck/depcheck), config-wiring and mutation checks, and repo-invariant checks (FR-043 checks 1–7: package metadata, Node/pnpm pins, placeholder tests, skeleton purity, exact devDependency versions, workspace dependencies, documentation).
- Multi-stage `deploy/Dockerfile` (`base`/`build`/`test`/`runtime`) on `node:22.23.3-alpine3.24`; `runtime` is a fresh stage (prod install, no sources/tools, read-only `/app`, `/data` volume, non-root `node`). `deploy/docker-compose.yml` (service `engine`, binds `config/server.yaml` to `/etc/engine/server.yaml:ro`) and `deploy/docker-compose.test.yml` (service `tests`).
- GitHub Actions CI, SHA-pinned actions, frozen-lockfile installs, no image push: `lint` → `typecheck` → `depcheck` → `test` (containerised, with GHA layer cache) → `image`.
- Human docs: `README.md` (overview), `docs/dev-setup.md` (command reference; checked by repo invariant 7), `docs/workspace-architecture.md`, `docs/troubleshooting.md`.

**Deliverables:** workspace skeleton, configs, guardrail suite, Dockerfile and compose files, CI definition, onboarding docs, placeholder tests that run in the `test` container.

**Depends on:** nothing.

**Exit criteria**
- `docker compose -f deploy/docker-compose.test.yml run --rm tests` passes on a clean checkout (runs `test:all`, including guardrails).
- A deliberate forbidden import (e.g. `core` → `node:fs`) fails CI; a forbidden global (`Date.now`) in `core` fails lint. Both are proven by the guardrail fixtures.

**Known gaps carried forward**
- The runtime `CMD` is a placeholder that exits 0 and there is no `/healthz`/`/readyz` until P7 (the sample `config/server.yaml` arrived with P2).
- Remote-only CI checks await a real PR (PR-fail-at-lint, stale-lockfile, cache hits, `ubuntu-latest` timings). Branch protection is a repo-admin task.
- `skipLibCheck: true` in `tsconfig.base.json`. TypeScript is to be revisited once `typescript-eslint` supports TS ≥ 7.

---

## Phase 1 — Domain kernel

**Status:** Done (as built; see [domain-kernel.md](./domain-kernel.md) and [canonical-json-profile.md](./canonical-json-profile.md)). The kernel is in `packages/core`; the canonical JSON profile v1 is frozen; the skeleton-purity guardrail now exempts `packages/core` only.

**Goal:** A pure, synchronous, deterministic state-transition core: given a state and a batch of actions, produce the next state atomically, with a canonical digest.

**Scope**
- Branded id types, error taxonomy (design §3.4), `bigint` counters with exact arithmetic.
- Immutable session state, deep-readonly `Snapshot`, deep-freeze at commit.
- `Session.apply(state, batch)` (sync, pure), invariants 1–10, macro expansion, atomic discard on failure. `apply` applies logged primitives, including `engine.*` housekeeping actions when present; *deciding* which housekeeping actions to emit (step 6b, which needs `Projector.would_reveal`) belongs to the P6 pipeline.
- Compiled-definition data types (the shape of a compiled `GameDefinition`: cards, zones, counters, seats, policies) so counter bounds, conservation and the card registry can be enforced here. The YAML compiler that produces them is P2.
- Rule SPI types in `core/spi` (`ValidationHook`, `ReactionHook`, `GateResolveHook`, `Reducer`, `AuthorizationHook`, `GateMaskedSnapshot`) — types only; execution is P4.
- Canonical JSON profile v1 and `StateDigest` (SHA-256), under `core/replay/canonical`. **The profile is frozen in this phase**, before any golden digest exists.
- Seeded PRNG; shuffles logged as explicit permutations.
- Port interfaces in `core/ports` (`SessionStore`, `IdempotencyLedger`, `AuthorizationPort`, `LeasePort`, `HookRunner`, `Publisher`, `TimerPort`) — interfaces only. `DefinitionRegistry` is delivered in P2 because its return type is the compiled definition.

**Deliverables:** `packages/core` (session, errors, spi types, canonical/digest, ports), unit and property tests. `Replayer`, `Forker` and the package format are P3, built on the canonical module.

**Depends on:** P0.

**Exit criteria**
- Property test: random failing batches leave the digest unchanged (atomicity, NFR-040/042).
- Same action stream applied twice yields identical digests (NFR-001 at kernel level).
- Mutation-guard test: a hook-style cast-away mutation does not change the digest.
- Property test: counter conservation groups hold across random legal batches (design invariant 4; architecture A10 item d).
- Canonical JSON profile documented and covered by golden vectors.

---

## Phase 2 — Game definition and configuration

**Status:** Done (as built; see [game-definitions.md](./game-definitions.md), [game-definition-schema.md](./game-definition-schema.md) and [server-config.md](./server-config.md)).

**Goal:** Turn declarative YAML into validated, compiled, content-addressed definitions the kernel can run, and load server configuration safely.

**Scope**
- `GameDefinition` types and compiler: cards/generators, zones/templates, counters (bounds, conservation, scale/rounding), seats/teams, control, `meta` schemas, policies, hook binding table.
- Load-time invariant checks (design §2.1). Safe YAML parsing (core schema, size limit, duplicate-key error).
- Content identity = SHA-256 of canonicalised YAML + hook bundle hash. P2 owns hook-bundle packaging and hashing (the bundle is built and hashed, not executed; execution is P4).
- `DefinitionRegistry` port in `core/ports` (`resolve(DefinitionId) → CompiledGameDefinition`) and its filesystem adapter.
- Server config (`server.yaml`) with `zod` validation and `${ENV}` interpolation; fail fast. Add `config/server.yaml` (the compose `engine` service already mounts it at `/etc/engine/server.yaml:ro`).

**Deliverables:** `packages/core/definition`, `packages/config`, filesystem `DefinitionRegistry`, schema docs.

**Depends on:** P1.

**Exit criteria**
- Invalid definitions (duplicate card ids, missing reducer, bad visibility) fail at load with precise errors.
- Equivalent YAML (anchors, key order, defaults) yields the same `DefinitionId`; any semantic change yields a new one.
- Changing only the hook module bundle changes the `DefinitionId`; identical YAML plus identical bundle is stable.
- The filesystem `DefinitionRegistry` passes registry contract tests: successful resolve, unknown id, content-hash mismatch.
- Server config with a missing env var or unknown key refuses to start.

---

## Phase 3 — Visibility, projection and replay

**Status:** Done (as built; see [visibility.md](./visibility.md) and [replay-package.md](./replay-package.md)). As built: `Projector` functions are `projectView`, `projectDelta`, `projectLogEntry` and `wouldReveal`; roles are declared in the definition only (the engine ships no spectator; see the spectator recipe in visibility.md); `Replayer` is `rebuild` and `advance`, `Forker` is `forkFromSeq`; the upgrader chain is `PACKAGE_UPGRADERS` with `assertUpgraderChain`, and one version (`1`) exists today. Enforced by one added dependency rule (`core-privileged-batch-opener`). `decodeCanonical` was added to the canonical module without changing profile v1.

**Goal:** Guarantee that no participant ever receives data outside their entitlement, and that any session can be replayed, exported and forked identically.

**Scope**
- `Projector`: `project_view`, `project_delta`, `project_log_entry`, `would_reveal`; `VisibilityPolicy` and `RoleRegistry` from compiled definitions.
- Fail-closed types: `Snapshot` ≠ `View`; opaque `PrivilegedBatch` openable only by `Projector` and `Replayer`.
- `Replayer`, `Forker`, digest verification, replay package format (canonical JSON, language-agnostic).
- Hook-free replay path (needed later by edge nodes in Part B). It uses the game's reducers (P1 types) but never its hooks.
- Schema-evolution policy (Q8): decide how long old `action_schema_version`s stay replayable and implement the upgrader chain in `Replayer`. This is the single owner of Q8; it must land here because Part B may not change domain code.
- Custom role / spectator registration in `RoleRegistry` (Q15).

**Deliverables:** `packages/core/visibility`, `packages/core/replay` (Replayer, Forker, package format, upgrader chain), no-leak and replay property tests.

**Depends on:** P1, P2.

**Exit criteria**
- No-leak property test: for random states/grants, `View` and `Delta` for any role never contain out-of-entitlement data.
- Replay equivalence: live digest == replay digest at every `seq` (NFR-001).
- Export → import → replay reproduces identical digests; fork from `seq N` is correct.
- A log recorded under an older `action_schema_version` replays through the upgrader chain to the expected digest; an unsupported version fails with a clear error (NFR-032).

---

## Phase 4 — Rule SPI, hook execution and helpers

**Goal:** Let a game express logic YAML cannot, safely: hooks run through a runner with timeouts and cost budgets, and reducers stay synchronous and replay-safe.

**Scope**
- Rule SPI: `ValidationHook`, `ReactionHook`, `GateResolveHook`, `Reducer`, `AuthorizationHook`; routing by key; sequential execution in registration order.
- In-process `HookRunner` with cooperative `HOOK_TIMEOUT` (race + `AbortSignal`) and cost-budget counter.
- Hook module loading and execution from the bundles P2 builds and hashes.
- `packages/helpers`: melds, runs/sets, poker ranking, trick winners, with cost-budget checks.
- Frozen-globals harness proving hooks cannot use clocks, randomness or I/O.

**Deliverables:** `packages/core/spi`, in-process `HookRunner`, `packages/helpers`, harness tests.

**Depends on:** P2 (SPI types come from P1; P3 is not needed).

**Exit criteria**
- A runaway or slow hook yields `HOOK_TIMEOUT`/cost-exceeded and leaves state untouched.
- A hook that returns invalid actions is rejected by structural validation (NFR-070).
- Helpers pass tests against the extreme corpora (NFR-064 inputs).

---

## Phase 5 — Storage adapters and contract suite

**Goal:** Durable, atomic, idempotent persistence behind the `SessionStore` and `IdempotencyLedger` ports, proven by a suite every future adapter must pass.

**Scope**
- `store-memory` adapter.
- `store-sqlite` adapter (WAL, async wrapper): schema from A6, `commit` as one transaction with CAS on `seq` and `lease_epoch` (always `0` in Part A), receipts, outbox rows (`commit` and `timer_request`), schema version columns.
- Shared **adapter contract suite**: atomic commit, `STALE_WRITER`, idempotent receipt lookup, load at `seq`, outbox contents, empty-accepted-batch rows with `seq = NULL`.

**Deliverables:** two store adapters, the contract suite as a reusable package.

**Depends on:** P1 (ports only; can run parallel to P2, P3 and P4).

**Exit criteria**
- Both adapters pass the identical contract suite.
- Fault injection (kill mid-commit) leaves state strictly before-or-after, never partial.
- `committed_at` is never read by domain code (checked by test or lint).

---

## Phase 6 — Application layer

**Goal:** Orchestrate the 10-step proposal pipeline with a strict single-writer-per-session guarantee and post-commit publication.

**Scope**
- `SessionRegistry`: per-session async mailbox, FIFO `ArrivalPolicy`, lazy load, LRU+TTL eviction, bounded mailbox with `OVERLOADED`.
- `ProposalHandler`: steps 1–10, ledger record on every early exit, commit through the store, publish only after durable commit. Step 6b housekeeping (e.g. `engine.grant_consume`, decided with `Projector.would_reveal` from P3) lives here.
- `Publisher` in-process adapter: per-subscription bounded queues, `RESYNC_REQUIRED` for slow consumers, `emitAcceptance`/`emitRejection`.
- Host-facing `timer_request` `OutboundEvent` published for every accepted batch that emits a timer Effect, including empty accepted batches (NFR-056).
- Single-node `LeasePort` (always owner, epoch `0`).
- `SessionFactory`, export/import/fork/direct-apply services, authorization wiring (`authz-static`).
- Timer-host helper draining `timer_request` outbox rows, re-armed on boot from unpublished rows and open gates.

**Deliverables:** `packages/app`, `adapters/authz-static`, `adapters/timer-host`.

**Depends on:** P3, P4, P5.

**Exit criteria**
- Concurrent proposals to one session produce one total order (FR-106); different sessions proceed concurrently.
- Retrying a proposal returns the stored result without re-applying (FR-110/112), including empty-batch accepts.
- Publish never precedes commit; a slow subscriber never stalls the session actor.
- Restart re-arms timers from open gates and outbox rows.
- A grant with `once` consumption is consumed by step 6b exactly when `would_reveal` says it is used, and the consumption is logged.
- An accepted batch that emits a timer Effect publishes a host-authorized `timer_request` event to the host and to no other principal.

---

## Phase 7 — Transport and server

**Goal:** Expose the engine over a network API with four separated groups and run it as one configured server process in Docker.

**Scope**
- Fastify HTTP: Command, Query, Admin/definition groups; `zod`→JSON Schema validation at the edge; versioned envelope `{v, kind, seq, payload}`.
- WebSocket and SSE subscription gateway with ordered delivery.
- API-key principal assertion and per-operation key scopes.
- A minimal fixture game (a few cards, one zone type, one hook) used only to exercise the API before P8a delivers real games.
- Subscription filters (Q14) if kept in the MVP; otherwise record them explicitly as deferred (a *Should*, FR-107).
- `server` composition root wiring config → adapters → app → transports.
- `/healthz`, `/readyz`, graceful `SIGTERM` shutdown. Replace the placeholder runtime `CMD` (`node packages/server/dist/index.js`). The runtime image is already non-root with a read-only `/app` and writable `/data`; P7 keeps that and adds a start-up check.

**Deliverables:** `adapters/transport-http`, `adapters/transport-ws`, `packages/server`, runnable `docker compose up`.

**Depends on:** P6.

**Exit criteria**
- API e2e in the `test` container: idempotency, `STALE`, auth failures, WS ordering, resync via `GET …/view`.
- `docker compose up` serves a session end to end from the fixture game.
- The `timer_request` event reaches the host over the Subscribe API (NFR-056).
- Rejections reach only principals authorized to observe them (NFR-041/073).

---

## Phase 8a — Conformance harness and Must games

**Goal:** Prove the engine is genuinely generic on the games that `docs/requirements.md` (§1.1) makes *Must*: War and a team trick-taking game (Spades-like), through one shared conformance harness.

**Scope**
- Add a dependency-cruiser rule for `games/**` (none exists after P0; `depcheck` already scans `games`) and extend the guardrail fixtures for it.
- `packages/conformance` harness and scenario-pack format: setup, legal action, rejected action, replay, role projection.
- `games/war` and the team trick-taking game (YAML + hooks + pack).
- Fixed-pool vs template-zone equivalence checks (NFR-058).
- Committed golden digests (`*.digest.json`).
- After P7 lands, one HTTP/WS smoke scenario per game.

**Deliverables:** harness, the two Must games with packs, golden digests.

**Depends on:** P6 (library level). The HTTP/WS smoke scenarios additionally need P7.

**Exit criteria**
- Both packs pass every scenario type (setup, legal, rejected, replay, projection) in the Docker `test` target; golden digests are stable across rebuilds.
- Each game imports only its own YAML, its Rule SPI module and public package APIs: a dependency-cruiser rule rejects imports from `games/**` into `core`, `app`, `adapters` or `server` internals (NFR-062).
- Engine defects found here are fixed in the owning package with a regression test there; they are not an exit condition of this phase.

---

## Phase 8b — Remaining reference games

**Goal:** Cover every other rule document in `docs/game_rules/*` (NFR-057, *Should*) to widen the proof of genericity without blocking the MVP.

**Scope**
- One `games/<id>` (YAML + hooks + pack) per remaining rule document, simplest first, using the harness from P8a. A document that exceeds the engine's declared scope (e.g. a partial MTG subset) states its supported subset explicitly.
- Golden digests per game.

**Deliverables:** remaining game definitions, packs, golden digests.

**Depends on:** P8a. Runs off the critical path: P9 does not wait for it.

**Exit criteria**
- Every added game's pack passes in CI with stable golden digests.
- The same dependency-cruiser rule as P8a passes for every game.
- Any game excluded or reduced to a subset is listed with the reason in the coverage matrix.

---

## Phase 9 — MVP hardening and release

**Goal:** Make the MVP operable and measurable, and close the *Must* requirement list.

**Scope**
- Observability: `pino` wide event per proposal, optional trace flag, `/metrics`.
- Perf baseline with `tinybench`; pin NFR-024/025 targets and NFR-064 corpora (closes Q10).
- Crash-recovery and long-running soak tests; image scan in CI.
- Requirement coverage audit against `docs/requirements.md`; operator docs (run, config, backup, restore via replay package).

**Deliverables:** observability, perf report, coverage matrix, runbook-level docs, tagged release.

**Depends on:** P7 and P8a. (P8b is not required.)

**Exit criteria**
- Every *Must* FR/NFR maps to a passing test in the coverage matrix.
- Perf baseline meets or explicitly re-baselines NFR-024/025 (≤5 ms query, ≤2 ms publish overhead at ≤200 cards / ≤20 zones).
- Kill-and-restart during load loses no committed action and duplicates none.

---

# Part B — Scalable backend

Each phase below ships independently and is reversible by reverting `store.kind` / `bus.kind` / `hooks.runner` / `auth.mode` in config (architecture B9). Replay packages remain the portable migration path.

## Phase 10 — PostgreSQL store and snapshots

**Goal:** Replace SQLite with a shared, partitionable store and bound cold-start time, still on a single instance.

**Scope**
- `store-postgres` adapter (schema = SQLite schema plus `owner_node`, `lease_epoch`, `lease_expires_at`, `snapshots`); hash-partitioned `actions`.
- Snapshot every *N* seq; load = latest snapshot + tail.
- Background digest verifier (replay from genesis, compare).
- Migration tool: export SQLite sessions as packages → import into Postgres.

**Depends on:** P9.

**Exit criteria**
- Postgres passes the unmodified contract suite from P5.
- Snapshot+tail load produces digests identical to full replay.
- A migrated session replays to the same digest.

---

## Phase 11 — Leases and multi-node ownership

**Goal:** Run multiple engine nodes safely, with exactly one writer per session even under pauses and partitions.

**Scope**
- Postgres-backed `LeasePort` (acquire/renew/release, epoch+1, expiry).
- Epoch-fenced `commit` enabled for real; `STALE_WRITER` handling in the actor (stop, drain, evict).
- Ownership routing (rendezvous hash + leases), request forwarding to the owner, graceful rebalance and cold takeover.
- Gateway/LB with session stickiness; admin: drain node, force-release lease.

**Depends on:** P10.

**Exit criteria**
- Fault-injection test: a paused ex-owner that resumes cannot commit (`STALE_WRITER`, no corruption).
- Killing a node mid-traffic: another node takes over, client retries are safe via the ledger.
- Two nodes serving mixed sessions pass the API e2e suite, excluding cross-node subscribe (that needs the bus from P12).

---

## Phase 12 — Event bus and edge projection

**Goal:** Deliver events reliably to subscribers connected to any node, without privileged data leaving a trust boundary.

**Scope**
- Outbox relay (per-session worker under the lease) to NATS JetStream: `ENGINE_COMMITS`, subjects, `Nats-Msg-Id` de-dup, publish-after-ack marking.
- Edge nodes: bus consumers, per-session state cache (fill from snapshot + tail, advance by commit), per-viewer `project_delta`, gap detection and `RESYNC_REQUIRED`.
- Bus carries `(session, seq, definition_id)` only for commits; no-leak test extended to the edge path.
- `timer_request` outbox rows relayed to `engine.timer.<sessionId>` with `Nats-Msg-Id = outbox.id` (consumed by the P13 timer service).
- JetStream sizing (retention window, replicas, shard count) decided from a measured fan-out run; this phase is its only owner.

**Depends on:** P11.

**Exit criteria**
- Duplicate or out-of-order notifications never cause duplicate or skipped client events.
- Subscriber on node X sees correct role-scoped deltas for a session owned by node Y.
- Relay crash between publish and mark causes no loss; duplicates are dropped by `lastProjectedSeq`.
- `timer_request` rows appear on `engine.timer.*` exactly as written to the outbox, including empty-batch rows with `seq = NULL`.
- The chosen stream settings and the fan-out measurements behind them are documented.

---

## Phase 13 — Isolation, identity, timers and telemetry

**Goal:** Protect nodes from hostile or runaway hooks, let frontends connect directly, and make the cluster observable.

**Scope**
- Worker-pool `HookRunner` with hard termination for `HOOK_TIMEOUT` and cost budget; per-game concurrency limits; no network in workers.
- JWT/JWKS auth and short-lived viewer tokens for edge nodes.
- Distributed timer service (JetStream consumer → Postgres due index with `SKIP LOCKED` → `system` event) plus reconciliation backstop.
- OpenTelemetry traces across forward hop and bus; cluster metrics and SLO alerts; runbooks.

**Depends on:** P12 (worker pool and JWT could start after P11).

**Exit criteria**
- A hook stuck in a synchronous loop is killed on time and does not stall other sessions on the node.
- Frontend connects to an edge node with only a minted token and sees only its entitlement.
- Timers survive node loss and fire once per request.

---

## Phase 14 — Definition registry and retention

**Goal:** Manage definitions and session history over the long term without breaking replay.

**Scope**
- Content-addressed definition registry service; nodes pull and verify bundles; refuse unverifiable ones (`REPLAY_MISMATCH`).
- Pin-while-referenced rule for old definitions.
- Retention: archive completed sessions to object storage as replay packages, drop from hot tables, policy in YAML.

**Depends on:** P13.

**Exit criteria**
- A node cold-starts a session using a definition fetched from the registry.
- An archived session restores from its package and replays to the original digest.
- A definition referenced by any session cannot be deleted.

---

## 2. Cross-phase rules

- **No phase edits the domain to suit infrastructure.** If Part B needs a domain change, the architecture's port design is wrong and must be revisited first.
- **Every adapter passes the shared contract suite** before it is wired in.
- **Every phase's tests run in the Docker `test` target**, not only locally.
- **Open questions** (architecture Appendix 4) each have exactly one owner:
  - Q8 schema evolution (the `Replayer` upgrader chain): P3.
  - Q15 spectator / custom roles: P3 (`RoleRegistry`).
  - Q14 subscription filters: P7, or explicitly deferred there as a *Should*.
  - JetStream sizing: P12.
