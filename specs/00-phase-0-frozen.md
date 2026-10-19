# Frozen: Phase 0 — Foundation and tooling

Source: `specs/00-phase-0.md` (as-built decisions: `specs/00-phase-0-plan-artifacts/DECISIONS.md`, D-001–D-021)
Status: SHIPPED
Frozen: 2026-10-19
PR / commit: #3 `e057470` (implementation), #4 `bf13873` (plan as-built update)

## Purpose

Phase 0 delivers an empty but fully working workspace for the Generic Card Game Engine: it builds, lints, type-checks, tests and containerises, and the architectural rules (hexagonal layering, no I/O in the domain core, deterministic hook code) are enforced mechanically from the first commit. Without it, later phases could silently violate those rules and the violations would be expensive to unwind. The beneficiaries are the engineers (and AI agents) implementing Phases 1–14: they get a single trusted definition of "green" that runs identically locally and in CI.

Phase 0 contains **no domain logic**. Every package is a skeleton that exports nothing meaningful.

## What it does

- A pnpm workspace has 13 members (6 packages, 6 adapters, `@cge/guardrails`), all `type: module`, `private`, `engines.node >=22 <23`, named `@cge/<dir>` or `@cge/adapter-<dir>`.
- Every package extends `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, NodeNext) and has a composite source project plus a non-composite `tsconfig.test.json`.
- Project references mirror BR-001, so an unreferenced cross-package import fails `pnpm build`; packages export only `dist/index.js`, so `lint`/`depcheck`/`test` each build first.
- `packages/core` source has `types: []`, making Node globals and `node:*` imports type errors; tests may use Node types.
- Node and pnpm are pinned to one exact version each across `.nvmrc`, `engines`, `packageManager` and the Dockerfile.
- Vitest runs `*.test.ts` under `packages/**` and `games/**`; `fast-check` works; every package has `src/index.test.ts`; coverage is opt-in via `test:coverage`.
- ESLint (flat, type-aware, `--max-warnings 0`) bans nondeterministic globals and Node-builtin imports in the determinism scope (`packages/core`, `packages/helpers`, `games/*/hooks`, excluding tests), reporting `cge/no-nondeterministic-globals` / `cge/no-nondeterministic-imports`; elsewhere they are allowed.
- dependency-cruiser enforces layering, core-no-node, no cycles and no undeclared deps via the named rules in §7.3, including relative paths into another package's `src`/`dist`.
- Prettier checks everything except the `.prettierignore` list; `docs/` and `specs/` are untouched.
- `tools/guardrails` proves the rules fire (lint via `lintText` on virtual paths, depcruise via per-case fixture trees with the real config) and holds seven repo invariants (FR-043); fixtures are inert in real runs.
- `deploy/Dockerfile` has stages `base`/`build`/`test`/`runtime`; `test` runs lint, typecheck and depcheck at build time and defaults to `pnpm test:all`; `runtime` is a fresh pinned `FROM` with only manifests, `dist/` and prod `node_modules`, read-only root-owned `/app`, `/data` volume, user `node` (1000), `NODE_ENV=production`, and a placeholder CMD that exits 0.
- `deploy/docker-compose.test.yml` (`tests`) runs the containerised suite; `deploy/docker-compose.yml` (`engine`) validates with `config` but cannot start until `config/server.yaml` exists.
- GitHub Actions CI runs `lint` → `typecheck` → `depcheck` → `test` (container) → `image` (build, no push), with frozen-lockfile installs, top-level `contents: read` and SHA-pinned actions.
- `README.md` links to `docs/dev-setup.md`, which lists every root script, both Docker commands, the layering rule and an "Adding a package" heading (checked by FR-043 check 7).
- Business rules in force: allowed layering per BR-001; adapters are isolated from each other; tests are exempt from determinism bans; `Promise`/`async` allowed, `queueMicrotask` banned; Phase 0 sources contain only `export {}`/re-exports/comments; `devDependencies` are exact-pinned; `dependencies` are only `workspace:*` `@cge/*`.

## Public interfaces / data

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

## Key decisions

As-built choices not stated in the spec (from the plan's DECISIONS log):

- **Versions pinned**: Node `22.23.3`, pnpm `10.15.1`, image `node:22.23.3-alpine3.24`, TypeScript `6.0.3`, Vitest `5.0.5`, ESLint `10.13.0`, `typescript-eslint` `8.71.2`, Prettier `3.9.10`, dependency-cruiser `18.6.0`, `fast-check` `4.10.2` (D-001, D-002, D-018).
- **TypeScript 6.0.3, not 7**: `typescript-eslint` hard-fails on TS 7 (peer `<6.1.0`); revisit when it supports TS ≥ 7.1 (D-011).
- **Imports within a package are relative `./….js`**, never `@cge/<self>`: avoids circular resolution and NodeNext subpath exports (D-003).
- **Sub-folders live under `src/`** (`packages/core/src/session/index.ts`), so `rootDir: src` and the single `dist` entry hold; `@cge/core/src/...` deep paths fail resolution (D-004).
- **Full references/`workspace:*` matrix is declared up front** even though no cross-package import is committed, so layering checks work from day one (D-005).
- **`@cge/guardrails` is not in the root solution build**: no `src/`, no `exports`; type-checked through its `tsconfig.test.json` only (D-006).
- **Tests import from `vitest` explicitly** (no globals); all source projects use `types: []`, only test projects add `node` (D-007, D-008).
- **Two Vitest configs**: `vitest.config.ts` (packages/games) and `vitest.guardrails.config.ts` (D-010).
- **Type-aware ESLint wiring**: `parserOptions.project` points at each `tsconfig.test.json` plus `tsconfig.eslint.json` (covers `vitest*.config.ts` and `games/**`) because source tsconfigs exclude tests (D-012).
- **ESLint plugin is a plain `eslint/` directory** (`cge-plugin.mjs`, `determinism.mjs`), not a 14th workspace member; `determinismFiles` globs use `/**/*.{ts,js,mjs}` because bare `/**` silently fails for `lintText` virtual paths under ESLint 10 (D-013, D-015).
- **Prettier**: `semi`, double quotes, `trailingComma: "all"`, `printWidth: 80` (D-013).
- **Lint fixtures are string cases** in `fixtures/lint/cases.ts`, never executed code (D-016).
- **dependency-cruiser matching**: workspace targets match path, `node_modules/@cge/…` and bare `^@cge/…` specifiers; `no-undeclared-deps` covers `npm-no-pkg`/`npm-unknown`; real config `exclude` omits `node_modules` and `dist` (needed for FR-029 and relative-into-dist), and fixture runs override `exclude`; `tsPreCompilationDeps: true` (D-014, D-017).
- **Multi-fire depcruise cases are expected as exact sets** (e.g. `app`→`conformance` fires `layer-conformance-leaf` and `layer-app-core-only`) (D-017).
- **Invariant helpers are pure functions of `repoRoot`**; BR-006 is checked via the TypeScript AST; Dockerfile check validates only `base` and `runtime` `FROM` lines against `.nvmrc` (D-019).
- **Docker**: `runtime` is a fresh `FROM`, strips `tools`, `chmod -R a-w /app`; `.dockerignore` excludes `**/dist` but re-includes `tools/guardrails/fixtures/**/dist/**`; compose bind-mounts `/etc/engine/server.yaml:ro` with `ENGINE_HOST_KEY: ${ENGINE_HOST_KEY:-}` so `config` validates without the host file (D-018).
- **CI**: native jobs use `setup-node` pnpm cache; `test`/`image` use buildx with `type=gha` cache and job-level `actions: write`; `test` preloads image `deploy-tests:latest` then runs the exact compose command (D-020).
- **Docs**: README is a short overview linking to `docs/dev-setup.md`, which is the FR-070/071 surface; `DOCUMENTATION_SCRIPT_ALLOWLIST` is empty (D-021).
- **Layering edges for `helpers`/`config`/`conformance` are inferred**, not from architecture A3 (spec assumption 3); revisit if a later spec needs different edges.

## Known limits (still true at freeze)

- Runtime dependencies are none; any later phase adding one must justify it and update FR-043 checks 5–6 (BR-009 check) as needed; Phase 1 removes the skeleton-purity check (check 4).
- `config/server.yaml` does not exist, so `docker compose … up` cannot start `engine`; the runtime CMD is a placeholder exiting 0; no `/healthz`/`/readyz`.
- Supported platforms: macOS and Linux only; Docker scripts use POSIX `sh` (Alpine/busybox).
- Source projects use `types: []`; packages needing Node APIs (server, adapters) must enable them explicitly.
- `skipLibCheck: true` in `tsconfig.base.json`.
- Budgets: cold container tests ≤ 10 min, warm ≤ 3 min, native lint+typecheck+depcheck ≤ 60 s, guardrails ≤ 30 s, runtime image ≤ base + 25 MB.
- Deferred remote CI verifications: PR-fails-at-lint, stale-lockfile PR, cache hits, `ubuntu-latest` timings.

## Deliberately excluded

- No domain types, ports, error codes, canonical JSON or session logic (Phase 1); no config schema or sample `server.yaml` (Phase 2); no Fastify/pino/SQLite/zod/immer.
- No server, scanning/SBOM, release tooling, dependency-update automation, branch protection, or Windows support; the `games/**` import rule (requirements NFR-062) belongs to Phase 8a.
