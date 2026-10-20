# Spec: Phase 2 — Game definition and configuration

**Version:** 0.2 · **Status:** Ready · **Last updated:** 2026-10-20
**Source plan:** `docs/implementation_plan.md` §Phase 2 · **Design:** `docs/design.md` §2.1 · **Architecture:** `docs/architecture.md` A3, A8
**Builds on:** `specs/00-phase-0-frozen.md` (workspace, guardrails, Docker `test` target) and `specs/01-phase-1-frozen.md` (shipped, frozen kernel capsule: `CompiledGameDefinition` data types, canonical JSON profile v1; the as-built `packages/core` is the contract). Phase 1 requirement, rule and VC numbers cited below (KFR/KBR/VC-0xx–1xx) refer to the original `specs/01-phase-1.md` at commit `3bbdd4a` (`git show 3bbdd4a:specs/01-phase-1.md`), which the frozen capsule replaced

**ID scheme.** Requirement IDs from `docs/requirements.md` are cited as `Req FR-nnn` / `Req NFR-nnn`. Phase 1 IDs are cited as `KFR-nnn` / `KBR-nnn` / `VC-0nn`–`VC-1nn` (per the child-spec rule they are never renumbered). This spec's own IDs are `DFR-nnn` (functional), `DBR-nnn` (business rule), `DNFR-nnn` (non-functional) and `VC-2nn` (verification), so they never collide with Phase 0 (`FR-0xx`) or Phase 1.

---

## 1. Purpose

Phase 2 turns a game author's declarative `game.yaml` into a **validated, compiled, content-addressed definition** that the Phase 1 kernel can run, and loads the **server configuration** safely. Today the kernel only accepts `CompiledGameDefinition` values built in code by tests. After this phase a directory `games/<id>/` (YAML plus an optional hook bundle) becomes a `CompiledGameDefinition` with a stable `DefinitionId`, resolvable through a `DefinitionRegistry` port. A malformed definition or a misconfigured server fails at load with an error that names the exact path and entity, not at the first move of a live game.

The beneficiaries are the engineers and AI agents implementing P3–P9 (visibility compiles from the declarations parsed here; hooks load from the bundle hashed here; the server wires the registry and config), and the game authors who write YAML. Two things must be right now because they are expensive to change later: the **content identity** (every replay package binds to a `DefinitionId`; if it fails to cover something replay depends on, replays silently diverge) and the **YAML safety and strictness** rules (a definition is untrusted text: no code execution, no silent typos, no resource blow-ups).

## 2. Scope

### In

- `game.yaml` schema v1 (§7.1) and a **pure compiler** in `packages/core/src/definition` from a parsed JSON-compatible value to `CompiledGameDefinition`: cards and card generators, fixed zones and zone templates, counters (bounds, scale/rounding, `supply_role`, a minimal declarative derived-counter form), conservation groups, seats/teams, control, `meta` schemas with per-field visibility, roster reducer reference, roles and visibility declarations, grantable view keys, policies and the hook binding table.
- Load-time validation with precise, path-bearing errors for every rule in §4.3 (design §2.1 invariants), collecting all errors rather than stopping at the first.
- **Safe YAML parsing** in `packages/config`: YAML 1.2 core schema, size limit, alias limit, duplicate-key error, no tags, no merge keys, one document.
- **Content identity**: `contentHash` over the canonicalised compiled definition data, `bundleHash` over the built hook bundle, and `DefinitionId = sha256:<hex>` derived from both (§7.3).
- **Hook-bundle packaging and hashing**: a deterministic build of `games/<id>/hooks.ts` into `games/<id>/dist/hooks.js` plus `dist/hooks.manifest.json` (export list), and verification of every reducer/hook reference in the YAML against that export list. The bundle is **built and hashed, never executed** in this phase.
- The `DefinitionRegistry` port in `core/ports` and its **filesystem adapter** (in `packages/config`), plus a registry contract test suite (successful resolve, unknown id, content-hash mismatch).
- **Server configuration**: `config/server.yaml` schema validated with `zod`, `${ENV}` interpolation, fail-fast, unknown keys rejected; the sample `config/server.yaml` the compose `engine` service already mounts; a `config:check` command.
- The Phase 1 type adjustments the compiler needs (§4.6, listed exhaustively), each with a regression test.
- Docs: `docs/game-definition-schema.md`, `docs/server-config.md`, updates to `docs/dev-setup.md`, `docs/workspace-architecture.md` and `docs/canonical-json-profile.md`.

### Out (explicitly)

- **Visibility semantics.** This phase parses, validates and stores visibility declarations; compiling them into `VisibilityPolicy`/`RoleRegistry`, the `Projector`, the meaning of `owner`/`team` audiences and the decision about spectator-style custom roles (Q15) are **P3**. P2 only guarantees the declarations are well-formed and reference real roles and entities.
- **Hook execution.** Loading the bundle as a module, running hooks, timeouts, cost-budget enforcement, binding reducer functions to the compiled definition, and verifying at load time that the executed module's exports equal the manifest: **P4**.
- Gate quorum, `timeout_policy` and gate rules in `policies` (Req FR-164–FR-167; already out of P1); `carry_over` seed data (Req FR-184); deterministic setup parameters in the definition (they belong to the P6 setup event, as in P1 KFR-010).
- Derived counters beyond `zone_size` over a fixed zone (Req FR-125 is *Should*); richer expressions need hook-style code and arrive with the P4 helpers if at all.
- Schema upgrader chain and the policy for old `action_schema_version`s (Q8): **P3**. P2 only validates `action_schema_version` against the set of versions this build supports (`{1}`).
- Definition registry *service*, remote bundles, pin-while-referenced, signed bundles: **P14**. Hot reload: the registry is built once at start-up.
- `/healthz`, `/readyz`, the server process, Fastify/zod-to-JSON-Schema at the edge: **P7**. P2 delivers the config loader and checker only; "refuses to start" means the loader returns an error and `config:check` exits non-zero, and P7's server turns that into process exit.
- Any game under `games/` (P8a). Fixtures for tests live under `packages/config/fixtures/`.
- New workspace members. All work lands in the existing `packages/core` and `packages/config`.

## 3. Actors

| Actor | Description | Permissions |
|-------|-------------|-------------|
| Game author | Writes `games/<id>/game.yaml` and `hooks.ts` | Declares content only. Cannot change compiler semantics; every mistake is reported with a path. |
| Operator | Writes `config/server.yaml`, sets env vars, runs the image | Chooses ports, keys, store, search paths; may lower but never exceed engine ceilings (DBR-007). Secrets only via `${ENV}`. |
| Definition consumer (P3, P4, P6, P7 code) | In-repo code calling `compileDefinition`, `DefinitionRegistry.resolve`, `loadServerConfig` | Public package exports only; no access to internals (Phase 0 `exports`). |
| CI / guardrails | Phase 0 lint, typecheck, depcheck, Docker `test` | Must stay green; the guardrail changes of DFR-070 are the only permitted ones. |

## 4. Functional Requirements

Priorities use MoSCoW. A *Must* is required for the phase exit criteria.

### 4.1 Safe YAML intake (`packages/config`)

`parseYaml(text, opts?) → Result<JsonValue, DefinitionError[]>` (§7.4). Defaults: `maxBytes = 1_048_576`, `maxAliases = 100`.

| ID | Pri | Requirement |
|----|-----|-------------|
| DFR-001 | Must | **Given** valid YAML text, **when** `parseYaml` runs, **then** it parses with the YAML **1.2 core schema** (so `yes`, `no`, `on`, `off` are strings, not booleans), resolves anchors and aliases, and returns only `null`, booleans, strings, finite numbers, arrays and plain objects. Numbers are returned as `number`; every typed validator rejects a non-integer or unsafe integer where an integer is required (DFR-015) and a float anywhere inside a `json` value (DFR-010); nothing is a `Date`, `Map`, `Set` or `bigint`. |
| DFR-002 | Must | **Given** text whose UTF-8 size exceeds `maxBytes`, **when** parsed, **then** it fails `YAML_TOO_LARGE` before any parsing. **Given** a document with more than `maxAliases` alias references, **then** it fails `YAML_FORBIDDEN_FEATURE` naming the limit. |
| DFR-003 | Must | **Given** a mapping that repeats a key at any depth (including via anchor-expanded content), **when** parsed, **then** it fails `YAML_DUPLICATE_KEY` naming the key and its line and column. |
| DFR-004 | Must | **Given** a document containing an explicit tag (`!!str`, `!custom`), a merge key (`<<`), a non-string mapping key (e.g. `1:`), the key `__proto__`, more than one document or no content, **when** parsed, **then** it fails `YAML_FORBIDDEN_FEATURE` naming the feature and position. |
| DFR-005 | Must | **Given** text that is not valid YAML, **when** parsed, **then** it fails `YAML_SYNTAX` with line and column. `parseYaml` never throws for any string input and never reads files, the network or the environment. |

### 4.2 Schema and compilation (`packages/core`)

`compileDefinition(raw, ctx) → CompileResult` is synchronous and pure (§7.4). `raw` is the output of `parseYaml`; `ctx` carries the optional `HookBundleInfo` and `DefinitionLimits`. The full key list, types, ranges and defaults are in §7.1; the rows below state behaviour.

