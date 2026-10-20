# Iteration 2: Compiler foundation

Commit: see `git log` (message `Phase 2 iteration 2: compiler foundation (errors, limits, seats, for_each)`; SHA reported by the implementing agent).

## Criteria
- VC-212 PASS: `pnpm exec vitest run packages/core/src/definition` (`compile/compile.test.ts`: id charset/length, versions 2/0 -> UNSUPPORTED_SCHEMA_VERSION, 1 -> ok).
- VC-213 PASS: same command; every seat/team case with its code, 14 seats / 4 teams ok.
- VC-211 (partial) PASS: same command; fast-check 1 000 random values never throw; SCHEMA_UNKNOWN_KEY/TYPE/MISSING, INVALID_VALUE, DUPLICATE_ID, UNKNOWN_REFERENCE, LIMIT_EXCEEDED, UNSUPPORTED_SCHEMA_VERSION asserted with path (and entity); 100-error cap + `truncated` + order asserted. Remaining codes (INVALID_VISIBILITY, RESERVED_NAME, MISSING_REDUCER, MISSING_HOOK_MODULE, UNKNOWN_HOOK_EXPORT, BUNDLE_MISSING) arrive in Iteration 4.
- VC-229 (partial) PASS: same command; `prefix: "Seat "` -> INVALID_VALUE naming `Seat 1`; 128-character ids with every allowed character pass.
- No `node:*` in core PASS: `pnpm lint` and `pnpm depcheck` exit 0.
- Gates PASS: `pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test && pnpm test:guardrails` exit 0 (704 + 168 tests).
- Artifacts PASS: CONTEXT.md (file map, compiler interfaces, known gaps), DECISIONS.md (D-004, D-005), this record.

## Files
- Added: `packages/core/src/definition/compile/{errors,limits,constants,strict,ids,foreach,seats,compile}.ts`, `compile/{compile,foreach}.test.ts`, this record.
- Changed: `packages/core/src/definition/index.ts` (exports), `CONTEXT.md`, `DECISIONS.md`.
- No P1 file or test touched; no dependency added (fast-check already a devDependency).

## Deviations
- Added `constants.ts` and `seats.ts` (not named in the plan) to keep `compile.ts` small and give the two constants a home.

## Gotchas
- Root path is `""`; unknown-key errors carry no entity (D-004).
- `exactOptionalPropertyTypes`: `SeatDecl.team` is omitted, not `undefined`.
- `ctx` is unused for now (`void ctx;` satisfies lint).
- Strict readers return the value even when sibling keys were reported; use `c.count` before/after to detect failure.

## For the next iteration
- Add a section by writing `compileX(c, member(root, key), key, scope...)`, call it in `compile.ts` in `SECTION_ORDER`, and remove the key from `UNIMPLEMENTED_SECTIONS`. Seats result gives `ForEachScope {seats: ids, teams}`.
- Report errors with `c.add(code, path, detail, entity?)`; use `readObject` first for strictness and `checkId` for every id (pass the producing path for generated ids).
- Replace the default-valued sections in the final `value` literal of `compile.ts` with compiled ones; control defaults currently derive from the seat order.
- `limits.ts` structural constants (`MAX_ZONES`, `MAX_CARDS`, ...) already exist; `ctx.limits`/`ctx.bundle` still to be read (resolve with `DEFAULT_DEFINITION_LIMITS`).
