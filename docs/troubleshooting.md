# Troubleshooting

Operational limits and failures that show up often while working in this workspace.

## Known limits

- **Node 22 only.** The repo pins Node `22.23.3`. A newer system Node (for example 26.x) will disagree with `.nvmrc`, `engines`, and the Docker image. Activate Node 22 before every command (see [dev-setup.md](./dev-setup.md)).
- **macOS and Linux only.** Windows (native, WSL, Docker Desktop on Windows) is unsupported.
- **The sample server config needs a key.** `config/server.yaml` reads `ENGINE_HOST_KEY` (16 to 256 characters). Export it before `docker compose -f deploy/docker-compose.yml up`; an unexported variable reaches the container as an empty string and fails validation (see below). `docker compose -f deploy/docker-compose.yml config` validates the compose file without starting anything.
- **Runtime image is a placeholder.** The default command is `node packages/server/dist/index.js`, which currently exits 0 immediately. There is no `/healthz` / `/readyz` yet, and nothing yet turns a failing `loadServerConfig` into a process exit: use `pnpm config:check`.
- **Definitions are built and hashed, never run.** Visibility declarations, hook execution and reducer binding are later phases; see [game-definitions.md](./game-definitions.md#limitations).
- **Remote CI timings and gating** (cold/warm container jobs on GitHub-hosted runners, cache-hit logs, “forbidden commit fails at lint and skips later jobs”) are verified statically in-repo; end-to-end proof waits for the first real pull request.

## Common gotchas

### Wrong Node on PATH

Symptoms: unexpected TypeScript/ESLint behaviour, or invariant failures about `.nvmrc` vs Docker. Fix: prepend the Node 22 binary directory (Homebrew example in [dev-setup.md](./dev-setup.md)) and re-check `node -v` / `pnpm -v`.

### Build runs before lint / depcheck / tests

`pnpm lint`, `pnpm depcheck`, `pnpm test`, and `pnpm test:guardrails` all start with `pnpm build`. A type error in a package source fails the script before ESLint or depcheck runs. For an isolated rule check on a throwaway file, use `pnpm exec eslint <path>` or `pnpm exec depcruise packages --config .dependency-cruiser.cjs`.

### Stale `dist/` or `*.tsbuildinfo`

After moving or deleting sources, an old emit can confuse resolution. Clean and rebuild:

```sh
rm -rf packages/*/dist packages/adapters/*/dist packages/*/*.tsbuildinfo packages/adapters/*/*.tsbuildinfo
pnpm build
```

### Compose image hides host edits

The `test` image bakes sources at build time (no bind mount). `docker compose ... run` reuses an existing image and does not rebuild it. After changing tests or sources on the host, run `docker compose -f deploy/docker-compose.test.yml build` (or `docker compose -f deploy/docker-compose.test.yml run --build --rm tests`) first, or the old sources are tested.

### Docker layer cache invalidation

- Source-only `.ts` edits should leave the `pnpm install` layer **CACHED**.
- Touching any `package.json`, `pnpm-lock.yaml`, or `pnpm-workspace.yaml` re-runs install.
- `.dockerignore` must keep the narrow re-include for guardrail fixture `dist` files; dropping it breaks a relative-into-dist layering check inside the container.

### pnpm / Corepack

Use the exact pnpm from `packageManager` (`10.15.1`). A globally installed newer pnpm can rewrite the lockfile. Prefer `corepack enable` and `corepack prepare pnpm@10.15.1 --activate`, and always `pnpm install --frozen-lockfile` in CI-like flows.

### Guardrail fixtures vs the real tree

Fixtures under `tools/guardrails/fixtures/` contain deliberately illegal code. They must never be picked up by `pnpm lint`, `pnpm depcheck`, or the unit Vitest config. If a real command suddenly fails mentioning a fixture path, an ignore/exclude regressed.

### ESLint / Prettier comment traps

Block comments must not contain the two-character sequence that closes a JSDoc/block comment mid-glob (for example writing star-slash next to a path glob). Prefer wording that avoids that sequence, or the toolchain fails to parse the file.

### JSDoc in invariant helpers

Same star-slash trap applies inside `tools/guardrails` sources consumed by Vitest’s parser.

### actionlint / workflow edits

`.github/**/*.yml` is formatted by Prettier (not ignored). After editing the workflow, run `pnpm format` (or format that file) before `pnpm format:check`.

## Game definitions and server configuration

Details and the full code lists are in [game-definition-schema.md](./game-definition-schema.md), [game-definitions.md](./game-definitions.md) and [server-config.md](./server-config.md). The quickest way to see every problem at once is:

```sh
pnpm bundle:games
ENGINE_HOST_KEY=0123456789abcdef pnpm config:check --games games
```

### Definition failures

Each error is `<path>: <code>: <detail>`; game errors start with the game directory.

| Code | Usual cause and fix |
|------|---------------------|
| `BUNDLE_MISSING` | The game references hooks but `dist/hooks.js` or `dist/hooks.manifest.json` does not exist. Run `pnpm bundle:games`. Host `dist/` is git-ignored and never copied into Docker; the image build runs the bundler itself. |
| `UNKNOWN_HOOK_EXPORT` / `MISSING_HOOK_MODULE` | `game.yaml` names a function `hooks.ts` does not export, or references hooks without `hooks.module`. Rebuild the bundle after editing `hooks.ts`. |
| `BUNDLE_INVALID` | The build failed: syntax error, missing file, import of a Node built-in or npm package (only files inside the game directory resolve), or no exports while hooks are referenced. |
| `DEFINITION_HASH_MISMATCH` / `DEFINITION_INVALID` (from `resolve`) | The game's files changed after the registry loaded. Reload (restart) the registry; the registry is built once. |
| `GAME_ID_MISMATCH` / `GAME_YAML_MISSING` / `SEARCH_PATH_MISSING` | Directory name differs from `id`; a non-hidden directory without `game.yaml`; a configured search path that is not a directory. |
| `SCHEMA_UNKNOWN_KEY`, `SCHEMA_TYPE`, `INVALID_VALUE` | A typo, a value of the wrong type or out of range. The schema is strict: nothing is ignored or coerced. Integers beyond 2^53 - 1 must be quoted strings. |
| `YAML_FORBIDDEN_FEATURE` | A tag, merge key (`<<`), non-string key, second document, empty file or too many aliases. `yes`/`no` are plain strings in YAML 1.2. |
| Fewer errors than expected | Sections that depend on a failed one are skipped (everything after invalid `seats`); the list is capped at 100. Fix and re-run. |
| Different id on two machines for the same YAML | Different bundle bytes: use `pnpm install --frozen-lockfile` so both build with the same pinned `esbuild`. |

### Server configuration failures

| Code | Usual cause and fix |
|------|---------------------|
| `ENV_MISSING` | A `${NAME}` whose variable is not set in the shell running the command. |
| `CONFIG_INVALID` with `got <redacted>` | The value came from the environment (or is a secret): empty, too short (secrets need 16 to 256 characters) or not in range. Docker Compose passes an unexported variable as an empty string, which lands here instead of `ENV_MISSING`. |
| `ENV_SYNTAX` or a YAML syntax error near a `secret:` | A malformed placeholder, or an unquoted `${NAME}` inside `{ ... }`: quote it as `"${NAME}"`. |
| `CONFIG_UNKNOWN_KEY` | A misspelt key. |
| `config:check` prints `warning: ... SEARCH_PATH_MISSING ... skipped` | `/app/games` exists only in the image. Pass `--games <dir>` to check a directory on your machine. |

## Quick health check

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"   # macOS Homebrew; adjust as needed
pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck && pnpm depcheck
pnpm test:all
docker compose -f deploy/docker-compose.test.yml run --rm tests
```

All of the above should exit 0 on a clean tree.
