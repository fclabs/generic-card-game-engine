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

## D-021: wouldReveal returns [] for a mismatched batch  (Iteration 6)
**Context:** PFR-029 gives `wouldReveal` a plain `readonly GrantId[]` return (no `Result`), but the batch/pre/post preconditions of PFR-023 can still be violated by a caller.
**Decision:** If `post.seq !== pre.seq + 1` or the batch seq differs, return `[]` (nothing is revealed by a transaction that is not the one between `pre` and `post`). `openBatch` still throws `TypeError` for a foreign value, as everywhere.
**Rejected:** Throwing (the signature has no error channel and P6 calls it on the hot path); returning a `Result` (contradicts spec 7.3).
**Consequences:** P6 must feed the real committed transaction; a wrong pairing silently never consumes grants.

## D-022: Per-grant what-if, not joint removal  (Iteration 6)
**Context:** PFR-029 says "whose removal ... changes the projected delta". With two grants that grant the same thing, each alone is redundant.
**Decision:** Each `once` grant is tested alone (the others stay in the union). Identical redundant grants are therefore both omitted; one non-redundant grant is returned. Grantee seats are expanded over `pre`; seats missing from `post.roster` are skipped. Equality is whole-`Delta` JSON equality; baselines per seat are cached across grants.
**Rejected:** Removing all `once` grants together (would flag grants that add nothing individually); expanding over `post` (a grant being revoked in the batch still needs its seats).
**Consequences:** Callers (P6) consume only flagged grants; a redundant duplicate stays until it matters on its own.

## D-023: Reading of the spec used by the property oracle and fold  (Iteration 7)
**Context:** VC-340..343 need an exact reading where the spec is silent or its pieces interact.
**Decision:** (a) The oracle follows D-007..D-014 where the spec is silent, including "a zone appears iff count-entitled or some member is listed" (a membership-only grant on an empty zone shows nothing). (b) A viewer with a subject seat sees that seat's own sealed gate submission for any role (render with a subject, custom roles included); only registered `auditor` sees all (PFR-018 "a seat that has submitted sees its own"). (c) A delta is judged over the batch's states (pre, each action prefix, post) under the union of pre/post grants: a `move` is a public event for whoever is entitled to either zone at that moment, so a card that transits a viewer-visible zone is named even if it ends hidden; `face` follows PFR-024 literally (`card_face` for the card in `post`, so a zone-level `card_face` grant can attach a face to a card whose id came from the source zone). (d) `move` entries carry no orientation (spec shape), so the fold treats a newly visible card's orientation as unknown and skips it. (e) With grants, VC-342 restarts every step from `projectView(pre)` and requires only the static facts; without grants it folds the whole stream and compares everything (D-019 limits). (f) Perturbation (VC-343) swaps identities of cards that are unlisted in every judged state and never perturbs listed data.
**Rejected:** Requiring full equality under grants (content of new, ended, re-resolved `top` or consumed grants is not in a delta); judging deltas only on pre/post (rejects legal public events).
**Consequences:** The limits are listed in CONTEXT "Known gaps"; adding orientation to `move` entries or grant-content to deltas would tighten VC-342 (spec change).

## D-024: A zone `card_face` grant does not list members  (Iteration 7)
**Context:** VC-340/341 failed: `projectView` listed every card of a zone (with face and `orderKnown: false`) when the viewer held only a zone-level `card_face` grant. The listing filter used `isEntitledToCardKey(card_face)`, which includes zone grants. PFR-012/019: a grant adds only the keys it names; faces need a listed card.
**Decision:** `projectZones` lists a card without whole-zone membership only if a card-level grant (card or resolved `top` target) names `zone_membership` or `card_face` for it (`ctx.cardKeys`); the face of a listed card still uses the full `card_face` entitlement (zone grant included). `projectDelta` already used card-level keys only.
**Rejected:** Treating a zone `card_face` grant as implying membership (widens entitlement beyond the grant).
**Consequences:** Regression test in `project-view-grants.test.ts`; behaviour for membership grants and static zones unchanged.

