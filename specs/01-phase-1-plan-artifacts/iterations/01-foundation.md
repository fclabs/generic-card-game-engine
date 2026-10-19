# Iteration 1 — Toolchain, artifacts, ids, errors, snapshot types

Commit: `Phase 1.1: core ids, error taxonomy, Snapshot and guardrail exemption` (SHA is in `git log`; a commit cannot contain its own hash).

## Criteria results (Node 22.18.0 + pnpm 10.15.1)
- Baseline: `pnpm install --frozen-lockfile` then `pnpm test:all` before any change: PASS (167 guardrail tests, core placeholders).
- VC-001: `pnpm exec vitest run packages/core/src/session/ids.test.ts` — PASS (65 tests).
- VC-002: `@ts-expect-error` + `expectTypeOf` in `ids.test.ts`; `pnpm typecheck` exit 0 — PASS (expectation is active, else TS2578).
- VC-003: `errors/errors.test.ts` exhaustive switch + 24-code set compare; `pnpm typecheck`, `pnpm test` — PASS.
- VC-012 (type part): `session/snapshot.test.ts` `@ts-expect-error` on `members[0]`, `counters[c]`, `control.phase`; `pnpm typecheck` — PASS (local `SampleState`).
- VC-013 (helper part): `snapshot.test.ts` deepFreeze/isDeepFrozen incl. bigint, cycle, 100k-deep chain; `pnpm test` — PASS.
- VC-101: `pnpm test:guardrails` — PASS (168 tests); non-core package with code fails, `packages/core` with code passes; `git diff --stat tools` touches only `repo-invariants.ts` and its test.
- VC-102 (partial): `git diff packages/core/package.json` empty — PASS (no `dependencies`, devDependencies unchanged).
- `pnpm typecheck`, `pnpm lint`, `pnpm depcheck`, `pnpm test`, `pnpm format:check` — all exit 0 (88 core/other tests).
- Artifacts: this file, `CONTEXT.md`, `DECISIONS.md` (D-001..D-003) — PASS.

## Files
- Added: `packages/core/src/errors/{codes,result,errors.test}.ts`, `packages/core/src/session/{ids,ids.test,snapshot,snapshot.testing,snapshot.test}.ts`, `specs/01-phase-1-plan-artifacts/**`, `specs/00-phase-0-frozen.md`, `specs/01-phase-1.md`, `specs/01-phase-1-plan.md`.
- Changed: `packages/core/src/{index.test,errors/index,session/index}.ts`, `packages/core/tsconfig.json` (exclude `*.testing.ts`), `tools/guardrails/repo-invariants.ts` and `.test.ts`.
- Deleted: the old `specs/00-phase-0-plan*` / `specs/00-phase-0*.md` files (pre-existing intentional cleanup, included in this commit).

## Deviations
- None from scope. `GameRejection` shape and constructor naming are choices (D-001). No plan-level decision became relevant this iteration.

## Gotchas
- Default node is v26; pnpm needs corepack under Node 22 (see CONTEXT Commands). BSD `sed -i` fails without a suffix.
- eslint `no-unsafe-call` flags calls to methods absent on a readonly type even under `@ts-expect-error` (so no `.push` case in the Snapshot test; assignments only).
- `.testing.ts` files are excluded from `tsc -b` output (dist) but linted and typechecked by `tsconfig.test.json`.

## For the next iteration
- Iteration 2 builds `util/utf8.ts` and `replay/canonical/*`; `Result`/`err` from `core/errors` and ids from `core/session` are available. Import with `.js` suffixes.
- Use `deepFreeze` freely; it always descends. Add `isDeepFrozen`-style helpers only in `.testing.ts`.
- Iteration 4 must re-point `session/snapshot.test.ts` `SampleState` at `SessionState`.