| ID | Pri | Requirement |
|----|-----|-------------|
| DFR-010 | Must | **Given** any `raw` value, **when** `compileDefinition` runs, **then** it never throws and returns either `{ok:true, value}` or `{ok:false, errors, truncated}`. Errors are collected in document order of the sections listed in §7.1 (at most 100; `truncated` is `true` when more existed). Every error has a stable `code`, a `path` (e.g. `zones[2].id`, `cards[0].generate.zone`), a `detail` and, where one exists, the offending `entity` id. An unknown key at any level yields `SCHEMA_UNKNOWN_KEY`, a value of the wrong type `SCHEMA_TYPE`, an absent required key `SCHEMA_MISSING`. **`ok` implies identity can be computed:** before returning `ok`, the compiler validates the complete identity data against `definitionIdentitySchema` (profile v1: no floats, no value nested deeper than the canonical depth limit of 64, no lone surrogates, only safe integers inside `json` values) and reports violations as path-bearing `INVALID_VALUE`; consequently `definitionContentHash` never throws for a value `compileDefinition` returned. |
| DFR-011 | Must | **Given** `id` and `action_schema_version`, **when** compiled, **then** `id` (`gameId`) must match `^[a-z0-9][a-z0-9_-]{0,63}$` and `action_schema_version` must be an integer in `SUPPORTED_ACTION_SCHEMA_VERSIONS` (`{1}`), otherwise `INVALID_VALUE` / `UNSUPPORTED_SCHEMA_VERSION`. The compiled `schemaVersion` is that integer. |
| DFR-012 | Must | **Given** `seats`, **when** compiled, **then** exactly one of `list` (explicit `{id, team?}` entries plus an optional `teams` list) or `count` (+ optional `prefix`, default `seat`, producing `seat1…seatN`) is accepted. Seat order is declaration order. The generated `prefix` and every explicit seat and team id must satisfy DFR-027. A `team` naming an undeclared team, a declared team with no seat, a duplicate seat or team id, `teams` together with `count`, fewer than 1 or more than 64 seats, or more than 32 teams yields the matching error. |
| DFR-013 | Must | **Given** `zones`, **when** compiled, **then** each entry is either a **fixed zone** `{id, ordering, owner_id?, for_each?, visibility?}` or a **template** `{template, owner, ordering, max_instances, visibility?}`. `ordering` is `ordered` or `unordered` and is required. `owner_id` must name a declared seat or team. A template `owner` is one of `seat`, `team`, `player`, `none`; `max_instances` is an integer in `[1, 256]`; a template name contains no `/` and is at most 48 characters; template names and fixed zone ids are unique within their kind and a template name never equals a fixed zone id. At most 1 000 zones after expansion. |
| DFR-014 | Must | **Given** `cards`, **when** compiled, **then** each entry is either an **explicit card** `{id, type?, zone, metadata?, metadata_schema?}` or a **generator** `{generate: {axes, id, type?, zone, metadata?, metadata_schema?}}`. `axes` is an **ordered list** of `{name, values}` items (a YAML sequence, so order is explicit and independent of mapping-key order). A generator expands to the cartesian product of its axes in list order, **first axis varying slowest**, substituting `{axisName}` in `id`, `type`, `zone` and string `metadata` values; a metadata value that is exactly one placeholder keeps the axis value's type (string or integer). An axis `values` is a non-empty list of strings/safe integers or `{range: [lo, hi]}` (safe integers, `lo ≤ hi`); axis `name`s are distinct and match `^[a-z][a-z0-9_]*$`. A metadata value declared `json` must be a JSON value without floats (DFR-010). Card order in the compiled definition is the expanded order (it is the initial zone order, so it is semantic). More than 10 000 expanded cards, an unknown axis in a placeholder, an unmatched brace, a `zone` that is not a declared fixed zone, a metadata field absent from `metadata_schema`, or a metadata value whose type differs from its declared type yields the matching error. |
| DFR-015 | Must | **Given** `counters`, **when** compiled, **then** each entry is `{id, owner, owner_id?, min, max?, initial, scale?, rounding?, supply_role?, derived?, visibility?, for_each?}`. `owner` is `table`, `player`, `team`, `zone` or `card`; `owner_id` is forbidden for `table` and required otherwise (a seat id for `player`, a team id, a fixed zone id, a card id). Integer values are YAML integers that satisfy `Number.isSafeInteger`, or decimal strings (`"123456789012345678901234567890"`, required beyond the safe range), and compile to `bigint`; an unsafe integer literal (e.g. `9007199254740993`, already corrupted by parsing) is `INVALID_VALUE`; floats are `SCHEMA_TYPE`. A stored counter requires `min` and `initial`, with `min ≤ initial ≤ max`. `scale` is an integer in `[0, 18]`; `rounding` is `floor`, `half_up` or `half_even`; `supply_role` is `mint` or `burn`. At most 5 000 counters after expansion. |
| DFR-016 | Must | **Given** a counter with `derived: {zone_size: <zone id>}`, **when** compiled, **then** the counter is a derived counter: it must not declare `min`, `max`, `initial` or `supply_role`; `owner` defaults to `table`; the zone must be a declared fixed zone; the compiled definition carries `derivedSpec = {kind: 'zone_size', zone}`, the placeholders `min: 0n` and `initial: 0n` (required by the P1 `CounterDecl` shape, never read for a derived counter; no `max`, no `supplyRole`) and an evaluator that returns the zone's current member count as `bigint` (§4.6, DFR-063). Any other `derived` shape yields `SCHEMA_UNKNOWN_KEY`/`SCHEMA_TYPE`. |
| DFR-017 | Must | **Given** `conservation_groups`, **when** compiled, **then** each `{id, counters}` lists counter ids, literally or via `{expand: "<pattern>", for_each: seat|team}`; every id must name a stored (non-derived) counter, ids within a group are distinct and group ids are unique. An unknown or derived counter yields `UNKNOWN_REFERENCE` naming it. |
| DFR-018 | Must | **Given** `for_each: seat` (or `team`) on a zone, counter or `expand` item, **when** compiled, **then** the item is instantiated once per declared seat (team) in declaration order, replacing `{seat}` (`{team}`) in `id`, `owner_id` and `expand`. A placeholder without a matching `for_each`, or `for_each: team` in a game with no teams, yields an error. Expanded ids are checked for uniqueness like any other id. |
| DFR-019 | Must | **Given** `control`, **when** compiled, **then** the defaults of §7.1 apply (`phases: [main]` and `initial_phase: main` when `phases` is omitted — when `phases` is given, `initial_phase` is required —, `turn_order` = seat declaration order, `initial_active_seats` = first seat of the turn order, no pointers, `enforce_active_seats: false`, no out-of-turn kinds). `turn_order` must be a permutation of the declared seats, `initial_phase` a member of `phases`, `initial_active_seats` a non-empty list of distinct declared seats, `pointers` distinct names. More than 64 phases yields `LIMIT_EXCEEDED`. |
| DFR-020 | Must | **Given** `meta_schemas`, **when** compiled, **then** each `{id, reducer, fields}` requires a `reducer` (an export name) and every field declares `{type, visibility}` with `type ∈ {string, int, bool, json}` and `visibility ∈ {public, subject, secret}` (Req FR-140). `id` must not begin with `engine.` (`RESERVED_NAME`) and is unique. A missing `reducer` yields `MISSING_REDUCER`, a missing field `visibility` `INVALID_VISIBILITY`, both naming the schema (and field). An optional top-level `roster_reducer` names an export. Card `metadata_schema` fields require the same `{type, visibility}`. |
| DFR-021 | Must | **Given** `roles` and `visibility`, **when** compiled, **then** `roles` is a list of custom roles `{id, subject}` with `subject ∈ {required, optional, forbidden}`, whose ids differ from the built-ins `player`, `dealer`, `auditor`, `render` and from each other. A `visibility` block on a zone, template or counter is a map whose keys are `default` or a known role (built-in or declared) and whose values are `public`, `hidden`, `owner` or `team`. An unknown role key, an unknown audience, or `owner`/`team` on an unowned entity (a fixed zone without `owner_id`, a template with `owner: none`, a `table` counter) yields `INVALID_VISIBILITY` naming the entity. An absent block compiles to `{}` (no declaration; P3 applies fail-closed defaults). |
| DFR-022 | Must | **Given** `view_keys`, **when** compiled, **then** it is a non-empty list of distinct members of `GRANTABLE_VIEW_KEYS` (`card_face`, `zone_membership`, `zone_count`, `zone_order`); absent, it defaults to all four. The compiled `viewKeys` is that list. |
| DFR-023 | Must | **Given** `hooks: {module?, validation?, reaction?, gate_resolve?, authorization?}`, **when** compiled, **then** each binding value is an export name or a list of export names (normalised to a list; list order is registration order). The compiled `hookBindings` has keys `validation:<kind>`, `reaction:<key>`, `gate_resolve:<schema_id>` and `authorization:default`. A `reaction` key must match `^(kind|phase|trigger):[A-Za-z0-9_.:-]+$`, and a `phase:<p>` key must name a declared phase (`UNKNOWN_REFERENCE`). `module` is a relative path starting `./`, without `..` segments, ending `.ts` or `.js`; it is a build input and is **not** part of the compiled data. |
| DFR-024 | Must | **Given** any reducer reference, hook reference or `hooks.module`, **when** compiled with a `HookBundleInfo`, **then** every referenced export name must be in `bundle.exports` (else `UNKNOWN_HOOK_EXPORT` naming the export); **when** compiled without a bundle while any reference or `hooks.module` exists, **then** it fails `BUNDLE_MISSING`; a reducer reference without `hooks.module` fails `MISSING_HOOK_MODULE`. A definition with no reference and no `hooks.module` needs no bundle. |
| DFR-025 | Must | **Given** `policies: {cascade_cap?, cost_budgets?}`, **when** compiled, **then** `cascade_cap` is an integer in `[1, 256]` defaulting to 16 and must not exceed `ctx.limits.cascadeCapMax`; `cost_budgets` keys are `validation`, `reaction`, `gate_resolve`, `authorization` with positive integer values not exceeding `ctx.limits.costBudgetMax` when that is set (`LIMIT_EXCEEDED` otherwise). Absent budgets compile to `{}`. |
| DFR-026 | Must | **Given** a successful compile, **when** the value is used, **then** it satisfies `assertDefinitionStructure` (unbound form, DFR-065) and `createSession(def, id, roster)` succeeds for a roster built from its seat layout. The compiler also reports, as `DUPLICATE_ID` naming the id, duplicate card ids, duplicate zone/counter/seat/team ids and duplicate role/schema/phase names rather than relying on the later structural assertion. |
| DFR-027 | Must | **Given** any compiled id (card, zone, template, counter, seat, team, role, meta schema, phase, pointer, conservation group), **when** compiled — after `for_each`/generator expansion and `prefix` generation — **then** it matches the P1 id charset `^[A-Za-z0-9_.:/-]{1,128}$` (template names additionally DFR-013), otherwise `INVALID_VALUE` naming the entity and the path of the generator or `prefix` that produced it. |

### 4.3 Load-time error vocabulary

| ID | Pri | Requirement |
|----|-----|-------------|
| DFR-030 | Must | **Given** any definition failure, **when** it is reported, **then** `DefinitionError.code` is one member of the exported union `YAML_SYNTAX`, `YAML_TOO_LARGE`, `YAML_DUPLICATE_KEY`, `YAML_FORBIDDEN_FEATURE`, `SCHEMA_UNKNOWN_KEY`, `SCHEMA_TYPE`, `SCHEMA_MISSING`, `INVALID_VALUE`, `DUPLICATE_ID`, `UNKNOWN_REFERENCE`, `INVALID_VISIBILITY`, `RESERVED_NAME`, `MISSING_REDUCER`, `MISSING_HOOK_MODULE`, `UNKNOWN_HOOK_EXPORT`, `BUNDLE_MISSING`, `BUNDLE_INVALID`, `UNSUPPORTED_SCHEMA_VERSION`, `LIMIT_EXCEEDED`, `GAME_YAML_MISSING`, `GAME_ID_MISMATCH`, `SEARCH_PATH_MISSING`, and the exported runtime list equals that set. These are load-time errors and are **not** `EngineError` codes (the closed union of KFR-002 is unchanged). |
| DFR-031 | Must | **Given** a compile failure, **when** it is reported, **then** the code is assigned by this table (`path` is the path of the offending node unless stated). Unknown key → `SCHEMA_UNKNOWN_KEY`; wrong type (including a float where an integer is required) → `SCHEMA_TYPE`; absent required key → `SCHEMA_MISSING`; out-of-range number, unknown enum value, bad charset or length, malformed placeholder, unsafe integer, `lo > hi`, zero seats, a `list`/`count` mix, a team without seats, canonical-profile violation → `INVALID_VALUE`; a collection above a structural limit (seats > 64 at `seats`, teams > 32, zones > 1 000, cards > 10 000, counters > 5 000, phases > 64, or a policy above its ceiling) → `LIMIT_EXCEEDED`; the same id twice in one namespace → `DUPLICATE_ID` at the second occurrence, naming the id; a reference to an undeclared seat, team, zone, counter, phase or role → `UNKNOWN_REFERENCE` at the referencing path, naming the target; a bad role/audience/field visibility → `INVALID_VISIBILITY`; an `engine.` schema id → `RESERVED_NAME`; the remaining codes as in DFR-020, DFR-024 and DFR-011. |