## D-025: Property knobs and case counts  (Iteration 7)
**Context:** PNFR-001 wants at least 2 000 cases per role class in `pnpm test` with a fixed seed list.
**Decision:** `CGE_VISIBILITY_RUNS` (default 2000) cases per role class and property, split over `SEEDS` (4 fixed seeds); VC-344 and VC-376 default to min(runs, 500); `CGE_VISIBILITY_SEED` runs one seed. A case is one generated (definition, session, batches) tuple checked for every viewer of the class at every state/step. VC-342 runs twice (grant-free whole stream, and with grants per step). Failures are rethrown with property, class, seed and the shrunk tape.
**Rejected:** One shared constant like P1's `RUNS` (the suite would be unusable at the floor on a laptop with no way to shorten it).
**Consequences:** The default suite adds about 95 s in one file; `CGE_VISIBILITY_RUNS=100` is the quick run.

## D-026: `decodePackage` needs no definition; definition-independent state node  (Iteration 8)
**Context:** `buildStateSchema(definition)` uses the definition's metadata and meta field schemas, but `decodePackage(bytes, opts?)` takes no definition (spec §7.4) and the package must decode before its definition is resolved.
**Decision:** The package schema embeds `packageStateNode`: the digest schema's layout with `json` nodes for card `metadata` and `meta` partitions, `id` first, no `derivedCounters`. For engine-produced values `json` and the typed nodes emit identical bytes (sorted keys, strings, safe integers, booleans), so no definition is needed to encode or decode. The Replayer (Iteration 9) checks the decoded `initial` against the definition by digest (PFR-042) and must catch `CanonicalError`.
**Rejected:** Two-phase decode with a resolved definition (changes the `decodePackage` signature and blocks inspection tools); decoding `initial` as a raw `json` value (loses `bigint` counters, forcing a second decode).
**Consequences:** A package whose metadata violates the definition decodes fine and is rejected at replay; decoded metadata/meta values are plain JSON.

## D-027: `buildPackage` takes `resolved`, defines `ReplayError`/`ResolvedDefinition` early  (Iteration 8)
**Context:** Spec §7.4 gives `buildPackage(stored, receipts, opts?)`, but `StoredSession` has no `gameId` and digests need the definition's schemas and reducers; the types `ReplayError` and `ResolvedDefinition` belong to the Replayer (Iteration 9) yet `buildPackage` returns/needs them.
**Decision:** `opts` is required and carries `resolved: ResolvedDefinition` (plus `digests`, `params`). `ReplayError` (`replay-error.ts`, with the `replayError` constructor) and `ResolvedDefinition` (`resolved-definition.ts`) are created now and reused by Iterations 9-11. Digests come from a local fold over `apply` (no proposal, macros rejected); `final` records the last seq only and an empty log has no digests. Binding mismatches are `REPLAY_MISMATCH` (field in `path`), log/replay problems `REPLAY_INVALID` with `seq`/`actionIndex`. Duplicate receipt keys are `REPLAY_INVALID`.
**Rejected:** Reading `gameId` from nowhere / leaving it empty; waiting for the Replayer (would leave PFR-038 unimplemented).
**Consequences:** Iteration 9 may re-implement the fold through `rebuild`; the observable behaviour must stay.

## D-028: Where `decodeCanonical` and `PackageError` are exported  (Iteration 8)
**Context:** PFR-035 says "added to the canonical module", but `replay/canonical/index.test.ts` (VC-068, P1) pins that index to four runtime exports, and VC-370 allows changing only two pre-existing tests.
**Decision:** `decode.ts` lives in `replay/canonical/` but is exported from `replay/index.ts` (and `@cge/core`), not from `replay/canonical/index.ts`. `PackageError`/`PackageErrorCode` are declared in `decode.ts` (the decoder reports four of the codes) and re-exported from `package.ts`, which is where PFR-039 places them.
**Rejected:** Editing the VC-068 test; duplicating the types.
**Consequences:** None for callers of the package root.

