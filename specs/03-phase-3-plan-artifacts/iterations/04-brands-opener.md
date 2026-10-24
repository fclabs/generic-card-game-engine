# Iteration 4: View/Delta brands, opaque PrivilegedBatch and opener dependency rule

Commit: see `git log` (message "Phase 3 iteration 4: View/Delta brands, opaque PrivilegedBatch and opener dependency rule").

## Criteria
All commands from the repo root.
- VC-335 (opaque runtime shape): PASS. `pnpm exec vitest run packages/core/src/visibility` (`privileged-batch.test.ts`).
- VC-336 (type tests): PASS. `pnpm typecheck` (core `tsconfig.test.json` compiles `privileged-batch.test.ts`; every `@ts-expect-error` is used) plus the `expectTypeOf` checks at vitest runtime.
- VC-337 (fixture fails/passes, invariant lists rule): PASS. `pnpm exec vitest run --config vitest.guardrails.config.ts` (3 files, 177 tests): `core-privileged-batch-opener-app` yields exactly `core-privileged-batch-opener`, `-allowed` (replay + visibility) is clean, `SECTION_73_RULES` includes the rule.
- `pnpm depcheck`: PASS (466 modules). `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`: PASS.
- Core visibility tests (Iterations 1-3 + new): 5 files, 90 tests PASS; `index.test.ts`, `purity.test.ts`, `dist-output.test.ts`: 18 tests PASS.
- Artifacts (CONTEXT.md, DECISIONS.md D-015, D-016, this record): PASS.

## Files
- Added: `visibility/privileged-batch.ts`, `visibility/open-batch.ts`, `visibility/privileged-batch.test.ts`, fixtures `tools/guardrails/fixtures/depcruise/core-privileged-batch-opener-app/**` and `core-privileged-batch-opener-allowed/**`, this record.
- Changed (visibility): `types.ts` (brands, `Delta`, `DeltaEntry`, `ViewSections`, `DeltaSections`), `make-view.ts` (takes `ViewSections`), `index.ts` (exports `sealBatch`, `PrivilegedBatch`, `Delta`, `DeltaEntry`).
- Changed pre-existing guardrail/doc files: `.dependency-cruiser.cjs` (new rule), `tools/guardrails/depcruise-cases.ts` (two cases, `SECTION_73_RULES` + 1), `tools/guardrails/depcruise-rules.test.ts` (rule-listing test title/count, new VC-337 describe), `docs/workspace-architecture.md` (rule paragraph). `docs/implementation_plan.md` (historical list of 12 rules) left untouched.
- Deleted: none.

## Deviations
- None from scope. Interpretations in D-015 (accessor shape) and D-016 (constructor types, rule path scope).

## Gotchas
- With a branded `View`, any code or test building a View literal must go through `makeView`/cast.
- `{ ...batch } as PrivilegedBatch` is flagged by lint as an unnecessary assertion; pass the spread directly.
- Guardrail fixtures are cruised with the real rules; case dirs need `packages/core/package.json` for path matching.

## For the next iteration (5: projectDelta)
- Create `Delta` only through a new single `makeDelta(sections: DeltaSections): Delta` (new module in `visibility/`); `DeltaEntry` and `Delta` types are final per spec 7.2.
- Open batches with `openBatch(batch)` from `./open-batch.js` (returns `Transaction`; `tx.seq` may be `null`); `batchSeq(batch)` gives `Seq | null` for the PFR-023 check (`batch does not match pre/post`). Do not re-export either.
- Tests may build batches with `sealBatch(tx)` from `./privileged-batch.js`.
