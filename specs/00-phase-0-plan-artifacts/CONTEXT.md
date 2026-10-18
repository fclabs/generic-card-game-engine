# Phase 0 plan — CONTEXT

## Current state

- Node 22.23.3 + pnpm 10.15.1 workspace with exactly 13 members (6 top-level packages, 6 adapters, `@cge/guardrails`).
- Strict TypeScript project references: `pnpm build` and `pnpm typecheck` both exit 0.
- Vitest 5.0.5 root configs: unit suite over `packages/**` + `games/**`; separate guardrails config for `tools/guardrails/**`.
- Root scripts: `build`, `typecheck`, `test`, `test:coverage`, `test:guardrails`, `test:all` all green.
- Every `packages/**` package has `src/index.test.ts` (≥1 test); `packages/core` also has a `fast-check` property placeholder; `tools/guardrails/smoke.test.ts` is a temporary smoke (deleted in Iteration 5).

## File map

```
.nvmrc                          # 22.23.3
package.json                    # scripts: build, typecheck, test, test:coverage, test:guardrails, test:all
pnpm-workspace.yaml
pnpm-lock.yaml
tsconfig.base.json
tsconfig.json                   # solution: 12 packages/** (not guardrails)
vitest.config.ts                # units: packages/** + games/**; excludes tools/guardrails
vitest.guardrails.config.ts     # tools/guardrails/**/*.test.ts (excludes fixtures/)
packages/core/                  # + property test; fast-check in devDependencies
packages/app/
packages/{config,helpers,conformance,server}/
packages/adapters/{store-memory,store-sqlite,transport-http,transport-ws,authz-static,timer-host}/
tools/guardrails/               # smoke.test.ts + tsconfigs (no src, no exports)
games/.gitkeep
config/.gitkeep
deploy/.gitkeep
specs/00-phase-0.md
specs/00-phase-0-plan.md
specs/00-phase-0-plan-artifacts/
```

Each `packages/**` member: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `src/index.ts`, `src/index.test.ts`.

## Public interfaces

- Root scripts:
  - `build` → `tsc -b`
  - `typecheck` → `pnpm build && pnpm -r exec tsc -p tsconfig.test.json --pretty false`
  - `test` → `pnpm build && vitest run` (uses `vitest.config.ts`; no coverage)
  - `test:coverage` → `pnpm build && vitest run --coverage` → writes `coverage/` (git-ignored)
  - `test:guardrails` → `pnpm build && vitest run --config vitest.guardrails.config.ts`
  - `test:all` → `pnpm test && pnpm test:guardrails`
- Package names: `@cge/<dir>` / `@cge/adapter-<dir>` / `@cge/guardrails`.
- `exports` (packages/** only): `{ ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`.
- Reference/dependency matrix unchanged (BR-001 / N8).

## Conventions & invariants

- Intra-package imports use relative `./….js` paths (N1).
- Tests: `*.test.ts` under `packages/**/src/` and `games/**`; guardrail tests as `tools/guardrails/*.test.ts`.
- Tests import `{ describe, it, expect }` from `vitest` explicitly; test projects use `types: ["node"]`.
- Source projects use `types: []`; core remains runtime-neutral.
- `@cge/guardrails` has no `src/` / `exports`; not in solution build; smoke test temporary until Iteration 5.
- Exact `devDependencies` only (BR-007); `vitest`/`fast-check`/`@vitest/coverage-v8` identical exact versions wherever declared.
- Runtime `dependencies` are only `workspace:*` `@cge/*` (BR-009).
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
pnpm test
pnpm test:coverage
pnpm test:guardrails
pnpm test:all
pnpm -r list --depth -1   # expect 13 @cge/* members
```

Pinned versions: Node `22.23.3`, pnpm `10.15.1`, TypeScript `7.0.2`, Vitest `5.0.5`, `@vitest/coverage-v8` `5.0.5`, `fast-check` `4.10.2`, `@types/node` `22.20.5`.

## Known gaps

- No ESLint / Prettier / determinism rules → Iteration 3.
- No dependency-cruiser → Iteration 4.
- Guardrails fixtures and real tests (delete `smoke.test.ts`) → Iterations 5–6, 8.
- Docker / CI / README → Iterations 7, 9, 10.
- Dockerfile not yet present; FR-009 Dockerfile agreement deferred to Iteration 7/8.
- `skipLibCheck: true` in `tsconfig.base.json` (from Iteration 1).
