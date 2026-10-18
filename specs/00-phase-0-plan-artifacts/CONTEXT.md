# Phase 0 plan — CONTEXT

## Current state

- Node 22.23.3 + pnpm 10.15.1 workspace with exactly 13 members (6 top-level packages, 6 adapters, `@cge/guardrails`).
- Strict TypeScript project references: `pnpm build` and `pnpm typecheck` both exit 0 (TypeScript **6.0.3**).
- Vitest 5.0.5 root configs: unit suite over `packages/**` + `games/**`; separate guardrails config for `tools/guardrails/**`.
- ESLint flat config with type-aware `typescript-eslint` recommended rules, plus local `cge/*` determinism rules scoped to core/helpers/hooks.
- Prettier configured; `pnpm lint` and `pnpm format:check` exit 0 on the skeleton.
- **dependency-cruiser 18.6.0** enforces §7.3 layering / `core-no-node` / `no-circular` / `no-undeclared-deps`; `pnpm depcheck` exits 0.
- Every `packages/**` package has `src/index.test.ts` (≥1 test); `packages/core` also has a `fast-check` property placeholder; `tools/guardrails/smoke.test.ts` is a temporary smoke (deleted in Iteration 5).

## File map

```
.nvmrc                          # 22.23.3
.prettierrc                     # semi, double quotes, trailingComma all, printWidth 80
.prettierignore                 # exact FR-021 list
.dependency-cruiser.cjs         # §7.3 forbidden rules + options (N6/N7)
package.json                    # scripts: build, typecheck, lint, format*, depcheck, test*
pnpm-workspace.yaml
pnpm-lock.yaml
tsconfig.base.json
tsconfig.json                   # solution: 12 packages/** (not guardrails)
tsconfig.eslint.json            # vitest configs + games/**/*.ts for type-aware lint
eslint.config.mjs               # flat config; spreads determinismConfig
eslint/cge-plugin.mjs           # plugin name "cge"; two rules
eslint/determinism.mjs          # determinismFiles + determinismConfig
vitest.config.ts
vitest.guardrails.config.ts
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
  - `lint` → `pnpm build && eslint . --max-warnings 0`
  - `format` → `prettier --write .`
  - `format:check` → `prettier --check .`
  - `depcheck` → `pnpm build && depcruise packages games --config .dependency-cruiser.cjs`
  - `test` → `pnpm build && vitest run` (uses `vitest.config.ts`; no coverage)
  - `test:coverage` → `pnpm build && vitest run --coverage` → writes `coverage/` (git-ignored)
  - `test:guardrails` → `pnpm build && vitest run --config vitest.guardrails.config.ts`
  - `test:all` → `pnpm test && pnpm test:guardrails`
- ESLint rule ids: `cge/no-nondeterministic-globals`, `cge/no-nondeterministic-imports`
- dependency-cruiser rule names (all severity `error`):
  - `layer-core-imports-nothing`, `layer-helpers-core-only`, `layer-config-core-only`,
    `layer-app-core-only`, `layer-adapters-no-server`, `layer-adapters-no-adapters`,
    `layer-adapters-allowed-only`, `layer-server-no-conformance`, `layer-conformance-leaf`,
    `core-no-node`, `no-circular`, `no-undeclared-deps`
- Matching strategy (N6): each workspace edge matches resolved path
  `(^|/)packages/<dir>/`, `(^|/)node_modules/@cge/<name>/`, or specifier `^@cge/<name>($|/)`
  (adapters: `packages/adapters/<dir>/` / `@cge/adapter-*`). Relative imports into
  another package's `src` or `dist` are covered via the path patterns.
- `eslint/determinism.mjs` exports:
  - `determinismFiles` — `packages/core/**`, `packages/helpers/**`, `games/*/hooks/**`
  - `determinismConfig` — flat-config array enabling both `cge/*` rules as error; ignores `**/*.test.ts`
- ESLint ignores: `**/dist/**`, `**/node_modules/**`, `coverage/**`, `tools/guardrails/fixtures/**`
- `.prettierignore` exactly: `docs/**`, `specs/**`, `pnpm-lock.yaml`, `LICENSE`, `dist/`, `coverage/`, `tools/guardrails/fixtures/**`
- Package names / exports / reference matrix unchanged (N8).

## Conventions & invariants

- Intra-package imports use relative `./….js` paths (N1).
- Tests: `*.test.ts` under `packages/**/src/` and `games/**`; guardrail tests as `tools/guardrails/*.test.ts`.
- Determinism scope (FR-022): core, helpers, `games/*/hooks` — tests exempt (BR-004); `Promise`/`async`/`await` allowed (BR-005).
- New package edges: add `workspace:*` deps + `tsconfig` references per N8/BR-001; layering is enforced by `.dependency-cruiser.cjs` (path|specifier patterns).
- `eslint/` is a plain directory (not a workspace member) (N2).
- Exact `devDependencies` only (BR-007); `vitest`/`fast-check`/`@vitest/coverage-v8` identical exact versions wherever declared.
- Runtime `dependencies` are only `workspace:*` `@cge/*` (BR-009).
- Phase 0 sources: only `export {}`, re-exports, comments (BR-006).
- Scratch lint checks on core that would break `pnpm build` should use `pnpm exec eslint` directly (`pnpm lint` runs build first).
- Scratch depcheck checks: use `pnpm exec depcruise packages --config .dependency-cruiser.cjs` (skips the build step when not needed).

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
pnpm lint
pnpm format
pnpm format:check
pnpm depcheck
pnpm test
pnpm test:coverage
pnpm test:guardrails
pnpm test:all
pnpm -r list --depth -1   # expect 13 @cge/* members
```

Pinned versions: Node `22.23.3`, pnpm `10.15.1`, TypeScript `6.0.3`, Vitest `5.0.5`, `@vitest/coverage-v8` `5.0.5`, `fast-check` `4.10.2`, `@types/node` `22.20.5`, ESLint `10.13.0`, `typescript-eslint` `8.71.2`, `@eslint/js` `10.0.1`, Prettier `3.9.10`, `globals` `17.13.0`, **dependency-cruiser `18.6.0`**.

## Known gaps

- Guardrails fixtures and real tests (delete `smoke.test.ts`) → Iterations 5–6, 8.
- Docker / CI / README → Iterations 7, 9, 10.
- Dockerfile not yet present; FR-009 Dockerfile agreement deferred to Iteration 7/8.
- `skipLibCheck: true` in `tsconfig.base.json` (from Iteration 1).
