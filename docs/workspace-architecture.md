# Workspace architecture

Why the foundation is shaped the way it is: package boundaries, determinism,
build/test layout, guardrails, Docker, and CI. Companion to
[dev-setup.md](./dev-setup.md) (commands) and [architecture.md](./architecture.md)
(product-level design).

## Package layering

Dependency rule (short form used everywhere):

`core ← app ← adapters ← server`

| Package | May import |
|---------|------------|
| `core` | nothing |
| `helpers` | `core` |
| `config` | `core` |
| `app` | `core` |
| each `adapters/*` | `core`, `app`, `config` (not `server`, not another adapter, not `helpers` / `conformance`) |
| `server` | `core`, `app`, `config`, `helpers`, all adapters (not `conformance`) |
| `conformance` | `core`, `app`, `config`, `helpers`, adapters |
| nothing under `packages/**` | `conformance` |

**Why.** Hexagonal layout keeps the domain (`core`) free of I/O and host APIs so it can run in any JS runtime, including edge hosts later. Adapters stay swappable behind ports; they must not import each other or the composition root (`server`). `conformance` is a leaf consumer of public APIs, never a dependency of production packages.

Edges are expressed three ways so they fail early and consistently:

1. TypeScript `references` (illegal imports fail `pnpm build`)
2. `package.json` `dependencies` using `workspace:*` `@cge/*` only (no npm runtime deps in the foundation)
3. `dependency-cruiser` named rules (path **or** `@cge/*` specifier, including relative paths into another package’s `src`/`dist`)

Intra-package imports use relative paths ending in `.js` (NodeNext ESM), never `@cge/<self>`.

Package names are `@cge/<dir>` for top-level packages and tools, and `@cge/adapter-<dir>` for adapters. Exactly thirteen workspace members today (twelve under `packages/**` plus `@cge/guardrails`). The local ESLint plugin lives in a plain `eslint/` directory so it does not become a fourteenth member.

## Determinism scope

Files under `packages/core/**`, `packages/helpers/**`, and `games/*/hooks/**`, excluding `*.test.ts`, must not use wall-clock time, OS randomness, scheduling, or host I/O.

**Banned globals** (rule `cge/no-nondeterministic-globals`): `Date`, `Math.random`, `performance`, `process`, `setTimeout`, `setInterval`, `setImmediate`, `queueMicrotask`, `Atomics`, `SharedArrayBuffer`, `fetch`, `XMLHttpRequest`, `WebSocket`, `crypto` / `globalThis.crypto` (and `globalThis.<banned>` generally). Messages name the offender. Local bindings that shadow a global are not reported.

**Banned imports** (rule `cge/no-nondeterministic-imports`): any `node:*` specifier or bare Node built-in (including subpaths such as `fs/promises`), via static `import`, dynamic `import()`, or `export … from`.

**Why.** Replay and digests require the same inputs to produce the same outputs. Time and host entropy in hooks or reducers would make that impossible. Tests are exempt so harnesses can use clocks and randomness; production domain tests will use a seeded PRNG by convention once domain code lands. `Promise` / `async` / `await` stay allowed — hooks are asynchronous — but `queueMicrotask` is treated as a scheduling API and banned.

`packages/core` source projects also set `"types": []`, so Node globals are a TypeScript error in non-test sources. Depcheck adds `core-no-node` as a second line of defence.

Rules are implemented in a local plugin (`eslint/cge-plugin.mjs`) with exact ids `cge/…`, and wired through a standalone flat-config array (`determinismConfig`) that the real ESLint config spreads in. That split lets the guardrail suite lint virtual fixture paths with the same syntactic rules without needing those paths to appear in a tsconfig (type-aware rules cannot).

## Build-first commands and `dist`-only exports

Every package’s `exports` map exposes only `"."` → `./dist/index.d.ts` / `./dist/index.js`. Cross-package imports therefore always resolve to built output.

**Why.** Clean checkouts and CI never depend on TypeScript path aliases into another package’s `src`. Consequently `lint`, `depcheck`, `test`, and `test:guardrails` each run `pnpm build` first.

Each package has two TypeScript projects:

