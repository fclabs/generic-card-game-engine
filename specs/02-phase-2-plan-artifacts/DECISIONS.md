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

## D-010: Roles, visibility and control error conventions  (Iteration 4)

**Context.** DFR-021/019/022 leave codes open for built-in role clashes, turn-order faults and view-key duplicates.
**Decision.** A custom role named like a built-in, a repeated role, repeated phases/pointers/active seats/turn-order seats/view keys -> `DUPLICATE_ID` at the later occurrence (entity = the value). A turn order that omits a seat -> `INVALID_VALUE` at `control.turn_order` (entity = the seat); an undeclared seat in `turn_order`/`initial_active_seats` -> `UNKNOWN_REFERENCE` at its index. Empty `phases`, `initial_active_seats` or `view_keys` -> `INVALID_VALUE`. A phase/pointer/role id outside the id charset -> `INVALID_VALUE` (DFR-027). `initial_phase` with omitted `phases` must be `main`. Visibility: unknown role key, unknown audience string, `owner`/`team` on an unowned entity -> `INVALID_VISIBILITY` at `...visibility.<key>`, entity = zone/template/counter id (id template for `for_each` items); non-mapping or non-string audience -> `SCHEMA_TYPE`. `ForEachScope.roles` (optional) carries the known role names; `undefined` (roles failed) skips the role-key check.
**Rejected.** `RESERVED_NAME` for built-in roles (spec reserves it for `engine.` schema ids); a new `roles` parameter on every builder.
**Consequences.** Tests pin these; P3 reads `roles`/`visibility` as declared.

## D-011: Meta schema, hook and bundle rules  (Iteration 4)

**Context.** DFR-020/023/024 do not say whether `fields` is required, what an export name is, or where bundle errors go.
**Decision.** `meta_schemas[].fields` is optional (default `{}`); `id` is required; `reducer` absent -> `MISSING_REDUCER` at `...reducer` (entity = schema id). Export names (reducers, roster reducer, every hook name) must match `^[A-Za-z_$][A-Za-z0-9_$]*$` (`INVALID_VALUE`). A hook binding value is a name or a non-empty list. `hooks.module` allows `[A-Za-z0-9_.@-]` segments only. Reaction key validity: regex of DFR-023, then `phase:<p>` against declared phases (`UNKNOWN_REFERENCE`, skipped when control failed). Bundle checks run after all sections, on the raw document's references (`extractReferences`, document order, raw paths): `MISSING_HOOK_MODULE` once at the first reference when `hooks.module` is absent (applies to any reference, not only reducers: a hook cannot resolve without a module); `BUNDLE_MISSING` once (at `hooks.module`, else at the first reference) when no bundle is supplied; with a bundle, one `UNKNOWN_HOOK_EXPORT` per missing reference naming the export. Both of the first two are reported when both apply.
**Rejected.** Per-reference `MISSING_HOOK_MODULE`; running bundle checks inside each section (would need `ctx` everywhere).
**Consequences.** `definitionNeedsBundle` = `hooks.module` key present or any string reference; iteration 8/9 use it and `collectHookReferences` unchanged.

## D-012: Policy defaults vs ceilings  (Iteration 4)

**Context.** DFR-025 defaults `cascade_cap` to 16 and requires it not to exceed `limits.cascadeCapMax`.
**Decision.** An absent `cascade_cap` compiles to 16 without a ceiling check (the ceiling constrains declared values; a ceiling below 16 therefore does not make every game without `cascade_cap` fail). Declared values: outside `[1, 256]` -> `INVALID_VALUE`, above the ceiling -> `LIMIT_EXCEEDED`. Cost budgets: unknown key -> `SCHEMA_UNKNOWN_KEY`, below 1 -> `INVALID_VALUE`, above `costBudgetMax` -> `LIMIT_EXCEEDED`. `ctx.limits` replaces the default wholesale.
**Rejected.** Clamping the default to the ceiling (makes identity depend on limits silently).
**Consequences.** The registry (iteration 9) passes config limits unchanged.

## D-013: Final verification step  (Iteration 4)

**Context.** DFR-010/026: `ok` must imply identity validity and structural validity, and the compiler must not throw.
**Decision.** `finalize.ts#verifyCompiled` runs only when no error was reported: `canonicalize(definitionIdentitySchema, definitionData(value))`; a `CanonicalError` becomes `INVALID_VALUE` at its path inside the compiled value (the `$.` prefix removed, e.g. `cards[3].initialMetadata.x`, not the raw YAML path); then `assertDefinitionStructure` (violation -> `INVALID_VALUE` at `""`). Both are safety nets: the per-section checks already report path-bearing errors earlier.
**Rejected.** Mapping canonical paths back to raw YAML paths (generators make it lossy); running the checks when other errors exist (spurious).
**Consequences.** Every compile pays one canonicalisation; iteration 5 measures it.

