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

## D-023: esbuild version  (Iteration 8)

**Context.** DFR-080/A1: exact runtime dependency in `packages/config`; A3: output is deterministic for fixed version, inputs and options.
**Decision.** `esbuild@0.28.2` (`npm view esbuild version` at execution time), `pnpm --filter @cge/config add --save-exact esbuild@0.28.2`; `dependencies` = `@cge/core` `workspace:*`, `esbuild` `0.28.2`, `yaml` `2.9.1`. pnpm 10 needed no build-script allowance (the binary comes from the platform optional package, `@esbuild/darwin-arm64`), so `pnpm-workspace.yaml` is unchanged; `pnpm-lock.yaml` committed.
**Rejected.** A range or `^`; `onlyBuiltDependencies` entry (not needed).
**Consequences.** A version bump can change bundle bytes and hence every `DefinitionId` with a bundle; treat it like a schema change. The Docker image (iteration 11) must install the same platform binary (linux), which `pnpm install --frozen-lockfile` does.

## D-024: Deterministic, path-independent build options  (Iteration 8)

**Context.** DFR-044 requires no minification, no source map, ES2022, no absolute paths or timestamps; DBR-001 forbids build paths from influencing the id.
**Decision.** Options listed in CONTEXT.md. Key points: build with `absWorkingDir = <gameDir>` and a relative entry so esbuild's only path comments are `// hooks.ts`, `// helper.ts` (relative); `write: false` and we write the bytes (no esbuild file I/O, exact control of the manifest); `tsconfigRaw: {}` so no tsconfig.json found above a game (the repo's own tsconfig would otherwise change output); `legalComments: none`, `charset: utf8` (no `\u` escaping drift); `platform: neutral` (no Node assumptions; hook code is later run in a sandbox, P4). Manifest is `JSON.stringify({exports})` + `\n`. Verified by test: copying a game to another directory yields identical `hooks.js`, manifest and hash.
**Rejected.** `outdir` with esbuild writing files; `platform: node` (would allow bare Node builtins imports in hooks); minify (spec); relying on the repo tsconfig; `bundle` output path normalisation by post-processing (not needed).
**Consequences.** A hook importing a file outside its game dir gets a `// ../x.ts` relative comment, still path-independent only if the relative layout is kept. TypeScript type errors are not reported (esbuild transpiles only); `pnpm typecheck` does not cover `games/` hooks until P8a adds them.

## D-025: Reading of "a module with no exports"  (Iteration 8)

**Context.** DFR-044: "a module with no exports (when the YAML references any)" fails `BUNDLE_INVALID`.
**Decision.** `BUNDLE_INVALID` iff `collectHookReferences(raw)` is non-empty and the built module's export list (from the esbuild metafile) is empty. A module without exports is accepted when the YAML has no references (empty manifest). Whether each reference is in the export list is the compiler's job (`UNKNOWN_HOOK_EXPORT`, `BUNDLE_MISSING`), not the builder's. `hooks.module` itself is not "a reference" for this check.
**Rejected.** Failing every empty module; checking each reference name in the builder (duplicates the compiler, and the builder has no compile context).
**Consequences.** Iteration 9 loads `dist/` files, computes the hash again from the bytes and the manifest, and relies on the compiler for name checks.

## D-026: Fixture exclusion, bundle:games interface  (Iteration 8)

**Context.** Fixture games contain `hooks.ts`, which ESLint (type-aware project list) and dependency-cruiser would pick up; plan asks to follow the existing exclusion mechanism.
**Decision.** `packages/config/fixtures/**` added to the ESLint `ignores` and `fixtures` path to the depcruise `exclude` (same two places as `tools/guardrails/fixtures`); Prettier already ignored it (D-022); `tsc` includes only `src`. `bundle:games` takes the games root as the first positional argument (default `./games`), root script `pnpm build && node packages/config/dist/bundle-games.js`, documented in `docs/dev-setup.md`. It continues after a failure and reports every failing game (superset of "the first"). The VC-235 seed is a `.txt` file so no extra exclusion is needed for it.
**Rejected.** An env var override (an argument is enough and explicit); stopping at the first failure; a `.ts` seed (would need lint exclusion and be compiled).
**Consequences.** Games under `games/` (P8a) are linted and cruised normally; only `packages/config/fixtures` is excluded.


