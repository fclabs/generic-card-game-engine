# CONTEXT (Phase 3, after Iteration 6)

## Current state
- Iterations done: 1 (roles, viewer validation, policy), 2 (`projectView` zones/cards/counters/engine), 3 (meta, gates, grants), 4 (fail-closed types, opener rule), 5 (`projectDelta`, `projectLogEntry`), 6 (`wouldReveal`). Next: 7 (no-leak/consistency properties).
- `visibility/` has `make-delta.ts` (`makeDelta`, `DELTA_SECTION_ORDER`, the ONLY `Delta` creator; `makeDelta` is not exported from any index) and `project-delta.ts`. `projectDelta` and `projectLogEntry` are exported from `@cge/core`; `projectLogEntry` is a thin wrapper returning exactly `projectDelta`'s result.
- Repo builds; lint, typecheck, depcheck, format:check, guardrails green. Local Node is v26 (D-006).

## wouldReveal (Iteration 6)
- `wouldReveal(def, pre, post, batch, grantee?: SeatId): readonly GrantId[]` in `visibility/would-reveal.ts`, exported from `@cge/core`. Pure. Returns ids ascending (UTF-16) of `once` grants (scope `{kind:"once"}`) present in `pre.grants` such that, for at least one seat of `expandGrantee(pre, grant.grantee)` (role `player`, subject = seat, seat must exist in `post.roster`; optional `grantee` keeps only that seat), the delta differs with the grant excluded. Both deltas use `buildDeltaContexts` (union of pre/post grants; the what-if passes `{exclude: id}`) and `deltaFor`. "Differs" = `JSON.stringify` inequality of the whole `Delta` (deterministic key order = deep equality over every section).
- A batch not matching `pre`/`post` (`post.seq !== pre.seq + 1` or `tx.seq !== post.seq`) returns `[]` (no error channel, D-021). A grant created by the batch is never in `pre`, so never returned. Redundant grants (two identical once grants) are not returned: removing one changes nothing (D-022).
- Cost: baseline delta per distinct seat computed lazily and shared, plus one what-if delta per (grant, seat): `O(seats + onceGrants * seatsPerGrant)` evaluations of the batch.
- Fixtures creating `once` grants: `would-reveal.test.ts` only (`A.grant(target, keys, grantee, {kind: "once"})` on the trick-taking definition with `viewKeys` = the four zone keys); `project-delta.test.ts` has one consumed-once case. Test helper `step(pre, actions)` is local to each test file.

## Delta projection (Iteration 5)
- `projectDelta(def, pre, post, batch, viewer): Result<Delta>`: validate viewer against `post` (PFR-002..005 errors) -> `openBatch(batch)`; `post.seq !== pre.seq + 1` or `tx.seq !== post.seq` (incl. `null`) -> `REPLAY_INVALID` "batch does not match pre/post" -> `deltaFor`.
- `buildDeltaContexts(def, pre, post, viewer, {exclude?}) -> {pre: EntitlementContext, post: EntitlementContext}` (exported from `project-delta.ts`, NOT from the index): both contexts use `mergeGrants(pre, post)` (union of grant records; `exclude` drops one id). Source facts use the `pre` ctx, destination facts the `post` ctx; a zone present in only one state is evaluated in that state. `deltaFor(compiled, ctxs, seq, actions): Delta` is the internal worker Iteration 6 reuses with an excluded grant. `compileLookups(def)` (project-view.ts) is the per-definition cache.
- Entries (`i` = index in the committed action list, so gaps are normal): `move` -> `card_id` iff membership-entitled at source (pre) or destination (post); `from_zone`/`to_zone` each iff membership-entitled there; `from_position` only for an ordered, order-entitled source (index in the working membership), `to_position` only for an ordered, order-entitled destination; `face` iff `card_face`-entitled in post. "Membership-entitled for card c in zone Z" = zone `zone_membership` OR a card-level grant naming `zone_membership`/`card_face` for c (D-017). `flip` -> `card_id`, `orientation` iff membership-entitled in post; `face` iff face-entitled in post. `set_metadata` -> only when membership- AND face-entitled and at least one written field is visible (D-018); `fields` = visible written fields with post values. `shuffle` -> zone iff membership-entitled in post, `permutation` iff order-entitled. `zone_create`/`zone_destroy` -> zone id iff membership-entitled (template rule; create evaluated in post, destroy in pre).
- Sections (all by diffing pre vs post projections, D-019): `zoneCounts` (count changed or zone new, count-entitled in post), `counters` (value changed, entitled in post via `isCounterVisible`), `control`/`lifecycle`/`outcome` iff changed, `roster` (changed seats, `null` if removed), `meta` (partitions whose viewer projection changed, `null` if gone), `gates` (id -> post `GateView`, `null` if gone; changes in the public `submitted` list count), `grants` (added: `isGrantVisible` in post; removed/consumed: `null` if visible in pre). `zoneCounts` and `counters` are always present (`{}`); other sections are absent when unchanged. Key order = `DELTA_SECTION_ORDER`.
- `project-view.ts` now also exports `compileLookups`, `Compiled`, `projectFace`, `projectMeta`, `projectGates`, `projectSeat`, `projectControl`, `isZoneOrdered`, `counterValue`, `isCounterVisible`, `isGrantVisible`, `projectGrantView` (none re-exported from the index).
- `project-delta.test.ts` has its own `step(def, pre, actions) -> {pre, post, batch, tx}` helper (applies, builds a `Transaction` with unique canary `eventId`/`principal`, seals) and `withPrivileged(def)` (auditor+dealer `public` on hands, stock, trick).

