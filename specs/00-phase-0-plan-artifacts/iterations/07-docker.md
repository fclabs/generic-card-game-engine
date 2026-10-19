# Iteration 07 — Dockerfile, compose files and build-context hygiene

**Previous commit**: `94d8b8f` (Add guardrail tests proving dependency-cruiser layering rules)
**This commit's SHA**: see `git log` (do not amend this record after commit)

## Criteria results

| Criterion | Result | Command / evidence |
|-----------|--------|-------------------|
| VC-050 / FR-050 | **PASS** | `docker buildx build --check -f deploy/Dockerfile .` → “Check complete, no warnings”. Stages: `base`←`node:22.23.3-alpine3.24`, `build`←`base`, `test`←`build`, `runtime`←`node:22.23.3-alpine3.24` (fresh). Tag Node patch matches `.nvmrc` `22.23.3`. |
| VC-051 / FR-051 | **PASS** | `docker build --progress=plain --target test -f deploy/Dockerfile .` after source-only edit → `#22 RUN pnpm install --frozen-lockfile` **CACHED**; after appending `# vc051-cache-bust` to `pnpm-lock.yaml` → install **DONE 2.8s** (re-executed). Both scratches reverted. |
| VC-052 / FR-052 | **PASS** | Scratch `packages/core/src/vc052-scratch.ts` with `Date.now()` → `docker build --target test` fails at `RUN pnpm lint && …` with `cge/no-nondeterministic-globals`. Revert → build succeeds. |
| VC-053 / FR-053 / VC-090 | **PASS** | `docker compose -f deploy/docker-compose.test.yml run --rm tests` → exit 0; 12 unit files / 13 tests then 149 guardrails. Inject `expect(true).toBe(false)` + `compose build` + `run` → non-zero (`ELIFECYCLE`). Revert + rebuild. Warm run real **≈ 2.6 s**. |
| VC-054 / FR-054 / NFR-007 | **PASS** | Image `cge-runtime:local`: `id -u` → `1000`; `test ! -e` vitest/tools/core/src → 0; `touch /app/x` → Permission denied; `touch /data/x` with `-v cge-data-check:/data` → ok; `--read-only --tmpfs /tmp` `touch /etc/x` → fails; `printenv NODE_ENV` → `production`; default CMD exit 0. Volume removed. |
| VC-055 / FR-055 | **PASS** | `docker compose -f deploy/docker-compose.yml config` → exit 0; contains `engine`, `runtime`, `engine-data`, `ENGINE_HOST_KEY`, ports `published: "8080"` / `target: 8080` (compose-normalised form of `8080:8080`). |
| VC-056 / FR-056 | **PASS** | With host `.env.test` + `node_modules/SENTINEL`, rebuild `--target build` as `cge-build:local` → `test ! -e /app/.env.test && test ! -e /app/node_modules/SENTINEL` exit 0 (COPY layer stayed CACHED — sentinels not in context). Sentinels removed. |
| VC-081 / NFR-006 | **PASS** | `docker image inspect --format '{{.Size}}'`: base `61068044`, runtime `66508040`, limit `87282444` (base + 26 214 400); delta **5 439 996** bytes. |
| Native checks | **PASS** | `pnpm lint`, `typecheck`, `depcheck`, `test:all`, `format:check` all exit 0 after Docker work. |
| Artifacts | **PASS** | `CONTEXT.md` rewritten; `DECISIONS.md` D-018; this record. |

## Files added / changed / deleted

- Added: `.dockerignore`, `deploy/Dockerfile`, `deploy/docker-compose.yml`, `deploy/docker-compose.test.yml`
- Deleted: `deploy/.gitkeep`
- Artifacts: `CONTEXT.md`, `DECISIONS.md` (D-018), `iterations/07-docker.md`

## Deviations

- None vs plan scope. Compose `config` emits normalised port fields (`published`/`target`) rather than the literal string `8080:8080` — accepted per plan note.
- VC-053 failing-test injection requires `compose build` (sources are baked into the `test` image; no bind mount).

## Gotchas

- `.dockerignore` must keep `!tools/guardrails/fixtures/**/dist/**` or `layer-core-imports-nothing-relative-dist` fails inside the container.
- Stale compose image (`deploy-tests`) can hide host edits — rebuild after scratch injections.
- `runtime` has no root `node_modules/@cge/*`; CMD uses a filesystem path (`packages/server/dist/index.js`), which is enough for Phase 0.
- Prettier has no parser for `Dockerfile` / `.dockerignore`; `pnpm format:check .` still exits 0 (skips them).

## For the next iteration

- Activate Node: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`.
- Pinned image: `node:22.23.3-alpine3.24`; stages `base`/`build`/`test`/`runtime`; compose services `tests` / `engine`.
- Iteration 8: `repo-invariants.test.ts` checks 1–6 — parse Dockerfile `FROM` lines (reject `node:22-alpine`); check 7 still deferred to Iteration 10.
- Size headroom: runtime ≈ base + 5.4 MB (budget +25 MB).