## D-027: Perf fixture generated at test time, not committed  (Iteration 9)

**Context.** The plan allows committing `fixtures/perf-20-games/` or generating in `beforeAll`; VC-244 says "committed". Each game needs a built `dist/hooks.js`, and `dist/` is git-ignored (DFR-044 outputs).
**Decision.** `perf-fixture.testing.ts` generates 20 games (and builds their bundles with `buildHookBundle`) into `os.tmpdir()` in `beforeAll`; the directory is removed in `afterAll`. The generator is deterministic; the test asserts 52 cards, 6 zones, 4 counters and a bundle of 4096..6000 bytes.
**Rejected.** Committing 20 dirs (hand-maintained duplicates; the bundles would still need building and are ignored by git); un-ignoring `dist/` for the fixture (inconsistent with the repo rule).
**Consequences.** The VC-244 "committed fixture" wording is met by a committed generator.

## D-028: Registry error-path prefix and identity of sources  (Iteration 9)

**Context.** DFR-051 requires each error to be "prefixed by its game directory" but `DefinitionError` has only `path`/`detail`/`entity`.
**Decision.** Prefix goes into `path`: `<gameDir>` for a root error, else `<gameDir>/<path>`, with `<gameDir>` = `join(searchPath, dirName)`. `GAME_ID_MISMATCH` uses path `id`, `GAME_YAML_MISSING` path `game.yaml`, duplicate id path `<dir>/id` (the later directory is the error). `resolve` caches the raw bytes (`game.yaml`, and bundle js/manifest only if the game used a bundle) and returns the cached definition when they are byte-identical; any difference triggers a full reload and id comparison.
**Rejected.** Prefixing `detail` (breaks the path/detail contract); comparing mtimes (unreliable); hashing instead of storing bytes (bytes are small, comparison is exact).
**Consequences.** Config tooling (`config:check`, iteration 11) prints `<path>: <code>: <detail>` and gets the directory for free. A comment-only edit refreshes the cached bytes.

## D-029: Missing or malformed bundle files at load; manifest dependency  (Iteration 9)

**Context.** DFR-051 reads the bundle only when needed; it does not say what to report when the files are absent or the manifest is malformed.
**Decision.** Absent `dist/hooks.js` or manifest -> no `HookBundleInfo` is passed and the compiler reports `BUNDLE_MISSING` (DFR-024, naming the first reference); a present but malformed manifest -> `BUNDLE_INVALID` at `dist/hooks.manifest.json`, and the compile then also runs without a bundle (so `BUNDLE_MISSING` may follow). The manifest bytes are not hashed, only its export list (as in iteration 8).
**Rejected.** Reporting `BUNDLE_INVALID` for absent files (spec assigns `BUNDLE_MISSING`); re-running esbuild in the registry (writes files, D-024).
**Consequences.** An author who forgot `pnpm bundle:games` gets a path-bearing `BUNDLE_MISSING` per game, aggregated with other games' errors.

## D-030: Contract suite fixture shape  (Iteration 9)

**Context.** DFR-054 asks for a suite parameterised by a factory; the edits (change YAML, flip a bundle byte) are adapter-specific.
**Decision.** The factory returns `{registry, id, expected, edits, dispose}` (see CONTEXT.md); the suite owns assertions, the adapter owns mutation. `bundleByte` is optional. Production tsconfig for `packages/config` now excludes `src/**/*.testing.ts` (as `packages/core` does), `tsconfig.test.json` still type-checks them.
**Rejected.** A suite that edits files itself (not portable); exporting the suite from the package (test-only code in `exports`).
**Consequences.** P14 can move the file to a shared location (OQ-4) without changing its signature.

## D-031: zod version  (Iteration 10)

