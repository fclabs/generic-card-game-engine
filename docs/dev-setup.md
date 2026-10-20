# Developer setup

How to install the toolchain, run every root script, and add a package.
Supported platforms: **macOS** and **Linux** only — Windows (native, WSL, or Docker Desktop) is out of scope.

## Toolchain

| Tool | Exact version | Where it is pinned |
|------|---------------|--------------------|
| Node | `22.23.3` | `.nvmrc`, `package.json` `engines.node` (`>=22 <23`), Docker base image |
| pnpm | `10.15.1` | `package.json` `packageManager` (`pnpm@10.15.1`), enabled via Corepack in Docker |

### Activate Node 22 (macOS Homebrew)

The machine’s default `node` may be newer than 22. Prefer the Homebrew keg:

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node -v   # expect v22.23.3
pnpm -v   # expect 10.15.1 (enable with: corepack enable && corepack prepare pnpm@10.15.1 --activate)
```

With `nvm` / `fnm` / `volta`, install and select the version in `.nvmrc` instead.

### First install

From the repository root:

```sh
pnpm install --frozen-lockfile
```

Expect exit 0. `pnpm -r list --depth -1` lists exactly **13** `@cge/*` workspace members.

## Command reference

Every command below is run from the repository root under Node 22 / pnpm as above.
Several scripts begin with `pnpm build` so a clean checkout never needs a separate compile step before lint, depcheck, or tests.

| Script | Command / meaning | Expected result |
|--------|-------------------|-----------------|
| `build` | `tsc -b` on the root solution | Exit 0; emits `dist/` for every package |
| `lint` | Build, then ESLint with `--max-warnings 0` | Exit 0; no lint findings |
| `format` | Prettier write | Exit 0; tracked files rewritten (see note below) |
| `format:check` | Prettier check | Exit 0 on a clean tree |
| `typecheck` | Build, then `tsc -p tsconfig.test.json` in every package | Exit 0; sources and tests type-check |
| `depcheck` | Build, then dependency-cruiser over `packages` and `games` | Exit 0; no layering / Node-in-core / cycle / undeclared-dep violations |
| `test` | Build, then Vitest over `packages/**` and `games/**` | Exit 0; placeholder unit (and core property) tests pass |
| `test:guardrails` | Build, then Vitest over `tools/guardrails` | Exit 0; lint/depcheck fixtures and repo invariants hold |
| `test:all` | `pnpm test` then `pnpm test:guardrails` | Exit 0 only if both succeed |
| `test:coverage` | Same as `test` with V8 coverage | Exit 0; writes `coverage/` (git-ignored) |
| `bundle:games` | Build, then `node packages/config/dist/bundle-games.js [gamesRoot]`: builds `dist/hooks.js` and `dist/hooks.manifest.json` for every `games/<id>/` whose `game.yaml` sets `hooks.module` (default root `games`) | Exit 0 (also when there are no games); exit 1 naming each failing game. Bundles are built and hashed, never executed |
| `config:check` | Build, then `node packages/config/dist/cli.js [--server <path>] [--games <dir>…]`: loads `config/server.yaml` (or `--server`) with `process.env`, then builds the filesystem definition registry over `games.search_paths` (or the `--games` directories) | Exit 0 and prints `OK <n> definitions`; exit 1 with one `<path>: <code>: <detail>` line per error on stderr (for example `ENV_MISSING` when `ENGINE_HOST_KEY` is unset); exit 2 on a bad command line. Needs `ENGINE_HOST_KEY` (16–256 characters) set. A configured search path missing on the host (`/app/games` outside Docker) is skipped with a warning and `./games` is checked instead; secrets are never printed |

Prettier ignores `docs/**`, the lockfile, `LICENSE`, `dist/`, `coverage/`, and guardrail fixtures (plus a few other tracked trees listed in `.prettierignore`). Markdown under `docs/` is left untouched by `format` / `format:check`.

### Docker commands

Containerised full suite (build `test` stage, run unit + guardrails):

```sh
docker compose -f deploy/docker-compose.test.yml run --rm tests
```

Expected: exit 0; Vitest reports the unit suite, then the guardrail suite. Inside the test image the performance bounds are strict. `run` reuses an image built earlier and does not rebuild it: after changing sources run `docker compose -f deploy/docker-compose.test.yml build` first (or add `--build` to `run`), otherwise the old sources are tested.

Runtime compose file (service `engine`). Validate without starting:

```sh
docker compose -f deploy/docker-compose.yml config
```

Expected: exit 0; output defines service `engine`, target `runtime`, port 8080, volume `engine-data`, env `ENGINE_HOST_KEY`.

To start the service:

```sh
export ENGINE_HOST_KEY=0123456789abcdef   # 16 to 256 characters; the sample config reads it
docker compose -f deploy/docker-compose.yml up
```

`config/server.yaml` is mounted read-only at `/etc/engine/server.yaml`. Compose passes an unexported `ENGINE_HOST_KEY` as an **empty string**, which the configuration loader rejects (see [server-config.md](./server-config.md)); the image itself still runs a placeholder server entry (see [troubleshooting.md](./troubleshooting.md)).

The runtime image holds `/app/games` (each game's `game.yaml` and built `dist/`, empty when `games/` has no games). The `build` stage runs `pnpm bundle:games` after `pnpm build`; host `dist/` directories are never copied into the build context.

### Game definitions and server configuration

Two scripts work with the files a game author and an operator write ([game-definitions.md](./game-definitions.md), [server-config.md](./server-config.md)):

```sh
# Build every games/<id>/dist/hooks.js (+ manifest) whose game.yaml sets hooks.module.
pnpm bundle:games                    # exit 0 when there are no games; exit 1 names each failing game
pnpm bundle:games path/to/games      # another games root

# Validate config/server.yaml and every game under its search paths, as the server will load them.
export ENGINE_HOST_KEY=0123456789abcdef
pnpm config:check                                   # prints "OK <n> definitions", exit 0
pnpm config:check --server path/to/server.yaml      # another server config
pnpm config:check --games games other/games         # check these game directories instead
```

`config:check` exit codes: `0` valid, `1` validation errors (one `<path>: <code>: <detail>` line each on stderr), `2` bad command line. Without `ENGINE_HOST_KEY` it fails with `ENV_MISSING`. On a machine without `/app/games` it warns on stderr, skips that search path and checks `./games` instead (see [server-config.md](./server-config.md#checking-a-configuration-pnpm-configcheck)). Neither script ever executes hook code.

Run a single package's tests, with the strict performance bounds that Docker applies:

```sh
pnpm build && CGE_PERF_STRICT=1 pnpm exec vitest run packages/config packages/core/src/definition
```

Coverage: `pnpm test:coverage` writes `coverage/` and prints a per-folder table. Entry scripts that only run as child processes (`cli.ts`, `bundle-games.ts`) do not appear in it unless included explicitly (`--coverage.include='packages/config/src/**'`).

### Handy one-liners

```sh
# Native “is everything green?”
pnpm lint && pnpm format:check && pnpm typecheck && pnpm depcheck && pnpm test:all

# Runtime image (local tag)
docker build --target runtime -f deploy/Dockerfile -t cge-runtime:local .
docker run --rm cge-runtime:local   # exits 0 immediately (placeholder server entry)
```

## Package dependency rule

Workspace packages follow:

`core ← app ← adapters ← server`

`core` imports nothing from other workspace packages and nothing from Node.
`helpers` and `config` may import only `core`.
Each adapter may import `core`, `app`, and `config` (not `server`, not another adapter, not `helpers`/`conformance`).
`server` may import `core`, `app`, `config`, `helpers`, and adapters (not `conformance`).
`conformance` may import the public packages and adapters; nothing under `packages/**` imports `conformance`.

These edges are enforced by TypeScript project references, `package.json` `dependencies`, and `pnpm depcheck`.

## Adding a package

1. **Create the directory** under `packages/<name>/` or `packages/adapters/<name>/` with `package.json` (`name` `@cge/<name>` or `@cge/adapter-<name>`, `type: "module"`, `private: true`, `engines.node: ">=22 <23"`, `exports` pointing only at `./dist/index.d.ts` and `./dist/index.js`), `tsconfig.json`, `tsconfig.test.json`, and `src/index.ts` (`export {};` until real code lands).
2. **Register TypeScript references** (and matching `dependencies` / depcheck edges): add the new project to the root solution `tsconfig.json` `references`, and to every package that may import it per the layering rule above. Declare `"@cge/…": "workspace:*"` only where the rule allows.
3. **Add `src/index.test.ts`** with at least one passing Vitest test, and declare the same exact `vitest` version as every other package in that package’s `devDependencies`.

Then run `pnpm install`, `pnpm build`, `pnpm lint`, `pnpm depcheck`, and `pnpm test:all`.

## Running a single test

```sh
pnpm build && pnpm exec vitest run packages/core/src/index.test.ts
pnpm build && pnpm exec vitest run --config vitest.guardrails.config.ts tools/guardrails/repo-invariants.test.ts
```

## Interpreting failures

| Failure | Likely cause |
|---------|----------------|
| `cge/no-nondeterministic-globals` / `cge/no-nondeterministic-imports` | Non-deterministic API used under `packages/core`, `packages/helpers`, or `games/*/hooks` (tests are exempt). |
| `core-no-node` (depcheck) | `packages/core` source imported a Node built-in. |
| `layer-*` (depcheck) | Import crosses a forbidden package boundary (including relative paths into another package’s `src`/`dist`). |
| `no-circular` / `no-undeclared-deps` | Import cycle, or an npm package used without declaring it in that package’s own `package.json`. |
| Guardrail suite red, real tree green | A rule or invariant check regressed; fixtures under `tools/guardrails/fixtures/` are never part of the real lint/depcheck run. |
| Repo-invariant message naming a file | Package metadata, Node/pnpm/Docker pin mismatch, missing placeholder test, non-skeleton source, ranged `devDependencies`, or non-workspace runtime dependency. |
| `pnpm lint` fails on a scratch file that “looks fine” | `lint` runs `build` first; type errors in `packages/core` sources fail the build step. Use `pnpm exec eslint <file>` for isolated rule checks. |