- `tsconfig.json` — composite, sources only (excludes `*.test.ts`), emits `dist/`
- `tsconfig.test.json` — non-composite, `noEmit`, includes tests, references the source project, adds Node types

The root `tsconfig.json` is a solution file referencing the twelve `packages/**` source projects. `@cge/guardrails` is type-checked via `pnpm typecheck` but is not part of the solution emit (it has no public `src` / `exports`).

## Tests

- **Unit / property:** root `vitest.config.ts` runs `packages/**/*.test.ts` and `games/**/*.test.ts`. Core carries one `fast-check` property placeholder.
- **Guardrails:** separate `vitest.guardrails.config.ts` so the unit suite never accidentally runs fixture-driven tests.
- Coverage is off unless `pnpm test:coverage` (V8 → `coverage/`, git-ignored).

## Guardrail suite

`tools/guardrails` proves that lint and depcheck rules reject violations and that repository invariants hold.

**Fixtures are inert in the real tree.** Deliberately bad code lives only under `tools/guardrails/fixtures/` and is excluded from ESLint, Prettier, `tsc`, Vitest’s unit config, and the real `depcheck` scan (`packages` + `games` only). The suite loads fixtures through the ESLint / dependency-cruiser APIs instead.

**Lint fixtures** are a typed table of code strings and virtual `filePath`s (never executed). The suite runs `lintText` against `determinismConfig` and separately asserts, via `calculateConfigForFile` on the real config, that the `cge/*` rules are enabled for in-scope paths and absent elsewhere.

**Depcruise fixtures** are miniature directory trees mirroring the repo layout. Each case expects an exact set of violated rule names (some forbidden edges fire more than one named rule). When cruising a fixture, the runner clears the real config’s `exclude` of the fixtures path so the case is actually analysed.

**Repo invariants** scan the real tree (and mutation copies under a temp dir) for package metadata, Node/pnpm/Docker pin agreement, placeholder tests, skeleton-only sources, exact `devDependencies`, workspace-only runtime deps, and documentation of root scripts / Docker / layering (see [dev-setup.md](./dev-setup.md)).

### Adding a fixture case

- Lint: append a row to the lint cases table with `id`, virtual `filePath`, `code`, and expected rule outcome.
- Depcruise: add `tools/guardrails/fixtures/depcruise/<case>/…` with minimal `package.json` files, register the expected rule-name set in the depcruise cases table, and keep fixture packages out of `pnpm-workspace.yaml` globs (they already are).

## Docker

Stages: `base` → `build` → `test`, and a fresh `runtime` from the same pinned base image (`node:22.23.3-alpine3.24`), not from `build`.

| Stage | Role |
|-------|------|
| `base` | Copy manifests + lockfile, `pnpm install --frozen-lockfile` (cached unless manifests change) |
| `build` | Full source, `pnpm build` |
| `test` | At image-build time: lint, typecheck, depcheck; default command `pnpm test:all` |
| `runtime` | Prod install only, no sources/tests/tools, non-root `node` (UID 1000), `/data` volume, read-only `/app` for the runtime user, `NODE_ENV=production`, `CMD` runs the server entry (placeholder that exits 0 today) |

Compose:

- `deploy/docker-compose.test.yml` — service `tests`
- `deploy/docker-compose.yml` — service `engine` (port 8080, `engine-data:/data`, read-only config bind, `ENGINE_HOST_KEY`)

`.dockerignore` drops `node_modules`, `.git`, `coverage`, `dist`, tsbuildinfo, and `.env*` from the build context, with a narrow re-include so a depcheck fixture that needs a tracked `dist` file still reaches the image.

## CI

GitHub Actions workflow: `lint` (lint + format check) → `typecheck` → `depcheck` → containerised `test` → `image` (runtime target, no registry login or push). Each job `needs` its predecessor. Installs use `--frozen-lockfile`. Third-party Actions are pinned to full commit SHAs. Native jobs cache the pnpm store; Docker jobs use Buildx with a shared GitHub Actions cache scope. Top-level workflow permissions are read-only contents; only the Docker jobs request cache write.

Remote proof of cache hits and failing-PR gating waits for a real pull request on GitHub.
