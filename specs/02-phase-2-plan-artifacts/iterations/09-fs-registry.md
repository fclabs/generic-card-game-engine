# Iteration 9: Filesystem DefinitionRegistry and contract suite

Commit: see `git log` (message `Phase 2 iteration 9: filesystem DefinitionRegistry with contract tests`).

## Criteria
- VC-241 PASS: `pnpm build && pnpm exec vitest run packages/config` (`registry.test.ts`): three valid games + `.gitkeep`, dot-directory and stray file ignored -> three summaries with distinct ids; empty/ignored-only path -> ok, zero; two invalid games -> one failure listing both, paths prefixed `<gameDir>/...`; YAML error prefixed with the directory. (A non-hidden empty directory is `GAME_YAML_MISSING`, per DFR-052, and is asserted.)
- VC-242 PASS: same file: `GAME_YAML_MISSING`, `GAME_ID_MISMATCH` (hearts/spades), `SEARCH_PATH_MISSING` for absent path and for a file, `DUPLICATE_ID` across two search paths, `UNSUPPORTED_SCHEMA_VERSION` (version 2); extra: `BUNDLE_MISSING` without `dist/`, `BUNDLE_INVALID` for a malformed manifest.
- VC-243 PASS: `runRegistryContract("filesystem", ...)`: resolve ok (data deep-equal, equal content hash, `assertDefinitionStructure`), unknown id, mismatch after YAML semantic edit (detail names old and actual id), mismatch after flipping one bundle byte, comment-only edit still ok, broken YAML -> `DEFINITION_INVALID`; extra: directory removed -> `DEFINITION_INVALID`, bundle removed -> `DEFINITION_INVALID`, non-string id -> not ok; no call throws. DBR-011 covered.
- VC-244 PASS (`CGE_PERF_STRICT=1`, Apple dev laptop, Node 26): 20-game load median-of-5 after warm-up = 20.8 ms (bound 5000 ms); `resolve` of the 700-card floor definition median-of-20 after 3 warm-ups = 0.05 ms (bound 50 ms). Without strict mode/`/.dockerenv` the bounds are x10. DNFR-004 satisfied.
- VC-237 leftover-`dist/` PASS: same `DefinitionId` for a no-hooks game with and without stray `dist/hooks.js` + manifest; editing the stray bundle later still resolves.
- VC-235 re-run PASS: `static-no-exec.test.ts` over `registry.ts` (no forbidden token, comments included). Note its scan skips `*.testing.ts`; `registry-contract.testing.ts` and `perf-fixture.testing.ts` are clean anyway.
- Gates PASS: `pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test && pnpm test:guardrails && pnpm format:check` exit 0 (995 tests, 174 guardrails). Temp directories are removed (checked `os.tmpdir()`).
- Artifacts PASS: CONTEXT.md (registry API, prefix format, contract usage), DECISIONS.md D-027..D-030, this record.

## Files
- Added: `packages/config/src/{registry.ts,registry.test.ts,registry-contract.testing.ts,perf-fixture.testing.ts}`.
- Changed: `packages/config/src/index.ts` (exports), `packages/config/tsconfig.json` (exclude `*.testing.ts`), artifacts. No dependency, lockfile, guardrail or docs change.

## Deviations
- The perf fixture is generated in `beforeAll` rather than committed (D-027).
- Contract-suite `bundleByte` edit is optional in the fixture type (adapters without bundles).

## Gotchas
- `packages/config/tsconfig.json` previously did not exclude `*.testing.ts`; a `*.testing.ts` importing `vitest` would have broken the production build. Now excluded.
- `@typescript-eslint/require-await` forbids `async` edit callbacks without `await`; edits are typed `void | Promise<void>`.
- A 4 KiB bundle needs ~3950 padding chars (esbuild drops comments).

## For the next iteration
- Iteration 10 (`zod`, server config) does not touch the registry. `limits` for `createFilesystemDefinitionRegistry` are a `DefinitionLimits {cascadeCapMax, costBudgetMax?}`; iteration 10 must expose how to build one from `ServerConfig` (`limits.cascadeCap.max`, `limits.hook.costBudget`).
- Iteration 11 `config:check`: call `createFilesystemDefinitionRegistry({searchPaths: config.games.searchPaths, limits})`; on failure print each error as `<path>: <code>: <detail>` (paths are already directory-prefixed), on success `OK <n> definitions`. Docker: games need `dist/` built by `pnpm bundle:games` before the runtime stage copies them, or the load fails `BUNDLE_MISSING`.
- Iteration 12: document the error-path prefix convention and the registry in `docs/workspace-architecture.md`.
