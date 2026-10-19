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

## D-011: TypeScript pinned to 6.0.3 for typescript-eslint  (Iteration 3)
**Context**: Iteration 1 chose TypeScript 7.0.2 (D-002), but `typescript-eslint` 8.71.2 hard-fails on TS 7 (`does not support TS 7.0`). Peer range is `>=4.8.4 <6.1.0`.
**Decision**: Downgrade root `typescript` to exact `6.0.3` (latest in the supported range). Revises D-002.
**Rejected**: Staying on TS 7 with non-type-aware lint only (violates FR-020); dual TS installs for side-by-side (unnecessary complexity for Phase 0).
**Consequences**: All `tsc` / Vitest typing use 6.0.3. Revisit when typescript-eslint supports TS ≥7.1.

## D-012: Type-aware ESLint project wiring (N3)  (Iteration 3)
**Context**: Source `tsconfig.json` files exclude `*.test.ts` (FR-004); `projectService` therefore cannot type-check tests. `games/*/hooks` has no package tsconfig.
**Decision**: `parserOptions.project` globs each package's `tsconfig.test.json` plus `tools/guardrails/tsconfig.test.json` and root `tsconfig.eslint.json` (covers `vitest*.config.ts` and `games/**/*.ts`). Plain `*.mjs`/`*.js`/`*.cjs` use `typescript-eslint`'s `disableTypeChecked` + Node `globals`. `determinismConfig` is a standalone syntactic flat-config array exported from `eslint/determinism.mjs` and spread into `eslint.config.mjs`.
**Rejected**: `projectService: true` alone (misses tests and games hooks); making source tsconfigs include tests (breaks FR-004).
**Consequences**: Iteration 5 guardrails import `determinismConfig` for `lintText` on virtual paths; `calculateConfigForFile` against the real config proves wiring.

## D-013: Local `cge` plugin and Prettier options (N2/N4/N5/N7)  (Iteration 3)
**Context**: Spec requires exact rule ids `cge/no-nondeterministic-globals` and `cge/no-nondeterministic-imports`; VC-001 forbids a 14th workspace member; FR-021 pins `.prettierignore`.
**Decision**: Rules live in `eslint/cge-plugin.mjs` (plugin name `cge`); scope globs in `eslint/determinism.mjs` as `determinismFiles`. Prettier: `semi: true`, `singleQuote: false`, `trailingComma: "all"`, `printWidth: 80`, `tabWidth: 2`, `arrowParens: "always"`. `.prettierignore` is exactly the FR-021 list (Prettier still honours `.gitignore` for `node_modules` etc.).
**Rejected**: Built-in `no-restricted-*` with message prefixes (weaker ruleId match for guardrails); `eslint/` as a workspace package.
**Consequences**: Fixture inertness ignores already listed for ESLint and Prettier; Iteration 4–5 must keep them.

## D-014: dependency-cruiser matching and undeclared deps (N6/N7)  (Iteration 4)
**Context**: FR-026 requires layering rules to fire on both resolved paths and bare `@cge/*` specifiers (fixture trees lack pnpm links); FR-029 needs `no-undeclared-deps`; N7 requires fixtures excluded from real depcheck.
**Decision**: (1) Each workspace target is a regex array of path under `packages/…`, `node_modules/@cge/…`, and specifier `^@cge/…($|/)`. Adapter cross-imports use from-capture `$2` with `pathNot` so intra-adapter relative imports do not false-positive. (2) `no-undeclared-deps` uses `dependencyTypes: ["npm-no-pkg", "npm-unknown"]` only. Declared workspace `@cge/*` resolve as local/aliased edges and are governed by layering rules; undeclared npm packages that resolve via the hoisted store (e.g. root `fast-check` imported from `app`) are `npm-no-pkg`. Fully unresolved bare names are `unknown` (not in the rule — layering/`couldNotResolve` cover most cases). (3) `exclude.path` lists `tools/guardrails/fixtures|coverage|\\.tsbuildinfo$` but **not** `node_modules` or `dist` (excluding `node_modules` dropped resolved npm edges and silenced `no-undeclared-deps`; excluding `dist` would miss FR-026 relative-into-dist). `doNotFollow.path: node_modules` prevents descending into packages. (4) `tsPreCompilationDeps: true` so type-only/re-export edges and cycles are visible.
**Rejected**: Path-only matching (breaks fixtures); excluding `node_modules` in `exclude` (silences FR-029); adding `unknown` to undeclared rule without a VC (plan names only `npm-no-pkg`/`npm-unknown`).
**Consequences**: Iteration 6 must override or clear `options.exclude` when `cruise()`-ing fixture trees under `tools/guardrails/fixtures/` (the real exclude would otherwise skip the case). Use ESM `import { cruise } from "dependency-cruiser"` (async); load config via `dependency-cruiser/config-utl/extract-depcruise-config`.

## D-015: determinismFiles globs for lintText matching  (Iteration 5)
**Context**: Under ESLint 10 + `overrideConfigFile: true`, `files` globs ending in `/**` alone do not match virtual `filePath`s passed to `lintText`, so every FR-040 fixture would silently get 0 rule hits.
**Decision**: Change `determinismFiles` to `packages/core/**/*.{ts,js,mjs}`, `packages/helpers/**/*.{ts,js,mjs}`, `games/*/hooks/**/*.{ts,js,mjs}`. Same globs are spread into the real `eslint.config.mjs` via `determinismConfig`.
**Rejected**: Keeping bare `/**` and forcing absolute paths or a custom `basePath` (fragile across ESLint versions); duplicating a second “test-only” files list (would drift from production scope).
**Consequences**: Real CLI lint and guardrail `lintText` share one glob list. Iteration 6+ must not revert to `/**` without re-checking `lintText`.

