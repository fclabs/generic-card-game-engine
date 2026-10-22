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
2. `package.json` `dependencies` using `workspace:*` `@cge/*` only, with one deliberate exception: `packages/config` also has the npm runtime dependencies `yaml`, `zod` and `esbuild`, each at an exact version (`packages/core` has no `dependencies` at all)
3. `dependency-cruiser` named rules (path **or** `@cge/*` specifier, including relative paths into another package’s `src`/`dist`)

Beyond the layering rules, the named rule `core-privileged-batch-opener` lets only `packages/core/src/visibility/**` and `packages/core/src/replay/**` import the `open-batch` module that opens a `PrivilegedBatch` (the opaque handle to a committed transaction; see [visibility.md](./visibility.md#fail-closed-types)). The rule also matches the built output (`packages/core/dist/...`) and `@cge/core/**open-batch` specifiers, so a file under another package, or a fixture tree, importing it fails `pnpm depcheck`. Tests beside the allowed sources are allowed too.

The named dependency rules that `pnpm depcheck` enforces, thirteen in all (the guardrail suite lists them in `SECTION_73_RULES`, and a fixture tree proves each one fails when violated):

| Rule | Forbids |
|------|---------|
| `layer-core-imports-nothing` | `core` importing any other workspace package |
| `layer-helpers-core-only`, `layer-config-core-only`, `layer-app-core-only` | those packages importing anything but `core` |
| `layer-adapters-no-server`, `layer-adapters-no-adapters`, `layer-adapters-allowed-only` | an adapter importing `server`, another adapter, or anything outside `core`, `app`, `config` |
| `layer-server-no-conformance`, `layer-conformance-leaf` | `server` importing `conformance`; any `packages/**` package importing `conformance` |
| `core-no-node` | any `node:*` or Node built-in import in `packages/core` |
| `core-privileged-batch-opener` | opening a `PrivilegedBatch` outside `core/visibility` and `core/replay` |
| `no-circular` | circular dependencies |
| `no-undeclared-deps` | importing a package not declared in `package.json` |

Intra-package imports use relative paths ending in `.js` (NodeNext ESM), never `@cge/<self>`.

Package names are `@cge/<dir>` for top-level packages and tools, and `@cge/adapter-<dir>` for adapters. Exactly thirteen workspace members today (twelve under `packages/**` plus `@cge/guardrails`). The local ESLint plugin lives in a plain `eslint/` directory so it does not become a fourteenth member.

## Determinism scope

Files under `packages/core/**`, `packages/helpers/**`, and `games/*/hooks/**`, excluding `*.test.ts`, must not use wall-clock time, OS randomness, scheduling, or host I/O.

**Banned globals** (rule `cge/no-nondeterministic-globals`): `Date`, `Math.random`, `performance`, `process`, `setTimeout`, `setInterval`, `setImmediate`, `queueMicrotask`, `Atomics`, `SharedArrayBuffer`, `fetch`, `XMLHttpRequest`, `WebSocket`, `crypto` / `globalThis.crypto` (and `globalThis.<banned>` generally). Messages name the offender. Local bindings that shadow a global are not reported.

**Banned imports** (rule `cge/no-nondeterministic-imports`): any `node:*` specifier or bare Node built-in (including subpaths such as `fs/promises`), via static `import`, dynamic `import()`, or `export … from`.

**Why.** Replay and digests require the same inputs to produce the same outputs. Time and host entropy in hooks or reducers would make that impossible. Tests are exempt so harnesses can use clocks and randomness; production domain tests will use a seeded PRNG by convention once domain code lands. `Promise` / `async` / `await` stay allowed — hooks are asynchronous — but `queueMicrotask` is treated as a scheduling API and banned.

`packages/core` source projects also set `"types": []`, so Node globals are a TypeScript error in non-test sources. Depcheck adds `core-no-node` as a second line of defence.

Rules are implemented in a local plugin (`eslint/cge-plugin.mjs`) with exact ids `cge/…`, and wired through a standalone flat-config array (`determinismConfig`) that the real ESLint config spreads in. That split lets the guardrail suite lint virtual fixture paths with the same syntactic rules without needing those paths to appear in a tsconfig (type-aware rules cannot).

## `packages/core` contents

`packages/core` is the domain kernel (see [domain-kernel.md](./domain-kernel.md)). Together with `packages/config` (next section) it is the only package allowed to hold source code beyond a placeholder export; the skeleton-purity repository invariant still applies to every other package.

| Folder under `src/` | Contents |
|---------------------|----------|
| `errors/` | `ErrorCode` union and `ERROR_CODES`, `EngineError`, `GameRejection`, `Result`, `ok` / `err` |
| `session/` | branded ids and guards, `Snapshot` / `deepFreeze`, state types, `createSession`, `maskGates`, `nextZoneId`, `ratioRound`, the seeded PRNG, action and macro types with `validateAction`, and `apply/` (the pipeline: admission, validation, expansion, `primitives/`, reducers, invariants, conservation, commit) |
| `definition/` | `CompiledGameDefinition` and its part types, `assertDefinitionStructure`, `definitionData`; `compile/` (the pure `game.yaml` compiler: `compileDefinition`, one module per section, strict readers, the error collector and `DEFINITION_ERROR_CODES`, limits, `definitionNeedsBundle`); `identity.ts` (`definitionContentHash`, `hookBundleHash`, `computeDefinitionId`); `identity-expected.json` and `fixtures/floor-definition.json` (committed hashes and the performance-floor fixture). See [game-definitions.md](./game-definitions.md) |
| `replay/canonical/` | `canonicalize`, `decodeCanonical` (`decode.ts`), `CanonicalSchema`, `CanonicalError`, `stateDigest`, pure-TypeScript SHA-256 and `golden-vectors.json` (see [canonical-json-profile.md](./canonical-json-profile.md)); `replay/index.ts` re-exports it |
| `replay/` | the replay package and the replay services (see [replay-package.md](./replay-package.md)): `package-schema.ts` (`replayPackageSchema`), `package.ts` (`ReplayPackage`, `encodePackage`, `decodePackage`, `buildPackage`), `replayer.ts` (`createReplayer`, `rebuild`, `advance`), `upgrade.ts` (`PackageUpgrader`, `PACKAGE_UPGRADERS`, `CURRENT_ACTION_SCHEMA_VERSION`, `assertUpgraderChain`, `upgradeToCurrent`), `forker.ts` (`forkFromSeq`), `replay-error.ts` (`ReplayError`), `resolved-definition.ts` (`ResolvedDefinition`) and the committed `golden-package.json` and `fixtures/` |
| `spi/` | rule SPI types only |
| `ports/` | port interfaces and payload types only, including `DefinitionRegistry`, `RegistryError` and `DefinitionSummary` (interface-only: its emitted JavaScript is empty) |
| `visibility/` | the projection layer (see [visibility.md](./visibility.md)): `roles.ts` (`buildRoleRegistry`, `validateViewer`), `policy.ts` (`buildVisibilityPolicy`, `resolveAudience`, `isEntitled`), `entitlement.ts` (grant-aware entitlement), `project-view.ts` (`projectView`), `project-delta.ts` (`projectDelta`, `projectLogEntry`), `would-reveal.ts` (`wouldReveal`), `make-view.ts` and `make-delta.ts` (the only constructors of the branded `View` and `Delta`), `privileged-batch.ts` (`sealBatch`) and `open-batch.ts` (the opener the dependency rule guards, never exported) |
| `util/` | internal helpers (UTF-8 encoder), not exported from the package |

Conventions inside the package: unit tests are `*.test.ts` next to the source; shared test builders and generators are `*.testing.ts` (excluded from the production `tsconfig.json`, compiled only by `tsconfig.test.json`, subject to the determinism lint and never exported from an index); committed fixtures (`golden-vectors.json`, `prng-vectors.json`, `golden-stream.json`, `golden-package.json`; the last is canonical bytes on one line and is listed in `.prettierignore`) sit beside the tests that assert them. A few tests read `packages/core/dist` (the emitted `spi` and `ports` JavaScript, and a child process that recompiles a definition in a second Node process) and so rely on the build that `pnpm test` runs first. The visibility and replay property tests run a fixed seed list and take about 95 seconds (visibility) and a few seconds (replay equivalence); `CGE_VISIBILITY_RUNS`, `CGE_REPLAY_RUNS` and `CGE_EDGE_RUNS` shorten them for a quick local run. `packages/core/package.json` has no runtime `dependencies`, and only `fast-check` and `vitest` as exact-pinned `devDependencies`.

## `packages/config` contents

`packages/config` is the Node-side companion of the kernel: everything that touches files, YAML, the bundler or the environment. It may import `@cge/core` and `node:*` (its `tsconfig.json` sets `types: ["node"]`; `packages/core` keeps `types: []`). It never executes a hook bundle: a static test scans its sources (and the compiler's) for dynamic import, `require`, `eval`, `new Function` and `vm`.

| Module under `src/` | Contents |
|---------------------|----------|
| `yaml.ts` | `parseYaml`: safe YAML 1.2 intake with size, alias, duplicate-key and forbidden-feature rules |
| `bundle.ts`, `bundle-games.ts` | `buildHookBundle`, `bundleGames` (esbuild, deterministic options) and the `bundle:games` entry script |
| `registry.ts` | `createFilesystemDefinitionRegistry`: loads every game under the search paths, resolves a `DefinitionId` and re-verifies it on every call |
| `server-config.ts` | `loadServerConfig` (YAML, `${ENV}` interpolation, `zod` validation, cross-field rules), `redactServerConfig`, `definitionLimitsFromConfig` |
| `config-check.ts`, `cli.ts` | `runConfigCheck` (argument handling, output and exit codes as data) and the `config:check` entry, the only file that reads `process.env` |
| `registry-contract.testing.ts`, `perf-fixture.testing.ts` | Test-only: the adapter-agnostic registry contract suite and the generator of a 20-game search path (excluded from the production `tsconfig.json`, never exported) |

`fixtures/` holds inert data: the floor-definition YAML, equivalence pairs, hook-bundle fixture games and a seeded violation for the static test. `.prettierignore`, the ESLint ignores and the dependency-cruiser excludes list `packages/config/fixtures/**`, because fixture games contain `.ts` sources that must not be linted or cruised. Fixture games are copied to a temporary directory before building, so no `dist/` appears in the tree. Documentation tests (`docs.test.ts`) read `docs/` and the sample `config/server.yaml` with `node:fs`.

The runtime dependencies are `yaml`, `zod` and `esbuild`, each at an exact version. They are pinned because a version change can change behaviour that is part of identity (an `esbuild` upgrade can change bundle bytes and therefore every `DefinitionId` that has a bundle).

## Build-first commands and `dist`-only exports

Every package’s `exports` map exposes only `"."` → `./dist/index.d.ts` / `./dist/index.js`. Cross-package imports therefore always resolve to built output.

**Why.** Clean checkouts and CI never depend on TypeScript path aliases into another package’s `src`. Consequently `lint`, `depcheck`, `test`, and `test:guardrails` each run `pnpm build` first.

Each package has two TypeScript projects:

- `tsconfig.json` — composite, sources only (excludes `*.test.ts`), emits `dist/`
- `tsconfig.test.json` — non-composite, `noEmit`, includes tests, references the source project, adds Node types

The root `tsconfig.json` is a solution file referencing the twelve `packages/**` source projects. `@cge/guardrails` is type-checked via `pnpm typecheck` but is not part of the solution emit (it has no public `src` / `exports`).

## Tests

- **Unit / property:** root `vitest.config.ts` runs `packages/**/*.test.ts` and `games/**/*.test.ts`. Core carries the kernel unit tests, `fast-check` property tests (atomicity, card membership, replay equivalence, conservation), a golden-digest stream, the compiler and identity tests and performance smoke tests. `packages/config` carries the YAML, bundle, registry, server-config, `config:check` (including child processes of the built CLI) and documentation tests. Performance bounds are strict under Docker or with `CGE_PERF_STRICT=1` and a 10x ceiling elsewhere.
- **Guardrails:** separate `vitest.guardrails.config.ts` so the unit suite never accidentally runs fixture-driven tests.
- Coverage is off unless `pnpm test:coverage` (V8 → `coverage/`, git-ignored).

## Guardrail suite

`tools/guardrails` proves that lint and depcheck rules reject violations and that repository invariants hold.

**Fixtures are inert in the real tree.** Deliberately bad code lives only under `tools/guardrails/fixtures/` and is excluded from ESLint, Prettier, `tsc`, Vitest’s unit config, and the real `depcheck` scan (`packages` + `games` only). The suite loads fixtures through the ESLint / dependency-cruiser APIs instead.

**Lint fixtures** are a typed table of code strings and virtual `filePath`s (never executed). The suite runs `lintText` against `determinismConfig` and separately asserts, via `calculateConfigForFile` on the real config, that the `cge/*` rules are enabled for in-scope paths and absent elsewhere.

**Depcruise fixtures** are miniature directory trees mirroring the repo layout. Each case expects an exact set of violated rule names (some forbidden edges fire more than one named rule). When cruising a fixture, the runner clears the real config’s `exclude` of the fixtures path so the case is actually analysed.

**Repo invariants** scan the real tree (and mutation copies under a temp dir) for package metadata, Node/pnpm/Docker pin agreement, placeholder tests, skeleton-only sources (every package except `packages/core` and `packages/config`), exact `devDependencies`, workspace-only runtime deps (plus the three named, exactly-pinned ones in `packages/config`), and documentation of root scripts / Docker / layering (see [dev-setup.md](./dev-setup.md)).

### Adding a fixture case

- Lint: append a row to the lint cases table with `id`, virtual `filePath`, `code`, and expected rule outcome.
- Depcruise: add `tools/guardrails/fixtures/depcruise/<case>/…` with minimal `package.json` files, register the expected rule-name set in the depcruise cases table, and keep fixture packages out of `pnpm-workspace.yaml` globs (they already are).

## Docker

Stages: `base` → `build` → `test`, and a fresh `runtime` from the same pinned base image (`node:22.23.3-alpine3.24`), not from `build`.

| Stage | Role |
|-------|------|
| `base` | Copy manifests + lockfile, `pnpm install --frozen-lockfile` (cached unless manifests change) |
| `build` | Full source, `pnpm build`, then `pnpm bundle:games` and staging of each game's `game.yaml` and `dist/` under `/out/games` |
| `test` | At image-build time: lint, typecheck, depcheck; default command `pnpm test:all` |
| `runtime` | Prod install only, no sources/tests/tools, `/app/games` copied from the build stage (empty when there are no games), non-root `node` (UID 1000), `/data` volume, read-only `/app` for the runtime user, `NODE_ENV=production`, `CMD` runs the server entry (placeholder that exits 0 today) |

Compose:

- `deploy/docker-compose.test.yml` — service `tests`
- `deploy/docker-compose.yml` — service `engine` (port 8080, `engine-data:/data`, read-only bind of `config/server.yaml` at `/etc/engine/server.yaml`, `ENGINE_HOST_KEY`)

`.dockerignore` drops `node_modules`, `.git`, `coverage`, `dist`, tsbuildinfo, and `.env*` from the build context, with a narrow re-include so a depcheck fixture that needs a tracked `dist` file still reaches the image.

## CI

GitHub Actions workflow: `lint` (lint + format check) → `typecheck` → `depcheck` → containerised `test` → `image` (runtime target, no registry login or push). Each job `needs` its predecessor. Installs use `--frozen-lockfile`. Third-party Actions are pinned to full commit SHAs. Native jobs cache the pnpm store; Docker jobs use Buildx with a shared GitHub Actions cache scope. Top-level workflow permissions are read-only contents; only the Docker jobs request cache write.

Remote proof of cache hits and failing-PR gating waits for a real pull request on GitHub.
