# Iteration 11: Sample config, `config:check`, Docker packaging

Commit: see `git log` (message `Phase 2 iteration 11: sample server.yaml, config:check and Docker game packaging`).

## Criteria
- VC-264 PASS: `pnpm build && pnpm exec vitest run packages/config/src/config-check.test.ts` (4 tests: ok with a 16-char key and `searchPaths ["/app/games"]`, `ENV_MISSING` when unset, `CONFIG_INVALID` at `auth.keys[0].secret` when empty, every `secret:` line contains `${`).
- VC-265 PASS: same file, 7 child-process tests of `dist/cli.js`: valid env -> exit 0 `OK 0 definitions`; key unset -> exit 1 `ENV_MISSING` + `ENGINE_HOST_KEY`; `--server` with an unknown key -> exit 1 `CONFIG_UNKNOWN_KEY`; invalid game -> exit 1 with its lines; plus missing `--games` dir, default-path fallback, unreadable server file (exit 1) and bad flags (exit 2).
- VC-272 PASS (actually run): `docker build --progress=plain --no-cache -f deploy/Dockerfile --target runtime -t cge-runtime-check .` exit 0; build log line `#25 [build 3/3] RUN pnpm bundle:games ...` and `bundle:games: no game declares hooks.module in /app/games`; `docker run --rm --entrypoint ls cge-runtime-check /app/games` exit 0; user `node` (uid 1000), `touch /app/x` and `/app/games/x` -> Permission denied; `/app`, `/app/games` are `dr-xr-xr-x root`. Extra: a throwaway game with `hooks.ts` yielded only `game.yaml`, `dist/hooks.js`, `dist/hooks.manifest.json` in the image; `node packages/config/dist/cli.js --server /etc/engine/server.yaml` inside the container (compose-style bind mount, key set) printed `OK 0 definitions`. Image removed with `docker rmi cge-runtime-check`. Exact commands: CONTEXT.md "Commands".
- Acceptance step 4 PASS: `ENGINE_HOST_KEY=xxxxxxxxxxxxxxxx pnpm config:check` -> exit 0, `OK 0 definitions` (plus two stderr warnings, D-036); `pnpm config:check` without the key -> exit 1, `ENV_MISSING`.
- Gates PASS: `pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test && pnpm test:guardrails && pnpm format:check` exit 0 (1074 tests; 174 guardrail tests, including the invariant that every root script is in `docs/dev-setup.md`).
- Artifacts PASS: CONTEXT.md, DECISIONS.md D-036..D-038, this record.

## Files
- Added: `config/server.yaml`, `packages/config/src/{cli,config-check,config-check.test}.ts`.
- Changed: `package.json` (`config:check`), `docs/dev-setup.md` (script row, compose note), `deploy/Dockerfile`, artifacts.
- Deleted: `config/.gitkeep`.

## Deviations
- Final acceptance step 4 holds only through D-036 (host without `/app/games`: warn, skip, fall back to `./games`). Strictly following DFR-075 would exit 1 with `SEARCH_PATH_MISSING` on a host.
- Exit code 2 for usage errors (spec names 0/1 only), D-037.

## Gotchas
- `bundle:games` is wired as its own `RUN` (it calls `pnpm build` itself, a no-op after the first). `docker build` needs `--no-cache` (or a fresh cache) for the log to show the step; with a warm cache the line appears as `CACHED`.
- `docs/dev-setup.md` previously said `up` cannot start without `config/server.yaml`; that sentence was replaced. Iteration 12 still owns the larger rewrite of that doc.
- Compose passes `ENGINE_HOST_KEY` as empty when unset (`${ENGINE_HOST_KEY:-}`), which yields `CONFIG_INVALID` (redacted) rather than `ENV_MISSING`.

## For the next iteration
- Iteration 12: rerun the VC-272 commands from CONTEXT.md in the final gate; `docs/server-config.md` should describe `config:check` (flags, exit codes 0/1/2, the host-fallback and warnings, D-036/D-037), the sample file, and the empty-env behaviour above. Docs already mention `config:check` in `docs/dev-setup.md` (row added here).
