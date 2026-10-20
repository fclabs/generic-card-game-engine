# Iteration 2 — Canonical JSON profile v1 and SHA-256

Commit: `Phase 1.2: canonical JSON profile v1, SHA-256 and golden vectors` (SHA is in `git log`).

## Criteria results (Node 22.18.0 + pnpm 10.15.1)
- VC-060: `pnpm exec vitest run packages/core/src/replay/canonical` — PASS (35 vectors; bytes, text and digest, digest also vs `node:crypto` and python hashlib).
- VC-061: `canonicalize.test.ts` (40 invalid-input cases incl. 1.5, NaN, ±Infinity, -0, 2^53, undefined, function, symbol, cycle, Map, Set, Date, lone surrogate, undeclared field, bigint in json, depth 65) each asserts `CanonicalError` and exact `path` — PASS.
- VC-062 (map-order half): same test file, insertion-order permutations give identical bytes — PASS.
- VC-064: `sha256.test.ts` NIST vectors (`""`, `abc`, 448-bit, 1M `a`) + padding boundaries + 200 random strings vs `node:crypto` — PASS.
- VC-065: `packages/core/src/purity.test.ts` (comment-stripped scan of all non-`.test.ts` sources) plus `pnpm lint` — PASS.
- VC-068 (partial): `replay/canonical/index.test.ts` exports exactly `CanonicalError`, `canonicalize`, `sha256Hex`; root re-exports same identities — PASS.
- `pnpm typecheck`, `pnpm lint`, `pnpm depcheck`, `pnpm test` (198 tests), `pnpm test:guardrails` (168), `pnpm format:check` — all exit 0.
- Artifacts: this file, `CONTEXT.md` (constructors, regeneration command), `DECISIONS.md` D-004..D-006 — PASS.

## Files
- Added: `packages/core/src/util/{utf8,utf8.test}.ts`, `packages/core/src/replay/canonical/{canonicalize,canonicalize.test,schema,sha256,sha256.test,index,index.test,golden-vectors.test,generate-golden-vectors.testing}.ts`, `golden-vectors.json`, `packages/core/src/purity.test.ts`, `specs/01-phase-1-plan-artifacts/iterations/02-canonical-json.md`.
- Changed: `packages/core/src/replay/index.ts`, `CONTEXT.md`, `DECISIONS.md`.

## Deviations
- None from scope. Choices (constructor names, strict `undefined` handling, vitest-driven generation) are in D-004..D-006. Schema constructors are intentionally absent from the index.
- `CanonicalError` extends `Error` and is thrown; `encodeUtf8` returns a `Result`.

## Gotchas
- `.testing.ts` files fall under the determinism lint (no `node:*`), so fs/crypto use lives in `*.test.ts`.
- Path of `purity.test.ts` is `src/` root so it scans `packages/core/src`; `new URL("./")` not `"../"` (that would scan `node_modules`).
- Sorting keys with default `.sort()` is UTF-16 code-unit order (verified with U+FFFF vs U+1F600 vector).

## For the next iteration
- Iteration 3 is unaffected. Iteration 4 adds `stateDigest` to `canonical/index.ts`, builds the state schema from the `schema.ts` constructors (idMaps for cards, zones, ordinals, counters, derived counters, seats, gates, grants, meta; delegations as `arrayNode`), must never emit `undefined`-valued keys, and updates `index.test.ts` to the four-export list and the root-containment check.
- Iteration 13 writes `docs/canonical-json-profile.md` from §6.2 plus D-004/D-005 and the golden-vector path.