### 4.4 Content identity and hook bundles

| ID | Pri | Requirement |
|----|-----|-------------|
| DFR-040 | Must | **Given** a compiled definition, **when** `definitionContentHash(def)` is called, **then** it returns the lower-case hex SHA-256 of `canonicalize(definitionIdentitySchema, definitionData(def))` (profile v1, §7.3). The identity data contains every compiled field, including card order, seat order, hook-binding order, visibility declarations, reducer references, derived specs and `gameId`, and no function. It never contains the YAML text, comments, key order of YAML mappings or `hooks.module`. It carries no function-presence flag (DFR-066), so binding reducer functions in P4 never changes it. |
| DFR-041 | Must | **Given** two YAML documents that differ only in anchors/aliases, mapping key order, comments, whitespace, or in an explicit value equal to the documented default, **when** both compile, **then** they have the same `contentHash`. **Given** a change to any semantic field (a card's zone, card order, a counter bound, a seat's team, a hook-binding list order, a visibility audience, a policy value, `gameId`), **then** the `contentHash` differs. |
| DFR-042 | Must | **Given** a hook bundle (the bytes of `dist/hooks.js` and the sorted, distinct export names of `dist/hooks.manifest.json`), **when** `hookBundleHash(jsBytes, exports)` is called, **then** it returns the lower-case hex SHA-256 of `canonicalize(bundleIdentitySchema, {js: sha256Hex(jsBytes), exports})`, where `bundleIdentitySchema = object([[js, string], [exports, array(string)]])`. One changed byte in `hooks.js`, or an added, removed or renamed export, changes it. |
| DFR-043 | Must | **Given** a `contentHash` and an optional `bundleHash`, **when** `computeDefinitionId(contentHash, bundleHash?)` is called, **then** it returns `sha256:` followed by the lower-case hex SHA-256 of `canonicalize(idIdentitySchema, {contentHash, bundleHash?})`, where `idIdentitySchema = object([[contentHash, string], [bundleHash, optional(string)]])`; a definition with no bundle and one with a bundle never share an id, even if the bundle is empty. The P1 validator `definitionId(unknown)` in `core/session` is unchanged; the new function has a different name so the package-root `export *` from `session` and `definition` has no duplicate export. The result is `sha256:` + 64 lower-case hex characters (71 characters) and passes `isDefinitionId` (P1 §6.1 charset). |
| DFR-047 | Must | **Given** a game, **when** the loader decides whether it needs a hook bundle, **then** the pure function `definitionNeedsBundle(raw): boolean` (core) returns `true` iff `hooks.module` is set or any reducer or hook reference exists, and `false` otherwise. A game that does not need a bundle is compiled and identified **without** one (`computeDefinitionId(contentHash)`); any `dist/` content beside it is ignored and cannot change its id. |
| DFR-044 | Must | **Given** a game directory with `hooks.module`, **when** `buildHookBundle(gameDir)` runs, **then** it writes `dist/hooks.js` (one self-contained ESM file: all imports inlined, no minification, no source map, target ES2022, no absolute paths or timestamps embedded) and `dist/hooks.manifest.json` (`{"exports": [sorted names]}`), and two builds from identical sources with the same toolchain produce byte-identical files. A missing module, a build error or a module with no exports (when the YAML references any) fails `BUNDLE_INVALID` with the build message. |
| DFR-045 | Must | **Given** `compileDefinition`, `parseYaml`, `buildHookBundle` and the registry, **when** they handle a hook bundle, **then** none of them executes it: no `import()`, `require`, `eval`, `new Function` or `vm` use targets bundle content anywhere in `packages/core/src/definition` or `packages/config/src` (execution is P4). |
| DFR-046 | Should | **Given** a root script `bundle:games`, **when** run, **then** it builds the hook bundle of every `games/*/` directory that declares `hooks.module`, and exits non-zero naming the first failing game. |

### 4.5 Registry port and filesystem adapter

| ID | Pri | Requirement |
|----|-----|-------------|
| DFR-050 | Must | **Given** `core/ports`, **when** imported, **then** it exports interface-only `DefinitionRegistry { resolve(id: DefinitionId): Promise<Result<CompiledGameDefinition, RegistryError>> }`, `RegistryError = {code: 'UNKNOWN_DEFINITION' \| 'DEFINITION_HASH_MISMATCH' \| 'DEFINITION_INVALID'; detail: string}` and `DefinitionSummary = {definitionId, gameId, schemaVersion}`. No class and no runtime value beyond constants. The `DefinitionId` branded type already exists (P1). |
| DFR-051 | Must | **Given** options `{searchPaths, limits}`, **when** `createFilesystemDefinitionRegistry(opts)` runs, **then** for every non-hidden subdirectory of every search path it reads `game.yaml`, parses it (DFR-001–005), decides with `definitionNeedsBundle(raw)` (DFR-047) whether the game needs a bundle and, **only if it does**, reads and hashes `dist/hooks.js` and `dist/hooks.manifest.json`, compiles with the given limits, computes the `DefinitionId` with `computeDefinitionId` and returns `Result<{registry, definitions: readonly DefinitionSummary[]}, DefinitionError[]>`. Any invalid game fails the whole load, reporting **all** errors across all games, each prefixed by its game directory. Non-directory entries and hidden entries (`.gitkeep`) are ignored. An empty search path yields zero definitions and `ok`. |
| DFR-052 | Must | **Given** the load above, **when** a directory lacks `game.yaml`, **then** `GAME_YAML_MISSING`; **when** the directory name differs from the YAML `id`, `GAME_ID_MISMATCH`; **when** a search path does not exist or is not a directory, `SEARCH_PATH_MISSING`; **when** two directories declare the same `id`, `DUPLICATE_ID`. |
| DFR-053 | Must | **Given** a loaded registry and a `DefinitionId` it produced, **when** `resolve(id)` is called, **then** it re-reads that game's `game.yaml` and, only when the game needs one (DFR-047), its bundle files, and returns the compiled definition **iff** they still produce exactly that id; if they no longer do it returns `DEFINITION_HASH_MISMATCH` naming expected and actual ids. An id the registry never produced returns `UNKNOWN_DEFINITION`. A game that stopped compiling returns `DEFINITION_INVALID`. `resolve` never throws and never executes the bundle. |
| DFR-054 | Must | **Given** the registry contract test suite (`registry-contract.testing.ts`, parameterised by a factory so another adapter can reuse it later), **when** run against the filesystem adapter, **then** it asserts successful resolve (`definitionData` of the returned definition is deep-equal to that of a fresh compile, its `definitionContentHash` equals the loaded one and it passes `assertDefinitionStructure`; function members are checked by behaviour in VC-217, never compared by reference), unknown id, content-hash mismatch after editing `game.yaml` semantics, content-hash mismatch after editing one byte of `dist/hooks.js`, and semantics-preserving edit (comment only) still resolving. |
| DFR-055 | Must | **Given** `SUPPORTED_ACTION_SCHEMA_VERSIONS`, **when** a definition's `schemaVersion` is read by consumers, **then** it is available as `def.schemaVersion` exactly as in P1; the registry rejects an unsupported version at load (`UNSUPPORTED_SCHEMA_VERSION`). |

### 4.6 Phase 1 adjustments (regression-tested)

P2 may change the P1 definition types, with a regression test for each change. The licence is A4 of the original P1 spec at `3bbdd4a` ("if P2 needs a change, P1's types change in P2 with a regression test here, not a fork"); the frozen capsule does not restate it, so this spec restates it as its authority. These are **all** the changes to P1 code; each is listed so a reviewer can reject any of them. Test fixtures that construct these types (the `definition.testing.ts` builders, `buildFloorDefinition` and inline declarations) only gain the new fields with neutral values: `gameId: 'test'`, `roles: []`, `visibility: {}`, `initialMetadata: {}`, `metadataVisibility: {}`, `fieldVisibility: {}`, and a `reducerRef` equal to the registered function's name.

| ID | Pri | Requirement |
|----|-----|-------------|
| DFR-060 | Must | `CompiledGameDefinition` gains `gameId: string` and `roles: readonly RoleDecl[]` (`{id, subject}`). `viewKeys`, `hookBindings`, `policies`, `control` keep their P1 shapes. |
| DFR-061 | Must | `CardDecl` gains `initialMetadata: Readonly<Record<string, JsonValue>>` and `metadataVisibility: Readonly<Record<string, FieldVisibility>>`. `createSession` seeds `cards[c].metadata` from `initialMetadata` (P1 seeded `{}`); `initialMetadata` keys and types must conform to `metadataSchema`, enforced by `assertDefinitionStructure`. |
| DFR-062 | Must | `ZoneDecl` gains `owner?: SeatId \| TeamId` and `visibility: VisibilityRules`; `ZoneTemplateDecl` gains `visibility`. `createSession` sets `zones[z].owner` from `ZoneDecl.owner` (absent when absent). |
| DFR-063 | Must | `CounterDecl` gains `ownerId?: string`, `visibility: VisibilityRules` and `derivedSpec?: DerivedSpec`. The compiler installs `derived` from `derivedSpec` (DFR-016). `definitionData` reports `derivedSpec` as data. For a derived counter the compiler sets `min: 0n`, `initial: 0n`, no `max` and no `supplyRole` (the P1 `CounterDecl` requires `min` and `initial`; they are never read for a derived counter and enter the identity data as these constants). |
| DFR-064 | Must | `MetaSchemaDecl` gains `reducerRef: string` and `fieldVisibility: Readonly<Record<string, FieldVisibility>>`; `CompiledGameDefinition` gains `rosterReducerRef?: string`. The function members `reducer` and `rosterReducer` stay optional and are **bound by P4**, never by the compiler. |
| DFR-065 | Must | `assertDefinitionStructure` changes the reducer rule from "`typeof schema.reducer === 'function'`" to "`reducerRef` is a non-empty string" (error `meta schema <id> has no reducer reference`). In P1, `apply` returned `MALFORMED_ACTION` both for an undeclared `schema_id` and for a declared schema or roster that has no reducer function (`session/apply/primitives/meta.ts`). P2 splits the cases: a `meta` action whose schema has a `reducerRef` but no bound function, and a `roster` action when `rosterReducerRef` is present but no function is bound, return `REDUCER_ERROR` with detail `reducer not bound: <ref>`; an undeclared `schema_id`, and a `roster` action when `rosterReducerRef` is absent and no function is bound, keep returning `MALFORMED_ACTION`. All other KFR-101 checks are unchanged. |
| DFR-066 | Must | `definitionDataSchema` (`core/replay/canonical/definition-schema.ts`) becomes the identity schema `definitionIdentitySchema` covering every field of `DefinitionData` after DFR-060–065, and is now part of the content identity. `DefinitionData` **drops** the function-presence flags (`counters[].derived` as a boolean, `metaSchemas[].hasReducer`, `hasRosterReducer`): identity is carried only by `derivedSpec`, `reducerRef`, `rosterReducerRef` and the bundle hash, so binding functions in P4 never changes the `contentHash`. The P1 test asserting those flags is updated (DBR-010). The canonical profile v1 **rules are unchanged**; no P1 state-digest golden vector changes (DBR-010). |

