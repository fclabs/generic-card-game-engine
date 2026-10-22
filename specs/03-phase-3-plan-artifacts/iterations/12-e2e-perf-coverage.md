# Iteration 12: End-to-end, edge path, performance, coverage, regression

Commit: see `git log` (message "Phase 3 iteration 12: end-to-end, edge path, performance and coverage").

## Criteria
All commands from the repo root, Node v26.12.0 (D-006), darwin arm64.
- VC-378 (69-transaction four-seat trick-taking session, sealed gate, `once` grant consumed via `wouldReveal` + `engine.grant_consume`, lifecycle end; live View/Delta of 8 viewers per seq equal replay-derived ones after export -> decode -> replay; fork at midpoint 34 equal up to n, original untouched, fork continues; `checkNoLeak` + `checkCompleteness` on all outputs for player/render/dealer/auditor): PASS. `pnpm exec vitest run packages/core/src/replay/end-to-end.test.ts` (10 tests).
- VC-379 (VC-340 and VC-343 on `advance`-folded states, 500 cases per role class and property, states deep-equal to the live ones): PASS. `pnpm exec vitest run packages/core/src/replay/edge-path.test.ts` (10 tests, about 20 s).
- VC-376 replay half (38 forced replay/fork/decode errors, none names a metadata value, gate payload or counter value): PASS. `pnpm exec vitest run packages/core/src/replay/replay-error-details.test.ts` (7 tests).
- VC-373 strict: PASS. `CGE_PERF_STRICT=1 pnpm build && CGE_PERF_STRICT=1 pnpm exec vitest run packages/core/src/visibility packages/core/src/replay --reporter=verbose` (26 files, 502 tests). Medians (5 runs, 1 warm-up) vs limit: `projectView` 0.19-1.01 ms (worst-case all-public 1.30 ms) vs 100; `projectDelta` 20 moves 0.05-0.13 ms vs 50; `wouldReveal` 5 once grants 2.92 ms vs 250; encode+decode 1 000 x 5 moves (590 059 bytes) 64.2 ms vs 3 000; `rebuild` 58.1 ms vs 10 000; `forkFromSeq` 57.4 ms vs 10 000; `View` JSON max 82 014 bytes (all-public worst case; 35 KB typical) vs 1 MiB; retained heap growth 0.02 MiB vs 64.
- VC-374: PASS. `pnpm test:coverage` (92 files, 1 489 tests): `core/src/visibility` 97.68 % lines, `core/src/replay` 98.15 % (its `canonical/` 98.07 %); production-only 99.4 % / 98.4 %; overall 97.90 %.
- VC-370/371: PASS. `pnpm lint && pnpm format:check && pnpm typecheck && pnpm depcheck && pnpm test:all` exit 0 (depcheck 527 modules; 92 files / 1 489 tests; guardrails 3 files / 177 tests). `git diff --name-status 5d85de5 -- .` (no `specs/`): changed pre-existing test files are exactly `definition/compile/meta-roles.test.ts` and `tools/guardrails/depcruise-rules.test.ts`, the two allowed (no discrepancy). Golden vectors, `identity-expected.json`, golden stream untouched. `node:fs` import added to `visibility/` and `replay/` fails `depcruise` with `core-no-node` (reverted); `replay/purity.test.ts` guards it in `pnpm test`.
- Artifacts (CONTEXT.md, DECISIONS.md D-045..D-048, this record): PASS.

