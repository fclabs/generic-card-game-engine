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

## D-010: Meta `subject` fields  (Iteration 3)
**Context:** PFR-017 projects a `subject` field "to the entry for the viewer's own seat" but not what happens when the viewer has no entry or the object is empty.
**Decision:** A `subject` value qualifies iff it is a (non-array) object whose keys are all seats of `state.roster.seats`. The projection is the viewer's own entry, or all entries for `auditor`; if the projection has no entry the field is omitted (so a partition with only such fields is absent). Meta fields without a declared visibility never appear; non-object partitions are skipped; `dealer`/`render` without a subject get no subject field; `secret` shows for `dealer` and `auditor` (registered, since validated).
**Rejected:** Emitting `{}` for a qualifying value with no visible entry (it would reveal the field's presence).
**Consequences:** Delta projection (Iteration 5) reuses `projectMeta` semantics.

## D-011: Grantee expansion and seat status  (Iteration 3)
**Context:** PFR-019 names status only for `all_seated`; the plan text says "seated seats only".
**Decision:** `all_seated` = seats with status `seated`; `team:<id>` = every seat of that team and a seat-id grantee = that seat, whatever their status. `expandGrantee(state, grantee)` is the hands-off name.
**Rejected:** Filtering every expansion by `seated` (the spec distinguishes `all_seated` explicitly).
**Consequences:** A `sitting_out` seat addressed by seat id or team still receives the grant.

## D-012: Where grant-derived content appears in a `View`  (Iteration 3)
**Context:** The View shape has no place for a face outside a zone; PFR-012 gives `count`-only, membership-only and `orderKnown: false` cases.
**Decision:** A card-level grant (`card` target or resolved `top`) makes that card appear in its zone's `members` (sorted by id, `orderKnown: false`, zone `count` only if count-entitled); with `card_face` it carries its face in any orientation. A zone appears iff count-entitled or some member is listed. Whole-zone membership via grant gives all members, `orderKnown` true only if order-entitled (static, or a `zone_order` grant on the zone); a `zone_order` grant without membership has no effect. `top` resolves to `zone.members[0]` against the state being projected; an empty zone gives no effect. A key without meaning for the target (e.g. `zone_order` on a card) is dropped. A statically entitled zone is unchanged (D-007).
**Rejected:** A separate `View` section for granted faces (changes the PFR-011 shape).
**Consequences:** Granting `card_face` on a hidden-zone card reveals that the card is in that zone.

## D-013: Grant listing and scope  (Iteration 3)
**Context:** PFR-020 lists grants by grantee/static entitlement; expiry is `engine.grant_expire` (P6).
**Decision:** `View.grants` ignores scope expiry: a grant still in `state.grants` is listed to its grantees (role not `dealer`/`auditor`, subject in the expansion) and to viewers statically entitled to every named key; its effect on zones, cards and counters follows `until_seq` (`state.seq < n`). Static entitlement to a card-target grant uses the card's current orientation (a face-down card in an auditor-`public` hand is not face-entitled); a zone target's `card_face` needs every current member face-entitled (vacuous when empty); unresolvable targets (unknown card/zone, empty `top`) and meaningless keys are not statically entitled (fail closed).
**Rejected:** Hiding expired grants from the list (state would then differ between expiry and `engine.grant_expire`).
**Consequences:** Delta (Iteration 5) uses the same predicates.

## D-014: Shape of the composition helper  (Iteration 3)
**Context:** The plan hands off "(state, viewer) -> EntitlementContext"; entitlement also needs the policy.
**Decision:** `buildEntitlementContext(policy, state, viewer, {grants?, exclude?})`. `EntitlementContext` keeps `policy`, `state`, `viewer` and adds pre-resolved `zoneKeys`/`cardKeys` maps of the applicable grants. `isEntitledToZoneKey` became grant-aware; the old rule is `isStaticallyEntitledToZoneKey`. Derived-counter inheritance (D-008) now sees grants because it calls `isEntitledToZoneKey`.
**Rejected:** Recomputing grants per question (cost, and no single exclusion point).
**Consequences:** Iterations 5 and 6 build contexts per (state, viewer), passing the pre/post union or an excluded id.

## D-015: PrivilegedBatch representation and accessor  (Iteration 4)
**Context:** PFR-030 wants the payload in a module-private `WeakMap` of the batch module and readable only through `openBatch`, which lives in another module (`open-batch.ts`, the one the dependency rule guards).
**Decision:** The handle is `Object.freeze(Object.create(null))` (no keys, no symbols, `JSON.stringify` -> `{}`, `structuredClone`/spread lose the payload); the brand is a type-only `declare const` symbol. `privileged-batch.ts` owns the `WeakMap` and exports `sealBatch` plus an internal `readSealedBatch` used only by `open-batch.ts`; no index re-exports it. `openBatch` throws `TypeError` for a value `sealBatch` did not create; `batchSeq` returns `Seq | null` (`tx.seq`).
**Rejected:** Putting the `WeakMap` in `open-batch.ts` (contradicts the spec's module split); a registration hook between the two modules (mutable global, order-dependent).
**Consequences:** `readSealedBatch` is internal by convention only; the rule covers `open-batch`. Replay code imports `open-batch` directly.

## D-016: Brand construction types and rule scope  (Iteration 4)
**Context:** Branding `View` makes `makeView(sections: View)` uncallable with a literal; the rule must also catch fixture trees and built output.
**Decision:** `makeView` takes `ViewSections = Omit<View, typeof viewBrand>`; `Delta` is declared with `DeltaSections` the same way (Iteration 5 adds its single constructor). The rule's `to.path` matches `packages/core/(src|dist)/visibility/open-batch(.d).(ts|js)` and `^@cge/core/.*open-batch`; `from.pathNot` is `packages/core/src/(visibility|replay)/` (tests beside those sources are allowed). `SECTION_73_RULES` (the guardrail rule list) gained the rule; its listing test title now says 13 rules.
**Rejected:** Exporting the brand symbols (would let callers forge brands).
**Consequences:** Anything outside visibility/replay that needs a batch's content cannot import `open-batch`.

## D-017: Card-level grants count as membership for delta entries  (Iteration 5)
**Context:** PFR-024 keys `card_id`/`from_zone`/`to_zone` on zone-level membership entitlement, but `projectView` (D-012) lists a card that holds a card-level grant inside its zone.
**Decision:** For a card `c` and zone `Z`, "membership-entitled" in a delta = zone `zone_membership` entitlement (static or zone grant) OR a card-level grant of `zone_membership`/`card_face` on `c` in that side's context. Source side uses the `pre` context, destination side `post`; a zone existing in one state only is evaluated in that state.
**Rejected:** Zone-level only (a granted card moving between two hidden zones would silently vanish from the grantee's view without any delta entry).
**Consequences:** Hands-off for Iteration 6: the same predicate is used under a grant exclusion.

## D-018: Entry details  (Iteration 5)
**Context:** The spec leaves entry ordering, `set_metadata` visibility and positions open.
**Decision:** `i` is the index in the committed action list (gaps where actions are invisible or not card events); entries are emitted in action order. `from_position` is the card's index in the working membership of an ordered, order-entitled source (working memberships are simulated over the batch); `to_position` is the action's `to_position` for an ordered, order-entitled destination; unordered zones never get positions. `set_metadata` produces an entry only if the viewer is membership- and face-entitled and at least one written field is visible; `fields` holds visible written fields with their post values (an empty entry would only leak that a hidden change happened). `counter_adjust`/`counter_transfer` produce no entries; the amount is never exposed.
**Rejected:** Emitting empty `set_metadata` entries; positions for unordered zones.
**Consequences:** `counter_transfer` between a visible and a hidden counter yields only the visible counter's new value in `counters`.

## D-019: Non-card sections are diffs of viewer projections  (Iteration 5)
**Context:** PFR-026 says "changed" for meta, gates, roster and counters; raw state can change without anything visible to the viewer.
**Decision:** `meta`, `gates` and `roster` compare the viewer's projection of `pre` and `post` and emit the post projection (`null` for a gone entry) only if it differs; `counters` emit when the raw value changed and the viewer is entitled in `post`; `zoneCounts` when the count changed or the zone is new and count-entitled in `post`; `control`/`lifecycle`/`outcome` when changed. A gate's public `submitted` list is part of the projection, so `engine.gate_submit` gives non-entitled viewers a `gates` entry with `submitted` but never a payload (VC-330's "empty delta" read as no entries and no payload; the alternative would contradict PFR-018 and PBR-010). A grant-only batch is empty for non-grantees. Newly granted content is not pushed into the delta (no section can carry it).
**Rejected:** Emitting on raw-state change alone (leaks that a secret field changed).
**Consequences:** Iteration 7's consistency check must tolerate facts that appear only through a newly added grant (they arrive via the `grants` entry and the next view).

## D-020: Opener rule also exempts built output  (Iteration 5)
**Context:** `pnpm depcheck` cruises `packages/core/dist`; the compiled `dist/visibility/project-delta.js` imports `open-batch.js` and tripped the rule, whose `from.pathNot` covered `src/` only (Iteration 4 had no importer).
**Decision:** `from.pathNot` is now `packages/core/(src|dist)/(visibility|replay)/`. No other rule or fixture changed; the violating fixture (`core-privileged-batch-opener-app`) still fails.
**Rejected:** Excluding `dist` from the cruise (hides real violations).
**Consequences:** Replay code in Iteration 9 compiles into `dist/replay`, which is exempt as well.
