# Iteration 01 — Workspace, TypeScript projects, build and typecheck

**Previous commit**: `613c343662d9f49f54d684fe0eab7348a3da8e0b` (Add phased implementation plan (#2))
**This commit's SHA**: see `git log` (do not amend this record after commit)

## Criteria results

| Criterion | Result | Command / evidence |
|-----------|--------|-------------------|
| VC-001 / FR-001 | **PASS** | `rm -rf node_modules packages/*/node_modules …` then `pnpm install --frozen-lockfile` → exit 0; `pnpm -r list --depth -1` → exactly **13** `@cge/*` members |
| FR-002 / FR-007 | **PASS** | Throwaway `node --input-type=module -e '…'` over all 13 members: name/type/private/engines OK; every `packages/**` has single `.` exports to `dist`; guardrails has no `exports` |
| FR-003 / FR-005 / VC-003 | **PASS** | `pnpm build` / `pnpm typecheck` → 0; `const x: number = "a"` in helpers source → typecheck exit 1; same in helpers test → exit 1; both reverted |
| VC-004 | **PASS** | `const a: number[] = []; const b: number = a[0];` in helpers source → `TS2322` (`number \| undefined`); reverted |
| VC-005 / FR-006 | **PASS** | `import "@cge/app"` in core → `pnpm build` exit 1; `import "@cge/core"` in app → `pnpm build` exit 0; both reverted |
| VC-007 / FR-008 | **PASS** | `const p = process.cwd()` in core source → build fails with `Cannot find name 'process'`; same in `core/src/index.test.ts` → `pnpm typecheck` exit 0; both reverted |
| VC-008 / FR-004 | **PASS** | All 13 members have `tsconfig.json` + `tsconfig.test.json`; core source `types: []`; `git check-ignore` confirms `dist/` ignored |
| VC-034 / FR-030 | **PASS** | `import "@cge/core/src/session/index.js"` from app → `pnpm build` exit 1 (`TS2882`); reverted |
| FR-009 (partial) | **PASS** | `.nvmrc` = `22.23.3`; `packageManager` = `pnpm@10.15.1`; `engines.node` = `>=22 <23` |
| Artifacts | **PASS** | `CONTEXT.md`, `DECISIONS.md` (D-001…D-009), this record |

## Files added / changed

- Added: `.nvmrc`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `tsconfig.json`
- Added: `packages/**` (12 packages with sources, tests, tsconfigs), `tools/guardrails/`
- Added: `games/.gitkeep`, `config/.gitkeep`, `deploy/.gitkeep`
- Added: `specs/00-phase-0.md`, `specs/00-phase-0-plan.md`, `specs/00-phase-0-plan-artifacts/**`
- Extended: `.gitignore` already covered `node_modules`, `dist`, `coverage`, `*.tsbuildinfo`, `.env*` (no material change required)

## Deviations

- `skipLibCheck: true` (plan preferred `false` if feasible); left true to avoid noise from tool typings in Phase 0.
- TypeScript **7.0.2** (npm `latest` at implement time) rather than 5.9.x — recorded in D-002.

## Gotchas

- Machine default `node` is v26; must `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` before every command.
- `pnpm -r --if-present exec` is invalid in pnpm 10; use `pnpm -r exec …` (root is not included in `-r exec`).
- Scratch layering/deep-import checks must be fully reverted before commit (`git status`).

## For the next iteration

- Activate Node: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` → `v22.23.3` / pnpm `10.15.1`.
- Scripts exist: `build`, `typecheck` only. Add `test`, `test:coverage`, `test:guardrails`, `test:all`.
- Versions: TypeScript `7.0.2`, Vitest `5.0.5` (already in every `packages/**` + guardrails + root), `@types/node` `22.20.5`.
- Guardrails: no `src`/exports; put smoke test at `tools/guardrails/smoke.test.ts`; keep out of solution build.
- Reference matrix already wired per N8 — Iteration 2 should not change it.
- N2–N7 still pending (ESLint dir, depcruise, fixtures).
