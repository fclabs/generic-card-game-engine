# Decisions: Phase 2 — Game definition and configuration

Append-only. Entry format: `## D-NNN: <title>  (Iteration N)` with Context, Decision, Rejected, Consequences.

## D-001: Identity schema field order and export surface  (Iteration 1)

**Context.** Spec §7.3 says `definitionIdentitySchema` extends the P1 schema "with the fields of §7.2 in the order they are declared there". Field order in an `object` node is the emitted key order, so it is part of the content identity.
**Decision.** New fields are appended at the end of each object node, in §7.2 order: card `initialMetadata, metadataVisibility`; zone `owner, visibility`; template `visibility`; counter `ownerId, visibility, derivedSpec` (replacing the dropped `derived` flag at the end); meta schema `reducerRef, fieldVisibility` (replacing `hasReducer`); top level `gameId, roles, rosterReducerRef` (after `hookBindings`; `hasRosterReducer` removed). The schema is exported from `replay/canonical/definition-schema.ts` only (as `definitionDataSchema` was); no old-name re-export, no package-root export yet.
**Rejected.** Putting `gameId`/`roles` first (reads better, but breaks "extend the P1 schema"); a `definitionDataSchema` alias (only one P1 test imported it, now updated).
**Consequences.** Iteration 5 imports the schema by relative path from `core/definition`. Once any `contentHash` is committed the order is frozen.

## D-002: Unbound vs undeclared reducer dispatch  (Iteration 1)

**Context.** DFR-065 splits two P1 `MALFORMED_ACTION` cases.
**Decision.** `meta`: undeclared `schema_id` -> `MALFORMED_ACTION` (`unregistered meta schema_id: <id>`, path `.schema_id`); declared with no bound `reducer` -> `REDUCER_ERROR` (`reducer not bound: <reducerRef>`, same path). `roster` reducer ops: no function and `rosterReducerRef` present -> `REDUCER_ERROR` (`reducer not bound: <ref>`, path `.op`); no function and no ref -> `MALFORMED_ACTION` (P1 message). Both are decided in `apply/primitives/{meta,roster}.ts` from the definition value.
**Rejected.** A new error code (KFR-002 union is closed).
**Consequences.** P4 binds `reducer`/`rosterReducer` onto the compiled definition; until then every reducer action fails with `REDUCER_ERROR`.

## D-003: initialMetadata type check in assertDefinitionStructure  (Iteration 1)

**Context.** DFR-061 requires key/type conformance but no wording or position.
**Decision.** Checked per card right after the starting-zone checks (so the first-violation order of KFR-101 is unchanged for P1 cases). Rules mirror `set_metadata`: field declared in `metadataSchema` (own key), then `string`/`int` (any JS number)/`bool`/`json` (anything). Messages: `card <id> initialMetadata field <f> is not declared in metadataSchema` and `card <id> initialMetadata field <f> must be of type <t>`. Violations are `MALFORMED_ACTION` like every structural error.
**Rejected.** Integer-only check for `int` (P1 `set_metadata` uses `typeof number`; the compiler, not this check, enforces safe integers).
**Consequences.** Compiler iterations may rely on the check but still report path-bearing errors themselves (DFR-026).

## D-004: Error path and code conventions for the compiler foundation  (Iteration 2)

**Context.** DFR-031 leaves paths and some codes open for the root, seats and for_each cases.
**Decision.** Document root path is `""`; a non-mapping root is `SCHEMA_TYPE` at `""`. Unknown-key errors carry the key's path and no `entity`. Seats: `list`+`count` or neither -> `INVALID_VALUE` at `seats`; `teams` with `count` -> `INVALID_VALUE` at `seats.teams`; `prefix` with `list` -> `INVALID_VALUE` at `seats.prefix` (not stated by the spec); `count: 0` -> `INVALID_VALUE` at `seats.count`, empty `list` at `seats.list`; more than 64 seats (count or list) -> `LIMIT_EXCEEDED` at `seats` (not at `seats.count`), more than 32 teams -> `LIMIT_EXCEEDED` at `seats.teams`; a team without seats -> `INVALID_VALUE` at its `seats.teams[i]` with `entity` = team. Over-limit seat collections are not element-validated. Invalid generated seat ids are reported once, at `seats.prefix`, naming the first bad id (`Seat 1`). `UNSUPPORTED_SCHEMA_VERSION` has no `entity`. Seat and team ids are separate namespaces (matching P1 `assertDefinitionStructure`). All `for_each`/placeholder faults (unmatched brace, unknown name, placeholder without for_each, `for_each: team` with no teams) are `INVALID_VALUE`.
**Rejected.** `SCHEMA_UNKNOWN_KEY` for `prefix` with `list` (it is a known key); reporting every generated seat id.
**Consequences.** Later sections follow the same conventions; tests pin them.

