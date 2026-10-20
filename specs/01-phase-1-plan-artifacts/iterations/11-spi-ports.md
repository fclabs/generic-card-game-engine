# Iteration 11 — SPI and port types

Commit: `Phase 1.11: rule SPI and port interface types` (SHA is in `git log`).

## Criteria results (Node 22.18.0 + pnpm 10.15.1)
- VC-080 (A4 shapes accepted; `Reducer<S>` returns `S`, async reducer rejected by `@ts-expect-error`) — PASS: `pnpm typecheck` exit 0 (type tests in `spi/spi.test.ts`) and `pnpm test`.
- VC-081 (emitted `spi` JS: no export, no function/class/arrow, no `setTimeout`, `setInterval`, `import(`, `await`) — PASS: `dist-output.test.ts` in `pnpm test`.
- VC-085 (in-memory implementations of every port in `ports/ports.testing.ts` compile under `tsconfig.test.json`; emitted `ports` JS exports nothing) — PASS.
- VC-086 (`seq: null` accepted, TSDoc of `commit` contains `STALE_WRITER`, `OutboxRow['kind']` equals the union) and VC-087 (`'delete'` rejected by `@ts-expect-error`) — PASS.
- VC-095 (host `AbortSignal` assignable to `AbortSignalLike` in `tsconfig.test.json`; production sources, `.js` and `.d.ts` of `spi`/`ports` never name `AbortSignal`, `tsconfig.json` has `types: []`) — PASS.
- `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test` — exit 0 (560 tests, 39 files); `pnpm test:guardrails` (168) and `pnpm format:check` green.
- Artifacts: this file, `CONTEXT.md`, `DECISIONS.md` D-031..D-036 — PASS.

## Files
- Added: `spi/types.ts`, `spi/spi.test.ts`, `ports/types.ts`, `ports/ports.testing.ts`, `ports/ports.test.ts`, `dist-output.test.ts`, this record.
- Changed: `spi/index.ts`, `ports/index.ts` (were `export {}`), `CONTEXT.md`, `DECISIONS.md`.

## Deviations
- None from scope. Field sets for the loosely specified payloads are in D-031..D-035. `Reducer<S>` already lived in `session/reducer.ts` and the apply/definition code already used it, so no iteration-9 edit was needed. Extra exported helper types beyond the KFR lists: the hook contexts (`ValidationContext`, `ReactionContext`, `ReactionResult`, `GateResolveContext`), `Principal`, `AuthOp`, `AuthTarget`, `EventId`, `Epoch`, `StaleWriterError`, `StoredSession`, `SessionSummary`, `CommittedTransaction`.

## Gotchas
- VC-065 (`purity.test.ts`) scans every non-`*.test.ts` file in `src`, so `node:fs` is only allowed in `*.test.ts` (this is why the dist helper lives inside `dist-output.test.ts`, not a `*.testing.ts`).
- tsc keeps TSDoc in emitted JS/d.ts: token checks strip comments first, and `spi`/`ports` source must not mention `AbortSignal` (only `AbortSignalLike`).
- `LifecycleAction` uses `to_state` (not `to`).
- Dist tests get a fresh build because `pnpm test` runs `pnpm build` first (D-036).

## For the next iteration (12: properties, golden stream, performance, static checks)
- Types are final; no runtime from `spi`/`ports`. `Effect` is never read by `apply` (VC-094 check can assert that and that no timestamp field exists in the new port types either: none was added).
- `startState()` in `session/apply/apply.testing.ts` is the easy way to get a state for store fixtures.
- Iteration 13 docs can cite D-031..D-035 for port payload shapes.
