# Spec 00 — Phase 0: Foundation and tooling

**Status:** Draft v2 (review findings applied)
**Source:** `docs/implementation_plan.md` (Phase 0), `docs/architecture.md` (A3, A4 determinism rules, A9, A10)
**Depends on:** nothing
**Requirement ID range:** FR-001–FR-099, BR-001–BR-099, NFR-001–NFR-099 are local to this spec (later phase specs use their own ranges; references to the product-level `docs/requirements.md` IDs are always written in full, e.g. "requirements NFR-062").

---

## 1. Purpose

Phase 0 delivers an empty but fully working workspace for the Generic Card Game Engine: it builds, lints, type-checks, tests and containerises, and the architectural rules (hexagonal layering, no I/O in the domain core, deterministic hook code) are enforced mechanically from the first commit. Without it, later phases could silently violate those rules and the violations would be expensive to unwind. The beneficiaries are the engineers (and AI agents) implementing Phases 1–14: they get a single trusted definition of "green" that runs identically locally and in CI.

Phase 0 contains **no domain logic**. Every package is a skeleton that exports nothing meaningful.

---

## 2. Scope

### In
- pnpm workspace with the package and directory layout of architecture A3: `packages/{core,app,config,helpers,conformance,server}`, `packages/adapters/{store-memory,store-sqlite,transport-http,transport-ws,authz-static,timer-host}`, `games/` (empty, with a `.gitkeep`), `deploy/`, `config/`; plus one tooling package, `tools/guardrails` (not part of A3; see FR-040–FR-043).
- Internal sub-folders of `packages/core` named in A3 (`session`, `definition`, `visibility`, `replay`, `spi`, `ports`, `errors`) and of `packages/app` (`proposal-handler`, `session-registry`, `publisher`, `session-factory`, `package`), each containing only an `index.ts` that exports nothing (`export {};`).
- TypeScript project references, strict mode, ESM-only, Node 22 LTS.
- Vitest, `fast-check`, ESLint, Prettier configured and runnable.
- `dependency-cruiser` configuration enforcing layering and the "no Node built-ins in `core`" rule.
- ESLint determinism rules for `packages/core`, `packages/helpers` and `games/*/hooks`.
- Multi-stage `Dockerfile` (`base`, `build`, `test`, `runtime`), `deploy/docker-compose.yml`, `deploy/docker-compose.test.yml`.
- CI pipeline definition: lint → typecheck → depcheck → containerised tests → image build.
- A "guardrail" suite proving the lint and depcheck rules actually reject violations and that repository invariants hold (FR-040–FR-043).
- One placeholder test per workspace package plus one placeholder property test, executed in the `test` container.
- A `README.md` section (or `docs/dev-setup.md`) documenting the commands.

### Out
- Any domain type, port interface, error code, canonical-JSON code or session logic (Phase 1).
- A sample `config/server.yaml` and the config schema (Phase 2); `config/` holds only a `.gitkeep`.
- Fastify, `pino`, SQLite, `zod`, `immer` or any other runtime dependency (each is introduced by the phase that uses it). Phase 0 runtime dependencies: none.
- A running server, `/healthz`, `/readyz` (Phase 7). The `runtime` image only has to build and its default command exits 0.
- Image vulnerability scanning, SBOM, `tinybench`, `/metrics` (Phase 9).
- Release tagging, changelog tooling, publishing to an npm registry.
- The rule "`games/**` must not import `core`/`app`/`adapters`/`server` internals" (requirements NFR-062); owned by Phase 8a.
- Branch protection and required status checks on `main`: configured by a repository admin outside this phase; the PR does not document or apply them.
- Dependency-update automation (Dependabot/Renovate): deferred to Phase 9.
- Windows support of any kind (native, WSL or Docker Desktop on Windows). Supported development platforms are macOS and Linux only.

---

## 3. Actors

| Actor | Description | Permissions |
|-------|-------------|-------------|
| Developer | Human engineer working locally | Runs any workspace script; runs the Docker test target; edits any file |
| Implementing agent | AI agent executing a later phase's spec | Same as Developer; relies on exit codes of the commands defined here as the sole definition of pass/fail |
| CI runner | Automated pipeline on every pull request and push to `main` | Read access to the repo (`contents: read`); builds images; no deploy credentials in this phase |

---

## 4. Functional Requirements

Priorities use MoSCoW.

### 4.1 Workspace, TypeScript and package resolution

