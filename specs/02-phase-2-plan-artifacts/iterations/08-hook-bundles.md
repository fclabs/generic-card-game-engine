# Iteration 8: Hook bundle packaging

Commit: see `git log` (message `Phase 2 iteration 8: deterministic hook bundle build and bundle:games script`).

## Criteria
- VC-234 PASS: `pnpm build && pnpm exec vitest run packages/config` (`bundle.test.ts`): single `dist/hooks.js` with helper inlined, no relative `import`/`from`, readable names (unminified), no absolute path (checked against the temp root and common prefixes), no `sourceMappingURL`, manifest `{"exports":[...]}` sorted; second build byte-identical; BUNDLE_INVALID for syntax error, missing module file, and module exporting nothing while YAML references hooks (plus malformed `hooks.module`, missing hooks.module).
- Location independence PASS: same test copies the game to another directory -> identical `hooks.js`, manifest and returned info.
- DNFR-001 bundle part PASS: same tests (two builds identical bytes).
- VC-235 PASS: `static-no-exec.test.ts`: zero hits in `core/src/definition` and `config/src`; seeded `fixtures/static-violation/executes-bundle.ts.txt` is reported (`import(`).
- VC-236 PASS: `bundle.test.ts` runs `node packages/config/dist/bundle-games.js <root>` as a child process: two good games -> exit 0; with `broken` -> exit 1, stderr names `broken` and `BUNDLE_INVALID`; absent/empty root -> exit 0 with message. Also `pnpm bundle:games` at the repo root (no `games/`): exit 0, message.
- Guardrails PASS: `pnpm test:guardrails` (174 tests; `bundle:games` is in `docs/dev-setup.md`). `packages/config` `dependencies` = `@cge/core` `workspace:*`, `esbuild` `0.28.2`, `yaml` `2.9.1`.
- Gates PASS: `pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test && pnpm test:guardrails && pnpm format:check` exit 0 (973 tests).
- Artifacts PASS: CONTEXT.md, DECISIONS.md D-023..D-026, this record.

## Files
- Added: `packages/config/src/{bundle.ts,bundle-games.ts,bundle.test.ts,static-no-exec.test.ts}`, `packages/config/fixtures/hook-games/{good-basic,good-helper,broken}/**`, `packages/config/fixtures/static-violation/executes-bundle.ts.txt`.
- Changed: `packages/config/src/index.ts` (exports), `packages/config/package.json`, `pnpm-lock.yaml`, root `package.json` (`bundle:games`), `docs/dev-setup.md` (script row), `eslint.config.mjs`, `.dependency-cruiser.cjs` (fixtures exclusion), artifacts.

## Deviations
- Added `packages/config/fixtures/**` to the ESLint ignores and depcruise exclude (D-026); iteration 7 relied on data-only fixtures.
- `bundle:games` continues past a failing game and reports all failures (superset of "first failing game").
- Missing `game.yaml` in `buildHookBundle` returns `GAME_YAML_MISSING` (spec lists only BUNDLE_INVALID for module problems).

## Gotchas
- Local Node is 26 (engines warning only). esbuild resolves `./helper.js` to `helper.ts`.
- esbuild does not type-check: "type error" in VC-234 is covered by a syntax error fixture.
- Source comments must not contain `import(`, `require(`, `eval(` etc. (the static test scans comments too); BSD `sed -i` is unusable here, use Edit.
- `tsconfigRaw: {}` matters: without it esbuild would read `packages/config/tsconfig.json` for fixtures.

## For the next iteration
- Iteration 9 (registry): to get `HookBundleInfo` for a game that `definitionNeedsBundle(raw)`, read `dist/hooks.js` bytes and `dist/hooks.manifest.json` (`{"exports":[...]}`; use `HOOKS_BUNDLE_PATH`/`HOOKS_MANIFEST_PATH` from `./bundle.js`) and compute `hash = hookBundleHash(bytes, exports)`; do not call `buildHookBundle` in the registry (it writes files). Never execute the bundle (VC-235 scans `config/src`; keep forbidden tokens out of new non-test files and comments).
- Reuse `fixtures/hook-games/*` (copy to temp dirs, build with `buildHookBundle`) for registry bundle tests; `good-basic` has a valid YAML that compiles with its bundle.
- Docker/`bundle:games` wiring is iteration 11; `docs/dev-setup.md` already lists `bundle:games` (add `config:check` in iteration 10).
