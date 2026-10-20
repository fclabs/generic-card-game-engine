# Iteration 4: Compiler control, meta schemas, visibility, hooks, policies (compiler complete)

Commit: see `git log` (message `Phase 2 iteration 4: compile control, meta schemas, visibility, hooks and policies`).

## Criteria
- VC-210 PASS: `pnpm exec vitest run packages/core/src/definition` (`compile/complete.test.ts`, field-by-field against literals, §7.2 name map; fixture `compile/full-definition.testing.ts`).
- VC-211 PASS: same command (`complete.test.ts`): 14 codes with `code`/`path`/`entity`, unknown keys at 4 places, 130 errors -> 100 + `truncated` in document order, 1000 random values never throw.
- VC-219 PASS (`control.test.ts`), VC-220/221/222 PASS (`meta-roles.test.ts`), VC-223/224/225 PASS (`hooks.test.ts`).
- VC-226 PASS: full fixture passes `assertDefinitionStructure` and `createSession`; duplicate-card hand-built definition still fails.
- VC-228 PASS: float/depth 65/lone surrogate/unsafe int plus a 500-run property (canonicalisation of every ok compile never throws).
- VC-229 PASS (remaining cases: empty phase, space in a `for_each` zone id, 128-char ids with every allowed character).
- VC-237 (needs-bundle part) PASS: `hooks.test.ts` matrix (module only, reducer only, roster only, binding only, none, empty hooks, non-object).
- Gates PASS: `pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test` (865 tests) and `pnpm test:guardrails` (168) exit 0; `packages/core/package.json` has no `dependencies`; `git diff 3bbdd4a -- packages/core/src/replay/canonical/golden-vectors.json` empty.
- Artifacts PASS: CONTEXT.md rewritten (error code -> source table), DECISIONS.md D-010..D-014, this record.

## Files
- Added (`packages/core/src/definition/compile/`): `roles.ts`, `control.ts`, `meta.ts`, `view-keys.ts`, `hooks.ts`, `policies.ts`, `references.ts`, `finalize.ts`, `full-definition.testing.ts`, `control.test.ts`, `meta-roles.test.ts`, `hooks.test.ts`, `complete.test.ts`.
- Changed: `compile.ts` (all sections, bundle checks, `verifyCompiled`; `HookBundleInfo` moved to `references.ts` and re-exported; `UNIMPLEMENTED_SECTIONS = []`), `visibility.ts` (real body, target gains `roles`), `foreach.ts` (`ForEachScope.roles?`), `zones.ts`/`counters.ts` (pass `roles`; `compileTemplate` takes `scope`), `zones.test.ts`/`counters.test.ts` (stub assertion replaced), `definition/index.ts` (exports `definitionNeedsBundle`, `collectHookReferences`), artifacts.

## Deviations
- More modules than the plan names (small files). `MISSING_HOOK_MODULE` applies to any reference, not only reducers (D-011). VC-228 hasher property uses `canonicalize` directly until iteration 5 (D-014).

## Gotchas
- Bundle errors come after all section errors, not in section position.
- A hook/reducer name must be a JS identifier; `default` works, `a-b` does not.
- A test override key set to `undefined` still counts as present (`has`).
- Absent `control` is compiled as `{}` (not skipped) so defaults flow through the same code.

## For the next iteration
- Import `definitionIdentitySchema` by relative path (`../replay/canonical/definition-schema.js`) and export it from the package root if useful; `definitionData(def)` is the data to canonicalise. `verifyCompiled` already canonicalises once per compile: measure compile time (DNFR-002) and consider reusing the result.
- Re-point the VC-228 property (`complete.test.ts`) at `definitionContentHash`.
- Reuse `FULL_DEFINITION`/`FULL_BUNDLE` for hash goldens; hook-binding list order is preserved and `hookBindings` keys are sorted by the canonical id map.
- Iteration 8 imports `collectHookReferences`; iteration 9 `definitionNeedsBundle` and `compileDefinition(raw, {bundle, limits})` with `bundle = {hash, exports}` (the compiler ignores `hash`).
