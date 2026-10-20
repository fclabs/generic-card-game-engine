# Iteration 12: Documentation and release gates (final)

Commit: see `git log` (message `Phase 2 iteration 12: documentation and release gates for game definitions and configuration`).

## Criteria
- VC-273 PASS: `pnpm build && pnpm exec vitest run packages/config/src/docs.test.ts` (17 tests: files exist, every key and error code, worked example compiles, server example loads, exit codes, links, no removed flags, no planning references).
- VC-276 PASS: `pnpm test:coverage` (1112 tests): `packages/config/src` 96.3 % lines, `packages/core/src/definition` 98.8 % (computed from `coverage/coverage-final.json`, same method as the report table); with every file forced into the report (`--coverage.include`) config is 92.0 % (cli.ts and bundle-games.ts are child-process only). DBR script: `pnpm exec vitest run packages/config/src/dbr-names.test.ts --reporter=verbose` prints `DBR-001` .. `DBR-011`, each `1 test(s)` in `business-rules.test.ts`.
- VC-271 PASS: config `dependencies` = `{"@cge/core":"workspace:*","esbuild":"0.28.2","yaml":"2.9.1","zod":"4.6.7"}`; core has none (also asserted by DBR-009); `pnpm test:guardrails` 174 pass.
- VC-277 PASS: `docker compose -f deploy/docker-compose.test.yml build` then `run --rm tests` twice: exit 0 both, 71 files / 1112 tests and 3 files / 174 guardrail tests, identical pass lists. Strict medians in Docker: compile 9.1-9.3 ms, content hash 6.0-6.2 ms (bound 250), 1 MiB parse+compile 670 ms (2000), 1 MiB+1 rejection 0.001 ms (50), 20-game load 41-50 ms (5000), 700-card resolve 0.06-0.18 ms (50).
- VC-272 PASS (`--no-cache`): build log line `#25 [build 3/3] RUN pnpm bundle:games ...` and `bundle:games: no game declares hooks.module in /app/games`; `ls /app/games` exit 0; uid 1000, `touch /app/x` Permission denied (exit 1); user `node`; in-container `config:check` printed `OK 0 definitions`; image removed (`docker image ls` shows none); compose test image and network removed.
- Docs PASS: `grep -rn "02-phase-2\|plan-artifacts" docs README.md` returns nothing. Getting-started commands RUN with the worked example copied to `games/mini-tricks` (then deleted): `pnpm bundle:games` -> `bundle:games: built mini-tricks (7 exports, b1b52b4c...)`; `ENGINE_HOST_KEY=0123456789abcdef pnpm config:check --games games` -> `OK 1 definitions`; `pnpm config:check` -> same plus the two host-fallback warnings; without the key -> `ENV_MISSING`, exit 1.
- Gates PASS: `pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test && pnpm test:guardrails && pnpm format:check` exit 0.
- Artifacts PASS: CONTEXT.md rewritten (shipped system, no stale gaps), DECISIONS.md D-039..D-041, this record.

## Files
- Added: `docs/{game-definition-schema,game-definitions,server-config}.md`; `packages/config/src/{docs,business-rules,dbr-names,config-check-run}.test.ts`.
- Changed docs: `README.md`, `docs/{dev-setup,workspace-architecture,canonical-json-profile,domain-kernel,troubleshooting,implementation_plan}.md`. Changed tests: `packages/config/src/{config-check,yaml-compile}.test.ts` (D-041). Artifacts: CONTEXT, DECISIONS, this record. No production code, dependency or guardrail change.

## Deviations
- `docs/implementation_plan.md` edited (Phase 0 status link to `specs/00-...plan-artifacts`, stale "cannot start engine" note, Phase 2 status) so the required grep is empty.
- Two test bugs fixed (D-041): the iteration 11 child-process test assumed no `/app/games` (it exists in the Docker test image); the 1 MiB perf test timed out under coverage.
- Added DBR/coverage tests (D-040). A new `docs/dev-setup.md` row was not needed (no new root script).
- Mistake corrected: `rm -rf games` removed the tracked `games/.gitkeep`; restored with `git checkout -- games/.gitkeep`.
- `docker compose run` reuses an image: the first "pass" was the stale Phase 1 image (47 files); real results above come after `compose build`.

## DECISIONS -> docs ("R" = reflected, where; "I" = internal)
D-001 R game-definitions (Identity), canonical-json-profile. D-002 R game-definitions, domain-kernel. D-003 R game-definitions. D-004 R schema (seats, root path). D-005 I (interim state, superseded). D-006 R schema (cards, counters, zones, limits), game-definitions. D-007 R schema (Generator rules). D-008 R schema (How to read), game-definitions. D-009 I (stub, superseded by D-010). D-010 R schema (roles, control, visibility), game-definitions. D-011 R schema (Hooks), game-definitions. D-012 R schema (Policies), game-definitions. D-013 R game-definitions, schema. D-014 I (test fixture placement). D-015 R game-definitions, canonical-json-profile. D-016 I (child-process script placement; fixtures named in workspace-architecture). D-017 R workspace-architecture, domain-kernel. D-018 R workspace-architecture. D-019 R workspace-architecture (pinning); version number I. D-020 R game-definitions (YAML safety), schema. D-021 R game-definitions, schema. D-022 R workspace-architecture. D-023 R game-definitions (esbuild bump), workspace-architecture. D-024 R game-definitions (bundle build). D-025 R game-definitions, troubleshooting. D-026 R dev-setup, workspace-architecture. D-027 I (perf fixture generation; named in workspace-architecture). D-028 R game-definitions (registry). D-029 R game-definitions, troubleshooting. D-030 R game-definitions, workspace-architecture. D-031 R game-definitions (own messages); version I. D-032 R server-config, game-definitions. D-033 R server-config. D-034 R server-config. D-035 R server-config. D-036 R server-config, dev-setup, troubleshooting. D-037 R server-config, game-definitions. D-038 R game-definitions, workspace-architecture, dev-setup. D-039 R workspace-architecture (doc tests). D-040 R dev-setup (coverage note). D-041 R dev-setup, troubleshooting (compose build).

## Gotchas
- `docker compose ... run` does not rebuild; use `build` first. Docs need no Prettier but `README.md` does.
- `games/.gitkeep` must stay (depcruise scans `games`). In the Docker test image `/app/games` exists because `games/` is copied in.

## Follow-ups (open)
- Phase 3: compile `visibility`/`roles`/field visibility/`view_keys` into policy and projection; define `subject` and the `owner`/`team` audiences.
- Phase 4: bind reducers and hooks from the bundle; verify the manifest against the module's actual exports; run hooks with time and cost limits (currently `REDUCER_ERROR` "reducer not bound").
- Phase 7: turn `loadServerConfig` errors into process exit; log only `redactServerConfig(config)`.
- Phase 14: registry service; relocate `registry-contract.testing.ts`.
- Optional: add YAML positions to compile errors; type-check hooks (P8a adds games).
