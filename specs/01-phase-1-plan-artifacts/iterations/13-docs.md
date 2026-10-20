# Iteration 13 — Documentation, KBR traceability and Docker gate

Commit: `Phase 1.13: kernel documentation, canonical profile document and final verification` (SHA is in `git log`).

## Criteria results (Node 22.18.0 + pnpm 10.15.1; Docker for the gate)
- Docs exist and are standalone: `docs/canonical-json-profile.md`, `docs/domain-kernel.md`, `docs/workspace-architecture.md` (new "`packages/core` contents" section), `README.md`, `docs/implementation_plan.md` (Phase 1 status line), `specs/00-phase-0-frozen.md` (narrowed skeleton-purity note) — PASS. `grep -ri "01-phase-1\|plan-artifacts\|iterations/" docs README.md` matches only the pre-existing Phase 0 line in `implementation_plan.md` (`specs/00-phase-0-plan-artifacts/...`, from commit `bf13873`); nothing from this iteration.
- Commands in the docs were run: `pnpm test`, `pnpm exec vitest run packages/core/src/replay/canonical`, `pnpm test:coverage`, `pnpm test:guardrails`, the Docker command, and the three `UPDATE_GOLDEN=1` regeneration commands (followed by Prettier on the JSON): all worked and the regenerated JSON files were byte-identical (`git status` clean for them) — PASS. The usage example in `domain-kernel.md` was run as a scratch vitest file and type-checked under `tsconfig.test.json` before being pasted (scratch file removed) — PASS.
- VC-066: `pnpm exec vitest run packages/core/src/canonical-profile-doc.test.ts` — PASS (13 tests: "frozen", golden-vectors path, Rule 1-8 headings, node kinds, field order).
- VC-103: `pnpm exec vitest run packages/core/src/kbr-traceability.test.ts --silent=false` lists KBR-001 (5 tests), 002 (1), 003 (1), 004 (1), 005 (1), 006 (5), 007 (5), 008 (2), 009 (1), 010 (5), 011 (1) and the static carriers of KBR-012/013 — PASS. `pnpm test:coverage`: lines `packages/core/src/session` 99.42 %, `packages/core/src/replay/canonical` 98.95 %, all files 97.87 % — PASS (>= 95 %).
- VC-101: `git diff bf13873 --stat -- tools` shows only `tools/guardrails/repo-invariants.ts` (+ `.test.ts`), the `packages/core` skeleton-purity exemption; `pnpm test:guardrails` 168 tests — PASS.
- VC-102: `git diff bf13873 --stat -- packages/core/package.json` empty (no `dependencies`, same exact-pinned devDependencies) — PASS.
- VC-104: `docker compose -f deploy/docker-compose.test.yml run --rm tests` exit 0 twice after an explicit `docker compose ... build` (47 files / 625 tests, guardrails 168; strict thresholds mode confirmed; `golden-stream.test.ts` (6 tests), `golden-vectors.test.ts` (39) and `prng.test.ts` pass in both runs against the committed digests; per-file results identical apart from completion order) — PASS.
- `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test && pnpm test:guardrails && pnpm format:check` — exit 0 (625 tests in 47 files).
- Artifacts: this record, final `CONTEXT.md`, `DECISIONS.md` D-042, D-043 — PASS.

## Files
- Added: `docs/canonical-json-profile.md`, `docs/domain-kernel.md`, `packages/core/src/kbr-traceability.test.ts`, `packages/core/src/canonical-profile-doc.test.ts`, this record.
- Changed: `docs/workspace-architecture.md`, `README.md`, `docs/implementation_plan.md`, `specs/00-phase-0-frozen.md`, `CONTEXT.md`, `DECISIONS.md`. No production source, config or guardrail file changed. `docs/dev-setup.md` unchanged (no command changed).

## Decision coverage in the docs
Reflected in `domain-kernel.md` ("Decisions that bind readers", architecture, limits) or `canonical-json-profile.md`: D-001 (snapshots/freezing, `GameRejection`), D-004/D-005 (node kinds, strict optional/`undefined`/`null`), D-007 (data vs function members), D-008 (definition checks, partly in limits), D-009 (union nodes), D-010 (initial state), D-011 (digest, evaluator errors), D-012 (`maskGates`), D-013 (PRNG), D-014 (wire shape, payload depth 64), D-015, D-016, D-017 (pipeline, working state), D-018 (own-key records), D-019 (move rules, via the action behaviours), D-020, D-021 (counters, supply direction), D-022, D-023 (zones, `nextZoneId`, grants), D-024 (control), D-025/D-026 (reducers), D-027 (engine payloads, re-check), D-028..D-030 (macros), D-031..D-035 (SPI and ports), D-037 (no schema cache), D-040 (strict perf mode), D-039 (golden stream regeneration). Judged internal (tooling and test mechanics, documented only in the artifacts or code comments): D-002 (guardrail path prefix; the doc states the outcome), D-003 (local Node activation; `dev-setup.md` already covers Node 22), D-006 (vitest-driven golden generation; the regeneration command is in the docs), D-036 (dist-reading tests; the troubleshooting row says to build first), D-038 (tape generators), D-041 (VC-094/105 static check mechanics), D-042, D-043.

## Deviations
- None from scope. The VC-103 checker is a Vitest test (the scope allowed either form). Spec A5's three deviations are listed in `canonical-json-profile.md`, together with the as-built details (union nodes, strict optional handling, json depth 64, initial-state choices).

## Gotchas
- `docker compose run` does not rebuild an existing image: the first two "Docker" runs executed the previous image (45 files / 595 tests, missing the new tests). Always `docker compose -f deploy/docker-compose.test.yml build` (or `run --build`) after changing files before counting a run.
- Vitest hides `console.log` output of passing tests unless `--silent=false`; the KBR table is shown that way.
- `docs/**` is excluded from Prettier, so the doc test is the guard for the profile document's structure.

## For Phase 2 (consumers of this kernel)
- `CompiledGameDefinition` (`core/definition`) is the compiler's target. Field names are camelCase (mapping in CONTEXT); `definitionData` and `definitionDataSchema` define its serialisable data portion; adding fields is a P1-types change in P2 with a regression test.
- The canonical module (`core/replay/canonical`: `canonicalize`, `CanonicalSchema`, `stateDigest`, `sha256Hex`, `CanonicalError`) is frozen; content identity in P2 should use it (a new schema, not a profile change).
- `apply`, `createSession`, `validateAction`, `nextZoneId`, `maskGates`, and the SPI/port types are the surfaces P3-P6 build on. Open items for P2: whether to enforce control pointer names, duplicate template/meta/group ids, `maxInstances` sanity (CONTEXT Known gaps); a `DefinitionRegistry` port and session-creation method are not in `core/ports` yet.
