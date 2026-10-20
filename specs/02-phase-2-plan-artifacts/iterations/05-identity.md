# Iteration 5: Definition content identity and compile/hash performance

Commit: see `git log` (message `Phase 2 iteration 5: definition content identity (content hash, bundle hash, DefinitionId)`).

## Criteria
- VC-230 PASS (object form + child process): `pnpm exec vitest run packages/core/src/definition` (`identity.test.ts`): key-order reversal, shared references (anchor stand-in), explicit defaults, compile twice, child process (`node --input-type=module -e` against `dist`, with and without reversed key order) all equal. YAML-text form deferred to iteration 7.
- VC-231 PASS: same command: 12 one-field mutations (card swap, card zone, counter max, seat team, hook-list order, visibility audience, cascade_cap, view_keys entry, gameId, metadata value, field visibility, seat count) each differ and are pairwise distinct; `hooks.module` change and `HookBundleInfo.hash` change leave the hash unchanged.
- VC-232 PASS: same command: committed `identity-expected.json` (content hashes of `FULL_DEFINITION` and the floor fixture, 3 bundle hashes, 2 ids); byte flip, added/removed/renamed export change it; order/duplicates and a permutation property (100 runs) do not.
- VC-233 PASS: same command: with/without bundle differ (even empty bundle), `^sha256:[0-9a-f]{64}$`, 71 chars, `isDefinitionId`, schema formula, stable/different bundle, package root has `definitionId` and `computeDefinitionId`.
- VC-255 PASS: same command: reducers, roster reducer and derived evaluator bound -> equal content hash and id.
- VC-215 hash half PASS: axis swap changes the hash; generator mapping-key order does not.
- VC-228 re-pointed PASS: the 500-run property now calls `definitionContentHash` (`compile/complete.test.ts`).
- VC-275 (compile + hash) PASS: `CGE_PERF_STRICT=1 pnpm exec vitest run packages/core/src/definition/identity-performance.test.ts`: `compileDefinition` 4.19 ms, `definitionContentHash` 3.80 ms (median of 20 after 3 warm-ups; bound 250 ms each). No optimisation needed. Non-strict runs apply a 10x ceiling.
- DNFR-001 in-process PASS (compile twice -> same hash, in `identity.test.ts` and `identity-performance.test.ts`).
- Gates PASS: `pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test && pnpm test:guardrails` exit 0 (903 tests; 168 guardrails). `pnpm build` proves `definitionId` and `computeDefinitionId` coexist on the root.
- Artifacts PASS: CONTEXT.md, DECISIONS.md D-015, D-016, this record.

## Files
- Added (`packages/core/src/definition/`): `identity.ts`, `identity.test.ts`, `identity-performance.test.ts`, `identity-expected.json`, `fixtures/floor-definition.json`.
- Changed: `definition/index.ts` (exports the three functions), `compile/complete.test.ts` (VC-228 property uses the hasher), artifacts.
- No P1 file, golden vector or dependency touched.

## Deviations
- The child-process script is a string in `identity.test.ts`, not a separate file (determinism lint scope covers any non-`.test.ts` file in core; D-016).
- Perf uses the 10x-ceiling-unless-strict pattern of P1's floor test; the strict numbers above were measured with `CGE_PERF_STRICT=1`.
- The Docker-image measurement is left to iteration 12.

## Gotchas
- Fixture/expected JSON are formatted by Prettier; regenerate expected values only deliberately (they pin identity).
- `pnpm exec vitest run` alone needs a built `dist` for the child-process test.
- macOS `sed -i` needs `''`; use the Edit tool.

## For the next iteration
- Iteration 6 (registry port) needs nothing from this one. Iteration 7: add YAML-text twins for VC-230 (anchors, key order, comments, whitespace, explicit defaults, child process on `.yaml`), and the parse half of VC-275; the floor `contentHash` in `identity-expected.json` is the value a YAML twin of `floor-definition.json` must equal.
- Iterations 8-9: `hookBundleHash(jsBytes, manifest.exports)` then `computeDefinitionId(definitionContentHash(def), bundleHash)`; omit the bundle hash (call with one argument) when `definitionNeedsBundle(raw)` is false.
