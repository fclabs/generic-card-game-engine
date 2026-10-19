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

Prettier ignores `docs/**`, the lockfile, `LICENSE`, `dist/`, `coverage/`, and guardrail fixtures (plus a few other tracked trees listed in `.prettierignore`). Markdown under `docs/` is left untouched by `format` / `format:check`.

### Docker commands

Containerised full suite (build `test` stage, run unit + guardrails):

```sh
docker compose -f deploy/docker-compose.test.yml run --rm tests
```

Expected: exit 0; Vitest reports the unit suite, then the guardrail suite.

Runtime compose file (service `engine`). Validate without starting:

```sh
docker compose -f deploy/docker-compose.yml config
```

Expected: exit 0; output defines service `engine`, target `runtime`, port 8080, volume `engine-data`, env `ENGINE_HOST_KEY`.

To start the service (when a host config file exists):

```sh
docker compose -f deploy/docker-compose.yml up
```

In the current foundation, `config/server.yaml` is not present, so `up` cannot start `engine`. Use `config` for validation until that file lands.

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
