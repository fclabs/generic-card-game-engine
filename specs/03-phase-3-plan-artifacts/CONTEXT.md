# CONTEXT (Phase 3, after Iteration 2)

## Current state
- Iterations done: 1 (roles, viewer validation, policy), 2 (`projectView` for zones, cards, counters, control, roster, outcome; trick-taking fixture). Next: 3 (`projectView` meta, gates, grants).
- `visibility/` now has `types.ts` (adds `View`, `ZoneView`, `CardView`, `GateView`, `GrantView`), `make-view.ts`, `entitlement.ts`, `project-view.ts`, `fixtures.testing.ts`, `project-view.test.ts`. `projectView`, `View` types, `VIEW_SECTION_ORDER`, `isEntitledToZoneKey` are exported from `@cge/core`. No `Delta`, `PrivilegedBatch`, brand, grants or replay package yet.
- `View.meta`, `View.gates.{open,resolved}`, `View.grants` are `{}` placeholders (D-009) until Iteration 3.
- Repo builds; lint, typecheck, depcheck, format:check green. Local Node is v26 (D-006).

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
- `visibility/make-view.ts`: `VIEW_SECTION_ORDER` (seq, lifecycle, viewer, zones, counters, control, roster, meta, gates, grants, outcome) and `makeView(sections: View): View`, the ONLY place a `View` is created (Iteration 4 brands it here). Omits undefined `outcome`.
- `visibility/entitlement.ts`: `ZoneKey`, `EntitlementContext {policy, state, viewer}`, `isEntitledToZoneKey(ctx, zone, key, orientation?)`: static (no grants) entitlement. Iterations 3 (grants) and 5 (delta) must reuse it, not reimplement the rule.
- `visibility/project-view.ts`: `projectView(def, state, viewer)`, plus exported helpers `compareIds` (UTF-16 order) and `cloneJson` (JSON deep copy safe for `__proto__`). Per-definition lookups (registry, policy, card types, zone ordered flags, counters sorted) cached in a `WeakMap` keyed by the definition object.
- `visibility/fixtures.testing.ts`: `TRICK_SEATS`, `buildTrickTakingDefinition(overrides?)`, `trickTakingState(def?, extraActions?)` (HANDS OFF: ids and names below are relied on by Iterations 3-7).
- `visibility/project-view.test.ts`: VC-310..316, 321, 322, 377 (first sentence).

## Trick-taking fixture (`fixtures.testing.ts`)
- Seats north/east/south/west (roster `FOUR_SEAT_ROSTER`: teams ns = north+south, ew = east+west; players pn/pe/ps/pw); north active; session id `sess-1`.
- Zones: `hand-<seat>` (unordered, `owner` = seat, `{default: hidden, player: owner}`), `trick` and `discard` (ordered, `{default: public}`), `stock` (ordered, `{default: hidden}`); no templates.
- Cards (type `playing`; metadata `suit:"hearts"` public, `own:7` subject, `key:"k-secret"` secret, `extra:"x"` undeclared): `<seat>-1`, `<seat>-2` in each hand, `t1`,`t2` in trick, `d1` in discard, `k1`..`k3` in stock (ordered by id). All start face down; `trickTakingState` flips `t1` and `d1` face up, then applies `extra` actions.
- Counters: `pot` (public, 0), `chips-<seat>` (owner `player`, `ownerId` seat, `{player: owner}`, 100), derived `stock_size` (`{default: public}`, zone_size of `stock`). `conservationGroups: []`. Default `metaSchemas` ("notes") and `viewKeys` from `buildDefinition`.
- A registered auditor needs a `{auditor: ...}` entry: see `withAuditor()` in `project-view.test.ts` (adds `auditor: public` to every hand zone).

## View shape
`{seq, lifecycle, viewer: {role, subject?}, zones: {[id]: {ordered, owner?, count, members: [{id, orientation, face?: {type?, metadata}}], orderKnown}}, counters: {[id]: decimalString}, control: {phase, turnOrder, activeSeats, direction, pointers}, roster: {[seat]: {status, team?, player?}}, meta: {}, gates: {open: {}, resolved: {}}, grants: {}, outcome?}`. A zone appears only when membership-entitled; entitled zones always carry `count`, `members` and `orderKnown: true` (D-007). Records are built in ascending UTF-16 id order via `setOwn`; ordered zones list members in zone order, unordered by id. Face rule: `isEntitledToZoneKey(..., "card_face", orientation)`; metadata field rule in `projectFace`.

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
isEntitledToZoneKey(ctx: EntitlementContext, zone: ZoneId, key: ZoneKey, orientation?: Orientation): boolean
```
Order in `validateViewer`: role known -> subject rule (forbidden+subject = SUBJECT_NOT_ALLOWED; required+none = UNKNOWN_SUBJECT) -> subject in `state.roster.seats` (UNKNOWN_SUBJECT) -> privileged registered (VIEW_DENIED).

## Conventions & invariants
- Visibility modules import only from `session`, `definition`, `errors` (relative `./x.js`); no `node:*`.
- Fail closed: `undefined` audience never entitles; `owner`/`team` never entitle without a subject; `team` needs a team (D-002).
- `projectView` never shares references with the state (arrays/objects copied, JSON cloned); output is not frozen and has no `undefined` properties.
- Derived counters: declared (non-empty `visibility`) -> governed by it via `counterAudience`; non-empty-check is on the definition, not on the audience lookup (D-008). Undeclared derived without `derivedSpec` is hidden.
- Decisions D-001..D-009 in DECISIONS.md.

## Commands (verbatim, from repo root)
- `pnpm build && pnpm exec vitest run packages/core/src/visibility packages/core/src/definition`
- `pnpm lint`, `pnpm typecheck`, `pnpm depcheck`, `pnpm format:check` (fix: `pnpm exec prettier --write <paths>`)
- Full gate (final): `pnpm lint && pnpm format:check && pnpm typecheck && pnpm depcheck && pnpm test:all`

## Known gaps
- `docs/game-definitions.md` (~line 153) and `docs/game-definition-schema.md` (RESERVED_NAME row ~414) still say built-in roles are `DUPLICATE_ID`; fix in Iteration 13.
- `View` is a plain structural type, not branded (Iteration 4). Grants are ignored by `isEntitledToZoneKey` and `projectView`; meta/gates/grants sections are empty placeholders (Iteration 3).
- Deferred VC-312 parts (need grants): `zone_membership` grant gives members sorted with `orderKnown: false`; `zone_count` grant alone gives `count` only.
- No `Delta`, `PrivilegedBatch`, replay package: Iterations 4-13.