### 4.7 Server configuration (`packages/config`)

`loadServerConfig(text, env) → Result<ServerConfig, ConfigError[]>`; `ConfigError = {code, path, detail}` (§7.5). The schema, defaults and ranges are in §7.5.

| ID | Pri | Requirement |
|----|-----|-------------|
| DFR-070 | Must | **Given** server YAML text, **when** `loadServerConfig` runs, **then** it parses with `parseYaml` (same safety rules), interpolates, validates with a strict `zod` schema, and returns a `ServerConfig` with keys camelCased and durations as integer milliseconds. It never throws, never reads files or `process.env` itself (the caller passes `env: Readonly<Record<string, string \| undefined>>`). |
| DFR-071 | Must | **Given** a string value containing `${NAME}` (`NAME` matches `^[A-Za-z_][A-Za-z0-9_]*$`), **when** interpolated, **then** each occurrence is replaced by `env[NAME]`; a `NAME` that is `undefined` yields `ENV_MISSING` naming the variable and the path (an empty string is a present value); a `${` that is not a well-formed placeholder yields `ENV_SYNTAX`. Interpolation applies to string values only, never to keys; it is the only templating (no defaults, no escapes, no nesting). The error message never contains any environment variable's **value**. |
| DFR-072 | Must | **Given** an unknown key at any level, **when** validated, **then** it yields `CONFIG_UNKNOWN_KEY` with the dotted path. A value of the wrong type or outside its range yields `CONFIG_INVALID` naming the path, the expectation and the offending value, **except** that the value is replaced by `<redacted>` for `auth.keys[*].secret` and for any value that came, wholly or partly, from `${ENV}` interpolation (the loader tracks provenance per value). Missing required keys yield `CONFIG_MISSING`. All errors are collected (at most 100). Integers must be YAML integers (`2_000_000` and `"8080"` are type errors). |
| DFR-073 | Must | **Given** cross-field rules, **when** validated, **then** `limits.cascade_cap.default ≤ limits.cascade_cap.max`; `store.kind: memory` yields `store: {kind: 'memory'}` with no sqlite block and no sqlite defaults, `store.kind: sqlite` yields `{kind: 'sqlite', sqlite: {path, journal}}` with defaults, and an explicit `store.sqlite` key together with `kind: memory` is rejected; auth key ids are distinct; `games.search_paths` are absolute and distinct. Each violation is a `CONFIG_INVALID` naming the paths involved. |
| DFR-074 | Must | **Given** the repo, **when** this phase ships, **then** `config/server.yaml` exists, validates with `ENGINE_HOST_KEY` set to a 16–256 character value, and fails `ENV_MISSING`/`CONFIG_INVALID` (never silently) when it is unset or empty; its secret is `${ENGINE_HOST_KEY}` and no literal secret appears in the file. |
| DFR-075 | Should | **Given** `pnpm config:check [--server <path>] [--games <dir>…]`, **when** run (defaults: `config/server.yaml` and the `games.search_paths` of that config), **then** it loads the server config with `process.env` and builds the filesystem registry, prints `OK <n> definitions` and exits 0 on success, or prints one `<path>: <code>: <detail>` line per error to stderr and exits 1. |

### 4.8 Tooling, packaging and docs

| ID | Pri | Requirement |
|----|-----|-------------|
| DFR-080 | Must | **Given** the Phase 0 guardrail suite, **when** this phase ships, **then** exactly these guardrail changes are made: the skeleton-purity check (FR-043 check 4) also exempts `packages/config`; check 6 (workspace-protocol dependencies only) allows **only** `yaml`, `zod` and `esbuild` as runtime `dependencies`, **only** in `packages/config/package.json`, each at an exact `\d+\.\d+\.\d+` version; check 5 (exact devDependency versions) is unchanged; every other package keeps `workspace:*`-only dependencies. `packages/core/package.json` stays dependency-free. A fixture proves a non-config package adding a runtime dependency still fails. |
| DFR-081 | Must | **Given** the Docker build, **when** the `build` stage runs, **then** it runs `pnpm bundle:games` after `tsc -b`; the `runtime` stage contains `/app/games` holding each game's `game.yaml` and `dist/` (empty directory when there are no games) so the sample `config/server.yaml` (`games.search_paths: [/app/games]`) validates. The runtime image remains non-root with a read-only `/app`. |
| DFR-082 | Must | **Given** the docs, **when** this phase ships, **then** `docs/game-definition-schema.md` documents every key of §7.1 (type, range, default, error code), `docs/server-config.md` every key of §7.5, `docs/dev-setup.md` lists the new root scripts `bundle:games` and `config:check` (Phase 0 invariant 7), `docs/workspace-architecture.md` shows the new contents of `core/definition`, `core/ports` and `config`, and `docs/canonical-json-profile.md` lists the definition identity schema. |
| DFR-083 | Must | **Given** `packages/config`, **when** compiled, **then** its source project enables Node types (`types: ["node"]`) because it reads files; `packages/core` keeps `types: []` and imports no `node:*` module (KBR-012 unchanged). |

## 5. Business Rules

| ID | Rule | Rationale | Exceptions |
|----|------|-----------|------------|
| DBR-001 | A definition is an immutable value identified by its content: **everything replay depends on is covered by `DefinitionId`** (compiled data and hook bundle). Changing either yields a new id; nothing outside them (comments, key order, build paths) may influence it. | Design §2.1, architecture A8; replay packages bind to the id. | None. |
| DBR-002 | The compiler is pure: same `(raw, ctx)` gives the same result and no I/O, clock or randomness. All file, YAML-library, bundler and env access lives in `packages/config`. | Core determinism and portability (KBR-012); edge nodes in Part B run the compiler without Node. | None. |
| DBR-003 | The schema is **strict**: an unknown key, an unknown enum value or a wrong type is always an error, never ignored or coerced. | A typo in a visibility declaration must not silently widen or narrow entitlement. | None. |
| DBR-004 | **Fail-closed declarations.** Every `meta` field and every card-metadata field declares its visibility; an unresolvable role or audience is an error; an absent visibility block compiles to "no declaration", which P3 treats as omitted from every external view. | Design §2.1/§2.3; Req FR-004b, FR-140. | `control_state` is public by default (P3). |
| DBR-005 | Hook and reducer code is never executed in P2; it is only built, hashed and checked by name against the manifest. | Keeps P2 free of any sandboxing concern; execution and its limits are P4. | None. |
| DBR-006 | Engine ceilings win: a game or config value may lower a limit but never exceed `limits.cascade_cap.max` or the cost-budget ceiling. | Req NFR-027, architecture A8 (`limits`). | None. |
| DBR-007 | Secrets enter only through `${ENV}`: `auth.keys[*].secret` must be exactly one `${NAME}` placeholder (a literal secret is `CONFIG_INVALID`, value redacted). The successful `ServerConfig` carries the resolved secret; no error message, log line or `config:check` output ever contains a secret or any substituted environment value. | Req NFR-073 spirit; secrets never live in files. | None. |
| DBR-008 | Reserved names: schema ids beginning `engine.` are rejected (consistent with KFR-052); ids follow the P1 charset (§6.1: `^[A-Za-z0-9_.:/-]+$`, 1–128 characters), template names additionally contain no `/` and at most 48 characters. | Zone-id derivation is injective only if templates contain no `/` (KBR-006). | None. |
| DBR-009 | Only `packages/config` may carry runtime dependencies, and only `yaml`, `zod`, `esbuild`, exactly pinned. `packages/core` stays dependency-free. | Phase 0 BR-009 and KNFR-005, narrowed deliberately. | Test-only `devDependencies` as before. |
| DBR-010 | **P1 stays frozen in behaviour**: every P1 golden vector (`golden-vectors.json`, VC-067 digests, PRNG vectors) remains byte-identical, and every P1 test passes unchanged **except** these, each updated with its reason in the commit: VC-010 (metadata seeding, DFR-061); VC-045 and the unbound-reducer cases in `reducers.test.ts` (`MALFORMED_ACTION` → `REDUCER_ERROR` where a reference exists, DFR-065); VC-054/VC-083 (reducer reference rule, DFR-065); the `definition.test.ts` assertions on the `hasReducer`/`hasRosterReducer`/`derived` flags (DFR-066); and the shared fixture builders and inline declarations, which only gain the new fields with neutral values (§4.6). | Canonical profile v1 is frozen. | The listed tests and fixtures. |
| DBR-011 | The registry is built once; a file changed on disk after load can never produce a *different* definition under an *old* id (`DEFINITION_HASH_MISMATCH`). | Replay safety (Req FR-073). | A semantics-preserving edit still resolves (same id). |

## 6. Non-Functional Requirements