## D-029: Action and receipt nodes; `initial.id` travels  (Iteration 8)
**Context:** The canonical profile has no tagged union, and actions carry `bigint` (`delta`, `amount`, `ratio`) that a plain `json` node cannot hold; `Receipt` has nullable fields no node expresses.
**Decision:** `actionNode` is one object: `kind` then every payload field of every kind, sorted, all optional, typed (`bigint` as decimal strings, `pointer` as `json` because `control_set` and `control_advance` disagree). `receipt.result/errorCode/seq/detail` are `json` nodes; `decodePackage` re-checks `errorCode` (null or an engine code) and `seq` (null or non-negative). `initial` includes its `id` (the "full" state), so a fork may keep or rewrite it (Iteration 11 decides).
**Rejected:** One schema per action kind (would need a union node, a profile change); dropping `id` (breaks deep-equal of decode(encode(pkg))).
**Consequences:** The schema accepts an action with a field its kind does not use; PFR-043 validation in the Replayer rejects it.

## D-030: Golden package fixture and tooling  (Iteration 8)
**Context:** VC-345 compares `encodePackage` with the committed file byte for byte; Prettier would rewrite a one-line canonical JSON file.
**Decision:** `packages/core/src/replay/golden-package.json` is listed in `.prettierignore` (the only config change). The fixture is the P1 property definition with golden stream steps 1-11 plus step 12 extended by `lifecycle completed`, so the 12 transactions commit every primitive kind. Tolerated by the decoder, rejected by content: log gap reports the first violation only; `formatVersion` is peeked before the schema walk so a future format reports `PACKAGE_FORMAT_VERSION` alone.
**Rejected:** A pretty-printed golden file (not the canonical bytes); a wrapper object (not "the package bytes").
**Consequences:** Regenerate with `UPDATE_GOLDEN=1`; reviewers diff the bytes by hand.

## D-031: A seat without a player does not invalidate `initial`  (Iteration 9)
**Context:** PFR-042 says "a seat without a player makes the initial state invalid", but the golden fixture (and the P1 property roster) seat three seats with one player, and VC-351 must replay it.
**Decision:** The roster is rebuilt from `initial.roster.seats` for `createSession`; it is invalid when `createSession` rejects it (undeclared or missing seat, bad team, duplicate player), when `status` is not the fresh `seated`, or when digests differ. A seat entry with no `player` is valid.
**Rejected:** Requiring a player on every seat (rejects the golden package and every session that starts with open seats).
**Consequences:** "Roster that does not match" (VC-353) is tested with a missing seat, an undeclared seat and a changed status.

## D-032: Replay starts from the rebuilt initial state  (Iteration 9)
**Context:** Decoded packages are unfrozen; `apply` needs a deep-frozen state; freezing `pkg.initial` would mutate the caller's package.
**Decision:** Once `pkg.initial`'s digest equals a fresh `createSession(def, pkg.sessionId, roster)` digest, the fresh (already deep-frozen, unshared) state is the starting point. `initial.id` is ignored (the digest excludes it, PBR-009); the replayed state's `id` is `pkg.sessionId`.
**Rejected:** `deepFreeze(pkg.initial)` (side effect on input); cloning `initial` (needless once equality is proven).
**Consequences:** The package value is never touched; a package whose `initial.id` differs from `sessionId` replays.

## D-033: `onStep` error type and pass-through  (Iteration 9)
**Context:** Spec types `onStep` as `Result<void>` (error `EngineError`) but `rebuild` fails with a `ReplayError`; PFR-047 says it stops "with that error".
**Decision:** `onStep` returns `Result<void, ReplayError>` and `rebuild` returns that very error object (identity). A step error is not wrapped or re-seq'd.
**Rejected:** Wrapping an `EngineError` into a `REPLAY_INVALID` (loses "that error"); a lying cast.
**Consequences:** Callers (Forker, tests) build errors with `replayError`.

