# Phase 0 plan — CONTEXT

## Current state

- Node 22.23.3 + pnpm 10.15.1 workspace with exactly 13 members (6 top-level packages, 6 adapters, `@cge/guardrails`).
- Strict TypeScript project references: `pnpm build` (`tsc -b`) and `pnpm typecheck` (build + per-package `tsc -p tsconfig.test.json`) both exit 0.
- Every `packages/**` package exports only `dist` via `exports["."]`; sources are empty skeletons (`export {}` / re-exports); layering enforced by `tsconfig` references + `workspace:*` dependencies.
- Placeholder `src/index.test.ts` (Vitest) exists in each of the 12 `packages/**` packages; no root `test`/`lint`/`depcheck` scripts yet.
- Spec, plan, and this artifact directory live under `specs/` and are part of the Iteration 1 commit.

## File map

```
.nvmrc                          # 22.23.3
package.json                    # private, packageManager, engines, scripts build/typecheck
pnpm-workspace.yaml             # packages/*, packages/adapters/*, tools/*
pnpm-lock.yaml
tsconfig.base.json              # FR-003 strict flags, NodeNext, ES2022
tsconfig.json                   # solution: 12 packages/** source projects (not guardrails)
packages/core/                  # + src/{session,definition,visibility,replay,spi,ports,errors}/
packages/app/                   # + src/{proposal-handler,session-registry,publisher,session-factory,package}/
packages/{config,helpers,conformance,server}/
packages/adapters/{store-memory,store-sqlite,transport-http,transport-ws,authz-static,timer-host}/
tools/guardrails/               # package.json + tsconfigs only (no src, no exports)
games/.gitkeep
config/.gitkeep
deploy/.gitkeep
specs/00-phase-0.md
specs/00-phase-0-plan.md
specs/00-phase-0-plan-artifacts/
```

Each `packages/**` member: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `src/index.ts`, `src/index.test.ts`.

## Public interfaces

- Root scripts: `build` → `tsc -b`; `typecheck` → `pnpm build && pnpm -r exec tsc -p tsconfig.test.json --pretty false`.
- Package names: `@cge/<dir>` for `packages/*` and `tools/*`; `@cge/adapter-<dir>` for adapters.
- `exports` (packages/** only): `{ ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`.
- Reference/dependency matrix (BR-001 / N8): core→none; helpers/config/app→core; adapters→core,app,config; server & conformance→core,app,config,helpers,all six adapters; guardrails→none.
- No lint/depcheck/test/format scripts yet (Iterations 2–4).

## Conventions & invariants

- Intra-package imports use relative `./… .js` paths (N1); never `@cge/<self>`.
- Tests import `{ describe, it, expect }` from `vitest` explicitly; test projects use `types: ["node"]` (N10).
- Source projects use `types: []` (including adapters/server); core remains runtime-neutral (FR-008).
- `core`/`app` internal modules live under `src/<subfolder>/index.ts` and are re-exported from `src/index.ts`.
- `@cge/guardrails` has no `src/` and no `exports` (exempt); tests will live as `tools/guardrails/*.test.ts` (Iteration 2+); not in the root solution `tsconfig.json` build.
- Exact `devDependencies` versions only (BR-007); runtime `dependencies` are only `workspace:*` `@cge/*` (BR-009).
- Phase 0 sources: only `export {}`, re-exports, comments (BR-006).

## Commands

Activate Node 22 + pnpm (macOS Homebrew, this machine):

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
# verify: node -v → v22.23.3 ; pnpm -v → 10.15.1
# if pnpm missing: corepack enable && corepack prepare pnpm@10.15.1 --activate
```

From repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm -r list --depth -1   # expect 13 @cge/* members
```

Pinned versions: Node `22.23.3`, pnpm `10.15.1`, TypeScript `7.0.2`, Vitest `5.0.5`, `@types/node` `22.20.5`.

## Known gaps

- No Vitest root config / `pnpm test*` scripts → Iteration 2.
- No ESLint / Prettier / determinism rules → Iteration 3.
- No dependency-cruiser → Iteration 4.
- Guardrails fixtures and real tests → Iterations 5–6, 8.
- Docker / CI / README → Iterations 7, 9, 10.
- Dockerfile not yet present; FR-009 Dockerfile agreement deferred to Iteration 7/8.
- `skipLibCheck: true` in `tsconfig.base.json` (plan allowed false “if feasible”; left true for quieter tool typings).