## D-005: Unimplemented sections are known but unread  (Iteration 2)

**Context.** Plan: sections not yet implemented are "accepted as absent".
**Decision.** All 14 top-level keys of §7.1 are accepted (no `SCHEMA_UNKNOWN_KEY`) but a present, not yet implemented section is neither validated nor compiled; its default is used. `UNIMPLEMENTED_SECTIONS` lists them; it shrinks in Iterations 3-4. `compileDefinition` also catches an internal exception and reports it as `INVALID_VALUE` at `""`, to keep the never-throws contract.
**Rejected.** Rejecting present unimplemented sections (would block fixtures written ahead).
**Consequences.** Until Iteration 4 a successful compile does not prove those sections are valid.

## D-006: Codes and paths for zone, card, counter and group errors  (Iteration 3)

**Context.** DFR-031 leaves several entity cases unassigned.
**Decision.** A template named like a fixed zone, or any repeated zone/template/counter/card/group/axis name -> `DUPLICATE_ID` at the later occurrence (`...template` or `...id`). A card metadata field absent from `metadata_schema` -> `INVALID_VALUE` at `...metadata.<f>`; a value of the wrong type -> `SCHEMA_TYPE` (float in `json` -> `SCHEMA_TYPE`; unsafe int, depth > 64, lone surrogate -> `INVALID_VALUE`). A card `zone` that is unknown or names a template -> `UNKNOWN_REFERENCE` at `...zone`, entity = card id. Derived counter declaring `min`/`max`/`initial`/`supply_role` -> `INVALID_VALUE` at that key; `derived` with no `zone_size` and no other fault -> `SCHEMA_MISSING`. `owner_id` missing -> `SCHEMA_MISSING`, forbidden on `table` -> `INVALID_VALUE`. Over-limit: zones/counters `LIMIT_EXCEEDED` at the section path (once, fixed zones only), cards at `cards[i]` (explicit) or `cards[i].generate`; after a card limit hit later entries are not processed. Generated-id faults (charset, duplicate, unknown zone) are reported once per entry and abort it.
**Rejected.** One error per bad generated card (up to 10 000 identical reports); `SCHEMA_UNKNOWN_KEY` for metadata keys (they are user-named).
**Consequences.** Tests pin these; iteration 4 follows them for meta schemas.

## D-007: Generator order and placeholder rules  (Iteration 3)

**Context.** DFR-014 fixes first-axis-slowest and lone-placeholder typing.
**Decision.** Expansion is an odometer over the axis list (last fastest). Placeholders are `{axisName}` only, in `id`, `type`, `zone` and top-level string `metadata` values; nested strings inside `json` values are never substituted. Braces in an explicit (non-generator) card are literal. Metadata types are checked once per entry, statically (lone placeholder vs axis value kinds, mixed template = string). Card `metadataSchema`/`metadataVisibility` are shared objects across one entry's cards.
**Rejected.** Per-card type checks (10 000x work, duplicate errors); substituting inside nested json.
**Consequences.** Iteration 5 may rely on `def.cards` order = declaration order, then expansion order.

## D-008: Skip, do not cascade, dependent sections  (Iteration 3)

**Context.** Zone, counter and group checks reference earlier sections.
**Decision.** A section builder returns `undefined` when it reported errors; dependants receive `undefined` for that reference set and skip those checks. If `seats` failed, `zones`, `counters` and `conservation_groups` (which need the for_each scope) are not validated.
**Rejected.** Validating against partial results (spurious `UNKNOWN_REFERENCE`).
**Consequences.** Fixing seats may reveal more errors; each run reports only real faults of validated sections.

## D-009: Visibility pass-through stub and card field maps  (Iteration 3)

**Context.** Plan: visibility blocks are a stub until iteration 4; DFR-014 needs card `metadata_schema` visibility now.
**Decision.** `compileVisibility(c, raw, path, {kind, entity, owned})` returns `{}` and ignores the block. Card `metadata_schema` is fully validated now through `readFieldMap` (`INVALID_VISIBILITY`), reusable by iteration 4.
**Rejected.** Reading/validating visibility blocks early; deferring field visibility.
**Consequences.** Until iteration 4 a bad zone/counter visibility block compiles silently.