**Context.** DFR-080/DBR-009: exact runtime dependency in `packages/config`.
**Decision.** `zod@4.6.7` (npm `latest` at execution time, v4 line), `pnpm --filter @cge/config add --save-exact zod@4.6.7`; `dependencies` = `@cge/core` `workspace:*`, `esbuild` `0.28.2`, `yaml` `2.9.1`, `zod` `4.6.7`. Lockfile committed; no build-script allowance needed.
**Rejected.** zod 3 (older line); a range.
**Consequences.** Only `z.strictObject`, `z.array`, `z.custom` and `.optional()/.min()/.refine()` are used; every failure gets our own expectation text (zod's default messages are never shown), so a zod upgrade cannot change error text or leak a value.

## D-032: How provenance is tracked, how errors are built  (Iteration 10)

**Context.** DFR-072: redact the value of anything that came, wholly or partly, from `${ENV}`, and of every secret.
**Decision.** Interpolation runs on the parsed JSON before zod and records `Map<path, {whole}>` for every string that contained a placeholder (path = the same dotted/indexed text used in errors). zod runs on the interpolated copy; each issue's path is looked up: in the map or matching `auth.keys[n].secret` -> value printed as `<redacted>`; otherwise the offending scalar is printed (strings quoted, cut at 40 chars; mappings/lists as "a mapping"/"a list"). Detail format: `expected <expectation>; got <value>`. Missing = the key is absent at the issue path (-> `CONFIG_MISSING`, detail `required key is missing`); `unrecognized_keys` -> one `CONFIG_UNKNOWN_KEY` per key at `<parent>.<key>`. Secret rule (DBR-007) is checked from provenance before zod: a string secret whose provenance is not `whole` -> `CONFIG_INVALID` (value `<redacted>`) and its zod error at that path is dropped.
**Rejected.** Wrapping values in tagged objects before zod (breaks strictness and shapes); redacting only by comparing against env values (misses partial/short cases and could leak by omission).
**Consequences.** ENV errors short-circuit: if any `ENV_MISSING`/`ENV_SYNTAX` exists those are returned alone (no schema errors), because values are unresolved. Errors are capped at 100 by truncation of the ordered list (env/syntax, secret-source, zod issues in document order, cross-field).

## D-033: Placeholder grammar details  (Iteration 10)

**Context.** DFR-071/VC-261 list `${}`, `${1X}`, `${A`, `$${A}` as `ENV_SYNTAX`; a lone `$` is not discussed.
**Decision.** Every `${` must start a well-formed `${NAME}` and must not be directly preceded by `$` (so `$${A}` is a syntax error; there are no escapes). A `$` not followed by `{` is literal. `ENV_SYNTAX` detail gives only the offset, never the string. Names are looked up with `Object.hasOwn(env, NAME)` so `${constructor}`/`${__proto__}` are `ENV_MISSING`. In YAML a flow-mapping value must be quoted (`secret: "${KEY}"`), because `{` inside `{...}` is parsed as flow syntax: write `config/server.yaml` with quoted placeholders.
**Rejected.** Treating `$$` as an escape (spec: no escapes).
**Consequences.** Iteration 11's `server.yaml` must quote placeholders.

## D-034: Duration parsing; cascade default range; search-path distinctness  (Iteration 10)

**Context.** §7.5 durations `^[1-9][0-9]*(ms|s|m|h)$` with ranges; VC-263 requires `cascade_cap.default 300` with `max 256` to be a cross-field error naming both paths, but §7.5 gives `default` the range 1-256.
**Decision.** Durations: regex then `n * unit` ms, accepted iff safe and within the key's range (`idle_ttl` 1s-24h, `timeout` 1ms-60s); `ServerConfig` keeps the YAML key names (`idleTtl`, `timeout`) with the value in ms (documented in CONTEXT). `cascade_cap.default` is range-checked 1-4096 by the schema; the cross-field rules then enforce `default <= max` (naming `limits.cascade_cap.max`) and `default <= 256` (own `expected an integer from 1 to 256`). A `max` lowered below the implicit default 16 is an error at `limits.cascade_cap.default` (detail says "the default value"). Search paths are "absolute" per `node:path` `isAbsolute` and compared after `normalize` without a trailing slash (`/a` and `/a/` are duplicates); the duplicate error is at the later index and names the first. Duplicate key ids: error at the later `auth.keys[i].id`, names the first. Cross-field rules run only when every field passed its own validation.
**Rejected.** Making `default` range 1-256 in the schema (VC-263 case would then not name both paths); clamping `default` to `max`.
**Consequences.** `DefinitionLimits` gets `cascadeCapMax = limits.cascadeCap.max` (up to 4096); the compiler's own per-game range for `policies.cascade_cap` stays 1-256 (DFR-025).

## D-035: Helpers exported with the loader  (Iteration 10)

**Context.** Hand-off asks for how to build `DefinitionLimits` and a redaction helper.
**Decision.** Besides `loadServerConfig`, `@cge/config` exports `definitionLimitsFromConfig(config): DefinitionLimits` (`{cascadeCapMax: limits.cascadeCap.max, costBudgetMax: limits.hook.costBudget}`), `redactServerConfig(config)` (copy with every `auth.keys[].secret` = `<redacted>`, for logging), `REDACTED`, `CONFIG_ERROR_CODES`, `SERVER_CAPABILITIES` and the types `ServerConfig`, `ConfigError`, `ConfigErrorCode`, `ServerStoreConfig`, `ServerAuthKey`, `ServerCapability`, `LogLevel`, `LogFormat`.
**Consequences.** `config:check` and P7 should log only `redactServerConfig(config)`.

## D-036: `config:check` default games directory on a host without `/app/games`  (Iteration 11)

**Context.** DFR-075 defaults to the config's `games.search_paths`; the sample config says `[/app/games]`, which exists only in the image, so `ENGINE_HOST_KEY=... pnpm config:check` on the repo would fail `SEARCH_PATH_MISSING` and the plan's final acceptance step 4 (exit 0, `OK <n> definitions`) could not hold. DFR-052 requires the registry itself to report a missing path.
**Decision.** The registry is unchanged. Only the CLI, when `--games` is absent, drops configured search paths that are not directories (stderr `warning: <path>: SEARCH_PATH_MISSING: ... skipped`); if none remain it checks `./games` (cwd) with a second warning; if `./games` is also absent it passes the configured paths on so the registry reports `SEARCH_PATH_MISSING` (exit 1). `--games` is never softened: a missing `--games` directory is an error.
**Rejected.** Failing on the host (breaks the acceptance test); a `--games games` baked into the root script (user `--games` would add to it); mapping `/app/games` to a repo path.
**Consequences.** In Docker `/app/games` always exists, so nothing is skipped there. On a host, an operator typo in `search_paths` is only a warning in `config:check` (the P7 server still fails at start). Warnings go to stderr and do not affect the exit code.

## D-037: CLI structure, exit codes, output  (Iteration 11)

**Context.** DFR-075 names only exit 0 and 1; `process.env` may be read only in the CLI entry.
**Decision.** `packages/config/src/cli.ts` (entry, compiled to `dist/cli.js`) is the only file reading `process.env`; the logic is `runConfigCheck(argv, env)` in `config-check.ts` returning `{exitCode, stdout, stderr}` (not exported from the package root). Exit 0 ok, 1 any validation error (including an unreadable `--server` file, reported as `<path>: CONFIG_MISSING: cannot read ...`), 2 bad command line (unknown flag, `--server` without a value, `--games` without a directory; prints usage). Error line = `<path>: <code>: <detail>`; a root-level error (`path ""`) uses the server file path. Config errors use the key path (`auth.keys[0].secret`), registry errors the game-directory-prefixed path (iteration 9). `--games a b c` takes every following non-flag token; `--games` directories are resolved against cwd. Default server path is `config/server.yaml` relative to cwd. Nothing from `ServerConfig` is printed on success.
**Rejected.** Exit 1 for usage errors (indistinguishable from validation failure); a new `ConfigErrorCode` for unreadable files (closed union fixed by §7.5).
**Consequences.** The root script is `pnpm build && node packages/config/dist/cli.js`; extra pnpm args are appended.

## D-038: Docker game staging; `config/.gitkeep` removed  (Iteration 11)

**Context.** DFR-081: `/app/games` holds each game's `game.yaml` and `dist/` and exists with no games; `.dockerignore` excludes `**/dist`, so host bundles never enter the context.
**Decision.** In the `build` stage a second `RUN pnpm bundle:games && mkdir -p /out/games && for d in games/*/ ...` builds bundles inside the image and stages only `game.yaml` and `dist/` per game under `/out/games`; the `runtime` stage does `COPY --from=build /out/games /app/games` before the read-only `chown/chmod` step. `.dockerignore` is unchanged. `config/.gitkeep` is removed (the directory now holds `server.yaml`; nothing referenced it). The `test` stage inherits the extra build step harmlessly.
**Rejected.** `COPY --from=build /app/games` (would ship `hooks.ts` sources); editing `.dockerignore`; running `bundle:games` in the runtime stage (needs esbuild and sources).
**Consequences.** Verified with a throwaway game: only `game.yaml`, `dist/hooks.js`, `dist/hooks.manifest.json` reach the image.