| ID | Requirement (measurable) |
|----|--------------------------|
| DNFR-001 | **Determinism.** Compiling the same YAML text twice in one process, in two processes, and in the Docker `test` image yields identical `contentHash` and (with an identical bundle) identical `DefinitionId`. `buildHookBundle` run twice on identical sources yields byte-identical `hooks.js`. |
| DNFR-002 | **Compile performance** at the Req NFR-020 floor (a fixture with 14 seats, 4 teams, 700 cards via generators, 64 zones, 40 counters): `compileDefinition` ≤ 250 ms and `definitionContentHash` ≤ 250 ms, each the median of 20 runs after 3 discarded warm-ups in the Docker `test` target. |
| DNFR-003 | **Parse performance.** `parseYaml` + `compileDefinition` on a 1 MiB fixture of explicit cards completes in ≤ 2 s (median of 5 after 1 warm-up); a 1 MiB + 1 byte input fails `YAML_TOO_LARGE` in ≤ 50 ms. |
| DNFR-004 | **Registry cost.** `resolve` of an unchanged 700-card definition takes ≤ 50 ms (median of 20 after 3 warm-ups); loading the 20-game fixture of VC-244 takes ≤ 5 s. |
| DNFR-005 | **Alias bomb safety.** A 1 KiB "billion laughs" document (nested aliases) fails `YAML_FORBIDDEN_FEATURE` in ≤ 200 ms and allocates no more than 64 MiB (RSS delta measured in the test). |
| DNFR-006 | **Coverage.** Line coverage ≥ 95 % for `packages/core/src/definition` and ≥ 90 % for `packages/config/src` via `pnpm test:coverage`; every `DBR` has at least one failing-path test whose name contains its id. |
| DNFR-007 | **Dependencies.** `packages/config/package.json` has exactly three runtime `dependencies` besides `@cge/core` (`yaml`, `zod`, `esbuild`), all exact versions; `packages/core/package.json` has none. |
| DNFR-008 | **Guardrails stay green.** `docker compose -f deploy/docker-compose.test.yml run --rm tests` exits 0 on a clean checkout (lint, typecheck, depcheck, `test`, `test:guardrails`), including the VC-2xx suite below. |

## 7. Data & Interfaces

### 7.1 `game.yaml` schema v1 (normative)

Sections are validated and errors reported in this order. `T` = type, `D` = default, `R` = required. All maps reject unknown keys.

```yaml
id: hearts                       # R  gameId, ^[a-z0-9][a-z0-9_-]{0,63}$, must equal the directory name
action_schema_version: 1         # R  integer in SUPPORTED_ACTION_SCHEMA_VERSIONS = {1}
roles:                           # D  []   custom roles; built-ins: player, dealer, auditor, render
  - { id: spectator, subject: forbidden }     # subject: required | optional | forbidden
seats:                           # R  exactly one of the two forms
  list: [ { id: north, team: ns }, { id: east, team: ew }, { id: south, team: ns }, { id: west, team: ew } ]
  teams: [ ns, ew ]              #    only with `list`; every team needs >= 1 seat
  # count: 4                     #    alternative: seat1..seat4 (`prefix` D "seat"); no teams
zones:                           # D  []
  - { id: stock, ordering: ordered, visibility: { default: hidden } }
  - { id: "hand-{seat}", for_each: seat, owner_id: "{seat}", ordering: unordered,
      visibility: { default: hidden, player: owner } }
  - { template: meld, owner: team, ordering: ordered, max_instances: 8 }
cards:                           # D  []   order is semantic (initial zone order)
  - generate:
      axes:                                                    # ordered list; first axis varies slowest
        - { name: suit, values: [S, H, D, C] }
        - { name: rank, values: { range: [1, 13] } }
      id: "{suit}{rank}"
      type: "{suit}"
      zone: stock
      metadata: { suit: "{suit}", rank: "{rank}" }             # lone placeholder keeps int type
      metadata_schema: { suit: { type: string, visibility: public },
                         rank: { type: int,    visibility: public } }
  - { id: joker, zone: stock }
counters:                        # D  []
  - { id: pot, owner: table, min: 0, initial: 0, visibility: { default: public } }
  - { id: "chips-{seat}", for_each: seat, owner: player, owner_id: "{seat}",
      min: 0, max: "1000000000000000000000", initial: 100, scale: 2, rounding: half_even }
  - { id: bank, owner: table, min: 0, initial: 0, supply_role: mint }
  - { id: stock_size, derived: { zone_size: stock }, visibility: { default: public } }
conservation_groups:             # D  []
  - { id: money, counters: [ pot, { expand: "chips-{seat}", for_each: seat } ] }
control:                         # D  see DFR-019
  phases: [ deal, play ]         # D [main]
  initial_phase: deal            # D first phase when `phases` omitted -> main; otherwise R
  turn_order: [ north, east, south, west ]     # D seat declaration order
  initial_active_seats: [ north ]              # D first seat of the turn order
  pointers: [ button ]           # D []
  enforce_active_seats: true     # D false
  out_of_turn: [ chat ]          # D []
meta_schemas:                    # D  []
  - id: hearts.score
    reducer: reduceScore         # R  export name in the hook bundle
    fields: { points: { type: int, visibility: public },
              note:   { type: string, visibility: secret } }   # visibility: public | subject | secret
roster_reducer: reduceRoster     # D  absent
view_keys: [ card_face, zone_membership ]      # D  all of GRANTABLE_VIEW_KEYS
hooks:                           # D  absent
  module: ./hooks.ts             #    build input only
  validation:   { play_card: validatePlay }              # key = inbound kind
  reaction:     { "phase:play": [ onTrickComplete ], "trigger:setup": setup }
  gate_resolve: { "hearts.pass": resolvePass }           # key = gate schema id
  authorization: [ authorize ]
policies:                        # D  {}
  cascade_cap: 16                # D 16, 1..256, <= limits.cascade_cap.max
  cost_budgets: { validation: 500000, reaction: 2000000 }   # D {}
```

Notes: `visibility` audiences are `public | hidden | owner | team`; keys are `default` or a role. Integers are YAML integers or decimal strings (compiled to `bigint` where P1 uses `bigint`, to `number` elsewhere). `for_each` placeholders are `{seat}` and `{team}` only. Limits: 64 seats, 32 teams, 1 000 zones, 10 000 cards, 5 000 counters, 64 phases, 256 template instances. The architecture's `game.yaml` sketch (A8) is illustrative; this schema is normative and differs where it adds required fields (`ordering`, `max_instances`, per-field `type`).

### 7.2 Compiled definition: additions to the P1 types

Normative field names (all `readonly`); everything not listed is unchanged from `packages/core/src/definition/types.ts`.

```ts
type FieldVisibility = 'public' | 'subject' | 'secret';
type Audience = 'public' | 'hidden' | 'owner' | 'team';
type VisibilityRules = Readonly<Record<string /* 'default' | RoleName */, Audience>>;
interface RoleDecl { id: string; subject: 'required' | 'optional' | 'forbidden' }
type DerivedSpec = { kind: 'zone_size'; zone: ZoneId };

CompiledGameDefinition += { gameId: string; roles: readonly RoleDecl[]; rosterReducerRef?: string }
CardDecl      += { initialMetadata: Record<string, JsonValue>; metadataVisibility: Record<string, FieldVisibility> }
ZoneDecl      += { owner?: SeatId | TeamId; visibility: VisibilityRules }
ZoneTemplateDecl += { visibility: VisibilityRules }
CounterDecl   += { ownerId?: string; visibility: VisibilityRules; derivedSpec?: DerivedSpec }
MetaSchemaDecl += { reducerRef: string; fieldVisibility: Record<string, FieldVisibility> }   // `reducer?` stays, bound by P4
```

Mapping from YAML names to the P1 compiled names (all other P1 fields keep their names and meaning):

| YAML | Compiled | Notes |
|------|----------|-------|
| `id`, `action_schema_version` | `gameId`, `schemaVersion` | |
| `seats.list[]` / `seats.count` | `seats: SeatDecl[]`, `teams: TeamId[]` | declaration order |
| fixed `zones[]` `{id, ordering, owner_id}` | `zones[] {id, ordered: ordering === 'ordered', owner?}` | |
| template `zones[]` `{template, owner, ordering, max_instances}` | `zoneTemplates[] {name, ownerRule, ordered, maxInstances}` | |
| `cards[]` (after expansion) | `cards[] {id, type?, startingZone, metadataSchema, metadataVisibility, initialMetadata}` | `metadataSchema` is field → type; omitted `metadata_schema`/`metadata` → `{}` |
| `counters[]` | `counters[]` | `supply_role` → `supplyRole`, `owner_id` → `ownerId`, `derived` → `derivedSpec`; `min`/`max`/`initial` → `bigint` |
| `conservation_groups[]` | `conservationGroups[] {id, counters}` | |
| `control.*` | `control {phases, initialPhase, turnOrder, initialActiveSeats, pointerNames, enforceActiveSeats, outOfTurnKinds}` | |
| `meta_schemas[]`, `roster_reducer` | `metaSchemas[] {id, fields, fieldVisibility, reducerRef}`, `rosterReducerRef` | `fields` is field → type |
| `roles`, `view_keys` | `roles`, `viewKeys` | |
| `hooks.*` (except `module`) | `hookBindings` | keys per DFR-023 |
| `policies` | `policies {cascadeCap, costBudgets}` | |

### 7.3 Identity

```ts
definitionContentHash(def): string   // sha256Hex(canonicalize(definitionIdentitySchema, definitionData(def)))
hookBundleHash(jsBytes: Uint8Array, exports: readonly string[]): string   // bundleIdentitySchema, DFR-042
computeDefinitionId(contentHash: string, bundleHash?: string): DefinitionId   // 'sha256:' + sha256Hex(canonicalize(idIdentitySchema, {contentHash, bundleHash?}))
definitionNeedsBundle(raw: unknown): boolean   // DFR-047
```

`definitionIdentitySchema`: the P1 `definitionDataSchema` extended with the fields of §7.2 in the order they are declared there; sequences keep order, id-keyed maps are sorted (profile v1 rule 2). `hookBindings` is an `idMap` of string arrays. The schema is listed in `docs/canonical-json-profile.md`.

Hook bundle artifact: `games/<id>/dist/hooks.js` (ESM, UTF-8) and `games/<id>/dist/hooks.manifest.json` (`{"exports": ["a", "b"]}`, sorted, distinct). `HookBundleInfo = {hash: string; exports: readonly string[]}`.

### 7.4 APIs

```ts
// @cge/config
parseYaml(text: string, opts?: {maxBytes?: number; maxAliases?: number}): Result<JsonValue, readonly DefinitionError[]>
buildHookBundle(gameDir: string): Promise<Result<HookBundleInfo, readonly DefinitionError[]>>
createFilesystemDefinitionRegistry(opts: {searchPaths: readonly string[]; limits: DefinitionLimits}):
  Promise<Result<{registry: DefinitionRegistry; definitions: readonly DefinitionSummary[]}, readonly DefinitionError[]>>
loadServerConfig(text: string, env: Readonly<Record<string, string | undefined>>): Result<ServerConfig, readonly ConfigError[]>

// @cge/core (core/definition, re-exported from the package root)
compileDefinition(raw: unknown, ctx?: {bundle?: HookBundleInfo; limits?: DefinitionLimits}): CompileResult
type CompileResult = {ok: true; value: CompiledGameDefinition} | {ok: false; errors: readonly DefinitionError[]; truncated: boolean}
interface DefinitionLimits { cascadeCapMax: number /* D 256 */; costBudgetMax?: number }
interface DefinitionError { code: DefinitionErrorCode; path: string; detail: string; entity?: string }
const SUPPORTED_ACTION_SCHEMA_VERSIONS: readonly number[]; const GRANTABLE_VIEW_KEYS: readonly string[]
// core/ports: DefinitionRegistry, RegistryError, DefinitionSummary (DFR-050)
```

