# Iteration 05 — Guardrail suite: lint rules

**Previous commit**: `70eeb2a` (Add dependency-cruiser layering, no-node-in-core, cycle and undeclared-dependency rules)
**This commit's SHA**: see `git log` (do not amend this record after commit)

## Criteria results

| Criterion | Result | Command / evidence |
|-----------|--------|-------------------|
| VC-040 / FR-040 | **PASS** | `pnpm test:guardrails` → exit 0 (120 tests). Fixture table: 16 banned globals (≥15) × 3 paths; 9 import forms (static/dynamic/re-export) × 3 paths; 7 `allow-*` (≥5). Mutation: remove `...determinismConfig` from `eslint.config.mjs` → 3 wiring tests fail (exit 1); `git checkout` / restore → exit 0 |
| VC-022 | **PASS** | suite `VC-022 banned globals in packages/core/src/x.ts` |
| VC-023 | **PASS** | suite `VC-023 scope and test exemption` |
| VC-024 | **PASS** | suite `VC-024 banned imports in packages/core/src/x.ts` |
| VC-025 | **PASS** | suite `VC-025 out-of-scope allowed` |
| VC-026 | **PASS** | suite `VC-026 promises allowed (BR-005)` |
| VC-042 (lint/build/typecheck/format) | **PASS** | with fixtures present: `pnpm lint`, `pnpm build`, `pnpm typecheck`, `pnpm format:check` all exit 0 |
| `pnpm test:all` | **PASS** | exit 0 (12 unit files + 120 guardrail tests) |
| Guardrail wall time | **PASS** | `/usr/bin/time -p pnpm test:guardrails` → real **0.86 s** (≪ 30 s NFR-005) |
| Artifacts | **PASS** | `CONTEXT.md` rewritten; `DECISIONS.md` D-015/D-016; this record |

## Files added / changed

- Added: `eslint/determinism.d.mts`, `tools/guardrails/fixtures/lint/cases.ts`, `tools/guardrails/lint-helpers.ts`, `tools/guardrails/lint-rules.test.ts`
- Changed: `eslint/determinism.mjs` (D-015 globs), `tools/guardrails/package.json` (`eslint` `10.13.0`), `tools/guardrails/tsconfig.test.json`, `pnpm-lock.yaml`
- Deleted: `tools/guardrails/smoke.test.ts`
- Artifacts: `CONTEXT.md`, `DECISIONS.md` (D-015, D-016), `iterations/05-guardrails-lint.md`

## Deviations

- None material. `cases.ts` lives under `fixtures/lint/` and is included in guardrails `tsconfig.test.json` (D-016) so the table typechecks; banned forms are string data only (N7 inert for real lint/format/build).

## Gotchas

- ESLint 10 `files: ["…/**"]` does **not** match `lintText` virtual paths under `overrideConfigFile: true` — use `/**/*.{ts,js,mjs}` (D-015).
- `lintText` needs **repo-relative** `filePath`; `calculateConfigForFile` needs **absolute** paths.
- Mutation of `eslint.config.mjs` fails wiring tests only; fixture `lintText` still uses the exported `determinismConfig` directly.
- Scratch mutations must be reverted before commit (`eslint.config.mjs` clean).

## For the next iteration

- Activate Node: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` → `v22.23.3` / pnpm `10.15.1`.
- Fixture format: `tools/guardrails/fixtures/lint/cases.ts` → `lintCases: LintCase[]`; helpers in `lint-helpers.ts` (`createDeterminismLinter` / `createRepoLinter`).
- ESLint setup for tests: N3 — `overrideConfig: [languageOptions, ...determinismConfig]` + separate repo linter for wiring.
- Guardrail runtime: ~0.9 s wall for `pnpm test:guardrails` today; leave headroom for depcruise cases.
- Cruise API notes: see Iteration 04 record (`cruise()` + clear `exclude` for fixture trees).
- Next: `fixtures/depcruise/<case>/` + `depcruise-rules.test.ts` (Iteration 6); keep N7 inertness; verify 13 workspace members with fixture `package.json`s present.
