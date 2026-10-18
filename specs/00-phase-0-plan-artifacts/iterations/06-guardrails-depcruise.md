# Iteration 06 — Guardrail suite: dependency-cruiser rules

**Previous commit**: `b7e278f` (Add guardrail tests proving determinism lint rules and fixture inertness)
**This commit's SHA**: see `git log` (do not amend this record after commit)

## Criteria results

| Criterion | Result | Command / evidence |
|-----------|--------|-------------------|
| VC-041 / FR-041 | **PASS** | `pnpm test:guardrails` → exit 0 (149 tests: 120 lint + 29 depcruise). 21 fixture cases cover all 12 §7.3 rules + `legitimate-directions` (VC-031); exact expected sets asserted. Mutation: rename `name` for `layer-core-imports-nothing`, `core-no-node`, `no-circular` → matching case fails (exit 1); `git checkout -- .dependency-cruiser.cjs` → restored |
| VC-027 | **PASS** | cases `layer-core-imports-nothing-spec`, `-relative-src`, `-relative-dist` |
| VC-028 | **PASS** | `layer-app-core-only-adapter`, `layer-app-core-only-config`, `layer-helpers-core-only`, `layer-config-core-only` |
| VC-029 | **PASS** | `layer-adapters-no-server`, `layer-adapters-no-adapters`, `layer-adapters-allowed-only-helpers`, `layer-adapters-allowed-only-conformance` (+ `layer-conformance-leaf`) |
| VC-030 | **PASS** | `layer-server-no-conformance` (+ leaf), `layer-conformance-leaf` (+ `layer-app-core-only`) |
| VC-031 | **PASS** | `legitimate-directions` → empty rule set |
| VC-032 | **PASS** | `core-no-node-node-fs`, `core-no-node-bare-path`, `core-no-node-bare-stream`, `core-no-node-test-exempt` (empty) |
| VC-033 | **PASS** | `no-circular-intra`, `no-circular-cross` (+ `layer-core-imports-nothing`), `no-undeclared-deps` |
| VC-042 / FR-042 | **PASS** | with fixtures present: `pnpm lint`, `pnpm depcheck`, `pnpm build`, `pnpm typecheck`, `pnpm format:check` all exit 0; `pnpm -r list --depth -1` → **13** `@cge/*` members |
| `pnpm test:all` | **PASS** | exit 0 (12 unit files / 13 tests + 149 guardrail) |
| Guardrail wall time | **PASS** | `/usr/bin/time -p pnpm test:guardrails` → real **1.05 s** (≪ 30 s NFR-005) |
| Artifacts | **PASS** | `CONTEXT.md` rewritten; `DECISIONS.md` D-017; this record |

## Files added / changed

- Added: `tools/guardrails/depcruise-helpers.ts`, `depcruise-cases.ts`, `depcruise-rules.test.ts`, `tools/guardrails/fixtures/depcruise/**` (21 case trees)
- Changed: `tools/guardrails/package.json` (`dependency-cruiser` `18.6.0`), `pnpm-lock.yaml`
- Artifacts: `CONTEXT.md`, `DECISIONS.md` (D-017), `iterations/06-guardrails-depcruise.md`

## Deviations

- Cross-package circular fixture also expects `layer-core-imports-nothing` (no mutual legal BR-001 edge exists); documented in D-017 / `depcruise-cases.ts`.
- `.gitignore` gains `!tools/guardrails/fixtures/**/dist/` negations so the FR-026 relative-into-dist fixture file is tracked (global `dist` ignore would otherwise drop it on clean checkout).

## Gotchas

- Must **override** `options.exclude` when `cruise()`-ing fixture trees (real config excludes `tools/guardrails/fixtures`).
- `cruise` is ESM-only / async; load config with `extractDepcruiseConfig`.
- Fixture `package.json`s under `fixtures/depcruise/` are not workspace members (`pnpm-workspace.yaml` `tools/*` stops at one level).
- Helper caches the loaded config per process — fine for Vitest (fresh process per run); do not mutate `.dependency-cruiser.cjs` mid-suite without clearing the cache.
- Root `.gitignore` `dist` would hide fixture `…/app/dist/index.js` — keep the `!tools/guardrails/fixtures/**/dist/**` exceptions.

## For the next iteration

- Activate Node: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` → `v22.23.3` / pnpm `10.15.1`.
- Case naming: `fixtures/depcruise/<id>/`; expected sets in `depcruise-cases.ts`; runner `cruiseFixtureCase` in `depcruise-helpers.ts`.
- Guardrail wall time ≈ **1.05 s** (headroom for later suites).
- `repo-invariants.test.ts` does **not** yet exist (Iteration 8).
- Next: Dockerfile / compose / build-context hygiene (Iteration 7).