### 7.5 `config/server.yaml` schema (normative)

`T` types, `D` defaults, `R` required. Durations match `^[1-9][0-9]*(ms|s|m|h)$`.

| Key | Type / range | Default |
|-----|--------------|---------|
| `server.http.host` | non-empty string | `0.0.0.0` |
| `server.http.port` | integer 1–65535 | `8080` |
| `server.ws.max_subscribers_per_session` | integer 1–10 000 | `200` |
| `server.ws.outbound_queue` | integer 1–100 000 | `256` |
| `auth.mode` | `static-api-key` | **R** |
| `auth.keys[]` | non-empty list of `{id, secret, can}` | **R** |
| `auth.keys[].id` | P1 id charset, distinct | **R** |
| `auth.keys[].secret` | string, 16–256 characters after interpolation; the source must be exactly one `${NAME}` (DBR-007) | **R** |
| `auth.keys[].can` | non-empty distinct subset of `propose, query, subscribe, export, direct_apply, fork, admin` | **R** |
| `sessions.cache.max_loaded` | integer 1–1 000 000 | `5000` |
| `sessions.cache.idle_ttl` | duration 1s–24h | `15m` |
| `sessions.mailbox_limit` | integer 1–100 000 | `128` |
| `store.kind` | `sqlite` \| `memory` | `sqlite` |
| `store.sqlite.path` | non-empty string (only with `kind: sqlite`) | `/data/engine.db` (applies only when `kind` is `sqlite`) |
| `store.sqlite.journal` | `wal` | `wal` (same) |
| `games.search_paths` | non-empty list of distinct absolute paths | `[/app/games]` |
| `limits.cascade_cap.default` | integer 1–256, ≤ `max` | `16` |
| `limits.cascade_cap.max` | integer 1–4096 | `256` |
| `limits.hook.timeout` | duration 1ms–60s | `250ms` |
| `limits.hook.cost_budget` | integer 1–2^53−1 | `2000000` |
| `logging.level` | `debug` \| `info` \| `warn` \| `error` | `info` |
| `logging.format` | `json` \| `text` | `json` |

`ServerConfig` mirrors this structure with camelCase keys, durations in integer milliseconds and defaults filled; `store` is a union discriminated on `kind` (`{kind: 'memory'}` or `{kind: 'sqlite', sqlite: {path, journal}}`). `ConfigError.code ∈ {YAML_SYNTAX, YAML_TOO_LARGE, YAML_DUPLICATE_KEY, YAML_FORBIDDEN_FEATURE, ENV_MISSING, ENV_SYNTAX, CONFIG_UNKNOWN_KEY, CONFIG_INVALID, CONFIG_MISSING}`. The architecture sample's `2_000_000` is not valid YAML 1.2 core integer syntax and is written `2000000`.

### 7.6 Files this phase adds or changes

- `packages/core/src/definition/**` (compiler, validators, identity, errors, `definitionIdentitySchema` wiring), `packages/core/src/ports/**` (`DefinitionRegistry`), `packages/core/src/session/create.ts` (DFR-061/062), `packages/core/src/replay/canonical/definition-schema.ts` (DFR-066).
- `packages/config/src/**` (`yaml`, `bundle`, `registry`, `server-config`, `cli`, `registry-contract.testing.ts`), `packages/config/package.json` (three runtime dependencies), `packages/config/tsconfig.json` (`types: ["node"]`), `packages/config/fixtures/**` (fixture games and server configs, inert for lint/format of real runs).
- `config/server.yaml` (new), root `package.json` (`bundle:games`, `config:check`), `deploy/Dockerfile` (DFR-081), `pnpm-workspace.yaml` only if pnpm 10 requires a build-script allowance for `esbuild`.
- `tools/guardrails/**` (DFR-080 only), `docs/**` (DFR-082).

## 8. Verification Criteria

Unless stated otherwise, every VC is an automated test run by `pnpm test` (compiler, identity and P1-adjustment tests in `packages/core`; YAML, bundle, registry and config tests in `packages/config`) inside the Docker `test` target. "Fixture" means a file under `packages/config/fixtures/` or an in-test object.

### YAML intake

- VC-201: `parseYaml` on `a: yes\nb: no\nc: 1\nd: 1.5\ne: ~\nf: [x]` → `a`/`b` are the strings `"yes"`/`"no"`, `c = 1`, `d = 1.5` (number), `e = null`, `f = ["x"]`; anchors/aliases (`base: &b {x: 1}\nuse: *b`) resolve to equal objects. *(DFR-001)*
- VC-202: A 1 048 576-byte document → ok; 1 048 577 bytes → `YAML_TOO_LARGE`; a 101-alias document → `YAML_FORBIDDEN_FEATURE`, a 100-alias document → ok; multi-byte characters count as UTF-8 bytes. *(DFR-002)*
- VC-203: Duplicate keys at depth 1, at depth 3 and through an alias-expanded mapping → each `YAML_DUPLICATE_KEY` with key, line and column. *(DFR-003)*
- VC-204: `!!str x`, `!custom {a: 1}`, `<<: *b`, `1: a`, `__proto__: {}`, `a: 1\n---\nb: 2`, `` (empty) and `# only a comment` → each `YAML_FORBIDDEN_FEATURE` naming the feature. *(DFR-004)*
- VC-205: `a: [1, 2` and a tab-indented block → `YAML_SYNTAX` with line and column; a fast-check property over arbitrary strings never throws and always returns `ok` or a non-empty error list. *(DFR-005)*
- VC-206: DNFR-005 alias bomb (nested aliases, 1 KiB) → `YAML_FORBIDDEN_FEATURE` within 200 ms and ≤ 64 MiB RSS growth. *(DFR-002, DNFR-005)*

### Schema and compilation

- VC-210: A fully populated fixture exercising every key of §7.1 → `ok`; the compiled value contains the expected seats, zones, cards, counters, groups, control, schemas, roles, view keys, hook bindings and policies (asserted field by field against an expected literal). *(DFR-010–DFR-025)*
- VC-211: For each of the 14 codes the compiler can raise (`SCHEMA_UNKNOWN_KEY`, `SCHEMA_TYPE`, `SCHEMA_MISSING`, `INVALID_VALUE`, `DUPLICATE_ID`, `UNKNOWN_REFERENCE`, `INVALID_VISIBILITY`, `RESERVED_NAME`, `MISSING_REDUCER`, `MISSING_HOOK_MODULE`, `UNKNOWN_HOOK_EXPORT`, `BUNDLE_MISSING`, `UNSUPPORTED_SCHEMA_VERSION`, `LIMIT_EXCEEDED`), a fixture triggers it with the `code`, `path` and `entity` that the DFR-031 table assigns (the other 8 codes of DFR-030 are asserted in the YAML, bundle and registry VCs); an unknown key at top level, in `zones[1]`, in `counters[0].derived` and in `control` → `SCHEMA_UNKNOWN_KEY` each; `seats: "four"` → `SCHEMA_TYPE`; missing `id` → `SCHEMA_MISSING`; a definition with 130 independent errors → exactly 100 errors, `truncated = true`, in document order; `compileDefinition` of 1 000 random values (fast-check, including `null`, arrays, nested junk) never throws. *(DFR-010, DFR-030)*
- VC-212: `id: Hearts`, `id: ""`, a 65-character id → `INVALID_VALUE`; `action_schema_version: 2` and `0` → `UNSUPPORTED_SCHEMA_VERSION`; `1` → ok and `schemaVersion = 1`. *(DFR-011, DFR-055)*
- VC-213: Seats: `count: 4` → `seat1…seat4`; `count: 4, prefix: p` → `p1…p4`; `list` with teams → team layout preserved; `count` with `teams`, `list` and `count` together, neither, 0 seats, a team with no seat → `INVALID_VALUE`; 65 seats and 33 teams → `LIMIT_EXCEEDED`; a seat naming an undeclared team → `UNKNOWN_REFERENCE`; duplicate seat id → `DUPLICATE_ID`; `prefix: "Seat "` → `INVALID_VALUE` naming `Seat 1`; 14 seats / 4 teams → ok. *(DFR-012)*
- VC-214: Zones: a fixed zone, a template, a `for_each` zone per seat → expected `ZoneDecl`s with `owner` set; missing `ordering`, `max_instances` 0 and 257, template name `a/b` or 49 characters, template named like a fixed zone, `owner_id` of an unknown seat, 1 001 zones → each error. *(DFR-013, DFR-018)*
- VC-215: Cards: the `suit × rank` generator of §7.1 (axes as an ordered list) → 52 cards in the order `S1…S13, H1…H13, D1…D13, C1…C13`; `rank` metadata is the integer `1`, `suit` the string `"S"`; swapping the two axis items in the list → order `S1,H1,D1,C1,S2,…` and a different `contentHash`; a three-axis generator with a `deck` axis `range [1,8]` → 416 cards; a generator whose expansion exceeds 10 000 cards, a placeholder for an undeclared axis, an unmatched `{`, a `zone` naming a template, metadata field not in `metadata_schema`, `rank: "x"` where `int` is declared, a duplicate expanded card id → each error naming the entity. *(DFR-014, DFR-026)*
- VC-216: Counters: bounds at `0`/`"1000000000000000000000"` compile to `bigint`; `initial` below `min`, above `max`, `1.5` (`SCHEMA_TYPE`), `"12a"`, the bare integers `9007199254740992` and `9007199254740993` (`INVALID_VALUE`, while the quoted strings `"9007199254740992"` and `"9007199254740993"` compile to the exact `bigint`s), `owner_id` on a `table` counter, a missing `owner_id` on a `zone` counter, an unknown owner entity, `scale: 19`, `rounding: ceil`, `supply_role: print`, a missing `min` → each error; counter ids from `for_each` unique and in seat order. *(DFR-015, DFR-018)*
- VC-217: Derived counter `{id: stock_size, derived: {zone_size: stock}}` → compiled with `derivedSpec = {kind:'zone_size', zone:'stock'}`; the compiled counter has exactly `min = 0n`, `initial = 0n`, no `max` and no `supplyRole`; the evaluator returns `52n` on a fresh session and `51n` after one `move` out of `stock`; two independent compiles give evaluators with equal results on the same snapshots; adding `min`, `initial` or `supply_role` to it, an unknown zone, or `derived: {sum: x}` → errors. *(DFR-016, DFR-063)*
- VC-218: Conservation groups with literals and `expand` → expected counter lists; an unknown counter and a derived counter → `UNKNOWN_REFERENCE` naming the counter; a duplicate counter within a group → `DUPLICATE_ID` naming the counter; a duplicate group id → `DUPLICATE_ID` naming the group. *(DFR-017)*
- VC-219: Control: omitted section → defaults of DFR-019 (`phases [main]`, turn order = seat order, active seats = first seat, `enforce_active_seats false`); a turn order that omits a seat, repeats one or names an unknown one, `initial_phase` outside `phases`, `phases` given without `initial_phase` (`SCHEMA_MISSING`), 65 phases (`LIMIT_EXCEEDED`), empty `initial_active_seats`, an unknown active seat, duplicate pointer names → each error. *(DFR-019)*
- VC-220: `meta_schemas`: valid schema compiles with `reducerRef` and `fieldVisibility`; missing `reducer` → `MISSING_REDUCER` naming the schema; a field without `visibility` → `INVALID_VISIBILITY` naming schema and field; `visibility: private` → `INVALID_VISIBILITY`; id `engine.custom` → `RESERVED_NAME`; duplicate schema id → `DUPLICATE_ID`; card `metadata_schema` field without `visibility` → `INVALID_VISIBILITY`. *(DFR-020, DBR-004, DBR-008)*
- VC-221: Roles and visibility: a `spectator` role and `visibility: {default: hidden, spectator: public, player: owner}` on an owned zone → compiled `VisibilityRules`; `{referee: public}` (unknown role), `{default: secret}` (unknown audience), `owner` on a fixed zone without `owner_id`, on a `none` template and on a `table` counter, a custom role named `player`, duplicate role ids → each `INVALID_VISIBILITY`/`DUPLICATE_ID`; omitted block → `{}`. *(DFR-021, DBR-004)*
- VC-222: `view_keys` omitted → the four grantable keys; `[card_face]` → that list; `[]`, `[card_face, card_face]`, `[secret_key]` → errors. *(DFR-022)*
- VC-223: Hooks: single-name and list forms normalise to lists; compiled keys are `validation:play_card`, `reaction:phase:play`, `reaction:trigger:setup`, `gate_resolve:hearts.pass`, `authorization:default`; list order preserved; reaction key `foo:bar`, `phase:nope` (undeclared phase), `module: ../x.ts`, `module: hooks.ts`, `module: ./hooks.mjs` → errors; `hooks.module` absent from the compiled data. *(DFR-023)*
- VC-224: Compile with a `HookBundleInfo` whose exports lack one referenced name → `UNKNOWN_HOOK_EXPORT` naming it; compile with references but no bundle → `BUNDLE_MISSING`; reducer without `hooks.module` → `MISSING_HOOK_MODULE`; a definition with no references and no module compiles with no bundle. *(DFR-024)*
- VC-225: Policies: absent → `cascadeCap 16`, `costBudgets {}`; `cascade_cap: 0`, `257` → errors; `cascade_cap: 100` with `cascadeCapMax: 50` → `LIMIT_EXCEEDED`; budget key `render`, value `0`, value above `costBudgetMax` → errors. *(DFR-025, DBR-006)*
- VC-226: Every `ok` fixture passes `assertDefinitionStructure`, and `createSession` with a roster built from `def.seats` succeeds and places every card in its starting zone in expanded order; a hand-built definition with a duplicate card id still fails `assertDefinitionStructure` (P1 behaviour kept). *(DFR-026)*
- VC-227: Property (fast-check, ≥ 500 runs): generate a valid definition (random seats, zones, counters, generator axes) as a JS object → compile `ok`, and the compiled card count equals the product of the axis lengths. *(DFR-014, DFR-026)*

