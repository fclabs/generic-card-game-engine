# CONTEXT: Phase 2 as shipped (final, after Iteration 12)

## Current state
- Phase 2 is complete. A game directory `games/<id>/{game.yaml,hooks.ts?}` becomes a content-addressed `CompiledGameDefinition` / `DefinitionId` through `parseYaml` -> `compileDefinition` -> `definitionContentHash` (+ `hookBundleHash`) -> `computeDefinitionId`. A filesystem `DefinitionRegistry` loads every game once and re-verifies on `resolve`. `loadServerConfig` validates `server.yaml`; `pnpm config:check` checks a config plus its games; the Docker image carries `/app/games`.
- Pure parts are in `packages/core` (no dependencies, `types: []`); everything with I/O, YAML, esbuild or env is in `packages/config` (`@cge/core` + exact `yaml 2.9.1`, `esbuild 0.28.2`, `zod 4.6.7`). Hooks and reducers are built and hashed, never executed.
- Human documentation is written: `docs/game-definition-schema.md`, `docs/server-config.md`, `docs/game-definitions.md`, plus updates to `dev-setup`, `workspace-architecture`, `canonical-json-profile`, `domain-kernel`, `troubleshooting`, `implementation_plan` and `README`. `packages/config/src/docs.test.ts` executes the examples in them (D-039).
- Gates: `pnpm test` 1112 tests, `pnpm test:guardrails` 174; P1 golden files byte-identical to `3bbdd4a` (pinned by SHA-256 in `business-rules.test.ts`, DBR-010).
- `games/` exists with only `.gitkeep` (do not delete it: `pnpm depcheck` scans `games`). No real game exists until P8a.

## File map
`packages/core/src/definition/`: `types.ts`, `assert.ts` (`assertDefinitionStructure`), `data.ts` (`definitionData`), `identity.ts`, `identity-expected.json`, `fixtures/floor-definition.json`, `index.ts`; `compile/`: `compile.ts` (`compileDefinition`, `SECTION_ORDER`), `errors.ts`, `limits.ts`, `constants.ts`, `strict.ts` (readers), `ids.ts`, `foreach.ts`, `seats.ts`, `zones.ts`, `cards.ts`, `axes.ts`, `template.ts`, `counters.ts`, `derived.ts`, `groups.ts`, `fields.ts`, `json-value.ts`, `bigint.ts`, `roles.ts`, `visibility.ts`, `control.ts`, `meta.ts`, `view-keys.ts`, `hooks.ts`, `policies.ts`, `references.ts`, `finalize.ts`; test builders `*.testing.ts` (`compile.testing.ts`, `full-definition.testing.ts` = `FULL_DEFINITION`/`FULL_BUNDLE`).
`packages/core/src/replay/canonical/definition-schema.ts` (`definitionIdentitySchema`, not on the package root); `core/ports/{types,index,ports.testing}.ts` (`DefinitionRegistry`, `RegistryError`, `DefinitionSummary`); `core/session/{create.ts,apply/primitives/{meta,roster}.ts}` (P1 adjustments).
`packages/config/src/`: `yaml.ts`, `bundle.ts`, `bundle-games.ts` (`bundle:games`), `registry.ts`, `server-config.ts`, `config-check.ts` (`runConfigCheck`), `cli.ts` (`config:check`, only `process.env` reader), `index.ts`; test-only `registry-contract.testing.ts`, `perf-fixture.testing.ts`; tests `yaml.test.ts`, `yaml-compile.test.ts`, `bundle.test.ts`, `static-no-exec.test.ts` (VC-235), `registry.test.ts`, `server-config.test.ts`, `config-check.test.ts` (child processes), `config-check-run.test.ts` (in process), `business-rules.test.ts` (DBR-001..011), `dbr-names.test.ts`, `docs.test.ts`. Fixtures: `packages/config/fixtures/{floor-definition.yaml,equivalence/,hook-games/{good-basic,good-helper,broken}/,static-violation/*.txt}` (excluded from lint, depcruise, prettier).
Elsewhere: `config/server.yaml`, `deploy/Dockerfile` (build stage runs `pnpm bundle:games`, stages `/out/games`; runtime copies it to `/app/games`), `tools/guardrails/{repo-invariants.ts,depcruise-cases.ts}` (check 4 exempts core+config; check 6 allows only the three named, exactly pinned deps in `packages/config/package.json`).

