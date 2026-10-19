# Iteration 10 — Documentation, README invariant (check 7) and end-to-end verification

**Previous commit**: `264cf9c` (Add GitHub Actions CI pipeline…)
**This commit's SHA**: see `git log` (do not amend this record after commit)

## Criteria results

| Criterion | Result | Command / evidence |
|-----------|--------|-------------------|
| Docs exist | **PASS** | `test -f README.md docs/dev-setup.md docs/workspace-architecture.md docs/troubleshooting.md` |
| Decision→doc mapping | **PASS** | Table below; every D-NNN mapped or marked internal |
| Grep standalone | **PASS** | `grep -rnE "specs/\|00-phase-0\|plan-artifacts\|Iteration [0-9]\|VC-[0-9]\|FR-[0-9]\|BR-[0-9]\|NFR-[0-9]" README.md docs/dev-setup.md docs/workspace-architecture.md docs/troubleshooting.md` → no matches |
| Clean-tree documented commands | **PASS** | Fresh tree (`git archive` + Iteration 10 overlays): install, build, lint, format:check, typecheck, depcheck, test, test:guardrails, test:all, test:coverage, `docker compose … run --rm tests`, `docker compose … config` — all exit 0; 13 `@cge/*` members; 167 guardrails |
| VC-065 / VC-066 / check 7 | **PASS** | `pnpm test:guardrails` → 167 pass incl. check 7; mutations: remove `test:guardrails` / layering string / `Adding a package` heading → fail naming offender |
| VC-057 / FR-057 | **PASS** | Clean: native lint/typecheck/depcheck/test:all = 0 and Docker (test/build image) = 0. `Date.now()` in core: native lint=1 tc=0 dep=0 test:all=1; Docker build-stage same. `@cge/app` import: native all fail (build TS2882); Docker build fails same. Reverted. |
| VC-091 | **PASS*** | `import fs from "node:fs"`: `pnpm exec eslint` → `cge/no-nondeterministic-imports`; `depcruise` → `core-no-node`; `pnpm lint` fails at **build** first (TS2591, FR-008 `types: []`) before ESLint. `Date.now()`: `pnpm lint` → `cge/no-nondeterministic-globals`. Reverted. *See deviations. |
| VC-090 | **PASS** | `docker compose -f deploy/docker-compose.test.yml run --rm tests` → 0; 13 unit + 167 guardrails (after rebuild) |
| NFR-004 | **PASS** | `/usr/bin/time -p sh -c 'pnpm lint && pnpm typecheck && pnpm depcheck'` → real **6.54 s** (≤ 60 s) |
| NFR-005 | **PASS** | `/usr/bin/time -p pnpm test:guardrails` → real **1.11 s** (≤ 30 s) |
| NFR-008 | **PASS** | lint / format:check / typecheck / depcheck / tsc -b — 0 errors, 0 warnings |
| Artifacts | **PASS** | `CONTEXT.md` rewritten (shipped); `DECISIONS.md` D-021; this record |

## Decision → documentation mapping

