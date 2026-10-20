# Iteration 10: Server configuration loader

Commit: see `git log` (message `Phase 2 iteration 10: server.yaml loader with zod validation and env interpolation`).

## Criteria
- VC-260 PASS: `pnpm build && pnpm exec vitest run packages/config` (`server-config.test.ts`): full config (every key, camelCase, `2h` -> 7200000), minimal config (all defaults, `15m` -> 900000, `250ms` -> 250, sqlite store block), memory store (`{kind:'memory'}`, no `sqlite` property), partial sqlite defaults, duration units, `definitionLimitsFromConfig`, `redactServerConfig`.
- VC-261 PASS: same file: `${A}-${B}` substituted; `ENV_MISSING` (variable + path, no values); empty string present (then rejected as short secret); `${}`, `${1X}`, `${A`, `$${A}` -> `ENV_SYNTAX`; `${X}` in a key -> `CONFIG_UNKNOWN_KEY`; interpolated invalid `logging.level` (`LVL=trace`) -> `CONFIG_INVALID` with `<redacted>` and no `trace`; partly interpolated value redacted; literal invalid value shown; literal secret `0123456789abcdef` redacted; a scan over all error JSON for every substituted value and secret.
- VC-262 PASS: unknown keys at top level, `server`, `server.http`, `auth.keys[0]`; ports 0/65536/"8080"/8080.5/`2_000_000`/null; durations `15`, `0s`, `25h`, `999ms`, `1.5s`, `5d`; `mode: oauth`, `can: [root]`, `can: []`, duplicate caps, `keys: []`, id charset, secret 15/257 (16/256 ok), relative search path, `level: trace`; missing `auth` -> `CONFIG_MISSING` (also nested); 120 errors -> 100.
- VC-263 PASS: cascade default 300 / max 256 (names `limits.cascade_cap.max`), lowered max vs implicit default, memory + `store.sqlite` (path `store.sqlite`, names `store.kind`), duplicate key ids and search paths (path = later index, detail names the first path), combined case.
- Dependencies PASS: `packages/config` `dependencies` = `@cge/core` `workspace:*`, `esbuild` 0.28.2, `yaml` 2.9.1, `zod` 4.6.7; `pnpm install --frozen-lockfile` ok; `pnpm test:guardrails` 174 pass.
- Gates PASS: `pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test && pnpm test:guardrails && pnpm format:check` exit 0 (1063 tests; the VC-235 scan passes over `server-config.ts`).
- Artifacts PASS: CONTEXT.md (config API, `ServerConfig`, error and redaction rules), DECISIONS.md D-031..D-035, this record.

## Files
- Added: `packages/config/src/server-config.ts`, `packages/config/src/server-config.test.ts`.
- Changed: `packages/config/src/index.ts` (exports), `packages/config/package.json` (zod), `pnpm-lock.yaml`, artifacts. `packages/core`, guardrails, docs untouched.

## Deviations
- `limits.cascade_cap.default` is range-checked 1-4096 by the schema and 1-256 by a cross-field rule, so VC-263's "default 300, max 256" names both paths (D-034).
- ENV errors are returned alone, without schema errors (D-032).
- Extra exports beyond the plan: `definitionLimitsFromConfig`, `redactServerConfig`, `REDACTED`, `CONFIG_ERROR_CODES`, `SERVER_CAPABILITIES` (D-035).

## Gotchas
- YAML flow mappings need quoted placeholders (`{secret: "${KEY}"}`); unquoted `${KEY}` inside `{...}` is a YAML syntax error. Same for `config/server.yaml`: quote or use block style.
- zod 4 reports a missing required key as a `custom`/`invalid_type` issue with no distinguishing flag; "missing" is decided by looking the issue path up in the data.
- `ConfigError` has no `entity`; the failure field of `Result` is `error`.
- Key names keep YAML spelling for durations (`idleTtl`, `timeout`), values are milliseconds.

## For the next iteration
- Iteration 11: write `config/server.yaml` with `secret: "${ENGINE_HOST_KEY}"`, `games.search_paths: [/app/games]` (VC-264). `config:check`: read the file, call `loadServerConfig(text, process.env)`; on failure print `<path>: <code>: <detail>` per error; on success build the registry with `limits: definitionLimitsFromConfig(config)` and `searchPaths: config.games.searchPaths`; never print the config itself, only `redactServerConfig(config)` if needed. The memory store with a missing `ENGINE_HOST_KEY` reports `ENV_MISSING` naming the variable; an empty value reports `CONFIG_INVALID` at `auth.keys[0].secret` with `<redacted>`.
- Iteration 12: `docs/server-config.md` must cover every key of §7.5 (YAML names), the error codes, the redaction rule and the quoting gotcha.