- VC-228: Canonical-profile guard: a `json` metadata value containing the float `1.5` → `SCHEMA_TYPE`; one nested 65 levels deep, one holding an escaped lone surrogate (`"\ud800"`) and one holding a value above the safe-integer range → `INVALID_VALUE` with the path; each such document returns `ok:false`, never throws; a property test (≥ 500 runs) asserts that for every `ok` compile `definitionContentHash` does not throw. *(DFR-010, DFR-040)*
- VC-229: Id charset: `prefix: "Seat "`, a generator `id: "card {n}"` (with an axis `n`), an expanded 129-character card id, a `for_each` zone id containing a space, and a phase named `""` → each `INVALID_VALUE` naming the entity and the producing path; ids of exactly 128 characters and with every character of `A-Za-z0-9_.:/-` → ok. *(DFR-027, DBR-008)*

### Identity and bundles

- VC-230: Two YAML texts equal up to anchors, mapping key order, comments, whitespace and explicit defaults (`enforce_active_seats: false`, `phases: [main]` together with `initial_phase: main`) → equal `contentHash`; compile twice → equal; compile in a child process → equal. *(DFR-041, DNFR-001)*
- VC-231: One-field mutations, each → a different `contentHash`: swap two cards, change a card's zone, a counter's `max`, a seat's team, hook-list order, one visibility audience, `cascade_cap`, a `view_keys` entry, `gameId`, a metadata value, a field's visibility, `for_each` seat count. Adding/removing a comment, or changing `hooks.module` between two valid paths while supplying the same `HookBundleInfo` → unchanged. *(DFR-040, DFR-041, DBR-001)*
- VC-232: `hookBundleHash` of fixed inputs equals committed expected values; flipping one byte of `hooks.js`, adding, removing or renaming one export → each changes it; export order in the input does not matter (sorted before hashing). *(DFR-042)*
- VC-233: `computeDefinitionId(c)` and `computeDefinitionId(c, b)` differ even when `b` is the hash of an empty bundle; ids match `^sha256:[0-9a-f]{64}$` (71 characters) and pass `isDefinitionId`; the package root exports both `definitionId` (P1 validator, unchanged) and `computeDefinitionId` and `tsc -b` succeeds; identical YAML plus identical bundle → stable id; identical YAML plus a different bundle → different id. *(DFR-043)*
- VC-234: `buildHookBundle` on a fixture game with `hooks.ts` importing a local helper → `dist/hooks.js` is a single file with no remaining `import` of a relative path, no minification (contains the source function names), no absolute path and no sourcemap comment; manifest lists the sorted exports; a second build is byte-identical; a missing `hooks.ts`, a type/syntax error and a module exporting nothing while the YAML references a hook → `BUNDLE_INVALID`. *(DFR-044, DNFR-001)*
- VC-235: Static test: no file in `packages/core/src/definition` or `packages/config/src` (excluding tests) contains `import(`, `require(`, `eval(`, `new Function` or `node:vm`, except the fixed-name `esbuild` build call; a fixture file containing `await import(bundlePath)` makes the test fail. *(DFR-045, DBR-005)*
- VC-237: `definitionNeedsBundle` is `true` for a game with `hooks.module` only, with a reducer reference only, with a hook binding only, and `false` for a game with none of them; a game with no hooks beside a **leftover** `dist/hooks.js` and manifest gets the same `DefinitionId` as the same game in a clean tree. *(DFR-047, DFR-051)*
- VC-236: `pnpm bundle:games` over a fixtures root with two games builds both; with one broken game exits non-zero naming it. *(DFR-046)*

### Registry

- VC-240: Type test: `DefinitionRegistry`, `RegistryError`, `DefinitionSummary` exist in `core/ports` with the DFR-050 shapes; the ports module's emitted JavaScript exports no class or function (P1 VC-085 still passes). *(DFR-050)*
- VC-241: A search path with three valid fixture games → `ok`, three summaries with distinct ids; an empty directory → `ok`, zero; `.gitkeep` and a stray file ignored; two invalid games → one failure listing the errors of **both**, each prefixed by its directory. *(DFR-051)*
- VC-242: A directory without `game.yaml` → `GAME_YAML_MISSING`; directory `hearts` containing `id: spades` → `GAME_ID_MISMATCH`; a missing search path and a search path that is a file → `SEARCH_PATH_MISSING`; two search paths each containing a `hearts` → `DUPLICATE_ID`; a game with `action_schema_version: 2` → `UNSUPPORTED_SCHEMA_VERSION`. *(DFR-052, DFR-055)*
- VC-243: Contract suite on the filesystem adapter: `resolve(id)` of a loaded id → `ok`, `definitionData` deep-equal to a fresh compile's, equal `definitionContentHash`, passes `assertDefinitionStructure`; `resolve("sha256:" + "0".repeat(64))` → `UNKNOWN_DEFINITION`; after changing a card's zone in `game.yaml`, `resolve(oldId)` → `DEFINITION_HASH_MISMATCH` naming both ids; after flipping one byte of `dist/hooks.js`, same; after adding a YAML comment, `resolve(oldId)` → `ok`; after breaking the YAML syntax → `DEFINITION_INVALID`; none of the calls throws. *(DFR-053, DFR-054, DBR-011)*
- VC-244: `resolve` of an unchanged 700-card definition ≤ 50 ms median; loading the committed `fixtures/perf-20-games/` search path (20 games, each 52 generated cards, 6 zones, 4 counters, one 4 KiB bundle) ≤ 5 s (median of 5 after 1 warm-up). *(DNFR-004)*

### P1 adjustments

- VC-250: `createSession` on a definition whose card declares `initialMetadata {suit: "S", rank: 1}` → `cards[c].metadata` equals it; a card with no metadata → `{}`; `initialMetadata` with an undeclared field or wrong type → `assertDefinitionStructure` error naming card and field; `set_metadata` afterwards behaves as in VC-034. *(DFR-061)*
- VC-251: `createSession` on a definition with a zone `owner: north` → `zones[z].owner = "north"`; a zone without owner → no `owner` key; `stateDigest` unchanged for definitions with no owners (P1 digests identical). *(DFR-062)*
- VC-252: `assertDefinitionStructure` on a meta schema with `reducerRef` but no bound function → no error; with no `reducerRef` → error naming the schema; a `meta` action for a declared schema with a `reducerRef` but no bound function → `REDUCER_ERROR` with detail `reducer not bound: <ref>` and unchanged state; the same schema with the function bound → applies; an undeclared `schema_id` → still `MALFORMED_ACTION`; a `roster` action with `rosterReducerRef` present and no function → `REDUCER_ERROR`, with the function bound → applies, with `rosterReducerRef` absent and no function → `MALFORMED_ACTION`; `engine.custom` declared → still rejected. *(DFR-064, DFR-065)*
- VC-253: `definitionData` of a compiled fixture contains `derivedSpec`, `reducerRef`, `fieldVisibility`, `visibility`, `roles`, `gameId` and no function and none of the flags `derived` (boolean), `hasReducer`, `hasRosterReducer`; `canonicalize(definitionIdentitySchema, …)` succeeds; every field of §7.2 appears in the schema (an exhaustive-keys type test fails when a field is added to the type but not to the schema). *(DFR-063, DFR-066)*
- VC-254: All P1 golden tests (`golden-vectors.json`, VC-067 digests at seq 0/10/20/30, PRNG vectors) pass with byte-identical expected values and no edit to their files (`git diff` over those files is empty); every other P1 test passes, the only edits to P1 tests being those listed in DBR-010 (VC-010, VC-045 and the unbound-reducer cases, VC-054/VC-083, the `definition.test.ts` flag assertions, and the fixture builders). *(DFR-066, DBR-010)*
- VC-255: Binding does not change identity: compile a fixture with reducers, record `definitionContentHash`; build a copy with test reducer functions and a derived evaluator bound (`reducer`, `rosterReducer` set) → equal `definitionContentHash` and equal `computeDefinitionId` with the same bundle. *(DFR-040, DFR-066, DBR-001)*

