# Iteration 12 — Properties, golden stream, performance and static checks

Commit: `Phase 1.12: property tests, golden stream, performance smoke and static checks` (SHA is in `git log`).

## Criteria results (Node 22.18.0 + pnpm 10.15.1; Docker for the gate)
- VC-022, VC-090, VC-091, VC-092 (1 000 runs x 6 batches each, `session/properties.test.ts`) — PASS: `pnpm exec vitest run packages/core` (also in `pnpm test`, 595 tests / 45 files). The properties use random seeds; a fixed-seed run proves every primitive kind commits, every macro is input and 9 error codes occur.
- VC-025 (same stream twice) and VC-067 (golden stream, digests at seq 0/10/20/30) — PASS: `golden-stream.test.ts`; committed digests unchanged on a second local run and in the Docker run.
- VC-084 and VC-100 inside Docker — PASS: `docker compose -f deploy/docker-compose.test.yml run --rm tests` exit 0 (45 files / 595 tests, guardrails 168). Strict mode confirmed in the Docker log (`strict spec thresholds`): apply median 0.66 ms (limit 50), digest median 2.21 ms (limit 250). Local: 0.32 ms and 1.47 ms with `CGE_PERF_STRICT=1`.
- VC-015 / KNFR-004 at floor size (4-zone 20-move case) — PASS (existing in `apply.test.ts` and repeated in `floor-performance.test.ts`).
- VC-094 (`no-timestamps.test.ts`), VC-105 (`guardrail-fixtures.test.ts`), VC-065 (`purity.test.ts`, unchanged) — PASS.
- KBR coverage: `session/apply/kbr.test.ts` adds KBR-001 (reducer/cast corruption, roster reducer smuggling zones, whole-state re-check), 002, 003, 004, 005, 009, 011; KBR-006/007/008/010 already named. — PASS.
- `pnpm test:coverage`: lines `packages/core/src/session` 99.31 % (1439/1449; production files only 99.24 %), `packages/core/src/replay/canonical` 98.95 % (284/287; production only 99.15 %); whole run 97.87 % lines — PASS (>= 95 %).
- `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test && pnpm test:guardrails` — exit 0; `pnpm format:check` clean.
- Artifacts: this record, `CONTEXT.md`, `DECISIONS.md` D-037..D-041 — PASS.

## Files
- Added: `session/generators.testing.ts`, `session/properties.test.ts`, `session/golden-stream.testing.ts`, `session/golden-stream.json`, `session/golden-stream.test.ts`, `session/floor-performance.test.ts`, `session/apply/kbr.test.ts`, `src/no-timestamps.test.ts`, `src/guardrail-fixtures.test.ts`, this record.
- Changed: `CONTEXT.md`, `DECISIONS.md`. No production source, config or guardrail file changed.

## Deviations
- None from scope. No kernel bug was found by the properties (no regression test needed). The digest schema cache was not needed (D-037). The golden stream was reviewed by hand: zone contents, counter values (including ratio rounding and remainders), control cursor results and grant ids were worked out from the spec before generating the digests and are asserted in the test.

## Gotchas
- `.testing.ts` files are determinism-linted, so generators use a `Tape` instead of any random source; test files can use `node:*`, `performance.now` and `process.env`.
- `tsc -p tsconfig.test.json` run by hand reported nothing when a test file had a type error under an earlier partial run; trust `pnpm typecheck`.
- `eslint` is not a core dependency: VC-105 loads it by a computed specifier (D-041); a static import fails `pnpm depcheck`.
- fast-check seeds are random per run; only the fixed-seed coverage test makes assertions on rare outcomes.
- The performance test is strict only when `/.dockerenv` exists or `CGE_PERF_STRICT=1`.

## For the next iteration (13: documentation, KBR traceability, Docker gate)
- Golden stream: `packages/core/src/session/golden-stream.{testing.ts,json}`; digests also asserted in Docker. Generator API is in CONTEXT (File map); coverage numbers above.
- KBR traceability script (VC-103): test names containing ids exist as `KBR-001..011` in `kbr.test.ts`, `reducers.test.ts` (KBR-007, KBR-010), `control-zones.test.ts` (KBR-006, KBR-008). KBR-012/013 are covered by `purity.test.ts`, `guardrail-fixtures.test.ts` and `no-timestamps.test.ts`.
- Known flaky risks: none identified; the only timing test has a 20x margin in strict mode (0.66 ms vs 50 ms) and a 10x ceiling locally.
- Left for docs: `docs/canonical-json-profile.md` (+ VC-066 test), `docs/domain-kernel.md`, workspace-architecture/README updates, VC-104 (Docker twice with identical golden results).
