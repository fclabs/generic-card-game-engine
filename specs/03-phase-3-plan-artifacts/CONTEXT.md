# CONTEXT (Phase 3, after Iteration 1)

## Current state
- Iterations done: 1 (roles, viewer validation, visibility policy, compiler built-in role check). Next: 2 (`projectView` zones/cards/counters/engine sections + the four-seat trick-taking fixture).
- `packages/core/src/visibility` now holds `types.ts`, `roles.ts`, `policy.ts`, `index.ts` (re-exported from `src/index.ts`) and test files. No projector, no `View`/`Delta`, no `PrivilegedBatch` yet. `replay/` is still canonical-only.
- Compiler rejects `roles[].id` in {player, dealer, auditor, render} with `RESERVED_NAME` (PFR-007).
- Repo builds; lint, typecheck, depcheck, format:check green. Local Node is v26 (D-006).

## P1/P2 as-built facts a projector author needs
- **Definition** (`definition/types.ts`, `CompiledGameDefinition`): `roles: RoleDecl[] {id, subject: required|optional|forbidden}`; `zones[] {id, ordered, owner?, visibility}`; `zoneTemplates[] {name, ownerRule: seat|team|player|none, ordered, maxInstances, visibility}`; `counters[] {id, owner, ownerId?, visibility, derived?, derivedSpec?: {kind:'zone_size', zone}}`; `cards[] {id, type?, metadataSchema, startingZone, initialMetadata, metadataVisibility: field -> public|subject|secret}`; `metaSchemas[] {id, fields, fieldVisibility, reducerRef, reducer?}`; `seats[] {id, team?}`; `teams`; `viewKeys`; `control`.
- `VisibilityRules = Record<'default'|roleName, Audience>`, `Audience = public|hidden|owner|team`; `{}` means undeclared. Compiler (DFR-021) only allows role keys that are built-in/custom roles; `owner`/`team` only on owned entities. `GRANTABLE_VIEW_KEYS`/`viewKeys` = grant vocabulary.
- **State** (`session/state.ts`, `SessionState`, always deep-frozen `Snapshot`): `id, lifecycle, seq, cards{id->{zone, orientation: face_up|face_down, metadata}}, zones{id->{template?, owner?: SeatId|TeamId|PlayerId, members}}, zoneOrdinals, counters{id->bigint (stored only)}, meta{schemaId->JsonValue}, roster{seats{seat->{status, player?, team?}}}, control{phase, turnOrder, activeSeats, direction, pointers}, gates{open, resolved}, delegations, grants{GrantId->{target, keys, grantee, scope}}, outcome?`. Records may hold `__proto__` ids: use `hasOwn`/`getOwn` from `session/records.ts`.
- **Errors** (`errors/`): `Result<T,E=EngineError>`, `ok`, `err`. `EngineError {code, detail, actionIndex?, path?}`; the 24 codes include `UNKNOWN_ROLE`, `UNKNOWN_SUBJECT`, `SUBJECT_NOT_ALLOWED`, `VIEW_DENIED`, `REPLAY_INVALID`, `REPLAY_MISMATCH`. Definition errors (`definition/compile/errors.ts`) are a separate union incl. `RESERVED_NAME`.
- **Ids** are branded strings (`session/ids.ts`): constructors `seatId(v)` etc. return `Result`; `isSeatId` guards.
- **Test builders:** `definition/definition.testing.ts` (`buildDefinition`, `buildFloorDefinition`: 2 seats s1/s2, zones deck/discard/table, templates hand/pile, counters pot/bank/total(derived)); `session/apply/apply.testing.ts` (`must`, `errorOf`, `defaultRoster`, `startState`); `session/state.testing.ts` (`variant`, `cloneData`); `definition/compile/compile.testing.ts` (`doc`, `failure`, `success`, `codePaths`); new `visibility/visibility.testing.ts`.

## File map (new this iteration)
- `visibility/types.ts` types `ViewerIdentity`, `RoleEntry`, `RoleRegistry`, `BuiltInRole`, `PrivilegedRole`, `SubjectRule`.
- `visibility/roles.ts` `buildRoleRegistry`, `validateViewer`, `isPrivilegedRole` (internal, not re-exported).
- `visibility/policy.ts` `resolveAudience`, `buildVisibilityPolicy`, `isEntitled`, type `VisibilityPolicy`.
- `visibility/visibility.testing.ts` `FOUR_SEAT_ROSTER` (north/east/south/west; teams ns/ew; players pn/pe/ps/pw), `buildRoleDefinition({zoneVisibility, counterVisibility, ...overrides})`, `roleState(def?)`, helpers `seat(v)`, `zone(v)`. This is NOT the trick-taking fixture.
- `visibility/roles.test.ts` (VC-300..303, 305 registry half, PBR-008), `visibility/policy.test.ts` (VC-306..308).
- Changed: `definition/compile/roles.ts` (RESERVED_NAME), `compile/errors.ts` (doc comment), `compile/meta-roles.test.ts` (VC-304 + two assertions flipped from DUPLICATE_ID).

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
```
Order in `validateViewer`: role known -> subject rule (forbidden+subject = SUBJECT_NOT_ALLOWED; required+none = UNKNOWN_SUBJECT) -> subject in `state.roster.seats` (UNKNOWN_SUBJECT) -> privileged registered (VIEW_DENIED).

## Conventions & invariants
- Visibility modules import only from `session`, `definition`, `errors` (relative `./x.js`); no `node:*`.
- Fail closed: `undefined` audience never entitles; `owner`/`team` never entitle without a subject; `team` needs a team (D-002).
- Decisions D-001..D-006 in DECISIONS.md.

## Commands (verbatim, from repo root)
- `pnpm build && pnpm exec vitest run packages/core/src/visibility packages/core/src/definition`
- `pnpm lint`, `pnpm typecheck`, `pnpm depcheck`, `pnpm format:check` (fix: `pnpm exec prettier --write <paths>`)
- Full gate (final): `pnpm lint && pnpm format:check && pnpm typecheck && pnpm depcheck && pnpm test:all`

## Known gaps
- `docs/game-definitions.md` (~line 153) and `docs/game-definition-schema.md` (RESERVED_NAME row ~414) still say built-in roles are `DUPLICATE_ID`; fix in Iteration 13.
- No `View`, `Delta`, `projectView`, grants, meta/gates handling, `PrivilegedBatch`, replay package: Iterations 2-13.