## D-014: Tests, fixture and obsolete stub tests  (Iteration 4)

**Context.** VC-210 needs a literal fixture; iteration 3 tests asserted the visibility stub.
**Decision.** The VC-210 fixture is the TS object `FULL_DEFINITION` in `compile/full-definition.testing.ts` (with `FULL_BUNDLE`). The two iteration-3 tests "compiles it to {} (known gap)" in `zones.test.ts` and `counters.test.ts` now assert the compiled rules. VC-228's "`definitionContentHash` does not throw" property uses `canonicalize(definitionIdentitySchema, definitionData(v))` because the hasher arrives in iteration 5; iteration 5 should re-point it to the hasher.
**Rejected.** Committing a `.yaml` fixture now (no YAML parser until iteration 7).
**Consequences.** Iteration 5 updates the VC-228 property.

## D-015: Identity function details  (Iteration 5)

**Context.** DFR-042/043 say exports are "sorted, distinct" and `bundleHash` optional, but not what `hookBundleHash` does with unsorted or repeated input.
**Decision.** `hookBundleHash` sorts (default UTF-16 code-unit order, same as the manifest) and de-duplicates `exports` before hashing, so VC-232's "export order does not matter" holds for any caller. `computeDefinitionId` builds `{contentHash}` and adds the `bundleHash` key only when it is not `undefined` (the `optional` node omits an absent key). Both schemas (`bundleIdentitySchema`, `idIdentitySchema`) are exported from `definition/identity.ts` and not from the package root; the three functions are exported from `core/definition` and the root.
**Rejected.** Throwing on unsorted or duplicate exports (the bundler iteration sorts anyway; hashing must be total); exporting the schemas from the root (not needed by consumers).
**Consequences.** Iteration 8 may pass the manifest list as is; iteration 9 recomputes ids with the same functions.

## D-016: Floor fixture, expected hashes and child-process script placement  (Iteration 5)

**Context.** The plan asks for a floor fixture under `fixtures/`, committed expected values, and a child-process script "under the test directory". `packages/core/**/*.{ts,js,mjs}` except `*.test.ts` is in the determinism lint scope, which forbids `node:fs` and `process`; the perf test needs `performance.now`.
**Decision.** The floor fixture is a JSON document (`fixtures/floor-definition.json`, raw parsed form, 40 counters including 2 derived) read by tests with `readFileSync`; expected hashes are `definition/identity-expected.json`. The child script is a string constant in `identity.test.ts` executed with `node --input-type=module -e` against `dist`. Timing follows `session/floor-performance.test.ts`: strict 250 ms bounds under `/.dockerenv` or `CGE_PERF_STRICT=1`, otherwise a 10x ceiling; the measured medians are printed with `console.info`.
**Rejected.** A `.mjs` helper beside the tests (fails lint); a `.ts` fixture (a JSON file is also what iteration 7 can re-parse as text and is accepted by Prettier); adding lint exemptions.
**Consequences.** Iteration 7 can write the YAML twin of the floor fixture and assert the same `floor` hash from `identity-expected.json`.

## D-017: Registry port shape and test placement  (Iteration 6)

