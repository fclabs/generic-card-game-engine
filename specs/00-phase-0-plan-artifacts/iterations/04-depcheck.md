# Iteration 04 — dependency-cruiser layering rules

**Previous commit**: `9536e5d` (Add ESLint determinism rules, Prettier and lint/format scripts)
**This commit's SHA**: see `git log` (do not amend this record after commit)

## Criteria results

| Criterion | Result | Command / evidence |
|-----------|--------|-------------------|
| `pnpm depcheck` skeleton | **PASS** | exit 0; `✔ no dependency violations found (86 modules, 60 dependencies cruised)` — 0 errors/warnings |
| VC-027 / FR-026 | **PASS** | scratch `packages/core/src/x.ts` → `@cge/app` and `../../app/src/index.js` (and `../../app/dist/index.js`) each → `layer-core-imports-nothing` via `pnpm exec depcruise packages --config .dependency-cruiser.cjs` |
| VC-028 | **PASS** | app→adapter / app→config → `layer-app-core-only`; helpers→app → `layer-helpers-core-only`; config→app → `layer-config-core-only` |
| VC-029 | **PASS** | adapter→server → `layer-adapters-no-server`; →adapter-sqlite → `layer-adapters-no-adapters`; →helpers / →conformance → `layer-adapters-allowed-only` |
| VC-030 | **PASS** | server→conformance → `layer-server-no-conformance`; app→conformance → `layer-conformance-leaf` + `layer-app-core-only` |
| VC-031 | **PASS** | each allowed BR-001 edge (server→adapters/helpers/config/app/core; adapters→app/config/core; app/helpers/config→core; conformance→adapters/helpers/config/app/core) → `no dependency violations found` |
| VC-032 / FR-027 | **PASS** | core `x.ts` `node:fs` / `path` / `stream` → `core-no-node`; same in `x.test.ts` → no `core-no-node` |
| VC-033 / FR-028–029 | **PASS** | intra-package a↔b → `no-circular`; cross-package relative core↔app → `no-circular`; app imports undeclared `fast-check` → `no-undeclared-deps` |
| FR-029 declarations | **PASS** | all 12 `packages/**` declare `vitest` `5.0.5`; core also `fast-check` `4.10.2`; single version each |
| Prior checks | **PASS** | scratch removed; `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `pnpm depcheck` all exit 0 |
| Artifacts | **PASS** | `CONTEXT.md` rewritten; `DECISIONS.md` D-014; this record |

## Files added / changed

- Added: `.dependency-cruiser.cjs`
- Changed: root `package.json` (`depcheck` script + `dependency-cruiser` `18.6.0`), `pnpm-lock.yaml`
- Artifacts: `CONTEXT.md`, `DECISIONS.md` (D-014), `iterations/04-depcheck.md`

## Deviations

- None material. `exclude` deliberately omits `node_modules` (D-014) so resolved undeclared npm edges remain visible; `doNotFollow` still prevents descending into them.

## Gotchas

- Excluding `node_modules` in `options.exclude` **silences** `no-undeclared-deps` for packages that resolve into the store (edge is dropped). Use `doNotFollow` instead.
- `pnpm depcheck` runs `pnpm build` first; for scratch checks prefer `pnpm exec depcruise packages --config .dependency-cruiser.cjs`.
- Prettier formats `.dependency-cruiser.cjs` when the path is named explicitly; `prettier --check .` may skip leading-dot files depending on glob expansion — format the file by path if needed.
- `dependency-cruiser` is ESM-only (`cruise` returns a `Promise`). `require()` of the package root fails (`ERR_PACKAGE_PATH_NOT_EXPORTED`); the `.cjs` config itself is fine via `createRequire` / `extract-depcruise-config`.

## cruise() API notes for Iteration 6

```js
import { cruise } from "dependency-cruiser";
import extractDepcruiseConfig from "dependency-cruiser/config-utl/extract-depcruise-config";
import extractTsConfig from "dependency-cruiser/config-utl/extract-ts-config";

const config = await extractDepcruiseConfig("./.dependency-cruiser.cjs");
const tsConfig = extractTsConfig("./tsconfig.json"); // optional; config already has tsConfig.fileName

const { exitCode, output } = await cruise(
  ["<fixture-case-dir>"], // e.g. tools/guardrails/fixtures/depcruise/<case>
  {
    ...config.options,
    // CRITICAL: clear/override exclude so fixtures under tools/guardrails/fixtures are not skipped
    exclude: { path: "coverage|\\.tsbuildinfo$" },
    ruleSet: { forbidden: config.forbidden },
    validate: true,
  },
  undefined,
  { tsConfig },
);
// output.summary.violations[].rule.name — assert exact rule-name set
```

Options that affect fixture runs: `exclude`, `doNotFollow`, `tsConfig` / `tsPreCompilationDeps: true`, `enhancedResolveOptions` (exportsFields / conditionNames / extensions). Circularity includes type-only imports because `tsPreCompilationDeps` is true.

## For the next iteration

- Activate Node: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` → `v22.23.3` / pnpm `10.15.1`.
- Rule names (exact): see Public interfaces / §7.3 list above.
- Matching: path OR specifier (D-014); relative into src/dist covered.
- Script: `depcheck` = `pnpm build && depcruise packages games --config .dependency-cruiser.cjs`.
- Exclude: `tools/guardrails/fixtures|coverage|\\.tsbuildinfo$` (override in Iter 6 API).
- Smoke test at `tools/guardrails/smoke.test.ts` — **delete in Iteration 5**.
- Next: guardrail lint fixtures (Iteration 5); depcruise fixtures (Iteration 6) using cruise() notes above.
