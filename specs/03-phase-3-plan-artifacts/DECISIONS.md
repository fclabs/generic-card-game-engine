# Decisions (append-only)

## D-001: Owner resolution for `owner` and `team` audiences  (Iteration 1)
**Context:** PFR-009 says an owner `o` "resolves to" the viewer's seat `s` if it is the seat, its team or the player seated at `s`. Ids of different kinds share one charset, so a collision is possible.
**Decision:** `owner` entitles iff `o === s`, `o === roster.seats[s].team` or `o === roster.seats[s].player` (any match). `team` entitles iff the viewer's seat has a team `T` and (`o === T` or some roster seat `x` with `x === o` or `player(x) === o` has team `T`). A player-owned template zone is therefore resolved through the roster at query time, not at creation. `ZoneState.owner` (not the template) is the `o` passed in.
**Rejected:** Resolving by kind (checking declared seat/team/player id sets): the definition declares no players, and collisions are the game author's problem.
**Consequences:** `isEntitled(audience, owner, viewer, state)` needs only `state.roster`.

## D-002: A seat without a team has no teammates  (Iteration 1)
**Context:** PFR-009 `team` = "s is on the team of o's seat"; a teamless seat has no team.
**Decision:** `team` never entitles a viewer whose seat has no team (fail closed, PBR-001), even on its own seat-owned entity. `owner` still entitles that seat.
**Rejected:** Treating a teamless seat as a team of one.
**Consequences:** A game that wants "own seat" semantics uses `owner`.

## D-003: Shape of `VisibilityPolicy`  (Iteration 1)
**Context:** Spec §7.1 leaves `VisibilityPolicy` opaque; PFR-008 lists "card-metadata field" lookups although those are `public|subject|secret`, not audiences.
**Decision:** `VisibilityPolicy` is a frozen object: `zoneAudience(zone, template|undefined, role)` (configured zone declaration wins, else the template's), `counterAudience(counter, role)`, plus plain accessors `cardFieldVisibility(card, field)` and `metaFieldVisibility(schemaId, field)` returning the declared `FieldVisibility` or `undefined`. Role-keyed audience resolution is the exported `resolveAudience(rules, role)`. Field-level entitlement (PFR-014/017) is Iterations 2-3.
**Rejected:** Giving fields an `Audience` lookup (the declarations are not audiences).
**Consequences:** Projectors read `state.zones[z].template` and pass it in.

## D-004: Registration and "declared seat"  (Iteration 1)
**Context:** PBR-003 / PFR-002.
**Decision:** A privileged role is registered iff a zone, zone-template or counter `visibility` has an own key equal to it, whatever the audience (even `hidden`). `registeredPrivileged` is ordered `dealer`, `auditor`. A "declared seat" is a key of `state.roster.seats` (createSession seeds one per declared seat). Role detail strings are `JSON.stringify`d supplied values only (PBR-008).
**Rejected:** Registering via meta/card field visibility (not role-keyed).
**Consequences:** Registry is built from the definition alone; `validateViewer` needs the state only for seats.

## D-005: Built-in role ids are RESERVED_NAME, not DUPLICATE_ID  (Iteration 1)
**Context:** P2 reported `DUPLICATE_ID` for a built-in role id and documented that in `docs/game-definitions.md` (line ~153).
**Decision:** PFR-007 supersedes it: `RESERVED_NAME` at `roles[i].id` with `entity`; a repeated custom role stays `DUPLICATE_ID`. Only the P2 tests that asserted the old code changed (`meta-roles.test.ts`), and the doc comments in `compile/roles.ts` and `compile/errors.ts`.
**Rejected:** Reporting both codes.
**Consequences:** `docs/game-definitions.md` and `docs/game-definition-schema.md` (RESERVED_NAME row) are stale until the docs iteration (13) updates them.

## D-006: Local Node version  (Iteration 1)
**Context:** `docs/dev-setup.md` asks for Node 22; this machine has no `node@22` keg and runs Node v26.12.0 (pnpm warns about engines).
**Decision:** Run all commands with the available Node; all criteria pass on it. Docker remains the authority (Iteration 12).
**Consequences:** None for code.

## D-007: `orderKnown` and `count` for statically entitled zones  (Iteration 2)
**Context:** PFR-012 defines `orderKnown: false` only for grant-derived membership; the static case is unspecified, as is `orderKnown` for unordered zones.
**Decision:** A statically entitled zone always carries `count`, `members` and `orderKnown: true` (also for unordered zones, whose members are sorted by id). `owner` is included when the zone has one (the zone is already visible). Iteration 3 emits `orderKnown: false` only for a membership-only grant.
**Rejected:** Omitting `orderKnown` for unordered zones (consumers would need two cases).
**Consequences:** A consumer reads `orderKnown` uniformly.

## D-008: Derived counter "declares no visibility"  (Iteration 2)
**Context:** `counterAudience` returns `undefined` both for an undeclared derived counter (inherit, PBR-011) and for a declaration that does not cover the viewer's role (hidden).
**Decision:** "Declared" means the counter's `visibility` record has at least one key (checked on the definition). A declared counter is governed by `counterAudience` only (a `{player: public}` derived counter is hidden from `render`); an undeclared derived counter inherits `zone_count` of `derivedSpec.zone` through `isEntitledToZoneKey`, and is hidden when it has no `derivedSpec`. Stored counters always use `counterAudience`. The value comes from the `derived` evaluator.
**Rejected:** Falling back to inheritance when the declaration misses the role (would widen an explicit declaration).
**Consequences:** Same rule must be reused by delta projection (Iteration 5).

## D-009: Placeholder sections and entitlement helper  (Iteration 2)
**Context:** Scope requires meta/gates/grants present but empty until Iteration 3.
**Decision:** `meta: {}`, `gates: {open: {}, resolved: {}}`, `grants: {}` in every view. `isEntitledToZoneKey(ctx, zone, key, orientation?)` in `entitlement.ts` is the one static zone-entitlement helper (`zone_count`/`zone_membership`/`zone_order` together; `card_face` per PFR-013, orientation defaults to face down); Iteration 3 wraps it with grants.
**Rejected:** Separate helpers per key (all three static keys are one rule).
**Consequences:** Hands-off name and signature for Iterations 3 and 5.