**Context.** DFR-050 gives `RegistryError`/`DefinitionSummary` as plain object types and `resolve` as returning `Promise<Result<CompiledGameDefinition, RegistryError>>`; VC-240 wants a type test and an interface-only emitted module.
**Decision.** Types live in `ports/types.ts` with `readonly` members (repo convention; `readonly` does not change assignability from the spec's literal shapes). The emitted-JS check reads `dist/ports/{index,types}.js` and asserts no `class`/`function` and `export {}`. The registry stub is `inMemoryRegistry` in `ports.testing.ts`.
**Rejected.** Non-readonly members (inconsistent with `ports/types.ts`); a separate `registry.ts` module (one ports file is the P1 layout).
**Consequences.** Iteration 9 implements `DefinitionRegistry` in `packages/config` against these exact types; the emitted-JS test needs a built `dist` (`pnpm test` builds first).

## D-018: Check 6 allowance and fixtures  (Iteration 6)

**Context.** DFR-080 permits `yaml`, `zod`, `esbuild` only in `packages/config/package.json`, exact versions; check 5 unchanged.
**Decision.** Check 6 keeps its `@cge/*`+`workspace:` rule and adds a single exception branch keyed on the exact path `packages/config/package.json` and a constant name list, validated with the same `EXACT_VERSION` regex as check 5. Skeleton purity exempts config via a list of exempt package roots. New tests are table-free temp-repo cases; the VC-274 case is a new depcruise fixture dir rather than an edit of the Phase 0 one.
**Rejected.** Pinning the dependency set to exactly three (allowance only; presence is VC-271, iteration 11/12); allowing the names in devDependencies handling (check 5 untouched).
**Consequences.** Adding a fourth dependency or a range needs a guardrail change and is a spec change.

## D-019: `yaml` version and lockfile change  (Iteration 7)

**Context.** Plan: add the latest stable `yaml` with an exact version (DFR-080, A1).
**Decision.** `yaml@2.9.1` (`npm view yaml version` at execution time), added with `pnpm --filter @cge/config add --save-exact yaml@2.9.1`; `dependencies` of `@cge/config` = `@cge/core` (`workspace:*`) + `yaml` `2.9.1`. `fast-check@4.10.2` was added to config `devDependencies` (same exact version as core/root) because config tests import it and depcruise `no-undeclared-deps` fails otherwise. `pnpm-lock.yaml`: new `packages/config` entries for `yaml`, plus every package's `vitest` snapshot id gained `(yaml@2.9.1)` because vite's optional `yaml` peer now resolves; no build script needed approval.
**Rejected.** A range or `^` (check 6 and DFR-080); hand-written YAML parsing; omitting the fast-check devDependency by relying on root hoisting (depcruise fails).
**Consequences.** `pnpm install --frozen-lockfile` passes. Iterations 8 and 10 add `esbuild`/`zod` the same way.

## D-020: How aliases are counted and bounded  (Iteration 7)

**Context.** DFR-002 limits "alias references" to `maxAliases` (100, inclusive: 100 ok, 101 fails). The library's own `maxAliasCount` is a product (references x nesting weight), not a count, and is applied only in `toJS`.
**Decision.** Two layers. (1) Our AST walk counts every alias node (value and key position) and never follows an alias; the 101st fails `YAML_FORBIDDEN_FEATURE` once (`more than 100 aliases (limit maxAliases)`). (2) Because 100 aliases can still nest into an exponential expansion, `toJS` gets `maxAliasCount = maxAliases * 100` (10 000 by default); the library throws `ReferenceError`, mapped to `YAML_FORBIDDEN_FEATURE` ("alias expansion exceeds the limit"). The 1 KiB nine-level bomb (72 aliases) trips layer 2 in ~2.6 ms with <1 MiB RSS growth. `maxAliases: 0` forbids aliases.
**Rejected.** Using only the library guard (101 flat aliases would pass); disabling the guard (a nested bomb with <= 100 aliases would materialise); deep-cloning shared alias results (would re-introduce expansion cost).
**Consequences.** Documents with deeply nested alias reuse beyond the 10 000 weight fail even under 100 references; acceptable for definitions. Aliased subtrees share one JS object in the result.

## D-021: Forbidden features beyond the list, error positions and paths  (Iteration 7)

**Context.** DFR-004/005 name positions but `DefinitionError` has only `path`/`detail`/`entity`.
**Decision.** Position is appended to `detail` as ` (line L, column C)`; `path` is `""` for size and parser errors and the node path for AST errors (duplicate key: `parent.key`). Multi-document (`MULTIPLE_DOCS`) and `<<` (any key whose string value is `<<`, quoted or not, since merge is off) are `YAML_FORBIDDEN_FEATURE`; a `%YAML` directive other than 1.2, non-finite numbers (`.inf`, `.nan`) and complex/null/bool/number keys are also `YAML_FORBIDDEN_FEATURE` (spec: output is finite numbers only). The scalar document `~`/`42` is accepted (the compiler rejects a non-mapping root). A parser error returns before the AST walk; an AST walk reports all its errors. Pathological nesting that overflows the stack surfaces as `YAML_SYNTAX` (capped at 100 errors) instead of throwing.
**Rejected.** Adding `line`/`column` fields to `DefinitionError` (frozen shape, iteration 2); a nesting-depth rule (not in the spec).
**Consequences.** Config loaders (iterations 9-10) can forward `detail` verbatim; they prefix the file/game dir themselves.

## D-022: Fixture location and exclusion  (Iteration 7)

**Context.** Fixtures must be inert for lint/format/depcruise like `tools/guardrails/fixtures`.
**Decision.** `packages/config/fixtures/` contains only `.yaml` data, which ESLint (`.ts`/`.js` only), `tsc` and depcruise already ignore; `.prettierignore` gains `packages/config/fixtures/**` so Prettier never rewrites deliberately odd YAML (comments, spacing, anchors). No eslint or depcruise config change. The floor YAML twin is generated from the JSON fixture once and committed; 1 MiB documents are built in tests.
**Rejected.** Adding the directory to the eslint/depcruise ignore lists (nothing there to ignore; would hide future `.ts` mistakes).
**Consequences.** A future `.ts`/`.js` file placed in `fixtures/` WOULD be linted and cruised; keep fixtures as data.
