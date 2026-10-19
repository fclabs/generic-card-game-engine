# Iteration 03 — ESLint, determinism rules and Prettier

**Previous commit**: `a55d1d536f9f60b7faff5da59be1987898ac9c69` (Add Vitest, fast-check and test scripts with placeholder tests)
**This commit's SHA**: see `git log` (do not amend this record after commit)

## Criteria results

| Criterion | Result | Command / evidence |
|-----------|--------|-------------------|
| VC-020 / FR-020 | **PASS** | `pnpm lint` → exit 0 |
| VC-021 / FR-021 | **PASS** | `pnpm format:check` → 0; mis-indented `packages/helpers/src/index.ts` → exit 1; `pnpm format` restores 0; scratch `docs/x.md` → still 0; `git diff --stat -- docs specs` empty for tracked files |
| VC-022 / FR-023 | **PASS** | scratch `packages/core/src/x.ts` via `pnpm exec eslint --format json`; all listed globals reported as `cge/no-nondeterministic-globals` naming Date, Math.random, performance, process, setTimeout, setInterval, setImmediate, queueMicrotask, crypto, globalThis.crypto, SharedArrayBuffer, Atomics, fetch, WebSocket |
| VC-023 / FR-022 | **PASS** | same cases: helpers 16 cge errors; `games/demo/hooks/x.ts` 16; `packages/core/src/x.test.ts` 0 cge errors |
| VC-024 / FR-024 | **PASS** | eight import forms each → `cge/no-nondeterministic-imports` |
| VC-025 / FR-025 | **PASS** | Date.now + `node:fs` in server, store-sqlite, config, vitest.config.ts, core `x.test.ts` → 0 cge errors each |
| VC-026 / BR-005 | **PASS** | `await Promise.resolve()` in core `x.ts` → 0 eslint errors |
| Prior checks | **PASS** | scratch removed; `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check` all exit 0 |
| Artifacts | **PASS** | `CONTEXT.md` rewritten; `DECISIONS.md` D-011…D-013; this record |

## Files added / changed

- Added: `eslint.config.mjs`, `eslint/cge-plugin.mjs`, `eslint/determinism.mjs`, `.prettierrc`, `.prettierignore`, `tsconfig.eslint.json`
- Changed: root `package.json` (scripts + eslint/prettier/typescript-eslint deps; TypeScript `6.0.3`), `pnpm-lock.yaml`
- Changed: package/tsconfig JSON whitespace from `pnpm format` (trailing commas / formatting only)
- Artifacts: `CONTEXT.md`, `DECISIONS.md` (D-011…D-013), `iterations/03-lint-format.md`

## Deviations

- **TypeScript 7.0.2 → 6.0.3** (D-011): required for `typescript-eslint` 8.71.2; revises Iteration 1 D-002.
- Type-aware lint uses explicit `parserOptions.project` globs (not `projectService`) so test files and `games/**` resolve (D-012).

## Gotchas

- `pnpm lint` runs `pnpm build` first — scratch files that are not type-valid for core source should be checked with `pnpm exec eslint` directly.
- JSDoc must not contain the sequence `*/` (e.g. avoid `` `**/*.test.ts` `` in block comments) or Prettier fails to parse.
- `games/*/hooks` files need inclusion in `tsconfig.eslint.json` or type-aware parse fails before `cge/*` rules run.

## For the next iteration

- Activate Node: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` → `v22.23.3` / pnpm `10.15.1`.
- Scripts: `lint`=`pnpm build && eslint . --max-warnings 0`; `format`=`prettier --write .`; `format:check`=`prettier --check .`.
- Rule ids: `cge/no-nondeterministic-globals`, `cge/no-nondeterministic-imports`.
- Exports: `determinismConfig`, `determinismFiles` from `eslint/determinism.mjs`; plugin name `cge`.
- Ignores: ESLint `**/dist/**`, `**/node_modules/**`, `coverage/**`, `tools/guardrails/fixtures/**`; Prettier exact FR-021 list.
- Versions: TypeScript `6.0.3`, ESLint `10.13.0`, `typescript-eslint` `8.71.2`, `@eslint/js` `10.0.1`, Prettier `3.9.10`, `globals` `17.13.0`.
- Smoke test at `tools/guardrails/smoke.test.ts` — still delete in Iteration 5.
- Next: dependency-cruiser (Iteration 4); keep fixture ignores (N7).
