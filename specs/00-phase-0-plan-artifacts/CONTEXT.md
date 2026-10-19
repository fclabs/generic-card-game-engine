# Phase 0 plan — CONTEXT

## Current state

- Node 22.23.3 + pnpm 10.15.1 workspace with exactly 13 members (6 top-level packages, 6 adapters, `@cge/guardrails`).
- Strict TypeScript project references: `pnpm build` and `pnpm typecheck` both exit 0 (TypeScript **6.0.3**).
- Vitest 5.0.5: unit suite + guardrails (**163** tests); native `pnpm lint` / `typecheck` / `depcheck` / `test:all` / `format:check` all exit 0.
- ESLint determinism rules + dependency-cruiser §7.3 layering; guardrail fixtures inert (FR-042).
- Docker (Iteration 7): multi-stage `deploy/Dockerfile`, compose files, `.dockerignore`. Base tag `node:22.23.3-alpine3.24`.
- **Repo invariants (Iteration 8)**: `tools/guardrails/repo-invariants.test.ts` enforces FR-043 checks 1–6 with offender-naming messages + temp-dir mutation tests. Check 7 deferred to Iteration 10.

## File map

```
.nvmrc                          # 22.23.3
.dockerignore
.prettierrc / .prettierignore
.dependency-cruiser.cjs
.gitignore
package.json / pnpm-workspace.yaml / pnpm-lock.yaml
tsconfig.base.json / tsconfig.json / tsconfig.eslint.json
eslint.config.mjs
eslint/{cge-plugin,determinism}.mjs + determinism.d.mts
vitest.config.ts / vitest.guardrails.config.ts
packages/{core,app,config,helpers,conformance,server}/
packages/adapters/{store-memory,store-sqlite,transport-http,transport-ws,authz-static,timer-host}/
tools/guardrails/
  *.test.ts                     # lint-rules, depcruise-rules, repo-invariants
  repo-invariants.ts            # pure FR-043 checks 1–6 over a repo root
  lint-helpers.ts / depcruise-*.ts
  fixtures/{lint,depcruise}/
games/.gitkeep
config/.gitkeep
deploy/{Dockerfile,docker-compose.yml,docker-compose.test.yml}
specs/00-phase-0.md
specs/00-phase-0-plan.md
specs/00-phase-0-plan-artifacts/
```

Each `packages/**` member: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `src/index.ts`, `src/index.test.ts`.

## Public interfaces

- Root scripts: `build`, `typecheck`, `lint`, `format`, `format:check`, `depcheck`, `test`, `test:coverage`, `test:guardrails`, `test:all`
- ESLint rule ids: `cge/no-nondeterministic-globals`, `cge/no-nondeterministic-imports`
- dependency-cruiser rule names: `layer-core-imports-nothing`, `layer-helpers-core-only`, `layer-config-core-only`, `layer-app-core-only`, `layer-adapters-no-server`, `layer-adapters-no-adapters`, `layer-adapters-allowed-only`, `layer-server-no-conformance`, `layer-conformance-leaf`, `core-no-node`, `no-circular`, `no-undeclared-deps`
- Repo-invariant helpers (`tools/guardrails/repo-invariants.ts`): `checkPackageMetadata`, `checkNodePnpmVersions`, `checkPlaceholderTests`, `checkSkeletonPurity`, `checkDevDependencyVersions`, `checkWorkspaceDependencies` — each returns `{ ok: true } | { ok: false; message }`
- Docker stages: `base`, `build`, `test`, `runtime`; pinned image `node:22.23.3-alpine3.24`
- Compose services: `tests`, `engine`

## Conventions & invariants

- Intra-package imports use relative `./….js` paths (N1).
- Exact `devDependencies` only (BR-007); runtime `dependencies` only `workspace:*` `@cge/*` (BR-009) — enforced by FR-043 checks 5–6.
- Phase 0 sources: only `export {}`, re-exports, comments (BR-006) — enforced by check 4 via `ts.createSourceFile`.
- FR-002 / FR-009 / FR-012 package/version/test presence — checks 1–3.
- Fixtures under `tools/guardrails/fixtures/` inert for real lint/format/build/typecheck/depcheck (N7).
- Check 7 (README) not yet implemented.

## Commands

Activate Node 22 + pnpm (macOS Homebrew, this machine):

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
# verify: node -v → v22.23.3 ; pnpm -v → 10.15.1
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

# Docker
docker buildx build --check -f deploy/Dockerfile .
docker build --target test -f deploy/Dockerfile -t cge-test:local .
docker build --target runtime -f deploy/Dockerfile -t cge-runtime:local .
docker compose -f deploy/docker-compose.test.yml run --rm tests
docker compose -f deploy/docker-compose.yml config
docker run --rm cge-runtime:local
```

Pinned versions: Node `22.23.3`, pnpm `10.15.1`, Alpine base `node:22.23.3-alpine3.24`, TypeScript `6.0.3`, Vitest `5.0.5`, `@vitest/coverage-v8` `5.0.5`, `fast-check` `4.10.2`, `@types/node` `22.20.5`, ESLint `10.13.0`, `typescript-eslint` `8.71.2`, `@eslint/js` `10.0.1`, Prettier `3.9.10`, `globals` `17.13.0`, dependency-cruiser `18.6.0`.

## Known gaps

- FR-043 **check 7** (README documents scripts / FR-070–071) → Iteration 10.
- CI workflow → Iteration 9.
- Human docs / README → Iteration 10.
- `config/server.yaml` absent → `docker compose … up` cannot start `engine` in Phase 0.
- Remote CI timings / cache hits deferred.
- `skipLibCheck: true` in `tsconfig.base.json` (from Iteration 1).
