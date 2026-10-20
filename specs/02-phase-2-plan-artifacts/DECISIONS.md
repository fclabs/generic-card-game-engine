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
