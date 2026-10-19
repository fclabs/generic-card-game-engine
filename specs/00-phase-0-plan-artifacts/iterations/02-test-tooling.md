# Iteration 02 — Vitest, fast-check and test scripts

**Previous commit**: `4e46fd0` (Add pnpm workspace skeleton with strict TypeScript project references)
**This commit's SHA**: see `git log` (do not amend this record after commit)

## Criteria results

| Criterion | Result | Command / evidence |
|-----------|--------|-------------------|
| VC-010 / FR-010 | **PASS** | `pnpm test` → exit 0; `pnpm exec vitest run --reporter=verbose` lists ≥1 test in each of 12 `packages/**`; false assertion in helpers → exit 1; reverted |
| VC-011 / FR-011 | **PASS** | Property test in `packages/core/src/index.test.ts` passes; scratch `node` counter of `fc.assert(fc.property(fc.integer(), …))` → **100** default runs; verbose `{ verbose: true }` scratch reverted |
| VC-013 / FR-013 | **PASS** | `pnpm test:all` → exit 0; output shows unit suite (`Test Files 12`) then guardrails (`Test Files 1`); failing smoke → exit 1; reverted |
| VC-014 / FR-014 | **PASS** | `rm -rf coverage; pnpm test` → no `coverage/`; `pnpm test:coverage` creates `coverage/`; `git check-ignore -v coverage/` → `.gitignore:22:coverage` |
| `pnpm build` / `pnpm typecheck` | **PASS** | both exit 0 after changes |
| Artifacts | **PASS** | `CONTEXT.md` rewritten; `DECISIONS.md` D-010; this record |

## Files added / changed

- Added: `vitest.config.ts`, `vitest.guardrails.config.ts`, `tools/guardrails/smoke.test.ts`
- Changed: root `package.json` (scripts + `@vitest/coverage-v8`, `fast-check`), `packages/core/package.json` (`fast-check`), `packages/core/src/index.test.ts` (property test), `pnpm-lock.yaml`
- Artifacts: `CONTEXT.md`, `DECISIONS.md` (D-010), `iterations/02-test-tooling.md`

## Deviations

- None material. Guardrail separation uses a second config file (plan allowed this explicitly).

## Gotchas

- `pnpm test -- --reporter=verbose` appends `--` into `vitest run` args; prefer `pnpm exec vitest run --reporter=verbose` for reports.
- `fast-check` default `numRuns` is 100; confirmed via a scratch Node counter (not committed).

## For the next iteration

- Activate Node: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` → `v22.23.3` / pnpm `10.15.1`.
- Scripts: `build`=`tsc -b`; `typecheck`=`pnpm build && pnpm -r exec tsc -p tsconfig.test.json --pretty false`; `test`=`pnpm build && vitest run`; `test:coverage`=`pnpm build && vitest run --coverage`; `test:guardrails`=`pnpm build && vitest run --config vitest.guardrails.config.ts`; `test:all`=`pnpm test && pnpm test:guardrails`.
- Configs: `vitest.config.ts` (units), `vitest.guardrails.config.ts` (guardrails).
- Versions: Vitest / `@vitest/coverage-v8` `5.0.5`, `fast-check` `4.10.2`, TypeScript `7.0.2`, `@types/node` `22.20.5`.
- Smoke test at `tools/guardrails/smoke.test.ts` — **delete in Iteration 5** when real guardrail tests land.
- N2–N7 still pending (ESLint dir, depcruise, fixtures).
