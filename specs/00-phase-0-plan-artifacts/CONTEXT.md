# Phase 0 plan — CONTEXT

## Current state

- **Shipped foundation**: Node 22.23.3 + pnpm 10.15.1 workspace with exactly 13 `@cge/*` members; packages are empty skeletons (`export {}` / re-exports only).
- Strict TypeScript project references; Vitest unit + property placeholders; ESLint determinism rules; dependency-cruiser layering; guardrail suite (**167** tests) including FR-043 checks **1–7**.
- Docker multi-stage image (`node:22.23.3-alpine3.24`), compose test/run files, GitHub Actions CI (lint → typecheck → depcheck → container tests → runtime image).
- **Human docs shipped**: root `README.md`, `docs/dev-setup.md` (command reference / onboarding), `docs/workspace-architecture.md`, `docs/troubleshooting.md`. Check 7 reads `docs/dev-setup.md` via README link.
- Native and containerised `pnpm test:all` exit 0; documented commands verified on a clean tree.

## File map

```
README.md
.nvmrc                          # 22.23.3
.github/workflows/ci.yml
.dockerignore / .gitignore
.prettierrc / .prettierignore
.dependency-cruiser.cjs
package.json / pnpm-workspace.yaml / pnpm-lock.yaml
tsconfig.base.json / tsconfig.json / tsconfig.eslint.json
eslint.config.mjs
eslint/{cge-plugin,determinism}.mjs + determinism.d.mts
vitest.config.ts / vitest.guardrails.config.ts
packages/{core,app,config,helpers,conformance,server}/
packages/adapters/{store-memory,store-sqlite,transport-http,transport-ws,authz-static,timer-host}/
tools/guardrails/
  *.test.ts                     # lint-rules, depcruise-rules, repo-invariants
  repo-invariants.ts            # FR-043 checks 1–7
  fixtures/{lint,depcruise}/
games/.gitkeep
config/.gitkeep                 # no server.yaml yet
deploy/{Dockerfile,docker-compose.yml,docker-compose.test.yml}
docs/
  dev-setup.md                  # FR-070/071 surface (check 7)
  workspace-architecture.md
  troubleshooting.md
  architecture.md / design.md / implementation_plan.md / …
specs/00-phase-0.md
specs/00-phase-0-plan.md
specs/00-phase-0-plan-artifacts/
```

## Public interfaces

- Root scripts: `build`, `typecheck`, `lint`, `format`, `format:check`, `depcheck`, `test`, `test:coverage`, `test:guardrails`, `test:all`
- ESLint rule ids: `cge/no-nondeterministic-globals`, `cge/no-nondeterministic-imports`
- dependency-cruiser rule names: `layer-core-imports-nothing`, `layer-helpers-core-only`, `layer-config-core-only`, `layer-app-core-only`, `layer-adapters-no-server`, `layer-adapters-no-adapters`, `layer-adapters-allowed-only`, `layer-server-no-conformance`, `layer-conformance-leaf`, `core-no-node`, `no-circular`, `no-undeclared-deps`
- Repo-invariant helpers: `checkPackageMetadata`, `checkNodePnpmVersions`, `checkPlaceholderTests`, `checkSkeletonPurity`, `checkDevDependencyVersions`, `checkWorkspaceDependencies`, `checkDocumentation` (+ `DOCUMENTATION_SCRIPT_ALLOWLIST`)
- Docker stages: `base`, `build`, `test`, `runtime`; image `node:22.23.3-alpine3.24`
- Compose: `tests`, `engine`
- CI jobs: `lint` → `typecheck` → `depcheck` → `test` → `image`

## Conventions & invariants

- Intra-package imports: relative `./….js` (N1).
- Exact `devDependencies`; runtime `dependencies` only `workspace:*` `@cge/*`.
- Phase 0 sources: only `export {}`, re-exports, comments.
- Fixtures under `tools/guardrails/fixtures/` inert for real lint/format/build/typecheck/depcheck.
- Check 7: `README.md` links to `docs/dev-setup.md`; that file lists every root script (backtick-wrapped), both Docker commands verbatim, `core ← app ← adapters ← server`, heading `Adding a package`.
- CI: frozen-lockfile installs; no image push; Actions SHA-pinned.

## Commands

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
# node -v → v22.23.3 ; pnpm -v → 10.15.1

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
pnpm -r list --depth -1   # 13 @cge/* members

docker compose -f deploy/docker-compose.test.yml run --rm tests
docker compose -f deploy/docker-compose.yml config   # up needs config/server.yaml
docker build --target runtime -f deploy/Dockerfile -t cge-runtime:local .
```

Pinned versions: Node `22.23.3`, pnpm `10.15.1`, Alpine `node:22.23.3-alpine3.24`, TypeScript `6.0.3`, Vitest `5.0.5`, `@vitest/coverage-v8` `5.0.5`, `fast-check` `4.10.2`, `@types/node` `22.20.5`, ESLint `10.13.0`, `typescript-eslint` `8.71.2`, `@eslint/js` `10.0.1`, Prettier `3.9.10`, `globals` `17.13.0`, dependency-cruiser `18.6.0`.

## Known gaps

- `config/server.yaml` absent → `docker compose … up` cannot start `engine`.
- Runtime CMD is a placeholder (exits 0); no `/healthz` / `/readyz`.
- Remote CI verifications deferred: VC-060 PR-fail-at-lint, VC-061 stale-lockfile PR, VC-063 cache hits, VC-080 timings on `ubuntu-latest`, VC-082 on Linux CI.
- `skipLibCheck: true` in `tsconfig.base.json`.
- Branch protection / required status checks: out of scope (repo admin).
