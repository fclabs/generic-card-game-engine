# Iteration 13: Human documentation

Commit: see `git log` (message "Phase 3 iteration 13: visibility and replay documentation").

## Criteria
All from the repo root; local Node v26 (D-006); Docker is Node 22.
- VC-372 (both docs exist, name every function of the projector/package/replay/fork interfaces and every `PackageErrorCode`; canonical doc lists `replayPackageSchema`, `decodeCanonical`, "profile v1 is unchanged"; README links): PASS. `pnpm exec vitest run packages/config/src/docs.test.ts` (23 tests; the doc-presence test, extended, D-049).
- VC-377 (worked example per built-in role `player`, `render`, `dealer`, `auditor` + opaque-id advice): PASS (same test). Example outputs were generated from the real fixture (`visibility/fixtures.testing.ts`, with `auditor: public` on hands and `dealer: public` on the stock) by a temporary test, then deleted.
- How-to commands run and worked: PASS. Snippets (`buildPackage` -> `encodePackage` -> `decodePackage` -> `rebuild` full/`uptoSeq 6`/from bytes/`onStep`, `forkFromSeq` at 6, `advance` fold, error cases) run on the golden fixture via a temporary test: seq 12 digest `7d635a3d...3b74`, fork log 6/digests 6/receipts 0/active, tamper -> `digest mismatch at seq 4`, `unsupported action_schema_version 7`, `uptoSeq out of range: 13`. Doc commands: `pnpm build && pnpm exec vitest run packages/core/src/replay` (17 files, 333 tests), golden second-process `cmp` printed IDENTICAL, `replay-properties.test.ts` (600 sessions) PASS.
- `grep -rniE "03-phase-3|plan-artifacts|iteration [0-9]|\bVC-3|\bPFR-" docs/visibility.md docs/replay-package.md`: PASS (no match, exit 1); also a docs test.
- `pnpm lint && pnpm format:check && pnpm typecheck && pnpm depcheck` (527 modules) and `pnpm test:all` (92 files / 1 495 tests + 3 files / 177 guardrail tests): PASS.
- VC-375: PASS. `docker compose -f deploy/docker-compose.test.yml build` then `docker compose -f deploy/docker-compose.test.yml run --rm tests` exit 0: 92 files / 1 495 tests + 177 guardrail tests (Node 22 image, strict performance thresholds on; properties at default counts).
- Artifacts: PASS.

## Files
- Added: `docs/visibility.md`, `docs/replay-package.md`, this record.
- Changed: `docs/canonical-json-profile.md`, `workspace-architecture.md`, `domain-kernel.md`, `design.md` (2.3), `implementation_plan.md` (Phase 3 status), `game-definitions.md`, `game-definition-schema.md` (RESERVED_NAME fixes and "visibility is applied" notes), `troubleshooting.md`, `README.md`, `packages/config/src/docs.test.ts`, `CONTEXT.md` (rewritten), `DECISIONS.md` (D-049, D-050). No source file; no guardrail change.
- Deleted: none.

## Decision placement
See D-050 for which decisions went into which doc and which were judged internal.

## Deviations
- The "doc-presence invariant" is `packages/config/src/docs.test.ts`, not a `tools/guardrails` file (D-049). Two of its old assertions changed (phrase "visibility semantics", planning-artifact pattern).
- Docker "clean build" = `compose build` (layer cache allowed) followed by `run --rm tests`.

## Gotchas
- Wire format uses `[key, value]` pair arrays for id-keyed records; docs say so.
- `docs.test.ts` forbids phrases like `02-phase-2`/`plan-artifacts` in every doc; avoid them.
- Prettier re-aligns the README table; run it on touched docs.

## For the freeze step and Phase 4
- Public exports, measured numbers, known gaps, behaviour summary: CONTEXT.md. Phase 4 must bind reducer functions to YAML-compiled definitions so `rebuild` works for them; replay and projection never call hooks. Phase 6 emits `engine.grant_consume` from `wouldReveal`, builds `PrivilegedBatch` with `sealBatch`, wires export/import via `buildPackage`/`decodePackage`/`rebuild` and the policy gate for `forkFromSeq`.