## Public interfaces
`@cge/core` (package root): `compileDefinition(raw, {bundle?: HookBundleInfo, limits?: DefinitionLimits}) -> {ok:true,value}|{ok:false,errors,truncated}` (never throws; <=100 errors in document order; `ok` implies identity-valid and structurally valid); `DefinitionError {code,path,detail,entity?}`, `DEFINITION_ERROR_CODES` (22), `MAX_DEFINITION_ERRORS`, `DEFAULT_DEFINITION_LIMITS {cascadeCapMax:256}`, `DefinitionLimits {cascadeCapMax; costBudgetMax?}`, `SUPPORTED_ACTION_SCHEMA_VERSIONS=[1]`, `GRANTABLE_VIEW_KEYS`, `definitionNeedsBundle(raw)`, `collectHookReferences(raw)`, `definitionContentHash(def)`, `hookBundleHash(bytes, exports)`, `computeDefinitionId(contentHash, bundleHash?)`, `definitionData`, new types `FieldVisibility`, `Audience`, `VisibilityRules`, `RoleDecl`, `DerivedSpec` and the `CompiledGameDefinition` additions (`gameId`, `roles`, `rosterReducerRef?`, card `initialMetadata`/`metadataVisibility`, zone `owner?`/`visibility`, counter `ownerId?`/`visibility`/`derivedSpec?`, meta `reducerRef`/`fieldVisibility`). Function-presence flags (`derived`, `hasReducer`, `hasRosterReducer`) no longer exist in identity data.
`@cge/config`: `parseYaml(text, {maxBytes?,maxAliases?}) -> Result<JsonValue, DefinitionError[]>` (1 MiB, 100 aliases); `buildHookBundle(gameDir)`, `bundleGames(root)`, `HOOKS_BUNDLE_PATH`, `HOOKS_MANIFEST_PATH`; `createFilesystemDefinitionRegistry({searchPaths, limits}) -> Result<{registry, definitions}, DefinitionError[]>`; `loadServerConfig(text, env) -> Result<ServerConfig, ConfigError[]>`, `redactServerConfig`, `definitionLimitsFromConfig`, `REDACTED`, `CONFIG_ERROR_CODES`, `SERVER_CAPABILITIES`. `Result` failure field is `error` (not `errors`). `runConfigCheck` and `CONFIG_CHECK_USAGE` are importable from `./config-check.js` only.
Behaviour details live in the docs now (schema: `docs/game-definition-schema.md`; identity, bundle, registry, decisions: `docs/game-definitions.md`; config and CLI: `docs/server-config.md`); `DECISIONS.md` holds the rationale. Facts that tests rely on and are easy to forget:
- Registry error `path` is `<searchPath>/<dir>[/<path>]`; `GAME_ID_MISMATCH` path `id`; duplicate game id path `<dir>/id`; `resolve` caches `game.yaml` (and bundle) bytes and only reloads on difference.
- `bundle:games` output `bundle:games: built <game> (<n> exports, <hash>)`; `config:check` output `OK <n> definitions` / `<path>: <code>: <detail>`; exit 0/1/2; host fallback warnings (D-036).
- Expected hashes are committed in `core/src/definition/identity-expected.json`; they change only with an intentional identity change.
- The registry contract suite is `runRegistryContract(adapter, factory)` (5 tests) in `config/src/registry-contract.testing.ts`.