## Files
- Added (`packages/core/src/replay/`): `trick-session.testing.ts`, `end-to-end.test.ts`, `edge-path.test.ts`, `replay-error-details.test.ts`, `purity.test.ts`, `floor-performance.test.ts`. (`packages/core/src/visibility/`): `floor.testing.ts`, `floor-performance.test.ts`. This record.
- Changed: `replay/replay-properties.test.ts` (explicit 600 s timeout: it timed out at vitest's 5 s default under `--coverage`), `CONTEXT.md`, `DECISIONS.md`. No source file; no projector/replayer bug found.
- Deleted: none.

## Deviations
- Edge-path cases default to 500 per class and property rather than 2 000 (D-045). The strict numbers are from a laptop, not the Docker baseline runner (VC-375 is Iteration 13/final).
- No guardrail fixture for `node:*` in `visibility/`/`replay/` (PFR-058); done by experiment + a core test (D-047).

## Gotchas
- `checkIndistinguishable` does not touch `stats.views`; assert `stats.perturbations`.
- `decodePackage` accepts any integer `actionSchemaVersion`; only `rebuild` rejects unsupported ones.
- Package `initial` must be seq 0: `buildVisibilityFloor().initial`, not `.state`.
- Under `--coverage` tests run about 3x slower; long property tests need explicit timeouts.

## For the next iteration (13: human documentation)
- Measured numbers and coverage figures: above and CONTEXT.md "Final state and measured numbers". Scenario helpers for doc examples: `visibility/fixtures.testing.ts` (four-seat trick-taking definition, PFR-060) and `replay/trick-session.testing.ts`.
- **Public exports added by Phase 3 (from `@cge/core`; `openBatch`, `batchSeq`, `readSealedBatch`, `packageStateNode`, `actionNode` are not exported):**
  - Functions/consts, visibility: `buildRoleRegistry`, `validateViewer`, `buildVisibilityPolicy`, `resolveAudience`, `isEntitled`, `projectView`, `projectDelta`, `projectLogEntry`, `wouldReveal`, `sealBatch`, `VIEW_SECTION_ORDER`, `DELTA_SECTION_ORDER`, `buildEntitlementContext`, `expandGrantee`, `isGrantee`, `isGrantInScope`, `resolveGrantTarget`, `isEntitledToCardKey`, `isEntitledToZoneKey`, `isStaticallyEntitledToZoneKey`, `isStaticallyEntitledToGrant`, `withoutGrants`.
  - Types, visibility: `BuiltInRole`, `PrivilegedRole`, `RoleEntry`, `RoleRegistry`, `SubjectRule`, `ViewerIdentity`, `VisibilityPolicy`, `View`, `Delta`, `DeltaEntry`, `CardView`, `ZoneView`, `GateView`, `GrantView`, `PrivilegedBatch`, `CardKey`, `ZoneKey`, `EntitlementContext`, `GrantSelection`.
  - Functions/consts, replay: `decodeCanonical`, `encodePackage`, `decodePackage`, `buildPackage`, `REPLAY_PACKAGE_FORMAT_VERSION`, `DEFAULT_MAX_PACKAGE_BYTES`, `replayPackageSchema`, `replayError`, `forkFromSeq`, `advance`, `rebuild`, `createReplayer`, `replayer`, `assertUpgraderChain`, `CURRENT_ACTION_SCHEMA_VERSION`, `PACKAGE_UPGRADERS`, `upgradeToCurrent`.
  - Types, replay: `ReplayPackage`, `PackageTransaction`, `PackageReceipt`, `BuildPackageOptions`, `DecodePackageOptions`, `PackageError`, `PackageErrorCode`, `ReplayError`, `ResolvedDefinition`, `ForkResult`, `PackageUpgrader`, `UpgradePolicy`, `RawPackage`, `RebuildOptions`, `RebuildResult`, `ReplayStep`, `Replayer`, `ReplayerConfig`.
  - `PackageErrorCode` values: `PACKAGE_TOO_LARGE`, `PACKAGE_SYNTAX`, `PACKAGE_DUPLICATE_KEY`, `PACKAGE_UNKNOWN_KEY`, `PACKAGE_SCHEMA`, `PACKAGE_FORMAT_VERSION`, `PACKAGE_LOG_GAP`.
- Known doc fixes carried: `docs/game-definitions.md` (~line 153) and `docs/game-definition-schema.md` (RESERVED_NAME row) still say built-in roles are `DUPLICATE_ID`.