- Reusable random-batch generators for Iteration 7: `session/generators.testing.ts` (`buildPropertyDefinition`, `propertyRoster`, `propertyStart`, `generateAction`, `generateBatch`, `generateStream`, `Tape`, `tapeArbitrary`); P3 tests sealing a generated batch use `step`-style code (apply, build `Transaction`, `sealBatch`).

## Fail-closed types (Iteration 4)
- `View` and `Delta` carry a type-only `declare const` unique-symbol brand key (`[viewBrand]: true`, `[deltaBrand]: true`; no runtime property). `ViewSections = Omit<View, brand>` and `DeltaSections` are what constructors accept. `makeView(sections: ViewSections): View` is the only `View` creator; `makeDelta(sections: DeltaSections): Delta` (`make-delta.ts`, Iteration 5) is the single `Delta` creator.
- `PrivilegedBatch`: frozen null-prototype empty object, type-only brand. Payload (`Transaction`) in the module-private `WeakMap` in `privileged-batch.ts`. `sealBatch(tx: Transaction): PrivilegedBatch` (public). `openBatch(batch): Transaction` (throws `TypeError` for a foreign value) and `batchSeq(batch): Seq | null` live in `open-batch.ts`; they read the map via the internal `readSealedBatch` of `privileged-batch.ts` (not in any index).
- Dependency rule `core-privileged-batch-opener` (`.dependency-cruiser.cjs`): any file outside `packages/core/(src|dist)/(visibility|replay)/` (dist added in Iteration 5, D-020) importing `packages/core/(src|dist)/visibility/open-batch.(ts|js|d.ts)` or `@cge/core/**open-batch` fails. Guardrail fixtures `core-privileged-batch-opener-app` (violates) and `-allowed` (replay + visibility, clean) in `tools/guardrails/fixtures/depcruise/`, cases in `tools/guardrails/depcruise-cases.ts` (`SECTION_73_RULES` now lists 13 rules). `docs/workspace-architecture.md` mentions the rule.
- Type tests: `visibility/privileged-batch.test.ts` (`@ts-expect-error` / `expectTypeOf`), part of the core test tsconfig (`packages/core/tsconfig.test.json`, run by `pnpm typecheck`; an unused `@ts-expect-error` fails it) and the runtime half runs under vitest.
- Replay code (Iterations 8+) that opens batches imports `../visibility/open-batch.js` directly.