## D-016: Lint fixtures as a typed cases table  (Iteration 5)
**Context**: FR-040 needs data-driven fixtures; N7 requires fixtures inert for real lint/format/build/typecheck.
**Decision**: One table at `tools/guardrails/fixtures/lint/cases.ts` exporting `lintCases` (`LintCase`: `{ id, filePath, code, expect }`) with banned forms as **string codes only** (never executed). Helpers in `tools/guardrails/lint-helpers.ts` build two ESLint instances per N3. `tsconfig.test.json` includes `./*.ts` + `fixtures/lint/cases.ts` and excludes `fixtures/depcruise/**`. Types for `eslint/determinism.mjs` via `eslint/determinism.d.mts`. `@cge/guardrails` declares exact `eslint` `10.13.0` (FR-029).
**Rejected**: Per-file `.fixture` sources under fixtures (harder to typecheck the table; more inertness surface); putting `cases.ts` outside `fixtures/` (plan places lint fixtures under `fixtures/lint/**`).
**Consequences**: Prettier/ESLint ignore `tools/guardrails/fixtures/**` (including `cases.ts`); Iteration 6 adds `fixtures/depcruise/**` trees still excluded from tsc. Wiring mutation (remove `...determinismConfig` from `eslint.config.mjs`) fails the suite via `calculateConfigForFile` assertions.

## D-017: Depcruise fixture cases and multi-rule expectations  (Iteration 6)
**Context**: FR-041 needs one self-contained tree per §7.3 rule plus VC-031; some forbidden edges legitimately fire more than one named rule; BR-001 has no mutual legal edge for a “clean” cross-package cycle.
**Decision**: (1) Case dirs named `<rule-or-theme>[-variant]` under `tools/guardrails/fixtures/depcruise/`; expected exact rule-name sets live in `tools/guardrails/depcruise-cases.ts` (typechecked with other `*.ts`); runner is `cruiseFixtureCase` in `depcruise-helpers.ts` using the real `.dependency-cruiser.cjs` with `exclude` overridden per D-014. (2) Document multi-fire in the table: `layer-conformance-leaf` (app→conformance) also expects `layer-app-core-only`; `layer-server-no-conformance` and `layer-adapters-allowed-only-conformance` also expect `layer-conformance-leaf`; `no-circular-cross` (core↔app relative) also expects `layer-core-imports-nothing`. (3) VC-031 `legitimate-directions` uses **relative** allowed edges so they resolve inside the fixture tree. (4) `@cge/guardrails` declares exact `dependency-cruiser` `18.6.0` (FR-029).
**Rejected**: Asserting only the “primary” rule when others also fire (would violate “exact expected set”); inventing a fake mutual legal edge for cross-cycles; putting the expected table under `fixtures/depcruise/` (would need another tsc include like lint `cases.ts`).
**Consequences**: Mutation sanity renames a rule’s `name` in `.dependency-cruiser.cjs` → that case’s exact-set assertion fails; always `git checkout -- .dependency-cruiser.cjs` afterwards. Fixture `package.json`s stay out of the workspace (`tools/*` does not match `tools/guardrails/fixtures/**`). Root `.gitignore` must negate `tools/guardrails/fixtures/**/dist/**` so relative-into-dist fixtures remain tracked.

## D-018: Docker runtime staging and build-context exceptions  (Iteration 7)
**Context**: FR-050–056 need a multi-stage image with a hardened `runtime`, cached `base` install, and a build context that drops `node_modules`/`.env*`/`dist` while still shipping the FR-026 relative-into-dist guardrail fixture.
**Decision**: (1) Base tag `node:22.23.3-alpine3.24` via corepack `pnpm@10.15.1`. (2) `base` copies only root + per-member `package.json` manifests then `pnpm install --frozen-lockfile`. (3) `runtime` is a fresh `FROM` of the same tag: copy manifests + `dist/` from `build`, `pnpm install --prod --frozen-lockfile` (workspace links only — no prod npm deps in Phase 0), `rm -rf tools`, root-own `/app` with `chmod -R a-w`, `/data` owned by `node` + `VOLUME`, `USER node`, `NODE_ENV=production`, `CMD ["node","packages/server/dist/index.js"]`. (4) `.dockerignore` excludes `**/dist` but re-includes `tools/guardrails/fixtures/**/dist/**`. (5) Compose bind mount target `/etc/engine/server.yaml:ro` (long-form bind); `ENGINE_HOST_KEY: ${ENGINE_HOST_KEY:-}` so `config` validates without the host file.
**Rejected**: Deriving `runtime` from `build` (would retain sources/devDeps); omitting fixture-dist negations (breaks `layer-core-imports-nothing-relative-dist` in the test image); short-form bind that fails `compose config` when the host path is missing.
**Consequences**: Iteration 8 FR-043 check 2 must parse the two pinned `FROM node:22.23.3-alpine3.24` lines; CI (Iteration 9) uses the same compose/build commands; `docker compose … up` still cannot start until Phase 2 adds `config/server.yaml`.