| Decision | Doc mapping |
|----------|-------------|
| D-001 Node/pnpm pins | `docs/dev-setup.md` Toolchain; `docs/troubleshooting.md` Wrong Node |
| D-002 Toolchain versions | Superseded by D-011; versions in `docs/dev-setup.md` / architecture doc where relevant |
| D-003 Relative `.js` imports | `docs/workspace-architecture.md` Package layering |
| D-004 core/app sub-folders under `src/` | internal (layout detail; architecture.md A3 still shows logical folders) |
| D-005 Reference/dependency matrix | `docs/workspace-architecture.md` Package layering; `docs/dev-setup.md` dependency rule + Adding a package |
| D-006 Guardrails layout | `docs/workspace-architecture.md` Guardrail suite / Tests |
| D-007 Test project mechanics | `docs/workspace-architecture.md` Build-first / two TS projects |
| D-008 Source `types: []` | `docs/workspace-architecture.md` Determinism + core types |
| D-009 N2–N7 deferred | internal (historical) |
| D-010 Separate Vitest configs | `docs/workspace-architecture.md` Tests; `docs/dev-setup.md` single-test commands |
| D-011 TypeScript 6.0.3 | `docs/dev-setup.md` / CONTEXT versions; troubleshooting Node/toolchain |
| D-012 Type-aware ESLint wiring | `docs/workspace-architecture.md` Determinism (determinismConfig) |
| D-013 Local `cge` plugin / Prettier | `docs/workspace-architecture.md` Determinism; `docs/dev-setup.md` Prettier note |
| D-014 depcruise matching | `docs/workspace-architecture.md` Package layering + Guardrails |
| D-015 determinismFiles globs | internal (ESLint 10 lintText detail); behaviour in Determinism section |
| D-016 Lint fixtures table | `docs/workspace-architecture.md` Guardrail suite / Adding a fixture |
| D-017 Depcruise fixtures / multi-rule | `docs/workspace-architecture.md` Guardrail suite |
| D-018 Docker runtime staging | `docs/workspace-architecture.md` Docker; `docs/dev-setup.md` Docker commands; `docs/troubleshooting.md` limits/gotchas |
| D-019 Repo-invariant helpers | `docs/dev-setup.md` Interpreting failures; architecture Guardrails |
| D-020 CI Docker cache / permissions | `docs/workspace-architecture.md` CI; `docs/troubleshooting.md` remote CI deferred |
| D-021 Check 7 → docs/dev-setup.md | `docs/dev-setup.md` itself; README link |

## Files added / changed

- Added: `README.md`, `docs/dev-setup.md`, `docs/workspace-architecture.md`, `docs/troubleshooting.md`
- Changed: `tools/guardrails/repo-invariants.ts`, `repo-invariants.test.ts` (check 7 + mutations)
- Changed: `docs/architecture.md` (A9 Dockerfile example: floating `node:22-alpine` → pinned pattern; Phase 0 invalidates floating tags)
- Artifacts: `CONTEXT.md`, `DECISIONS.md` (D-021), `iterations/10-docs-and-verification.md`

## Deviations

- **VC-091 `node:fs` via `pnpm lint`**: fails at `pnpm build` (TS2591) before ESLint runs, because core source `types: []` (FR-008). Direct `eslint` still reports `cge/no-nondeterministic-imports`; `depcheck` reports `core-no-node`. CI lint job still fails; rule-id visibility is on the ESLint step when build succeeds (e.g. `Date.now()`). Recorded honestly; not “massaged.”
- **Clean clone**: verified via `git archive HEAD` + overlay of Iteration 10 files (pre-commit), not a remote `git clone` of a pushed branch (no push in scope).
- **`docs/architecture.md` A9**: minimal edit only for floating base tags now rejected by invariants; compose mount path in A9 still shows aspirational `/app/config/…` vs D-018 `/etc/engine/…` — left as product-architecture aspirational (not Phase 0 contradiction of mechanical pins).
- **`docs/implementation_plan.md`**: no edit (Phase 0 section still accurate).

## Gotchas

- Stale `deploy-tests` compose image can hide new guardrail tests — rebuild after doc/invariant changes.
- Shipped docs must not contain `specs/`, `VC-`/`FR-`/… tokens (standalone grep).
- Check 7 matches scripts as backtick-wrapped `` `name` `` in `docs/dev-setup.md`.

## Remaining / deferred

- VC-060 remote: PR with determinism violation fails at `lint`; later jobs skipped.
- VC-061 remote: PR changing `package.json` without lockfile fails first install.
- VC-063 remote: second CI run cache hits (pnpm store + Docker layers).
- VC-080 remote: cold ≤ 10 min / warm ≤ 3 min on GitHub `ubuntu-latest`; local container warm ≈ 2.6 s (informational).
- VC-082 Linux CI (macOS arm64 + Docker verified locally).
- Branch protection / required checks on `main` (out of scope).
- `config/server.yaml` / real server runtime (later phases).

## For the next iteration

- Final iteration of this plan — no further Phase 0 iterations.
- Orchestrator: full regression + `/verify-spec` per skill Final Verification.