## P1/P2 as-built facts a projector author needs
- **Definition** (`definition/types.ts`, `CompiledGameDefinition`): `roles: RoleDecl[] {id, subject: required|optional|forbidden}`; `zones[] {id, ordered, owner?, visibility}`; `zoneTemplates[] {name, ownerRule: seat|team|player|none, ordered, maxInstances, visibility}`; `counters[] {id, owner, ownerId?, visibility, derived?, derivedSpec?: {kind:'zone_size', zone}}`; `cards[] {id, type?, metadataSchema, startingZone, initialMetadata, metadataVisibility: field -> public|subject|secret}`; `metaSchemas[] {id, fields, fieldVisibility, reducerRef, reducer?}`; `seats[] {id, team?}`; `teams`; `viewKeys`; `control`.
- `VisibilityRules = Record<'default'|roleName, Audience>`, `Audience = public|hidden|owner|team`; `{}` means undeclared. Compiler (DFR-021) only allows role keys that are built-in/custom roles; `owner`/`team` only on owned entities. `GRANTABLE_VIEW_KEYS`/`viewKeys` = grant vocabulary.
- **State** (`session/state.ts`, `SessionState`, always deep-frozen `Snapshot`): `id, lifecycle, seq, cards{id->{zone, orientation: face_up|face_down, metadata}}, zones{id->{template?, owner?: SeatId|TeamId|PlayerId, members}}, zoneOrdinals, counters{id->bigint (stored only)}, meta{schemaId->JsonValue}, roster{seats{seat->{status, player?, team?}}}, control{phase, turnOrder, activeSeats, direction, pointers}, gates{open, resolved}, delegations, grants{GrantId->{target, keys, grantee, scope}}, outcome?`. Records may hold `__proto__` ids: use `hasOwn`/`getOwn` from `session/records.ts`.
- **Errors** (`errors/`): `Result<T,E=EngineError>`, `ok`, `err`. `EngineError {code, detail, actionIndex?, path?}`; the 24 codes include `UNKNOWN_ROLE`, `UNKNOWN_SUBJECT`, `SUBJECT_NOT_ALLOWED`, `VIEW_DENIED`, `REPLAY_INVALID`, `REPLAY_MISMATCH`. Definition errors (`definition/compile/errors.ts`) are a separate union incl. `RESERVED_NAME`.
- **Ids** are branded strings (`session/ids.ts`): constructors `seatId(v)` etc. return `Result`; `isSeatId` guards.
- **Test builders:** `definition/definition.testing.ts` (`buildDefinition`, `buildFloorDefinition`: 2 seats s1/s2, zones deck/discard/table, templates hand/pile, counters pot/bank/total(derived)); `session/apply/apply.testing.ts` (`must`, `errorOf`, `defaultRoster`, `startState`); `session/state.testing.ts` (`variant`, `cloneData`); `definition/compile/compile.testing.ts` (`doc`, `failure`, `success`, `codePaths`); new `visibility/visibility.testing.ts`.

## File map (Iteration 1 files; Iteration 2 files follow this list)
- `visibility/types.ts` types `ViewerIdentity`, `RoleEntry`, `RoleRegistry`, `BuiltInRole`, `PrivilegedRole`, `SubjectRule`.
- `visibility/roles.ts` `buildRoleRegistry`, `validateViewer`, `isPrivilegedRole` (internal, not re-exported).
- `visibility/policy.ts` `resolveAudience`, `buildVisibilityPolicy`, `isEntitled`, type `VisibilityPolicy`.
- `visibility/visibility.testing.ts` `FOUR_SEAT_ROSTER` (north/east/south/west; teams ns/ew; players pn/pe/ps/pw), `buildRoleDefinition({zoneVisibility, counterVisibility, ...overrides})`, `roleState(def?)`, helpers `seat(v)`, `zone(v)`. This is NOT the trick-taking fixture.
- `visibility/roles.test.ts` (VC-300..303, 305 registry half, PBR-008), `visibility/policy.test.ts` (VC-306..308).
- Changed: `definition/compile/roles.ts` (RESERVED_NAME), `compile/errors.ts` (doc comment), `compile/meta-roles.test.ts` (VC-304 + two assertions flipped from DUPLICATE_ID).

## File map (new in Iteration 2)
- `visibility/make-view.ts`: `VIEW_SECTION_ORDER` (seq, lifecycle, viewer, zones, counters, control, roster, meta, gates, grants, outcome) and `makeView(sections: ViewSections): View`, the ONLY place a `View` is created (Iteration 4 brands it here). Omits undefined `outcome`. `make-delta.ts` is its `Delta` twin.
- `visibility/entitlement.ts`: grant-aware entitlement (Iteration 3, details below). Iterations 5 (delta) and 6 (`wouldReveal`) must reuse it, not reimplement any rule.
- `visibility/project-view.ts`: `projectView(def, state, viewer)`, plus exported helpers `compareIds` (UTF-16 order) and `cloneJson` (JSON deep copy safe for `__proto__`). Per-definition lookups (registry, policy, card types, zone ordered flags, counters sorted) cached in a `WeakMap` keyed by the definition object.
- `visibility/fixtures.testing.ts`: `TRICK_SEATS`, `buildTrickTakingDefinition(overrides?)`, `trickTakingState(def?, extraActions?)` (HANDS OFF: ids and names below are relied on by Iterations 3-7).
- `visibility/project-delta.test.ts` (Iteration 5): VC-325..331, 334 plus roster/meta/lifecycle and union-of-grants checks.
- `visibility/project-view.test.ts`: VC-310..316, 321, 322, 377 (first sentence). `visibility/project-view-grants.test.ts` (Iteration 3): VC-305 (projection), 312 (grants), 317..320, 321 extension; defines `build()` (trick-taking def with viewKeys = the four zone keys, a `scores` meta schema with public/subject/secret fields, `hiddenonly`, a roster reducer for `set_status`).