- **FR-001 (Must) — Workspace layout.** Given a clean checkout, when `pnpm install --frozen-lockfile` runs at the repo root, then every package listed in Scope/In (6 top-level, 6 adapters, `tools/guardrails`) is registered as a workspace member and installs without error.
- **FR-002 (Must) — Package metadata.** Given any workspace member, when its `package.json` is read, then its `name` is `@cge/<dir-name>` for `packages/*` and `tools/*`, `@cge/adapter-<dir-name>` for `packages/adapters/*` (e.g. `@cge/adapter-store-sqlite`), `type` is `"module"`, `private` is `true`, and `engines.node` is `">=22 <23"`. The root `package.json` is `private: true` and carries `packageManager` but is exempt from the naming rule.
- **FR-003 (Must) — Strict TypeScript.** Given the workspace, then every package extends a shared `tsconfig.base.json` with at least `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `module`/`moduleResolution` = `NodeNext`, and `target` ≥ `ES2022`.
- **FR-004 (Must) — Two TypeScript projects per package.** Given each package, then it has `tsconfig.json` (composite; sources only, **excluding** `*.test.ts`; emits to `dist/`) and `tsconfig.test.json` (non-composite, `noEmit`; includes tests and sources; references `tsconfig.json`; adds the `vitest` and `node` types). Source projects never see Node types unless the package is allowed them (BR-002); tests may.
- **FR-005 (Must) — Build and typecheck commands.** Given the root `package.json`, then `pnpm build` runs `tsc -b` on the root solution `tsconfig.json` (all source projects), and `pnpm typecheck` runs `pnpm build` followed by `tsc -p <pkg>/tsconfig.test.json` for every package. Both exit non-zero on any type error.
- **FR-006 (Must) — Project references follow layering.** Given each package's `tsconfig.json`, when its `references` are read, then they are a subset of the packages it may import per BR-001, so an import of a package that is not referenced (for example `core` → `app`) fails `pnpm build`.
- **FR-007 (Must) — Cross-package resolution via `dist`.** Given any package, then its `package.json#exports` is `{ ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }` and nothing else. Cross-package imports therefore always resolve to built output. Consequently `pnpm lint`, `pnpm depcheck` and `pnpm test` each begin by running `pnpm build` (e.g. `pnpm build && eslint …`), so that each is correct on a clean checkout.
- **FR-008 (Must) — Core is runtime-neutral.** Given `packages/core`, when its source project (`tsconfig.json`) is read, then `types` is `[]`, so a reference to a Node global or a `node:*` import in a non-test source file is a type error. (Test files are checked by `tsconfig.test.json`, which may include Node types, because Vitest's own typings pull in `@types/node`.)
- **FR-009 (Must) — Node and pnpm pinning.** Given the repo root, then `.nvmrc`, the Dockerfile base-image tag, and `package.json#engines`/`packageManager` agree on one exact Node 22.x.y patch version (e.g. `22.11.0`) and one exact pnpm version.

### 4.2 Test tooling

- **FR-010 (Must) — Unit test runner.** Given the workspace, when `pnpm test` runs, then Vitest executes every `*.test.ts` under `packages/**` and `games/**` (not `tools/guardrails/**`, which is FR-013's) and exits 0 when all pass.
- **FR-011 (Must) — Property-test library.** Given the workspace, when a test imports `fast-check`, then it resolves and runs under Vitest (demonstrated by one placeholder property test in `packages/core`).
- **FR-012 (Must) — Placeholder tests per package.** Given each workspace member under `packages/**`, then it has `src/index.test.ts` containing at least one passing test (presence is checked by FR-043).
- **FR-013 (Must) — Aggregate scripts.** Given the root `package.json`, then `pnpm test:guardrails` runs the Vitest suite under `tools/guardrails/**`, and `pnpm test:all` runs `pnpm test` then `pnpm test:guardrails`, exiting non-zero if either fails. (Later phases extend `test:all` with conformance and API e2e.)
- **FR-014 (Should) — Coverage off by default.** Given `pnpm test`, when it runs, then no coverage instrumentation is applied; `pnpm test:coverage` runs the same suite with V8 coverage and writes to `coverage/` (git-ignored).

### 4.3 Lint, format, architecture rules

- **FR-020 (Must) — Lint script.** Given the workspace, when `pnpm lint` runs, then ESLint (flat config, `typescript-eslint` type-aware rules, `--max-warnings 0`) checks all `*.ts`/`*.js`/`*.mjs` sources and exits 0 on the skeleton.
- **FR-021 (Must) — Format check.** Given the workspace, when `pnpm format:check` runs, then Prettier verifies every tracked file not excluded by `.prettierignore` and exits 0; `pnpm format` rewrites them. `.prettierignore` excludes exactly: `docs/**`, `specs/**`, `pnpm-lock.yaml`, `LICENSE`, `dist/`, `coverage/`, `tools/guardrails/fixtures/**`. Existing Markdown under `docs/` and `specs/` is therefore left untouched by the Phase 0 PR.
- **FR-022 (Must) — Determinism scope.** The "determinism scope" is the files matching `packages/core/**`, `packages/helpers/**` or `games/*/hooks/**`, **excluding** `**/*.test.ts` (test files are exempt from FR-022 and FR-023; see BR-004).
- **FR-023 (Must) — Determinism globals ban.** Given a file in the determinism scope, when it references any of `Date`, `Math.random`, `performance`, `process`, `setTimeout`, `setInterval`, `setImmediate`, `queueMicrotask`, `Atomics`, `SharedArrayBuffer`, `fetch`, `XMLHttpRequest`, `WebSocket`, or `crypto` (global or `globalThis.crypto`), then `pnpm lint` fails with rule id `cge/no-nondeterministic-globals` naming the offending global.
- **FR-024 (Must) — Determinism imports ban.** Given a file in the determinism scope, when it imports (static `import`, dynamic `import()`, or `export … from`) any `node:*` specifier, or any bare specifier that is a member of `node:module`'s `builtinModules`, then `pnpm lint` fails with rule id `cge/no-nondeterministic-imports` naming the import.
- **FR-025 (Must) — Rules scoped, not global.** Given a file outside the determinism scope (e.g. `packages/server/**`, `packages/adapters/**`, `packages/config/**`, `tools/**`, `*.config.*`, any `*.test.ts`), when it uses `Date.now()` or imports `node:fs`, then lint passes.
- **FR-026 (Must) — Layering enforcement.** Given the dependency-cruiser config, when `pnpm depcheck` runs, then every edge forbidden by BR-001 fails with the named rule from §7.3, including imports expressed as relative paths into another package's `src` or `dist`.
- **FR-027 (Must) — Core Node ban in depcheck.** Given the dependency-cruiser config, when any non-test file under `packages/core` imports a `node:*` specifier or a member of `builtinModules` by bare name, then `pnpm depcheck` fails with rule `core-no-node`.
- **FR-028 (Must) — No circular dependencies.** Given the workspace, then any import cycle (within or across packages) fails `pnpm depcheck` with rule `no-circular`.
- **FR-029 (Must) — No undeclared dependencies.** Given any package, when a file imports an npm package that is not in that package's own `dependencies` or `devDependencies` (nor a Node built-in), then `pnpm depcheck` fails with rule `no-undeclared-deps`. Consequently every package that has tests declares `vitest` (and `fast-check` if used) in its own `devDependencies`, at the same exact version as every other package (checked by FR-043). Tooling (`typescript`, `eslint`, `prettier`, `dependency-cruiser`, plugins) is declared in the root `devDependencies` and in `tools/guardrails` where imported.
- **FR-030 (Should) — Single entry point per package.** Given a package, when another package imports a deep path (e.g. `@cge/core/src/session/index.js`) that the `exports` map of FR-007 does not expose, then resolution fails.

### 4.4 Guardrail suite (`tools/guardrails`)

`tools/guardrails` is a private workspace package (`@cge/guardrails`) holding Vitest tests and fixtures. It is exempt from FR-006/FR-012 and from the BR-001 edge rules (it may import any tooling), but not from FR-002 or lint.

- **FR-040 (Must) — Lint rules are tested.** Given `tools/guardrails/fixtures/lint/`, when `pnpm test:guardrails` runs, then each fixture is linted through the ESLint Node API (`lintText` with a virtual `filePath` inside or outside the determinism scope as the case demands) and: for each banned global and import form in FR-023/FR-024 (static import, dynamic import, re-export) at least one case reports an error with the expected `ruleId`; for each allowed case in FR-025 and BR-005 reports 0 errors.
- **FR-041 (Must) — Depcheck rules are tested.** Given `tools/guardrails/fixtures/depcruise/`, then each case is a self-contained directory tree mirroring the repo layout (e.g. `<case>/packages/core/src/x.ts` plus minimal `package.json` files). When `pnpm test:guardrails` runs, dependency-cruiser's API is executed over each case with the real `.dependency-cruiser.cjs`, and violation cases report exactly the expected named rule (one case per rule in §7.3), while legitimate-direction cases report no violation.
- **FR-042 (Must) — Fixtures are inert in the real run.** Given the fixtures from FR-040/FR-041, when `pnpm lint`, `pnpm depcheck`, `pnpm build`, `pnpm typecheck` and `pnpm format:check` run on the real workspace, then fixtures are excluded from all of them and none fails because of a fixture.
- **FR-043 (Must) — Repository invariants.** Given `tools/guardrails/repo-invariants.test.ts`, when `pnpm test:guardrails` runs, then it fails, naming the offender, if any of these is false:
  1. every workspace member satisfies FR-002;
  2. the Node and pnpm versions satisfy FR-009 and the Dockerfile `base`/`runtime` stages use the same pinned tag;
  3. every package under `packages/**` has `src/index.test.ts` (FR-012);
  4. every non-test file under `packages/**/src` contains only `export {}`, re-exports and comments (BR-006);
  5. every `devDependencies` version in every `package.json` matches `^\d+\.\d+\.\d+$`, and `vitest`/`fast-check` have a single version across the workspace (BR-007, FR-029);
  6. every `dependencies` entry in every package is a workspace-protocol `@cge/*` reference (BR-009);
  7. the README documents the scripts and rule of FR-070/FR-071.

### 4.5 Docker

- **FR-050 (Must) — Dockerfile stages.** Given `deploy/Dockerfile`, when it is parsed, then it defines stages named exactly `base`, `build`, `test`, `runtime`, with `build` derived from `base`, `test` derived from `build`, and `runtime` derived from the same pinned base image as `base` but as a fresh `FROM` (not from `build`). The base image tag is pinned to an exact Node patch and Alpine minor (pattern `node:22.<minor>.<patch>-alpine<major>.<minor>`, optionally with `@sha256:` digest); the floating tags `node:22` and `node:22-alpine` are not used.
- **FR-051 (Must) — Cached dependency layer.** Given a source-only change (no change to any `package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml`), when the image is rebuilt, then the dependency-install layer in `base` is served from cache. (`base` copies only manifests and the lockfile before installing.)
- **FR-052 (Must) — Test target.** Given the `test` stage, then at build time it runs `pnpm lint`, `pnpm typecheck` and `pnpm depcheck` (so building the target fails if any fails), and its default command is `pnpm test:all`.
- **FR-053 (Must) — Test compose file.** Given `deploy/docker-compose.test.yml`, when `docker compose -f deploy/docker-compose.test.yml run --rm tests` is executed on a clean checkout, then it builds the `test` target, runs `pnpm test:all`, and its exit code equals the exit code of `pnpm test:all` (or non-zero if the build failed).
- **FR-054 (Must) — Runtime target.** Given the `runtime` stage, when built, then: `WORKDIR` is `/app`; it contains only, per package, `package.json` and `dist/` plus production `node_modules` installed with `--prod --frozen-lockfile` (no `devDependencies`, no tests, no `tools/`, no sources); `/app` is owned by root and not writable by the runtime user; `/data` exists, is declared as a `VOLUME` and is owned by the runtime user; `USER` is the non-root `node` user (UID 1000); `NODE_ENV=production`; and the default command is `node packages/server/dist/index.js`, which in Phase 0 exits 0 immediately (Phase 7 replaces it).
- **FR-055 (Must) — Run compose file.** Given `deploy/docker-compose.yml`, when `docker compose -f deploy/docker-compose.yml config` runs, then it validates without error and defines service `engine` (build target `runtime`, port `8080:8080`, volume `engine-data:/data`, read-only `config/server.yaml` bind mount, env `ENGINE_HOST_KEY`). The mounted file does not exist in Phase 0, so starting the service is not required.
- **FR-056 (Must) — Build context hygiene.** Given a `.dockerignore`, then `node_modules`, `.git`, `coverage`, `dist`, `*.tsbuildinfo` and `.env*` are not sent in the build context.
- **FR-057 (Should) — Local parity.** Given a developer machine with the pinned Node and pnpm, when running `pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:all` natively, then the results match those inside the `test` container.

### 4.6 CI

- **FR-060 (Must) — Pipeline definition.** Given `.github/workflows/ci.yml`, triggered on `pull_request` and on `push` to `main`, then jobs run in this order, each blocking the next via `needs:`: `lint` (`pnpm lint` + `pnpm format:check`) → `typecheck` → `depcheck` → `test` (`docker compose -f deploy/docker-compose.test.yml run --rm tests`) → `image` (`docker build --target runtime`). The native jobs and the `test` stage overlap deliberately: the native jobs give fast, per-tool feedback, and the container is the authoritative run (NFR-001).
- **FR-061 (Must) — Frozen installs.** Given any CI job that installs dependencies, then it uses `pnpm install --frozen-lockfile`, so a stale lockfile fails the job.
- **FR-062 (Must) — Image build does not push.** Given the `image` job, then it builds and discards the image (no registry login, no push).
- **FR-063 (Should) — Caching.** Given consecutive CI runs with an unchanged lockfile, then the pnpm store and Docker layer cache are restored.
- **FR-064 (Should) — Hardened workflow.** Given the workflow file, then it declares top-level `permissions: contents: read`, and every third-party action is pinned to a full commit SHA (with the version in a trailing comment).

### 4.7 Documentation

- **FR-070 (Must) — Command reference.** Given `README.md` (or `docs/dev-setup.md`, linked from the README), then it lists every root script (`build`, `lint`, `format`, `format:check`, `typecheck`, `depcheck`, `test`, `test:guardrails`, `test:all`, `test:coverage`) and the two Docker commands, with the expected result of each.
- **FR-071 (Should) — Layering rule and onboarding.** Given the same document, then it states the dependency rule `core ← app ← adapters ← server` and a heading "Adding a package" with steps: create the directory, register `tsconfig` references, add `src/index.test.ts`.

---

## 5. Business Rules

- **BR-001 — Layering.** Allowed import directions between workspace packages (an arrow means "may import"; anything not listed is forbidden):

  | Package | May import |
  |---------|-----------|
  | `core` | nothing |
  | `helpers` | `core` |
  | `config` | `core` |
  | `app` | `core` |
  | `adapters/*` | `core`, `app`, `config` (not `server`, `helpers`, `conformance`, or another adapter) |
  | `server` | `core`, `app`, `config`, `helpers`, `adapters/*` (not `conformance`) |
  | `conformance` | `core`, `app`, `config`, `helpers`, `adapters/*` |
  | `games/*` (later phases) | `conformance` and public package APIs; its precise rule is Phase 8a |

  Nothing under `packages/**` imports `conformance`. Rationale: architecture A3 (`core ← app ← adapters ← server`) plus the pure `helpers` library and the config/conformance packages the plan lists. Exceptions: none.
- **BR-002 — Core is runtime-neutral.** Non-test source in `packages/core` imports no `node:*` module and no Node built-in by bare name, and (via BR-009) has no runtime npm dependency in Phase 0. Rationale: core runs in any JS runtime, including edge nodes (Part B).
- **BR-003 — Adapters are isolated from each other.** An adapter must not import another adapter. Rationale: adapters are swappable behind ports.
- **BR-004 — Determinism scope exempts tests.** The FR-023/FR-024 bans apply to the determinism scope of FR-022, which excludes `**/*.test.ts`. Rationale: tests need clocks and randomness for harnessing (architecture A4 targets hooks and reducers, not tests); deterministic domain tests will use the seeded PRNG from Phase 1 by convention.
- **BR-005 — Promises are allowed.** `Promise` and `async`/`await` are allowed in the determinism scope; `queueMicrotask` is banned because it is a scheduling API. Rationale: hooks are `async` (A4) but must not depend on time.
- **BR-006 — No domain code in Phase 0.** Non-test source files under `packages/**/src` contain only `export {}`, re-exports and comments. Rationale: keeps Phase 0 reviewable and prevents design decisions sneaking in before Phase 1. The Phase 1 spec removes the corresponding check from FR-043.
- **BR-007 — Exact tool versions.** All `devDependencies` are pinned to exact versions (no `^`/`~`/ranges), and the lockfile is committed. Rationale: reproducible builds and stable lint behaviour.
- **BR-008 — Fixtures never run in real checks.** Violation fixtures live only under `tools/guardrails/fixtures/` and are excluded from real lint/depcheck/typecheck/build/format runs (FR-042).
- **BR-009 — Phase 0 introduces no runtime dependencies.** `dependencies` is empty in every package except workspace-protocol `@cge/*` references. Rationale: later phases choose runtime dependencies with their own justification.

---

## 6. Non-Functional Requirements

| ID | Requirement | Threshold |
|----|-------------|-----------|
| NFR-001 | Reproducibility | Two builds of the `test` target from the same commit on a clean Docker cache produce the same pass/fail result and no lockfile diff after install. Base image and Node/pnpm versions are exact (FR-009, FR-050). |
| NFR-002 | Cold container test time | `docker compose -f deploy/docker-compose.test.yml run --rm tests` on an empty Docker cache completes in ≤ 10 min on a GitHub-hosted `ubuntu-latest` runner. |
| NFR-003 | Warm container test time | Same command after a source-only change completes in ≤ 3 min on the same runner class. |
| NFR-004 | Native check time | `pnpm lint && pnpm typecheck && pnpm depcheck` (including their builds) completes in ≤ 60 s on the skeleton, on a 4-core developer machine with warm caches. |
| NFR-005 | Guardrail suite time | `pnpm test:guardrails` completes in ≤ 30 s on the same machine. |
| NFR-006 | Runtime image size | `runtime` image size ≤ (size of the pinned base image, as reported by `docker image inspect` in the same run) + 25 MB. |
| NFR-007 | Runtime hardening | With `docker run --read-only --tmpfs /tmp -v data:/data`, the container process cannot create files anywhere except `/data` and `/tmp`. |
| NFR-008 | Strictness | `tsc -b`, ESLint (`--max-warnings 0`), depcheck and Prettier report 0 errors and 0 warnings on `main`. |
| NFR-009 | Platform | The workflow works on Linux (CI, Docker) and macOS arm64 developer machines; scripts that run inside Docker use only POSIX `sh` features (Alpine/busybox). |

---

## 7. Data & Interfaces

### 7.1 Repository layout produced

```
.github/workflows/ci.yml
.dockerignore  .gitignore  .nvmrc  .prettierrc  .prettierignore
package.json                # root scripts, packageManager, devDependencies
pnpm-workspace.yaml         # packages/*, packages/adapters/*, tools/*
pnpm-lock.yaml
tsconfig.base.json  tsconfig.json   # solution file referencing all source projects
eslint.config.mjs
.dependency-cruiser.cjs
vitest.config.ts
packages/
  core/{session,definition,visibility,replay,spi,ports,errors}/index.ts
  app/{proposal-handler,session-registry,publisher,session-factory,package}/index.ts
  config/  helpers/  conformance/  server/
  adapters/{store-memory,store-sqlite,transport-http,transport-ws,authz-static,timer-host}/
games/.gitkeep
config/.gitkeep
deploy/{Dockerfile,docker-compose.yml,docker-compose.test.yml}
tools/guardrails/{package.json,tsconfig*.json,*.test.ts,repo-invariants.test.ts,fixtures/lint/**,fixtures/depcruise/**}
```

Each package under `packages/**` contains `package.json`, `tsconfig.json`, `tsconfig.test.json`, `src/index.ts` (`export {};`, or re-exporting the empty sub-folder modules for `core` and `app`) and `src/index.test.ts`.

### 7.2 Root scripts (contract)

| Script | Behaviour | Exit 0 means |
|--------|-----------|--------------|
| `build` | `tsc -b` on root solution (source projects; emits `dist/`) | All sources compile |
| `typecheck` | `pnpm build`, then `tsc -p <pkg>/tsconfig.test.json` per package | Sources and tests type-check |
| `lint` | `pnpm build && eslint . --max-warnings 0` | No lint findings |
| `format` / `format:check` | Prettier write / check (scope per FR-021) | Files formatted |
| `depcheck` | `pnpm build && depcruise packages games --config .dependency-cruiser.cjs` | No rule violations |
| `test` | `pnpm build && vitest run` over `packages/**`, `games/**` | All unit/property tests pass |
| `test:coverage` | Same with V8 coverage | Same, plus `coverage/` |
| `test:guardrails` | `pnpm build && vitest run` over `tools/guardrails` | Rules and invariants hold |
| `test:all` | `pnpm test && pnpm test:guardrails` | Everything passes |

### 7.3 Named rules (stable identifiers, used by VCs)

dependency-cruiser:
- `layer-core-imports-nothing` — `core` imports no other workspace package.
- `layer-helpers-core-only` — `helpers` imports only `core`.
- `layer-config-core-only` — `config` imports only `core`.
- `layer-app-core-only` — `app` imports only `core`.
- `layer-adapters-no-server` — adapters never import `server`.
- `layer-adapters-no-adapters` — an adapter never imports another adapter.
- `layer-adapters-allowed-only` — adapters import only `core`, `app`, `config` (catches `helpers`, `conformance`).
- `layer-server-no-conformance` — `server` never imports `conformance`.
- `layer-conformance-leaf` — nothing under `packages/**` imports `conformance`.
- `core-no-node` — non-test `core` files import no Node built-in.
- `no-circular` — no import cycles.
- `no-undeclared-deps` — imports must be declared in the importing package's `package.json`.

ESLint (determinism): `cge/no-nondeterministic-globals`, `cge/no-nondeterministic-imports`. They may be implemented as a thin local plugin or with built-in `no-restricted-*` rules; the reported `ruleId` (or a `[cge/…]` message prefix when a built-in rule is used) must be one of these two, and guardrail tests match on it.

### 7.4 Docker contract

- Build context: repo root. Dockerfile: `deploy/Dockerfile`. Stages: `base`, `build`, `test`, `runtime`. Base image: exact pinned tag per FR-050.
- Commands: `docker compose -f deploy/docker-compose.test.yml run --rm tests` (service `tests`, command `pnpm test:all`); `docker compose -f deploy/docker-compose.yml up`.

---

## 8. Verification Criteria

Procedure notes:
- VC-020–VC-033 and VC-040–VC-041 are implemented as **guardrail fixtures** (FR-040/FR-041), not by editing real files; where a VC names a path such as `packages/core/src/x.ts`, that is the virtual path or fixture-tree path of the case.
- VC-003, VC-004, VC-005, VC-007, VC-008 and the Docker/CI VCs that "inject" a violation are run by a temporary edit in a scratch checkout; they need not be automated.

### Workspace and TypeScript
- VC-001 (FR-001): `pnpm install --frozen-lockfile` → exit 0, and `pnpm -r list --depth -1` lists exactly 13 members: 6 top-level packages, 6 adapters, `@cge/guardrails`.
- VC-002 (FR-002): covered by FR-043 check 1 (`repo-invariants.test.ts`); changing one package to `type: "commonjs"` makes it fail naming that package.
- VC-003 (FR-003/FR-005): `pnpm typecheck` → exit 0; adding `const x: number = "a";` to a source file, and separately to a test file → exit non-zero in each case.
- VC-004 (FR-003): `const a: number[] = []; const b: number = a[0];` in a source file → type error (`noUncheckedIndexedAccess`).
- VC-005 (FR-006): add `import "@cge/app"` to `packages/core/src/index.ts` → `pnpm build` fails; add `import "@cge/core"` to `packages/app/src/index.ts` (with the reference present) → passes.
- VC-006 (FR-009): covered by FR-043 check 2; making `.nvmrc`, the Dockerfile tag, `engines` or `packageManager` disagree makes the check fail naming the file.
- VC-007 (FR-008): `const p = process.cwd();` in `packages/core/src/index.ts` → `pnpm build` fails with "Cannot find name 'process'"; the same line in `packages/core/src/index.test.ts` → `pnpm typecheck` passes.
- VC-008 (FR-004/FR-007): `packages/*/package.json#exports` contains only the `.` entry pointing at `dist/`; on a clean checkout `pnpm test` (which builds first) passes without a manual build step.

### Tests
- VC-010 (FR-010): `pnpm test` → exit 0 and the report lists ≥ 1 test in each of the 12 packages; making one assertion false → exit non-zero.
- VC-011 (FR-011): placeholder property test in `packages/core` (`fc.assert(fc.property(fc.integer(), n => n + 0 === n))`) → passes with ≥ 100 runs shown in verbose output.
- VC-012 (FR-012): deleting one package's `src/index.test.ts` → FR-043 check 3 fails naming that package.
- VC-013 (FR-013): `pnpm test:all` → exit 0 with unit tests reported before guardrail tests; making a guardrail test fail → exit non-zero.
- VC-014 (FR-014): `pnpm test` creates no `coverage/`; `pnpm test:coverage` creates it and `git status` shows it ignored.

### Lint, format, depcheck
- VC-020 (FR-020): `pnpm lint` → exit 0 on the skeleton.
- VC-021 (FR-021): `pnpm format:check` → exit 0 on a clean checkout including the existing `docs/` and `specs/`; a mis-indented `.ts` line → non-zero; `pnpm format` restores exit 0; a mis-formatted `docs/x.md` → still exit 0.
- VC-022 (FR-023): a file `packages/core/src/x.ts` containing each of `Date.now()`, `new Date()`, `Math.random()`, `performance.now()`, `process.env.X`, `setTimeout(...)`, `setInterval(...)`, `setImmediate(...)`, `queueMicrotask(...)`, `crypto.randomUUID()`, `globalThis.crypto`, `new SharedArrayBuffer(8)`, `Atomics.load(...)`, `fetch(...)`, `new WebSocket(...)` → each fails with `cge/no-nondeterministic-globals`, message naming the global.
- VC-023 (FR-022/FR-023): the same cases at `packages/helpers/src/x.ts` and `games/demo/hooks/x.ts` → all fail; the same cases at `packages/core/src/x.test.ts` → 0 errors.
- VC-024 (FR-024): in `packages/core/src/x.ts`, each of `import fs from "node:fs"`, `import "fs"`, `import "node:crypto"`, `import "crypto"`, `import "node:worker_threads"`, `import "stream"`, `await import("node:fs")`, `export * from "node:path"` → each fails with `cge/no-nondeterministic-imports`.
- VC-025 (FR-025): `Date.now()` and `import fs from "node:fs"` in `packages/server/src/x.ts`, `packages/adapters/store-sqlite/src/x.ts`, `packages/config/src/x.ts`, `vitest.config.ts` and `packages/core/src/x.test.ts` → 0 errors in each.
- VC-026 (BR-005): `await Promise.resolve()` in `packages/core/src/x.ts` → 0 errors.
- VC-027 (FR-026): `packages/core/src/x.ts` importing `@cge/app`, and separately `../../app/src/index.js` → both fail with `layer-core-imports-nothing`.
- VC-028 (FR-026): `app` importing `@cge/adapter-store-memory` → `layer-app-core-only`; `app` importing `@cge/config` → `layer-app-core-only`; `helpers` importing `@cge/app` → `layer-helpers-core-only`; `config` importing `@cge/app` → `layer-config-core-only`.
- VC-029 (FR-026): `adapter-store-memory` importing `@cge/server` → `layer-adapters-no-server`; importing `@cge/adapter-store-sqlite` → `layer-adapters-no-adapters`; importing `@cge/helpers` → `layer-adapters-allowed-only`; importing `@cge/conformance` → `layer-adapters-allowed-only`.
- VC-030 (FR-026): `server` importing `@cge/conformance` → `layer-server-no-conformance`; `app` importing `@cge/conformance` → `layer-conformance-leaf` (plus `layer-app-core-only`).
- VC-031 (FR-026): the allowed edges of BR-001 (`server`→`adapters`/`helpers`/`config`/`app`/`core`, `adapters`→`app`/`config`/`core`, `app`→`core`, `helpers`→`core`, `config`→`core`, `conformance`→`adapters`/`helpers`) produce 0 violations.
- VC-032 (FR-027): `packages/core/src/x.ts` with `import "node:fs"`, and separately `import "path"`, `import "stream"` → each fails with `core-no-node`; the same in `x.test.ts` → no `core-no-node` violation.
- VC-033 (FR-028/FR-029): two files in one package importing each other → `no-circular`; a cycle across two packages → `no-circular`; `packages/app/src/x.ts` importing `fast-check` without declaring it in `packages/app/package.json` → `no-undeclared-deps`.
- VC-034 (FR-030): importing `@cge/core/src/session/index.js` from `packages/app` → resolution/`pnpm build` fails.

### Guardrail suite
- VC-040 (FR-040): the lint fixtures include ≥ 1 case per banned global and per import form (static, dynamic, re-export), and ≥ 5 allowed cases; deleting the determinism rule configuration makes the suite fail.
- VC-041 (FR-041): there is one fixture case per rule in §7.3 for dependency-cruiser plus the legitimate-direction case of VC-031; disabling any one rule in `.dependency-cruiser.cjs` makes exactly that rule's case fail.
- VC-042 (FR-042): with fixtures present in the tree, `pnpm lint`, `pnpm depcheck`, `pnpm build`, `pnpm typecheck`, `pnpm format:check` → all exit 0.
- VC-043 (FR-043): `repo-invariants.test.ts` passes on the skeleton; each of the seven checks, violated in a scratch checkout (e.g. a function declaration in `packages/core/src/index.ts`, `^1.0.0` in `devDependencies`, `zod` in `dependencies`, README missing a script), fails with a message naming the offender.

### Docker
- VC-050 (FR-050): parsing `deploy/Dockerfile` (script or `docker buildx build --check`) → stages `base`, `build`, `test`, `runtime` with the specified parents; every `FROM` matches `^node:22\.\d+\.\d+-alpine\d+\.\d+`; changing a `FROM` to `node:22-alpine` fails FR-043 check 2.
- VC-051 (FR-051): build twice, changing only a `.ts` source file between builds → the second build's log marks the install layer `CACHED`; touching `pnpm-lock.yaml` → the install layer re-executes.
- VC-052 (FR-052): inject a lint violation in `packages/core` and run `docker build --target test` → build fails at the lint step; revert → build succeeds.
- VC-053 (FR-053): `docker compose -f deploy/docker-compose.test.yml run --rm tests` on a clean checkout → exit 0 and output shows the unit and guardrail suites passed; injecting one failing placeholder test → non-zero exit.
- VC-054 (FR-054, NFR-007): on the `runtime` image: `docker run --rm <img> id -u` → `1000`; `docker run --rm <img> sh -c 'test ! -e /app/node_modules/.bin/vitest && test ! -e /app/tools && test ! -e /app/packages/core/src'` → exit 0; `docker run --rm <img> sh -c 'touch /app/x'` → fails; `docker run --rm -v data:/data <img> sh -c 'touch /data/x'` → succeeds; `docker run --rm --read-only --tmpfs /tmp -v data:/data <img> sh -c 'touch /etc/x'` → fails; `printenv NODE_ENV` → `production`; default command exits 0.
- VC-055 (FR-055): `docker compose -f deploy/docker-compose.yml config` → exit 0; output contains service `engine`, target `runtime`, `8080:8080`, `engine-data:/data`, `ENGINE_HOST_KEY`.
- VC-056 (FR-056): with host files `.env.test` and `node_modules/SENTINEL` present, `docker run --rm <build-image> sh -c 'test ! -e /app/.env.test && test ! -e /app/node_modules/SENTINEL'` → exit 0.
- VC-057 (FR-057): record outcomes of `pnpm lint`, `pnpm typecheck`, `pnpm depcheck`, `pnpm test:all` natively and in Docker on the same commit → identical pass/fail for each, including on the two injected-violation commits of VC-022 and VC-027.

### CI
- VC-060 (FR-060): `.github/workflows/ci.yml` has jobs `lint`, `typecheck`, `depcheck`, `test`, `image` linked by `needs:` in that order, triggers `pull_request` and `push` to `main`; a pull request containing the VC-022 violation fails at `lint` and the later jobs show as skipped.
- VC-061 (FR-061): every `pnpm install` in the workflow includes `--frozen-lockfile`; a PR changing a `package.json` without the lockfile fails its first job.
- VC-062 (FR-062): the `image` job contains no `docker login`, no `push: true`, no `docker push`.
- VC-063 (FR-063): the second of two CI runs with an identical lockfile logs a pnpm store cache hit and Docker cache hits for the install layer.
- VC-064 (FR-064): the workflow has top-level `permissions: contents: read`, and every `uses:` line with a non-local action matches `@[0-9a-f]{40}`.

### Documentation
- VC-065 (FR-070): FR-043 check 7 — the script names listed in the README equal the keys of the root `package.json` `scripts` minus any non-listed helper scripts, and both Docker commands appear verbatim; removing `test:guardrails` from the README fails the check.
- VC-066 (FR-071): the README contains the string `core ← app ← adapters ← server` and a heading `Adding a package`; removing either fails the check.

### Business rules
- VC-070 (BR-001): covered by VC-005, VC-027, VC-028, VC-029, VC-030, VC-031.
- VC-071 (BR-002): covered by VC-007, VC-032.
- VC-072 (BR-003): covered by VC-029 (adapter→adapter case).
- VC-073 (BR-004/BR-005): covered by VC-023, VC-025, VC-026.
- VC-074 (BR-006): covered by VC-043 (check 4).
- VC-075 (BR-007): covered by VC-043 (check 5).
- VC-076 (BR-008): covered by VC-042.
- VC-077 (BR-009): covered by VC-043 (check 6).

### NFR end-to-end
- VC-080 (NFR-001–NFR-005, NFR-008): on a GitHub-hosted `ubuntu-latest` runner run the CI pipeline twice from an empty cache and once after a source-only change → cold test job ≤ 10 min, warm ≤ 3 min, identical results across the two cold runs, no lockfile diff, 0 warnings in all tools' logs; locally on a 4-core machine `time (pnpm lint && pnpm typecheck && pnpm depcheck)` ≤ 60 s and `time pnpm test:guardrails` ≤ 30 s.
- VC-081 (NFR-006): `runtime` size from `docker image inspect --format '{{.Size}}'` ≤ base-image size (same command on the pinned base tag) + 26,214,400 bytes.
- VC-082 (NFR-009): VC-053 passes on macOS arm64 (Docker Desktop) and on Linux CI.

### Phase exit criteria (from the implementation plan)
- VC-090 (exit 1): on a clean checkout, `docker compose -f deploy/docker-compose.test.yml run --rm tests` → exit 0 (same as VC-053).
- VC-091 (exit 2): committing `import fs from "node:fs"` in `packages/core/src/index.ts` fails CI at both `lint` (`cge/no-nondeterministic-imports`) and `depcheck` (`core-no-node`); committing `Date.now()` in `packages/core/src/index.ts` fails CI at `lint` (`cge/no-nondeterministic-globals`).

---

## 9. Assumptions

1. The repository is hosted on GitHub, so CI is GitHub Actions (`.github/workflows/ci.yml`); the existing PR-based history (#1, #2) supports this.
2. Package scope is `@cge` ("card game engine"); easily renamed now, expensive after Phase 1.
3. The edges for `helpers`, `config` and `conformance` in BR-001 are inferred from the package descriptions in A3 (the architecture states only `core ← app ← adapters ← server`) and must be revisited if a later spec needs different edges.
4. Vitest runs from a single root configuration with per-package placeholder tests, not one Vitest config per package.
5. Alpine's musl libc is acceptable for the runtime image in Phase 0; Phase 5 (native `better-sqlite3`, if chosen) revisits it.
6. No secrets are required in Phase 0; `ENGINE_HOST_KEY` appears only as an unset variable name in the run compose file.
7. The implementer picks the exact Node patch/Alpine tag and tool versions at implementation time, subject to BR-007 and FR-009/FR-050.

## 10. Open Questions

None.