## Conventions and invariants
- Strict ESM TS; `./….js` relative imports; explicit `vitest` imports; tests beside sources; test-only builders `*.testing.ts`; core has no `node:*`, no Date/Math.random/performance.now/process.env/crypto/timers. Non-test sources of `core/src/definition` and `config/src` must not contain `import(`, `require(`, `eval(`, `new Function`, `vm` (even in comments; VC-235 scan).
- `exactOptionalPropertyTypes`: omit optional members, never set `undefined`. `pnpm typecheck` also type-checks tests. Always use `pnpm lint`, not bare `eslint .`.
- Dependencies: exact versions; add with `pnpm --filter @cge/config add --save-exact <name>@<ver>`; only `yaml`, `zod`, `esbuild` allowed as runtime deps, only in config. A bump of `esbuild` can change every bundle id.
- A new root script must be listed in `docs/dev-setup.md` (invariant 7); that file must keep the exact string `docker compose -f deploy/docker-compose.test.yml run --rm tests`.
- Docs under `docs/**` are not formatted by Prettier; `README.md` is (run `pnpm exec prettier --write README.md`). Docs must not mention the plan, spec or artifact paths (`grep -rn "02-phase-2\|plan-artifacts" docs README.md` must be empty).
- Git: never `git add -A`; user-owned deletions of `specs/01-phase-1-plan*` and `specs/01-phase-1*` stay untouched.

## Commands
```
pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test && pnpm test:guardrails && pnpm format:check
pnpm test:coverage                                   # definition >= 95 % lines, config/src >= 90 % (see D-040)
pnpm build && pnpm exec vitest run packages/config   # CGE_PERF_STRICT=1 for strict perf bounds
pnpm build && pnpm exec vitest run packages/config/src/docs.test.ts
git diff 3bbdd4a -- packages/core/src/replay/canonical/golden-vectors.json   # must be empty
pnpm bundle:games [gamesRoot]
ENGINE_HOST_KEY=0123456789abcdef pnpm config:check [--server <path>] [--games <dir>...]
docker compose -f deploy/docker-compose.test.yml build && docker compose -f deploy/docker-compose.test.yml run --rm tests   # `run` alone reuses an old image
# image checks (remove the image afterwards):
docker build --progress=plain --no-cache -f deploy/Dockerfile --target runtime -t cge-runtime-check . 2>&1 | tee build.log
grep -c "bundle:games" build.log; docker run --rm --entrypoint ls cge-runtime-check /app/games
docker run --rm --entrypoint sh cge-runtime-check -c 'id -u; touch /app/x; echo $?'
docker run --rm -e ENGINE_HOST_KEY=xxxxxxxxxxxxxxxx -v "$PWD/config/server.yaml:/etc/engine/server.yaml:ro" --entrypoint node cge-runtime-check packages/config/dist/cli.js --server /etc/engine/server.yaml
docker rmi cge-runtime-check
```
(Node 26 on the dev machine warns about engines `>=22 <23`; harmless. The Docker image uses Node 22.23.3.)

## Known gaps and follow-ups
- Visibility declarations (`roles`, `visibility`, field visibility, `view_keys`) are validated, stored and in the identity but have no effect: Phase 3 compiles them into policy and projection.
- Reducer and hook functions are never loaded: Phase 4 binds reducers from the bundle onto the definition and verifies the manifest against the actual exports; until then declared reducers fail `REDUCER_ERROR` ("reducer not bound").
- `loadServerConfig` only returns errors: Phase 7 turns them into process exit and logs `redactServerConfig(config)` only.
- The registry is built once, filesystem only. Phase 14: registry service, pinning, hot reload; relocate `registry-contract.testing.ts` (the layering rule forbids `packages/**` importing `conformance`).
- esbuild strips types: hook type errors are not reported; `games/` hooks are not type-checked until P8a adds games.
- Compile errors carry a document path but no YAML line/column (YAML syntax errors do).
- Coverage: the default `pnpm test:coverage` report omits files that only run as child processes (`cli.ts`, `bundle-games.ts`); with every file forced in, `packages/config/src` is about 92 % (D-040).