## Trick-taking fixture (`fixtures.testing.ts`)
- Seats north/east/south/west (roster `FOUR_SEAT_ROSTER`: teams ns = north+south, ew = east+west; players pn/pe/ps/pw); north active; session id `sess-1`.
- Zones: `hand-<seat>` (unordered, `owner` = seat, `{default: hidden, player: owner}`), `trick` and `discard` (ordered, `{default: public}`), `stock` (ordered, `{default: hidden}`); no templates.
- Cards (type `playing`; metadata `suit:"hearts"` public, `own:7` subject, `key:"k-secret"` secret, `extra:"x"` undeclared): `<seat>-1`, `<seat>-2` in each hand, `t1`,`t2` in trick, `d1` in discard, `k1`..`k3` in stock (ordered by id). All start face down; `trickTakingState` flips `t1` and `d1` face up, then applies `extra` actions.
- Counters: `pot` (public, 0), `chips-<seat>` (owner `player`, `ownerId` seat, `{player: owner}`, 100), derived `stock_size` (`{default: public}`, zone_size of `stock`). `conservationGroups: []`. Default `metaSchemas` ("notes") and `viewKeys` from `buildDefinition`.
- A registered auditor needs a `{auditor: ...}` entry: see `withAuditor()` in `project-view.test.ts` (adds `auditor: public` to every hand zone).

## Entitlement composition (Iteration 3)
- `buildEntitlementContext(policy, state, viewer, opts?: {grants?, exclude?}) -> EntitlementContext` is THE composition helper (policy is an explicit first argument). `ctx = {policy, state, viewer, zoneKeys: Map<zone, Set<key>>, cardKeys: Map<card, Set<key>>}`: the grants that apply to this viewer, pre-resolved. `opts.grants` = explicit `Record<GrantId, Grant>` (default `state.grants`; deltas pass the union of pre and post); `opts.exclude` = one grant id to drop (what-if for `wouldReveal`). A grant applies iff `isGrantee` (viewer has a subject in `expandGrantee(state, grantee)`, role not dealer/auditor) and `isGrantInScope` (`until_seq(n)`: `state.seq < n`; unknown scope: not applicable) and `resolveGrantTarget` resolves (card; zone; `top` = `zone.members[0]`, nothing if empty). Keys without meaning for the target are dropped (card/top: `card_face`, `zone_membership`; zone: all four).
- `isStaticallyEntitledToZoneKey` = the Iteration 2 rule (declared audience only, no grants). `isEntitledToZoneKey` = static OR zone-target grant (union; `zone_order` grant counts only together with membership; zone `card_face` grant covers any orientation). `isEntitledToCardKey(ctx, card, 'card_face'|'zone_membership')` = zone rule with the card's orientation OR card-level grant. `isStaticallyEntitledToGrant(ctx, grant)` (PFR-020) uses `withoutGrants(ctx)`.
- `expandGrantee`: seat id -> that seat if declared; `all_seated` -> seats with status `seated`; `team:<id>` -> every seat of the team regardless of status (D-011).
- `GrantView = {target, keys, grantee, scope}` (JSON clones of the stored grant; the id is the record key in `View.grants`). Listed iff grantee (scope ignored, D-013) or statically entitled to every key.
- Zone block: `count` iff count-entitled; whole-zone membership lists all members (zone order if order-entitled and ordered, else by id) with `orderKnown` = order entitlement; otherwise only cards individually entitled (card-level membership or face grant), sorted by id, `orderKnown: false`; zone omitted when neither count nor any member (D-012).

## View shape
`{seq, lifecycle, viewer: {role, subject?}, zones: {[id]: {ordered, owner?, count, members: [{id, orientation, face?: {type?, metadata}}], orderKnown}}, counters: {[id]: decimalString}, control: {phase, turnOrder, activeSeats, direction, pointers}, roster: {[seat]: {status, team?, player?}}, meta: {[schema]: {[field]: JsonValue}}, gates: {open: {[id]: {schemaId, expectedSeats, submitted, submissions?}}, resolved: {[id]: {schemaId, expectedSeats, submissions?}}}, grants: {[id]: GrantView}, outcome?}`. Statically entitled zones carry `count`, `members` and `orderKnown: true` (D-007); grant-derived zones may carry less (above). Records are built in ascending UTF-16 id order via `setOwn`; ordered zones list members in zone order, unordered by id. Face rule: `isEntitledToZoneKey(..., "card_face", orientation)`; metadata field rule in `projectFace`.