### Server configuration

- VC-260: A fully specified valid config → `ok`; a minimal config (only `auth`) → `ok` with every default of §7.5 filled, `idle_ttl 15m` → `900000`, `timeout 250ms` → `250`, keys camelCased, `store = {kind: 'sqlite', sqlite: {path: '/data/engine.db', journal: 'wal'}}`; a config with `store: {kind: memory}` → `ok` with `store = {kind: 'memory'}` and no `sqlite` property. *(DFR-070, DFR-073)*
- VC-261: `${A}-${B}` with both set → substituted; `${MISSING}` → `ENV_MISSING` naming the variable and path; a variable set to `""` → substituted as empty (then rejected by the 16-character secret rule); `${}`, `${1X}`, `${A` and `$${A}` → `ENV_SYNTAX`; a `${X}` inside a key → treated as a literal key (and rejected as unknown); the error text of `ENV_MISSING` and of a too-short secret does not contain any env value or the secret; `logging.level: ${LVL}` with `LVL=trace` → `CONFIG_INVALID` at `logging.level` whose text contains `<redacted>` and not `trace`; a literal `secret: "0123456789abcdef"` → `CONFIG_INVALID` with the value redacted. *(DFR-071, DFR-072, DBR-007)*
- VC-262: Unknown key at `server`, `server.http`, `auth.keys[0]` and top level → `CONFIG_UNKNOWN_KEY` with path each; `port: 0`, `65536`, `"8080"`, `8080.5`, `2_000_000`, `idle_ttl: 15` (no unit), `idle_ttl: 0s`, `mode: oauth`, `can: [root]`, `can: []`, `keys: []`, `secret` of 15 and 257 characters, `search_paths: [relative/path]`, `level: trace` → each `CONFIG_INVALID`; missing `auth` → `CONFIG_MISSING`; 120 independent errors → 100 reported. *(DFR-072)*
- VC-263: `cascade_cap.default 300` with `max 256`, `store: {kind: memory, sqlite: {…}}`, duplicate key ids, duplicate search paths → each `CONFIG_INVALID`; the cascade, key-id and search-path cases name both paths involved, the memory case names `store.sqlite`. *(DFR-073)*
- VC-264: `config/server.yaml` from the repo with `ENGINE_HOST_KEY = "x".repeat(16)` → `ok` and `games.searchPaths = ["/app/games"]`; unset or `""` → failure; the file contains no `secret:` line without `${`. *(DFR-074)*
- VC-265: `pnpm config:check` (run as a process in the test) with a valid env → exit 0, stdout `OK 0 definitions`; with `ENGINE_HOST_KEY` unset → exit 1 and stderr contains `ENV_MISSING` and `ENGINE_HOST_KEY`; with `--server` pointing at a file with an unknown key → exit 1 and `CONFIG_UNKNOWN_KEY`; with a search path holding an invalid game → exit 1 and the game's error lines. *(DFR-075)*

### Tooling, packaging, docs, gates

- VC-270: `git diff` against Phase 1 shows guardrail changes only in the skeleton-purity check (adds `packages/config`) and check 6 (named, exactly pinned runtime dependencies in `packages/config` only; check 5 is unchanged); fixtures prove that adding a runtime dependency to `packages/app`, adding `lodash` to `packages/config`, or an unpinned `yaml` version still fails; `pnpm test:guardrails` passes. *(DFR-080, DBR-009)*
- VC-271: `packages/config/package.json` `dependencies` equal `{@cge/core: workspace:*, yaml: <exact>, zod: <exact>, esbuild: <exact>}`; `packages/core/package.json` has no `dependencies`; Phase 0 repo invariants 1–7 pass. *(DNFR-007, DBR-009)*
- VC-272: CI image check: `docker build --target runtime` then `docker run --rm --entrypoint ls <image> /app/games` exits 0, `/app` is not writable by the container user, and the user is not root; the `build` stage log contains the `bundle:games` run. *(DFR-081)*
- VC-273: A doc test asserts `docs/game-definition-schema.md` mentions every top-level key of §7.1 and every `DefinitionErrorCode`; `docs/server-config.md` mentions every key of §7.5; `docs/dev-setup.md` mentions `bundle:games` and `config:check` (Phase 0 invariant 7 passes); `docs/canonical-json-profile.md` contains `definitionIdentitySchema`. *(DFR-082)*
- VC-274: `packages/config/tsconfig.json` has `types` containing `node`; `packages/core/tsconfig.json` still has `types: []`; seeding `import "node:fs"` in `packages/core/src/definition` in a guardrail fixture still fires `core-no-node`. *(DFR-083, KBR-012)*
- VC-275: Performance at the NFR-020 floor fixture (14 seats, 4 teams, 700 generated cards, 64 zones, 40 counters): `compileDefinition` ≤ 250 ms and `definitionContentHash` ≤ 250 ms (median of 20 after 3 warm-ups); the 1 MiB parse+compile ≤ 2 s; the 1 MiB + 1 byte input fails in ≤ 50 ms. *(DNFR-002, DNFR-003)*
- VC-276: `pnpm test:coverage` reports ≥ 95 % lines for `packages/core/src/definition` and ≥ 90 % for `packages/config/src`; a script lists each `DBR` with at least one failing-path test name containing its id. *(DNFR-006)*
- VC-277: `docker compose -f deploy/docker-compose.test.yml run --rm tests` exits 0 on a clean checkout; running it twice produces identical committed-id test results. *(DNFR-001, DNFR-008)*

### Phase exit criteria (index)

- Invalid definitions (duplicate card ids, missing reducer, bad visibility) fail at load with precise errors → VC-211, VC-215, VC-220, VC-221, VC-241.
- Equivalent YAML yields the same `DefinitionId`; any semantic change yields a new one → VC-230, VC-231, VC-233.
- Changing only the hook bundle changes the `DefinitionId`; same YAML plus same bundle is stable → VC-232, VC-233, VC-243.
- The filesystem registry passes the contract tests (resolve, unknown id, hash mismatch) → VC-243.
- Server config with a missing env var or unknown key refuses to start → VC-261, VC-262, VC-265.

## 9. Open Questions

These decisions are **taken in the normative sections above as drafted** and need the owner's confirmation; each is removed (and the text kept or changed) when answered.

1. **Runtime dependencies in `@cge/config`** (`yaml`, `zod`, `esbuild`; DBR-009, DFR-080). Alternative: parse and bundle in a new `tools/` member so `config` stays dependency-free (more guardrail churn). Drafted: dependencies in `config`.
2. **Reducers resolved by reference, bound in P4** (DFR-064/065). Alternative: P2 executes the bundle to obtain functions (contradicts the plan's "built and hashed, not executed"). Drafted: references.
3. **Visibility vocabulary** (`public|hidden|owner|team` audiences; `public|subject|secret` field visibility; four grantable keys). P3 may refine meanings and add keys with a regression test here. Drafted: as in §7.1.
4. **Registry contract suite location**: `packages/config/src/registry-contract.testing.ts`, because Phase 0 forbids `packages/**` importing `conformance` (`layer-conformance-leaf`). P14's registry service will need it moved; deferred to then.

## 10. Assumptions

- A1. Node 22.23.3 / TypeScript 6.0.3 / Vitest 5.0.5 / fast-check 4.10.2 as pinned in Phase 0. Exact versions of `yaml`, `zod` and `esbuild` are chosen at implementation, recorded in the plan's DECISIONS log, and need no pnpm build-script approval beyond what `pnpm-workspace.yaml` already holds (if one is needed it is added there).
- A2. `yaml` is configured for YAML 1.2, `schema: core`, `uniqueKeys: true`, `merge: false`, with the alias and size limits applied by P2 code, not by library defaults alone.
- A3. `esbuild` output is deterministic for fixed inputs, options and version; replay packages detect any divergence by `DefinitionId` (`REPLAY_MISMATCH`, P3/P14).
- A4. The architecture A8 `game.yaml` and `server.yaml` snippets are illustrative; §7.1 and §7.5 are normative.
- A5. P1 code matches the frozen capsule `specs/01-phase-1-frozen.md` and the original P1 spec at `3bbdd4a` (verified against `packages/core/src/definition/{types,assert,data}.ts` and `replay/canonical/definition-schema.ts` on 2026-10-20). Counter `owner: player` takes a **seat** id as `owner_id` because players join at runtime.
- A6. `games/` stays empty in this phase; all fixtures are under `packages/config/fixtures/` and are excluded from the determinism lint scope (`games/*/hooks/**` only).
- A7. No hook runs in P2, so `HookRunner`, cost budgets and timeouts are values stored in `policies`/config and enforced nowhere yet.

## 11. Changelog

- 0.2 (2026-10-20): applied the cross-agent review (Codex, Cursor; arbiter-triaged). Renamed the hasher `computeDefinitionId` (export clash with the P1 `definitionId` validator) and named the identity schemas (DFR-042/043); bundle read only when `definitionNeedsBundle` (DFR-047/051/053, VC-237); function-presence flags removed from identity data (DFR-066, VC-255); derived-counter `min`/`initial` constants (DFR-016/063); generator `axes` is an ordered list (DFR-014); `ok` implies canonical-profile validity (DFR-010, VC-228); corrected DFR-065 and extended DBR-010 exceptions, fixture builders restated (§4.6); safe-integer rule (DFR-015); redaction by provenance and secret-must-be-placeholder (DFR-072, DBR-007); discriminated `store` defaults (DFR-073); function-free registry comparison (DFR-054); id charset (DFR-027, VC-229); error-assignment table (DFR-031, VC-211/213/218); YAML→P1 name map (§7.2); guardrail change confined to check 6 (DFR-080); named 20-game fixture (DNFR-004); P1 references repointed to the frozen capsule and the `3bbdd4a` spec, with the A4 licence restated inline.
- 0.1 (2026-10-20): initial draft from `docs/implementation_plan.md` Phase 2, the P1 spec and the as-built `packages/core/src/definition` types.
