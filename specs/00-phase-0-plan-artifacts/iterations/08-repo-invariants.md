# Iteration 08 — Repository invariants (FR-043 checks 1–6)

**Previous commit**: `99e1eef` (Add multi-stage Dockerfile, compose files and Docker build-context hygiene)
**This commit's SHA**: see `git log` (do not amend this record after commit)

## Criteria results

| Criterion | Result | Command / evidence |
|-----------|--------|-------------------|
| VC-043 (checks 1–6) / FR-043 | **PASS** | `pnpm test:guardrails` → exit 0 (163 tests: 149 prior + 14 invariants). Skeleton passes all six checks. Mutation (temp dirs) messages: see below. |
| VC-002 | **PASS** | `type: "commonjs"` → `packages/core/package.json: type must be "module", got "commonjs"` |
| VC-006 | **PASS** | `.nvmrc` `22.11.0` → `deploy/Dockerfile:1: stage base Node "22.23.3" disagrees with .nvmrc "22.11.0"` |
| VC-050 tail | **PASS** | `FROM node:22-alpine AS base` → `deploy/Dockerfile:1: floating/unpinned base image "node:22-alpine" (stage base)` |
| VC-012 | **PASS** | delete `src/index.test.ts` → `packages/core: missing src/index.test.ts` |
| VC-074 | **PASS** | `function f() {}` → `packages/core/src/index.ts:2: non-skeleton statement (FunctionDeclaration); …` |
| VC-075 | **PASS** | `^1.0.0` → `packages/app/package.json: devDependency "vitest" version "^1.0.0" must match ^\d+\.\d+\.\d+$` |
| Differing vitest | **PASS** | `5.0.4` vs `5.0.5` → `vitest versions differ across the workspace: …` naming both packages |
| VC-077 | **PASS** | `zod` dep → `packages/app/package.json: dependency "zod" is not a workspace @cge/* package (BR-009)` |
| `pnpm test:all` | **PASS** | exit 0 (12 unit files / 13 tests + 163 guardrails) |
| Guardrail wall time | **PASS** | `/usr/bin/time -p pnpm test:guardrails` → real **1.16 s** (≪ 30 s NFR-005) |
| Native checks | **PASS** | `pnpm lint`, `typecheck`, `depcheck`, `format:check` all exit 0 |
| Artifacts | **PASS** | `CONTEXT.md` rewritten; `DECISIONS.md` D-019; this record |

## Files added / changed

- Added: `tools/guardrails/repo-invariants.ts`, `tools/guardrails/repo-invariants.test.ts`
- Changed: `tools/guardrails/package.json` (`typescript` `6.0.3`), `pnpm-lock.yaml`
- Artifacts: `CONTEXT.md`, `DECISIONS.md` (D-019), `iterations/08-repo-invariants.md`

## Deviations

- None vs plan scope. Check 7 deliberately omitted (Iteration 10) — comment in test file + Known gaps.
- Mutation coverage includes checks 1–2 (plan required “at least” 3–6; success criteria also name VC-002/006/050).

## Gotchas

- JSDoc must not contain the two-character sequence `*/` inside globs (e.g. write `packages/` not `packages/**` in block comments) — Vite/oxc otherwise fails to parse.
- Skeleton purity uses `typescript.createSourceFile` (exact `typescript` `6.0.3` declared on `@cge/guardrails`).
- Dockerfile check only pins `AS base` / `AS runtime` image refs; intermediate `FROM base` / `FROM build` are stage refs.

## For the next iteration

- Activate Node: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`.
- Helpers: `checkPackageMetadata`, `checkNodePnpmVersions`, `checkPlaceholderTests`, `checkSkeletonPurity`, `checkDevDependencyVersions`, `checkWorkspaceDependencies` in `repo-invariants.ts`; pure over `repoRoot`.
- Check 7 (README / FR-070–071) still pending — add in Iteration 10 alongside docs.
- Dockerfile parse: line regex `FROM <image> AS <stage>`; reject floating `node:22` / `node:22-alpine`; require `node:22.x.y-alpineM.m` matching `.nvmrc`.
- Next: CI pipeline (Iteration 9).