## Public interfaces (exported from `@cge/core`)
```ts
interface ViewerIdentity { readonly role: string; readonly subject?: SeatId }
interface RoleEntry { readonly id: string; readonly subject: 'required'|'optional'|'forbidden'; readonly builtIn: boolean }
interface RoleRegistry { readonly roles: readonly RoleEntry[]; readonly registeredPrivileged: readonly ('dealer'|'auditor')[] }
buildRoleRegistry(def: CompiledGameDefinition): RoleRegistry            // deeply frozen
validateViewer(registry, state: Snapshot<SessionState>, viewer): Result<ViewerIdentity>
resolveAudience(rules: VisibilityRules, role: string): Audience | undefined   // default never for dealer/auditor
buildVisibilityPolicy(def): VisibilityPolicy   // frozen; zoneAudience(zone, template|undefined, role), counterAudience(counter, role),
                                               // cardFieldVisibility(card, field), metaFieldVisibility(schemaId, field)
isEntitled(audience: Audience|undefined, owner: string|undefined, viewer, state): boolean
projectView(def, state: Snapshot<SessionState>, viewer: ViewerIdentity): Result<View>
sealBatch(tx: Transaction): PrivilegedBatch                          // exported; openBatch(batch): Transaction and batchSeq(batch): Seq|null are not
isEntitledToZoneKey(ctx: EntitlementContext, zone: ZoneId, key: ZoneKey, orientation?: Orientation): boolean  // grant-aware
buildEntitlementContext, expandGrantee, isGrantee, isGrantInScope, resolveGrantTarget, isEntitledToCardKey, isStaticallyEntitledToZoneKey, isStaticallyEntitledToGrant, withoutGrants  // all exported
```
Order in `validateViewer`: role known -> subject rule (forbidden+subject = SUBJECT_NOT_ALLOWED; required+none = UNKNOWN_SUBJECT) -> subject in `state.roster.seats` (UNKNOWN_SUBJECT) -> privileged registered (VIEW_DENIED).

## Conventions & invariants
- Visibility modules import only from `session`, `definition`, `errors` (and type-only `ports/types`); relative `./x.js`; no `node:*`. Only `visibility/**` and `replay/**` import `open-batch`.
- Fail closed: `undefined` audience never entitles; `owner`/`team` never entitle without a subject; `team` needs a team (D-002).
- `projectView` never shares references with the state (arrays/objects copied, JSON cloned); output is not frozen and has no `undefined` properties.
- Derived counters: declared (non-empty `visibility`) -> governed by it via `counterAudience`; non-empty-check is on the definition, not on the audience lookup (D-008). Undeclared derived without `derivedSpec` is hidden.
- Meta: `subject` field = object whose keys are all roster seats, projected to the viewer's seat entry (auditor: all); empty projection omits the field (D-010). Gate `submitted` follows `expectedSeats` order; own/auditor submissions only (`submissions` omitted when none visible).
- Decisions D-001..D-014 in DECISIONS.md.

## Commands (verbatim, from repo root)
- `pnpm build && pnpm exec vitest run packages/core/src/visibility packages/core/src/definition`
- `pnpm exec vitest run --config vitest.guardrails.config.ts`
- `pnpm lint`, `pnpm typecheck`, `pnpm depcheck`, `pnpm format:check` (fix: `pnpm exec prettier --write <paths>`)
- Full gate (final): `pnpm lint && pnpm format:check && pnpm typecheck && pnpm depcheck && pnpm test:all`

## Known gaps
- `docs/game-definitions.md` (~line 153) and `docs/game-definition-schema.md` (RESERVED_NAME row ~414) still say built-in roles are `DUPLICATE_ID`; fix in Iteration 13.
- Default test definition `viewKeys` is `["hand","public"]`: grant tests must override `viewKeys` with the four zone keys.
- No replay package yet: Iterations 8-13. `readSealedBatch` is internal by convention only (the rule guards `open-batch`).
- A delta carries no content for facts that appear only because a grant was added or a zone/counter became newly entitled without a value change (e.g. `grant_view` of `zone_membership`): the grantee gets the `grants` entry, and the content arrives with the next resync/view. Iteration 7's consistency property (VC-342) must account for it (D-019).