## D-034: Replayer configuration declared now  (Iteration 9)
**Context:** `createReplayer({versions, upgraders})` is Iteration 9 scope with upgraders unused; `PackageUpgrader` belongs to Iteration 10.
**Decision:** `PackageUpgrader` is declared in `replayer.ts` (`upgrade(raw: JsonValue): Result<JsonValue, string>`); `createReplayer` throws `RangeError` for `current` not a positive integer in `supported`, duplicates in `supported`, or non-array `upgraders`. The default `replayer` is `{current: 1, supported: [1], upgraders: []}`. `rebuild` still compares `actionSchemaVersion` with the definition's (PFR-041), not with `versions`.
**Rejected:** Returning a `Result` from `createReplayer` (the interface fixes `Replayer`); creating `upgrade.ts` early (Iteration 10's file).
**Consequences:** Iteration 10 moves the type, adds `upgradeToCurrent(raw)` before decode, and may let `versions` drive PFR-050.

## D-035: What "random sessions" means for VC-350  (Iteration 9)
**Context:** VC-350 says "random definitions"; the generators target one definition (`buildPropertyDefinition`).
**Decision:** `buildLiveSession(tape, {transactions})` plays `generateBatch` over the property definition (3 seats, templates, counters, gates, grants, shuffles, zone create/destroy, lifecycle), keeping committed batches only; `replay-properties.test.ts` runs 600 tapes (seed 20261022, `CGE_REPLAY_RUNS`), 1-40 transactions, half through `encodePackage`/`decodePackage`, comparing live digests, final state and seq at every step. It asserts the generated kinds include move, shuffle, grant_view, zone_create.
**Rejected:** Random compiled definitions (no generator exists; out of scope).
**Consequences:** Definition variety comes from the random visibility/metadata of the generated sessions, not from the definition itself.

## D-036: Hook-free check without hooks on the definition  (Iteration 9)
**Context:** VC-355 asks for a definition "whose hook functions are sentinels"; `CompiledGameDefinition` carries only `hookBindings` (ids), hook functions live in bundles outside core.
**Decision:** The test sets `hookBindings` on the definition and holds throwing sentinel functions in a table that is never passed to replay (nothing in `rebuild`/`advance` accepts one); it replays the golden package with both and asserts zero calls. The static half scans non-test files in `replay/` for `HookRunner`, `ReactionHook`, `ValidationHook` (comments stripped) and any `spi/` import. `forkFromSeq` joins the sentinel test in Iteration 11.
**Rejected:** Adding sentinel fields to the definition type.
**Consequences:** The structural guarantee is the absence of any hook input in the replay API.

## D-037: `buildPackage` keeps its own fold  (Iteration 9)
**Context:** Iteration 8 noted `rebuild` may replace `buildPackage`'s fold if behaviour is identical.
**Decision:** Not replaced: `buildPackage` has no package yet (it folds a stored log before one exists) and its errors carry different `detail` text and `final`-only digest rules.
**Rejected:** Building a package, then calling `rebuild` (a self-referential check that changes error texts).
**Consequences:** Two folds exist; both go through `apply` and the primitive check.

## D-038: `rebuild` takes a decoded package or a raw one  (Iteration 10)
**Context:** PFR-051 upgrades raw JSON before schema decoding, but `rebuild` received an already decoded `ReplayPackage`, and a raw JSON object cannot be told from a decoded package by shape.
**Decision:** `rebuild(resolved, input, opts?)` with `input: ReplayPackage | RawPackage`, `RawPackage = Uint8Array | {raw: JsonValue}` (a tagged wrapper, so no shape sniffing). Raw input is upgraded (when not current) and decoded inside `rebuild`; a decoded package is replayed as is (it is current-shaped by construction, so no upgrade).
**Rejected:** A separate `rebuildRaw` method (two paths to keep in sync, free function too); sniffing for `formatVersion` (ambiguous); upgrading a decoded package by re-encoding it (it could never hold an old shape).
**Consequences:** `decodePackage` is unchanged; callers holding bytes of an older package pass them straight to `rebuild`. The Forker can accept the same union.

## D-039: The recorded version binds the definition; upgraded packages say "current"  (Iteration 10)
**Context:** After upgrading 1 -> 2 the package says version 2, while the definition (and its content hash) still carry `schemaVersion` 1 (the compiler only knows 1).
**Decision:** The binding check compares the version the package was RECORDED under (before any upgrade) with `definition.schemaVersion`, and first checks it is in `versions.supported` (`unsupported action_schema_version n`, path `actionSchemaVersion`). The decoded package handed to the fold carries `actionSchemaVersion` = current.
**Rejected:** Comparing the upgraded version (an old session on its old definition would never replay); skipping the version binding for upgraded packages.
**Consequences:** A v1 package binds to a v1 definition; moving a session to a v2 definition is a definition change, not an upgrade.

## D-040: `createReplayer` does not validate the chain  (Iteration 10)
**Context:** Iteration 9's test builds `{current: 2, supported: [1, 2], upgraders: []}` and rebuilds a decoded v1 package; PFR-053 wants a testable injected chain.
**Decision:** Config validation stays as in D-034. The chain is checked by `assertUpgraderChain` (a unit test for the real constants, VC-364); at run time a missing step is `unsupported action_schema_version <n>` (PFR-052 "no upgrader path").
**Rejected:** Throwing `RangeError` for a bad chain at construction (breaks the Iteration 9 test and hides the mismatch as an exception).
**Consequences:** A bad injected chain surfaces per package as `REPLAY_MISMATCH`, not at construction.

## D-041: Upgrade-step details  (Iteration 10)
**Context:** PFR-050..052 leave the corners open.
**Decision:** `upgradeToCurrent(raw, policy?)` returns `raw` unchanged when it is not an object with an integer version (the decoder reports it) or the version is current; otherwise upgraders run on a deep copy, the chain stamps `actionSchemaVersion = from + 1` after each step, and a throw or non-object result is `REPLAY_INVALID` seq 0. Bytes become `JsonValue` through the strict tokenizer (`documentToJson`: duplicate keys and non-safe integers rejected), then the upgraded value is re-serialised with `JSON.stringify` and decoded by `decodePackage`; the fast path (current version) decodes the bytes directly. `assertUpgraderChain` reports the first violation in the order given in CONTEXT.md.
**Rejected:** `JSON.parse` of the bytes (silent duplicate keys, rounding); trusting upgraders not to mutate.
**Consequences:** The upgrade path tokenises twice; it only runs for old packages.

## D-042: Fixtures of the upgrade tests  (Iteration 10)
**Context:** PBR-005 needs a golden package per supported version (only v1 exists) and VC-361 an old-shape package.
**Decision:** `golden-package.json` stays the v1 golden (D-030; VC-364 maps version -> file). `fixtures/legacy-v1-package.json` is that package with `counter_adjust.delta` renamed `by` (pretend old shape), listed in `.prettierignore`; a test proves it equals `ageToLegacyV1(golden)`, and that the upgraded form equals the golden with `actionSchemaVersion: 2`. Test-only upgraders are `*.testing.ts` and never join `PACKAGE_UPGRADERS`.
**Rejected:** A second recorded session (digests would differ from the golden for no gain).
**Consequences:** Adding version 2 later means a real v2 golden plus replacing the legacy-shape fixture's role.

## D-043: `forkFromSeq` takes a decoded package and verifies by replaying  (Iteration 11)
**Context:** Iteration 10 left open whether the forker accepts raw input; PFR-054 needs the state at `n` and a session-id re-key.
**Decision:** `pkg` is a decoded `ReplayPackage` (a caller holding bytes or an old package decodes/upgrades first, so the fork's `actionSchemaVersion` is current by construction). The fork package is built first (new id on `initial` and `sessionId`) and the state is the result of `replayer.rebuild` on it up to `n`, so binding, initial state and recorded digests `<= n` are verified in one pass and the state already carries the new id.
**Rejected:** Rebuilding the source and re-keying the state afterwards (a second code path for the id, no check that the fork package itself replays); a raw-input overload (an upgraded fork would need a version stamp rule of its own).
**Consequences:** A tampered source digest after `n` does not block a fork before it; one before `n` does.

## D-044: Fork errors and copies  (Iteration 11)
**Context:** PFR-054/056 fix the codes and two detail texts only.
**Decision:** Session id errors are checked before `n`; all fork-specific errors are `REPLAY_INVALID` at seq 0 (`invalid session id`, `same session id`, `fork seq out of range: n (the log ends at seq L)`). The package is copied with a local plain-data deep copy (own data properties, `bigint` kept) and then `deepFreeze`d, so the source is never frozen as a side effect and no object is shared. `continueFork` lives in `forker.testing.ts`, not exported.
**Rejected:** `structuredClone` (not in core's allowed globals/types); freezing shared objects (would mutate the source's frozen flags).
**Consequences:** A fork result cannot be extended in place; hosts build a new package value (as `continueFork` does).

## D-045: Where the end-to-end, edge-path and replay-error tests live  (Iteration 12)
**Context:** VC-378/379/376 need both `visibility` (projector, property checks) and `replay` (Replayer, Forker, packages); `replay` imports `visibility/open-batch`, and a `visibility` test importing `replay` would make a cycle that `no-circular` rejects.
**Decision:** `end-to-end.test.ts`, `edge-path.test.ts`, `replay-error-details.test.ts` and the shared `trick-session.testing.ts` live in `replay/` (which may import `visibility`). The floor fixture `visibility/floor.testing.ts` is shared by both performance tests (replay imports visibility, not the reverse). Edge path runs 500 cases per class and property by default (`CGE_EDGE_RUNS`), since each state is also proven equal (digest and deep equality) to the live one; the live properties keep 2 000.
**Rejected:** `visibility/` homes for these tests (cycle); 2 000 edge cases (would double the 95 s property time for no extra information once states are identical).
**Consequences:** `replay/` test count grows; no guardrail change.

## D-046: Performance fixture, workloads and heap measurement  (Iteration 12)
**Context:** VC-373 fixes the floor and thresholds but not the visibility rules, the batches, or how to measure heap. The P1 floor definition declares no visibility and no counters beyond three.
**Decision:** `buildVisibilityFloor` = the P1 floor (14 seats, 4 teams, 700 cards, 64 zones) with 14 owner hands (auditor public), 26 public zones, 24 hidden zones (dealer public), 40 counters (14 owner, 24 public, 2 derived), card metadata with public/subject/secret fields, `conservationGroups: []`, and public-zone cards face up. `projectView` is measured for player, render (with and without subject), auditor and dealer plus a worst case (every zone public to every role, all cards face up: 82 KB); `projectDelta` for 20 moves in public zones for the same viewers; `wouldReveal` for 5 `once` zone grants (one grantee each) and 20 moves out of the granted hands; package tests use 1 000 transactions of 5 `move`s with `digests: 'none'`. Heap = retained growth of `rebuild` with its result alive, after two forced GCs (`node:v8` + `node:vm` to obtain `gc`, test-only), median of 5. Default ceilings are 10x the spec thresholds; strict (spec numbers) with `CGE_PERF_STRICT=1` or `/.dockerenv`, as P1/P2.
**Rejected:** Peak-heap sampling inside `onStep` (noisy without GC control); `all_seated` grantees for `wouldReveal` (spec says "5 once grants", not a worst-case grantee set); a node `--expose-gc` runner flag (config change).
**Consequences:** Measured numbers are in CONTEXT.md and the Iteration 12 record; the margins are 2-4 orders of magnitude, so the strict bounds are robust on a slower runner.

## D-047: Static no-`node:*` check lives in a core test; guardrails unchanged  (Iteration 12)
**Context:** The plan asks for a check that `core/src/{visibility,replay}` import no `node:*`; PFR-058 permits no guardrail change beyond the PFR-032 rule and its fixtures. The existing `core-no-node` rule already covers all of `packages/core`.
**Decision:** `replay/purity.test.ts` scans every non-test `.ts` file of both folders for `node:*` and bare built-in specifiers. VC-371's "still fails" is shown by experiment (a `node:fs` import in each folder fails `depcruise` with `core-no-node`) and by the existing guardrail suite; no new guardrail fixture was added.
**Rejected:** New depcruise fixtures for `visibility/` and `replay/` (a guardrail change PFR-058 does not list).
**Consequences:** None.

## D-048: Replay-error leak scan scope  (Iteration 12)
**Context:** VC-376 says replay errors "never contain metadata values or gate payloads of the fixture"; PBR-008 allows card, zone and counter ids.
**Decision:** `replay-error-details.test.ts` forces 38 failing calls (binding, initial state, log integrity, digest, uptoSeq, unbound reducer, fork errors, raw-bytes version/decode errors) on the trick-taking session and requires that no error (code, detail, path, decode error lists) contains any card metadata value, gate payload, counter value (also tampered-in values) of the session. A caller-supplied name echoed by an unknown-key or game-id error is exempt. All errors already passed; no source change.
**Rejected:** Scanning only `detail` (paths and decode error lists could leak).
**Consequences:** A future error text that echoes a value fails this test.
