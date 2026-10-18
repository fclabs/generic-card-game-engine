# Phase 0 plan — DECISIONS

## D-001: Node and pnpm exact versions  (Iteration 1)
**Context**: FR-009 requires one exact Node 22.x.y and one exact pnpm; machine default was Node 26 and pnpm was missing.
**Decision**: Node `22.23.3` (Homebrew `node@22`), pnpm `10.15.1` via corepack. `.nvmrc` = `22.23.3`; `packageManager` = `pnpm@10.15.1`; `engines.node` = `>=22 <23`.
**Rejected**: Floating `node:22` / latest pnpm 12.x (violates pin); switching the system Homebrew `node` link (would disrupt other work).
**Consequences**: Every shell must prepend `/opt/homebrew/opt/node@22/bin` (or equivalent nvm/fnm). Dockerfile (Iteration 7) must use a `node:22.23.3-alpine…` tag matching this patch.

## D-002: Toolchain exact versions  (Iteration 1)
**Context**: BR-007 requires exact-pinned `devDependencies`.
**Decision**: TypeScript `7.0.2` (npm `latest` at implement time), Vitest `5.0.5`, `@types/node` `22.20.5`. Vitest declared at root and in every workspace member that will run/typecheck tests.
**Rejected**: Staying on TypeScript 5.9.x solely for familiarity — plan says current stable.
**Consequences**: Later iterations pin ESLint/etc. the same way; FR-043 will require `^\d+\.\d+\.\d+$` versions.

## D-003: Internal imports use relative `.js` paths (N1)  (Iteration 1)
**Context**: Spec leaves intra-package import style open.
**Decision**: Tests and sources import own-package code via relative paths ending in `.js` (e.g. `./index.js`), never `@cge/<self>`.
**Rejected**: Self-package-name imports (adds circular resolution risk and needs exports for subpaths).
**Consequences**: ESM NodeNext resolution requires the `.js` extension in TypeScript source imports.

## D-004: core/app sub-folders under `src/`  (Iteration 1)
**Context**: Spec §2 vs §7.1 disagree on whether `session/` etc. sit beside or under `src/`.
**Decision**: Place them at `packages/core/src/<sub>/index.ts` and `packages/app/src/<sub>/index.ts`; package `src/index.ts` re-exports them.
**Rejected**: Top-level `packages/core/session/` (would break `rootDir: src` / single entry `dist` layout).
**Consequences**: Deep path `@cge/core/src/session/…` is not in `exports` and fails resolution (VC-034).

## D-005: Package reference and dependency matrix (N8)  (Iteration 1)
**Context**: FR-006 / BR-001 / VC-005 need references and `workspace:*` deps even though Phase 0 sources do not import across packages.
**Decision**: Implement the full N8 matrix in both `tsconfig.json#references` and `package.json#dependencies`. Guardrails has neither.
**Rejected**: Omitting deps until first real import (would fail VC-005 and FR-029 later).
**Consequences**: Scratch `import "@cge/core"` in app builds; scratch `import "@cge/app"` in core fails. Do not commit cross-package imports (BR-006).

## D-006: Guardrails layout and solution membership (N9)  (Iteration 1)
**Context**: VC-001 needs exactly 13 members; guardrails is tooling, not a library.
**Decision**: `@cge/guardrails` has no `src/`, no `exports`, composite `tsconfig.json` with empty `files`/`include`, `tsconfig.test.json` includes `./*.ts` (excluding `fixtures/**` later). Not listed in the root solution `tsconfig.json`; still type-checked via `pnpm -r exec tsc -p tsconfig.test.json`.
**Rejected**: Putting guardrails in the solution build; giving it a fake `src/index.ts` + exports (would imply a public API).
**Consequences**: Iteration 2 places smoke/real tests as `tools/guardrails/*.test.ts`. ESLint plugin stays out of the workspace (N2, Iteration 3).

## D-007: Test project mechanics (N10)  (Iteration 1)
**Context**: FR-004 / VC-007 need tests to see Node types while core sources do not.
**Decision**: `tsconfig.test.json`: `noEmit`, non-composite, `include: ["src/**/*.ts"]` (guardrails: `./*.ts`), `references: [{ path: "./tsconfig.json" }]`, `types: ["node"]`. Tests use explicit `import { describe, it, expect } from "vitest"` (no vitest globals).
**Rejected**: `vitest/globals` types (hides imports; less explicit).
**Consequences**: `process` in `core` source fails build; same line in `core` test passes typecheck.

## D-008: Source `types: []` for all packages  (Iteration 1)
**Context**: Plan allows `["node"]` for adapters/server/config/conformance if needed.
**Decision**: All package source projects use `types: []` in Phase 0; only test projects add `"node"`.
**Rejected**: Enabling Node types in adapter/server sources early (unnecessary while sources are empty).
**Consequences**: When Iteration 7+ needs Node APIs in server/adapters, those packages' source `types` must be updated and `@types/node` remains available from the root.

## D-009: N2–N7 deferred  (Iteration 1)
**Context**: Cross-cutting notes N2–N7 concern ESLint plugin layout, determinism config, depcruise matching, and fixture inertness.
**Decision**: Not acted on in Iteration 1 (no ESLint/depcruise yet). They remain binding for Iterations 3–6.
**Rejected**: Premature stub directories.
**Consequences**: Iteration 3 must create `eslint/` as a plain directory (not a 14th workspace member).

## D-010: Separate Vitest config for guardrails  (Iteration 2)
**Context**: FR-010's `pnpm test` must not run `tools/guardrails/**`; FR-013 needs a dedicated `test:guardrails` entry point.
**Decision**: Root `vitest.config.ts` includes only `packages/**/*.test.ts` and `games/**/*.test.ts` (excludes `tools/guardrails/**`). Guardrail suite uses `vitest.guardrails.config.ts` selected via `vitest run --config vitest.guardrails.config.ts`. Coverage stays off unless `--coverage` (`test:coverage`).
**Rejected**: Single config with CLI `--dir` only (easy to accidentally run the wrong include); Vitest `projects` workspace (heavier than needed for Phase 0).
**Consequences**: Iteration 5+ adds real guardrail tests under the same config; fixtures path is already excluded there.
